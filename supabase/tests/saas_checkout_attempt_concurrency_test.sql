begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table saas_checkout_concurrency_probe (
  available boolean not null,
  infrastructure_message text,
  first_state text,
  second_state text,
  same_attempt boolean,
  attempt_count bigint,
  trial_claim_count bigint,
  active_entitlement boolean
) on commit drop;

do $probe$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), current_database()
  );
  v_first record;
  v_second record;
  v_attempt_count bigint;
  v_trial_claim_count bigint;
  v_active_entitlement boolean;
begin
  if not exists (select 1 from pg_available_extensions where name = 'dblink') then
    insert into saas_checkout_concurrency_probe(available, infrastructure_message)
    values (false, 'dblink is not available in this PostgreSQL image');
    return;
  end if;

  execute 'create extension if not exists dblink with schema extensions';
  perform extensions.dblink_connect('batch5_setup', v_connection_string);
  perform extensions.dblink_connect('batch5_first', v_connection_string);
  perform extensions.dblink_connect('batch5_second', v_connection_string);

  perform extensions.dblink_exec('batch5_setup', $remote$
    delete from public.billing_entitlement_events
    where store_id = 'd5100000-0000-4000-9000-000000000001';
    delete from public.billing_checkout_attempts
    where store_id = 'd5100000-0000-4000-9000-000000000001';
    delete from public.seller_billing_status
    where store_id = 'd5100000-0000-4000-9000-000000000001';
    delete from public.seller_onboarding_state
    where store_id = 'd5100000-0000-4000-9000-000000000001';
    delete from public.stores
    where id = 'd5100000-0000-4000-9000-000000000001';
    delete from auth.users
    where id = 'd5100000-0000-4000-8000-000000000001';
    delete from public.billing_provider_price_catalog
    where stripe_price_id = 'price_Batch5Race';

    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      'd5100000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'batch5-race@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', ''
    );
    insert into public.stores (
      id, owner_user_id, store_name, store_slug, store_status,
      storefront_mode, storefront_enabled
    ) values (
      'd5100000-0000-4000-9000-000000000001',
      'd5100000-0000-4000-8000-000000000001',
      'Batch 5 Race Store', 'batch-5-race-store', 'draft', 'hosted', false
    );
    insert into public.seller_onboarding_state(store_id, profile_complete)
    values ('d5100000-0000-4000-9000-000000000001', true);
    insert into public.seller_billing_status (
      store_id, requested_plan_key, requested_billing_cadence,
      plan_key, billing_plan, subscription_status, billing_state_authority
    ) values (
      'd5100000-0000-4000-9000-000000000001',
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
      'price_Batch5Race', 'prod_Batch5Race', false,
      'acct_1CTOghL1R5g4hhXt', 'small_flock', 'monthly', true,
      500, 'usd', 'month', 1, 'exclusive', 'txcd_10103001',
      'recurring', 'per_unit', 'licensed', true, true,
      timestamptz '2026-01-01 00:00:00+00',
      timestamptz '2026-01-01 00:00:00+00', now(), '2026-06-24.dahlia'
    );
    update public.platform_settings set boolean_value = true
    where setting_key = 'saas_subscription_checkout_enabled';
  $remote$);

  perform extensions.dblink_exec(
    'batch5_first', 'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'batch5_second', 'set "request.jwt.claim.role" = ''service_role'''
  );

  perform extensions.dblink_send_query('batch5_first', $remote$
    select * from public.begin_saas_subscription_checkout(
      'd5100000-0000-4000-8000-000000000001', 'small_flock', 'monthly',
      false, 'acct_1CTOghL1R5g4hhXt', 'local'
    )
  $remote$);
  perform extensions.dblink_send_query('batch5_second', $remote$
    select * from public.begin_saas_subscription_checkout(
      'd5100000-0000-4000-8000-000000000001', 'small_flock', 'monthly',
      false, 'acct_1CTOghL1R5g4hhXt', 'local'
    )
  $remote$);

  select * into v_first
  from extensions.dblink_get_result('batch5_first') as result(
    checkout_state text, attempt_id uuid, store_id uuid, attempt_status text,
    stripe_price_id text, stripe_product_id text, stripe_customer_id text,
    stripe_checkout_session_id text, stripe_idempotency_key text,
    session_created_at timestamptz, session_expires_at timestamptz,
    trial_eligibility text, retry_after_seconds integer
  );
  select * into v_second
  from extensions.dblink_get_result('batch5_second') as result(
    checkout_state text, attempt_id uuid, store_id uuid, attempt_status text,
    stripe_price_id text, stripe_product_id text, stripe_customer_id text,
    stripe_checkout_session_id text, stripe_idempotency_key text,
    session_created_at timestamptz, session_expires_at timestamptz,
    trial_eligibility text, retry_after_seconds integer
  );

  select count(*) into v_attempt_count
  from public.billing_checkout_attempts
  where store_id = 'd5100000-0000-4000-9000-000000000001';
  select count(*) into v_trial_claim_count
  from public.billing_trial_claims
  where store_id = 'd5100000-0000-4000-9000-000000000001';
  select has_active_access into v_active_entitlement
  from public.resolve_store_entitlement(
    'd5100000-0000-4000-9000-000000000001'
  );

  insert into saas_checkout_concurrency_probe(
    available, first_state, second_state, same_attempt,
    attempt_count, trial_claim_count, active_entitlement
  ) values (
    true, v_first.checkout_state, v_second.checkout_state,
    v_first.attempt_id = v_second.attempt_id,
    v_attempt_count, v_trial_claim_count, v_active_entitlement
  );

  perform extensions.dblink_exec('batch5_setup', $cleanup$
    update public.platform_settings set boolean_value = false
    where setting_key = 'saas_subscription_checkout_enabled';
    delete from public.billing_entitlement_events
    where store_id = 'd5100000-0000-4000-9000-000000000001';
    delete from public.billing_checkout_attempts
    where store_id = 'd5100000-0000-4000-9000-000000000001';
    delete from public.billing_provider_price_catalog
    where stripe_price_id = 'price_Batch5Race';
    delete from public.seller_billing_status
    where store_id = 'd5100000-0000-4000-9000-000000000001';
    delete from public.seller_onboarding_state
    where store_id = 'd5100000-0000-4000-9000-000000000001';
    delete from public.stores
    where id = 'd5100000-0000-4000-9000-000000000001';
    delete from auth.users
    where id = 'd5100000-0000-4000-8000-000000000001';
  $cleanup$);

  perform extensions.dblink_disconnect('batch5_first');
  perform extensions.dblink_disconnect('batch5_second');
  perform extensions.dblink_disconnect('batch5_setup');
exception when others then
  begin
    perform extensions.dblink_exec('batch5_setup', $cleanup$
      update public.platform_settings set boolean_value = false
      where setting_key = 'saas_subscription_checkout_enabled';
      delete from public.billing_entitlement_events
      where store_id = 'd5100000-0000-4000-9000-000000000001';
      delete from public.billing_checkout_attempts
      where store_id = 'd5100000-0000-4000-9000-000000000001';
      delete from public.billing_provider_price_catalog
      where stripe_price_id = 'price_Batch5Race';
      delete from public.seller_billing_status
      where store_id = 'd5100000-0000-4000-9000-000000000001';
      delete from public.seller_onboarding_state
      where store_id = 'd5100000-0000-4000-9000-000000000001';
      delete from public.stores
      where id = 'd5100000-0000-4000-9000-000000000001';
      delete from auth.users
      where id = 'd5100000-0000-4000-8000-000000000001';
    $cleanup$);
  exception when others then null;
  end;
  raise;
end;
$probe$;

select case
  when available then pass('dblink Checkout concurrency infrastructure is available')
  else skip(infrastructure_message, 1)
end
from saas_checkout_concurrency_probe;
select ok(
  first_state in ('created', 'resumable')
  and second_state in ('created', 'resumable')
  and first_state <> second_state,
  'concurrent identical requests create once and resume once'
)
from saas_checkout_concurrency_probe where available;
select is(same_attempt, true, 'concurrent identical requests return the same attempt')
from saas_checkout_concurrency_probe where available;
select is(attempt_count, 1::bigint, 'concurrent identical requests persist one attempt')
from saas_checkout_concurrency_probe where available;
select is(trial_claim_count, 0::bigint, 'concurrent attempts consume no trial claim')
from saas_checkout_concurrency_probe where available;
select is(active_entitlement, false, 'concurrent attempts grant no entitlement')
from saas_checkout_concurrency_probe where available;

select * from finish();
rollback;
