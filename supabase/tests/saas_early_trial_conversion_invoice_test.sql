begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  'fa000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'early-conversion@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'fa000000-0000-4000-9000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'Early Conversion Store', 'early-conversion-store',
  'draft', 'hosted', false
);

insert into public.seller_onboarding_state (
  store_id, profile_complete, billing_complete
) values (
  'fa000000-0000-4000-9000-000000000001', true, true
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
  'price_EarlyConversion', 'prod_EarlyConversion', false,
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
  false, 'acct_1CTOghL1R5g4hhXt', 'evt_EarlyEnrollment',
  statement_timestamp() - interval '3 days',
  'fa000000-0000-4000-9000-000000000001',
  'checkout.session.completed', repeat('e', 64), true, 'processed',
  statement_timestamp() - interval '3 days', 2,
  'checkout.session', 'cs_test_EarlyEnrollment', 'local'
);

insert into public.billing_customer_bindings (
  id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
  provider_created_at, bound_by_event_id
) values (
  'fa000000-0000-4000-a000-000000000001',
  'fa000000-0000-4000-9000-000000000001',
  'cus_EarlyConversion', false, 'acct_1CTOghL1R5g4hhXt',
  statement_timestamp() - interval '3 days', 'evt_EarlyEnrollment'
);

insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, stripe_subscription_id,
  initial_stripe_price_id, stripe_livemode, stripe_account_id,
  provider_status, trial_started_at, trial_ends_at,
  cancel_at_period_end, is_current, provider_created_at, bound_by_event_id
) values (
  'fa000000-0000-4000-b000-000000000001',
  'fa000000-0000-4000-9000-000000000001',
  'fa000000-0000-4000-a000-000000000001',
  'sub_EarlyConversion', 'price_EarlyConversion', false,
  'acct_1CTOghL1R5g4hhXt', 'active',
  statement_timestamp() - interval '3 days',
  statement_timestamp() + interval '4 days', false, true,
  statement_timestamp() - interval '3 days', 'evt_EarlyEnrollment'
);

insert into public.billing_trial_claims (
  store_id, subscription_enrollment_id, trial_started_at, trial_ends_at,
  provider_event_id
) select
  enrollment.store_id, enrollment.id, enrollment.trial_started_at,
  enrollment.trial_ends_at, enrollment.bound_by_event_id
from public.billing_subscription_enrollments as enrollment
where enrollment.id = 'fa000000-0000-4000-b000-000000000001';

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
  'active', 'stripe', binding.stripe_customer_id,
  enrollment.stripe_subscription_id, enrollment.initial_stripe_price_id,
  false, enrollment.stripe_account_id,
  enrollment.trial_started_at, enrollment.trial_ends_at,
  statement_timestamp(), statement_timestamp() + interval '1 month',
  enrollment.trial_ends_at, enrollment.id, enrollment.bound_by_event_id,
  statement_timestamp() - interval '3 days',
  statement_timestamp() - interval '3 days'
from public.billing_subscription_enrollments as enrollment
join public.billing_customer_bindings as binding
  on binding.id = enrollment.customer_binding_id
where enrollment.id = 'fa000000-0000-4000-b000-000000000001';

create function pg_temp.claim_early_conversion_invoice(
  p_event_id text,
  p_invoice_id text
) returns uuid
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_receipt record;
  v_reconciliation record;
begin
  select * into v_receipt from public.claim_saas_billing_provider_event(
    p_event_id, 'invoice.payment_succeeded', statement_timestamp(),
    repeat('f', 64), 'acct_1CTOghL1R5g4hhXt', false, 'local',
    'invoice', p_invoice_id
  );
  perform public.mark_saas_billing_provider_event_deferred(
    p_event_id, repeat('f', 64), 'acct_1CTOghL1R5g4hhXt', false,
    v_receipt.processing_lease_token, 'awaiting_immutable_enrollment_binding'
  );
  select * into v_reconciliation
  from public.claim_deferred_saas_billing_provider_event(
    p_event_id, repeat('f', 64), 'acct_1CTOghL1R5g4hhXt', false,
    'local', 'invoice.payment_succeeded', 'invoice', p_invoice_id
  );
  return v_reconciliation.processing_lease_token;
end;
$function$;

create function pg_temp.apply_early_conversion_invoice(
  p_event_id text,
  p_invoice_id text,
  p_token uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_amount_due bigint default 500,
  p_line_amount bigint default 500,
  p_quantity integer default 1,
  p_price_id text default 'price_EarlyConversion',
  p_product_id text default 'prod_EarlyConversion',
  p_customer_id text default 'cus_EarlyConversion',
  p_subscription_id text default 'sub_EarlyConversion',
  p_account text default 'acct_1CTOghL1R5g4hhXt',
  p_livemode boolean default false
) returns table (
  application_state text, store_id uuid, invoice_id uuid,
  paid_through_at timestamptz, grace_ends_at timestamptz,
  billing_complete boolean
)
language sql
set search_path = pg_catalog, public
as $function$
  select * from public.apply_verified_saas_invoice_payment_succeeded(
    p_provider_event_id => p_event_id,
    p_payload_hash => repeat('f', 64),
    p_processing_lease_token => p_token,
    p_stripe_account_id => p_account,
    p_stripe_livemode => p_livemode,
    p_environment_id => 'local',
    p_provider_event_created_at => (
      select event_row.provider_event_created_at
      from public.billing_provider_events as event_row
      where event_row.provider_event_id = p_event_id
      order by event_row.created_at limit 1
    ),
    p_stripe_invoice_id => p_invoice_id,
    p_invoice_livemode => p_livemode,
    p_stripe_customer_id => p_customer_id,
    p_stripe_subscription_id => p_subscription_id,
    p_stripe_price_id => p_price_id,
    p_stripe_product_id => p_product_id,
    p_billing_reason => 'subscription_update',
    p_collection_method => 'charge_automatically',
    p_invoice_status => 'paid',
    p_currency => 'usd',
    p_amount_due_cents => p_amount_due,
    p_amount_paid_cents => p_amount_due,
    p_amount_remaining_cents => 0,
    p_recurring_line_amount_cents => p_line_amount,
    p_service_period_start => p_period_start,
    p_service_period_end => p_period_end,
    p_paid_at => statement_timestamp(),
    p_next_payment_attempt_at => null,
    p_failure_code => null,
    p_line_quantity => p_quantity,
    p_price_livemode => p_livemode,
    p_product_livemode => p_livemode,
    p_price_active => true,
    p_product_active => true,
    p_unit_amount_cents => 500,
    p_price_currency => 'usd',
    p_recurring_interval => 'month',
    p_recurring_interval_count => 1,
    p_price_type => 'recurring',
    p_billing_scheme => 'per_unit',
    p_recurring_usage_type => 'licensed',
    p_tax_behavior => 'exclusive',
    p_product_tax_code => 'txcd_10103001'
  );
$function$;

create temporary table early_conversion_period as
select current_period_start as period_start, current_period_end as period_end
from public.seller_billing_status
where store_id = 'fa000000-0000-4000-9000-000000000001';

create temporary table proration_claim as
select pg_temp.claim_early_conversion_invoice(
  'evt_EarlyProration', 'in_EarlyProration'
) as token;
create temporary table proration_result as
select * from pg_temp.apply_early_conversion_invoice(
  'evt_EarlyProration', 'in_EarlyProration',
  (select token from proration_claim),
  (select period_start + interval '1 day' from early_conversion_period),
  (select period_end + interval '1 day' from early_conversion_period)
);
select is(
  (select application_state from proration_result),
  'non_authoritative_payment_recorded',
  'an arbitrary subscription update or proration does not extend access'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  null::timestamptz,
  'a mismatched Subscription period leaves paid-through empty'
);

create temporary table amount_claim as
select pg_temp.claim_early_conversion_invoice(
  'evt_EarlyAmountMismatch', 'in_EarlyAmountMismatch'
) as token;
select is(
  (select application_state from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyAmountMismatch', 'in_EarlyAmountMismatch',
    (select token from amount_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period),
    p_amount_due => 400
  )),
  'non_authoritative_payment_recorded',
  'less than the full recurring amount cannot establish paid-through'
);

create temporary table identity_claim as
select pg_temp.claim_early_conversion_invoice(
  'evt_EarlyIdentityMismatch', 'in_EarlyIdentityMismatch'
) as token;
select throws_ok(
  $$select * from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyIdentityMismatch', 'in_EarlyIdentityMismatch',
    (select token from identity_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period),
    p_price_id => 'price_Wrong')$$,
  '55000', 'SAAS_INVOICE_BINDING_CONFLICT',
  'a mismatched Price fails closed'
);
select throws_ok(
  $$select * from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyIdentityMismatch', 'in_EarlyIdentityMismatch',
    (select token from identity_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period),
    p_product_id => 'prod_Wrong')$$,
  '55000', 'SAAS_INVOICE_CATALOG_CONFLICT',
  'a mismatched Product fails closed'
);
select throws_ok(
  $$select * from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyIdentityMismatch', 'in_EarlyIdentityMismatch',
    (select token from identity_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period),
    p_customer_id => 'cus_Wrong')$$,
  '55000', 'SAAS_INVOICE_BINDING_CONFLICT',
  'a mismatched Customer fails closed'
);
select throws_ok(
  $$select * from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyIdentityMismatch', 'in_EarlyIdentityMismatch',
    (select token from identity_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period),
    p_subscription_id => 'sub_Wrong')$$,
  '55000', 'SAAS_INVOICE_ENROLLMENT_NOT_FOUND',
  'a mismatched Subscription fails closed'
);
select throws_ok(
  $$select * from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyIdentityMismatch', 'in_EarlyIdentityMismatch',
    (select token from identity_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period),
    p_account => 'acct_Wrong')$$,
  '55000', 'SAAS_INVOICE_EVENT_CLAIM_INVALID',
  'a mismatched Stripe account fails closed'
);
select throws_ok(
  $$select * from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyIdentityMismatch', 'in_EarlyIdentityMismatch',
    (select token from identity_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period),
    p_livemode => true)$$,
  '55000', 'SAAS_INVOICE_EVENT_CLAIM_INVALID',
  'a mismatched Stripe mode fails closed'
);
select throws_ok(
  $$select * from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyIdentityMismatch', 'in_EarlyIdentityMismatch',
    (select token from identity_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period),
    p_quantity => 2)$$,
  '22023', 'SAAS_INVOICE_PROVIDER_SHAPE_INVALID',
  'a mismatched recurring quantity fails closed'
);

update public.seller_billing_status
set plan_key = 'full_flock'
where store_id = 'fa000000-0000-4000-9000-000000000001';
select throws_ok(
  $$select * from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyIdentityMismatch', 'in_EarlyIdentityMismatch',
    (select token from identity_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period))$$,
  '55000', 'SAAS_INVOICE_CATALOG_CONFLICT',
  'a plan or cadence mismatch fails closed'
);
update public.seller_billing_status
set plan_key = 'small_flock'
where store_id = 'fa000000-0000-4000-9000-000000000001';

update public.seller_billing_status
set billing_plan = 'yearly'
where store_id = 'fa000000-0000-4000-9000-000000000001';
select throws_ok(
  $$select * from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyIdentityMismatch', 'in_EarlyIdentityMismatch',
    (select token from identity_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period))$$,
  '55000', 'SAAS_INVOICE_CATALOG_CONFLICT',
  'a cadence mismatch fails closed'
);
update public.seller_billing_status
set billing_plan = 'monthly'
where store_id = 'fa000000-0000-4000-9000-000000000001';

create temporary table valid_claim as
select pg_temp.claim_early_conversion_invoice(
  'evt_EarlyValidConversion', 'in_EarlyValidConversion'
) as token;
select is(
  (select count(*) from public.billing_subscription_plan_changes
   where subscription_enrollment_id =
     'fa000000-0000-4000-b000-000000000001'),
  0::bigint,
  'the early conversion has no plan-change record'
);
create temporary table valid_result as
select * from pg_temp.apply_early_conversion_invoice(
  'evt_EarlyValidConversion', 'in_EarlyValidConversion',
  (select token from valid_claim),
  (select period_start from early_conversion_period),
  (select period_end from early_conversion_period)
);
select is(
  (select application_state from valid_result),
  'paid_through_extended',
  'a verified first trial-to-paid subscription_update extends paid-through'
);
select is(
  (select paid_through_at from public.seller_billing_status
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  (select period_end from early_conversion_period),
  'the trusted recurring service-period end becomes paid-through'
);
select ok(
  (select paid_through_applied_at is not null
   from public.billing_subscription_invoices
   where stripe_invoice_id = 'in_EarlyValidConversion'),
  'the qualifying invoice records paid-through application evidence'
);
select is(
  (select access_reason from public.resolve_store_entitlement(
    'fa000000-0000-4000-9000-000000000001')),
  'paid',
  'the canonical entitlement resolver recognizes the paid conversion'
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'fa000000-0000-4000-8000-000000000001',
  true
);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'active_paid',
  'the Account billing lifecycle becomes active paid after conversion'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (select application_state from pg_temp.apply_early_conversion_invoice(
    'evt_EarlyValidConversion', 'in_EarlyValidConversion',
    (select token from valid_claim),
    (select period_start from early_conversion_period),
    (select period_end from early_conversion_period)
  )),
  'already_processed',
  'duplicate delivery remains idempotent'
);
select is(
  (select count(*) from public.billing_subscription_invoices
   where stripe_invoice_id = 'in_EarlyValidConversion'),
  1::bigint,
  'duplicate delivery creates no duplicate invoice evidence'
);

select * from finish();
rollback;
