begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(
  has_function_privilege(
    'service_role',
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'apply_verified_saas_checkout_completion'),
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'apply_verified_saas_checkout_completion'),
    'execute'
  )
  and not has_function_privilege(
    'anon',
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'apply_verified_saas_checkout_completion'),
    'execute'
  ),
  'verified Checkout application is service-role only'
);

select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_subscription_checkout_enabled'),
  false,
  'Checkout feature flag remains false'
);
select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_billing_portal_enabled'),
  false,
  'Billing Portal feature flag remains false'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  'e7000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'batch7-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'e7000000-0000-4000-9000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'Batch 7 Store', 'batch-7-store', 'draft', 'hosted', false
);

insert into public.seller_onboarding_state (store_id, profile_complete)
values ('e7000000-0000-4000-9000-000000000001', true);

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence,
  plan_key, billing_plan, subscription_status, billing_state_authority
) values (
  'e7000000-0000-4000-9000-000000000001',
  'small_flock', 'monthly', null, null, 'dormant', 'pending_checkout'
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
  'price_Batch7CoopMonthly', 'prod_Batch7Coop', false,
  'acct_1CTOghL1R5g4hhXt', 'small_flock', 'monthly', true,
  500, 'usd', 'month', 1, 'exclusive', 'txcd_10103001',
  'recurring', 'per_unit', 'licensed', true, true,
  statement_timestamp() - interval '1 day',
  statement_timestamp() - interval '1 day', statement_timestamp(),
  '2026-06-24.dahlia'
);

insert into public.billing_checkout_attempts (
  id, store_id, created_by_user_id, requested_plan_key,
  requested_billing_cadence, stripe_price_id, stripe_product_id,
  stripe_livemode, stripe_account_id, checkout_environment_id,
  trial_eligibility, attempt_status, stripe_checkout_session_id,
  stripe_idempotency_key, session_created_at, session_expires_at
) values (
  'e7000000-0000-4000-a000-000000000001',
  'e7000000-0000-4000-9000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'small_flock', 'monthly', 'price_Batch7CoopMonthly',
  'prod_Batch7Coop', false, 'acct_1CTOghL1R5g4hhXt', 'local',
  'trial_eligible', 'open', 'cs_test_Batch7Trial',
  'ff:saas_checkout:local:e7000000-0000-4000-a000-000000000001:v1',
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() + interval '23 hours'
);

create temporary table batch7_receipt_claim as
select * from public.claim_saas_billing_provider_event(
  'evt_Batch7Trial', 'checkout.session.completed',
  statement_timestamp() - interval '1 minute', repeat('7', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'checkout.session', 'cs_test_Batch7Trial'
);
select is(
  public.mark_saas_billing_provider_event_deferred(
    'evt_Batch7Trial', repeat('7', 64), 'acct_1CTOghL1R5g4hhXt', false,
    (select processing_lease_token from batch7_receipt_claim),
    'awaiting_verified_enrollment_batch'
  ),
  'deferred',
  'verified completion is deferred before domain reconciliation'
);
create temporary table batch7_reconciliation_claim as
select * from public.claim_deferred_saas_billing_provider_event(
  'evt_Batch7Trial', repeat('7', 64), 'acct_1CTOghL1R5g4hhXt', false,
  'local', 'checkout.session.completed', 'checkout.session',
  'cs_test_Batch7Trial'
);

create function pg_temp.batch7_apply(
  p_event_id text,
  p_hash text,
  p_token uuid,
  p_attempt_id uuid,
  p_session_override text default null,
  p_customer_override text default null,
  p_subscription_override text default null,
  p_price_override text default null,
  p_product_override text default null,
  p_account_override text default null,
  p_livemode_override boolean default null,
  p_environment_override text default null,
  p_metadata_store_override text default null,
  p_metadata_plan_override text default null,
  p_metadata_cadence_override text default null,
  p_payment_method_ready boolean default true,
  p_trial_duration interval default interval '7 days',
  p_trial_checkout boolean default true
)
returns table (
  application_state text,
  store_id uuid,
  customer_binding_id uuid,
  subscription_enrollment_id uuid,
  trial_claimed boolean,
  billing_complete boolean
)
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_attempt public.billing_checkout_attempts%rowtype;
  v_event public.billing_provider_events%rowtype;
  v_account text;
  v_livemode boolean;
  v_environment text;
  v_session text;
  v_customer text;
  v_subscription text;
  v_price text;
  v_product text;
  v_trial_start timestamptz;
  v_trial_end timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  select * into v_attempt from public.billing_checkout_attempts
  where id = p_attempt_id;
  select * into v_event from public.billing_provider_events
  where provider_event_id = p_event_id
  order by created_at limit 1;
  v_account := coalesce(p_account_override, v_attempt.stripe_account_id);
  v_livemode := coalesce(p_livemode_override, v_attempt.stripe_livemode);
  v_environment := coalesce(
    p_environment_override, v_attempt.checkout_environment_id
  );
  v_session := coalesce(p_session_override, v_attempt.stripe_checkout_session_id);
  v_customer := coalesce(p_customer_override, 'cus_Batch7Trial');
  v_subscription := coalesce(p_subscription_override, 'sub_Batch7Trial');
  v_price := coalesce(p_price_override, v_attempt.stripe_price_id);
  v_product := coalesce(p_product_override, v_attempt.stripe_product_id);
  v_trial_start := case when p_trial_checkout
    then v_event.provider_event_created_at else null end;
  v_trial_end := case when p_trial_checkout
    then v_event.provider_event_created_at + p_trial_duration else null end;
  v_period_start := coalesce(v_trial_start, v_event.provider_event_created_at);
  v_period_end := coalesce(v_trial_end, v_event.provider_event_created_at + interval '30 days');

  return query
  select * from public.apply_verified_saas_checkout_completion(
    p_event_id, p_hash, p_token, v_account, v_livemode, v_environment,
    v_event.provider_event_created_at,
    v_session, v_attempt.session_created_at, v_attempt.session_expires_at,
    'complete', 'subscription',
    case when p_trial_checkout then 'no_payment_required' else 'paid' end,
    'always', v_attempt.id::text, v_livemode, v_attempt.id,
    v_attempt.id::text,
    coalesce(p_metadata_store_override, v_attempt.store_id::text),
    v_environment,
    coalesce(p_metadata_plan_override, v_attempt.requested_plan_key),
    coalesce(p_metadata_cadence_override, v_attempt.requested_billing_cadence),
    'ff_saas_checkout_v1',
    v_customer, v_attempt.session_created_at, v_livemode,
    v_subscription,
    case when p_trial_checkout then 'trialing' else 'active' end,
    v_attempt.session_created_at, v_trial_start, v_trial_end,
    v_period_start, v_period_end, false, v_livemode,
    'charge_automatically', p_payment_method_ready,
    v_attempt.id::text,
    coalesce(p_metadata_store_override, v_attempt.store_id::text),
    v_environment,
    coalesce(p_metadata_plan_override, v_attempt.requested_plan_key),
    coalesce(p_metadata_cadence_override, v_attempt.requested_billing_cadence),
    'ff_saas_checkout_v1',
    v_price, v_product, 1, v_livemode, v_livemode, true, true,
    500, 'usd', 'month', 1, 'recurring', 'per_unit', 'licensed',
    'exclusive', 'txcd_10103001'
  );
end;
$function$;

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select * from pg_temp.batch7_apply(
    'evt_Batch7Trial', repeat('7', 64),
    (select processing_lease_token from batch7_reconciliation_claim),
    'e7000000-0000-4000-a000-000000000001')$$,
  '42501', 'SAAS_ENROLLMENT_SERVICE_ROLE_REQUIRED',
  'authenticated and platform-admin browser authority cannot apply enrollment'
);
select set_config('request.jwt.claim.role', 'service_role', true);

select throws_ok(
  $$select * from pg_temp.batch7_apply(
    'evt_Batch7Trial', repeat('7', 64), gen_random_uuid(),
    'e7000000-0000-4000-a000-000000000001')$$,
  '55000', 'SAAS_ENROLLMENT_EVENT_CLAIM_INVALID',
  'wrong fencing token is rejected'
);
select throws_ok(
  $$select * from pg_temp.batch7_apply(
    'evt_Batch7Trial', repeat('8', 64),
    (select processing_lease_token from batch7_reconciliation_claim),
    'e7000000-0000-4000-a000-000000000001')$$,
  '55000', 'SAAS_ENROLLMENT_EVENT_CLAIM_INVALID',
  'wrong payload hash is rejected'
);
select throws_ok(
  $$select * from pg_temp.batch7_apply(
    'evt_Batch7Trial', repeat('7', 64),
    (select processing_lease_token from batch7_reconciliation_claim),
    'e7000000-0000-4000-a000-000000000001',
    p_session_override => 'cs_test_Wrong')$$,
  '55000', 'SAAS_ENROLLMENT_EVENT_CLAIM_INVALID',
  'wrong provider Checkout object is rejected'
);
select throws_ok(
  $$select * from pg_temp.batch7_apply(
    'evt_Batch7Trial', repeat('7', 64),
    (select processing_lease_token from batch7_reconciliation_claim),
    'e7000000-0000-4000-a000-000000000001',
    p_price_override => 'price_Wrong')$$,
  '55000', 'SAAS_ENROLLMENT_ATTEMPT_CONFLICT',
  'Price must match the immutable Checkout attempt'
);
select throws_ok(
  $$select * from pg_temp.batch7_apply(
    'evt_Batch7Trial', repeat('7', 64),
    (select processing_lease_token from batch7_reconciliation_claim),
    'e7000000-0000-4000-a000-000000000001',
    p_product_override => 'prod_Wrong')$$,
  '55000', 'SAAS_ENROLLMENT_ATTEMPT_CONFLICT',
  'Product must match the immutable Checkout attempt'
);
select throws_ok(
  $$select * from pg_temp.batch7_apply(
    'evt_Batch7Trial', repeat('7', 64),
    (select processing_lease_token from batch7_reconciliation_claim),
    'e7000000-0000-4000-a000-000000000001',
    p_metadata_store_override =>
      'e7000000-0000-4000-9000-000000000099')$$,
  '55000', 'SAAS_ENROLLMENT_METADATA_CONFLICT',
  'metadata cannot rebind the attempt to another store'
);
select throws_ok(
  $$select * from pg_temp.batch7_apply(
    'evt_Batch7Trial', repeat('7', 64),
    (select processing_lease_token from batch7_reconciliation_claim),
    'e7000000-0000-4000-a000-000000000001',
    p_payment_method_ready => false)$$,
  '22023', 'SAAS_ENROLLMENT_EVIDENCE_INVALID',
  'missing automatic-payment readiness is rejected'
);
select throws_ok(
  $$select * from pg_temp.batch7_apply(
    'evt_Batch7Trial', repeat('7', 64),
    (select processing_lease_token from batch7_reconciliation_claim),
    'e7000000-0000-4000-a000-000000000001',
    p_trial_duration => interval '7 days 6 minutes')$$,
  '55000', 'SAAS_ENROLLMENT_TRIAL_CONFLICT',
  'provider trial longer than seven days plus tolerance is rejected'
);

create temporary table batch7_application as
select * from pg_temp.batch7_apply(
  'evt_Batch7Trial', repeat('7', 64),
  (select processing_lease_token from batch7_reconciliation_claim),
  'e7000000-0000-4000-a000-000000000001'
);

select is((select application_state from batch7_application), 'trial_enrolled',
  'verified trial completion applies atomically');
select is((select trial_claimed from batch7_application), true,
  'verified provider trial creates a durable trial claim');
select is((select billing_complete from batch7_application), true,
  'verified provider trial completes onboarding billing');
select is(
  (select count(*)::integer from public.billing_customer_bindings
   where store_id = 'e7000000-0000-4000-9000-000000000001'),
  1,
  'one immutable Customer binding is created'
);
select is(
  (select count(*)::integer from public.billing_subscription_enrollments
   where store_id = 'e7000000-0000-4000-9000-000000000001'),
  1,
  'one immutable Subscription enrollment is created'
);
select is(
  (select count(*)::integer from public.billing_trial_claims
   where store_id = 'e7000000-0000-4000-9000-000000000001'),
  1,
  'one durable one-trial claim is created'
);
select is(
  (select plan_key from public.seller_billing_status
   where store_id = 'e7000000-0000-4000-9000-000000000001'),
  'small_flock',
  'effective plan comes from the verified catalog'
);
select is(
  (select billing_plan from public.seller_billing_status
   where store_id = 'e7000000-0000-4000-9000-000000000001'),
  'monthly',
  'effective cadence comes from the verified catalog'
);
select is(
  (select attempt_status from public.billing_checkout_attempts
   where id = 'e7000000-0000-4000-a000-000000000001'),
  'enrolled',
  'Checkout attempt becomes enrolled'
);
select is(
  (select processing_status from public.billing_provider_events
   where provider_event_id = 'evt_Batch7Trial'),
  'processed',
  'deferred event becomes processed in the enrollment transaction'
);
select is(
  (select applied from public.billing_provider_events
   where provider_event_id = 'evt_Batch7Trial'),
  true,
  'processed event is marked domain-applied'
);
select is(
  (select has_active_access from public.resolve_store_entitlement(
    'e7000000-0000-4000-9000-000000000001')),
  true,
  'verified enrollment-backed trial grants canonical resolver access'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'e7000000-0000-4000-9000-000000000001')),
  'stripe_trial',
  'verified provider trial has a distinct resolver reason'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'e7000000-0000-4000-9000-000000000001'),
  null::timestamptz,
  'Checkout completion grants no paid-through authority'
);
select is(
  (select storefront_enabled from public.stores
   where id = 'e7000000-0000-4000-9000-000000000001'),
  false,
  'verified trial does not change the seller storefront preference'
);
select ok(
  (select count(*) >= 6 from public.billing_entitlement_events
   where store_id = 'e7000000-0000-4000-9000-000000000001'
     and provider_event_id = 'evt_Batch7Trial'),
  'typed enrollment and entitlement audit events are written'
);
select is(
  (select reconciliation_state
   from public.claim_deferred_saas_billing_provider_event(
     'evt_Batch7Trial', repeat('7', 64), 'acct_1CTOghL1R5g4hhXt', false,
     'local', 'checkout.session.completed', 'checkout.session',
     'cs_test_Batch7Trial')),
  'already_processed',
  'exact duplicate completion is idempotent and cannot be reapplied'
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'e7000000-0000-4000-9000-000000000002',
  'e7000000-0000-4000-8000-000000000001',
  'Batch 7 Trial Used Store', 'batch-7-trial-used', 'draft', 'hosted', false
);
insert into public.seller_onboarding_state (
  store_id, profile_complete, billing_complete
) values ('e7000000-0000-4000-9000-000000000002', true, true);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence,
  plan_key, billing_plan, subscription_status, billing_state_authority,
  trial_started_at, trial_ends_at, current_period_start, current_period_end,
  storefront_access_until
) values (
  'e7000000-0000-4000-9000-000000000002',
  'small_flock', 'monthly', 'small_flock', 'monthly', 'trialing', 'trial',
  statement_timestamp() - interval '8 days',
  statement_timestamp() - interval '1 day',
  statement_timestamp() - interval '8 days',
  statement_timestamp() - interval '1 day',
  statement_timestamp() - interval '1 day'
);
insert into public.billing_checkout_attempts (
  id, store_id, created_by_user_id, requested_plan_key,
  requested_billing_cadence, stripe_price_id, stripe_product_id,
  stripe_livemode, stripe_account_id, checkout_environment_id,
  trial_eligibility, attempt_status, stripe_checkout_session_id,
  stripe_idempotency_key, session_created_at, session_expires_at
) values (
  'e7000000-0000-4000-a000-000000000002',
  'e7000000-0000-4000-9000-000000000002',
  'e7000000-0000-4000-8000-000000000001',
  'small_flock', 'monthly', 'price_Batch7CoopMonthly',
  'prod_Batch7Coop', false, 'acct_1CTOghL1R5g4hhXt', 'local',
  'trial_already_used', 'open', 'cs_test_Batch7Paid',
  'ff:saas_checkout:local:e7000000-0000-4000-a000-000000000002:v1',
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() + interval '23 hours'
);
create temporary table batch7_paid_receipt as
select * from public.claim_saas_billing_provider_event(
  'evt_Batch7Paid', 'checkout.session.completed',
  statement_timestamp() - interval '1 minute', repeat('6', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'checkout.session', 'cs_test_Batch7Paid'
);
select public.mark_saas_billing_provider_event_deferred(
  'evt_Batch7Paid', repeat('6', 64), 'acct_1CTOghL1R5g4hhXt', false,
  (select processing_lease_token from batch7_paid_receipt),
  'awaiting_verified_enrollment_batch'
);
create temporary table batch7_paid_reconciliation as
select * from public.claim_deferred_saas_billing_provider_event(
  'evt_Batch7Paid', repeat('6', 64), 'acct_1CTOghL1R5g4hhXt', false,
  'local', 'checkout.session.completed', 'checkout.session',
  'cs_test_Batch7Paid'
);
create temporary table batch7_paid_application as
select * from pg_temp.batch7_apply(
  'evt_Batch7Paid', repeat('6', 64),
  (select processing_lease_token from batch7_paid_reconciliation),
  'e7000000-0000-4000-a000-000000000002',
  p_customer_override => 'cus_Batch7Paid',
  p_subscription_override => 'sub_Batch7Paid',
  p_trial_checkout => false
);
select is(
  (select application_state from batch7_paid_application),
  'paid_enrollment_pending_invoice',
  'trial-used completion creates only a paid enrollment pending invoice authority'
);
select is((select trial_claimed from batch7_paid_application), false,
  'trial-used completion creates no second trial claim');
select is((select billing_complete from batch7_paid_application), false,
  'trial-used enrollment remains onboarding-incomplete until invoice authority');
select is(
  (select count(*)::integer from public.billing_trial_claims
   where store_id = 'e7000000-0000-4000-9000-000000000002'),
  0,
  'trial-used enrollment has no provider trial claim'
);
select is(
  (select has_active_access from public.resolve_store_entitlement(
    'e7000000-0000-4000-9000-000000000002')),
  false,
  'trial-used Checkout completion grants no entitlement before a paid invoice'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'e7000000-0000-4000-9000-000000000002'),
  null::timestamptz,
  'trial-used Checkout completion writes no paid-through timestamp'
);

update public.stores
set admin_hold_reason = 'batch7 regression hold'
where id = 'e7000000-0000-4000-9000-000000000001';
select is(
  (select has_active_access from public.resolve_store_entitlement(
    'e7000000-0000-4000-9000-000000000001')),
  false,
  'administrative hold overrides verified trial access'
);

select * from finish();
rollback;
