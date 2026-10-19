import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as coupons from "../lib/coupons.ts";

const coupon={id:"coupon-1",code:"SURVEY10",discount_type:"fixed",discount_value:10,scope:"order",targets:[],minimum_purchase:0,expires_on:null,once_per_customer:true,is_active:true};
function render(draft) {
  let state=0;
  const values=[[coupon,{...coupon,id:"coupon-2",code:"FALL15",discount_type:"percent",discount_value:15,is_active:false}],draft,null,false,false,[],"",[]];
  const stubs={react:{useState:()=>[values[state++],()=>{}],useEffect:()=>{}},"react/jsx-runtime":jsxRuntime,
    "@/lib/supabase":{supabase:{}},"@/lib/coupons":coupons,"../orders/_lib/order-inventory-search":{searchOrderInventory:async()=>[]}};
  const compiled=ts.transpileModule(readFileSync(new URL("../app/dashboard/store-admin/coupons-tab.tsx",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const loadedModule={exports:{}};
  new Function("require","module","exports",compiled)(name=>{assert.ok(stubs[name],name);return stubs[name];},loadedModule,loadedModule.exports);
  return renderToStaticMarkup(loadedModule.exports.default({storeId:"store-1"}));
}
test("Coupons tab shows shared codes, amounts, statuses, and management actions",()=>{
  const html=render(null);
  for(const text of ["Create Coupon","SURVEY10","$10.00 off","FALL15","15% off","Active","Inactive","Edit","Deactivate","Activate"])assert.ok(html.includes(text),text);
  assert.ok(!html.includes("Delete Coupon"));
});
test("coupon editor exposes only the agreed simple controls",()=>{
  const html=render(coupon);
  for(const text of ["Coupon code","Fixed amount ($)","Percentage (%)","Selected products","Selected breeds","Selected categories","Minimum purchase","Expiration date","One use per customer email","Save Coupon"])assert.ok(html.includes(text),text);
  assert.ok(!/Batch generation|Redemption limit|Recipient email|Survey integration/.test(html));
});
