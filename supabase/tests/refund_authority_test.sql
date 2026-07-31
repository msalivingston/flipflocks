begin;

create extension if not exists pgtap with schema extensions;

select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
)
values
  (
    'e1000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'refund-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'e1000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'refund-foreign@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'e1000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'refund-admin@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'e1000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'refund-staff@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled, currency, currency_code
)
values
  (
    'e1000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000001',
    'Refund Authority Store', 'refund-authority-store', 'live',
    'hosted', true, 'usd', 'USD'
  ),
  (
    'e1000000-0000-4000-8000-000000000011',
    'e1000000-0000-4000-8000-000000000002',
    'Foreign Refund Store', 'foreign-refund-store', 'live',
    'hosted', true, 'usd', 'USD'
  );

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  billing_state_authority
)
values
  (
    'e1000000-0000-4000-8000-000000000010',
    'small_flock', 'monthly', 'small_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  ),
  (
    'e1000000-0000-4000-8000-000000000011',
    'small_flock', 'monthly', 'small_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  );

insert into public.user_roles (user_id, role, store_id)
values
  ('e1000000-0000-4000-8000-000000000003', 'admin', null),
  (
    'e1000000-0000-4000-8000-000000000004',
    'staff',
    'e1000000-0000-4000-8000-000000000010'
  );

insert into public.customers (
  id, store_id, email, first_name, last_name
)
values
  (
    'e1000000-0000-4000-8000-000000000020',
    'e1000000-0000-4000-8000-000000000010',
    'refund-buyer@example.test', 'Refund', 'Buyer'
  ),
  (
    'e1000000-0000-4000-8000-000000000021',
    'e1000000-0000-4000-8000-000000000011',
    'foreign-refund-buyer@example.test', 'Foreign', 'Buyer'
  );

insert into public.orders (
  id, store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, payment_provider, paid_at,
  buyer_email_snapshot, buyer_first_name_snapshot, buyer_last_name_snapshot,
  subtotal_amount, tax_fee_amount, total_amount, currency_code
)
values
  (
    'e1000000-0000-4000-8000-000000000101',
    'e1000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000020',
    'REF-CASH', 'seller_created', 'open', 'pay_at_pickup', 'paid',
    'offline', now(), 'refund-buyer@example.test', 'Refund', 'Buyer',
    100.00, 0, 100.00, 'USD'
  ),
  (
    'e1000000-0000-4000-8000-000000000102',
    'e1000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000020',
    'REF-CHECK', 'seller_created', 'open', 'pay_at_pickup', 'paid',
    'offline', now(), 'refund-buyer@example.test', 'Refund', 'Buyer',
    50.00, 0, 50.00, 'USD'
  ),
  (
    'e1000000-0000-4000-8000-000000000103',
    'e1000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000020',
    'REF-OTHER', 'seller_created', 'open', 'pay_at_pickup', 'paid',
    'offline', now(), 'refund-buyer@example.test', 'Refund', 'Buyer',
    30.00, 0, 30.00, 'USD'
  ),
  (
    'e1000000-0000-4000-8000-000000000104',
    'e1000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000020',
    'REF-STRIPE', 'storefront', 'open', 'stripe_checkout', 'paid',
    'stripe', now(), 'refund-buyer@example.test', 'Refund', 'Buyer',
    100.00, 0, 100.00, 'USD'
  ),
  (
    'e1000000-0000-4000-8000-000000000105',
    'e1000000-0000-4000-8000-000000000011',
    'e1000000-0000-4000-8000-000000000021',
    'REF-FOREIGN', 'seller_created', 'open', 'pay_at_pickup', 'paid',
    'offline', now(), 'foreign-refund-buyer@example.test', 'Foreign', 'Buyer',
    40.00, 0, 40.00, 'USD'
  ),
  (
    'e1000000-0000-4000-8000-000000000106',
    'e1000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000020',
    'REF-ADMIN', 'seller_created', 'open', 'pay_at_pickup', 'paid',
    'offline', now(), 'refund-buyer@example.test', 'Refund', 'Buyer',
    20.00, 0, 20.00, 'USD'
  );

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'e1000000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000101',
    'cash-first', 25.00, 'offline_cash', 'Returned item', 'Cash returned'
  )$$,
  'the legitimate owner can record a cash refund'
);

select lives_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000102',
    'check-first', 10.00, 'offline_check', 'Order correction', null
  )$$,
  'the legitimate owner can record a check refund'
);

select lives_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000103',
    'other-first', 5.00, 'offline_other', 'Manual correction', null
  )$$,
  'the legitimate owner can record another named offline refund'
);

select results_eq(
  $test$
    select
      refund_method,
      refund_status,
      currency_code,
      provider_refund_id is null,
      provider_status is null,
      payment_provider_event_id is null,
      stripe_checkout_session_id is null,
      stripe_payment_intent_id is null,
      stripe_account_id is null,
      stripe_livemode is null,
      metadata = '{}'::jsonb,
      length(request_hash) = 64,
      created_by_user_id
    from public.order_refunds
    where order_id = 'e1000000-0000-4000-8000-000000000101'
      and idempotency_key = 'cash-first'
  $test$,
  $expected$
    values (
      'offline_cash'::text, 'succeeded'::text, 'USD'::text,
      true, true, true, true, true, true, true, true, true,
      'e1000000-0000-4000-8000-000000000001'::uuid
    )
  $expected$,
  'offline status, currency, actor, digest hash, and null provider fields are database-derived'
);

select is(
  (
    select payment_status
    from public.orders
    where id = 'e1000000-0000-4000-8000-000000000101'
  ),
  'partially_refunded',
  'a successful partial refund produces partially_refunded'
);

select lives_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000101',
    'cash-first', 25.00, 'offline_cash', 'Returned item', 'Cash returned'
  )$$,
  'an identical idempotent retry succeeds'
);

select is(
  (
    select count(*)::integer
    from public.order_refunds
    where order_id = 'e1000000-0000-4000-8000-000000000101'
      and idempotency_key = 'cash-first'
  ),
  1,
  'an identical retry creates exactly one refund'
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000101',
    'cash-first', 26.00, 'offline_cash', 'Returned item', 'Cash returned'
  )$$,
  'P0001',
  'Refund idempotency key was already used with different refund details.',
  'idempotency-key reuse with a changed amount fails'
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000101',
    'cash-first', 25.00, 'offline_check', 'Returned item', 'Cash returned'
  )$$,
  'P0001',
  'Refund idempotency key was already used with different refund details.',
  'idempotency-key reuse with a changed method fails'
);

select lives_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000101',
    'cash-final', 75.00, 'offline_cash', 'Final refund', null
  )$$,
  'multiple refunds can reach the paid amount exactly'
);

select is(
  (
    select payment_status
    from public.orders
    where id = 'e1000000-0000-4000-8000-000000000101'
  ),
  'refunded',
  'a successful full refund produces refunded'
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000101',
    'cash-over', 1.00, 'offline_cash', null, null
  )$$,
  'P0001',
  'Refund amount exceeds remaining refundable amount.',
  'refund totals cannot exceed the authoritative paid amount'
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000102',
    'zero-refund', 0, 'offline_check', null, null
  )$$,
  'P0001', 'Refund amount must be greater than zero.',
  'zero refunds are rejected'
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000102',
    'negative-refund', -1, 'offline_check', null, null
  )$$,
  'P0001', 'Refund amount must be greater than zero.',
  'negative refunds are rejected'
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000102',
    'check-over', 41.00, 'offline_check', null, null
  )$$,
  'P0001', 'Refund amount exceeds remaining refundable amount.',
  'a refund above the remaining amount is rejected'
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000103',
    'stripe-method', 1.00, 'stripe', null, null
  )$$,
  'P0001', 'Offline refund method is not supported.',
  'the seller action rejects Stripe as a method'
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000104',
    'offline-on-stripe', 10.00, 'offline_cash', null, null
  )$$,
  'P0001',
  'Offline refunds are available only for offline pay-at-pickup orders.',
  'an offline refund cannot be recorded against a Stripe order'
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000105',
    'foreign-refund', 10.00, 'offline_cash', null, null
  )$$,
  'P0001', 'Order is not available.',
  'a foreign tenant cannot refund another store order'
);

select set_config(
  'request.jwt.claim.sub',
  'e1000000-0000-4000-8000-000000000004',
  true
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000102',
    'staff-refund', 1.00, 'offline_cash', null, null
  )$$,
  'P0001', 'Order is not available.',
  'store staff remain denied under the owner-or-platform-admin order policy'
);

select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000102',
    'anonymous-refund', 1.00, 'offline_cash', null, null
  )$$,
  'P0001', 'Order is not available.',
  'an anonymous caller is denied'
);

select set_config(
  'request.jwt.claim.sub',
  'e1000000-0000-4000-8000-000000000003',
  true
);

select lives_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000106',
    'admin-offline', 10.00, 'offline_other', 'Admin correction', null
  )$$,
  'a platform admin can use the audited offline correction path'
);

select ok(
  exists (
    select 1
    from public.order_events
    where order_id = 'e1000000-0000-4000-8000-000000000106'
      and event_type = 'refund_recorded'
      and actor_type = 'admin'
      and actor_user_id = 'e1000000-0000-4000-8000-000000000003'
      and metadata ->> 'actual_actor_user_id'
        = 'e1000000-0000-4000-8000-000000000003'
  ),
  'the admin correction audit records the actual authenticated admin'
);

select throws_ok(
  $$select * from public.seller_record_offline_refund(
    'e1000000-0000-4000-8000-000000000101',
    'cash-first', 25.00, 'offline_cash', 'Returned item', 'Cash returned'
  )$$,
  'P0001',
  'Refund idempotency key was already used with different refund details.',
  'idempotency identity is bound to the actual actor'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

insert into public.payment_provider_events (
  id, provider, provider_event_id, event_type, event_status,
  provider_refund_id, payload_summary
)
values
  (
    'e1000000-0000-4000-8000-000000000201',
    'stripe', 'evt_refund_failed_test', 'refund.failed', 'received',
    're_failed_test', '{}'::jsonb
  ),
  (
    'e1000000-0000-4000-8000-000000000202',
    'stripe', 'evt_refund_canceled_test', 'refund.canceled', 'received',
    're_canceled_test', '{}'::jsonb
  );

insert into public.order_refunds (
  store_id, order_id, idempotency_key, request_hash, refund_amount,
  refund_method, refund_status, currency_code,
  provider_refund_id, provider_status, payment_provider_event_id,
  stripe_checkout_session_id, stripe_payment_intent_id,
  stripe_account_id, stripe_livemode, metadata
)
values
  (
    'e1000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000104',
    'provider-pending', 'provider-pending-hash', 10.00,
    'stripe', 'pending', 'USD',
    null, null, null,
    'cs_pending_test', 'pi_refund_test', 'acct_test', false, '{}'::jsonb
  ),
  (
    'e1000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000104',
    'provider-failed', 'provider-failed-hash', 10.00,
    'stripe', 'failed', 'USD',
    're_failed_test', 'failed',
    'e1000000-0000-4000-8000-000000000201',
    'cs_failed_test', 'pi_refund_test', 'acct_test', false, '{}'::jsonb
  ),
  (
    'e1000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000104',
    'provider-canceled', 'provider-canceled-hash', 10.00,
    'stripe', 'canceled', 'USD',
    're_canceled_test', 'canceled',
    'e1000000-0000-4000-8000-000000000202',
    'cs_canceled_test', 'pi_refund_test', 'acct_test', false, '{}'::jsonb
  );

select is(
  (
    select payment_status
    from public.orders
    where id = 'e1000000-0000-4000-8000-000000000104'
  ),
  'paid',
  'pending, failed, and canceled provider rows do not change order payment state'
);

select throws_ok(
  $$select public.record_stripe_refund_result(
    (select id from public.order_refunds where idempotency_key = 'provider-pending'),
    'e1000000-0000-4000-8000-000000000201',
    're_disabled_test', 'succeeded', 'succeeded', now()
  )$$,
  'P0001',
  'Stripe refund reconciliation is disabled until a verified provider refund workflow is deployed.',
  'even service role cannot apply Stripe provider truth before the verified workflow exists'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'e1000000-0000-4000-8000-000000000003',
  true
);

select throws_ok(
  $$select public.record_stripe_refund_result(
    gen_random_uuid(), gen_random_uuid(), 're_admin_forged',
    'succeeded', 'succeeded', now()
  )$$,
  'P0001', 'Not authorized to record Stripe refund results.',
  'a platform admin cannot impersonate Stripe inside the provider function'
);

select throws_ok(
  $test$
    insert into public.order_refunds (
      store_id, order_id, idempotency_key, request_hash, refund_amount,
      refund_method, refund_status, currency_code, metadata
    )
    values (
      'e1000000-0000-4000-8000-000000000010',
      'e1000000-0000-4000-8000-000000000102',
      'invalid-offline-pending', 'invalid-offline-pending-hash', 1.00,
      'offline_cash', 'pending', 'USD', '{}'::jsonb
    )
  $test$,
  '23514', null,
  'new offline rows cannot use a caller-chosen pending status'
);

select throws_ok(
  $test$
    insert into public.order_refunds (
      store_id, order_id, idempotency_key, request_hash, refund_amount,
      refund_method, refund_status, currency_code,
      provider_refund_id, metadata, processed_at
    )
    values (
      'e1000000-0000-4000-8000-000000000010',
      'e1000000-0000-4000-8000-000000000102',
      'invalid-offline-provider', 'invalid-offline-provider-hash', 1.00,
      'offline_cash', 'succeeded', 'USD',
      're_forged', '{}'::jsonb, now()
    )
  $test$,
  '23514', null,
  'new offline rows cannot contain provider identifiers'
);

select throws_ok(
  $test$
    insert into public.order_refunds (
      store_id, order_id, idempotency_key, request_hash, refund_amount,
      refund_method, currency_code, metadata, processed_at
    )
    values (
      'e1000000-0000-4000-8000-000000000010',
      'e1000000-0000-4000-8000-000000000102',
      'missing-refund-status', 'missing-refund-status-hash', 1.00,
      'offline_cash', 'USD', '{}'::jsonb, now()
    )
  $test$,
  '23502', null,
  'an unspecified refund status no longer defaults to succeeded'
);

select ok(
  exists (
    select 1
    from public.order_events
    where order_id = 'e1000000-0000-4000-8000-000000000101'
      and event_type = 'refund_recorded'
      and actor_user_id = 'e1000000-0000-4000-8000-000000000001'
      and metadata ->> 'operation' = 'offline_refund_recorded'
  ),
  'successful seller refunds record the actual actor and normalized audit metadata'
);

select is(
  (
    select count(*)::integer
    from public.order_refunds
    where idempotency_key in (
      'cash-over', 'zero-refund', 'negative-refund', 'check-over',
      'stripe-method', 'offline-on-stripe', 'foreign-refund',
      'staff-refund', 'anonymous-refund'
    )
  ),
  0,
  'failed actions leave no refund rows'
);

select * from finish();

rollback;
