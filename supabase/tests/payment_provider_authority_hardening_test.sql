begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(
  (
    select bool_and(
      has_function_privilege('service_role', signature, 'execute')
      and not has_function_privilege('anon', signature, 'execute')
      and not has_function_privilege('authenticated', signature, 'execute')
    )
    from unnest(array[
      'public.can_process_payment_provider_events()',
      'public.can_manage_integration_operations()',
      'public.record_payment_provider_event(text,text,text,jsonb,text,text,text)',
      'public.mark_payment_provider_event_processed(uuid,uuid,uuid,uuid)',
      'public.mark_payment_provider_event_failed(uuid,text)',
      'public.record_stripe_checkout_session_for_order(uuid,text,text,text,text,text,bigint,text,timestamptz,jsonb)',
      'public.record_stripe_payment_succeeded(uuid,uuid,text,text,text,text,timestamptz)',
      'public.record_stripe_payment_failed(uuid,uuid,text,text,text)',
      'public.record_stripe_refund_result(uuid,uuid,text,text,text,timestamptz)',
      'public.retry_payment_provider_event(uuid,text,interval)',
      'public.ignore_payment_provider_event(uuid,text,interval)',
      'public.record_integration_worker_started(text,text,text,jsonb)',
      'public.mark_integration_worker_completed(uuid,jsonb)',
      'public.mark_integration_worker_failed(uuid,text,jsonb)'
    ]) as provider_functions(signature)
  ),
  'every provider-truth and worker mutation RPC is service-role-only'
);

select ok(
  pg_get_functiondef(
    'public.can_process_payment_provider_events()'::regprocedure
  ) like '%auth.role()%service_role%'
  and pg_get_functiondef(
    'public.can_process_payment_provider_events()'::regprocedure
  ) not like '%is_admin%'
  and pg_get_functiondef(
    'public.can_manage_integration_operations()'::regprocedure
  ) like '%auth.role()%service_role%'
  and pg_get_functiondef(
    'public.can_manage_integration_operations()'::regprocedure
  ) not like '%is_admin%',
  'internal provider and worker guards do not equate platform admin with service role'
);

select ok(
  (
    select bool_and(
      p.prosecdef
      and p.proconfig @> array['search_path=pg_catalog, public']::text[]
    )
    from pg_proc as p
    where p.oid in (
      'public.can_process_payment_provider_events()'::regprocedure,
      'public.can_manage_integration_operations()'::regprocedure,
      'public.record_payment_provider_event(text,text,text,jsonb,text,text,text)'::regprocedure,
      'public.mark_payment_provider_event_processed(uuid,uuid,uuid,uuid)'::regprocedure,
      'public.mark_payment_provider_event_failed(uuid,text)'::regprocedure,
      'public.record_stripe_checkout_session_for_order(uuid,text,text,text,text,text,bigint,text,timestamptz,jsonb)'::regprocedure,
      'public.record_stripe_payment_succeeded(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure,
      'public.record_stripe_payment_failed(uuid,uuid,text,text,text)'::regprocedure,
      'public.retry_payment_provider_event(uuid,text,interval)'::regprocedure,
      'public.ignore_payment_provider_event(uuid,text,interval)'::regprocedure,
      'public.record_integration_worker_started(text,text,text,jsonb)'::regprocedure,
      'public.mark_integration_worker_completed(uuid,jsonb)'::regprocedure,
      'public.mark_integration_worker_failed(uuid,text,jsonb)'::regprocedure
    )
  ),
  'hardened security-definer RPCs have fixed safe search paths'
);

select ok(
  has_table_privilege('authenticated', 'public.payment_provider_events', 'select')
  and has_table_privilege('authenticated', 'public.stripe_checkout_sessions', 'select')
  and has_table_privilege('authenticated', 'public.integration_worker_runs', 'select')
  and not has_table_privilege('authenticated', 'public.payment_provider_events', 'insert')
  and not has_table_privilege('authenticated', 'public.payment_provider_events', 'update')
  and not has_table_privilege('authenticated', 'public.stripe_checkout_sessions', 'insert')
  and not has_table_privilege('authenticated', 'public.stripe_checkout_sessions', 'update')
  and not has_table_privilege('authenticated', 'public.integration_worker_runs', 'insert')
  and not has_table_privilege('authenticated', 'public.integration_worker_runs', 'update'),
  'platform-admin operational table visibility remains read-only'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.mark_order_paid(uuid,text)',
    'execute'
  )
  and pg_get_functiondef(
    'public.mark_order_paid(uuid,text)'::regprocedure
  ) like '%payment_provider <> ''offline''%'
  and pg_get_functiondef(
    'public.mark_order_paid(uuid,text)'::regprocedure
  ) like '%payment_method <> ''pay_at_pickup''%',
  'authenticated Pay at Pickup authority remains present and offline-only'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)',
    'execute'
  )
  and pg_get_functiondef(
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)'::regprocedure
  ) like '%payment_provider <> ''offline''%'
  and pg_get_functiondef(
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)'::regprocedure
  ) like '%payment_method <> ''pay_at_pickup''%',
  'the narrow authenticated offline refund path remains unchanged'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
)
values
  (
    'a8200000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'provider-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'a8200000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'provider-admin@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled, currency, currency_code
)
values (
  'a8200000-0000-4000-8000-000000000011',
  'a8200000-0000-4000-8000-000000000001',
  'Provider Authority Store', 'provider-authority-store', 'live',
  'hosted', true, 'usd', 'USD'
);

insert into public.user_roles (user_id, role, store_id)
values ('a8200000-0000-4000-8000-000000000002', 'admin', null);

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  billing_state_authority
)
values (
  'a8200000-0000-4000-8000-000000000011',
  'small_flock', 'monthly', 'small_flock', 'monthly', 'trialing',
  statement_timestamp(), statement_timestamp() + interval '7 days',
  statement_timestamp(), statement_timestamp() + interval '7 days',
  statement_timestamp() + interval '7 days', 'trial'
);

insert into public.customers (id, store_id, email, first_name, last_name)
values (
  'a8200000-0000-4000-8000-000000000021',
  'a8200000-0000-4000-8000-000000000011',
  'provider-buyer@example.test', 'Provider', 'Buyer'
);

insert into public.orders (
  id, store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, payment_provider,
  buyer_email_snapshot, buyer_first_name_snapshot, buyer_last_name_snapshot,
  subtotal_amount, tax_fee_amount, total_amount, currency_code
)
values
  (
    'a8200000-0000-4000-8000-000000000101',
    'a8200000-0000-4000-8000-000000000011',
    'a8200000-0000-4000-8000-000000000021',
    'AUTH-OFFLINE', 'seller_created', 'open',
    'pay_at_pickup', 'pay_at_pickup', 'offline',
    'provider-buyer@example.test', 'Provider', 'Buyer',
    25.00, 0, 25.00, 'USD'
  ),
  (
    'a8200000-0000-4000-8000-000000000102',
    'a8200000-0000-4000-8000-000000000011',
    'a8200000-0000-4000-8000-000000000021',
    'AUTH-STRIPE', 'storefront', 'open',
    'stripe_checkout', 'unpaid', 'stripe',
    'provider-buyer@example.test', 'Provider', 'Buyer',
    30.00, 0, 30.00, 'USD'
  );

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'a8200000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $$
    select *
    from public.mark_order_paid(
      'a8200000-0000-4000-8000-000000000101',
      'Paid at pickup'
    )
  $$,
  'an authorized seller can still mark a genuine Pay at Pickup order paid'
);

select throws_ok(
  $$
    select *
    from public.mark_order_paid(
      'a8200000-0000-4000-8000-000000000102',
      'Attempted browser assertion'
    )
  $$,
  'P0001',
  'Payment correction is only available for offline pay-at-pickup orders.',
  'Pay at Pickup authority cannot mark a Stripe order paid'
);

select set_config(
  'request.jwt.claim.sub',
  'a8200000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  $$
    select *
    from public.record_payment_provider_event(
      'stripe', 'evt_admin_forbidden', 'payment_intent.succeeded',
      '{}'::jsonb, null, null, null
    )
  $$,
  '42501',
  null,
  'an authenticated platform admin cannot create provider event truth'
);

select throws_ok(
  $$
    insert into public.payment_provider_events (
      provider, provider_event_id, event_type, event_status,
      payload_summary, processing_started_at
    ) values (
      'stripe', 'evt_admin_direct_forbidden', 'payment_intent.succeeded',
      'processing', '{}'::jsonb, now()
    )
  $$,
  '42501',
  null,
  'an authenticated platform admin cannot write the provider ledger directly'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

select is(
  public.can_process_payment_provider_events(),
  true,
  'the service role passes the internal provider authority assertion'
);

select lives_ok(
  $$
    select *
    from public.record_payment_provider_event(
      'stripe', 'evt_service_allowed', 'payment_intent.succeeded',
      '{}'::jsonb, null, null, null
    )
  $$,
  'the service role can still claim a verified provider event for processing'
);

select lives_ok(
  $$
    select public.record_integration_worker_started(
      'provider-authority-test', 'payment_provider',
      'provider-authority-invocation', '{}'::jsonb
    )
  $$,
  'the service role can still record trusted integration worker state'
);

select * from finish();

rollback;
