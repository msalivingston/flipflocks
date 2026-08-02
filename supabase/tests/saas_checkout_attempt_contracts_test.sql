begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_subscription_checkout_enabled'),
  false,
  'Checkout remains disabled after the Batch 5 migration'
);
select has_column('public', 'billing_checkout_attempts', 'checkout_environment_id', 'attempt environment column exists');
select has_column('public', 'billing_checkout_attempts', 'stripe_product_id', 'attempt Product column exists');
select has_column('public', 'billing_checkout_attempts', 'trial_eligibility', 'attempt trial decision column exists');
select ok(
  has_function_privilege(
    'service_role',
    'public.begin_saas_subscription_checkout(uuid,text,text,boolean,text,text)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.begin_saas_subscription_checkout(uuid,text,text,boolean,text,text)',
    'execute'
  ),
  'only service role may begin a Checkout attempt'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_saas_checkout_session(uuid,text,timestamptz,timestamptz,boolean,text,text)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.mark_saas_checkout_creation_failed(uuid,text)',
    'execute'
  ),
  'browser roles cannot record provider Session truth or creation failure'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  ('d5000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  format('batch5-owner-%s@example.test', value), '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
from generate_series(1, 7) as value;

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
)
select
  ('d5000000-0000-4000-9000-' || lpad(value::text, 12, '0'))::uuid,
  ('d5000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  format('Batch 5 Store %s', value), format('batch-5-store-%s', value),
  'draft', 'hosted', false
from generate_series(1, 7) as value;

insert into public.seller_onboarding_state (store_id, profile_complete)
select
  ('d5000000-0000-4000-9000-' || lpad(value::text, 12, '0'))::uuid,
  true
from generate_series(1, 7) as value;

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence,
  plan_key, billing_plan, subscription_status, billing_state_authority
)
select
  ('d5000000-0000-4000-9000-' || lpad(value::text, 12, '0'))::uuid,
  'small_flock', 'monthly', null, null, 'dormant', 'pending_checkout'
from unnest(array[1, 2, 3, 5, 6, 7]) as value;

update public.seller_onboarding_state
set billing_complete = true
where store_id = 'd5000000-0000-4000-9000-000000000004';
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence,
  plan_key, billing_plan, subscription_status, billing_state_authority,
  trial_started_at, trial_ends_at, current_period_start,
  current_period_end, storefront_access_until
) values (
  'd5000000-0000-4000-9000-000000000004',
  'small_flock', 'monthly', 'small_flock', 'monthly', 'trialing', 'trial',
  statement_timestamp() - interval '8 days',
  statement_timestamp() - interval '1 day',
  statement_timestamp() - interval '8 days',
  statement_timestamp() - interval '1 day',
  statement_timestamp() - interval '1 day'
);

insert into public.billing_provider_price_catalog (
  stripe_price_id, stripe_product_id, stripe_livemode, stripe_account_id,
  plan_key, billing_cadence, is_active, unit_amount_cents, currency,
  recurring_interval, recurring_interval_count, tax_behavior,
  stripe_product_tax_code, stripe_price_type, billing_scheme,
  recurring_usage_type, stripe_price_active, stripe_product_active,
  stripe_price_created_at, stripe_product_created_at, verified_at,
  verification_api_version
) values (
  'price_Batch5CoopMonthly', 'prod_Batch5Coop', false,
  'acct_1CTOghL1R5g4hhXt', 'small_flock', 'monthly', true,
  500, 'usd', 'month', 1, 'exclusive', 'txcd_10103001',
  'recurring', 'per_unit', 'licensed', true, true,
  timestamptz '2026-01-01 00:00:00+00',
  timestamptz '2026-01-01 00:00:00+00', statement_timestamp(),
  '2026-06-24.dahlia'
);

select throws_ok(
  $$select * from public.begin_saas_subscription_checkout(
    'd5000000-0000-4000-8000-000000000001', 'small_flock', 'monthly',
    false, 'acct_1CTOghL1R5g4hhXt', 'local')$$,
  '55000', 'SAAS_CHECKOUT_DISABLED',
  'the disabled flag blocks attempt creation'
);

update public.platform_settings
set boolean_value = true
where setting_key = 'saas_subscription_checkout_enabled';

create temporary table first_attempt as
select * from public.begin_saas_subscription_checkout(
  'd5000000-0000-4000-8000-000000000001', 'small_flock', 'monthly',
  false, 'acct_1CTOghL1R5g4hhXt', 'local'
);

select is((select checkout_state from first_attempt), 'created', 'first eligible attempt is created');
select is((select attempt_status from first_attempt), 'creating', 'new attempt starts in creating state');
select is((select trial_eligibility from first_attempt), 'trial_eligible', 'trial eligibility is derived as eligible');
select is((select stripe_price_id from first_attempt), 'price_Batch5CoopMonthly', 'trusted Price is resolved by the database');
select is((select stripe_product_id from first_attempt), 'prod_Batch5Coop', 'trusted Product is resolved with the Price');
select is(
  (select stripe_idempotency_key from first_attempt),
  'ff:saas_checkout:local:' || (select attempt_id::text from first_attempt) || ':v1',
  'local idempotency key is stable and contains no tenant identity'
);

create temporary table resumed_attempt as
select * from public.begin_saas_subscription_checkout(
  'd5000000-0000-4000-8000-000000000001', 'small_flock', 'monthly',
  false, 'acct_1CTOghL1R5g4hhXt', 'local'
);
select is((select checkout_state from resumed_attempt), 'resumable', 'same selection resumes the unresolved attempt');
select is((select attempt_id from resumed_attempt), (select attempt_id from first_attempt), 'resumption returns the same attempt');
select is(
  (select count(*)::integer from public.billing_checkout_attempts
   where store_id = 'd5000000-0000-4000-9000-000000000001'),
  1,
  'resumption creates no duplicate attempt'
);

select is(
  (select checkout_state from public.begin_saas_subscription_checkout(
    'd5000000-0000-4000-8000-000000000001', 'full_flock', 'monthly',
    false, 'acct_1CTOghL1R5g4hhXt', 'local')),
  'selection_conflict',
  'different intent cannot silently reuse or duplicate an unresolved Session'
);

select is(
  (select record_state from public.record_saas_checkout_session(
    (select attempt_id from first_attempt), 'cs_test_Batch5Recorded',
    timestamptz '2026-08-02 12:00:00+00',
    timestamptz '2026-08-03 12:00:00+00',
    false, 'acct_1CTOghL1R5g4hhXt', null)),
  'recorded',
  'service role records narrow Session creation evidence'
);
select is(
  (select attempt_status from public.billing_checkout_attempts
   where id = (select attempt_id from first_attempt)),
  'open',
  'recording transitions creating to open'
);
select is(
  (select record_state from public.record_saas_checkout_session(
    (select attempt_id from first_attempt), 'cs_test_Batch5Recorded',
    timestamptz '2026-08-02 12:00:00+00',
    timestamptz '2026-08-03 12:00:00+00',
    false, 'acct_1CTOghL1R5g4hhXt', null)),
  'already_recorded',
  'exact Session recording replay is idempotent'
);
select throws_ok(
  $$select * from public.record_saas_checkout_session(
    (select attempt_id from first_attempt), 'cs_test_Different',
    timestamptz '2026-08-02 12:00:00+00',
    timestamptz '2026-08-03 12:00:00+00',
    false, 'acct_1CTOghL1R5g4hhXt', null)$$,
  '55000', 'SAAS_CHECKOUT_SESSION_CONFLICT',
  'an attempt cannot receive a second Session identifier'
);
select throws_ok(
  $$select * from public.record_saas_checkout_session(
    (select attempt_id from first_attempt), 'cs_live_WrongMode',
    timestamptz '2026-08-02 12:00:00+00',
    timestamptz '2026-08-03 12:00:00+00',
    false, 'acct_1CTOghL1R5g4hhXt', null)$$,
  '22023', 'SAAS_CHECKOUT_SESSION_EVIDENCE_INVALID',
  'mode-mismatched Session identifiers are rejected'
);

select is(
  (select count(*)::integer from public.billing_trial_claims
   where store_id = 'd5000000-0000-4000-9000-000000000001'),
  0,
  'attempt and Session creation consume no trial claim'
);
select is(
  (select count(*)::integer from public.billing_subscription_enrollments
   where store_id = 'd5000000-0000-4000-9000-000000000001'),
  0,
  'attempt and Session creation create no subscription enrollment'
);
select is(
  (select count(*)::integer from public.billing_customer_bindings
   where store_id = 'd5000000-0000-4000-9000-000000000001'),
  0,
  'attempt and Session creation create no Customer binding'
);
select is(
  (select billing_complete from public.seller_onboarding_state
   where store_id = 'd5000000-0000-4000-9000-000000000001'),
  false,
  'attempt creation does not mark onboarding billing complete'
);
select is(
  (select has_active_access from public.resolve_store_entitlement(
    'd5000000-0000-4000-9000-000000000001')),
  false,
  'attempt creation grants no entitlement'
);

create temporary table failed_attempt as
select * from public.begin_saas_subscription_checkout(
  'd5000000-0000-4000-8000-000000000002', 'small_flock', 'monthly',
  false, 'acct_1CTOghL1R5g4hhXt', 'local'
);
select is(
  (select failure_state from public.mark_saas_checkout_creation_failed(
    (select attempt_id from failed_attempt), 'stripe_checkout_request_rejected')),
  'failed',
  'a bounded definitive creation failure closes a creating attempt'
);
select throws_ok(
  $$select * from public.mark_saas_checkout_creation_failed(
    (select attempt_id from failed_attempt), 'raw secret: sk_test_not_allowed')$$,
  '22023', 'SAAS_CHECKOUT_FAILURE_CODE_INVALID',
  'unbounded raw provider error text is rejected'
);

create temporary table retried_after_failure as
select * from public.begin_saas_subscription_checkout(
  'd5000000-0000-4000-8000-000000000002', 'small_flock', 'monthly',
  false, 'acct_1CTOghL1R5g4hhXt', 'local'
);
select is((select checkout_state from retried_after_failure), 'created', 'terminal failed attempt permits a new attempt');
select is((select trial_eligibility from retried_after_failure), 'trial_eligible', 'failed attempt remains trial-neutral');

create temporary table expired_trial_attempt as
select * from public.begin_saas_subscription_checkout(
  'd5000000-0000-4000-8000-000000000004', 'small_flock', 'monthly',
  false, 'acct_1CTOghL1R5g4hhXt', 'local'
);
select is((select trial_eligibility from expired_trial_attempt), 'trial_already_used', 'expired local trial history blocks another trial');

insert into public.billing_provider_events (
  stripe_livemode, stripe_account_id, provider_event_id,
  provider_event_created_at, store_id, event_type, payload_hash, applied
) values
  (false, 'acct_1CTOghL1R5g4hhXt', 'evt_Batch5Claim',
   now() - interval '10 days', 'd5000000-0000-4000-9000-000000000005',
   'customer.subscription.created', 'batch5-claim-hash', true),
  (false, 'acct_1CTOghL1R5g4hhXt', 'evt_Batch5Enrollment',
   now() - interval '10 days', 'd5000000-0000-4000-9000-000000000006',
   'customer.subscription.created', 'batch5-enrollment-hash', true);

insert into public.billing_customer_bindings (
  id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
  provider_created_at, bound_by_event_id
) values
  ('d5000000-0000-4000-a000-000000000005', 'd5000000-0000-4000-9000-000000000005',
   'cus_Batch5Claim', false, 'acct_1CTOghL1R5g4hhXt', now() - interval '10 days', 'evt_Batch5Claim'),
  ('d5000000-0000-4000-a000-000000000006', 'd5000000-0000-4000-9000-000000000006',
   'cus_Batch5Enrollment', false, 'acct_1CTOghL1R5g4hhXt', now() - interval '10 days', 'evt_Batch5Enrollment');

insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, stripe_subscription_id,
  initial_stripe_price_id, stripe_livemode, stripe_account_id,
  provider_status, trial_started_at, trial_ends_at, is_current,
  provider_created_at, bound_by_event_id, ended_at
) values
  ('d5000000-0000-4000-b000-000000000005', 'd5000000-0000-4000-9000-000000000005',
   'd5000000-0000-4000-a000-000000000005', 'sub_Batch5Claim',
   'price_Batch5CoopMonthly', false, 'acct_1CTOghL1R5g4hhXt', 'canceled',
   now() - interval '10 days', now() - interval '3 days', false,
   now() - interval '10 days', 'evt_Batch5Claim', now() - interval '2 days'),
  ('d5000000-0000-4000-b000-000000000006', 'd5000000-0000-4000-9000-000000000006',
   'd5000000-0000-4000-a000-000000000006', 'sub_Batch5Enrollment',
   'price_Batch5CoopMonthly', false, 'acct_1CTOghL1R5g4hhXt', 'canceled',
   now() - interval '10 days', now() - interval '3 days', false,
   now() - interval '10 days', 'evt_Batch5Enrollment', now() - interval '2 days');

insert into public.billing_trial_claims (
  store_id, subscription_enrollment_id, trial_started_at,
  trial_ends_at, provider_event_id
) values (
  'd5000000-0000-4000-9000-000000000005',
  'd5000000-0000-4000-b000-000000000005',
  now() - interval '10 days', now() - interval '3 days', 'evt_Batch5Claim'
);

select is(
  (select trial_eligibility from public.begin_saas_subscription_checkout(
    'd5000000-0000-4000-8000-000000000005', 'small_flock', 'monthly',
    false, 'acct_1CTOghL1R5g4hhXt', 'local')),
  'trial_already_used',
  'durable trial claim blocks another trial'
);
select is(
  (select trial_eligibility from public.begin_saas_subscription_checkout(
    'd5000000-0000-4000-8000-000000000006', 'small_flock', 'monthly',
    false, 'acct_1CTOghL1R5g4hhXt', 'local')),
  'trial_already_used',
  'verified enrollment trial timestamps block another trial without a claim'
);

insert into public.billing_checkout_attempts (
  id, store_id, created_by_user_id, requested_plan_key,
  requested_billing_cadence, stripe_price_id, stripe_product_id,
  stripe_livemode, stripe_account_id, checkout_environment_id,
  trial_eligibility, attempt_status, stripe_idempotency_key,
  session_created_at
)
select
  ('d5000000-0000-4000-c000-' || lpad(value::text, 12, '0'))::uuid,
  'd5000000-0000-4000-9000-000000000007',
  'd5000000-0000-4000-8000-000000000007',
  'small_flock', 'monthly', 'price_Batch5CoopMonthly', 'prod_Batch5Coop',
  false, 'acct_1CTOghL1R5g4hhXt', 'local', 'trial_eligible', 'failed',
  'ff:saas_checkout:local:' ||
    ('d5000000-0000-4000-c000-' || lpad(value::text, 12, '0'))::uuid::text || ':v1',
  statement_timestamp() - value * interval '1 minute'
from generate_series(1, 3) as value;

select is(
  (select checkout_state from public.begin_saas_subscription_checkout(
    'd5000000-0000-4000-8000-000000000007', 'small_flock', 'monthly',
    false, 'acct_1CTOghL1R5g4hhXt', 'local')),
  'rate_limited',
  'three newly created Sessions in fifteen minutes rate-limit another creation'
);
select is(
  (select count(*)::integer from public.billing_checkout_attempts
   where store_id = 'd5000000-0000-4000-9000-000000000007'),
  3,
  'rate limiting creates no additional attempt'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select * from public.begin_saas_subscription_checkout(
    'd5000000-0000-4000-8000-000000000003', 'small_flock', 'monthly',
    false, 'acct_1CTOghL1R5g4hhXt', 'local')$$,
  '42501', null,
  'authenticated callers cannot invoke the trusted begin contract'
);

select * from finish();
rollback;
