begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table replay_concurrency_probe (
  available boolean not null,
  first_state text,
  second_state text,
  audit_count bigint,
  event_status text
) on commit drop;

do $probe$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), current_database()
  );
  v_first text;
  v_second text;
  v_audits bigint;
  v_status text;
begin
  if not exists (select 1 from pg_available_extensions where name = 'dblink') then
    insert into replay_concurrency_probe(available)
    values (false);
    return;
  end if;
  execute 'create extension if not exists dblink with schema extensions';
  perform extensions.dblink_connect('replay_setup', v_connection_string);
  perform extensions.dblink_connect('replay_first', v_connection_string);
  perform extensions.dblink_connect('replay_second', v_connection_string);
  perform extensions.dblink_exec('replay_setup',
    'set "request.jwt.claim.role" = ''service_role''');
  perform extensions.dblink_exec('replay_first',
    'set "request.jwt.claim.role" = ''service_role''');
  perform extensions.dblink_exec('replay_second',
    'set "request.jwt.claim.role" = ''service_role''');

  perform extensions.dblink_exec('replay_setup', $setup$
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      'fb000000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'replay-race@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', ''
    );
    insert into public.stores (
      id, owner_user_id, store_name, store_slug, store_status,
      storefront_mode, storefront_enabled
    ) values (
      'fb000000-0000-4000-9000-000000000001',
      'fb000000-0000-4000-8000-000000000001',
      'Replay Race Store', 'replay-race-store', 'draft', 'hosted', false
    );
    insert into public.seller_onboarding_state (store_id, profile_complete)
    values ('fb000000-0000-4000-9000-000000000001', true);
    insert into public.seller_billing_status (
      store_id, requested_plan_key, requested_billing_cadence,
      plan_key, billing_plan, subscription_status, billing_state_authority
    ) values (
      'fb000000-0000-4000-9000-000000000001',
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
      'price_ReplayRace', 'prod_ReplayRace', false, 'acct_ReplayRace',
      'small_flock', 'monthly', true, 500, 'usd', 'month', 1,
      'exclusive', 'txcd_10103001', 'recurring', 'per_unit', 'licensed',
      true, true, now() - interval '1 day', now() - interval '1 day', now(),
      '2026-06-24.dahlia'
    );
    insert into public.billing_checkout_attempts (
      id, store_id, created_by_user_id, requested_plan_key,
      requested_billing_cadence, stripe_price_id, stripe_product_id,
      stripe_livemode, stripe_account_id, checkout_environment_id,
      trial_eligibility, attempt_status, stripe_checkout_session_id,
      stripe_idempotency_key, session_created_at, session_expires_at
    ) values (
      'fb000000-0000-4000-a000-000000000001',
      'fb000000-0000-4000-9000-000000000001',
      'fb000000-0000-4000-8000-000000000001',
      'small_flock', 'monthly', 'price_ReplayRace', 'prod_ReplayRace',
      false, 'acct_ReplayRace', 'local', 'trial_eligible', 'open',
      'cs_test_ReplayRace',
      'ff:saas_checkout:local:fb000000-0000-4000-a000-000000000001:v1',
      now() - interval '1 minute', now() + interval '23 hours'
    );
    do $fixture$
    declare v_receipt uuid; v_claim uuid;
    begin
      select processing_lease_token into v_receipt
      from public.claim_saas_billing_provider_event(
        'evt_ReplayRace', 'checkout.session.completed', now(), repeat('e',64),
        'acct_ReplayRace', false, 'local',
        'checkout.session', 'cs_test_ReplayRace');
      perform public.mark_saas_billing_provider_event_deferred(
        'evt_ReplayRace', repeat('e',64), 'acct_ReplayRace', false,
        v_receipt, 'awaiting_verified_enrollment_batch');
      select processing_lease_token into v_claim
      from public.claim_deferred_saas_billing_provider_event(
        'evt_ReplayRace', repeat('e',64), 'acct_ReplayRace', false, 'local',
        'checkout.session.completed', 'checkout.session',
        'cs_test_ReplayRace');
      perform public.mark_saas_billing_provider_event_failed(
        'evt_ReplayRace', repeat('e',64), 'acct_ReplayRace', false,
        v_claim, 'checkout_price_mismatch', null, false);
    end $fixture$;
  $setup$);

  perform extensions.dblink_send_query('replay_first', $query$
    select replay_state
    from public.claim_failed_saas_checkout_completion_replay(
      'evt_ReplayRace', repeat('e',64), 'acct_ReplayRace', false, 'local',
      'checkout.session.completed', 'checkout.session', 'cs_test_ReplayRace')
  $query$);
  perform extensions.dblink_send_query('replay_second', $query$
    select replay_state
    from public.claim_failed_saas_checkout_completion_replay(
      'evt_ReplayRace', repeat('e',64), 'acct_ReplayRace', false, 'local',
      'checkout.session.completed', 'checkout.session', 'cs_test_ReplayRace')
  $query$);
  select replay_state into v_first
  from extensions.dblink_get_result('replay_first') as r(replay_state text);
  select replay_state into v_second
  from extensions.dblink_get_result('replay_second') as r(replay_state text);
  perform replay_state
  from extensions.dblink_get_result('replay_first') as r(replay_state text);
  perform replay_state
  from extensions.dblink_get_result('replay_second') as r(replay_state text);
  select count(*), max(events.processing_status)
  into v_audits, v_status
  from public.billing_provider_event_audits as audits
  join public.billing_provider_events as events
    using (stripe_livemode, stripe_account_id, provider_event_id)
  where audits.provider_event_id = 'evt_ReplayRace'
    and audits.result_code = 'checkout_conflict_replay_claimed';
  insert into replay_concurrency_probe(
    available, first_state, second_state, audit_count, event_status
  ) values (true, v_first, v_second, v_audits, v_status);

  perform extensions.dblink_exec('replay_setup', $cleanup$
    delete from public.billing_provider_event_audits
    where provider_event_id = 'evt_ReplayRace';
    delete from public.billing_provider_events
    where provider_event_id = 'evt_ReplayRace';
    delete from public.billing_checkout_attempts
    where id = 'fb000000-0000-4000-a000-000000000001';
    delete from public.seller_billing_status
    where store_id = 'fb000000-0000-4000-9000-000000000001';
    delete from public.seller_onboarding_state
    where store_id = 'fb000000-0000-4000-9000-000000000001';
    delete from public.stores
    where id = 'fb000000-0000-4000-9000-000000000001';
    delete from auth.users
    where id = 'fb000000-0000-4000-8000-000000000001';
    delete from public.billing_provider_price_catalog
    where stripe_price_id = 'price_ReplayRace';
  $cleanup$);
  perform extensions.dblink_disconnect('replay_first');
  perform extensions.dblink_disconnect('replay_second');
  perform extensions.dblink_disconnect('replay_setup');
end;
$probe$;

select case when available then
  ok(
    (first_state = 'claimed' and second_state = 'in_progress')
      or (first_state = 'in_progress' and second_state = 'claimed'),
    'two replay workers produce one claim and one in-progress result'
  ) else skip('dblink unavailable', 1) end
from replay_concurrency_probe;
select case when available then
  is(audit_count, 1::bigint, 'concurrent replay creates one claim audit')
  else skip('dblink unavailable', 1) end
from replay_concurrency_probe;
select case when available then
  is(event_status, 'processing', 'one active replay lease remains')
  else skip('dblink unavailable', 1) end
from replay_concurrency_probe;

select * from finish();
rollback;
