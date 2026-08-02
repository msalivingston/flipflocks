begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table requested_only_concurrency_probe (
  available boolean not null,
  infrastructure_message text,
  first_billing_complete boolean,
  second_billing_complete boolean,
  first_effective_plan text,
  second_effective_plan text,
  billing_row_count bigint,
  requested_pair text,
  trial_started_at timestamptz,
  trial_claim_count bigint,
  checkout_attempt_count bigint,
  active_entitlement boolean
) on commit drop;

do $probe$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), current_database()
  );
  v_first_billing_complete boolean;
  v_second_billing_complete boolean;
  v_first_effective_plan text;
  v_second_effective_plan text;
  v_billing_row_count bigint;
  v_requested_pair text;
  v_trial_started_at timestamptz;
  v_trial_claim_count bigint;
  v_checkout_attempt_count bigint;
  v_active_entitlement boolean;
begin
  if not exists (select 1 from pg_available_extensions where name = 'dblink') then
    insert into requested_only_concurrency_probe(available, infrastructure_message)
    values (false, 'dblink is not available in this PostgreSQL image');
    return;
  end if;

  execute 'create extension if not exists dblink with schema extensions';
  perform extensions.dblink_connect('batch3_setup', v_connection_string);
  perform extensions.dblink_connect('batch3_first', v_connection_string);
  perform extensions.dblink_connect('batch3_second', v_connection_string);

  perform extensions.dblink_exec('batch3_setup', $remote$
    delete from public.billing_entitlement_events
    where store_id = 'c4100000-0000-4000-9000-000000000001';
    delete from public.seller_billing_status
    where store_id = 'c4100000-0000-4000-9000-000000000001';
    delete from public.seller_onboarding_state
    where store_id = 'c4100000-0000-4000-9000-000000000001';
    delete from public.stores
    where id = 'c4100000-0000-4000-9000-000000000001';
    delete from auth.users
    where id = 'c4100000-0000-4000-8000-000000000001';

    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      'c4100000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'batch3-race@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', ''
    );
    insert into public.stores (
      id, owner_user_id, store_name, store_slug, store_status,
      storefront_mode, storefront_enabled
    ) values (
      'c4100000-0000-4000-9000-000000000001',
      'c4100000-0000-4000-8000-000000000001',
      'Batch 3 Race Store', 'batch-3-race-store', 'draft', 'hosted', false
    );
    insert into public.seller_onboarding_state(store_id, profile_complete)
    values ('c4100000-0000-4000-9000-000000000001', true);
    update public.platform_settings set boolean_value = true
    where setting_key = 'saas_subscription_checkout_enabled';
  $remote$);

  perform extensions.dblink_exec(
    'batch3_first',
    'set "request.jwt.claim.role" = ''authenticated'''
  );
  perform extensions.dblink_exec(
    'batch3_first',
    'set "request.jwt.claim.sub" = ''c4100000-0000-4000-8000-000000000001'''
  );
  perform extensions.dblink_exec(
    'batch3_second',
    'set "request.jwt.claim.role" = ''authenticated'''
  );
  perform extensions.dblink_exec(
    'batch3_second',
    'set "request.jwt.claim.sub" = ''c4100000-0000-4000-8000-000000000001'''
  );

  perform extensions.dblink_send_query('batch3_first', $remote$
    select * from public.seller_save_onboarding_plan_access(
      '{"requested_plan_key":"small_flock","requested_billing_cadence":"monthly"}'
    )
  $remote$);
  perform extensions.dblink_send_query('batch3_second', $remote$
    select * from public.seller_save_onboarding_plan_access(
      '{"requested_plan_key":"full_flock","requested_billing_cadence":"yearly"}'
    )
  $remote$);

  select result.billing_complete, result.plan_key
  into v_first_billing_complete, v_first_effective_plan
  from extensions.dblink_get_result('batch3_first') as result(
    store_id uuid, plan_key text, billing_plan text,
    subscription_status text, applied_promo_code text,
    trial_ends_at timestamptz, storefront_access_until timestamptz,
    billing_complete boolean, next_step integer
  );

  select result.billing_complete, result.plan_key
  into v_second_billing_complete, v_second_effective_plan
  from extensions.dblink_get_result('batch3_second') as result(
    store_id uuid, plan_key text, billing_plan text,
    subscription_status text, applied_promo_code text,
    trial_ends_at timestamptz, storefront_access_until timestamptz,
    billing_complete boolean, next_step integer
  );

  select count(*), max(requested_plan_key || ':' || requested_billing_cadence),
         max(trial_started_at)
  into v_billing_row_count, v_requested_pair, v_trial_started_at
  from public.seller_billing_status
  where store_id = 'c4100000-0000-4000-9000-000000000001';

  select count(*) into v_trial_claim_count
  from public.billing_trial_claims
  where store_id = 'c4100000-0000-4000-9000-000000000001';
  select count(*) into v_checkout_attempt_count
  from public.billing_checkout_attempts
  where store_id = 'c4100000-0000-4000-9000-000000000001';
  select has_active_access into v_active_entitlement
  from public.resolve_store_entitlement(
    'c4100000-0000-4000-9000-000000000001'
  );

  insert into requested_only_concurrency_probe(
    available, first_billing_complete, second_billing_complete,
    first_effective_plan, second_effective_plan, billing_row_count,
    requested_pair, trial_started_at, trial_claim_count,
    checkout_attempt_count, active_entitlement
  ) values (
    true, v_first_billing_complete, v_second_billing_complete,
    v_first_effective_plan, v_second_effective_plan, v_billing_row_count,
    v_requested_pair, v_trial_started_at, v_trial_claim_count,
    v_checkout_attempt_count, v_active_entitlement
  );

  perform extensions.dblink_exec('batch3_setup', $remote$
    update public.platform_settings set boolean_value = false
    where setting_key = 'saas_subscription_checkout_enabled';
    delete from public.billing_entitlement_events
    where store_id = 'c4100000-0000-4000-9000-000000000001';
    delete from public.seller_billing_status
    where store_id = 'c4100000-0000-4000-9000-000000000001';
    delete from public.seller_onboarding_state
    where store_id = 'c4100000-0000-4000-9000-000000000001';
    delete from public.stores
    where id = 'c4100000-0000-4000-9000-000000000001';
    delete from auth.users
    where id = 'c4100000-0000-4000-8000-000000000001';
  $remote$);

  perform extensions.dblink_disconnect('batch3_first');
  perform extensions.dblink_disconnect('batch3_second');
  perform extensions.dblink_disconnect('batch3_setup');
exception when others then
  begin
    perform extensions.dblink_exec('batch3_setup', $cleanup$
      update public.platform_settings set boolean_value = false
      where setting_key = 'saas_subscription_checkout_enabled';
      delete from public.billing_entitlement_events
      where store_id = 'c4100000-0000-4000-9000-000000000001';
      delete from public.seller_billing_status
      where store_id = 'c4100000-0000-4000-9000-000000000001';
      delete from public.seller_onboarding_state
      where store_id = 'c4100000-0000-4000-9000-000000000001';
      delete from public.stores
      where id = 'c4100000-0000-4000-9000-000000000001';
      delete from auth.users
      where id = 'c4100000-0000-4000-8000-000000000001';
    $cleanup$);
  exception when others then null;
  end;
  raise;
end;
$probe$;

select case
  when available then pass('dblink concurrency infrastructure is available')
  else skip(infrastructure_message, 1)
end
from requested_only_concurrency_probe;
select is(first_billing_complete, false,
  'first concurrent request cannot complete billing')
from requested_only_concurrency_probe where available;
select is(second_billing_complete, false,
  'second concurrent request cannot complete billing')
from requested_only_concurrency_probe where available;
select is(first_effective_plan, null::text,
  'first concurrent request returns no effective plan')
from requested_only_concurrency_probe where available;
select is(second_effective_plan, null::text,
  'second concurrent request returns no effective plan')
from requested_only_concurrency_probe where available;
select is(billing_row_count, 1::bigint,
  'concurrent requests serialize to one billing row')
from requested_only_concurrency_probe where available;
select ok(requested_pair in ('small_flock:monthly', 'full_flock:yearly'),
  'concurrent requests leave one internally consistent requested pair')
from requested_only_concurrency_probe where available;
select is(trial_started_at, null::timestamptz,
  'concurrent requests create no trial')
from requested_only_concurrency_probe where available;
select is(trial_claim_count, 0::bigint,
  'concurrent requests consume no trial claim')
from requested_only_concurrency_probe where available;
select is(checkout_attempt_count, 0::bigint,
  'concurrent requests create no Checkout attempt')
from requested_only_concurrency_probe where available;
select is(active_entitlement, false,
  'concurrent requests grant no entitlement')
from requested_only_concurrency_probe where available;

select * from finish();
rollback;
