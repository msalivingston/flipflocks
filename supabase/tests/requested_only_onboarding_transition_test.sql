begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_subscription_checkout_enabled'),
  false,
  'SaaS Checkout remains disabled after migration'
);

select col_is_null(
  'public', 'seller_billing_status', 'plan_key',
  'effective plan storage permits null for requested-only state'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.seller_billing_status'::regclass
      and conname = 'seller_billing_status_pending_checkout_consistency_check'
  ),
  'pending Checkout has an explicit structural consistency constraint'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  ('c4000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  format('batch3-owner-%s@example.test', value), '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
from generate_series(1, 19) as value;

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
)
select
  ('c4000000-0000-4000-9000-' || lpad(value::text, 12, '0'))::uuid,
  ('c4000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  format('Batch 3 Store %s', value),
  format('batch-3-store-%s', value),
  'draft', 'hosted', false
from generate_series(1, 11) as value;

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
)
select
  ('c4000000-0000-4000-9000-' || lpad(value::text, 12, '0'))::uuid,
  ('c4000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  format('Batch 3 Attempt Store %s', value),
  format('batch-3-attempt-store-%s', value),
  'draft', 'hosted', false
from generate_series(13, 19) as value;

insert into public.seller_onboarding_state (store_id, profile_complete)
select ('c4000000-0000-4000-9000-' || lpad(value::text, 12, '0'))::uuid, true
from generate_series(1, 11) as value;

insert into public.seller_onboarding_state (store_id, profile_complete)
select ('c4000000-0000-4000-9000-' || lpad(value::text, 12, '0'))::uuid, true
from generate_series(13, 19) as value;

-- Direct structural validation uses Store 11 and never grants authority.
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, billing_state_authority
) values (
  'c4000000-0000-4000-9000-000000000011',
  'small_flock', 'monthly', null, null, 'dormant', 'pending_checkout'
);

select lives_ok(
  $$update public.seller_billing_status
    set requested_plan_key = 'full_flock'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  'a structurally valid pending Checkout row is accepted'
);

select throws_ok(
  $$update public.seller_billing_status set plan_key = 'small_flock'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects an effective plan'
);
select throws_ok(
  $$update public.seller_billing_status set billing_plan = 'monthly'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects an effective cadence'
);
select throws_ok(
  $$update public.seller_billing_status set trial_started_at = now()
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects trial start authority'
);
select throws_ok(
  $$update public.seller_billing_status set trial_ends_at = now() + interval '7 days'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects trial end authority'
);
select throws_ok(
  $$update public.seller_billing_status set paid_through_at = now() + interval '1 month'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects paid-through authority'
);
select throws_ok(
  $$update public.seller_billing_status
    set grace_ends_at = now() + interval '3 days',
        grace_stripe_invoice_id = 'in_test',
        grace_provider_event_id = 'evt_test',
        grace_provider_event_created_at = now()
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects grace authority'
);
select throws_ok(
  $$update public.seller_billing_status set stripe_customer_id = 'cus_test'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects Stripe Customer authority'
);
select throws_ok(
  $$update public.seller_billing_status set stripe_subscription_id = 'sub_test'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects Stripe Subscription authority'
);
select throws_ok(
  $$update public.seller_billing_status set stripe_price_id = 'price_test'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects Stripe Price authority'
);
select throws_ok(
  $$update public.seller_billing_status set latest_stripe_invoice_id = 'in_test'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects invoice authority'
);
select throws_ok(
  $$update public.seller_billing_status set current_period_end = now() + interval '1 month'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects a current billing period'
);
select throws_ok(
  $$update public.seller_billing_status set storefront_access_until = now() + interval '1 day'
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects storefront access authority'
);
select throws_ok(
  $$update public.seller_billing_status set cancel_at_period_end = true
    where store_id = 'c4000000-0000-4000-9000-000000000011'$$,
  '23514', null,
  'pending Checkout rejects cancellation state'
);

-- Disabled mode retains the exact existing local-trial path for Store 2.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'c4000000-0000-4000-8000-000000000002', true
);
create temporary table local_trial_result as
select * from public.seller_save_onboarding_plan_access(
  '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
);

select is((select billing_state_authority from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000002'), 'trial',
  'disabled mode starts the existing local trial');
select is((select trial_ends_at - trial_started_at from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000002'), interval '7 days',
  'disabled mode retains the exact seven-day server trial');
select ok((select trial_started_at between statement_timestamp() - interval '5 seconds'
  and statement_timestamp() from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000002'),
  'disabled mode generates trial start on the server');
select is((select billing_complete from public.seller_onboarding_state
  where store_id = 'c4000000-0000-4000-9000-000000000002'), true,
  'disabled mode preserves billing completion');
select is((select billing_complete from local_trial_result), true,
  'disabled-mode RPC return contract remains compatible');
select is((select next_step from local_trial_result), 4,
  'disabled-mode RPC retains the established next step');

-- Enable only inside this rolled-back test transaction.
select set_config('request.jwt.claim.role', 'service_role', true);
update public.platform_settings
set boolean_value = true
where setting_key = 'saas_subscription_checkout_enabled';

-- Checkout attempts without verified enrollment or trial evidence remain
-- neutral regardless of lifecycle status.
insert into public.billing_checkout_attempts (
  store_id, created_by_user_id, requested_plan_key,
  requested_billing_cadence, stripe_price_id, stripe_livemode,
  stripe_account_id, attempt_status, stripe_idempotency_key
) values
  ('c4000000-0000-4000-9000-000000000013', 'c4000000-0000-4000-8000-000000000013',
   'small_flock', 'monthly', 'price_attempt_creating', false,
   'acct_Batch3AttemptNeutral', 'creating', 'batch3-attempt-creating'),
  ('c4000000-0000-4000-9000-000000000014', 'c4000000-0000-4000-8000-000000000014',
   'small_flock', 'monthly', 'price_attempt_open', false,
   'acct_Batch3AttemptNeutral', 'open', 'batch3-attempt-open'),
  ('c4000000-0000-4000-9000-000000000015', 'c4000000-0000-4000-8000-000000000015',
   'small_flock', 'monthly', 'price_attempt_expired', false,
   'acct_Batch3AttemptNeutral', 'expired', 'batch3-attempt-expired'),
  ('c4000000-0000-4000-9000-000000000016', 'c4000000-0000-4000-8000-000000000016',
   'small_flock', 'monthly', 'price_attempt_failed', false,
   'acct_Batch3AttemptNeutral', 'failed', 'batch3-attempt-failed'),
  ('c4000000-0000-4000-9000-000000000017', 'c4000000-0000-4000-8000-000000000017',
   'small_flock', 'monthly', 'price_attempt_superseded', false,
   'acct_Batch3AttemptNeutral', 'superseded', 'batch3-attempt-superseded'),
  ('c4000000-0000-4000-9000-000000000018', 'c4000000-0000-4000-8000-000000000018',
   'small_flock', 'monthly', 'price_attempt_completed', false,
   'acct_Batch3AttemptNeutral', 'completed', 'batch3-attempt-completed'),
  ('c4000000-0000-4000-9000-000000000019', 'c4000000-0000-4000-8000-000000000019',
   'small_flock', 'monthly', 'price_attempt_pending', false,
   'acct_Batch3AttemptNeutral', 'pending_confirmation', 'batch3-attempt-pending');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000013', true);
select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'a creating Checkout attempt does not consume or block the first trial'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000014', true);
select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'an open Checkout attempt does not consume or block the first trial'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000015', true);
select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'an expired Checkout attempt does not consume or block the first trial'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000016', true);
select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'a failed Checkout attempt does not consume or block the first trial'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000017', true);
select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'a superseded Checkout attempt does not consume or block the first trial'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000018', true);
select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'a completed but unverified Checkout attempt does not consume or block the first trial'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000019', true);
select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'a pending-confirmation attempt without enrollment does not consume or block the first trial'
);

select is(
  (select count(*) from public.seller_billing_status
   where store_id in (
     'c4000000-0000-4000-9000-000000000013',
     'c4000000-0000-4000-9000-000000000014',
     'c4000000-0000-4000-9000-000000000015',
     'c4000000-0000-4000-9000-000000000016',
     'c4000000-0000-4000-9000-000000000017',
     'c4000000-0000-4000-9000-000000000018',
     'c4000000-0000-4000-9000-000000000019'
   )
     and billing_state_authority = 'pending_checkout'
     and trial_started_at is null
     and trial_ends_at is null),
  7::bigint,
  'all standalone attempt statuses remain requested-only and trial-neutral'
);
select is(
  (select count(*) from public.billing_trial_claims
   where store_id in (
     'c4000000-0000-4000-9000-000000000013',
     'c4000000-0000-4000-9000-000000000014',
     'c4000000-0000-4000-9000-000000000015',
     'c4000000-0000-4000-9000-000000000016',
     'c4000000-0000-4000-9000-000000000017',
     'c4000000-0000-4000-9000-000000000018',
     'c4000000-0000-4000-9000-000000000019'
   )),
  0::bigint,
  'standalone Checkout attempts and requested selection create no trial claims'
);

-- A new Store 1 persists intent only.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'c4000000-0000-4000-8000-000000000001', true
);
create temporary table pending_result as
select * from public.seller_save_onboarding_plan_access(
  '{"requested_plan_key":"small_flock","requested_billing_cadence":"monthly"}'
);

select is((select billing_state_authority from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000001'), 'pending_checkout',
  'enabled mode creates requested-only authority');
select is((select requested_plan_key || ':' || requested_billing_cadence
  from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000001'),
  'small_flock:monthly', 'enabled mode saves canonical requested intent');
select is((select plan_key from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000001'), null::text,
  'requested-only storage has no effective plan');
select is((select billing_plan from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000001'), null::text,
  'requested-only storage has no effective cadence');
select is((select trial_started_at from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000001'), null::timestamptz,
  'requested-only storage creates no trial start');
select is((select trial_ends_at from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000001'), null::timestamptz,
  'requested-only storage creates no trial end');
select is((select billing_complete from public.seller_onboarding_state
  where store_id = 'c4000000-0000-4000-9000-000000000001'), false,
  'requested-only selection does not complete billing');
select is((select billing_complete from pending_result), false,
  'requested-only return reports incomplete billing');
select is((select plan_key from pending_result), null::text,
  'requested-only return exposes no effective plan');
select is((select count(*) from public.billing_trial_claims
  where store_id = 'c4000000-0000-4000-9000-000000000001'), 0::bigint,
  'requested-only selection does not consume a trial claim');
select is((select count(*) from public.billing_checkout_attempts
  where store_id = 'c4000000-0000-4000-9000-000000000001'), 0::bigint,
  'requested-only selection creates no Checkout attempt');
select is((select count(*) from public.billing_customer_bindings
  where store_id = 'c4000000-0000-4000-9000-000000000001'), 0::bigint,
  'requested-only selection creates no Customer binding');
select is((select count(*) from public.billing_subscription_enrollments
  where store_id = 'c4000000-0000-4000-9000-000000000001'), 0::bigint,
  'requested-only selection creates no Subscription enrollment');
select is((select has_active_access from public.resolve_store_entitlement(
  'c4000000-0000-4000-9000-000000000001')), false,
  'requested-only selection grants no entitlement');
select is((select effective_plan_key from public.resolve_store_entitlement(
  'c4000000-0000-4000-9000-000000000001')), null::text,
  'requested-only resolver exposes no effective plan');
select is(public.get_store_plan_key(
  'c4000000-0000-4000-9000-000000000001'), 'small_flock',
  'private scalar helper fails closed to Coop while active-access guards remain false');

select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'repeated pending selection can change requested intent'
);
select is((select requested_plan_key || ':' || requested_billing_cadence
  from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000001'),
  'full_flock:yearly', 'repeated selection updates only requested intent');
select is((select count(*) from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000001'), 1::bigint,
  'repeated selection does not create a duplicate billing row');
select is((select count(*) from public.billing_entitlement_events
  where store_id = 'c4000000-0000-4000-9000-000000000001'
    and event_type = 'checkout_selection_saved'), 1::bigint,
  'initial requested selection has a distinct audit event');
select is((select count(*) from public.billing_entitlement_events
  where store_id = 'c4000000-0000-4000-9000-000000000001'
    and event_type = 'checkout_selection_changed'), 1::bigint,
  'changed requested selection has a distinct audit event');
select is((select count(*) from public.billing_entitlement_events
  where store_id = 'c4000000-0000-4000-9000-000000000001'
    and event_type = 'trial_started'), 0::bigint,
  'requested selection audit is never labeled as trial establishment');

-- Browser attempts to smuggle authority fields are rejected by the true branch.
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"monthly","trial_started_at":"2030-01-01"}'
  )$$,
  'P0001', 'Only requested plan and billing cadence may be set from onboarding.',
  'browser-supplied trial timestamps are rejected'
);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"monthly","plan_key":"full_flock"}'
  )$$,
  'P0001', 'Only requested plan and billing cadence may be set from onboarding.',
  'browser-supplied effective plans are rejected'
);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"monthly","stripe_customer_id":"cus_fake"}'
  )$$,
  'P0001', 'Only requested plan and billing cadence may be set from onboarding.',
  'browser-supplied Stripe identifiers are rejected'
);

select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"monthly"}'
  )$$,
  'P0001', 'Authentication is required.',
  'anonymous callers remain rejected'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'c4000000-0000-4000-8000-000000000012', true
);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"monthly"}'
  )$$,
  'P0001', 'Complete farm basics before choosing a plan.',
  'authenticated users without an owned store cannot modify another store'
);

-- Store 2 already has a valid local trial. Enabling Checkout cannot restart it.
create temporary table local_trial_boundary as
select trial_started_at, trial_ends_at
from public.seller_billing_status
where store_id = 'c4000000-0000-4000-9000-000000000002';
select set_config(
  'request.jwt.claim.sub',
  'c4000000-0000-4000-8000-000000000002', true
);
select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"monthly"}'
  )$$,
  'an existing valid local trial retains selection behavior'
);
select is((select billing_state_authority from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000002'), 'trial',
  'existing local trial is not converted to pending');
select is((select trial_started_at from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000002'),
  (select trial_started_at from local_trial_boundary),
  'existing local trial is not restarted');
select is((select trial_ends_at from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000002'),
  (select trial_ends_at from local_trial_boundary),
  'existing local trial keeps its original end');

-- Expired trial evidence cannot be replaced with a fresh pending state.
select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  billing_state_authority
) values (
  'c4000000-0000-4000-9000-000000000003',
  'small_flock', 'monthly', 'small_flock', 'monthly', 'trialing',
  statement_timestamp() - interval '8 days',
  statement_timestamp() - interval '1 day',
  statement_timestamp() - interval '8 days',
  statement_timestamp() - interval '1 day',
  statement_timestamp() - interval '1 day', 'trial'
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'c4000000-0000-4000-8000-000000000003', true
);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'P0001', 'Trial already used; a paid subscription is required.',
  'an expired local trial cannot receive another trial or clean pending state'
);
select is((select billing_state_authority from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000003'), 'trial',
  'expired trial history is preserved after rejection');

-- Durable verified trial evidence and enrollment-backed Stripe authority are
-- independently non-replaceable even if the billing snapshot is absent or new.
select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.billing_provider_events (
  stripe_livemode, stripe_account_id, provider_event_id,
  provider_event_created_at, store_id, event_type, payload_hash, applied
) values
  (false, 'acct_Batch3Platform', 'evt_batch3_customer_8', now() - interval '9 days',
   'c4000000-0000-4000-9000-000000000008', 'customer.created', 'hash-customer-8', true),
  (false, 'acct_Batch3Platform', 'evt_batch3_subscription_8', now() - interval '8 days',
   'c4000000-0000-4000-9000-000000000008', 'customer.subscription.created', 'hash-subscription-8', true),
  (false, 'acct_Batch3Platform', 'evt_batch3_customer_9', now() - interval '2 days',
   'c4000000-0000-4000-9000-000000000009', 'customer.created', 'hash-customer-9', true),
  (false, 'acct_Batch3Platform', 'evt_batch3_subscription_9', now() - interval '1 day',
   'c4000000-0000-4000-9000-000000000009', 'customer.subscription.created', 'hash-subscription-9', true);

insert into public.billing_customer_bindings (
  id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
  provider_created_at, bound_by_event_id
) values
  ('c4000000-0000-4000-a000-000000000008',
   'c4000000-0000-4000-9000-000000000008', 'cus_batch3_8', false,
   'acct_Batch3Platform', now() - interval '9 days', 'evt_batch3_customer_8'),
  ('c4000000-0000-4000-a000-000000000009',
   'c4000000-0000-4000-9000-000000000009', 'cus_batch3_9', false,
   'acct_Batch3Platform', now() - interval '2 days', 'evt_batch3_customer_9');

insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, stripe_subscription_id,
  initial_stripe_price_id, stripe_livemode, stripe_account_id,
  provider_status, trial_started_at, trial_ends_at, provider_created_at,
  bound_by_event_id
) values
  ('c4000000-0000-4000-b000-000000000008',
   'c4000000-0000-4000-9000-000000000008',
   'c4000000-0000-4000-a000-000000000008', 'sub_batch3_8',
   'price_batch3_8', false, 'acct_Batch3Platform', 'canceled',
   now() - interval '8 days', now() - interval '1 day',
   now() - interval '8 days', 'evt_batch3_subscription_8'),
  ('c4000000-0000-4000-b000-000000000009',
   'c4000000-0000-4000-9000-000000000009',
   'c4000000-0000-4000-a000-000000000009', 'sub_batch3_9',
   'price_batch3_9', false, 'acct_Batch3Platform', 'active',
   null, null, now() - interval '1 day', 'evt_batch3_subscription_9');

insert into public.billing_trial_claims (
  store_id, subscription_enrollment_id, trial_started_at, trial_ends_at,
  provider_event_id
) values (
  'c4000000-0000-4000-9000-000000000008',
  'c4000000-0000-4000-b000-000000000008',
  now() - interval '8 days', now() - interval '1 day',
  'evt_batch3_subscription_8'
);

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, billing_state_authority,
  stripe_customer_id, stripe_subscription_id, stripe_price_id,
  stripe_livemode, stripe_account_id, current_subscription_enrollment_id
) values (
  'c4000000-0000-4000-9000-000000000009',
  'full_flock', 'monthly', 'full_flock', 'monthly', 'active', 'stripe',
  'cus_batch3_9', 'sub_batch3_9', 'price_batch3_9', false,
  'acct_Batch3Platform', 'c4000000-0000-4000-b000-000000000009'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000008', true);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'P0001', 'Trial already used; a paid subscription is required.',
  'a durable verified trial claim prevents another trial or pending reset'
);
select is((select count(*) from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000008'), 0::bigint,
  'durable trial evidence is not rewritten into a billing snapshot');

select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000009', true);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'P0001', 'Plan access is already established and cannot be replaced from onboarding.',
  'enrollment-backed Stripe authority cannot be replaced'
);
select is((select current_subscription_enrollment_id from public.seller_billing_status
  where store_id = 'c4000000-0000-4000-9000-000000000009'),
  'c4000000-0000-4000-b000-000000000009'::uuid,
  'enrollment-backed Stripe binding remains unchanged after rejection');

-- Established and sensitive authorities remain non-replaceable.
select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, billing_state_authority,
  stripe_customer_id, stripe_subscription_id, current_period_start,
  current_period_end, storefront_access_until
) values (
  'c4000000-0000-4000-9000-000000000004',
  'full_flock', 'monthly', 'full_flock', 'monthly', 'active',
  'legacy_stripe', 'cus_legacy', 'sub_legacy', now(),
  now() + interval '1 month', now() + interval '1 month'
);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, billing_state_authority,
  comp_granted_by_user_id, comp_grant_reason, comp_granted_at,
  comp_access_until, storefront_access_until
) values (
  'c4000000-0000-4000-9000-000000000005',
  'full_flock', null, 'full_flock', 'comped', 'comped', 'admin_comp',
  'c4000000-0000-4000-8000-000000000005', 'Batch 3 fixture', now(),
  now() + interval '1 month', now() + interval '1 month'
);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, billing_state_authority
) values (
  'c4000000-0000-4000-9000-000000000006',
  'small_flock', 'monthly', 'small_flock', 'monthly', 'dormant',
  'legacy_unclassified'
);
update public.stores set admin_hold_reason = 'Batch 3 hold fixture'
where id = 'c4000000-0000-4000-9000-000000000007';

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'P0001', 'Plan access is already established and cannot be replaced from onboarding.',
  'legacy Stripe authority cannot be replaced'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'P0001', 'Plan access is already established and cannot be replaced from onboarding.',
  'complimentary authority cannot be replaced'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'P0001', 'Plan access is already established and cannot be replaced from onboarding.',
  'unclassified authority remains fail closed'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000007', true);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'P0001', 'Plan access cannot be changed while the store is on administrative hold.',
  'administrative hold cannot be bypassed by requested-only onboarding'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.seller_save_onboarding_plan_access(jsonb)',
    'execute'
  ), true,
  'public intent RPC remains executable by authenticated sellers'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.seller_save_onboarding_plan_access_local_trial_compat(jsonb)',
    'execute'
  ), false,
  'private local-trial compatibility helper is inaccessible to authenticated'
);
select is(
  has_function_privilege(
    'anon',
    'public.seller_save_onboarding_plan_access_local_trial_compat(jsonb)',
    'execute'
  ), false,
  'private local-trial compatibility helper is inaccessible to anonymous'
);

select * from finish();
rollback;
