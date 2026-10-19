import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { resolveFlockFrontCors } from "../supabase/functions/_shared/cors.ts";
import { normalizeCheckoutItems } from "../supabase/functions/_shared/checkout-items.ts";
import * as couponCheckout from "../supabase/functions/_shared/coupon-checkout.ts";

const storeId="cb000000-0000-4000-8000-000000000010",itemId="cb000000-0000-4000-8000-000000000050";
function harness({net=50,reserveError=null,quoteError=null}={}) {
  let handler;
  const calls=[],sessions=[],expired=[];
  const service={
    from(table) {
      const row=table==="stores" ? {currency_code:"USD",delivery_enabled:false} : table==="store_stripe_connections" ? {stripe_account_id:"acct_Coupon"} : null;
      const query={select(){return this;},eq(){return this;},lt(){return this;},limit(){return Promise.resolve({data:[]});},single(){return Promise.resolve({data:row});},maybeSingle(){return Promise.resolve({data:row});}};
      return query;
    },
    async rpc(name,args) {
      calls.push({name,args});
      if(name==="get_public_storefront_by_slug") return {data:[{is_publicly_available:true,storefront:{store_id:storeId,card_payments_enabled:true}}]};
      if(name==="consume_public_checkout_rate_limit") return {data:[{allowed:true}]};
      if(name==="get_public_checkout_summary") return {data:[{is_checkout_available:true,subtotal_amount:60,items:[{item_name:"Eligible chicks",unit_price:20,requested_quantity:3}]}]};
      if(name==="preview_storefront_coupon") return {data:quoteError?null:{coupon_amount:60-net,net_subtotal:net,lines:[{item_name:"Eligible chicks",quantity:3,net_amount:net}]},error:quoteError};
      if(name==="reserve_storefront_card_checkout") return {data:[],error:reserveError};
      throw Error(`Unexpected RPC ${name}`);
    },
  };
  const stripe={accounts:{retrieve:async()=>({capabilities:{card_payments:"active"},charges_enabled:true,payouts_enabled:true})},checkout:{sessions:{
    async create(input,options) {
      sessions.push({input,options});
      return {id:"cs_test_Coupon",status:"open",livemode:false,currency:"usd",expires_at:input.expires_at,metadata:input.metadata,
        amount_total:input.line_items.reduce((n,l)=>n+l.price_data.unit_amount*l.quantity,0),url:"https://checkout.stripe.com/c/pay/test"};
    },async expire(id){expired.push(id);return {};},
  }}};
  const environment={SUPABASE_URL:"http://localhost:54321",SUPABASE_SERVICE_ROLE_KEY:"test-only",STRIPE_CONNECT_LIVEMODE:"false",FLOCKFRONT_ENVIRONMENT_ID:"local-test",FLOCKFRONT_PUBLIC_SITE_URL:"https://flockfront.test",STRIPE_CONNECT_API_KEY:"sk_test_fake"};
  const stubs={"https://esm.sh/@supabase/supabase-js@2.106.0":{createClient:()=>service},"../_shared/cors.ts":{resolveFlockFrontCors},"../_shared/stripe-connect-client.ts":{createStripeConnectClient:()=>stripe},"../_shared/checkout-items.ts":{normalizeCheckoutItems},"../_shared/coupon-checkout.ts":couponCheckout};
  const compiled=ts.transpileModule(readFileSync(new URL("../supabase/functions/stripe-connect-checkout/index.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loadedModule={exports:{}};
  new Function("require","module","exports","Deno",compiled)(name=>{assert.ok(stubs[name],name);return stubs[name];},loadedModule,loadedModule.exports,{env:{get:name=>environment[name]},serve:value=>{handler=value;}});
  const request=(extra={})=>handler(new Request("https://functions.test/stripe-connect-checkout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"start",store_slug:"coupon-test",idempotency_key:"coupon-card",buyer_email:"buyer@example.test",buyer_first_name:"Test",buyer_last_name:"Buyer",buyer_phone:"5550100",coupon_code:"SURVEY10",items:[{item_type:"listing_inventory",item_id:itemId,quantity:3}],...extra})}));
  return {request,calls,sessions,expired};
}
test("card checkout uses database coupon totals and preserves quantities despite fractional unit cents",async()=>{
  const h=harness(); const response=await h.request({coupon_amount:999,total_amount:0});
  assert.equal(response.status,200);
  assert.equal(h.sessions[0].input.line_items.reduce((n,l)=>n+l.quantity,0),3);
  assert.equal(h.calls.find(c=>c.name==="reserve_storefront_card_checkout").args.p_amount_total_cents,5000);
  assert.equal(h.calls.find(c=>c.name==="reserve_storefront_card_checkout").args.p_coupon_code,"SURVEY10");
});
test("coupon conflict after Session creation expires the unseen Session",async()=>{
  const h=harness({reserveError:{message:"This coupon has already been used or is reserved in another checkout for this email."}});
  const response=await h.request(); assert.equal(response.status,409);
  assert.deepEqual(h.expired,["cs_test_Coupon"]);
  assert.ok(!(await response.json()).checkout_url);
});
test("invalid coupon cannot create a Session or reserve inventory",async()=>{
  const h=harness({quoteError:{message:"Coupon is invalid, inactive, or expired."}});
  assert.equal((await h.request()).status,409); assert.equal(h.sessions.length,0);
  assert.ok(!h.calls.some(c=>c.name==="reserve_storefront_card_checkout"));
});
test("fully discounted checkout creates a zero-balance Session",async()=>{
  const h=harness({net:0}); assert.equal((await h.request()).status,200);
  assert.equal(h.calls.find(c=>c.name==="reserve_storefront_card_checkout").args.p_amount_total_cents,0);
});
test("positive balance below Stripe's USD minimum does not reserve or consume a coupon",async()=>{
  const h=harness({net:0.25}); const response=await h.request(); assert.equal(response.status,409);
  assert.equal((await response.json()).error,"card_amount_too_small"); assert.equal(h.sessions.length,0);
});
