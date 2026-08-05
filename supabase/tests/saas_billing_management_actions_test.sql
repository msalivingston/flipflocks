begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select has_table('public', 'billing_management_action_requests', 'billing action audit table exists');
select has_column('public', 'billing_management_action_requests', 'subscription_enrollment_id', 'actions bind an immutable enrollment');
select has_column('public', 'billing_management_action_requests', 'stripe_idempotency_key', 'resume idempotency evidence is typed');
select has_table('public', 'saas_billing_portal_store_cohort', 'controlled Portal cohort table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.saas_billing_portal_store_cohort'::regclass), 'Portal cohort RLS is enabled');
select fk_ok(
  'public', 'saas_billing_portal_store_cohort', 'store_id',
  'public', 'stores', 'id', 'cohort identity is bound to a real store'
);
select is(
  (select count(*) from public.saas_billing_portal_store_cohort),
  0::bigint, 'deployment migration enrolls no store into the cohort'
);
select ok((select relrowsecurity from pg_class where oid = 'public.billing_management_action_requests'::regclass), 'action audit RLS is enabled');
select ok(
  has_function_privilege('service_role', 'public.begin_saas_billing_portal_action(uuid,text,boolean,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.begin_saas_billing_portal_action(uuid,text,boolean,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.begin_saas_billing_portal_action(uuid,text,boolean,text,text)', 'execute'),
  'Portal authorization is service-role only'
);
select ok(
  has_function_privilege('service_role', 'public.begin_saas_subscription_resume(uuid,boolean,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.begin_saas_subscription_resume(uuid,boolean,text,text)', 'execute'),
  'resume authorization is service-role only and platform administrators have no browser execution grant'
);
select is((select boolean_value from public.platform_settings where setting_key = 'saas_subscription_checkout_enabled'), false, 'Checkout remains disabled');
select is((select boolean_value from public.platform_settings where setting_key = 'saas_billing_portal_enabled'), false, 'Billing Portal remains disabled');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  'fa000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'batch10-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);
insert into public.user_roles (user_id, role, store_id) values
  ('fa000000-0000-4000-8000-000000000001', 'admin', null);
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  'fa000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'batch10-other@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);
insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'fa000000-0000-4000-9000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'Batch 10 Store', 'batch-10-store', 'draft', 'hosted', false
);
insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'fa000000-0000-4000-9000-000000000002',
  'fa000000-0000-4000-8000-000000000002',
  'Batch 10 Other Store', 'batch-10-other-store', 'draft', 'hosted', false
);
insert into public.seller_onboarding_state (store_id, profile_complete, billing_complete)
values ('fa000000-0000-4000-9000-000000000001', true, true);
insert into public.billing_provider_price_catalog (
  stripe_price_id, stripe_product_id, stripe_livemode, stripe_account_id,
  plan_key, billing_cadence, is_active, unit_amount_cents, currency,
  recurring_interval, recurring_interval_count, tax_behavior,
  stripe_product_tax_code, stripe_price_type, billing_scheme,
  recurring_usage_type, stripe_price_active, stripe_product_active,
  stripe_price_created_at, stripe_product_created_at, verified_at,
  verification_api_version
) values (
  'price_Batch10Coop', 'prod_Batch10Coop', false,
  'acct_1CTOghL1R5g4hhXt', 'small_flock', 'monthly', true,
  500, 'usd', 'month', 1, 'exclusive', 'txcd_10103001',
  'recurring', 'per_unit', 'licensed', true, true,
  statement_timestamp() - interval '1 day',
  statement_timestamp() - interval '1 day', statement_timestamp(),
  '2026-06-24.dahlia'
);
select * from public.claim_saas_billing_provider_event(
  'evt_Batch10Trial', 'checkout.session.completed',
  statement_timestamp() - interval '1 day', repeat('a', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'checkout.session', 'cs_test_Batch10'
);
update public.billing_provider_events
set store_id = 'fa000000-0000-4000-9000-000000000001'
where provider_event_id = 'evt_Batch10Trial'
  and stripe_account_id = 'acct_1CTOghL1R5g4hhXt'
  and not stripe_livemode;
insert into public.billing_customer_bindings (
  id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
  provider_created_at, bound_by_event_id
) values (
  'fa000000-0000-4000-a000-000000000001',
  'fa000000-0000-4000-9000-000000000001', 'cus_Batch10', false,
  'acct_1CTOghL1R5g4hhXt', statement_timestamp() - interval '1 day',
  'evt_Batch10Trial'
);
insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, stripe_subscription_id,
  initial_stripe_price_id, stripe_livemode, stripe_account_id,
  provider_status, trial_started_at, trial_ends_at, cancel_at_period_end,
  is_current, provider_created_at, bound_by_event_id
) values (
  'fa000000-0000-4000-b000-000000000001',
  'fa000000-0000-4000-9000-000000000001',
  'fa000000-0000-4000-a000-000000000001', 'sub_Batch10',
  'price_Batch10Coop', false, 'acct_1CTOghL1R5g4hhXt', 'trialing',
  transaction_timestamp() - interval '1 day', transaction_timestamp() + interval '6 days',
  true, true, transaction_timestamp() - interval '1 day', 'evt_Batch10Trial'
);
insert into public.billing_trial_claims (
  store_id, subscription_enrollment_id, trial_started_at, trial_ends_at,
  provider_event_id, claimed_at
) values (
  'fa000000-0000-4000-9000-000000000001',
  'fa000000-0000-4000-b000-000000000001',
  transaction_timestamp() - interval '1 day', transaction_timestamp() + interval '6 days',
  'evt_Batch10Trial', transaction_timestamp() - interval '1 day'
);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, billing_state_authority,
  stripe_customer_id, stripe_subscription_id, stripe_price_id,
  stripe_livemode, stripe_account_id, current_subscription_enrollment_id,
  trial_started_at, trial_ends_at, current_period_start, current_period_end,
  storefront_access_until, cancel_at_period_end
) values (
  'fa000000-0000-4000-9000-000000000001', 'small_flock', 'monthly',
  'small_flock', 'monthly', 'trialing', 'stripe', 'cus_Batch10',
  'sub_Batch10', 'price_Batch10Coop', false, 'acct_1CTOghL1R5g4hhXt',
  'fa000000-0000-4000-b000-000000000001',
  transaction_timestamp() - interval '1 day', transaction_timestamp() + interval '6 days',
  transaction_timestamp() - interval '1 day', transaction_timestamp() + interval '6 days',
  transaction_timestamp() + interval '6 days', true
);

create temporary table batch10_trial_boundary as
select trial_started_at, trial_ends_at
from public.seller_billing_status
where store_id = 'fa000000-0000-4000-9000-000000000001';

create function pg_temp.batch10_claim_subscription(
  p_event_id text,
  p_created_at timestamptz default statement_timestamp(),
  p_environment_id text default 'local'
) returns uuid
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_receipt record;
  v_reconciliation record;
begin
  select * into v_receipt from public.claim_saas_billing_provider_event(
    p_event_id, 'customer.subscription.updated', p_created_at, repeat('c', 64),
    'acct_1CTOghL1R5g4hhXt', false, p_environment_id,
    'subscription', 'sub_Batch10'
  );
  perform public.mark_saas_billing_provider_event_deferred(
    p_event_id, repeat('c', 64), 'acct_1CTOghL1R5g4hhXt', false,
    v_receipt.processing_lease_token, 'awaiting_verified_enrollment_batch'
  );
  select * into v_reconciliation
  from public.claim_deferred_saas_billing_provider_event(
    p_event_id, repeat('c', 64), 'acct_1CTOghL1R5g4hhXt', false,
    p_environment_id, 'customer.subscription.updated', 'subscription', 'sub_Batch10'
  );
  return v_reconciliation.processing_lease_token;
end;
$function$;

create function pg_temp.batch10_apply_subscription(
  p_event_id text,
  p_token uuid,
  p_cancel_at_period_end boolean,
  p_cancel_at timestamptz default null,
  p_environment_id text default 'local'
) returns table (
  application_state text, store_id uuid, subscription_status text,
  paid_through_at timestamptz, grace_ends_at timestamptz
)
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
begin
  select * into v_event from public.billing_provider_events
  where provider_event_id = p_event_id order by created_at limit 1;
  select * into v_enrollment from public.billing_subscription_enrollments
  where id = 'fa000000-0000-4000-b000-000000000001';
  return query select * from public.apply_verified_stripe_subscription_event(
    p_provider_event_id => p_event_id,
    p_payload_hash => repeat('c', 64),
    p_processing_lease_token => p_token,
    p_stripe_account_id => 'acct_1CTOghL1R5g4hhXt',
    p_stripe_livemode => false,
    p_environment_id => p_environment_id,
    p_provider_event_created_at => v_event.provider_event_created_at,
    p_event_type => 'customer.subscription.updated',
    p_stripe_subscription_id => 'sub_Batch10',
    p_subscription_livemode => false,
    p_stripe_customer_id => 'cus_Batch10',
    p_stripe_price_id => 'price_Batch10Coop',
    p_stripe_product_id => 'prod_Batch10Coop',
    p_subscription_status => 'trialing',
    p_current_period_start => v_enrollment.trial_started_at,
    p_current_period_end => v_enrollment.trial_ends_at,
    p_cancel_at_period_end => p_cancel_at_period_end,
    p_subscription_cancel_at => p_cancel_at,
    p_subscription_created_at => v_enrollment.provider_created_at,
    p_subscription_canceled_at => null,
    p_subscription_ended_at => null,
    p_line_quantity => 1,
    p_price_livemode => false,
    p_product_livemode => false,
    p_price_active => true,
    p_product_active => true,
    p_unit_amount_cents => 500,
    p_currency => 'usd',
    p_recurring_interval => 'month',
    p_recurring_interval_count => 1,
    p_price_type => 'recurring',
    p_billing_scheme => 'per_unit',
    p_recurring_usage_type => 'licensed',
    p_tax_behavior => 'exclusive',
    p_product_tax_code => 'txcd_10103001'
  );
end;
$function$;

select is(
  public.set_saas_billing_portal_store_cohort(
    'fa000000-0000-4000-9000-000000000001', true
  ), 'activated', 'service role can activate one controlled cohort store'
);

select throws_ok(
  $$select * from public.begin_saas_billing_portal_action(
    'fa000000-0000-4000-8000-000000000001', 'portal_general', false,
    'acct_1CTOghL1R5g4hhXt', 'local')$$,
  '55000', 'SAAS_BILLING_PORTAL_DISABLED', 'disabled Portal blocks action creation'
);
update public.platform_settings set boolean_value = true
where setting_key = 'saas_billing_portal_enabled';

select throws_ok(
  $$select * from public.begin_saas_billing_portal_action(
    'fa000000-0000-4000-8000-000000000002', 'portal_general', false,
    'acct_1CTOghL1R5g4hhXt', 'local')$$,
  '55000', 'SAAS_BILLING_PORTAL_COHORT_REQUIRED',
  'global flag without same-store cohort remains blocked'
);
select is(
  public.set_saas_billing_portal_store_cohort(
    'fa000000-0000-4000-9000-000000000001', false
  ), 'revoked', 'cohort access can be revoked without deleting history'
);
select throws_ok(
  $$select * from public.begin_saas_billing_portal_action(
    'fa000000-0000-4000-8000-000000000001', 'portal_general', false,
    'acct_1CTOghL1R5g4hhXt', 'local')$$,
  '55000', 'SAAS_BILLING_PORTAL_COHORT_REQUIRED',
  'revoked cohort remains blocked'
);
select is(
  public.set_saas_billing_portal_store_cohort(
    'fa000000-0000-4000-9000-000000000001', true
  ), 'activated', 'reactivation appends a fresh cohort record'
);
select is(
  (select count(*) from public.saas_billing_portal_store_cohort
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  2::bigint, 'cohort revocation history is preserved'
);

select throws_ok(
  $$select * from public.begin_saas_billing_portal_action(
    'fa000000-0000-4000-8000-000000000001', 'unknown', false,
    'acct_1CTOghL1R5g4hhXt', 'local')$$,
  '22023', 'BILLING_MANAGEMENT_ACTION_INVALID', 'unknown Portal action is rejected'
);
select throws_ok(
  $$select * from public.begin_saas_billing_portal_action(
    'fa000000-0000-4000-8000-000000000099', 'portal_general', false,
    'acct_1CTOghL1R5g4hhXt', 'local')$$,
  '42501', 'BILLING_MANAGEMENT_STORE_NOT_OWNED', 'nonowner is rejected'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000001', true);
select is(
  (select portal_enabled from public.seller_get_saas_billing_status()),
  true, 'master flag plus same-store cohort exposes Portal in the read model'
);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'trial_canceling_at_period_end',
  'active canceling verified trial maps to the resumable presentation state'
);
select is(
  (select has_active_access from public.seller_get_saas_billing_status()),
  true, 'canceling trial remains entitled through its verified trial boundary'
);
select set_config('request.jwt.claim.role', 'service_role', true);
update public.billing_subscription_enrollments
set cancel_at_period_end = false
where id = 'fa000000-0000-4000-b000-000000000001';
update public.seller_billing_status
set cancel_at_period_end = false
where store_id = 'fa000000-0000-4000-9000-000000000001';
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'trial_active', 'normal verified trial remains distinct from canceling trial'
);
select set_config('request.jwt.claim.role', 'service_role', true);
update public.seller_billing_status
set payment_failure_started_at = statement_timestamp()
where store_id = 'fa000000-0000-4000-9000-000000000001';
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'trial_payment_problem', 'trial payment problem remains a distinct presentation state'
);
select set_config('request.jwt.claim.role', 'service_role', true);
update public.billing_subscription_enrollments
set cancel_at_period_end = true
where id = 'fa000000-0000-4000-b000-000000000001';
update public.seller_billing_status
set cancel_at_period_end = true,
    payment_failure_started_at = null
where store_id = 'fa000000-0000-4000-9000-000000000001';

create temporary table batch10_explicit_cancel_claim as
select pg_temp.batch10_claim_subscription(
  'evt_Batch10ExplicitCancel', statement_timestamp() + interval '1 second'
) as token;
select is(
  (select application_state from pg_temp.batch10_apply_subscription(
    'evt_Batch10ExplicitCancel',
    (select token from batch10_explicit_cancel_claim), false,
    (select trial_ends_at from batch10_trial_boundary)
  )),
  'snapshot_applied',
  'provider cancel_at exactly matching trial and period end is normalized as scheduled cancellation'
);
select is(
  (select provider_cancel_at_period_end from public.seller_billing_status
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  false, 'literal provider cancel_at_period_end remains separately false'
);
select is(
  (select provider_cancel_at from public.seller_billing_status
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  (select trial_ends_at from batch10_trial_boundary),
  'literal provider cancel_at boundary is preserved'
);
select is(
  (select cancel_at_period_end from public.seller_billing_status
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  true, 'normalized scheduled-cancellation state remains true'
);

create temporary table batch10_bad_cancel_claim as
select pg_temp.batch10_claim_subscription(
  'evt_Batch10BadCancel', statement_timestamp() + interval '2 seconds'
) as token;
select throws_ok(
  $$select * from pg_temp.batch10_apply_subscription(
    'evt_Batch10BadCancel',
    (select token from batch10_bad_cancel_claim), false,
    (select trial_ends_at from batch10_trial_boundary) - interval '1 second'
  )$$,
  '55000', 'SAAS_SUBSCRIPTION_CANCEL_AT_MISMATCH',
  'arbitrary provider cancel_at boundary fails closed'
);

create temporary table batch10_portal as
select * from public.begin_saas_billing_portal_action(
  'fa000000-0000-4000-8000-000000000001', 'portal_general', false,
  'acct_1CTOghL1R5g4hhXt', 'local'
);
select is((select action_state from batch10_portal), 'created', 'eligible owner receives a Portal authorization');
select is((select stripe_customer_id from batch10_portal), 'cus_Batch10', 'Customer is derived from immutable binding');
select is((select stripe_subscription_id from batch10_portal), 'sub_Batch10', 'Subscription is derived from immutable enrollment');
select is(
  public.record_saas_billing_portal_session(
    (select action_request_id from batch10_portal), 'bps_Batch10', 'bpc_Batch10General', statement_timestamp()
  ), 'recorded', 'service role records narrow Portal Session evidence'
);
select is(
  public.record_saas_billing_portal_session(
    (select action_request_id from batch10_portal), 'bps_Batch10', 'bpc_Batch10General', statement_timestamp()
  ), 'already_recorded', 'exact Portal Session replay is idempotent'
);
select is((select cancel_at_period_end from public.seller_billing_status where store_id = 'fa000000-0000-4000-9000-000000000001'), true, 'Portal auditing does not alter cancellation truth');
select is((select storefront_enabled from public.stores where id = 'fa000000-0000-4000-9000-000000000001'), false, 'Portal auditing does not alter storefront preference');
select is((select paid_through_at from public.seller_billing_status where store_id = 'fa000000-0000-4000-9000-000000000001'), null::timestamptz, 'Portal auditing creates no paid-through evidence');
update public.billing_subscription_enrollments
set provider_status = 'active'
where id = 'fa000000-0000-4000-b000-000000000001';
select throws_ok(
  $$select * from public.begin_saas_billing_portal_action(
    'fa000000-0000-4000-8000-000000000001', 'portal_general', false,
    'acct_1CTOghL1R5g4hhXt', 'local')$$,
  '55000', 'BILLING_MANAGEMENT_ENROLLMENT_INVALID',
  'Portal access fails closed when enrollment and seller Subscription snapshots conflict'
);
update public.billing_subscription_enrollments
set provider_status = 'trialing'
where id = 'fa000000-0000-4000-b000-000000000001';
select throws_ok(
  $$insert into public.billing_management_action_requests (
    store_id, requested_by_user_id, subscription_enrollment_id, action_type,
    stripe_account_id, stripe_livemode, environment_id, stripe_subscription_id
  ) values (
    'fa000000-0000-4000-9000-000000000002',
    'fa000000-0000-4000-8000-000000000002',
    'fa000000-0000-4000-b000-000000000001', 'portal_general',
    'acct_1CTOghL1R5g4hhXt', false, 'local', 'sub_Batch10')$$,
  '23503', null, 'same-store enrollment binding is enforced by the database'
);

insert into public.billing_management_action_requests (
  id, store_id, requested_by_user_id, subscription_enrollment_id, action_type,
  request_status, stripe_account_id, stripe_livemode, environment_id,
  stripe_subscription_id, completed_at
)
select
  ('fa000000-0000-4000-c000-' || lpad(value::text, 12, '0'))::uuid,
  'fa000000-0000-4000-9000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-b000-000000000001', 'portal_general', 'completed',
  'acct_1CTOghL1R5g4hhXt', false, 'local', 'sub_Batch10', statement_timestamp()
from generate_series(1, 4) value;
select is(
  (select action_state from public.begin_saas_billing_portal_action(
    'fa000000-0000-4000-8000-000000000001', 'portal_invoice_history', false,
    'acct_1CTOghL1R5g4hhXt', 'local')),
  'rate_limited', 'sixth Portal request inside 15 minutes is rate limited'
);

create temporary table batch10_resume as
select * from public.begin_saas_subscription_resume(
  'fa000000-0000-4000-8000-000000000001', false,
  'acct_1CTOghL1R5g4hhXt', 'local'
);
select is((select action_state from batch10_resume), 'created', 'eligible canceling subscription creates resume intent');
select ok(
  (select stripe_idempotency_key from batch10_resume) like 'ff:saas_resume:local:%:v1',
  'resume receives a stable PII-free idempotency key'
);
select is(
  (select action_request_id from public.begin_saas_subscription_resume(
    'fa000000-0000-4000-8000-000000000001', false,
    'acct_1CTOghL1R5g4hhXt', 'local')),
  (select action_request_id from batch10_resume), 'resume retry reuses the same action'
);
select is(
  public.record_saas_subscription_resume_requested(
    (select action_request_id from batch10_resume), statement_timestamp()
  ), 'recorded', 'provider-requested resume evidence is recorded'
);
select is(
  public.record_saas_subscription_resume_requested(
    (select action_request_id from batch10_resume), statement_timestamp()
  ), 'already_recorded', 'resume request recording is idempotent'
);
select is((select cancel_at_period_end from public.seller_billing_status where store_id = 'fa000000-0000-4000-9000-000000000001'), true, 'resume request does not directly clear cancellation scheduling');
select is((select subscription_status from public.seller_billing_status where store_id = 'fa000000-0000-4000-9000-000000000001'), 'trialing', 'resume request does not change subscription status');
select is((select access_reason from public.resolve_store_entitlement('fa000000-0000-4000-9000-000000000001')), 'stripe_trial', 'request auditing leaves entitlement unchanged');

create temporary table batch10_wrong_environment_claim as
select pg_temp.batch10_claim_subscription(
  'evt_Batch10WrongEnvironment', statement_timestamp() + interval '3 seconds', 'staging'
) as token;
select is(
  (select application_state from pg_temp.batch10_apply_subscription(
    'evt_Batch10WrongEnvironment',
    (select token from batch10_wrong_environment_claim), false, null, 'staging'
  )),
  'snapshot_applied', 'verified Subscription snapshot remains environment-bound'
);
select is(
  (select request_status from public.billing_management_action_requests
   where id = (select action_request_id from batch10_resume)),
  'provider_requested', 'mismatched event environment cannot complete resume audit'
);

create temporary table batch10_resume_update_claim as
select pg_temp.batch10_claim_subscription(
  'evt_Batch10ResumeConfirmed', statement_timestamp() + interval '4 seconds'
) as token;
select is(
  (select application_state from pg_temp.batch10_apply_subscription(
    'evt_Batch10ResumeConfirmed',
    (select token from batch10_resume_update_claim), false
  )),
  'snapshot_applied', 'matching verified Subscription update clears cancellation'
);
select is(
  (select request_status from public.billing_management_action_requests
   where id = (select action_request_id from batch10_resume)),
  'completed', 'matching verified Subscription update completes pending resume audit'
);
select ok(
  (select completed_at is not null from public.billing_management_action_requests
   where id = (select action_request_id from batch10_resume)),
  'verified resume completion records a terminal audit timestamp'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  null::timestamptz, 'resume completion creates no paid-through authority'
);
select is(
  (select trial_ends_at from public.seller_billing_status
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  (select trial_ends_at from batch10_trial_boundary),
  'resume completion does not alter the verified trial boundary'
);
select is(
  (select application_state from pg_temp.batch10_apply_subscription(
    'evt_Batch10ResumeConfirmed',
    (select token from batch10_resume_update_claim), false
  )),
  'already_processed', 'duplicate verified Subscription delivery is idempotent'
);

create temporary table batch10_cancel_again_claim as
select pg_temp.batch10_claim_subscription(
  'evt_Batch10CancelAgain', statement_timestamp() + interval '5 seconds'
) as token;
select is(
  (select application_state from pg_temp.batch10_apply_subscription(
    'evt_Batch10CancelAgain',
    (select token from batch10_cancel_again_claim), true
  )),
  'snapshot_applied', 'later verified cancellation starts a fresh lifecycle cycle'
);
create temporary table batch10_second_resume as
select * from public.begin_saas_subscription_resume(
  'fa000000-0000-4000-8000-000000000001', false,
  'acct_1CTOghL1R5g4hhXt', 'local'
);
select isnt(
  (select action_request_id from batch10_second_resume),
  (select action_request_id from batch10_resume),
  'later cancel and resume cycle creates a fresh action identity'
);

select throws_ok(
  $$insert into public.billing_management_action_requests (
    store_id, requested_by_user_id, subscription_enrollment_id, action_type,
    stripe_account_id, stripe_livemode, environment_id, stripe_subscription_id
  ) values (
    'fa000000-0000-4000-9000-000000000001',
    'fa000000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-b000-000000000001', '',
    'acct_1CTOghL1R5g4hhXt', false, 'local', 'sub_Batch10')$$,
  '23514', null, 'blank action is rejected by a typed constraint'
);
select throws_ok(
  $$select public.mark_saas_billing_management_action_failed(
    (select action_request_id from batch10_resume), 'RAW Error Message!')$$,
  '22023', 'BILLING_MANAGEMENT_FAILURE_CODE_INVALID', 'unsanitized failure codes are rejected'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select count(*) from public.saas_billing_portal_store_cohort$$,
  '42501', null, 'authenticated browser cannot enumerate cohort records'
);
select throws_ok(
  $$select public.set_saas_billing_portal_store_cohort(
    'fa000000-0000-4000-9000-000000000001', false)$$,
  '42501', null, 'authenticated browser cannot manage cohort records'
);
select throws_ok(
  $$insert into public.billing_management_action_requests (
    store_id, requested_by_user_id, subscription_enrollment_id, action_type,
    stripe_account_id, stripe_livemode, environment_id, stripe_subscription_id
  ) values (
    'fa000000-0000-4000-9000-000000000001',
    'fa000000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-b000-000000000001', 'portal_general',
    'acct_1CTOghL1R5g4hhXt', false, 'local', 'sub_Batch10')$$,
  '42501', null, 'authenticated browser cannot directly write action records'
);
select throws_ok(
  $$select * from public.begin_saas_subscription_resume(
    'fa000000-0000-4000-8000-000000000001', false,
    'acct_1CTOghL1R5g4hhXt', 'local')$$,
  '42501', null, 'platform/browser roles cannot assert resume requests'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.platform_settings set boolean_value = false
where setting_key = 'saas_billing_portal_enabled';
select is((select boolean_value from public.platform_settings where setting_key = 'saas_billing_portal_enabled'), false, 'Portal flag remains false after rolled-back verification');

select * from finish();
rollback;
