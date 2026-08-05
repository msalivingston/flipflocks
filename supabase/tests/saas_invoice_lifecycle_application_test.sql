begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(
  exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'apply_verified_saas_invoice_payment_succeeded'
      and pg_get_function_arguments(procedure.oid)
        like '%p_processing_lease_token uuid%'
      and has_function_privilege('service_role', procedure.oid, 'execute')
      and not has_function_privilege('authenticated', procedure.oid, 'execute')
      and not has_function_privilege('anon', procedure.oid, 'execute')
  ),
  'fenced invoice success overload is service-role only'
);
select ok(
  exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'apply_verified_stripe_subscription_event'
      and pg_get_function_arguments(procedure.oid)
        like '%p_processing_lease_token uuid%'
      and has_function_privilege('service_role', procedure.oid, 'execute')
      and not has_function_privilege('authenticated', procedure.oid, 'execute')
  ),
  'fenced Subscription snapshot overload is service-role only'
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
  'f8000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'batch8-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);
insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'f8000000-0000-4000-9000-000000000001',
  'f8000000-0000-4000-8000-000000000001',
  'Batch 8 Store', 'batch-8-store', 'draft', 'hosted', false
);
insert into public.seller_onboarding_state (
  store_id, profile_complete, billing_complete
) values (
  'f8000000-0000-4000-9000-000000000001', true, true
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
  'price_Batch8CoopMonthly', 'prod_Batch8Coop', false,
  'acct_1CTOghL1R5g4hhXt', 'small_flock', 'monthly', true,
  500, 'usd', 'month', 1, 'exclusive', 'txcd_10103001',
  'recurring', 'per_unit', 'licensed', true, true,
  statement_timestamp() - interval '30 days',
  statement_timestamp() - interval '30 days',
  statement_timestamp() - interval '30 days', '2026-06-24.dahlia'
);

insert into public.billing_provider_events (
  stripe_livemode, stripe_account_id, provider_event_id,
  provider_event_created_at, store_id, event_type, payload_hash,
  applied, processing_status, processed_at, attempt_count,
  provider_object_type, provider_object_id, processing_environment_id
) values (
  false, 'acct_1CTOghL1R5g4hhXt', 'evt_Batch8Enrollment',
  statement_timestamp() - interval '8 days',
  'f8000000-0000-4000-9000-000000000001',
  'checkout.session.completed', repeat('8', 64), true, 'processed',
  statement_timestamp() - interval '8 days', 2,
  'checkout.session', 'cs_test_Batch8Enrollment', 'local'
);
insert into public.billing_customer_bindings (
  id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
  provider_created_at, bound_by_event_id
) values (
  'f8000000-0000-4000-a000-000000000001',
  'f8000000-0000-4000-9000-000000000001',
  'cus_Batch8', false, 'acct_1CTOghL1R5g4hhXt',
  statement_timestamp() - interval '8 days', 'evt_Batch8Enrollment'
);
insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, stripe_subscription_id,
  initial_stripe_price_id, stripe_livemode, stripe_account_id,
  provider_status, trial_started_at, trial_ends_at,
  cancel_at_period_end, is_current, provider_created_at, bound_by_event_id
) values (
  'f8000000-0000-4000-b000-000000000001',
  'f8000000-0000-4000-9000-000000000001',
  'f8000000-0000-4000-a000-000000000001',
  'sub_Batch8', 'price_Batch8CoopMonthly', false,
  'acct_1CTOghL1R5g4hhXt', 'trialing',
  statement_timestamp() - interval '8 days',
  statement_timestamp() - interval '1 day', false, true,
  statement_timestamp() - interval '8 days', 'evt_Batch8Enrollment'
);
insert into public.billing_trial_claims (
  store_id, subscription_enrollment_id, trial_started_at, trial_ends_at,
  provider_event_id
) select
  enrollment.store_id, enrollment.id, enrollment.trial_started_at,
  enrollment.trial_ends_at, enrollment.bound_by_event_id
from public.billing_subscription_enrollments as enrollment
where enrollment.id = 'f8000000-0000-4000-b000-000000000001';

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'f8000000-0000-4000-9000-000000000002',
  'f8000000-0000-4000-8000-000000000001',
  'Batch 8 Trial Used Store', 'batch-8-trial-used', 'draft', 'hosted', false
);
insert into public.seller_onboarding_state (
  store_id, profile_complete, billing_complete
) values (
  'f8000000-0000-4000-9000-000000000002', true, false
);
insert into public.billing_checkout_attempts (
  id, store_id, created_by_user_id, requested_plan_key,
  requested_billing_cadence, stripe_price_id, stripe_product_id,
  stripe_livemode, stripe_account_id, checkout_environment_id,
  trial_eligibility, attempt_status, stripe_checkout_session_id,
  stripe_customer_id, stripe_subscription_id, stripe_idempotency_key,
  session_created_at, session_expires_at, completed_at
) values (
  'f8000000-0000-4000-c000-000000000002',
  'f8000000-0000-4000-9000-000000000002',
  'f8000000-0000-4000-8000-000000000001',
  'small_flock', 'monthly', 'price_Batch8CoopMonthly',
  'prod_Batch8Coop', false, 'acct_1CTOghL1R5g4hhXt', 'local',
  'trial_already_used', 'enrolled', 'cs_test_Batch8PaidEnrollment',
  'cus_Batch8Paid', 'sub_Batch8Paid',
  'ff:saas_checkout:local:f8000000-0000-4000-c000-000000000002:v1',
  statement_timestamp() - interval '2 days',
  statement_timestamp() - interval '1 day',
  statement_timestamp() - interval '2 days'
);
insert into public.billing_provider_events (
  stripe_livemode, stripe_account_id, provider_event_id,
  provider_event_created_at, store_id, event_type, payload_hash,
  applied, processing_status, processed_at, attempt_count,
  provider_object_type, provider_object_id, processing_environment_id
) values (
  false, 'acct_1CTOghL1R5g4hhXt', 'evt_Batch8PaidEnrollment',
  statement_timestamp() - interval '2 days',
  'f8000000-0000-4000-9000-000000000002',
  'checkout.session.completed', repeat('9', 64), true, 'processed',
  statement_timestamp() - interval '2 days', 2,
  'checkout.session', 'cs_test_Batch8PaidEnrollment', 'local'
);
insert into public.billing_customer_bindings (
  id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
  provider_created_at, bound_by_event_id
) values (
  'f8000000-0000-4000-a000-000000000002',
  'f8000000-0000-4000-9000-000000000002',
  'cus_Batch8Paid', false, 'acct_1CTOghL1R5g4hhXt',
  statement_timestamp() - interval '2 days', 'evt_Batch8PaidEnrollment'
);
insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, checkout_attempt_id,
  stripe_subscription_id, initial_stripe_price_id,
  stripe_livemode, stripe_account_id, provider_status,
  cancel_at_period_end, is_current, provider_created_at, bound_by_event_id
) values (
  'f8000000-0000-4000-b000-000000000002',
  'f8000000-0000-4000-9000-000000000002',
  'f8000000-0000-4000-a000-000000000002',
  'f8000000-0000-4000-c000-000000000002',
  'sub_Batch8Paid', 'price_Batch8CoopMonthly', false,
  'acct_1CTOghL1R5g4hhXt', 'active', false, true,
  statement_timestamp() - interval '2 days', 'evt_Batch8PaidEnrollment'
);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence,
  plan_key, billing_plan, subscription_status, billing_state_authority,
  stripe_customer_id, stripe_subscription_id, stripe_price_id,
  stripe_livemode, stripe_account_id, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  current_subscription_enrollment_id, last_provider_event_id,
  last_provider_event_created_at, last_provider_event_applied_at
) values (
  'f8000000-0000-4000-9000-000000000002',
  'small_flock', 'monthly', 'small_flock', 'monthly', 'active', 'stripe',
  'cus_Batch8Paid', 'sub_Batch8Paid', 'price_Batch8CoopMonthly',
  false, 'acct_1CTOghL1R5g4hhXt',
  statement_timestamp() - interval '10 days',
  statement_timestamp() - interval '3 days',
  statement_timestamp() - interval '2 days',
  statement_timestamp() + interval '28 days',
  statement_timestamp() - interval '3 days',
  'f8000000-0000-4000-b000-000000000002',
  'evt_Batch8PaidEnrollment', statement_timestamp() - interval '2 days',
  statement_timestamp() - interval '2 days'
);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence,
  plan_key, billing_plan, subscription_status, billing_state_authority,
  stripe_customer_id, stripe_subscription_id, stripe_price_id,
  stripe_livemode, stripe_account_id, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  current_subscription_enrollment_id, last_provider_event_id,
  last_provider_event_created_at, last_provider_event_applied_at
) select
  enrollment.store_id, 'small_flock', 'monthly', 'small_flock', 'monthly',
  'trialing', 'stripe', 'cus_Batch8', enrollment.stripe_subscription_id,
  enrollment.initial_stripe_price_id, false, enrollment.stripe_account_id,
  enrollment.trial_started_at, enrollment.trial_ends_at,
  enrollment.trial_started_at, enrollment.trial_ends_at,
  enrollment.trial_ends_at, enrollment.id, enrollment.bound_by_event_id,
  statement_timestamp() - interval '8 days',
  statement_timestamp() - interval '8 days'
from public.billing_subscription_enrollments as enrollment
where enrollment.id = 'f8000000-0000-4000-b000-000000000001';

create function pg_temp.batch8_claim_invoice(
  p_event_id text,
  p_event_type text,
  p_invoice_id text,
  p_created_at timestamptz default statement_timestamp()
) returns uuid
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_receipt record;
  v_reconciliation record;
begin
  select * into v_receipt from public.claim_saas_billing_provider_event(
    p_event_id, p_event_type, p_created_at, repeat('a', 64),
    'acct_1CTOghL1R5g4hhXt', false, 'local', 'invoice', p_invoice_id
  );
  perform public.mark_saas_billing_provider_event_deferred(
    p_event_id, repeat('a', 64), 'acct_1CTOghL1R5g4hhXt', false,
    v_receipt.processing_lease_token, 'awaiting_immutable_enrollment_binding'
  );
  select * into v_reconciliation
  from public.claim_deferred_saas_billing_provider_event(
    p_event_id, repeat('a', 64), 'acct_1CTOghL1R5g4hhXt', false,
    'local', p_event_type, 'invoice', p_invoice_id
  );
  return v_reconciliation.processing_lease_token;
end;
$function$;

create function pg_temp.batch8_apply_invoice(
  p_event_id text,
  p_event_type text,
  p_invoice_id text,
  p_token uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_amount_due bigint default 500,
  p_amount_paid bigint default null,
  p_amount_remaining bigint default null,
  p_billing_reason text default 'subscription_cycle',
  p_collection_method text default 'charge_automatically',
  p_price_id text default 'price_Batch8CoopMonthly',
  p_product_id text default 'prod_Batch8Coop',
  p_currency text default 'usd',
  p_line_amount bigint default 500,
  p_price_active boolean default true,
  p_account text default 'acct_1CTOghL1R5g4hhXt',
  p_livemode boolean default false,
  p_customer_id text default 'cus_Batch8',
  p_subscription_id text default 'sub_Batch8'
) returns table (
  application_state text, store_id uuid, invoice_id uuid,
  paid_through_at timestamptz, grace_ends_at timestamptz,
  billing_complete boolean
)
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_paid bigint;
  v_remaining bigint;
  v_status text;
begin
  select * into v_event from public.billing_provider_events
  where provider_event_id = p_event_id order by created_at limit 1;
  v_paid := coalesce(p_amount_paid,
    case when p_event_type = 'invoice.payment_succeeded'
      then p_amount_due else 0 end);
  v_remaining := coalesce(p_amount_remaining, p_amount_due - v_paid);
  v_status := case
    when p_event_type = 'invoice.payment_succeeded' then 'paid'
    when p_event_type = 'invoice.finalization_failed' then 'draft'
    else 'open' end;

  if p_event_type = 'invoice.payment_succeeded' then
    return query select *
    from public.apply_verified_saas_invoice_payment_succeeded(
      p_provider_event_id => p_event_id,
      p_payload_hash => repeat('a', 64),
      p_processing_lease_token => p_token,
      p_stripe_account_id => p_account,
      p_stripe_livemode => p_livemode,
      p_environment_id => 'local',
      p_provider_event_created_at => v_event.provider_event_created_at,
      p_stripe_invoice_id => p_invoice_id,
      p_invoice_livemode => p_livemode,
      p_stripe_customer_id => p_customer_id,
      p_stripe_subscription_id => p_subscription_id,
      p_stripe_price_id => p_price_id,
      p_stripe_product_id => p_product_id,
      p_billing_reason => p_billing_reason,
      p_collection_method => p_collection_method,
      p_invoice_status => v_status,
      p_currency => p_currency,
      p_amount_due_cents => p_amount_due,
      p_amount_paid_cents => v_paid,
      p_amount_remaining_cents => v_remaining,
      p_recurring_line_amount_cents => p_line_amount,
      p_service_period_start => p_period_start,
      p_service_period_end => p_period_end,
      p_paid_at => v_event.provider_event_created_at,
      p_next_payment_attempt_at => null,
      p_failure_code => null,
      p_line_quantity => 1,
      p_price_livemode => p_livemode,
      p_product_livemode => p_livemode,
      p_price_active => p_price_active,
      p_product_active => true,
      p_unit_amount_cents => 500,
      p_price_currency => p_currency,
      p_recurring_interval => 'month',
      p_recurring_interval_count => 1,
      p_price_type => 'recurring',
      p_billing_scheme => 'per_unit',
      p_recurring_usage_type => 'licensed',
      p_tax_behavior => 'exclusive',
      p_product_tax_code => 'txcd_10103001'
    );
  elsif p_event_type = 'invoice.payment_failed' then
    return query select *
    from public.apply_verified_saas_invoice_payment_failed(
      p_provider_event_id => p_event_id,
      p_payload_hash => repeat('a', 64),
      p_processing_lease_token => p_token,
      p_stripe_account_id => p_account,
      p_stripe_livemode => p_livemode,
      p_environment_id => 'local',
      p_provider_event_created_at => v_event.provider_event_created_at,
      p_stripe_invoice_id => p_invoice_id,
      p_invoice_livemode => p_livemode,
      p_stripe_customer_id => p_customer_id,
      p_stripe_subscription_id => p_subscription_id,
      p_stripe_price_id => p_price_id,
      p_stripe_product_id => p_product_id,
      p_billing_reason => p_billing_reason,
      p_collection_method => p_collection_method,
      p_invoice_status => v_status,
      p_currency => p_currency,
      p_amount_due_cents => p_amount_due,
      p_amount_paid_cents => v_paid,
      p_amount_remaining_cents => v_remaining,
      p_recurring_line_amount_cents => p_line_amount,
      p_service_period_start => p_period_start,
      p_service_period_end => p_period_end,
      p_failure_at => v_event.provider_event_created_at,
      p_next_payment_attempt_at => v_event.provider_event_created_at + interval '1 day',
      p_failure_code => 'payment_failed',
      p_line_quantity => 1,
      p_price_livemode => p_livemode,
      p_product_livemode => p_livemode,
      p_price_active => p_price_active,
      p_product_active => true,
      p_unit_amount_cents => 500,
      p_price_currency => p_currency,
      p_recurring_interval => 'month',
      p_recurring_interval_count => 1,
      p_price_type => 'recurring',
      p_billing_scheme => 'per_unit',
      p_recurring_usage_type => 'licensed',
      p_tax_behavior => 'exclusive',
      p_product_tax_code => 'txcd_10103001'
    );
  elsif p_event_type = 'invoice.payment_action_required' then
    return query select *
    from public.apply_verified_saas_invoice_payment_action_required(
      p_provider_event_id => p_event_id,
      p_payload_hash => repeat('a', 64),
      p_processing_lease_token => p_token,
      p_stripe_account_id => p_account,
      p_stripe_livemode => p_livemode,
      p_environment_id => 'local',
      p_provider_event_created_at => v_event.provider_event_created_at,
      p_stripe_invoice_id => p_invoice_id,
      p_invoice_livemode => p_livemode,
      p_stripe_customer_id => p_customer_id,
      p_stripe_subscription_id => p_subscription_id,
      p_stripe_price_id => p_price_id,
      p_stripe_product_id => p_product_id,
      p_billing_reason => p_billing_reason,
      p_collection_method => p_collection_method,
      p_invoice_status => v_status,
      p_currency => p_currency,
      p_amount_due_cents => p_amount_due,
      p_amount_paid_cents => v_paid,
      p_amount_remaining_cents => v_remaining,
      p_recurring_line_amount_cents => p_line_amount,
      p_service_period_start => p_period_start,
      p_service_period_end => p_period_end,
      p_action_required_at => v_event.provider_event_created_at,
      p_next_payment_attempt_at => v_event.provider_event_created_at + interval '1 day',
      p_failure_code => 'payment_action_required',
      p_line_quantity => 1,
      p_price_livemode => p_livemode,
      p_product_livemode => p_livemode,
      p_price_active => p_price_active,
      p_product_active => true,
      p_unit_amount_cents => 500,
      p_price_currency => p_currency,
      p_recurring_interval => 'month',
      p_recurring_interval_count => 1,
      p_price_type => 'recurring',
      p_billing_scheme => 'per_unit',
      p_recurring_usage_type => 'licensed',
      p_tax_behavior => 'exclusive',
      p_product_tax_code => 'txcd_10103001'
    );
  elsif p_event_type = 'invoice.finalization_failed' then
    return query select *
    from public.apply_verified_saas_invoice_finalization_failed(
      p_provider_event_id => p_event_id,
      p_payload_hash => repeat('a', 64),
      p_processing_lease_token => p_token,
      p_stripe_account_id => p_account,
      p_stripe_livemode => p_livemode,
      p_environment_id => 'local',
      p_provider_event_created_at => v_event.provider_event_created_at,
      p_stripe_invoice_id => p_invoice_id,
      p_invoice_livemode => p_livemode,
      p_stripe_customer_id => p_customer_id,
      p_stripe_subscription_id => p_subscription_id,
      p_stripe_price_id => p_price_id,
      p_stripe_product_id => p_product_id,
      p_billing_reason => p_billing_reason,
      p_collection_method => p_collection_method,
      p_invoice_status => v_status,
      p_currency => p_currency,
      p_amount_due_cents => p_amount_due,
      p_amount_paid_cents => v_paid,
      p_amount_remaining_cents => v_remaining,
      p_recurring_line_amount_cents => p_line_amount,
      p_service_period_start => p_period_start,
      p_service_period_end => p_period_end,
      p_finalization_failed_at => v_event.provider_event_created_at,
      p_next_payment_attempt_at => null,
      p_failure_code => 'provider_configuration_failure',
      p_line_quantity => 1,
      p_price_livemode => p_livemode,
      p_product_livemode => p_livemode,
      p_price_active => p_price_active,
      p_product_active => true,
      p_unit_amount_cents => 500,
      p_price_currency => p_currency,
      p_recurring_interval => 'month',
      p_recurring_interval_count => 1,
      p_price_type => 'recurring',
      p_billing_scheme => 'per_unit',
      p_recurring_usage_type => 'licensed',
      p_tax_behavior => 'exclusive',
      p_product_tax_code => 'txcd_10103001'
    );
  else
    raise exception 'unsupported batch8 test event';
  end if;
end;
$function$;

create function pg_temp.batch8_claim_subscription(
  p_event_id text,
  p_event_type text,
  p_created_at timestamptz default statement_timestamp()
) returns uuid
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_receipt record;
  v_reconciliation record;
begin
  select * into v_receipt from public.claim_saas_billing_provider_event(
    p_event_id, p_event_type, p_created_at, repeat('b', 64),
    'acct_1CTOghL1R5g4hhXt', false, 'local',
    'subscription', 'sub_Batch8'
  );
  perform public.mark_saas_billing_provider_event_deferred(
    p_event_id, repeat('b', 64), 'acct_1CTOghL1R5g4hhXt', false,
    v_receipt.processing_lease_token, 'awaiting_verified_enrollment_batch'
  );
  select * into v_reconciliation
  from public.claim_deferred_saas_billing_provider_event(
    p_event_id, repeat('b', 64), 'acct_1CTOghL1R5g4hhXt', false,
    'local', p_event_type, 'subscription', 'sub_Batch8'
  );
  return v_reconciliation.processing_lease_token;
end;
$function$;

create function pg_temp.batch8_apply_subscription(
  p_event_id text,
  p_event_type text,
  p_token uuid,
  p_status text,
  p_cancel_at_period_end boolean,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_canceled_at timestamptz default null,
  p_ended_at timestamptz default null,
  p_cancel_at timestamptz default null
) returns table (
  application_state text, store_id uuid, subscription_status text,
  paid_through_at timestamptz, grace_ends_at timestamptz
)
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
begin
  select * into v_event from public.billing_provider_events
  where provider_event_id = p_event_id order by created_at limit 1;
  return query select * from public.apply_verified_stripe_subscription_event(
    p_provider_event_id => p_event_id,
    p_payload_hash => repeat('b', 64),
    p_processing_lease_token => p_token,
    p_stripe_account_id => 'acct_1CTOghL1R5g4hhXt',
    p_stripe_livemode => false,
    p_environment_id => 'local',
    p_provider_event_created_at => v_event.provider_event_created_at,
    p_event_type => p_event_type,
    p_stripe_subscription_id => 'sub_Batch8',
    p_subscription_livemode => false,
    p_stripe_customer_id => 'cus_Batch8',
    p_stripe_price_id => 'price_Batch8CoopMonthly',
    p_stripe_product_id => 'prod_Batch8Coop',
    p_subscription_status => p_status,
    p_current_period_start => p_period_start,
    p_current_period_end => p_period_end,
    p_cancel_at_period_end => p_cancel_at_period_end,
    p_subscription_cancel_at => p_cancel_at,
    p_subscription_created_at => statement_timestamp() - interval '8 days',
    p_subscription_canceled_at => p_canceled_at,
    p_subscription_ended_at => p_ended_at,
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

create temporary table batch8_times as
select trial_ends_at as trial_end,
  trial_ends_at + interval '1 month' as first_paid_end,
  trial_ends_at + interval '2 months' as second_paid_end
from public.billing_subscription_enrollments
where id = 'f8000000-0000-4000-b000-000000000001';

create temporary table batch8_failure_claim as
select pg_temp.batch8_claim_invoice(
  'evt_Batch8ConversionFailure', 'invoice.payment_failed',
  'in_Batch8Conversion', statement_timestamp() - interval '30 minutes'
) as token;

select throws_ok(
  $$select * from pg_temp.batch8_apply_invoice(
    'evt_Batch8ConversionFailure', 'invoice.payment_failed',
    'in_Batch8Conversion', gen_random_uuid(),
    (select trial_end from batch8_times),
    (select first_paid_end from batch8_times))$$,
  '55000', 'SAAS_INVOICE_EVENT_FENCE_INVALID',
  'invoice application requires the active reconciliation fence'
);
select throws_ok(
  $$select * from pg_temp.batch8_apply_invoice(
    'evt_Batch8ConversionFailure', 'invoice.payment_failed',
    'in_WrongInvoice', (select token from batch8_failure_claim),
    (select trial_end from batch8_times),
    (select first_paid_end from batch8_times))$$,
  '55000', 'SAAS_INVOICE_EVENT_CLAIM_INVALID',
  'signed Invoice identity must match the deferred event'
);
select throws_ok(
  $$select * from pg_temp.batch8_apply_invoice(
    'evt_Batch8ConversionFailure', 'invoice.payment_failed',
    'in_Batch8Conversion', (select token from batch8_failure_claim),
    (select trial_end from batch8_times),
    (select first_paid_end from batch8_times),
    p_product_id => 'prod_Wrong')$$,
  '55000', 'SAAS_INVOICE_CATALOG_CONFLICT',
  'Invoice Product must match the trusted catalog'
);
select throws_ok(
  $$select * from pg_temp.batch8_apply_invoice(
    'evt_Batch8ConversionFailure', 'invoice.payment_failed',
    'in_Batch8Conversion', (select token from batch8_failure_claim),
    (select trial_end from batch8_times),
    (select first_paid_end from batch8_times),
    p_currency => 'eur')$$,
  '55000', 'SAAS_INVOICE_CATALOG_CONFLICT',
  'Invoice currency must match the trusted catalog'
);
select throws_ok(
  $$select * from pg_temp.batch8_apply_invoice(
    'evt_Batch8ConversionFailure', 'invoice.payment_failed',
    'in_Batch8Conversion', (select token from batch8_failure_claim),
    (select trial_end from batch8_times),
    (select first_paid_end from batch8_times),
    p_price_active => false)$$,
  '22023', 'SAAS_INVOICE_PROVIDER_SHAPE_INVALID',
  'inactive provider Price is rejected'
);

create temporary table batch8_failure_result as
select * from pg_temp.batch8_apply_invoice(
  'evt_Batch8ConversionFailure', 'invoice.payment_failed',
  'in_Batch8Conversion', (select token from batch8_failure_claim),
  (select trial_end from batch8_times),
  (select first_paid_end from batch8_times)
);
select is((select application_state from batch8_failure_result),
  'grace_scheduled', 'trial-conversion failure schedules grace');
select is(
  (select grace_ends_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  (select trial_end + interval '3 days' from batch8_times),
  'trial-conversion grace is exactly trial end plus three days'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  null::timestamptz,
  'failed invoice creates no paid-through evidence'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'f8000000-0000-4000-9000-000000000001')),
  'payment_grace',
  'expired verified trial enters invoice-backed grace'
);

create temporary table batch8_success_claim as
select pg_temp.batch8_claim_invoice(
  'evt_Batch8ConversionSuccess', 'invoice.payment_succeeded',
  'in_Batch8Conversion', statement_timestamp() - interval '20 minutes'
) as token;
create temporary table batch8_success_result as
select * from pg_temp.batch8_apply_invoice(
  'evt_Batch8ConversionSuccess', 'invoice.payment_succeeded',
  'in_Batch8Conversion', (select token from batch8_success_claim),
  (select trial_end from batch8_times),
  (select first_paid_end from batch8_times)
);
select is((select application_state from batch8_success_result),
  'paid_through_extended', 'verified conversion payment extends paid-through');
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  (select first_paid_end from batch8_times),
  'paid-through uses the recurring service-period end'
);
select is(
  (select grace_ends_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  null::timestamptz,
  'successful recovery clears grace'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'f8000000-0000-4000-9000-000000000001')),
  'paid',
  'verified recovery restores paid access'
);
select is(
  (select storefront_enabled from public.stores
   where id = 'f8000000-0000-4000-9000-000000000001'),
  false,
  'invoice recovery does not change storefront preference'
);

create temporary table batch8_zero_claim as
select pg_temp.batch8_claim_invoice(
  'evt_Batch8ZeroDollar', 'invoice.payment_succeeded',
  'in_Batch8ZeroDollar', statement_timestamp() - interval '15 minutes'
) as token;
select * from pg_temp.batch8_apply_invoice(
  'evt_Batch8ZeroDollar', 'invoice.payment_succeeded',
  'in_Batch8ZeroDollar', (select token from batch8_zero_claim),
  (select first_paid_end from batch8_times),
  (select second_paid_end from batch8_times),
  p_amount_due => 0, p_amount_paid => 0, p_amount_remaining => 0,
  p_line_amount => 500
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  (select first_paid_end from batch8_times),
  'zero-dollar invoice cannot extend paid-through'
);

create temporary table batch8_manual_claim as
select pg_temp.batch8_claim_invoice(
  'evt_Batch8ManualPaid', 'invoice.payment_succeeded',
  'in_Batch8ManualPaid', statement_timestamp() - interval '14 minutes'
) as token;
select * from pg_temp.batch8_apply_invoice(
  'evt_Batch8ManualPaid', 'invoice.payment_succeeded',
  'in_Batch8ManualPaid', (select token from batch8_manual_claim),
  (select first_paid_end from batch8_times),
  (select second_paid_end from batch8_times),
  p_collection_method => 'send_invoice'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  (select first_paid_end from batch8_times),
  'manual collection cannot extend paid-through'
);

create temporary table batch8_action_claim as
select pg_temp.batch8_claim_invoice(
  'evt_Batch8Action', 'invoice.payment_action_required',
  'in_Batch8Action', statement_timestamp() - interval '13 minutes'
) as token;
select * from pg_temp.batch8_apply_invoice(
  'evt_Batch8Action', 'invoice.payment_action_required',
  'in_Batch8Action', (select token from batch8_action_claim),
  (select first_paid_end from batch8_times),
  (select second_paid_end from batch8_times),
  p_billing_reason => 'subscription_update'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  (select first_paid_end from batch8_times),
  'payment action required cannot extend paid-through'
);
select is(
  (select grace_eligible from public.billing_subscription_invoices
   where stripe_invoice_id = 'in_Batch8Action'),
  false,
  'unsupported action-required billing reason receives no grace'
);

create temporary table batch8_finalization_claim as
select pg_temp.batch8_claim_invoice(
  'evt_Batch8Finalization', 'invoice.finalization_failed',
  'in_Batch8Finalization', statement_timestamp() - interval '12 minutes'
) as token;
select * from pg_temp.batch8_apply_invoice(
  'evt_Batch8Finalization', 'invoice.finalization_failed',
  'in_Batch8Finalization', (select token from batch8_finalization_claim),
  (select first_paid_end from batch8_times),
  (select second_paid_end from batch8_times),
  p_billing_reason => 'subscription_update'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  (select first_paid_end from batch8_times),
  'finalization failure cannot extend paid-through'
);
select is(
  (select failure_code from public.billing_subscription_invoices
   where stripe_invoice_id = 'in_Batch8Finalization'),
  'provider_configuration_failure',
  'finalization failure stores only a stable sanitized classification'
);

create temporary table batch8_renewal_failure_claim as
select pg_temp.batch8_claim_invoice(
  'evt_Batch8RenewalFailure', 'invoice.payment_failed',
  'in_Batch8Renewal', statement_timestamp() - interval '10 minutes'
) as token;
select * from pg_temp.batch8_apply_invoice(
  'evt_Batch8RenewalFailure', 'invoice.payment_failed',
  'in_Batch8Renewal', (select token from batch8_renewal_failure_claim),
  (select first_paid_end from batch8_times),
  (select second_paid_end from batch8_times)
);
select is(
  (select grace_ends_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  (select first_paid_end + interval '3 days' from batch8_times),
  'renewal grace is exactly paid-through plus three days'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'f8000000-0000-4000-9000-000000000001')),
  'paid',
  'renewal failure preserves normal paid access before paid-through'
);

create temporary table batch8_renewal_success_claim as
select pg_temp.batch8_claim_invoice(
  'evt_Batch8RenewalSuccess', 'invoice.payment_succeeded',
  'in_Batch8Renewal', statement_timestamp() - interval '5 minutes'
) as token;
select * from pg_temp.batch8_apply_invoice(
  'evt_Batch8RenewalSuccess', 'invoice.payment_succeeded',
  'in_Batch8Renewal', (select token from batch8_renewal_success_claim),
  (select first_paid_end from batch8_times),
  (select second_paid_end from batch8_times)
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  (select second_paid_end from batch8_times),
  'late renewal recovery advances paid-through monotonically'
);
select is(
  (select grace_ends_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  null::timestamptz,
  'late renewal recovery clears matching grace'
);

create temporary table batch8_cancel_claim as
select pg_temp.batch8_claim_subscription(
  'evt_Batch8Canceling', 'customer.subscription.updated',
  statement_timestamp() - interval '4 minutes'
) as token;
select * from pg_temp.batch8_apply_subscription(
  'evt_Batch8Canceling', 'customer.subscription.updated',
  (select token from batch8_cancel_claim), 'active', true,
  (select first_paid_end from batch8_times),
  (select second_paid_end from batch8_times)
);
select is(
  (select cancel_at_period_end from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  true,
  'verified Subscription snapshot records cancellation at period end'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'f8000000-0000-4000-9000-000000000001')),
  'paid_canceling',
  'period-end cancellation preserves invoice-proven paid access'
);
select is(
  (select grace_ends_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  null::timestamptz,
  'cancellation snapshot creates no grace'
);

create temporary table batch8_deleted_claim as
select pg_temp.batch8_claim_subscription(
  'evt_Batch8Deleted', 'customer.subscription.deleted',
  statement_timestamp() - interval '3 minutes'
) as token;
select * from pg_temp.batch8_apply_subscription(
  'evt_Batch8Deleted', 'customer.subscription.deleted',
  (select token from batch8_deleted_claim), 'canceled', true,
  (select first_paid_end from batch8_times),
  (select second_paid_end from batch8_times),
  statement_timestamp() - interval '3 minutes',
  statement_timestamp() - interval '3 minutes'
);
select is(
  (select is_current from public.billing_subscription_enrollments
   where id = 'f8000000-0000-4000-b000-000000000001'),
  false,
  'deleted Subscription marks immutable enrollment history terminal'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  (select second_paid_end from batch8_times),
  'terminal Subscription snapshot cannot shorten proven paid-through'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'f8000000-0000-4000-9000-000000000001')),
  'paid_canceling',
  'terminal enrollment history retains paid access until paid-through'
);

create temporary table batch8_stale_failure_claim as
select pg_temp.batch8_claim_invoice(
  'evt_Batch8StaleFailure', 'invoice.payment_failed',
  'in_Batch8Conversion', statement_timestamp() - interval '40 minutes'
) as token;
select * from pg_temp.batch8_apply_invoice(
  'evt_Batch8StaleFailure', 'invoice.payment_failed',
  'in_Batch8Conversion', (select token from batch8_stale_failure_claim),
  (select trial_end from batch8_times),
  (select first_paid_end from batch8_times)
);
select is(
  (select invoice_status from public.billing_subscription_invoices
   where stripe_invoice_id = 'in_Batch8Conversion'),
  'paid',
  'stale failure cannot override successful Invoice evidence'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  (select second_paid_end from batch8_times),
  'stale failure cannot regress paid-through'
);
select is(
  (select processing_status from public.billing_provider_events
   where provider_event_id = 'evt_Batch8ConversionSuccess'),
  'processed',
  'successful invoice event is finalized atomically'
);
select is(
  (select count(*)::integer from public.billing_trial_claims
   where store_id = 'f8000000-0000-4000-9000-000000000001'),
  1,
  'trial conversion preserves the one durable trial claim'
);
select is(
  (select count(*)::integer from public.stores
   where id = 'f8000000-0000-4000-9000-000000000001'),
  1,
  'subscription lifecycle does not delete seller data'
);

create temporary table batch8_trial_used_success_claim as
select pg_temp.batch8_claim_invoice(
  'evt_Batch8TrialUsedSuccess', 'invoice.payment_succeeded',
  'in_Batch8TrialUsedSuccess', statement_timestamp() - interval '1 minute'
) as token;
select is(
  (select billing_complete from public.seller_onboarding_state
   where store_id = 'f8000000-0000-4000-9000-000000000002'),
  false,
  'trial-used enrollment remains onboarding-incomplete before invoice authority'
);
select * from pg_temp.batch8_apply_invoice(
  'evt_Batch8TrialUsedSuccess', 'invoice.payment_succeeded',
  'in_Batch8TrialUsedSuccess',
  (select token from batch8_trial_used_success_claim),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() - interval '1 minute' + interval '1 month',
  p_billing_reason => 'subscription_create',
  p_customer_id => 'cus_Batch8Paid',
  p_subscription_id => 'sub_Batch8Paid'
);
select is(
  (select billing_complete from public.seller_onboarding_state
   where store_id = 'f8000000-0000-4000-9000-000000000002'),
  true,
  'first verified positive invoice completes trial-used onboarding'
);
select is(
  (select count(*)::integer from public.billing_trial_claims
   where store_id = 'f8000000-0000-4000-9000-000000000002'),
  0,
  'paid trial-used enrollment creates no new trial claim'
);
select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_subscription_checkout_enabled'),
  false,
  'invoice application leaves Checkout disabled'
);

select * from finish();
rollback;
