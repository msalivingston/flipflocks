begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_failed_saas_checkout_completion_replay(text,text,text,boolean,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_failed_saas_checkout_completion_replay(text,text,text,boolean,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.claim_failed_saas_checkout_completion_replay(text,text,text,boolean,text,text,text,text)',
    'execute'
  ),
  'failed Checkout replay claim is service-role only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_failed_saas_checkout_completion_replay_state(text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.get_failed_saas_checkout_completion_replay_state(text)',
    'execute'
  ),
  'failed Checkout replay diagnostics are service-role only'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  'fa000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'replay-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);
insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'fa000000-0000-4000-9000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'Replay Test Store', 'replay-test-store', 'draft', 'hosted', false
);
insert into public.seller_onboarding_state (store_id, profile_complete)
values ('fa000000-0000-4000-9000-000000000001', true);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence,
  plan_key, billing_plan, subscription_status, billing_state_authority
) values (
  'fa000000-0000-4000-9000-000000000001',
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
  'price_ReplayContract', 'prod_ReplayContract', false,
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
  'fa000000-0000-4000-a000-000000000001',
  'fa000000-0000-4000-9000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'small_flock', 'monthly', 'price_ReplayContract',
  'prod_ReplayContract', false, 'acct_1CTOghL1R5g4hhXt', 'local',
  'trial_eligible', 'open', 'cs_test_ReplayContract',
  'ff:saas_checkout:local:fa000000-0000-4000-a000-000000000001:v1',
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() + interval '23 hours'
);

create temporary table replay_receipt as
select * from public.claim_saas_billing_provider_event(
  'evt_ReplayContract', 'checkout.session.completed',
  statement_timestamp() - interval '1 minute', repeat('a', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'checkout.session', 'cs_test_ReplayContract'
);
select is(
  public.mark_saas_billing_provider_event_deferred(
    'evt_ReplayContract', repeat('a', 64),
    'acct_1CTOghL1R5g4hhXt', false,
    (select processing_lease_token from replay_receipt),
    'awaiting_verified_enrollment_batch'
  ),
  'deferred',
  'verified Checkout completion is deferred before reconciliation'
);
create temporary table replay_initial_claim as
select * from public.claim_deferred_saas_billing_provider_event(
  'evt_ReplayContract', repeat('a', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'checkout.session.completed', 'checkout.session',
  'cs_test_ReplayContract'
);
select is(
  public.mark_saas_billing_provider_event_failed(
    'evt_ReplayContract', repeat('a', 64),
    'acct_1CTOghL1R5g4hhXt', false,
    (select processing_lease_token from replay_initial_claim),
    'checkout_completion_binding_conflict', null, false
  ),
  'failed',
  'legacy generic enrollment conflict fixture is permanently failed'
);

select is(
  (select processing_status
   from public.get_failed_saas_checkout_completion_replay_state(
     'evt_ReplayContract'
   )),
  'failed',
  'diagnostic contract reads only the verified failed Checkout event'
);
select is(
  (select replay_state
   from public.claim_failed_saas_checkout_completion_replay(
     'evt_ReplayContract', repeat('b', 64),
     'acct_1CTOghL1R5g4hhXt', false, 'local',
     'checkout.session.completed', 'checkout.session',
     'cs_test_ReplayContract'
   )),
  'conflict',
  'wrong original payload hash is rejected'
);
select is(
  (select replay_state
   from public.claim_failed_saas_checkout_completion_replay(
     'evt_ReplayContract', repeat('a', 64),
     'acct_WrongReplayAccount', false, 'local',
     'checkout.session.completed', 'checkout.session',
     'cs_test_ReplayContract'
   )),
  'conflict',
  'wrong original platform account is rejected'
);
select is(
  (select replay_state
   from public.claim_failed_saas_checkout_completion_replay(
     'evt_ReplayContract', repeat('a', 64),
     'acct_1CTOghL1R5g4hhXt', true, 'local',
     'checkout.session.completed', 'checkout.session',
     'cs_test_ReplayContract'
   )),
  'conflict',
  'wrong original test/live mode is rejected'
);
select is(
  (select replay_state
   from public.claim_failed_saas_checkout_completion_replay(
     'evt_ReplayContract', repeat('a', 64),
     'acct_1CTOghL1R5g4hhXt', false, 'preview',
     'checkout.session.completed', 'checkout.session',
     'cs_test_ReplayContract'
   )),
  'conflict',
  'wrong original environment is rejected'
);
select is(
  (select replay_state
   from public.claim_failed_saas_checkout_completion_replay(
     'evt_ReplayContract', repeat('a', 64),
     'acct_1CTOghL1R5g4hhXt', false, 'local',
     'checkout.session.completed', 'checkout.session',
     'cs_test_WrongReplayObject'
   )),
  'conflict',
  'wrong original provider object identity is rejected'
);
select throws_ok(
  $$select * from public.claim_failed_saas_checkout_completion_replay(
    'evt_ReplayContract', repeat('a', 64),
    'acct_1CTOghL1R5g4hhXt', false, 'local',
    'invoice.payment_succeeded', 'invoice', 'in_ReplayContract'
  )$$,
  '22023', 'SAAS_CHECKOUT_REPLAY_IDENTITY_INVALID',
  'an unrelated failed event type cannot enter the Checkout replay path'
);

create temporary table replay_claim as
select * from public.claim_failed_saas_checkout_completion_replay(
  'evt_ReplayContract', repeat('a', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'checkout.session.completed', 'checkout.session',
  'cs_test_ReplayContract'
);
select is((select replay_state from replay_claim), 'claimed',
  'allowlisted failed verified completion receives a fresh replay lease');
select ok((select processing_lease_token is not null from replay_claim),
  'fresh replay lease includes a fencing token');
select is(
  (select replay_state
   from public.claim_failed_saas_checkout_completion_replay(
     'evt_ReplayContract', repeat('a', 64),
     'acct_1CTOghL1R5g4hhXt', false, 'local',
     'checkout.session.completed', 'checkout.session',
     'cs_test_ReplayContract'
   )),
  'in_progress',
  'a second replay worker cannot steal an active lease'
);
select throws_ok(
  $$select public.mark_saas_billing_provider_event_failed(
    'evt_ReplayContract', repeat('a', 64),
    'acct_1CTOghL1R5g4hhXt', false, gen_random_uuid(),
    'checkout_price_mismatch', null, false
  )$$,
  '55000', 'SAAS_EVENT_TRANSITION_INVALID',
  'a stale replay fencing token cannot finalize the event'
);
select is(
  (select count(*)::integer
   from public.billing_provider_event_audits
   where provider_event_id = 'evt_ReplayContract'
     and result_code = 'checkout_conflict_replay_claimed'),
  1,
  'the replay claim preserves an audit record'
);
select is(
  (select count(*)::integer
   from public.billing_customer_bindings
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  0,
  'claiming replay creates no Customer binding'
);
select is(
  (select count(*)::integer
   from public.billing_subscription_enrollments
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  0,
  'claiming replay creates no Subscription enrollment'
);
select is(
  (select count(*)::integer
   from public.billing_trial_claims
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  0,
  'claiming replay creates no trial claim'
);

create temporary table replay_application as
select * from public.apply_verified_saas_checkout_completion(
  'evt_ReplayContract', repeat('a', 64),
  (select processing_lease_token from replay_claim),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  (select provider_event_created_at from public.billing_provider_events
   where provider_event_id = 'evt_ReplayContract'),
  'cs_test_ReplayContract',
  (select session_created_at from public.billing_checkout_attempts
   where id = 'fa000000-0000-4000-a000-000000000001'),
  (select session_expires_at from public.billing_checkout_attempts
   where id = 'fa000000-0000-4000-a000-000000000001'),
  'complete', 'subscription', 'no_payment_required', 'always',
  'fa000000-0000-4000-a000-000000000001', false,
  'fa000000-0000-4000-a000-000000000001',
  'fa000000-0000-4000-a000-000000000001',
  'fa000000-0000-4000-9000-000000000001',
  'local', 'small_flock', 'monthly', 'ff_saas_checkout_v1',
  'cus_ReplayContract',
  (select session_created_at from public.billing_checkout_attempts
   where id = 'fa000000-0000-4000-a000-000000000001'),
  false, 'sub_ReplayContract', 'trialing',
  (select provider_event_created_at from public.billing_provider_events
   where provider_event_id = 'evt_ReplayContract'),
  (select provider_event_created_at from public.billing_provider_events
   where provider_event_id = 'evt_ReplayContract'),
  (select provider_event_created_at + interval '7 days'
   from public.billing_provider_events
   where provider_event_id = 'evt_ReplayContract'),
  (select provider_event_created_at from public.billing_provider_events
   where provider_event_id = 'evt_ReplayContract'),
  (select provider_event_created_at + interval '7 days'
   from public.billing_provider_events
   where provider_event_id = 'evt_ReplayContract'),
  false, false, 'charge_automatically', true,
  'fa000000-0000-4000-a000-000000000001',
  'fa000000-0000-4000-9000-000000000001',
  'local', 'small_flock', 'monthly', 'ff_saas_checkout_v1',
  'price_ReplayContract', 'prod_ReplayContract', 1,
  false, false, true, true, 500, 'usd', 'month', 1,
  'recurring', 'per_unit', 'licensed', 'exclusive', 'txcd_10103001'
);
select is((select application_state from replay_application), 'trial_enrolled',
  'successful replay uses the original atomic enrollment application');
select is(
  (select count(*)::integer from public.billing_customer_bindings
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  1,
  'successful replay creates exactly one Customer binding'
);
select is(
  (select count(*)::integer from public.billing_subscription_enrollments
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  1,
  'successful replay creates exactly one Subscription enrollment'
);
select is(
  (select count(*)::integer from public.billing_trial_claims
   where store_id = 'fa000000-0000-4000-9000-000000000001'),
  1,
  'successful replay creates exactly one durable trial claim'
);
select is(
  (select processing_status from public.billing_provider_events
   where provider_event_id = 'evt_ReplayContract'),
  'processed',
  'successful replay atomically marks the verified event processed'
);
select is(
  (select replay_state
   from public.claim_failed_saas_checkout_completion_replay(
     'evt_ReplayContract', repeat('a', 64),
     'acct_1CTOghL1R5g4hhXt', false, 'local',
     'checkout.session.completed', 'checkout.session',
     'cs_test_ReplayContract'
   )),
  'already_processed',
  'processed replay cannot be opened again'
);

create temporary table replay_unsupported_receipt as
select * from public.claim_saas_billing_provider_event(
  'evt_ReplayUnsupported', 'checkout.session.completed',
  statement_timestamp(), repeat('c', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'checkout.session', 'cs_test_ReplayUnsupported'
);
select public.mark_saas_billing_provider_event_deferred(
  'evt_ReplayUnsupported', repeat('c', 64),
  'acct_1CTOghL1R5g4hhXt', false,
  (select processing_lease_token from replay_unsupported_receipt),
  'awaiting_verified_enrollment_batch'
);
create temporary table replay_unsupported_claim as
select * from public.claim_deferred_saas_billing_provider_event(
  'evt_ReplayUnsupported', repeat('c', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'checkout.session.completed', 'checkout.session',
  'cs_test_ReplayUnsupported'
);
select public.mark_saas_billing_provider_event_failed(
  'evt_ReplayUnsupported', repeat('c', 64),
  'acct_1CTOghL1R5g4hhXt', false,
  (select processing_lease_token from replay_unsupported_claim),
  'unrelated_operational_failure', null, false
);
select is(
  (select replay_state
   from public.claim_failed_saas_checkout_completion_replay(
     'evt_ReplayUnsupported', repeat('c', 64),
     'acct_1CTOghL1R5g4hhXt', false, 'local',
     'checkout.session.completed', 'checkout.session',
     'cs_test_ReplayUnsupported'
   )),
  'not_replayable',
  'an unsupported permanent failure code cannot be reopened'
);

insert into public.billing_checkout_attempts (
  id, store_id, created_by_user_id, requested_plan_key,
  requested_billing_cadence, stripe_price_id, stripe_product_id,
  stripe_livemode, stripe_account_id, checkout_environment_id,
  trial_eligibility, attempt_status, stripe_checkout_session_id,
  stripe_idempotency_key, session_created_at, session_expires_at
) values (
  'fa000000-0000-4000-a000-000000000002',
  'fa000000-0000-4000-9000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'small_flock', 'monthly', 'price_ReplayContract',
  'prod_ReplayContract', false, 'acct_1CTOghL1R5g4hhXt', 'local',
  'trial_already_used', 'open', 'cs_test_ReplayAuthorityExists',
  'ff:saas_checkout:local:fa000000-0000-4000-a000-000000000002:v1',
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '23 hours'
);
create temporary table replay_authority_receipt as
select * from public.claim_saas_billing_provider_event(
  'evt_ReplayAuthorityExists', 'checkout.session.completed',
  statement_timestamp(), repeat('d', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'checkout.session', 'cs_test_ReplayAuthorityExists'
);
select public.mark_saas_billing_provider_event_deferred(
  'evt_ReplayAuthorityExists', repeat('d', 64),
  'acct_1CTOghL1R5g4hhXt', false,
  (select processing_lease_token from replay_authority_receipt),
  'awaiting_verified_enrollment_batch'
);
create temporary table replay_authority_initial_claim as
select * from public.claim_deferred_saas_billing_provider_event(
  'evt_ReplayAuthorityExists', repeat('d', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'checkout.session.completed', 'checkout.session',
  'cs_test_ReplayAuthorityExists'
);
select public.mark_saas_billing_provider_event_failed(
  'evt_ReplayAuthorityExists', repeat('d', 64),
  'acct_1CTOghL1R5g4hhXt', false,
  (select processing_lease_token from replay_authority_initial_claim),
  'checkout_customer_binding_conflict', null, false
);
select is(
  (select replay_state
   from public.claim_failed_saas_checkout_completion_replay(
     'evt_ReplayAuthorityExists', repeat('d', 64),
     'acct_1CTOghL1R5g4hhXt', false, 'local',
     'checkout.session.completed', 'checkout.session',
     'cs_test_ReplayAuthorityExists'
   )),
  'authority_already_exists',
  'replay refuses a store that already has any immutable billing authority'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select * from public.claim_failed_saas_checkout_completion_replay(
    'evt_ReplayContract', repeat('a', 64),
    'acct_1CTOghL1R5g4hhXt', false, 'local',
    'checkout.session.completed', 'checkout.session',
    'cs_test_ReplayContract'
  )$$,
  '42501', null,
  'browser and platform-admin roles have no replay execution authority'
);

select * from finish();
rollback;
