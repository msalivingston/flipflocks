begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select has_table('public', 'billing_customer_bindings', 'customer binding ledger exists');
select has_table('public', 'billing_checkout_attempts', 'Checkout attempt ledger exists');
select has_table('public', 'billing_subscription_enrollments', 'Subscription enrollment ledger exists');
select has_table('public', 'billing_trial_claims', 'one-trial claim ledger exists');

select is(
  (
    with required(table_name, column_name) as (
      values
        ('billing_customer_bindings', 'stripe_customer_id'),
        ('billing_customer_bindings', 'stripe_livemode'),
        ('billing_customer_bindings', 'stripe_account_id'),
        ('billing_customer_bindings', 'bound_by_event_id'),
        ('billing_checkout_attempts', 'requested_plan_key'),
        ('billing_checkout_attempts', 'requested_billing_cadence'),
        ('billing_checkout_attempts', 'stripe_price_id'),
        ('billing_checkout_attempts', 'stripe_checkout_session_id'),
        ('billing_checkout_attempts', 'stripe_idempotency_key'),
        ('billing_subscription_enrollments', 'customer_binding_id'),
        ('billing_subscription_enrollments', 'checkout_attempt_id'),
        ('billing_subscription_enrollments', 'stripe_subscription_id'),
        ('billing_subscription_enrollments', 'initial_stripe_price_id'),
        ('billing_subscription_enrollments', 'is_current'),
        ('billing_trial_claims', 'subscription_enrollment_id'),
        ('billing_trial_claims', 'provider_event_id')
    )
    select count(*)::integer
    from required
    left join information_schema.columns as columns
      on columns.table_schema = 'public'
     and columns.table_name = required.table_name
     and columns.column_name = required.column_name
    where columns.column_name is null
  ),
  0,
  'all required binding, attempt, enrollment, and trial columns exist'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_provider_price_catalog'
      and column_name in (
        'stripe_product_id',
        'unit_amount_cents',
        'currency',
        'recurring_interval',
        'recurring_interval_count'
      )
  ),
  5,
  'the trusted Price catalog contains all provider verification fields'
);

select has_column(
  'public',
  'seller_billing_status',
  'current_subscription_enrollment_id',
  'seller billing has the nullable structural enrollment link'
);

select is(
  (
    select pg_get_constraintdef(pg_constraint.oid)
    from pg_constraint
    where conrelid = 'public.seller_billing_status'::regclass
      and conname = 'seller_billing_status_current_enrollment_fk'
      and contype = 'f'
  ),
  'FOREIGN KEY (current_subscription_enrollment_id, store_id) REFERENCES billing_subscription_enrollments(id, store_id) ON DELETE RESTRICT',
  'seller billing enrollment link requires the same store'
);

select is(
  (
    select pg_get_constraintdef(pg_constraint.oid)
    from pg_constraint
    where conrelid = 'public.billing_subscription_enrollments'::regclass
      and conname = 'billing_subscription_enrollments_identity_unique'
      and contype = 'u'
  ),
  'UNIQUE (id, store_id)',
  'the enrollment table has the composite unique key required by the same-store foreign key'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_provider_events'
      and column_name in (
        'processing_status',
        'processing_started_at',
        'processed_at',
        'failed_at',
        'attempt_count',
        'last_error_code',
        'last_error_message',
        'provider_object_type',
        'provider_object_id'
      )
  ),
  9,
  'provider subscription events contain durable processing fields'
);

select ok(
  not exists (
    select 1
    from public.billing_provider_events
    where (applied or ignored_reason is not null)
      and processing_status not in ('processed', 'ignored')
  ),
  'pre-foundation applied or ignored events are terminal rather than pending work'
);

select results_eq(
  $test$
    select setting_key, boolean_value
    from public.platform_settings
    where setting_key in (
      'saas_subscription_checkout_enabled',
      'saas_billing_portal_enabled'
    )
    order by setting_key
  $test$,
  $expected$
    values
      ('saas_billing_portal_enabled'::text, false),
      ('saas_subscription_checkout_enabled'::text, false)
  $expected$,
  'both future SaaS billing feature flags exist and are disabled'
);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.billing_customer_bindings'::regclass,
      'public.billing_checkout_attempts'::regclass,
      'public.billing_subscription_enrollments'::regclass,
      'public.billing_trial_claims'::regclass
    )
  ),
  'RLS is enabled on every new authority table'
);

select ok(
  (
    select bool_and(
      not has_table_privilege('anon', table_name, 'select')
      and not has_table_privilege('anon', table_name, 'insert')
      and not has_table_privilege('anon', table_name, 'update')
      and not has_table_privilege('anon', table_name, 'delete')
      and not has_table_privilege('authenticated', table_name, 'select')
      and not has_table_privilege('authenticated', table_name, 'insert')
      and not has_table_privilege('authenticated', table_name, 'update')
      and not has_table_privilege('authenticated', table_name, 'delete')
    )
    from unnest(array[
      'public.billing_customer_bindings',
      'public.billing_checkout_attempts',
      'public.billing_subscription_enrollments',
      'public.billing_trial_claims'
    ]) as authority_tables(table_name)
  ),
  'anon and authenticated cannot directly read or write new provider ledgers'
);

select ok(
  has_table_privilege('service_role', 'public.billing_customer_bindings', 'select')
  and has_table_privilege('service_role', 'public.billing_customer_bindings', 'insert')
  and not has_table_privilege('service_role', 'public.billing_customer_bindings', 'update')
  and not has_table_privilege('service_role', 'public.billing_customer_bindings', 'delete')
  and has_table_privilege('service_role', 'public.billing_checkout_attempts', 'update')
  and has_table_privilege('service_role', 'public.billing_subscription_enrollments', 'update')
  and has_table_privilege('service_role', 'public.billing_trial_claims', 'insert')
  and not has_table_privilege('service_role', 'public.billing_trial_claims', 'update')
  and not has_table_privilege('service_role', 'public.billing_trial_claims', 'delete'),
  'service-role grants are limited to the future lifecycle each ledger requires'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
)
values
  (
    'a8100000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'billing-foundation-1@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'a8100000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'billing-foundation-2@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'a8100000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'billing-foundation-3@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
)
values
  (
    'a8100000-0000-4000-8000-000000000011',
    'a8100000-0000-4000-8000-000000000001',
    'Billing Foundation One', 'billing-foundation-one', 'draft', 'hosted', false
  ),
  (
    'a8100000-0000-4000-8000-000000000012',
    'a8100000-0000-4000-8000-000000000002',
    'Billing Foundation Two', 'billing-foundation-two', 'draft', 'hosted', false
  ),
  (
    'a8100000-0000-4000-8000-000000000013',
    'a8100000-0000-4000-8000-000000000003',
    'Billing Foundation Three', 'billing-foundation-three', 'draft', 'hosted', false
  );

insert into public.billing_provider_events (
  stripe_livemode,
  stripe_account_id,
  provider_event_id,
  provider_event_created_at,
  store_id,
  event_type,
  payload_hash,
  applied,
  ignored_reason
)
values
  (false, 'acct_00000000000001', 'evt_customer_store1_test', now(), 'a8100000-0000-4000-8000-000000000011', 'customer.created', 'hash-customer-1', true, null),
  (false, 'acct_00000000000001', 'evt_customer_store2_test', now(), 'a8100000-0000-4000-8000-000000000012', 'customer.created', 'hash-customer-2', true, null),
  (true,  'acct_00000000000001', 'evt_customer_store1_live', now(), 'a8100000-0000-4000-8000-000000000011', 'customer.created', 'hash-customer-live', true, null),
  (false, 'acct_00000000000002', 'evt_customer_store1_account2', now(), 'a8100000-0000-4000-8000-000000000011', 'customer.created', 'hash-customer-account-2', true, null),
  (false, 'acct_00000000000001', 'evt_enrollment_store1_1', now(), 'a8100000-0000-4000-8000-000000000011', 'customer.subscription.created', 'hash-enrollment-1', true, null),
  (false, 'acct_00000000000001', 'evt_enrollment_store1_2', now(), 'a8100000-0000-4000-8000-000000000011', 'customer.subscription.created', 'hash-enrollment-2', true, null),
  (false, 'acct_00000000000001', 'evt_enrollment_store2_1', now(), 'a8100000-0000-4000-8000-000000000012', 'customer.subscription.created', 'hash-enrollment-3', true, null),
  (false, 'acct_00000000000001', 'evt_legacy_ignored', now(), 'a8100000-0000-4000-8000-000000000013', 'customer.subscription.updated', 'hash-ignored', false, 'stale_event');

select is(
  (
    select processing_status
    from public.billing_provider_events
    where provider_event_id = 'evt_legacy_ignored'
  ),
  'ignored',
  'legacy-compatible ignored event inserts are terminal automatically'
);

insert into public.billing_customer_bindings (
  id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
  provider_created_at, bound_by_event_id
)
values
  (
    'a8100000-0000-4000-8000-000000000101',
    'a8100000-0000-4000-8000-000000000011',
    'cus_foundation_shared', false, 'acct_00000000000001', now(),
    'evt_customer_store1_test'
  ),
  (
    'a8100000-0000-4000-8000-000000000102',
    'a8100000-0000-4000-8000-000000000012',
    'cus_foundation_store2', false, 'acct_00000000000001', now(),
    'evt_customer_store2_test'
  );

select throws_ok(
  $$
    insert into public.billing_customer_bindings (
      store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
      provider_created_at, bound_by_event_id
    ) values (
      'a8100000-0000-4000-8000-000000000013', '', false,
      'acct_00000000000001', now(), 'evt_legacy_ignored'
    )
  $$,
  '23514',
  null,
  'blank Stripe Customer identifiers are rejected'
);

select throws_ok(
  $$
    insert into public.billing_customer_bindings (
      store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
      provider_created_at, bound_by_event_id
    ) values (
      'a8100000-0000-4000-8000-000000000013', 'cus_blank_account', false,
      '', now(), 'evt_legacy_ignored'
    )
  $$,
  '23514',
  null,
  'empty Stripe platform-account identity is rejected'
);

select throws_ok(
  $$
    insert into public.billing_customer_bindings (
      store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
      provider_created_at, bound_by_event_id
    ) values (
      'a8100000-0000-4000-8000-000000000011', 'cus_second_for_store', false,
      'acct_00000000000001', now(), 'evt_customer_store1_test'
    )
  $$,
  '23505',
  null,
  'one store cannot have two Customer bindings in one account and mode'
);

select throws_ok(
  $$
    insert into public.billing_customer_bindings (
      store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
      provider_created_at, bound_by_event_id
    ) values (
      'a8100000-0000-4000-8000-000000000012', 'cus_foundation_shared', false,
      'acct_00000000000001', now(), 'evt_customer_store2_test'
    )
  $$,
  '23505',
  null,
  'one Stripe Customer cannot bind to two stores in one account and mode'
);

select lives_ok(
  $$
    insert into public.billing_customer_bindings (
      id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
      provider_created_at, bound_by_event_id
    ) values (
      'a8100000-0000-4000-8000-000000000103',
      'a8100000-0000-4000-8000-000000000011',
      'cus_foundation_shared', true, 'acct_00000000000001', now(),
      'evt_customer_store1_live'
    )
  $$,
  'test and live Customer bindings are distinct contexts'
);

select lives_ok(
  $$
    insert into public.billing_customer_bindings (
      id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
      provider_created_at, bound_by_event_id
    ) values (
      'a8100000-0000-4000-8000-000000000104',
      'a8100000-0000-4000-8000-000000000011',
      'cus_foundation_shared', false, 'acct_00000000000002', now(),
      'evt_customer_store1_account2'
    )
  $$,
  'different Stripe platform accounts are distinct contexts'
);

insert into public.billing_checkout_attempts (
  id, store_id, created_by_user_id, requested_plan_key,
  requested_billing_cadence, stripe_price_id, stripe_livemode,
  stripe_account_id, attempt_status, stripe_idempotency_key
)
values (
  'a8100000-0000-4000-8000-000000000201',
  'a8100000-0000-4000-8000-000000000011',
  'a8100000-0000-4000-8000-000000000001',
  'small_flock', 'monthly', 'price_foundation_monthly', false,
  'acct_00000000000001', 'open', 'saas-enroll-foundation-1'
);

select throws_ok(
  $$
    insert into public.billing_checkout_attempts (
      store_id, created_by_user_id, requested_plan_key,
      requested_billing_cadence, stripe_price_id, stripe_livemode,
      stripe_account_id, attempt_status, stripe_idempotency_key
    ) values (
      'a8100000-0000-4000-8000-000000000011',
      'a8100000-0000-4000-8000-000000000001',
      'full_flock', 'yearly', 'price_foundation_yearly', false,
      'acct_00000000000001', 'creating', 'saas-enroll-foundation-2'
    )
  $$,
  '23505',
  null,
  'one store cannot have two unresolved attempts in one account and mode'
);

update public.billing_checkout_attempts
set attempt_status = 'expired', expired_at = now()
where id = 'a8100000-0000-4000-8000-000000000201';

select lives_ok(
  $$
    insert into public.billing_checkout_attempts (
      id, store_id, created_by_user_id, requested_plan_key,
      requested_billing_cadence, stripe_price_id, stripe_livemode,
      stripe_account_id, attempt_status, stripe_idempotency_key
    ) values (
      'a8100000-0000-4000-8000-000000000202',
      'a8100000-0000-4000-8000-000000000011',
      'a8100000-0000-4000-8000-000000000001',
      'full_flock', 'monthly', 'price_foundation_market', false,
      'acct_00000000000001', 'creating', 'saas-enroll-foundation-2'
    )
  $$,
  'an expired attempt does not block a new attempt'
);

update public.billing_checkout_attempts
set attempt_status = 'failed', last_failure_code = 'test_failure'
where id = 'a8100000-0000-4000-8000-000000000202';

select lives_ok(
  $$
    insert into public.billing_checkout_attempts (
      id, store_id, created_by_user_id, requested_plan_key,
      requested_billing_cadence, stripe_price_id, stripe_livemode,
      stripe_account_id, attempt_status, stripe_idempotency_key
    ) values (
      'a8100000-0000-4000-8000-000000000203',
      'a8100000-0000-4000-8000-000000000011',
      'a8100000-0000-4000-8000-000000000001',
      'full_flock', 'monthly', 'price_foundation_market', false,
      'acct_00000000000001', 'open', 'saas-enroll-foundation-3'
    )
  $$,
  'a failed attempt does not block a new attempt'
);

update public.billing_checkout_attempts
set attempt_status = 'superseded'
where id = 'a8100000-0000-4000-8000-000000000203';

select lives_ok(
  $$
    insert into public.billing_checkout_attempts (
      id, store_id, created_by_user_id, requested_plan_key,
      requested_billing_cadence, stripe_price_id, stripe_livemode,
      stripe_account_id, attempt_status, stripe_idempotency_key
    ) values (
      'a8100000-0000-4000-8000-000000000204',
      'a8100000-0000-4000-8000-000000000011',
      'a8100000-0000-4000-8000-000000000001',
      'full_flock', 'monthly', 'price_foundation_market', false,
      'acct_00000000000001', 'pending_confirmation',
      'saas-enroll-foundation-4'
    )
  $$,
  'a superseded attempt does not block a new attempt'
);

select throws_ok(
  $$
    insert into public.billing_checkout_attempts (
      store_id, created_by_user_id, requested_plan_key,
      requested_billing_cadence, stripe_price_id, stripe_livemode,
      stripe_account_id, attempt_status, stripe_idempotency_key
    ) values (
      'a8100000-0000-4000-8000-000000000012',
      'a8100000-0000-4000-8000-000000000002',
      'small_flock', 'monthly', ' ', false,
      'acct_00000000000001', 'failed', 'saas-enroll-blank-price'
    )
  $$,
  '23514',
  null,
  'blank trusted Price identifiers are rejected'
);

insert into public.billing_checkout_attempts (
  store_id, created_by_user_id, requested_plan_key,
  requested_billing_cadence, stripe_price_id, stripe_livemode,
  stripe_account_id, attempt_status, stripe_checkout_session_id,
  stripe_idempotency_key
)
values (
  'a8100000-0000-4000-8000-000000000011',
  'a8100000-0000-4000-8000-000000000001',
  'small_flock', 'monthly', 'price_foundation_session', true,
  'acct_00000000000001', 'failed', 'cs_foundation_global_unique',
  'saas-enroll-session-global-1'
);

select throws_ok(
  $$
    insert into public.billing_checkout_attempts (
      store_id, created_by_user_id, requested_plan_key,
      requested_billing_cadence, stripe_price_id, stripe_livemode,
      stripe_account_id, attempt_status, stripe_checkout_session_id,
      stripe_idempotency_key
    ) values (
      'a8100000-0000-4000-8000-000000000012',
      'a8100000-0000-4000-8000-000000000002',
      'small_flock', 'monthly', 'price_foundation_session', false,
      'acct_00000000000001', 'failed', 'cs_foundation_global_unique',
      'saas-enroll-session-global-2'
    )
  $$,
  '23505',
  null,
  'a Checkout Session identifier is globally unique when present'
);

insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, stripe_subscription_id,
  initial_stripe_price_id, stripe_livemode, stripe_account_id,
  provider_status, trial_started_at, trial_ends_at, provider_created_at,
  bound_by_event_id
)
values (
  'a8100000-0000-4000-8000-000000000301',
  'a8100000-0000-4000-8000-000000000011',
  'a8100000-0000-4000-8000-000000000101',
  'sub_foundation_shared', 'price_foundation_monthly', false,
  'acct_00000000000001', 'trialing', now(), now() + interval '7 days',
  now(), 'evt_enrollment_store1_1'
);

select throws_ok(
  $$
    insert into public.billing_subscription_enrollments (
      store_id, customer_binding_id, stripe_subscription_id,
      initial_stripe_price_id, stripe_livemode, stripe_account_id,
      provider_status, provider_created_at, bound_by_event_id
    ) values (
      'a8100000-0000-4000-8000-000000000012',
      'a8100000-0000-4000-8000-000000000102',
      'sub_foundation_shared', 'price_foundation_monthly', false,
      'acct_00000000000001', 'trialing', now(),
      'evt_enrollment_store2_1'
    )
  $$,
  '23505',
  null,
  'one Subscription cannot bind to two stores in one account and mode'
);

select throws_ok(
  $$
    insert into public.billing_subscription_enrollments (
      store_id, customer_binding_id, stripe_subscription_id,
      initial_stripe_price_id, stripe_livemode, stripe_account_id,
      provider_status, provider_created_at, bound_by_event_id
    ) values (
      'a8100000-0000-4000-8000-000000000011',
      'a8100000-0000-4000-8000-000000000101',
      'sub_foundation_second_current', 'price_foundation_monthly', false,
      'acct_00000000000001', 'active', now(),
      'evt_enrollment_store1_2'
    )
  $$,
  '23505',
  null,
  'one store cannot have two current enrollments in one account and mode'
);

insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, stripe_subscription_id,
  initial_stripe_price_id, stripe_livemode, stripe_account_id,
  provider_status, is_current, provider_created_at, bound_by_event_id,
  ended_at
)
values
  (
    'a8100000-0000-4000-8000-000000000302',
    'a8100000-0000-4000-8000-000000000011',
    'a8100000-0000-4000-8000-000000000101',
    'sub_foundation_history', 'price_foundation_monthly', false,
    'acct_00000000000001', 'canceled', false, now(),
    'evt_enrollment_store1_2', now()
  ),
  (
    'a8100000-0000-4000-8000-000000000303',
    'a8100000-0000-4000-8000-000000000012',
    'a8100000-0000-4000-8000-000000000102',
    'sub_foundation_store2', 'price_foundation_monthly', false,
    'acct_00000000000001', 'trialing', true, now(),
    'evt_enrollment_store2_1', null
  );

select throws_ok(
  $$
    insert into public.seller_billing_status (
      store_id,
      current_subscription_enrollment_id
    ) values (
      'a8100000-0000-4000-8000-000000000011',
      'a8100000-0000-4000-8000-000000000303'
    )
  $$,
  '23503',
  null,
  'Store A billing cannot reference Store B enrollment'
);

select lives_ok(
  $$
    insert into public.seller_billing_status (
      store_id,
      current_subscription_enrollment_id
    ) values (
      'a8100000-0000-4000-8000-000000000011',
      'a8100000-0000-4000-8000-000000000301'
    )
  $$,
  'seller billing can reference an enrollment for the same store'
);

insert into public.billing_trial_claims (
  store_id, subscription_enrollment_id, trial_started_at,
  trial_ends_at, provider_event_id
)
values (
  'a8100000-0000-4000-8000-000000000011',
  'a8100000-0000-4000-8000-000000000301',
  now(), now() + interval '7 days', 'evt_enrollment_store1_1'
);

select throws_ok(
  $$
    insert into public.billing_trial_claims (
      store_id, subscription_enrollment_id, trial_started_at,
      trial_ends_at, provider_event_id
    ) values (
      'a8100000-0000-4000-8000-000000000011',
      'a8100000-0000-4000-8000-000000000302',
      now(), now() + interval '7 days', 'evt_enrollment_store1_2'
    )
  $$,
  '23505',
  null,
  'a store can claim only one trial ever'
);

select throws_ok(
  $$
    insert into public.billing_trial_claims (
      store_id, subscription_enrollment_id, trial_started_at,
      trial_ends_at, provider_event_id
    ) values (
      'a8100000-0000-4000-8000-000000000012',
      'a8100000-0000-4000-8000-000000000303',
      now(), now(), 'evt_enrollment_store2_1'
    )
  $$,
  '23514',
  null,
  'trial end must follow trial start'
);

select throws_ok(
  $$
    update public.billing_subscription_enrollments
    set stripe_subscription_id = 'sub_reassigned'
    where id = 'a8100000-0000-4000-8000-000000000301'
  $$,
  'P0001',
  'Billing Subscription enrollment binding fields are immutable.',
  'a bound Subscription identifier cannot be reassigned'
);

select lives_ok(
  $$
    insert into public.billing_provider_price_catalog (
      stripe_price_id, stripe_livemode, stripe_account_id, plan_key,
      billing_cadence, stripe_product_id, unit_amount_cents, currency,
      recurring_interval, recurring_interval_count
    ) values (
      'price_foundation_catalog', false, 'acct_00000000000001',
      'small_flock', 'monthly', 'prod_foundation_catalog', 500, 'usd',
      'month', 1
    )
  $$,
  'a fully described test Price catalog row is accepted'
);

select throws_ok(
  $$
    insert into public.billing_provider_price_catalog (
      stripe_price_id, stripe_livemode, stripe_account_id, plan_key,
      billing_cadence, stripe_product_id, unit_amount_cents, currency,
      recurring_interval, recurring_interval_count
    ) values (
      'price_foundation_bad_catalog', false, 'acct_00000000000001',
      'small_flock', 'monthly', ' ', -1, 'USD', 'week', 0
    )
  $$,
  '23514',
  null,
  'invalid Product, amount, currency, interval, and interval count are rejected'
);

select * from finish();

rollback;
