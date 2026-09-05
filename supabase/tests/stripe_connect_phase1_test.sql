begin;

select plan(59);

select has_table('public', 'store_stripe_connections', 'private connected-account table exists');
select has_table('public', 'storefront_card_checkout_reservations', 'private card reservation table exists');
select has_function('public', 'reserve_storefront_card_checkout', 'reservation RPC exists');
select has_function('public', 'settle_storefront_card_checkout', 'settlement RPC exists');

select columns_are(
  'public', 'store_stripe_connections',
  array['store_id','stripe_livemode','stripe_account_id'],
  'connected-account table stores only the pilot binding'
);

select is(
  (select count(*)::integer from information_schema.role_table_grants
   where table_schema='public' and table_name='store_stripe_connections' and grantee in ('anon','authenticated')),
  0,
  'browser roles have no connected-account table grants'
);

select is(
  (select count(*)::integer from information_schema.role_table_grants
   where table_schema='public' and table_name='storefront_card_checkout_reservations' and grantee in ('anon','authenticated')),
  0,
  'browser roles have no reservation table grants'
);

select is(
  has_function_privilege('anon', 'public.reserve_storefront_card_checkout(uuid,uuid,boolean,text,text,timestamptz,bigint,text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,inet,text,uuid,text,uuid)', 'EXECUTE'),
  false,
  'anon cannot reserve inventory'
);
select is(
  has_function_privilege('authenticated', 'public.reserve_storefront_card_checkout(uuid,uuid,boolean,text,text,timestamptz,bigint,text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,inet,text,uuid,text,uuid)', 'EXECUTE'),
  false,
  'authenticated users cannot reserve inventory directly'
);
select is(
  has_function_privilege('service_role', 'public.reserve_storefront_card_checkout(uuid,uuid,boolean,text,text,timestamptz,bigint,text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,inet,text,uuid,text,uuid)', 'EXECUTE'),
  true,
  'service role can reserve inventory'
);
select is(
  has_function_privilege('anon', 'public.settle_storefront_card_checkout(text,text,boolean,text,bigint,text,text,timestamptz)', 'EXECUTE'),
  false,
  'anon cannot settle card checkout'
);
select is(
  has_function_privilege('authenticated', 'public.settle_storefront_card_checkout(text,text,boolean,text,bigint,text,text,timestamptz)', 'EXECUTE'),
  false,
  'authenticated users cannot settle card checkout directly'
);
select is(
  has_function_privilege('service_role', 'public.settle_storefront_card_checkout(text,text,boolean,text,bigint,text,text,timestamptz)', 'EXECUTE'),
  true,
  'service role can settle card checkout'
);

set local "request.jwt.claim.role" = 'service_role';

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  'd1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'connect-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode, storefront_enabled
) values (
  'd1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000001',
  'Connect Reservation Test', 'connect-reservation-test', 'live', 'hosted', true
);

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key, billing_plan,
  subscription_status, trial_started_at, trial_ends_at, current_period_start,
  current_period_end, storefront_access_until, billing_state_authority
) values (
  'd1000000-0000-4000-8000-000000000010', 'full_flock', 'monthly', 'full_flock', 'monthly',
  'trialing', now(), now()+interval '7 days', now(), now()+interval '7 days', now()+interval '7 days', 'trial'
);

insert into public.store_stripe_connections(store_id,stripe_livemode,stripe_account_id)
values('d1000000-0000-4000-8000-000000000010',false,'acct_TestConnectReservation');

insert into public.equipment_inventory_items(
  id,store_id,item_name,category,condition,quantity_available,price,visibility_status,moderation_status,available_date
) values (
  'd1000000-0000-4000-8000-000000000050','d1000000-0000-4000-8000-000000000010',
  'Connect Test Feeder','Feeders & Waterers','Good',2,25.00,'active','normal',current_date
);

create temporary table connect_reservation_result as
select * from public.reserve_storefront_card_checkout(
  p_reservation_id => 'd1000000-0000-4000-8000-000000000100',
  p_store_id => 'd1000000-0000-4000-8000-000000000010',
  p_stripe_livemode => false,
  p_stripe_account_id => 'acct_TestConnectReservation',
  p_stripe_checkout_session_id => 'cs_test_ConnectReservationOne',
  p_expires_at => now()+interval '30 minutes',
  p_amount_total_cents => 5000,
  p_currency => 'usd',
  p_buyer_email => 'buyer@example.test',
  p_buyer_first_name => 'Card',
  p_buyer_last_name => 'Buyer',
  p_buyer_phone => '555-0100',
  p_items => jsonb_build_array(jsonb_build_object(
    'item_type','equipment_inventory','item_id','d1000000-0000-4000-8000-000000000050','quantity',2
  )),
  p_delivery_address_line1 => '1 Test Lane',
  p_delivery_city => 'Testville',
  p_delivery_state => 'CO',
  p_delivery_postal_code => '80000'
);

select is((select count(*)::integer from connect_reservation_result),1,'reservation succeeds once');
select is((select quantity_available from public.equipment_inventory_items where id='d1000000-0000-4000-8000-000000000050'),0,'reservation atomically decrements inventory');
select is((select count(*)::integer from public.storefront_card_checkout_reservations where id='d1000000-0000-4000-8000-000000000100'),1,'reservation snapshot is persisted');

drop table pg_temp.card_requested_items;
drop table pg_temp.card_locked_items;

select throws_ok(
  $$select * from public.reserve_storefront_card_checkout(
    p_reservation_id => 'd1000000-0000-4000-8000-000000000101',
    p_store_id => 'd1000000-0000-4000-8000-000000000010', p_stripe_livemode => false,
    p_stripe_account_id => 'acct_TestConnectReservation', p_stripe_checkout_session_id => 'cs_test_ConnectReservationTwo',
    p_expires_at => now()+interval '30 minutes', p_amount_total_cents => 2500, p_currency => 'usd',
    p_buyer_email => 'other@example.test', p_buyer_first_name => 'Other', p_buyer_last_name => 'Buyer', p_buyer_phone => '555-0101',
    p_items => '[{"item_type":"equipment_inventory","item_id":"d1000000-0000-4000-8000-000000000050","quantity":1}]'::jsonb,
    p_delivery_address_line1 => '2 Test Lane', p_delivery_city => 'Testville', p_delivery_state => 'CO', p_delivery_postal_code => '80000'
  )$$,
  'P0001', 'Insufficient inventory quantity available.',
  'a competing reservation cannot oversell held inventory'
);

create temporary table connect_expiration_result as
select * from public.settle_storefront_card_checkout(
  'cs_test_ConnectReservationOne','acct_TestConnectReservation',false,'expired',5000,'usd',null,null
);
select is((select quantity_available from public.equipment_inventory_items where id='d1000000-0000-4000-8000-000000000050'),2,'expiration restores reserved inventory');
select is((select count(*)::integer from public.storefront_card_checkout_reservations where id='d1000000-0000-4000-8000-000000000100'),0,'expiration closes the temporary reservation');

create temporary table connect_paid_reservation_result as
select * from public.reserve_storefront_card_checkout(
  p_reservation_id => 'd1000000-0000-4000-8000-000000000102',
  p_store_id => 'd1000000-0000-4000-8000-000000000010', p_stripe_livemode => false,
  p_stripe_account_id => 'acct_TestConnectReservation', p_stripe_checkout_session_id => 'cs_test_ConnectReservationPaid',
  p_expires_at => now()+interval '30 minutes', p_amount_total_cents => 5000, p_currency => 'usd',
  p_buyer_email => 'paid@example.test', p_buyer_first_name => 'Paid', p_buyer_last_name => 'Buyer', p_buyer_phone => '555-0102',
  p_items => '[{"item_type":"equipment_inventory","item_id":"d1000000-0000-4000-8000-000000000050","quantity":2}]'::jsonb,
  p_delivery_address_line1 => '3 Test Lane', p_delivery_city => 'Testville', p_delivery_state => 'CO', p_delivery_postal_code => '80000'
);
select is((select quantity_available from public.equipment_inventory_items where id='d1000000-0000-4000-8000-000000000050'),0,'paid checkout reservation holds inventory once');

create temporary table connect_paid_settlement_result as
select * from public.settle_storefront_card_checkout(
  'cs_test_ConnectReservationPaid','acct_TestConnectReservation',false,'paid',5000,'usd','pi_ConnectReservationPaid',now()
);
select is((select settlement_outcome from connect_paid_settlement_result),'paid','paid settlement creates the order');
select is(
  (select payment_method||':'||payment_status||':'||payment_provider from public.orders where id=(select order_id from connect_paid_settlement_result)),
  'stripe_checkout:paid:stripe',
  'paid order has the connected Checkout payment classification'
);
select is((select quantity_available from public.equipment_inventory_items where id='d1000000-0000-4000-8000-000000000050'),0,'paid settlement does not decrement inventory twice');
select is(
  (select quantity::text||':'||inventory_debited_quantity::text||':'||restored_quantity::text
   from public.order_items where order_id=(select order_id from connect_paid_settlement_result)),
  '2:2:0',
  'paid settlement classifies the reservation debit and leaves restoration at zero'
);
select is((select count(*)::integer from public.storefront_card_checkout_reservations where id='d1000000-0000-4000-8000-000000000102'),0,'paid settlement closes the temporary reservation');
select is((select count(*)::integer from public.stripe_checkout_sessions where stripe_checkout_session_id='cs_test_ConnectReservationPaid'),1,'paid settlement records the existing Stripe session binding');

create temporary table connect_duplicate_settlement_result as
select * from public.settle_storefront_card_checkout(
  'cs_test_ConnectReservationPaid','acct_TestConnectReservation',false,'paid',5000,'usd','pi_ConnectReservationPaid',now()
);
select is(
  (select order_id from connect_duplicate_settlement_result),
  (select order_id from connect_paid_settlement_result),
  'duplicate webhook or success-page settlement returns the original order'
);
select is(
  (select quantity::text||':'||inventory_debited_quantity::text||':'||restored_quantity::text
   from public.order_items where order_id=(select order_id from connect_paid_settlement_result)),
  '2:2:0',
  'duplicate settlement preserves debit and restoration classification'
);
select is(
  (select quantity_available from public.equipment_inventory_items
   where id='d1000000-0000-4000-8000-000000000050'),
  0,
  'duplicate settlement does not deduct inventory again'
);

select is(
  (select canceled_quantity from public.order_items
   where order_id=(select order_id from connect_paid_settlement_result)),
  0,
  'new and historical-compatible order lines default canceled quantity to zero'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_stripe_connect_refund_event(text,text,text,text,bigint,text,text,text,boolean,jsonb,text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_stripe_connect_refund_event(text,text,text,text,bigint,text,text,text,boolean,jsonb,text,timestamptz)',
    'execute'
  ),
  'Stripe refund observation is service-only'
);

create temporary table external_refund_created as
select * from public.record_stripe_connect_refund_event(
  'evt_ExternalRefundCreated', 'refund.created', 're_ExternalRefund',
  'succeeded', 1000, 'usd', 'pi_ConnectReservationPaid',
  'acct_TestConnectReservation', false, '{}'::jsonb, null, now()
);

select is((select origin_classification from external_refund_created), 'external_unproven',
  'a refund without provider origin proof is external and unproven');
select is(
  (select payment_status from public.orders where id=(select order_id from connect_paid_settlement_result)),
  'partially_refunded',
  'a successful external refund updates payment knowledge'
);
select is(
  (select order_status from public.orders where id=(select order_id from connect_paid_settlement_result)),
  'open',
  'refund observation never cancels the order'
);
select is(
  (select canceled_quantity::text||':'||restored_quantity::text from public.order_items
   where order_id=(select order_id from connect_paid_settlement_result)),
  '0:0',
  'refund observation never cancels items or restores inventory'
);
select is(
  (select quantity_available from public.equipment_inventory_items
   where id='d1000000-0000-4000-8000-000000000050'),
  0,
  'refund observation leaves physical inventory unchanged'
);
select is(
  (select count(*)::integer from public.order_refunds where provider_refund_id='re_ExternalRefund'),
  1,
  'the real external Stripe refund is recorded once'
);

create temporary table external_refund_duplicate as
select * from public.record_stripe_connect_refund_event(
  'evt_ExternalRefundCreated', 'refund.created', 're_ExternalRefund',
  'succeeded', 1000, 'usd', 'pi_ConnectReservationPaid',
  'acct_TestConnectReservation', false, '{}'::jsonb, null, now()
);
select is((select was_duplicate from external_refund_duplicate), true,
  'duplicate webhook delivery is idempotent');
select is(
  (select count(*)::integer from public.payment_provider_events where provider_event_id='evt_ExternalRefundCreated'),
  1,
  'duplicate delivery retains one provider event');

create temporary table external_refund_updated as
select * from public.record_stripe_connect_refund_event(
  'evt_ExternalRefundUpdated', 'refund.updated', 're_ExternalRefund',
  'pending', 1000, 'usd', 'pi_ConnectReservationPaid',
  'acct_TestConnectReservation', false, '{}'::jsonb, null, now()
);
select is(
  (select refund_status||':'||provider_status from public.order_refunds where provider_refund_id='re_ExternalRefund'),
  'pending:pending',
  'refund.updated refreshes the observed provider status'
);

create temporary table external_refund_failed as
select * from public.record_stripe_connect_refund_event(
  'evt_ExternalRefundFailed', 'refund.failed', 're_ExternalRefund',
  'failed', 1000, 'usd', 'pi_ConnectReservationPaid',
  'acct_TestConnectReservation', false, '{}'::jsonb, null, now()
);
select is(
  (select refund_status||':'||provider_status from public.order_refunds where provider_refund_id='re_ExternalRefund'),
  'failed:failed',
  'refund.failed records the terminal provider failure'
);
select is(
  (select payment_status from public.orders where id=(select order_id from connect_paid_settlement_result)),
  'paid',
  'a failed refund does not reduce the paid amount'
);

insert into public.order_refunds (
  id, store_id, order_id, idempotency_key, request_hash, refund_amount,
  refund_method, refund_status, metadata, currency_code,
  stripe_checkout_session_id, stripe_payment_intent_id,
  stripe_account_id, stripe_livemode
)
select
  'd1000000-0000-4000-8000-000000000201', store_id, order_id,
  'ff-cancel-proof-key', 'ff-cancel-request-hash', 5.00,
  'stripe', 'pending',
  '{"schema_version":"ff_connect_cancellation_v1","workflow_type":"paid_order_cancellation","workflow_state":"refund_succeeded"}'::jsonb,
  'USD', stripe_checkout_session_id, stripe_payment_intent_id,
  metadata->>'stripe_account_id', (metadata->>'stripe_livemode')::boolean
from public.stripe_checkout_sessions
where order_id=(select order_id from connect_paid_settlement_result);

create temporary table proven_refund_created as
select * from public.record_stripe_connect_refund_event(
  'evt_FlockFrontRefundCreated', 'refund.created', 're_FlockFrontRefund',
  'succeeded', 500, 'usd', 'pi_ConnectReservationPaid',
  'acct_TestConnectReservation', false,
  jsonb_build_object(
    'ff_cancellation_schema_version','ff_connect_cancellation_v1',
    'ff_refund_action_id','d1000000-0000-4000-8000-000000000201',
    'ff_order_id',(select order_id::text from connect_paid_settlement_result),
    'ff_request_hash','ff-cancel-request-hash'
  ),
  'ff-cancel-proof-key', now()
);
select is((select origin_classification from proven_refund_created), 'flockfront',
  'full trusted correlation proves FlockFront origin');
select is(
  (select provider_refund_id from public.order_refunds where id='d1000000-0000-4000-8000-000000000201'),
  're_FlockFrontRefund',
  'the proven provider refund binds to the pre-existing action'
);
select is(
  (select payload_summary->>'origin_proof' from public.payment_provider_events where provider_event_id='evt_FlockFrontRefundCreated'),
  'stripe_event_request_idempotency',
  'the signed event idempotency match is persisted as provider evidence'
);

insert into public.order_refunds (
  id, store_id, order_id, idempotency_key, request_hash, refund_amount,
  refund_method, refund_status, metadata, currency_code,
  stripe_checkout_session_id, stripe_payment_intent_id,
  stripe_account_id, stripe_livemode
)
select
  'd1000000-0000-4000-8000-000000000202', store_id, order_id,
  'different-provider-key', 'metadata-only-hash', 2.00,
  'stripe', 'pending',
  '{"schema_version":"ff_connect_cancellation_v1","workflow_type":"paid_order_cancellation","workflow_state":"refund_succeeded"}'::jsonb,
  'USD', stripe_checkout_session_id, stripe_payment_intent_id,
  metadata->>'stripe_account_id', (metadata->>'stripe_livemode')::boolean
from public.stripe_checkout_sessions
where order_id=(select order_id from connect_paid_settlement_result);

create temporary table metadata_only_refund as
select * from public.record_stripe_connect_refund_event(
  'evt_MetadataOnlyRefundCreated', 'refund.created', 're_MetadataOnlyRefund',
  'succeeded', 200, 'usd', 'pi_ConnectReservationPaid',
  'acct_TestConnectReservation', false,
  jsonb_build_object(
    'ff_cancellation_schema_version','ff_connect_cancellation_v1',
    'ff_refund_action_id','d1000000-0000-4000-8000-000000000202',
    'ff_order_id',(select order_id::text from connect_paid_settlement_result),
    'ff_request_hash','metadata-only-hash'
  ),
  'wrong-provider-key', now()
);
select is((select origin_classification from metadata_only_refund), 'external_unproven',
  'matching editable Stripe metadata without provider idempotency proof remains external');
select is(
  (select provider_refund_id from public.order_refunds where id='d1000000-0000-4000-8000-000000000202'),
  null,
  'metadata-only evidence does not bind the external refund to the action'
);
select is(
  (select count(*)::integer from public.order_refunds where provider_refund_id='re_MetadataOnlyRefund'
    and metadata->>'origin_classification'='external_unproven'),
  1,
  'the metadata-only refund is still recorded for payment observation'
);

insert into public.order_refunds (
  id, store_id, order_id, idempotency_key, request_hash, refund_amount,
  refund_method, refund_status, metadata, currency_code,
  stripe_checkout_session_id, stripe_payment_intent_id,
  stripe_account_id, stripe_livemode
)
select
  'd1000000-0000-4000-8000-000000000203', store_id, order_id,
  'out-of-order-provider-key', 'out-of-order-request-hash', 3.00,
  'stripe', 'pending',
  '{"schema_version":"ff_connect_cancellation_v1","workflow_type":"paid_order_cancellation","workflow_state":"refund_succeeded"}'::jsonb,
  'USD', stripe_checkout_session_id, stripe_payment_intent_id,
  metadata->>'stripe_account_id', (metadata->>'stripe_livemode')::boolean
from public.stripe_checkout_sessions
where order_id=(select order_id from connect_paid_settlement_result);

create temporary table out_of_order_updated as
select * from public.record_stripe_connect_refund_event(
  'evt_OutOfOrderRefundUpdated', 'refund.updated', 're_OutOfOrderRefund',
  'pending', 300, 'usd', 'pi_ConnectReservationPaid',
  'acct_TestConnectReservation', false,
  jsonb_build_object(
    'ff_cancellation_schema_version','ff_connect_cancellation_v1',
    'ff_refund_action_id','d1000000-0000-4000-8000-000000000203',
    'ff_order_id',(select order_id::text from connect_paid_settlement_result),
    'ff_request_hash','out-of-order-request-hash'
  ),
  null, now()
);
select is((select origin_classification from out_of_order_updated), 'external_unproven',
  'an update arriving before provider origin proof remains external');

create temporary table out_of_order_created as
select * from public.record_stripe_connect_refund_event(
  'evt_OutOfOrderRefundCreated', 'refund.created', 're_OutOfOrderRefund',
  'succeeded', 300, 'usd', 'pi_ConnectReservationPaid',
  'acct_TestConnectReservation', false,
  jsonb_build_object(
    'ff_cancellation_schema_version','ff_connect_cancellation_v1',
    'ff_refund_action_id','d1000000-0000-4000-8000-000000000203',
    'ff_order_id',(select order_id::text from connect_paid_settlement_result),
    'ff_request_hash','out-of-order-request-hash'
  ),
  'out-of-order-provider-key', now()
);
select is((select origin_classification from out_of_order_created), 'flockfront',
  'the signed created event can prove origin even when an update arrived first');
select is(
  (select count(*)::integer from public.order_refunds
   where provider_refund_id='re_OutOfOrderRefund'
     and id='d1000000-0000-4000-8000-000000000203'),
  1,
  'out-of-order observation consolidates onto the pre-existing action'
);

select is(
  (select canceled_quantity::text||':'||restored_quantity::text from public.order_items
   where order_id=(select order_id from connect_paid_settlement_result)),
  '0:0',
  'all refund-event variants preserve cancellation and restoration quantities'
);

set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'd1000000-0000-4000-8000-000000000001';

update public.order_items
set restored_quantity = 1
where order_id=(select order_id from connect_paid_settlement_result);

select is(
  (select remaining_unfulfilled_quantity from public.seller_order_item_detail
   where order_id=(select order_id from connect_paid_settlement_result)),
  2,
  'restored quantity alone does not reduce active remaining quantity'
);

select is(
  (select quantity_available from public.equipment_inventory_items
   where id='d1000000-0000-4000-8000-000000000050'),
  0,
  'changing restoration history in the test does not itself mutate stock'
);

update public.order_items
set restored_quantity = 0, canceled_quantity = 1
where order_id=(select order_id from connect_paid_settlement_result);

select is(
  (select remaining_unfulfilled_quantity from public.seller_order_item_detail
   where order_id=(select order_id from connect_paid_settlement_result)),
  1,
  'active remaining quantity is ordered minus fulfilled minus canceled'
);

select is(
  (select quantity_available from public.equipment_inventory_items
   where id='d1000000-0000-4000-8000-000000000050'),
  0,
  'canceled quantity does not automatically restore stock'
);

select throws_ok(
  format(
    'select * from public.seller_record_order_fulfillment(%L::uuid, %L::jsonb)',
    (select order_id from connect_paid_settlement_result),
    jsonb_build_array(jsonb_build_object(
      'order_item_id', (select id from public.order_items
        where order_id=(select order_id from connect_paid_settlement_result)),
      'quantity', 2
    ))::text
  ),
  'Fulfillment quantity exceeds remaining unfulfilled quantity.',
  'fulfillment cannot exceed quantity remaining after cancellation'
);

select lives_ok(
  format(
    'select * from public.seller_record_order_fulfillment(%L::uuid, %L::jsonb)',
    (select order_id from connect_paid_settlement_result),
    jsonb_build_array(jsonb_build_object(
      'order_item_id', (select id from public.order_items
        where order_id=(select order_id from connect_paid_settlement_result)),
      'quantity', 1
    ))::text
  ),
  'the active remaining quantity can still be fulfilled'
);

select is(
  (select fulfilled_quantity::text||':'||canceled_quantity::text||':'||restored_quantity::text
   from public.order_items where order_id=(select order_id from connect_paid_settlement_result)),
  '1:1:0',
  'fulfillment, cancellation, and restoration remain independent quantities'
);

select finish();
rollback;
