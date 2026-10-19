begin;
set local search_path=public,extensions;
select no_plan();
set local "request.jwt.claim.role"='service_role';

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('ca000000-0000-4000-8000-000000000001','coupon-owner@example.test','{}','{}');
insert into public.stores(id,owner_user_id,store_name,store_slug,store_status,storefront_mode,storefront_enabled,show_public_phone,public_phone)
values('ca000000-0000-4000-8000-000000000010','ca000000-0000-4000-8000-000000000001','Coupon Test','coupon-test','live','hosted',true,true,'555-0100');
insert into public.seller_billing_status(store_id,requested_plan_key,requested_billing_cadence,plan_key,billing_plan,subscription_status,trial_started_at,trial_ends_at,current_period_start,current_period_end,storefront_access_until,billing_state_authority)
values('ca000000-0000-4000-8000-000000000010','small_flock','monthly','small_flock','monthly','trialing',now(),now()+interval '7 days',now(),now()+interval '7 days',now()+interval '7 days','trial');

select set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok($$select public.seller_save_coupon('ca000000-0000-4000-8000-000000000010',
  '{"code":" survey10 ","discount_type":"fixed","discount_value":10,"scope":"order","targets":[],"once_per_customer":true}')$$,'Coop seller can create shared coupons');
select is((select code from public.seller_coupons where store_id='ca000000-0000-4000-8000-000000000010'),'SURVEY10','codes normalize');
select throws_ok($$select public.seller_save_coupon('ca000000-0000-4000-8000-000000000099','{}')$$,'P0001','Store is not available.','other stores cannot be managed');
reset role;
set local "request.jwt.claim.role"='service_role';
update public.seller_billing_status set plan_key='full_flock',requested_plan_key='full_flock' where store_id='ca000000-0000-4000-8000-000000000010';
update public.stores set equipment_supplies_enabled=true where id='ca000000-0000-4000-8000-000000000010';
insert into public.equipment_inventory_items(id,store_id,item_name,category,condition,quantity_available,price,visibility_status,moderation_status,available_date)
values('ca000000-0000-4000-8000-000000000050','ca000000-0000-4000-8000-000000000010','Feeder','Feeders & Waterers','Good',100,20,'active','normal',current_date);

create temp table coupon_results as select public.calculate_order_discounts(
 'ca000000-0000-4000-8000-000000000010',' Buyer@Example.Test ',
 '[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","line_subtotal":60}]','survey10','percent',10) pricing;
select is((select (pricing->>'coupon_amount')::numeric from coupon_results),10::numeric,'fixed coupon is exactly ten dollars');
select is((select (pricing->>'manual_amount')::numeric from coupon_results),5::numeric,'manual percent follows coupon');
select is((select (pricing->>'net_subtotal')::numeric from coupon_results),45::numeric,'net total is coupon then manual');
select is((public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','buyer@example.test','[{"line_subtotal":4}]','SURVEY10','fixed',99)->>'net_subtotal')::numeric,0::numeric,'discounts never make negative totals');

create temp table created_coupon_order as select * from public.seller_create_manual_order(
 p_store_id=>'ca000000-0000-4000-8000-000000000010',p_idempotency_key=>'coupon-manual-1',
 p_items=>'[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","quantity":3,"unit_price":20}]',
 p_customer_email=>' Buyer@Example.Test ',p_customer_first_name=>'Test',p_customer_last_name=>'Buyer',
 p_coupon_code=>'survey10',p_manual_discount_type=>'percent',p_manual_discount_value=>10);
select is((select total_amount from created_coupon_order),45::numeric,'seller order persists discounted total');
select is((select sum(line_subtotal) from public.order_items where order_id=(select order_id from created_coupon_order)),45::numeric,'line totals reconcile without per-unit rounding loss');
select is((select count(*) from public.seller_coupon_redemptions where customer_email='buyer@example.test' and released_at is null),1::bigint,'one normalized-email redemption');
select throws_ok($$select public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','BUYER@example.test','[{"line_subtotal":20}]','SURVEY10')$$,'P0001','This coupon has already been used or is reserved in another checkout for this email.','changed email casing cannot redeem again');
select lives_ok($$select public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','another@example.test','[{"line_subtotal":20}]','SURVEY10')$$,'shared code works for another customer');
update public.seller_coupons set is_active=false,discount_value=99 where code='SURVEY10' and store_id='ca000000-0000-4000-8000-000000000010';
select is((select total_amount from public.orders where id=(select order_id from created_coupon_order)),45::numeric,'coupon changes do not change existing totals');
select is((select discount_snapshot->'coupon'->>'discount_value' from public.orders where id=(select order_id from created_coupon_order)),'10.00','original coupon definition is retained');
update public.orders set order_status='canceled',canceled_at=now() where id=(select order_id from created_coupon_order);
select is((select count(*) from public.seller_coupon_redemptions where store_id='ca000000-0000-4000-8000-000000000010' and released_at is null),0::bigint,'cancellation releases redemption');
update public.seller_coupons set is_active=true,discount_value=10 where code='SURVEY10' and store_id='ca000000-0000-4000-8000-000000000010';
select lives_ok($$select public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','buyer@example.test','[{"line_subtotal":20}]','SURVEY10')$$,'canceled order permits later use');

select is(has_table_privilege('anon','public.seller_coupons','SELECT'),false,'anonymous users cannot enumerate coupons');
select is(has_table_privilege('anon','public.seller_coupon_redemptions','SELECT'),false,'redemption emails remain private');
select is(has_function_privilege('anon','public.calculate_order_discounts(uuid,text,jsonb,text,text,numeric,uuid,uuid)','EXECUTE'),false,'anonymous users cannot supply trusted pricing');
select is(has_function_privilege('authenticated','public.attach_order_discounts(uuid,jsonb)','EXECUTE'),false,'seller cannot forge saved discounts');

select is((public.preview_storefront_coupon('coupon-test','[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","quantity":3}]','SURVEY10','pickup@example.test')->>'net_subtotal')::numeric,50::numeric,'public checkout preview uses trusted prices');
create temp table pickup_coupon_order as select * from public.create_pay_at_pickup_order_v2(
 p_store_id=>'ca000000-0000-4000-8000-000000000010',p_idempotency_key=>'coupon-pickup-1',
 p_buyer_email=>'pickup@example.test',p_buyer_first_name=>'Pickup',p_buyer_last_name=>'Buyer',p_buyer_phone=>'5550100',
 p_delivery_address_line1=>'123 Farm Lane',p_delivery_city=>'Town',p_delivery_state=>'CO',p_delivery_postal_code=>'80000',
 p_items=>'[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","quantity":3}]',p_coupon_code=>'SURVEY10');
select is((select total_amount from pickup_coupon_order),50::numeric,'pay at pickup applies coupon');
select is((select sum(line_subtotal) from public.order_items where order_id=(select order_id from pickup_coupon_order)),50::numeric,'pickup line totals reconcile');
select throws_ok($$select public.seller_create_manual_order(
 p_store_id=>'ca000000-0000-4000-8000-000000000010',p_idempotency_key=>'coupon-failed',
 p_items=>'[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","quantity":1,"unit_price":20}]',
 p_customer_email=>'pickup@example.test',p_customer_first_name=>'Pickup',p_customer_last_name=>'Buyer',p_coupon_code=>'SURVEY10')$$,
 'P0001','This coupon has already been used or is reserved in another checkout for this email.','seller order cannot bypass storefront redemption');

insert into public.store_stripe_connections(store_id,stripe_livemode,stripe_account_id)
values('ca000000-0000-4000-8000-000000000010',false,'acct_CouponTest');
create temp table card_coupon_reservation as select * from public.reserve_storefront_card_checkout(
 p_reservation_id=>'ca000000-0000-4000-8000-000000000100',p_store_id=>'ca000000-0000-4000-8000-000000000010',
 p_stripe_livemode=>false,p_stripe_account_id=>'acct_CouponTest',p_stripe_checkout_session_id=>'cs_test_CouponHold',p_expires_at=>now()+interval '30 minutes',
 p_amount_total_cents=>1000,p_currency=>'usd',p_buyer_email=>'card@example.test',p_buyer_first_name=>'Card',p_buyer_last_name=>'Buyer',p_buyer_phone=>'5550100',
 p_delivery_address_line1=>'123 Farm Lane',p_delivery_city=>'Town',p_delivery_state=>'CO',p_delivery_postal_code=>'80000',
 p_items=>'[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","quantity":1}]',p_coupon_code=>'SURVEY10');
select throws_ok($$select public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','CARD@example.test','[{"line_subtotal":20}]','SURVEY10')$$,'P0001','This coupon has already been used or is reserved in another checkout for this email.','existing card reservation holds per-email use');
select lives_ok($$select public.settle_storefront_card_checkout('cs_test_CouponHold','acct_CouponTest',false,'expired',1000,'usd',null,null)$$,'expiration uses existing settlement lifecycle');
select lives_ok($$select public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','card@example.test','[{"line_subtotal":20}]','SURVEY10')$$,'expired checkout does not consume coupon');
drop table pg_temp.card_requested_items,pg_temp.card_locked_items;

select public.reserve_storefront_card_checkout(
 p_reservation_id=>'ca000000-0000-4000-8000-000000000101',p_store_id=>'ca000000-0000-4000-8000-000000000010',
 p_stripe_livemode=>false,p_stripe_account_id=>'acct_CouponTest',p_stripe_checkout_session_id=>'cs_test_CouponPaid',p_expires_at=>now()+interval '30 minutes',
 p_amount_total_cents=>1000,p_currency=>'usd',p_buyer_email=>'card@example.test',p_buyer_first_name=>'Card',p_buyer_last_name=>'Buyer',p_buyer_phone=>'5550100',
 p_delivery_address_line1=>'123 Farm Lane',p_delivery_city=>'Town',p_delivery_state=>'CO',p_delivery_postal_code=>'80000',
 p_items=>'[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","quantity":1}]',p_coupon_code=>'SURVEY10');
create temp table card_coupon_order as select * from public.settle_storefront_card_checkout('cs_test_CouponPaid','acct_CouponTest',false,'paid',1000,'usd','pi_CouponPaid',now());
select is((select total_amount from card_coupon_order),10::numeric,'paid card order uses reserved discounted total');
select is((select coupon_discount_amount from public.orders where id=(select order_id from card_coupon_order)),10::numeric,'card order retains coupon snapshot');
select lives_ok($$select public.settle_storefront_card_checkout('cs_test_CouponPaid','acct_CouponTest',false,'paid',1000,'usd','pi_CouponPaid',now())$$,'duplicate webhook is idempotent');
select is((select count(*) from public.seller_coupon_redemptions where customer_email='card@example.test' and released_at is null),1::bigint,'duplicate webhook consumes no second use');

insert into public.seller_coupons(store_id,code,discount_type,discount_value,scope,once_per_customer)
values('ca000000-0000-4000-8000-000000000010','FREE','percent',100,'order',true);
drop table pg_temp.card_requested_items,pg_temp.card_locked_items;
select public.reserve_storefront_card_checkout(
 p_reservation_id=>'ca000000-0000-4000-8000-000000000102',p_store_id=>'ca000000-0000-4000-8000-000000000010',
 p_stripe_livemode=>false,p_stripe_account_id=>'acct_CouponTest',p_stripe_checkout_session_id=>'cs_test_CouponFree',p_expires_at=>now()+interval '30 minutes',
 p_amount_total_cents=>0,p_currency=>'usd',p_buyer_email=>'free@example.test',p_buyer_first_name=>'Free',p_buyer_last_name=>'Buyer',p_buyer_phone=>'5550100',
 p_delivery_address_line1=>'123 Farm Lane',p_delivery_city=>'Town',p_delivery_state=>'CO',p_delivery_postal_code=>'80000',
 p_items=>'[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","quantity":1}]',p_coupon_code=>'FREE');
select lives_ok($$select public.settle_storefront_card_checkout('cs_test_CouponFree','acct_CouponTest',false,'paid',0,'usd',null,now())$$,'zero-balance checkout settles without a PaymentIntent');
select lives_ok($$select public.cancel_order((select order_id from public.stripe_checkout_sessions where stripe_checkout_session_id='cs_test_CouponFree'),'Test cancellation',true,false)$$,'zero-balance card order cancels through existing order lifecycle');
select is((select count(*) from public.seller_coupon_redemptions where customer_email='free@example.test' and released_at is null),0::bigint,'free cancellation releases coupon use');

update public.seller_coupons set is_active=false,discount_value=99 where code='SURVEY10' and store_id='ca000000-0000-4000-8000-000000000010';
create temp table edited_coupon_order as select * from public.seller_edit_order(
 p_order_id=>(select order_id from pickup_coupon_order),
 p_customer_id=>(select customer_id from pickup_coupon_order),p_customer_email=>'pickup@example.test',p_customer_first_name=>'Pickup',p_customer_last_name=>'Buyer',
 p_items=>(select jsonb_agg(jsonb_build_object('order_item_id',id,'item_type','equipment_inventory','item_id',equipment_inventory_item_id,'quantity',quantity,'unit_price',unit_price_snapshot)) from public.order_items where order_id=(select order_id from pickup_coupon_order)),
 p_coupon_code=>'SURVEY10',p_manual_discount_type=>'percent',p_manual_discount_value=>10);
select is((select revised_total_amount from edited_coupon_order),45::numeric,'editing retains original coupon then applies manual discount');
select is((select count(*) from public.seller_coupon_redemptions where customer_email='pickup@example.test' and released_at is null),1::bigint,'same-coupon edit retains one redemption');
select throws_ok($$select public.preview_storefront_coupon('coupon-test','[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","quantity":1}]','SURVEY10','new@example.test')$$,'P0001','Coupon is invalid, inactive, or expired.','inactive coupon rejects new orders');

insert into public.seller_coupons(store_id,code,discount_type,discount_value,scope,targets,minimum_purchase,expires_on)
values('ca000000-0000-4000-8000-000000000010','CATEGORY','percent',25,'categories','["equipment_inventory"]',40,null),
 ('ca000000-0000-4000-8000-000000000010','PRODUCT','fixed',10,'products','[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050"}]',0,null),
 ('ca000000-0000-4000-8000-000000000010','EXPIRED','fixed',10,'order','[]',0,current_date-1);
select is((public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','any@example.test','[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","line_subtotal":40},{"item_type":"custom","line_subtotal":20}]','CATEGORY')->>'coupon_amount')::numeric,10::numeric,'percentage applies only to eligible category');
select throws_ok($$select public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','any@example.test','[{"item_type":"equipment_inventory","line_subtotal":20},{"item_type":"custom","line_subtotal":100}]','CATEGORY')$$,'P0001','The eligible merchandise subtotal does not meet this coupon’s minimum purchase.','ineligible items do not satisfy minimum purchase');
select is((public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','any@example.test','[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","line_subtotal":20}]','PRODUCT')->>'coupon_amount')::numeric,10::numeric,'selected product qualifies');
select throws_ok($$select public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','any@example.test','[{"item_type":"custom","line_subtotal":20}]','PRODUCT')$$,'P0001','This coupon does not apply to the selected items.','unselected product is excluded');
select throws_ok($$select public.calculate_order_discounts('ca000000-0000-4000-8000-000000000010','any@example.test','[{"line_subtotal":20}]','EXPIRED')$$,'P0001','Coupon is invalid, inactive, or expired.','expired coupon is rejected');

insert into public.seller_breed_profiles(id,store_id,species_id,custom_breed_name,normalized_custom_breed_name,display_name)
select 'ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000010',id,'Coupon Layers','coupon layers','Coupon Layers' from public.species where slug='chicken';
create temp table coupon_chicks as select * from public.seller_create_listing_batch_with_inventory(
 'ca000000-0000-4000-8000-000000000010',(select id from public.species where slug='chicken'),'live_animals',current_date-1,current_date,5,
 '[{"seller_breed_profile_id":"ca000000-0000-4000-8000-000000000020","inventory_items":[{"client_row_token":"chicks","inventory_type":"straight_run","quantity_available":50}]}]',false,null,null,null,null,'active');
create temp table coupon_adults as select * from public.seller_create_listing_batch_with_inventory(
 'ca000000-0000-4000-8000-000000000010',(select id from public.species where slug='chicken'),'live_animals',current_date-200,current_date,25,
 '[{"seller_breed_profile_id":"ca000000-0000-4000-8000-000000000020","inventory_items":[{"client_row_token":"hens","inventory_type":"female","quantity_available":50},{"client_row_token":"roosters","inventory_type":"male","quantity_available":50}]}]',false,null,null,null,null,'active');
insert into public.seller_coupons(store_id,code,discount_type,discount_value,scope,targets,once_per_customer)
select 'ca000000-0000-4000-8000-000000000010','BIRDS10','fixed',10,'products',
 jsonb_agg(jsonb_build_object('item_type','listing_inventory','item_id',id)),true
from public.inventory_items where listing_batch_id=(select listing_batch_id from coupon_chicks)
 or (listing_batch_id=(select listing_batch_id from coupon_adults) and inventory_type='female');
select is((public.preview_storefront_coupon('coupon-test',
 (select jsonb_agg(jsonb_build_object('item_type','listing_inventory','item_id',id,'quantity',2)) from public.inventory_items where listing_batch_id=(select listing_batch_id from coupon_chicks)),
 'BIRDS10','survey@example.test')->>'net_subtotal')::numeric,0::numeric,'shared survey coupon covers ten dollars of eligible chicks');
select is((public.preview_storefront_coupon('coupon-test',
 (select jsonb_agg(jsonb_build_object('item_type','listing_inventory','item_id',id,'quantity',1)) from public.inventory_items where listing_batch_id=(select listing_batch_id from coupon_adults) and inventory_type='female'),
 'BIRDS10','survey@example.test')->>'net_subtotal')::numeric,15::numeric,'shared survey coupon discounts an eligible adult hen');
select throws_ok(format('select public.preview_storefront_coupon(%L,%L::jsonb,%L,%L)','coupon-test',
 (select jsonb_agg(jsonb_build_object('item_type','listing_inventory','item_id',id,'quantity',1)) from public.inventory_items where listing_batch_id=(select listing_batch_id from coupon_adults) and inventory_type='male'),
 'BIRDS10','survey@example.test'),'P0001','This coupon does not apply to the selected items.','unselected adult males are excluded');
insert into public.seller_coupons(store_id,code,discount_type,discount_value,scope,targets)
values('ca000000-0000-4000-8000-000000000010','BREED','percent',50,'breeds','["ca000000-0000-4000-8000-000000000020"]');
select is((public.preview_storefront_coupon('coupon-test',
 (select jsonb_agg(jsonb_build_object('item_type','listing_inventory','item_id',id,'quantity',1)) from public.inventory_items where listing_batch_id=(select listing_batch_id from coupon_adults) and inventory_type='female'),
 'BREED','survey@example.test')->>'coupon_amount')::numeric,12.5::numeric,'breed restriction resolves the real seller breed profile');

select lives_ok($$select public.attach_order_discounts((select order_id from card_coupon_order),'null'::jsonb)$$,'no-coupon reservations preserve ordinary card settlement');
select lives_ok($$select public.cancel_order((select order_id from pickup_coupon_order),'Test pickup cancellation',true,false)$$,'pickup cancellation uses existing inventory reconciliation');
select is((select count(*) from public.seller_coupon_redemptions where order_id=(select order_id from pickup_coupon_order) and released_at is null),0::bigint,'pickup cancellation releases its coupon exactly once');
select is((select total_amount from public.orders where id=(select order_id from pickup_coupon_order)),45::numeric,'cancellation preserves the historical discounted total');
select is(public.seller_get_order_restore_draft((select order_id from pickup_coupon_order))->'discount_snapshot'->'coupon'->>'code','SURVEY10','restore draft carries original code for fresh validation, not another redemption');
select is(public.coupon_line_eligible('{"scope":"categories","targets":["listing_inventory"]}','{"item_type":"listing_inventory","batch_type":"hatching_eggs"}'),false,'legacy hatching-egg listings are not live-bird category discounts');
select is(public.coupon_line_eligible('{"scope":"categories","targets":["hatching_egg_inventory"]}','{"item_type":"listing_inventory","batch_type":"hatching_eggs"}'),true,'legacy hatching-egg listings retain the correct coupon category');
insert into public.seller_coupons(store_id,code,discount_type,discount_value,once_per_customer)
values('ca000000-0000-4000-8000-000000000010','REPEAT','fixed',1,false);
select public.seller_create_manual_order(p_store_id=>'ca000000-0000-4000-8000-000000000010',p_idempotency_key=>'repeat-1',
 p_customer_email=>'repeat@example.test',p_customer_first_name=>'Repeat',p_customer_last_name=>'Buyer',
 p_items=>'[{"item_type":"custom","custom_item_name":"Test item","quantity":1,"unit_price":20}]',p_coupon_code=>'REPEAT');
select lives_ok($$select public.seller_create_manual_order(p_store_id=>'ca000000-0000-4000-8000-000000000010',p_idempotency_key=>'repeat-2',
 p_customer_email=>'REPEAT@example.test',p_customer_first_name=>'Repeat',p_customer_last_name=>'Buyer',
 p_items=>'[{"item_type":"custom","custom_item_name":"Test item","quantity":1,"unit_price":20}]',p_coupon_code=>'REPEAT')$$,'customer can reuse a coupon when one-use restriction is off');
select is((select count(*) from public.seller_coupon_redemptions where customer_email='repeat@example.test'),2::bigint,'unrestricted uses are still tracked per order');
update public.stores set storefront_visibility='embed_only',website_url='https://example.test' where id='ca000000-0000-4000-8000-000000000010';
select is((public.preview_storefront_coupon('coupon-test','[{"item_type":"equipment_inventory","item_id":"ca000000-0000-4000-8000-000000000050","quantity":1}]','PRODUCT','embed@example.test')->>'net_subtotal')::numeric,10::numeric,'embed-only storefront uses the same coupon checkout rules');
select * from finish();
rollback;
