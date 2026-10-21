begin;
set local search_path=public,extensions;
set local "request.jwt.claim.role"='service_role';

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('cb000000-0000-4000-8000-000000000001','group-owner@example.test','{}','{}');
insert into public.stores(id,owner_user_id,store_name,store_slug,store_status,storefront_mode,storefront_enabled,show_public_phone,public_phone)
values('cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000001','Group Test','group-test','live','hosted',true,true,'555-0100');
insert into public.seller_billing_status(store_id,requested_plan_key,requested_billing_cadence,plan_key,billing_plan,subscription_status,trial_started_at,trial_ends_at,current_period_start,current_period_end,storefront_access_until,billing_state_authority)
values('cb000000-0000-4000-8000-000000000010','full_flock','monthly','full_flock','monthly','trialing',now(),now()+interval '7 days',now(),now()+interval '7 days',now()+interval '7 days','trial');
insert into public.seller_breed_profiles(id,store_id,species_id,custom_breed_name,normalized_custom_breed_name,display_name)
select 'cb000000-0000-4000-8000-000000000020','cb000000-0000-4000-8000-000000000010',id,'Group Layers','group layers','Group Layers'
from public.species where slug='chicken';
select set_config('request.jwt.claim.sub','cb000000-0000-4000-8000-000000000001',true);

create temp table group_batch as select * from public.seller_create_listing_batch_with_inventory(
  'cb000000-0000-4000-8000-000000000010',(select id from public.species where slug='chicken'),
  'live_animals',current_date-175,current_date,16,
  '[{"seller_breed_profile_id":"cb000000-0000-4000-8000-000000000020","inventory_items":[{"client_row_token":"barn-1","inventory_type":"female","quantity_available":46,"sort_order":0,"barn_location":"Barn 1","breeding_history":"never_bred","feather_condition":"excellent"},{"client_row_token":"barn-2","inventory_type":"female","quantity_available":52,"sort_order":1,"barn_location":"Barn 2","breeding_history":"never_bred","feather_condition":"excellent"}]}]',
  false,null,null,null,null,'active');

create temp table group_sources as
select id,barn_location,sort_order from public.inventory_items
where listing_batch_id=(select listing_batch_id from group_batch);

do $$ begin
  if (select count(*) from group_sources) <> 2 then raise exception 'Expected two private barn records'; end if;
  if (select sum(quantity_available) from public.inventory_items where id in (select id from group_sources)) <> 98 then
    raise exception 'Expected 98 available birds';
  end if;
  if (select count(*) from public.public_storefront_inventory where inventory_item_id in (select id from group_sources)) <> 2 then
    raise exception 'Public projection must retain two sources';
  end if;
end $$;

create temp table group_request as
select jsonb_build_array(jsonb_build_object('item_type','listing_inventory_group',
  'item_id',(select id from group_sources order by sort_order limit 1),'quantity',60)) items;

insert into public.seller_coupons(store_id,code,discount_type,discount_value,scope,minimum_purchase)
values
  ('cb000000-0000-4000-8000-000000000010','GROUPFIX','fixed',10,'order',900),
  ('cb000000-0000-4000-8000-000000000010','GROUPPCT','percent',10,'order',900),
  ('cb000000-0000-4000-8000-000000000010','GROUPMIN','fixed',5,'order',1000);

do $$ declare v_lines jsonb; begin
  select public.expand_storefront_live_bird_groups('cb000000-0000-4000-8000-000000000010',items,false)
    into v_lines from group_request;
  if jsonb_array_length(v_lines) <> 2
    or (v_lines->0->>'quantity')::integer <> 46
    or (v_lines->1->>'quantity')::integer <> 14
    or (v_lines->0->>'item_id')::uuid <> (select id from group_sources where barn_location='Barn 1')
    or (v_lines->1->>'item_id')::uuid <> (select id from group_sources where barn_location='Barn 2') then
    raise exception 'Grouped allocation did not exhaust Barn 1 first: %',v_lines;
  end if;
end $$;

do $$ declare v_lines jsonb; begin
  select public.expand_storefront_live_bird_groups(
    'cb000000-0000-4000-8000-000000000010',
    jsonb_build_array(jsonb_build_object('item_type','listing_inventory_group',
      'item_id',(select id from group_sources order by sort_order limit 1),'quantity',20)),true)
    into v_lines;
  if jsonb_array_length(v_lines) <> 1
    or (v_lines->0->>'quantity')::integer <> 20
    or (v_lines->0->>'item_id')::uuid <> (select id from group_sources where barn_location='Barn 1') then
    raise exception 'Single-barn allocation is incorrect';
  end if;
  begin
    update public.inventory_items set quantity_available=10
    where id=(select id from group_sources where barn_location='Barn 2');
    perform public.expand_storefront_live_bird_groups(
      'cb000000-0000-4000-8000-000000000010',(select items from group_request),true);
    raise exception 'Stale quantity should have been rejected';
  exception when others then
    if sqlerrm='Stale quantity should have been rejected'
      or sqlerrm<>'Insufficient inventory quantity available.' then raise; end if;
  end;
end $$;

do $$ declare v_fixed jsonb; v_percent jsonb; begin
  select public.preview_storefront_coupon('group-test',items,'GROUPFIX','fixed@example.test')
    into v_fixed from group_request;
  select public.preview_storefront_coupon('group-test',items,'GROUPPCT','percent@example.test')
    into v_percent from group_request;
  if (v_fixed->>'coupon_amount')::numeric <> 10
    or (v_fixed->>'net_subtotal')::numeric <> 950
    or (v_percent->>'coupon_amount')::numeric <> 96
    or (v_percent->>'net_subtotal')::numeric <> 864
    or jsonb_array_length(v_fixed->'lines') <> 2 then
    raise exception 'Grouped fixed or percentage coupon preview is incorrect';
  end if;
  begin
    perform public.preview_storefront_coupon('group-test',(select items from group_request),
      'GROUPMIN','minimum@example.test');
    raise exception 'Minimum-purchase coupon should have been rejected';
  exception when others then
    if sqlerrm = 'Minimum-purchase coupon should have been rejected' then raise; end if;
  end;
end $$;

do $$ declare v_summary record; begin
  select * into v_summary from public.get_public_checkout_summary('group-test',(select items from group_request));
  if not v_summary.is_checkout_available or v_summary.total_quantity <> 60
    or v_summary.subtotal_amount <> 960 or jsonb_array_length(v_summary.items) <> 2 then
    raise exception 'Grouped checkout summary is incorrect';
  end if;
end $$;

update public.stores set minimum_started_adult_bird_order_quantity=10
where id='cb000000-0000-4000-8000-000000000010';
do $$ declare v_summary record; begin
  select * into v_summary from public.get_public_checkout_summary('group-test',
    jsonb_build_array(jsonb_build_object('item_type','listing_inventory_group',
      'item_id',(select id from group_sources order by sort_order limit 1),'quantity',5)));
  if v_summary.is_checkout_available or v_summary.message not like '%at least 10%' then
    raise exception 'Grouped summary bypassed the minimum bird order';
  end if;
  begin
    perform public.create_pay_at_pickup_order_v2(
      p_store_id=>'cb000000-0000-4000-8000-000000000010',
      p_idempotency_key=>'group-below-minimum',p_buyer_email=>'minimum@example.test',
      p_buyer_first_name=>'Minimum',p_buyer_last_name=>'Test',p_buyer_phone=>'5550100',
      p_delivery_address_line1=>'123 Farm Lane',p_delivery_city=>'Town',
      p_delivery_state=>'CO',p_delivery_postal_code=>'80000',
      p_items=>jsonb_build_array(jsonb_build_object('item_type','listing_inventory_group',
        'item_id',(select id from group_sources order by sort_order limit 1),'quantity',5)));
    raise exception 'Grouped order bypassed the minimum bird order';
  exception when others then
    if sqlerrm='Grouped order bypassed the minimum bird order'
      or sqlerrm not like '%at least 10%' then raise; end if;
  end;
end $$;
update public.stores set minimum_started_adult_bird_order_quantity=0
where id='cb000000-0000-4000-8000-000000000010';

create temp table pickup_order as select * from public.create_pay_at_pickup_order_v2(
  p_store_id=>'cb000000-0000-4000-8000-000000000010',p_idempotency_key=>'group-pickup-1',
  p_buyer_email=>'group-buyer@example.test',p_buyer_first_name=>'Buyer',p_buyer_last_name=>'Test',p_buyer_phone=>'5550100',
  p_delivery_address_line1=>'123 Farm Lane',p_delivery_city=>'Town',p_delivery_state=>'CO',p_delivery_postal_code=>'80000',
  p_items=>(select items from group_request),p_coupon_code=>'GROUPFIX');

do $$ begin
  if (select count(*) from public.order_items where order_id=(select order_id from pickup_order)) <> 2
    or (select quantity from public.order_items where order_id=(select order_id from pickup_order) and barn_location='Barn 1') <> 46
    or (select quantity from public.order_items where order_id=(select order_id from pickup_order) and barn_location='Barn 2') <> 14
    or (select sum(quantity_available) from public.inventory_items where id in (select id from group_sources)) <> 38
    or (select total_amount from pickup_order) <> 950 then
    raise exception 'Pay at Pickup barn allocations or deductions are incorrect';
  end if;
end $$;

-- The production retry is a new transaction; checkout temp tables drop at commit.
commit;
begin;
set local search_path=public,extensions;
set local "request.jwt.claim.role"='service_role';
select set_config('request.jwt.claim.sub','cb000000-0000-4000-8000-000000000001',true);
create temp table replay_order as select * from public.create_pay_at_pickup_order_v2(
  p_store_id=>'cb000000-0000-4000-8000-000000000010',p_idempotency_key=>'group-pickup-1',
  p_buyer_email=>'group-buyer@example.test',p_buyer_first_name=>'Buyer',p_buyer_last_name=>'Test',p_buyer_phone=>'5550100',
  p_delivery_address_line1=>'123 Farm Lane',p_delivery_city=>'Town',p_delivery_state=>'CO',p_delivery_postal_code=>'80000',
  p_items=>(select items from group_request),p_coupon_code=>'GROUPFIX');
do $$ begin
  if (select order_id from replay_order) <> (select order_id from pickup_order) then
    raise exception 'Grouped Pay at Pickup retry was not idempotent';
  end if;
end $$;

-- A fresh group exercises card reservation and release independently.
create temp table card_batch as select * from public.seller_create_listing_batch_with_inventory(
  'cb000000-0000-4000-8000-000000000010',(select id from public.species where slug='chicken'),
  'live_animals',current_date-174,current_date,16,
  '[{"seller_breed_profile_id":"cb000000-0000-4000-8000-000000000020","inventory_items":[{"client_row_token":"card-1","inventory_type":"female","quantity_available":46,"sort_order":0,"barn_location":"Card Barn 1"},{"client_row_token":"card-2","inventory_type":"female","quantity_available":52,"sort_order":1,"barn_location":"Card Barn 2"}]}]',
  false,null,null,null,null,'active');
insert into public.store_stripe_connections(store_id,stripe_livemode,stripe_account_id)
values('cb000000-0000-4000-8000-000000000010',false,'acct_GroupTest');
create temp table card_request as
select jsonb_build_array(jsonb_build_object('item_type','listing_inventory_group',
  'item_id',(select id from public.inventory_items where listing_batch_id=(select listing_batch_id from card_batch) order by sort_order limit 1),
  'quantity',60)) items;
select public.reserve_storefront_card_checkout(
  p_reservation_id=>'cb000000-0000-4000-8000-000000000100',
  p_store_id=>'cb000000-0000-4000-8000-000000000010',p_stripe_livemode=>false,
  p_stripe_account_id=>'acct_GroupTest',p_stripe_checkout_session_id=>'cs_test_GroupHold',
  p_expires_at=>now()+interval '30 minutes',p_amount_total_cents=>86400,p_currency=>'usd',
  p_buyer_email=>'card@example.test',p_buyer_first_name=>'Card',p_buyer_last_name=>'Buyer',p_buyer_phone=>'5550100',
  p_delivery_address_line1=>'123 Farm Lane',p_delivery_city=>'Town',p_delivery_state=>'CO',p_delivery_postal_code=>'80000',
  p_items=>(select items from card_request),p_coupon_code=>'GROUPPCT');

do $$ begin
  if (select quantity_available from public.inventory_items where listing_batch_id=(select listing_batch_id from card_batch) and sort_order=0) <> 0
    or (select quantity_available from public.inventory_items where listing_batch_id=(select listing_batch_id from card_batch) and sort_order=1) <> 38 then
    raise exception 'Card reservation did not deduct in barn priority';
  end if;
end $$;
select public.settle_storefront_card_checkout('cs_test_GroupHold','acct_GroupTest',false,'expired',86400,'usd',null,null);
do $$ begin
  if (select sum(quantity_available) from public.inventory_items where listing_batch_id=(select listing_batch_id from card_batch)) <> 98 then
    raise exception 'Expired reservation did not release both barn records';
  end if;
end $$;

rollback;
