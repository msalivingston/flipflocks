begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select has_table('public', 'billing_management_action_requests', 'billing action audit table exists');
select has_column('public', 'billing_management_action_requests', 'subscription_enrollment_id', 'actions bind an immutable enrollment');
select has_column('public', 'billing_management_action_requests', 'stripe_idempotency_key', 'resume idempotency evidence is typed');
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
