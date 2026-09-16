begin;

select plan(45);
set local "request.jwt.claim.role" = 'service_role';

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  'd3000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'phase3-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode, storefront_enabled
) values (
  'd3000000-0000-4000-8000-000000000010', 'd3000000-0000-4000-8000-000000000001',
  'Phase Three Test', 'phase-three-test', 'live', 'hosted', true
);

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key, billing_plan,
  subscription_status, trial_started_at, trial_ends_at, current_period_start,
  current_period_end, storefront_access_until, billing_state_authority
) values (
  'd3000000-0000-4000-8000-000000000010', 'full_flock', 'monthly', 'full_flock', 'monthly',
  'trialing', now(), now()+interval '7 days', now(), now()+interval '7 days',
  now()+interval '7 days', 'trial'
);

insert into public.store_stripe_connections(store_id,stripe_livemode,stripe_account_id)
values('d3000000-0000-4000-8000-000000000010',false,'acct_PhaseThree');

insert into public.equipment_inventory_items(
  id,store_id,item_name,category,condition,quantity_available,price,
  visibility_status,moderation_status,available_date
) values
  ('d3000000-0000-4000-8000-000000000050','d3000000-0000-4000-8000-000000000010',
   'Phase Three Feeder','Feeders & Waterers','Good',2,25.00,'active','normal',current_date),
  ('d3000000-0000-4000-8000-000000000051','d3000000-0000-4000-8000-000000000010',
   'Fulfilled Feeder','Feeders & Waterers','Good',2,25.00,'active','normal',current_date);

create temporary table phase3_reservation as
select * from public.reserve_storefront_card_checkout(
  p_reservation_id => 'd3000000-0000-4000-8000-000000000100',
  p_store_id => 'd3000000-0000-4000-8000-000000000010',
  p_stripe_livemode => false,
  p_stripe_account_id => 'acct_PhaseThree',
  p_stripe_checkout_session_id => 'cs_test_PhaseThreeFull',
  p_expires_at => now()+interval '30 minutes',
  p_amount_total_cents => 5000, p_currency => 'usd',
  p_buyer_email => 'buyer@example.test', p_buyer_first_name => 'Full',
  p_buyer_last_name => 'Cancel', p_buyer_phone => '555-0300',
  p_items => '[{"item_type":"equipment_inventory","item_id":"d3000000-0000-4000-8000-000000000050","quantity":2}]'::jsonb,
  p_delivery_address_line1 => '3 Test Lane', p_delivery_city => 'Testville',
  p_delivery_state => 'CO', p_delivery_postal_code => '80000'
);
create temporary table phase3_settlement as
select * from public.settle_storefront_card_checkout(
  'cs_test_PhaseThreeFull','acct_PhaseThree',false,'paid',5000,'usd','pi_PhaseThreeFull',now()
);

select ok(
  has_function_privilege('service_role','public.prepare_stripe_full_cancellation(uuid,uuid,text,boolean)','execute')
  and not has_function_privilege('authenticated','public.prepare_stripe_full_cancellation(uuid,uuid,text,boolean)','execute'),
  'full cancellation preparation is service-only'
);
select ok(
  has_function_privilege('service_role','public.record_stripe_full_cancellation_refund_response(uuid,text,text,bigint,text,text,text,boolean,jsonb,timestamptz)','execute')
  and not has_function_privilege('authenticated','public.record_stripe_full_cancellation_refund_response(uuid,text,text,bigint,text,text,text,boolean,jsonb,timestamptz)','execute'),
  'Stripe API response reconciliation is service-only'
);
select ok(
  has_function_privilege('service_role','public.finalize_stripe_full_cancellation(uuid,uuid,text,boolean)','execute')
  and not has_function_privilege('authenticated','public.finalize_stripe_full_cancellation(uuid,uuid,text,boolean)','execute'),
  'paid cancellation finalization is service-only'
);

set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'd3000000-0000-4000-8000-000000000001';
select throws_ok(
  format('select * from public.cancel_order(%L::uuid,null,true,false)',
    (select order_id from phase3_settlement)),
  'Paid online orders cannot be canceled until Stripe refunds are supported.',
  'the ordinary authenticated cancellation RPC still blocks paid Stripe orders'
);
set local "request.jwt.claim.role" = 'service_role';

create temporary table phase3_action as
select * from public.prepare_stripe_full_cancellation(
  (select order_id from phase3_settlement),
  'd3000000-0000-4000-8000-000000000001',
  'Seller canceled', true
);
select is((select refund_status from phase3_action),'pending','preparation creates a pending refund action');
select is((select refund_amount_cents from phase3_action),5000::bigint,'full cancellation uses the full paid amount');
select matches((select idempotency_key from phase3_action),'^ff-full-cancel-v1:','the Stripe idempotency key is server-generated and versioned');
select is(
  (select stripe_metadata->>'ff_refund_action_id' from phase3_action),
  (select refund_action_id::text from phase3_action),
  'Stripe metadata binds the real refund to the prepared action'
);
select is(
  (select metadata->>'restoration_intent' from public.order_refunds where id=(select refund_action_id from phase3_action)),
  'all_eligible_remaining_inventory',
  'the action records the full restoration intent'
);
select is(
  (select order_status||':'||payment_status from public.orders where id=(select order_id from phase3_settlement)),
  'open:paid',
  'preparation leaves the order active and paid'
);
select is((select quantity_available from public.equipment_inventory_items where id='d3000000-0000-4000-8000-000000000050'),0,'preparation does not restore inventory');

create temporary table phase3_duplicate_action as
select * from public.prepare_stripe_full_cancellation(
  (select order_id from phase3_settlement),
  'd3000000-0000-4000-8000-000000000001',
  'Seller canceled', true
);
select is((select refund_action_id from phase3_duplicate_action),(select refund_action_id from phase3_action),'duplicate preparation reuses one action');
select is((select idempotency_key from phase3_duplicate_action),(select idempotency_key from phase3_action),'duplicate preparation reuses the deterministic Stripe key');
select is((select count(*)::integer from public.order_refunds where order_id=(select order_id from phase3_settlement)),1,'duplicate preparation creates no second refund ledger row');

select throws_ok(
  format(
    'select * from public.record_stripe_full_cancellation_refund_response(%L::uuid,%L,%L,5000,%L,%L,%L,false,%L::jsonb,now())',
    (select refund_action_id from phase3_action), 're_MetadataOnlyFake', 'succeeded', 'usd',
    'pi_PhaseThreeFull', 'acct_PhaseThree',
    jsonb_build_object(
      'ff_cancellation_schema_version','ff_connect_cancellation_v1',
      'ff_refund_action_id',(select refund_action_id::text from phase3_action),
      'ff_order_id',(select order_id::text from phase3_settlement),
      'ff_request_hash','wrong-hash','ff_cancellation_type','full'
    )::text
  ),
  'Stripe refund response does not match the cancellation action.',
  'editable Stripe metadata without the immutable request hash cannot bind a refund'
);

create temporary table phase3_refund_result as
select * from public.record_stripe_full_cancellation_refund_response(
  (select refund_action_id from phase3_action), 're_PhaseThreeFull', 'succeeded',
  5000, 'usd', 'pi_PhaseThreeFull', 'acct_PhaseThree', false,
  (select stripe_metadata from phase3_action), now()
);
select is((select refund_status from phase3_refund_result),'succeeded','the real successful Stripe response is recorded');
select is(
  (select metadata->>'origin_proof' from public.order_refunds where id=(select refund_action_id from phase3_action)),
  'stripe_api_response',
  'the trusted direct provider response records API-response proof'
);
select is(
  (select order_status||':'||payment_status from public.orders where id=(select order_id from phase3_settlement)),
  'open:refunded',
  'money state updates before order cancellation'
);
select is(
  (select canceled_quantity::text||':'||restored_quantity::text from public.order_items where order_id=(select order_id from phase3_settlement)),
  '0:0',
  'recording the refund does not cancel items or restore inventory'
);
select is((select quantity_available from public.equipment_inventory_items where id='d3000000-0000-4000-8000-000000000050'),0,'recording the refund leaves inventory unchanged');

create temporary table phase3_webhook_before as
select * from public.record_stripe_connect_refund_event(
  'evt_PhaseThreeBeforeFinalization', 'refund.updated', 're_PhaseThreeFull',
  'succeeded', 5000, 'usd', 'pi_PhaseThreeFull', 'acct_PhaseThree', false,
  (select stripe_metadata from phase3_action), null, now()
);
select is((select origin_classification from phase3_webhook_before),'flockfront','a webhook before finalization preserves trusted API-response origin proof');
select is(
  (select metadata->>'origin_proof' from public.order_refunds where id=(select refund_action_id from phase3_action)),
  'stripe_api_response',
  'an update webhook cannot downgrade API-response proof'
);
create temporary table phase3_webhook_duplicate as
select * from public.record_stripe_connect_refund_event(
  'evt_PhaseThreeBeforeFinalization', 'refund.updated', 're_PhaseThreeFull',
  'succeeded', 5000, 'usd', 'pi_PhaseThreeFull', 'acct_PhaseThree', false,
  (select stripe_metadata from phase3_action), null, now()
);
select is((select was_duplicate from phase3_webhook_duplicate),true,'duplicate phase 3 refund webhooks remain idempotent');
select is(
  (select order_status||':'||canceled_quantity::text||':'||restored_quantity::text
   from public.orders join public.order_items on order_items.order_id=orders.id
   where orders.id=(select order_id from phase3_settlement)),
  'open:0:0',
  'webhooks before finalization never cancel the order or change inventory facts'
);

select throws_ok(
  format('select * from public.finalize_stripe_full_cancellation(%L::uuid,%L::uuid,null,false)',
    (select refund_action_id from phase3_action), 'd3000000-0000-4000-8000-000000000099'),
  'Order is not available.',
  'a database finalization failure leaves the successful refund action resumable'
);
select is(
  (select order_status||':'||payment_status from public.orders where id=(select order_id from phase3_settlement)),
  'open:refunded',
  'failed finalization leaves the refunded order active until recovery'
);
select is((select count(*)::integer from public.order_refunds where provider_refund_id='re_PhaseThreeFull'),1,'recovery retains one real Stripe refund and never needs a second action');

create temporary table phase3_finalized as
select * from public.finalize_stripe_full_cancellation(
  (select refund_action_id from phase3_action),
  'd3000000-0000-4000-8000-000000000001',
  'Seller canceled', true
);
select is((select order_status||':'||payment_status from phase3_finalized),'canceled:refunded','successful finalization cancels the order and preserves refunded payment state');
select is((select buyer_notification_queued from phase3_finalized),true,'the existing buyer cancellation email option is honored');
select is(
  (select count(*)::integer from public.email_notifications
   where order_id=(select order_id from phase3_settlement)
     and notification_type = 'buyer_order_canceled'),
  1,
  'the buyer cancellation notice uses the existing queue exactly once'
);
select is(
  (select fulfilled_quantity::text||':'||canceled_quantity::text||':'||restored_quantity::text from public.order_items where order_id=(select order_id from phase3_settlement)),
  '0:2:2',
  'finalization cancels active quantity and records actual restoration independently'
);
select is((select quantity_available from public.equipment_inventory_items where id='d3000000-0000-4000-8000-000000000050'),2,'eligible inventory is restored exactly once');
select is((select count(*)::integer from public.order_events where order_id=(select order_id from phase3_settlement) and event_type='order_canceled'),1,'the normal cancellation audit event is recorded once');
select is(
  (select metadata->>'workflow_state' from public.order_refunds where id=(select refund_action_id from phase3_action)),
  'cancellation_applied',
  'the refund action records successful cancellation finalization'
);

select * from public.finalize_stripe_full_cancellation(
  (select refund_action_id from phase3_action),
  'd3000000-0000-4000-8000-000000000001',
  'Seller canceled', false
);
select is((select quantity_available from public.equipment_inventory_items where id='d3000000-0000-4000-8000-000000000050'),2,'repeated finalization does not restore inventory twice');
select is((select count(*)::integer from public.order_events where order_id=(select order_id from phase3_settlement) and event_type='order_canceled'),1,'repeated finalization does not duplicate the cancellation event');

create temporary table phase3_webhook_after as
select * from public.record_stripe_connect_refund_event(
  'evt_PhaseThreeAfterFinalization', 'refund.created', 're_PhaseThreeFull',
  'succeeded', 5000, 'usd', 'pi_PhaseThreeFull', 'acct_PhaseThree', false,
  (select stripe_metadata from phase3_action),
  (select idempotency_key from phase3_action), now()
);
select is((select origin_classification from phase3_webhook_after),'flockfront','the signed created webhook after finalization remains FlockFront-originated');
select is(
  (select order_status||':'||payment_status||':'||order_items.canceled_quantity::text||':'||order_items.restored_quantity::text||':'||equipment_inventory_items.quantity_available::text
   from public.orders
   join public.order_items on order_items.order_id=orders.id
   join public.equipment_inventory_items on equipment_inventory_items.id=order_items.equipment_inventory_item_id
   where orders.id=(select order_id from phase3_settlement)),
  'canceled:refunded:2:2:2',
  'webhooks after finalization do not repeat cancellation or restoration'
);

drop table if exists pg_temp.card_requested_items;
drop table if exists pg_temp.card_locked_items;
create temporary table fulfilled_reservation as
select * from public.reserve_storefront_card_checkout(
  p_reservation_id => 'd3000000-0000-4000-8000-000000000101',
  p_store_id => 'd3000000-0000-4000-8000-000000000010', p_stripe_livemode => false,
  p_stripe_account_id => 'acct_PhaseThree', p_stripe_checkout_session_id => 'cs_test_PhaseThreeFulfilled',
  p_expires_at => now()+interval '30 minutes', p_amount_total_cents => 5000, p_currency => 'usd',
  p_buyer_email => 'fulfilled@example.test', p_buyer_first_name => 'Already', p_buyer_last_name => 'Fulfilled',
  p_buyer_phone => '555-0301',
  p_items => '[{"item_type":"equipment_inventory","item_id":"d3000000-0000-4000-8000-000000000051","quantity":2}]'::jsonb,
  p_delivery_address_line1 => '4 Test Lane', p_delivery_city => 'Testville',
  p_delivery_state => 'CO', p_delivery_postal_code => '80000'
);
create temporary table fulfilled_settlement as
select * from public.settle_storefront_card_checkout(
  'cs_test_PhaseThreeFulfilled','acct_PhaseThree',false,'paid',5000,'usd','pi_PhaseThreeFulfilled',now()
);
create temporary table failed_action as
select * from public.prepare_stripe_full_cancellation(
  (select order_id from fulfilled_settlement),
  'd3000000-0000-4000-8000-000000000001', null, false
);
select * from public.record_stripe_full_cancellation_refund_response(
  (select refund_action_id from failed_action), 're_PhaseThreeFailed', 'failed',
  5000, 'usd', 'pi_PhaseThreeFulfilled', 'acct_PhaseThree', false,
  (select stripe_metadata from failed_action), now()
);
select is(
  (select order_status||':'||payment_status from public.orders where id=(select order_id from fulfilled_settlement)),
  'open:paid',
  'a failed Stripe refund leaves the order active and paid'
);
select is((select quantity_available from public.equipment_inventory_items where id='d3000000-0000-4000-8000-000000000051'),0,'a failed Stripe refund leaves inventory unchanged');
select throws_ok(
  format('select * from public.finalize_stripe_full_cancellation(%L::uuid,%L::uuid,null,false)',
    (select refund_action_id from failed_action), 'd3000000-0000-4000-8000-000000000001'),
  'A proven successful FlockFront refund is required.',
  'a failed Stripe refund cannot finalize cancellation'
);
update public.order_items set fulfilled_quantity=1
where order_id=(select order_id from fulfilled_settlement);
select throws_ok(
  format('select * from public.prepare_stripe_full_cancellation(%L::uuid,%L::uuid,null,false)',
    (select order_id from fulfilled_settlement), 'd3000000-0000-4000-8000-000000000001'),
  'Orders with fulfilled items require support.',
  'any fulfilled quantity blocks preparation before a Stripe refund action exists'
);
select is((select count(*)::integer from public.order_refunds where order_id=(select order_id from fulfilled_settlement)),1,'the fulfilled-order block creates no additional refund action');
select is((select quantity_available from public.equipment_inventory_items where id='d3000000-0000-4000-8000-000000000051'),0,'the fulfilled-order block leaves inventory unchanged');
select is((select canceled_quantity from public.order_items where order_id=(select order_id from fulfilled_settlement)),0,'failed and fulfilled blocks never set canceled quantity');

select finish();
rollback;
