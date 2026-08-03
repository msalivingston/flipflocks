begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select has_function(
  'public', 'seller_get_saas_billing_status', array[]::text[],
  'seller billing status read RPC exists'
);
select volatility_is(
  'public', 'seller_get_saas_billing_status', array[]::text[], 'stable',
  'seller billing status RPC is read-only stable'
);
select function_privs_are(
  'public', 'seller_get_saas_billing_status', array[]::text[],
  'authenticated', array['EXECUTE'],
  'authenticated sellers may execute the read-only RPC'
);
select function_privs_are(
  'public', 'seller_get_saas_billing_status', array[]::text[],
  'anon', array[]::text[],
  'anonymous callers have no execution grant'
);
select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_subscription_checkout_enabled'),
  false, 'Checkout feature flag remains false'
);
select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_billing_portal_enabled'),
  false, 'Portal feature flag remains false'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  ('f9000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', format('batch9-%s@example.test', value), '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
from generate_series(1, 4) as value;

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
)
select
  ('f9000000-0000-4000-9000-' || lpad(value::text, 12, '0'))::uuid,
  ('f9000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  format('Batch 9 Store %s', value), format('batch-9-store-%s', value),
  'draft', 'hosted', false
from generate_series(1, 3) as value;

insert into public.seller_onboarding_state (store_id, profile_complete, billing_complete)
select
  ('f9000000-0000-4000-9000-' || lpad(value::text, 12, '0'))::uuid,
  true, false
from generate_series(1, 3) as value;

insert into public.user_roles (user_id, role, store_id) values
  ('f9000000-0000-4000-8000-000000000004', 'admin', null);

select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok(
  $$select * from public.seller_get_saas_billing_status()$$,
  '42501', 'AUTHENTICATION_REQUIRED',
  'anonymous callers are rejected'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*) from public.seller_get_saas_billing_status()),
  0::bigint,
  'platform administrator cannot impersonate a seller through the ordinary RPC'
);

select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000001', true);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'selection_required',
  'an owner with no billing row sees selection required'
);
select is(
  (select count(*) from public.seller_get_saas_billing_status()),
  1::bigint,
  'seller sees exactly the owned store'
);

update public.platform_settings
set boolean_value = true
where setting_key = 'saas_subscription_checkout_enabled';
select lives_ok(
  $$select * from public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"monthly"}'::jsonb
  )$$,
  'requested-only onboarding creates displayable intent'
);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'checkout_required',
  'requested-only state maps to Checkout required'
);
select is(
  (select has_active_access from public.seller_get_saas_billing_status()),
  false,
  'requested-only state grants no access in the read model'
);

select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.billing_checkout_attempts (
  id, store_id, created_by_user_id, requested_plan_key,
  requested_billing_cadence, stripe_price_id, stripe_product_id,
  stripe_livemode, stripe_account_id, checkout_environment_id,
  trial_eligibility, attempt_status, stripe_idempotency_key
) values (
  'f9000000-0000-4000-a000-000000000001',
  'f9000000-0000-4000-9000-000000000001',
  'f9000000-0000-4000-8000-000000000001',
  'small_flock', 'monthly', 'price_Batch9', 'prod_Batch9', false,
  'acct_Batch9', 'local', 'trial_eligible', 'creating',
  'ff:saas_checkout:local:f9000000-0000-4000-a000-000000000001:v1'
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'checkout_in_progress',
  'creating Checkout attempt maps to in progress'
);

select set_config('request.jwt.claim.role', 'service_role', true);
update public.billing_checkout_attempts
set attempt_status = 'completed',
    stripe_checkout_session_id = 'cs_test_Batch9',
    session_created_at = statement_timestamp(),
    session_expires_at = statement_timestamp() + interval '1 hour',
    completed_at = statement_timestamp()
where id = 'f9000000-0000-4000-a000-000000000001';
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'awaiting_stripe_confirmation',
  'completed unverified Checkout maps to awaiting confirmation'
);
select is(
  (select customer_binding_exists from public.seller_get_saas_billing_status()),
  false,
  'Checkout presentation does not manufacture a Customer binding'
);
select is(
  (select current_enrollment_exists from public.seller_get_saas_billing_status()),
  false,
  'Checkout presentation does not manufacture an enrollment'
);

-- The disabled compatibility branch remains authoritative for a separate new
-- owner and maps through the canonical resolver without changing trial rules.
select set_config('request.jwt.claim.role', 'service_role', true);
update public.platform_settings set boolean_value = false
where setting_key = 'saas_subscription_checkout_enabled';
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select * from public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'::jsonb
  )$$,
  'disabled Checkout preserves local trial onboarding'
);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'trial_active',
  'valid local trial maps to trial active'
);
select is(
  (select trial_eligibility from public.seller_get_saas_billing_status()),
  'trial_already_used',
  'authoritative local trial history is presented as trial already used'
);

select set_config('request.jwt.claim.role', 'service_role', true);
update public.stores set admin_hold_reason = 'support_review'
where id = 'f9000000-0000-4000-9000-000000000002';
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'administrative_hold',
  'administrative hold has highest lifecycle priority'
);
select is(
  (select has_active_access from public.seller_get_saas_billing_status()),
  false,
  'administrative hold remains fail closed'
);

select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, billing_state_authority
) values (
  'f9000000-0000-4000-9000-000000000003',
  'small_flock', 'monthly', null, null, 'dormant', 'legacy_unclassified'
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000003', true);
select is(
  (select lifecycle_state from public.seller_get_saas_billing_status()),
  'unknown',
  'unclassified billing remains fail closed and maps to unknown'
);
select is(
  (select malformed_or_unclassified from public.seller_get_saas_billing_status()),
  true,
  'unclassified state is explicitly identified for safe support messaging'
);

select ok(
  (select pg_get_functiondef(procedure.oid)
   from pg_proc as procedure
   join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'seller_get_saas_billing_status')
  not similar to '%(insert into|update public|delete from)%',
  'billing status RPC contains no data mutation'
);
select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral unnest(procedure.proargnames) as argument_name
    where namespace.nspname = 'public'
      and procedure.proname = 'seller_get_saas_billing_status'
      and argument_name in (
        'stripe_customer_id', 'stripe_subscription_id', 'stripe_price_id',
        'stripe_checkout_session_id', 'provider_event_id', 'payload_hash'
      )
  ),
  'read model exposes no Stripe identifiers or provider-event evidence'
);
select ok(
  position('resolve_store_entitlement' in (
    select pg_get_functiondef(procedure.oid)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'seller_get_saas_billing_status'
  )) > 0,
  'read model derives access from the canonical resolver'
);
select ok(
  position('payment_failed_paid_through' in (
    select pg_get_functiondef(procedure.oid) from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'seller_get_saas_billing_status'
  )) > 0
  and position('payment_grace' in (
    select pg_get_functiondef(procedure.oid) from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'seller_get_saas_billing_status'
  )) > 0
  and position('suspended_nonpayment' in (
    select pg_get_functiondef(procedure.oid) from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'seller_get_saas_billing_status'
  )) > 0
  and position('canceling_at_period_end' in (
    select pg_get_functiondef(procedure.oid) from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'seller_get_saas_billing_status'
  )) > 0
  and position('fully_canceled' in (
    select pg_get_functiondef(procedure.oid) from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'seller_get_saas_billing_status'
  )) > 0,
  'read model contains paid failure, grace, suspension, cancellation, and terminal mappings'
);
select ok(
  (select pg_get_functiondef(procedure.oid)
   from pg_proc as procedure
   join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'seller_get_saas_billing_status')
  like '%complimentary_access%administrative_hold%unknown%',
  'read model deliberately maps complimentary, hold, and unknown states'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_subscription_checkout_enabled'),
  false, 'test leaves Checkout feature flag false'
);
select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_billing_portal_enabled'),
  false, 'test leaves Portal feature flag false'
);

select * from finish();
rollback;
