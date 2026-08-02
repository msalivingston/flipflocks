begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select has_table('public', 'billing_subscription_invoices', 'SaaS invoice ledger exists');

select is(
  (
    with required(column_name) as (
      values
        ('store_id'), ('subscription_enrollment_id'), ('customer_binding_id'),
        ('stripe_customer_id'), ('stripe_subscription_id'), ('stripe_invoice_id'),
        ('stripe_price_id'), ('stripe_livemode'), ('stripe_account_id'),
        ('billing_reason'), ('collection_method'), ('invoice_status'), ('currency'),
        ('amount_due_cents'), ('amount_paid_cents'), ('amount_remaining_cents'),
        ('base_line_amount_cents'), ('service_period_start'), ('service_period_end'),
        ('paid_at'), ('failure_at'), ('action_required_at'),
        ('finalization_failed_at'), ('next_payment_attempt_at'),
        ('paid_through_applied_at'), ('last_provider_event_id'),
        ('last_provider_event_created_at')
    )
    select count(*)::integer
    from required
    left join information_schema.columns as columns
      on columns.table_schema = 'public'
     and columns.table_name = 'billing_subscription_invoices'
     and columns.column_name = required.column_name
    where columns.column_name is null
  ),
  0,
  'all required typed invoice columns exist'
);

select is(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.billing_subscription_invoices'::regclass
      and conname = 'billing_subscription_invoices_enrollment_context_fk'
  ),
  'FOREIGN KEY (subscription_enrollment_id, store_id, customer_binding_id, stripe_subscription_id, stripe_livemode, stripe_account_id) REFERENCES billing_subscription_enrollments(id, store_id, customer_binding_id, stripe_subscription_id, stripe_livemode, stripe_account_id) ON DELETE RESTRICT',
  'invoice enrollment binding enforces store, Customer binding, Subscription, mode, and account'
);

select is(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.billing_subscription_invoices'::regclass
      and conname = 'billing_subscription_invoices_customer_context_fk'
  ),
  'FOREIGN KEY (customer_binding_id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id) REFERENCES billing_customer_bindings(id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id) ON DELETE RESTRICT',
  'invoice Customer binding enforces store, Customer, mode, and account'
);

select has_index(
  'public', 'billing_subscription_invoices',
  'billing_subscription_invoices_context_unique',
  'invoice IDs are unique inside account and mode context'
);
select has_index(
  'public', 'billing_subscription_invoices',
  'billing_subscription_invoices_grace_monitor_idx',
  'eligible unresolved grace evidence has an operational index'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.billing_subscription_invoices'::regclass),
  'invoice ledger has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.billing_subscription_invoices', 'select'),
  'anon cannot read SaaS invoice evidence'
);
select ok(
  not has_table_privilege('authenticated', 'public.billing_subscription_invoices', 'insert'),
  'authenticated cannot directly insert SaaS invoice evidence'
);
select ok(
  not has_table_privilege('authenticated', 'public.billing_subscription_invoices', 'update'),
  'authenticated cannot directly update SaaS invoice evidence'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  (
    'b2000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'saas-invoice-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'saas-invoice-admin@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values
  (
    'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000001',
    'SaaS Invoice Store', 'saas-invoice-store', 'live', 'hosted', true
  ),
  (
    'b2000000-0000-4000-8000-000000000020',
    'b2000000-0000-4000-8000-000000000001',
    'SaaS Invoice Other Store', 'saas-invoice-other-store', 'live', 'hosted', true
  ),
  (
    'b2000000-0000-4000-8000-000000000030',
    'b2000000-0000-4000-8000-000000000001',
    'SaaS Trial Conversion Store', 'saas-trial-conversion-store', 'live', 'hosted', true
  );

insert into public.user_roles(user_id, role, store_id)
values ('b2000000-0000-4000-8000-000000000002', 'admin', null);

insert into public.billing_provider_price_catalog (
  stripe_price_id, stripe_livemode, stripe_account_id, plan_key,
  billing_cadence, is_active, stripe_product_id, unit_amount_cents,
  currency, recurring_interval, recurring_interval_count
) values
  ('price_test_coop_month', false, 'acct_TestPlatformA', 'small_flock',
   'monthly', true, 'prod_test_coop', 500, 'usd', 'month', 1),
  ('price_test_market_month', false, 'acct_TestPlatformA', 'full_flock',
   'monthly', true, 'prod_test_market', 2900, 'usd', 'month', 1),
  ('price_test_inactive', false, 'acct_TestPlatformA', 'small_flock',
   'monthly', false, 'prod_test_inactive', 500, 'usd', 'month', 1),
  ('price_live_coop_month', true, 'acct_TestPlatformA', 'small_flock',
   'monthly', true, 'prod_live_coop', 500, 'usd', 'month', 1),
  ('price_other_account', false, 'acct_TestPlatformB', 'small_flock',
   'monthly', true, 'prod_other', 500, 'usd', 'month', 1);

insert into public.billing_provider_events (
  stripe_livemode, stripe_account_id, provider_event_id,
  provider_event_created_at, store_id, event_type, payload_hash,
  applied, processing_status, processed_at, attempt_count,
  provider_object_type, provider_object_id
) values
  (false, 'acct_TestPlatformA', 'evt_bind_customer_a', now() - interval '10 days',
   'b2000000-0000-4000-8000-000000000010', 'customer.created', 'hash-bind-ca',
   true, 'processed', now(), 1, 'customer', 'cus_test_a'),
  (false, 'acct_TestPlatformA', 'evt_bind_subscription_a', now() - interval '9 days',
   'b2000000-0000-4000-8000-000000000010', 'customer.subscription.created', 'hash-bind-sa',
   true, 'processed', now(), 1, 'subscription', 'sub_test_a'),
  (false, 'acct_TestPlatformA', 'evt_bind_customer_b', now() - interval '10 days',
   'b2000000-0000-4000-8000-000000000020', 'customer.created', 'hash-bind-cb',
   true, 'processed', now(), 1, 'customer', 'cus_test_b'),
  (false, 'acct_TestPlatformA', 'evt_bind_subscription_b', now() - interval '9 days',
   'b2000000-0000-4000-8000-000000000020', 'customer.subscription.created', 'hash-bind-sb',
   true, 'processed', now(), 1, 'subscription', 'sub_test_b'),
  (false, 'acct_TestPlatformA', 'evt_bind_customer_trial', now() - interval '10 days',
   'b2000000-0000-4000-8000-000000000030', 'customer.created', 'hash-bind-ct',
   true, 'processed', now(), 1, 'customer', 'cus_test_trial'),
  (false, 'acct_TestPlatformA', 'evt_bind_subscription_trial', now() - interval '9 days',
   'b2000000-0000-4000-8000-000000000030', 'customer.subscription.created', 'hash-bind-st',
   true, 'processed', now(), 1, 'subscription', 'sub_test_trial');

insert into public.billing_customer_bindings (
  id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
  provider_created_at, bound_by_event_id
) values
  ('b2000000-0000-4000-8000-000000000101', 'b2000000-0000-4000-8000-000000000010',
   'cus_test_a', false, 'acct_TestPlatformA', now() - interval '10 days', 'evt_bind_customer_a'),
  ('b2000000-0000-4000-8000-000000000102', 'b2000000-0000-4000-8000-000000000020',
   'cus_test_b', false, 'acct_TestPlatformA', now() - interval '10 days', 'evt_bind_customer_b'),
  ('b2000000-0000-4000-8000-000000000103', 'b2000000-0000-4000-8000-000000000030',
   'cus_test_trial', false, 'acct_TestPlatformA', now() - interval '10 days', 'evt_bind_customer_trial');

insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, stripe_subscription_id,
  initial_stripe_price_id, stripe_livemode, stripe_account_id,
  provider_status, trial_started_at, trial_ends_at, provider_created_at,
  bound_by_event_id
) values
  ('b2000000-0000-4000-8000-000000000201', 'b2000000-0000-4000-8000-000000000010',
   'b2000000-0000-4000-8000-000000000101', 'sub_test_a',
   'price_test_coop_month', false, 'acct_TestPlatformA', 'active', null, null,
   now() - interval '9 days', 'evt_bind_subscription_a'),
  ('b2000000-0000-4000-8000-000000000202', 'b2000000-0000-4000-8000-000000000020',
   'b2000000-0000-4000-8000-000000000102', 'sub_test_b',
   'price_test_coop_month', false, 'acct_TestPlatformA', 'active', null, null,
   now() - interval '9 days', 'evt_bind_subscription_b'),
  ('b2000000-0000-4000-8000-000000000203', 'b2000000-0000-4000-8000-000000000030',
   'b2000000-0000-4000-8000-000000000103', 'sub_test_trial',
   'price_test_coop_month', false, 'acct_TestPlatformA', 'trialing',
   now() - interval '7 days', now(), now() - interval '9 days',
   'evt_bind_subscription_trial');

insert into public.billing_trial_claims (
  store_id, subscription_enrollment_id, trial_started_at, trial_ends_at,
  provider_event_id
) values (
  'b2000000-0000-4000-8000-000000000030',
  'b2000000-0000-4000-8000-000000000203',
  now() - interval '7 days', now(), 'evt_bind_subscription_trial'
);

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, current_period_start, current_period_end,
  storefront_access_until, trial_started_at, trial_ends_at,
  billing_state_authority, stripe_customer_id, stripe_subscription_id,
  stripe_price_id, stripe_livemode, stripe_account_id,
  current_subscription_enrollment_id
) values
  ('b2000000-0000-4000-8000-000000000010', 'small_flock', 'monthly',
   'small_flock', 'monthly', 'active', now(), now() + interval '1 month', null,
   null, null, 'stripe', 'cus_test_a', 'sub_test_a', 'price_test_coop_month',
   false, 'acct_TestPlatformA', 'b2000000-0000-4000-8000-000000000201'),
  ('b2000000-0000-4000-8000-000000000020', 'small_flock', 'monthly',
   'small_flock', 'monthly', 'active', now(), now() + interval '1 month', null,
   null, null, 'stripe', 'cus_test_b', 'sub_test_b', 'price_test_coop_month',
   false, 'acct_TestPlatformA', 'b2000000-0000-4000-8000-000000000202'),
  ('b2000000-0000-4000-8000-000000000030', 'small_flock', 'monthly',
   'small_flock', 'monthly', 'trialing', now() - interval '7 days', now(), now(),
   now() - interval '7 days', now(), 'stripe', 'cus_test_trial', 'sub_test_trial',
   'price_test_coop_month', false, 'acct_TestPlatformA',
   'b2000000-0000-4000-8000-000000000203');

select is(
  (select has_active_access from public.resolve_store_entitlement(
    'b2000000-0000-4000-8000-000000000010')),
  false,
  'enrollment-backed active status and current_period_end do not grant access'
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
select is(
  (select is_publicly_available from public.get_seller_context()
   where store_id = 'b2000000-0000-4000-8000-000000000010'),
  false,
  'seller context public availability follows the canonical resolver'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$insert into public.billing_subscription_invoices (
      store_id, subscription_enrollment_id, customer_binding_id,
      stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
      stripe_price_id, stripe_livemode, stripe_account_id, billing_reason,
      collection_method, invoice_status, currency, amount_due_cents,
      amount_paid_cents, amount_remaining_cents, base_line_amount_cents,
      service_period_start, service_period_end, last_provider_event_id,
      last_provider_event_created_at
    ) values (
      'b2000000-0000-4000-8000-000000000020',
      'b2000000-0000-4000-8000-000000000201',
      'b2000000-0000-4000-8000-000000000101', 'cus_test_a', 'sub_test_a',
      'in_bad_store', 'price_test_coop_month', false, 'acct_TestPlatformA',
      'subscription_cycle', 'charge_automatically', 'open', 'usd',
      500, 0, 500, 500, now(), now() + interval '1 month',
      'evt_bind_subscription_b', now()
    )$$,
  '23503',
  null,
  'invoice cannot cross-bind an enrollment to another store'
);

select throws_ok(
  $$insert into public.billing_subscription_invoices (
      store_id, subscription_enrollment_id, customer_binding_id,
      stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
      stripe_price_id, stripe_livemode, stripe_account_id, billing_reason,
      collection_method, invoice_status, currency, amount_due_cents,
      amount_paid_cents, amount_remaining_cents, base_line_amount_cents,
      last_provider_event_id, last_provider_event_created_at
    ) values (
      'b2000000-0000-4000-8000-000000000010',
      'b2000000-0000-4000-8000-000000000201',
      'b2000000-0000-4000-8000-000000000101', 'cus_test_a', 'sub_test_a',
      '', 'price_test_coop_month', false, 'acct_TestPlatformA',
      'subscription_cycle', 'charge_automatically', 'open', 'usd',
      500, 0, 500, 500, 'evt_bind_subscription_a', now()
    )$$,
  '23514', null, 'blank Invoice identifiers are rejected'
);

select throws_ok(
  $$insert into public.billing_subscription_invoices (
      store_id, subscription_enrollment_id, customer_binding_id,
      stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
      stripe_price_id, stripe_livemode, stripe_account_id, billing_reason,
      collection_method, invoice_status, currency, amount_due_cents,
      amount_paid_cents, amount_remaining_cents, base_line_amount_cents,
      last_provider_event_id, last_provider_event_created_at
    ) values (
      'b2000000-0000-4000-8000-000000000010',
      'b2000000-0000-4000-8000-000000000201',
      'b2000000-0000-4000-8000-000000000101', 'cus_test_a', 'sub_test_a',
      'in_negative', 'price_test_coop_month', false, 'acct_TestPlatformA',
      'subscription_cycle', 'charge_automatically', 'open', 'usd',
      -1, 0, 0, 500, 'evt_bind_subscription_a', now()
    )$$,
  '23514', null, 'negative invoice amounts are rejected'
);

select throws_ok(
  $$insert into public.billing_subscription_invoices (
      store_id, subscription_enrollment_id, customer_binding_id,
      stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
      stripe_price_id, stripe_livemode, stripe_account_id, billing_reason,
      collection_method, invoice_status, currency, amount_due_cents,
      amount_paid_cents, amount_remaining_cents, base_line_amount_cents,
      service_period_start, service_period_end, last_provider_event_id,
      last_provider_event_created_at
    ) values (
      'b2000000-0000-4000-8000-000000000010',
      'b2000000-0000-4000-8000-000000000201',
      'b2000000-0000-4000-8000-000000000101', 'cus_test_a', 'sub_test_a',
      'in_bad_period', 'price_test_coop_month', false, 'acct_TestPlatformA',
      'subscription_cycle', 'charge_automatically', 'open', 'usd',
      500, 0, 500, 500, now(), now(), 'evt_bind_subscription_a', now()
    )$$,
  '23514', null, 'invalid recurring service-period ordering is rejected'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_verified_saas_invoice_payment_succeeded(text,timestamptz,text,text,boolean,uuid,text,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,timestamptz,timestamptz,timestamptz)',
    'execute'
  ),
  'authenticated cannot execute the successful invoice sink'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.apply_verified_saas_invoice_payment_succeeded(text,timestamptz,text,text,boolean,uuid,text,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,timestamptz,timestamptz,timestamptz)',
    'execute'
  ),
  'service_role may execute the successful invoice sink'
);
select ok(
  not has_column_privilege(
    'service_role', 'public.seller_billing_status', 'paid_through_at', 'update'
  ),
  'generic service table updates cannot write paid-through authority'
);
select ok(
  not has_column_privilege(
    'service_role', 'public.seller_billing_status',
    'last_paid_stripe_invoice_id', 'insert'
  ),
  'generic service table inserts cannot manufacture last-paid invoice authority'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_admin_attempt', now(), 'hash-admin', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_admin_attempt', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'Verified SaaS invoice payment requires a service workflow.',
  'platform administrators cannot assert successful provider payment'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

select lives_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_success_a', now(), 'hash-success-a', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_success_a', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'valid automatically collected recurring payment is accepted'
);

select ok(
  (select paid_through_at > now() from public.seller_billing_status
   where store_id = 'b2000000-0000-4000-8000-000000000010'),
  'valid successful recurring payment advances paid-through'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'b2000000-0000-4000-8000-000000000010')),
  'paid',
  'resolver grants invoice-backed paid access'
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
select is(
  (select is_publicly_available from public.get_seller_context()
   where store_id = 'b2000000-0000-4000-8000-000000000010'),
  true,
  'seller context becomes publicly available from proven paid access'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select is(
  (select storefront_enabled from public.stores
   where id = 'b2000000-0000-4000-8000-000000000010'),
  true,
  'successful invoice recording does not mutate storefront preference'
);

select lives_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_success_a', now(), 'hash-success-a', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_success_a', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'duplicate successful event is idempotent'
);
select is(
  (select count(*)::integer from public.billing_provider_events
   where provider_event_id = 'evt_success_a'),
  1,
  'duplicate event produces one provider-event row'
);
select throws_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_success_a', now(), 'different-hash', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_success_a', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'Provider event id was reused with different content.',
  'event ID reuse with different content is rejected'
);

select lives_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_zero_trial', now(), 'hash-zero', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000030', 'cus_test_trial', 'sub_test_trial',
    'in_zero_trial', 'price_test_coop_month', 'subscription_create',
    'charge_automatically', 'paid', 'usd', 0, 0, 0, 500,
    now() - interval '7 days', now(), now())$$,
  'zero-dollar trial invoice is recorded'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'b2000000-0000-4000-8000-000000000030'),
  null::timestamptz,
  'zero-dollar trial invoice does not establish paid-through'
);

select lives_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_manual_paid', now(), 'hash-manual', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000030', 'cus_test_trial', 'sub_test_trial',
    'in_manual_paid', 'price_test_coop_month', 'subscription_create',
    'send_invoice', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'manual paid invoice is recorded without authority'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'b2000000-0000-4000-8000-000000000030'),
  null::timestamptz,
  'send_invoice cannot establish paid-through'
);

select throws_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_wrong_customer', now(), 'hash-wrong-customer', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_b', 'sub_test_a',
    'in_wrong_customer', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'Invoice does not match the immutable Customer binding.',
  'wrong Customer is rejected'
);
select throws_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_wrong_sub', now(), 'hash-wrong-sub', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_b',
    'in_wrong_sub', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'Invoice does not match the current Subscription enrollment.',
  'wrong Subscription is rejected'
);
select throws_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_wrong_account', now(), 'hash-wrong-account', 'acct_TestPlatformB', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_wrong_account', 'price_other_account', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'Invoice does not match the current Subscription enrollment.',
  'wrong Stripe account is rejected'
);
select throws_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_wrong_mode', now(), 'hash-wrong-mode', 'acct_TestPlatformA', true,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_wrong_mode', 'price_live_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'Invoice does not match the current Subscription enrollment.',
  'wrong live/test mode is rejected'
);
select throws_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_wrong_currency', now(), 'hash-wrong-currency', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_wrong_currency', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'eur', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'Invoice recurring-line evidence does not match the trusted Price.',
  'wrong currency is rejected'
);
select throws_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_wrong_amount', now(), 'hash-wrong-amount', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_wrong_amount', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 499,
    now(), now() + interval '1 month', now())$$,
  'Invoice recurring-line evidence does not match the trusted Price.',
  'wrong recurring-line base amount is rejected'
);
select throws_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_wrong_interval', now(), 'hash-wrong-interval', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_wrong_interval', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '2 months', now())$$,
  'Invoice service period does not match the trusted recurring interval.',
  'service period must match the trusted recurring interval and count'
);

update public.billing_provider_price_catalog
set is_active = false
where stripe_price_id = 'price_test_coop_month'
  and not stripe_livemode and stripe_account_id = 'acct_TestPlatformA';
select throws_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_inactive_price', now(), 'hash-inactive-price', 'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_inactive_price', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'Invoice Price is not a complete active trusted recurring Price.',
  'inactive recurring Price is rejected'
);
update public.billing_provider_price_catalog
set is_active = true
where stripe_price_id = 'price_test_coop_month'
  and not stripe_livemode and stripe_account_id = 'acct_TestPlatformA';

select lives_ok(
  $$select public.apply_verified_saas_invoice_payment_failed(
    'evt_renewal_failed', now() + interval '1 minute', 'hash-renewal-failed',
    'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000010', 'cus_test_a', 'sub_test_a',
    'in_renewal_failed', 'price_test_coop_month', 'subscription_cycle',
    'charge_automatically', 'open', 'usd', 500, 0, 500, 500,
    (select paid_through_at from public.seller_billing_status where store_id = 'b2000000-0000-4000-8000-000000000010'),
    (select paid_through_at + interval '1 month' from public.seller_billing_status where store_id = 'b2000000-0000-4000-8000-000000000010'),
    now(), now() + interval '1 day', 'card_declined')$$,
  'eligible renewal failure is recorded'
);
select is(
  (select grace_ends_at = paid_through_at + interval '3 days'
   from public.seller_billing_status
   where store_id = 'b2000000-0000-4000-8000-000000000010'),
  true,
  'renewal grace ends three days after proven paid-through'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'b2000000-0000-4000-8000-000000000010')),
  'paid',
  'failure does not shorten existing paid access before its boundary'
);

select lives_ok(
  $$select public.apply_verified_saas_invoice_payment_failed(
    'evt_trial_failed', now() + interval '2 minutes', 'hash-trial-failed',
    'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000030', 'cus_test_trial', 'sub_test_trial',
    'in_trial_failed', 'price_test_coop_month', 'subscription_create',
    'charge_automatically', 'open', 'usd', 500, 0, 500, 500,
    now(), now() + interval '1 month', now(), null, 'card_declined')$$,
  'eligible trial-conversion failure is recorded'
);
select is(
  (select grace_ends_at = trial_ends_at + interval '3 days'
   from public.seller_billing_status
   where store_id = 'b2000000-0000-4000-8000-000000000030'),
  true,
  'trial-conversion grace ends three days after verified trial end'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'b2000000-0000-4000-8000-000000000030')),
  'payment_grace',
  'eligible trial-conversion failure grants grace after the trial boundary'
);

select lives_ok(
  $$select public.apply_verified_saas_invoice_payment_action_required(
    'evt_action_required', now() + interval '3 minutes', 'hash-action',
    'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000030', 'cus_test_trial', 'sub_test_trial',
    'in_action_required', 'price_test_coop_month', 'subscription_update',
    'charge_automatically', 'open', 'usd', 500, 0, 500, 500,
    now(), now() + interval '1 month', now(), null, 'authentication_required')$$,
  'action-required state is recorded'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'b2000000-0000-4000-8000-000000000030'),
  null::timestamptz,
  'action-required event cannot extend paid-through'
);
select is(
  (select grace_eligible from public.billing_subscription_invoices
   where stripe_invoice_id = 'in_action_required'),
  false,
  'subscription-update action-required event cannot create grace'
);

select lives_ok(
  $$select public.apply_verified_saas_invoice_finalization_failed(
    'evt_finalization_failed', now() + interval '4 minutes', 'hash-finalization',
    'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000030', 'cus_test_trial', 'sub_test_trial',
    'in_finalization_failed', 'price_test_coop_month', 'subscription_update',
    'charge_automatically', 'draft', 'usd', 500, 0, 500, 500,
    now(), now() + interval '1 month', now(), null, 'tax_location_invalid')$$,
  'finalization failure is recorded with a sanitized code'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'b2000000-0000-4000-8000-000000000030'),
  null::timestamptz,
  'finalization failure cannot extend paid-through'
);

select lives_ok(
  $$select public.apply_verified_saas_invoice_payment_succeeded(
    'evt_trial_recovered', now() + interval '5 minutes', 'hash-trial-recovered',
    'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000030', 'cus_test_trial', 'sub_test_trial',
    'in_trial_failed', 'price_test_coop_month', 'subscription_create',
    'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
    now(), now() + interval '1 month', now())$$,
  'successful recovery for failed trial-conversion invoice is accepted'
);
select is(
  (select grace_ends_at from public.seller_billing_status
   where store_id = 'b2000000-0000-4000-8000-000000000030'),
  null::timestamptz,
  'successful recovery clears matching grace evidence'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'b2000000-0000-4000-8000-000000000030')),
  'paid',
  'successful payment recovery restores paid access'
);

select lives_ok(
  $$select public.apply_verified_saas_invoice_payment_failed(
    'evt_stale_failure_after_success', now() - interval '1 hour', 'hash-stale-failure',
    'acct_TestPlatformA', false,
    'b2000000-0000-4000-8000-000000000030', 'cus_test_trial', 'sub_test_trial',
    'in_trial_failed', 'price_test_coop_month', 'subscription_create',
    'charge_automatically', 'open', 'usd', 500, 0, 500, 500,
    now(), now() + interval '1 month', now(), null, 'card_declined')$$,
  'late failure after success is safely consumed'
);
select is(
  (select invoice_status from public.billing_subscription_invoices
   where stripe_invoice_id = 'in_trial_failed'),
  'paid',
  'successful invoice state wins over a late failure'
);

update public.seller_billing_status
set cancel_at_period_end = true, subscription_status = 'canceled'
where store_id = 'b2000000-0000-4000-8000-000000000030';
select is(
  (select access_reason from public.resolve_store_entitlement(
    'b2000000-0000-4000-8000-000000000030')),
  'paid_canceling',
  'terminal Subscription status and cancellation do not shorten proven paid access'
);

update public.stores set admin_hold_reason = 'test hold'
where id = 'b2000000-0000-4000-8000-000000000030';
select is(
  (select access_reason from public.resolve_store_entitlement(
    'b2000000-0000-4000-8000-000000000030')),
  'administrative_hold',
  'administrative hold overrides paid invoice evidence'
);
select is(
  (select storefront_enabled from public.stores
   where id = 'b2000000-0000-4000-8000-000000000030'),
  true,
  'hold, failure, grace, and recovery never mutate storefront preference'
);

select finish();
rollback;
