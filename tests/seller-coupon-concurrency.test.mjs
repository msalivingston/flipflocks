import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";

const database = process.env.COUPON_TEST_DATABASE;
test("simultaneous seller orders cannot redeem one email twice", {
  skip: !database && "Set COUPON_TEST_DATABASE to the isolated local coupon database",
}, async () => {
  assert.match(database,/^flockfront_coupon_[a-z0-9_]+$/);
  const owner=randomUUID(), store=randomUUID(), key=randomUUID().replaceAll("-","");
  const run=(sql,onOutput=()=>{})=>new Promise((resolve,reject)=>{
    const child=spawn("docker",["exec","-i","supabase_db_flipflocks_release_validation","sh","-c",
      `PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d ${database} -At -v ON_ERROR_STOP=1`]);
    let stdout="",stderr="";
    child.stdout.on("data",data=>{stdout+=data;onOutput(stdout);});
    child.stderr.on("data",data=>{stderr+=data;});
    child.on("error",reject); child.on("close",code=>resolve({code,stdout,stderr})); child.stdin.end(sql);
  });
  const seeded=await run(`begin;
    set local "request.jwt.claim.role"='service_role';
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('${owner}','${key}@example.test','{}','{}');
    insert into public.stores(id,owner_user_id,store_name,store_slug) values('${store}','${owner}','Coupon concurrency','coupon-${key}');
    insert into public.seller_billing_status(store_id,requested_plan_key,requested_billing_cadence,plan_key,billing_plan,subscription_status,trial_started_at,trial_ends_at,current_period_start,current_period_end,storefront_access_until,billing_state_authority)
    values('${store}','small_flock','monthly','small_flock','monthly','trialing',now(),now()+interval '7 days',now(),now()+interval '7 days',now()+interval '7 days','trial');
    insert into public.seller_coupons(store_id,code,discount_type,discount_value,once_per_customer) values('${store}','SURVEY10','fixed',10,true); commit;`);
  assert.equal(seeded.code,0,seeded.stderr);
  const intent=email=>`set local "request.jwt.claim.sub"='${owner}'; set local "request.jwt.claim.role"='authenticated';
    select * from public.seller_create_manual_order(p_store_id=>'${store}',p_idempotency_key=>'${randomUUID()}',
      p_customer_email=>'${email}',p_customer_first_name=>'Test',p_customer_last_name=>'Buyer',
      p_items=>'[{"item_type":"custom","custom_item_name":"Test item","quantity":1,"unit_price":20}]',p_coupon_code=>'SURVEY10');`;
  let signal; const held=new Promise(resolve=>{signal=resolve;});
  const first=run(`begin; ${intent("race@example.test")} select 'COUPON_LOCK_HELD'; select pg_sleep(1); commit;`,out=>{if(out.includes("COUPON_LOCK_HELD"))signal();});
  await Promise.race([held, first.then(result=>{assert.equal(result.code,0,result.stderr);})]);
  const second=run(`begin; ${intent(" RACE@EXAMPLE.TEST ")} commit;`);
  const [a,b]=await Promise.all([first,second]);
  assert.equal(a.code,0,a.stderr); assert.notEqual(b.code,0);
  assert.match(b.stderr,/already been used or is reserved/);
  const count=await run(`select count(*) from public.seller_coupon_redemptions where store_id='${store}' and released_at is null;`);
  assert.equal(count.stdout.trim(),"1");
});
