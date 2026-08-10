begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table saas_invoice_concurrency_probe (
  available boolean not null,
  infrastructure_message text,
  duplicate_successes integer,
  duplicate_event_rows integer,
  duplicate_invoice_rows integer,
  race_invoice_status text,
  race_grace_cleared boolean,
  out_of_order_paid_through timestamptz,
  rollback_event_rows integer,
  rollback_paid_through timestamptz
) on commit drop;

do $probe$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), current_database()
  );
  v_gate_key bigint;
  v_first_pid integer;
  v_second_pid integer;
  v_waiters integer;
  v_deadline timestamptz;
  v_first_applied boolean;
  v_second_applied boolean;
  v_duplicate_successes integer;
  v_duplicate_event_rows integer;
  v_duplicate_invoice_rows integer;
  v_race_status text;
  v_race_grace_cleared boolean;
  v_out_of_order_paid_through timestamptz;
  v_rollback_event_rows integer;
  v_rollback_paid_through timestamptz;
  v_gate_locked boolean := false;
  v_error_message text;
begin
  if not exists (select 1 from pg_available_extensions where name = 'dblink') then
    insert into saas_invoice_concurrency_probe(available, infrastructure_message)
    values (false, 'dblink is not available in this PostgreSQL image');
    return;
  end if;

  execute 'create extension if not exists dblink with schema extensions';
  perform extensions.dblink_connect('saas_invoice_first', v_connection_string);
  perform extensions.dblink_connect('saas_invoice_second', v_connection_string);

  perform extensions.dblink_exec(
    'saas_invoice_first',
    $remote$
      set "request.jwt.claim.role" = 'service_role';

      delete from public.email_notification_delivery_attempts as attempts
      using public.email_notifications as notifications
      where attempts.notification_id = notifications.id
        and notifications.store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.email_notifications
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.billing_subscription_invoices
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      update public.seller_billing_status set current_subscription_enrollment_id = null
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.billing_trial_claims
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.billing_subscription_enrollments
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.billing_customer_bindings
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.billing_provider_events
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.stores
      where id = 'b3000000-0000-4000-8000-000000000010';
      delete from auth.users
      where id = 'b3000000-0000-4000-8000-000000000001';

      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      ) values (
        'b3000000-0000-4000-8000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'saas-race-owner@example.test', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        now(), now(), '', '', '', ''
      );

      insert into public.stores (
        id, owner_user_id, store_name, store_slug, store_status,
        storefront_mode, storefront_enabled
      ) values (
        'b3000000-0000-4000-8000-000000000010',
        'b3000000-0000-4000-8000-000000000001',
        'SaaS Invoice Race Store', 'saas-invoice-race-store',
        'live', 'hosted', true
      );

      insert into public.billing_provider_price_catalog (
        stripe_price_id, stripe_livemode, stripe_account_id, plan_key,
        billing_cadence, is_active, stripe_product_id, unit_amount_cents,
        currency, recurring_interval, recurring_interval_count
      ) values (
        'price_race_month', false, 'acct_RacePlatform', 'small_flock',
        'monthly', true, 'prod_race', 500, 'usd', 'month', 1
      ) on conflict (stripe_price_id, stripe_livemode, stripe_account_id)
      do update set is_active = true;

      insert into public.billing_provider_events (
        stripe_livemode, stripe_account_id, provider_event_id,
        provider_event_created_at, store_id, event_type, payload_hash,
        applied, processing_status, processed_at, attempt_count,
        provider_object_type, provider_object_id
      ) values
        (false, 'acct_RacePlatform', 'evt_race_customer', '2029-12-01',
         'b3000000-0000-4000-8000-000000000010', 'customer.created',
         'hash-race-customer', true, 'processed', now(), 1,
         'customer', 'cus_race'),
        (false, 'acct_RacePlatform', 'evt_race_subscription', '2029-12-02',
         'b3000000-0000-4000-8000-000000000010',
         'customer.subscription.created', 'hash-race-subscription',
         true, 'processed', now(), 1, 'subscription', 'sub_race');

      insert into public.billing_customer_bindings (
        id, store_id, stripe_customer_id, stripe_livemode,
        stripe_account_id, provider_created_at, bound_by_event_id
      ) values (
        'b3000000-0000-4000-8000-000000000101',
        'b3000000-0000-4000-8000-000000000010',
        'cus_race', false, 'acct_RacePlatform', '2029-12-01',
        'evt_race_customer'
      );

      insert into public.billing_subscription_enrollments (
        id, store_id, customer_binding_id, stripe_subscription_id,
        initial_stripe_price_id, stripe_livemode, stripe_account_id,
        provider_status, provider_created_at, bound_by_event_id
      ) values (
        'b3000000-0000-4000-8000-000000000201',
        'b3000000-0000-4000-8000-000000000010',
        'b3000000-0000-4000-8000-000000000101', 'sub_race',
        'price_race_month', false, 'acct_RacePlatform', 'active',
        '2029-12-02', 'evt_race_subscription'
      );

      insert into public.seller_billing_status (
        store_id, requested_plan_key, requested_billing_cadence, plan_key,
        billing_plan, subscription_status, billing_state_authority,
        stripe_customer_id, stripe_subscription_id, stripe_price_id,
        stripe_livemode, stripe_account_id,
        current_subscription_enrollment_id
      ) values (
        'b3000000-0000-4000-8000-000000000010',
        'small_flock', 'monthly', 'small_flock', 'monthly', 'active', 'stripe',
        'cus_race', 'sub_race', 'price_race_month', false,
        'acct_RacePlatform', 'b3000000-0000-4000-8000-000000000201'
      );

      create or replace function public.__saas_race_success(
        p_event_id text, p_event_time timestamptz, p_invoice_id text,
        p_period_start timestamptz, p_period_end timestamptz, p_gate bigint
      ) returns boolean
      language plpgsql security definer set search_path = pg_catalog, public
      as $function$
      declare v_applied boolean;
      begin
        perform set_config('request.jwt.claim.role', 'service_role', true);
        perform pg_advisory_xact_lock_shared(p_gate);
        select result.applied into v_applied
        from public.apply_verified_saas_invoice_payment_succeeded(
          p_event_id, p_event_time, 'hash-' || p_event_id,
          'acct_RacePlatform', false,
          'b3000000-0000-4000-8000-000000000010',
          'cus_race', 'sub_race', p_invoice_id, 'price_race_month',
          'subscription_cycle', 'charge_automatically', 'paid', 'usd',
          500, 500, 0, 500, p_period_start, p_period_end, p_event_time
        ) as result;
        return v_applied;
      end;
      $function$;

      create or replace function public.__saas_race_failure(
        p_event_id text, p_event_time timestamptz, p_invoice_id text,
        p_period_start timestamptz, p_period_end timestamptz, p_gate bigint
      ) returns boolean
      language plpgsql security definer set search_path = pg_catalog, public
      as $function$
      declare v_applied boolean;
      begin
        perform set_config('request.jwt.claim.role', 'service_role', true);
        perform pg_advisory_xact_lock_shared(p_gate);
        select result.applied into v_applied
        from public.apply_verified_saas_invoice_payment_failed(
          p_event_id, p_event_time, 'hash-' || p_event_id,
          'acct_RacePlatform', false,
          'b3000000-0000-4000-8000-000000000010',
          'cus_race', 'sub_race', p_invoice_id, 'price_race_month',
          'subscription_cycle', 'charge_automatically', 'open', 'usd',
          500, 0, 500, 500, p_period_start, p_period_end,
          p_event_time, null, 'card_declined'
        ) as result;
        return v_applied;
      end;
      $function$;

      create or replace function public.__saas_rollback_after_success()
      returns text
      language plpgsql security definer set search_path = pg_catalog, public
      as $function$
      begin
        perform set_config('request.jwt.claim.role', 'service_role', true);
        begin
          perform public.apply_verified_saas_invoice_payment_succeeded(
            'evt_race_rollback', '2030-05-01', 'hash-race-rollback',
            'acct_RacePlatform', false,
            'b3000000-0000-4000-8000-000000000010',
            'cus_race', 'sub_race', 'in_race_rollback', 'price_race_month',
            'subscription_cycle', 'charge_automatically', 'paid', 'usd',
            500, 500, 0, 500, '2030-04-01', '2030-05-01', '2030-05-01'
          );
          raise exception 'forced rollback after invoice mutation';
        exception when others then
          return sqlerrm;
        end;
      end;
      $function$;
    $remote$
  );

  select pid into v_first_pid from extensions.dblink(
    'saas_invoice_first', 'select pg_backend_pid()'
  ) as result(pid integer);
  select pid into v_second_pid from extensions.dblink(
    'saas_invoice_second', 'select pg_backend_pid()'
  ) as result(pid integer);

  -- Two simultaneous deliveries of the same successful event converge on one
  -- event row, one invoice row, and one monotonic paid boundary.
  v_gate_key := 912340001;
  perform pg_advisory_lock(v_gate_key);
  v_gate_locked := true;
  perform extensions.dblink_send_query(
    'saas_invoice_first',
    $$select public.__saas_race_success(
      'evt_race_duplicate', '2030-02-01', 'in_race_duplicate',
      '2030-01-01', '2030-02-01', 912340001)$$
  );
  perform extensions.dblink_send_query(
    'saas_invoice_second',
    $$select public.__saas_race_success(
      'evt_race_duplicate', '2030-02-01', 'in_race_duplicate',
      '2030-01-01', '2030-02-01', 912340001)$$
  );
  v_deadline := clock_timestamp() + interval '10 seconds';
  loop
    select count(*)::integer into v_waiters from pg_locks
    where locktype = 'advisory' and pid in (v_first_pid, v_second_pid)
      and not granted;
    exit when v_waiters = 2;
    if clock_timestamp() >= v_deadline then
      raise exception 'Duplicate invoice race barrier timed out.';
    end if;
  end loop;
  perform pg_advisory_unlock(v_gate_key);
  v_gate_locked := false;
  select applied into v_first_applied
  from extensions.dblink_get_result('saas_invoice_first') as result(applied boolean);
  perform * from extensions.dblink_get_result('saas_invoice_first') as result(applied boolean);
  select applied into v_second_applied
  from extensions.dblink_get_result('saas_invoice_second') as result(applied boolean);
  perform * from extensions.dblink_get_result('saas_invoice_second') as result(applied boolean);
  v_duplicate_successes := v_first_applied::integer + v_second_applied::integer;

  select event_rows, invoice_rows
  into v_duplicate_event_rows, v_duplicate_invoice_rows
  from extensions.dblink(
    'saas_invoice_first',
    $$select
      (select count(*)::integer from public.billing_provider_events
       where provider_event_id = 'evt_race_duplicate'),
      (select count(*)::integer from public.billing_subscription_invoices
       where stripe_invoice_id = 'in_race_duplicate')$$
  ) as result(event_rows integer, invoice_rows integer);

  -- A success/failure race for the same invoice is deterministic regardless of
  -- which contender acquires the invoice lock first.
  v_gate_key := 912340002;
  perform pg_advisory_lock(v_gate_key);
  v_gate_locked := true;
  perform extensions.dblink_send_query(
    'saas_invoice_first',
    $$select public.__saas_race_success(
      'evt_race_success', '2030-03-02', 'in_race_mixed',
      '2030-02-01', '2030-03-01', 912340002)$$
  );
  perform extensions.dblink_send_query(
    'saas_invoice_second',
    $$select public.__saas_race_failure(
      'evt_race_failure', '2030-03-01', 'in_race_mixed',
      '2030-02-01', '2030-03-01', 912340002)$$
  );
  v_deadline := clock_timestamp() + interval '10 seconds';
  loop
    select count(*)::integer into v_waiters from pg_locks
    where locktype = 'advisory' and pid in (v_first_pid, v_second_pid)
      and not granted;
    exit when v_waiters = 2;
    if clock_timestamp() >= v_deadline then
      raise exception 'Mixed invoice race barrier timed out.';
    end if;
  end loop;
  perform pg_advisory_unlock(v_gate_key);
  v_gate_locked := false;
  perform * from extensions.dblink_get_result('saas_invoice_first') as result(applied boolean);
  perform * from extensions.dblink_get_result('saas_invoice_first') as result(applied boolean);
  perform * from extensions.dblink_get_result('saas_invoice_second') as result(applied boolean);
  perform * from extensions.dblink_get_result('saas_invoice_second') as result(applied boolean);

  select invoice_status, grace_cleared
  into v_race_status, v_race_grace_cleared
  from extensions.dblink(
    'saas_invoice_first',
    $$select
      (select invoice_status from public.billing_subscription_invoices
       where stripe_invoice_id = 'in_race_mixed'),
      (select grace_ends_at is null from public.seller_billing_status
       where store_id = 'b3000000-0000-4000-8000-000000000010')$$
  ) as result(invoice_status text, grace_cleared boolean);

  -- Two different valid renewal invoices delivered newest-first cannot move
  -- paid-through backward when the older invoice arrives later.
  perform * from extensions.dblink(
    'saas_invoice_first',
    $$select public.__saas_race_success(
      'evt_race_newer_invoice', '2030-04-02', 'in_race_newer',
      '2030-03-01', '2030-04-01', 912349999)$$
  ) as result(applied boolean);
  perform * from extensions.dblink(
    'saas_invoice_first',
    $$select public.__saas_race_success(
      'evt_race_older_invoice', '2030-03-15', 'in_race_older',
      '2030-02-01', '2030-03-01', 912349999)$$
  ) as result(applied boolean);
  select paid_through_at into v_out_of_order_paid_through
  from extensions.dblink(
    'saas_invoice_first',
    $$select paid_through_at from public.seller_billing_status
      where store_id = 'b3000000-0000-4000-8000-000000000010'$$
  ) as result(paid_through_at timestamptz);

  -- A failure after the invoice mutation but before transaction completion
  -- rolls back invoice, event, audit, and billing changes together.
  perform * from extensions.dblink(
    'saas_invoice_first', 'select public.__saas_rollback_after_success()'
  ) as result(message text);
  select event_rows, paid_through_at
  into v_rollback_event_rows, v_rollback_paid_through
  from extensions.dblink(
    'saas_invoice_first',
    $$select
      (select count(*)::integer from public.billing_provider_events
       where provider_event_id = 'evt_race_rollback'),
      (select paid_through_at from public.seller_billing_status
       where store_id = 'b3000000-0000-4000-8000-000000000010')$$
  ) as result(event_rows integer, paid_through_at timestamptz);

  insert into saas_invoice_concurrency_probe values (
    true, null, v_duplicate_successes, v_duplicate_event_rows,
    v_duplicate_invoice_rows, v_race_status, v_race_grace_cleared,
    v_out_of_order_paid_through, v_rollback_event_rows,
    v_rollback_paid_through
  );

  perform extensions.dblink_exec(
    'saas_invoice_first',
    $remote$
      set "request.jwt.claim.role" = 'service_role';
      drop function if exists public.__saas_race_success(text,timestamptz,text,timestamptz,timestamptz,bigint);
      drop function if exists public.__saas_race_failure(text,timestamptz,text,timestamptz,timestamptz,bigint);
      drop function if exists public.__saas_rollback_after_success();
      delete from public.email_notification_delivery_attempts as attempts
      using public.email_notifications as notifications
      where attempts.notification_id = notifications.id
        and notifications.store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.email_notifications
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.billing_subscription_invoices
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      update public.seller_billing_status set current_subscription_enrollment_id = null
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.billing_trial_claims
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.billing_subscription_enrollments
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.billing_customer_bindings
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.billing_provider_events
      where store_id = 'b3000000-0000-4000-8000-000000000010';
      delete from public.stores where id = 'b3000000-0000-4000-8000-000000000010';
      delete from auth.users where id = 'b3000000-0000-4000-8000-000000000001';
      delete from public.billing_provider_price_catalog
      where stripe_price_id = 'price_race_month'
        and not stripe_livemode and stripe_account_id = 'acct_RacePlatform';
    $remote$
  );
  perform extensions.dblink_disconnect('saas_invoice_first');
  perform extensions.dblink_disconnect('saas_invoice_second');
exception when others then
  get stacked diagnostics v_error_message = message_text;
  if v_gate_locked then perform pg_advisory_unlock(v_gate_key); end if;
  begin perform extensions.dblink_disconnect('saas_invoice_first'); exception when others then null; end;
  begin perform extensions.dblink_disconnect('saas_invoice_second'); exception when others then null; end;
  insert into saas_invoice_concurrency_probe(available, infrastructure_message)
  values (true, v_error_message);
end;
$probe$;

select * from skip(
  coalesce((select infrastructure_message from saas_invoice_concurrency_probe),
    'dblink unavailable; SaaS invoice concurrency assertions are pending'),
  8
)
where (select not available from saas_invoice_concurrency_probe)
union all
select ok(infrastructure_message is null,
  'dblink SaaS invoice concurrency infrastructure completes')
from saas_invoice_concurrency_probe where available
union all
select is(duplicate_successes, 2,
  'simultaneous duplicate success deliveries both converge successfully')
from saas_invoice_concurrency_probe where available
union all
select is(duplicate_event_rows, 1,
  'simultaneous duplicate success creates one provider-event row')
from saas_invoice_concurrency_probe where available
union all
select is(duplicate_invoice_rows, 1,
  'simultaneous duplicate success creates one invoice row')
from saas_invoice_concurrency_probe where available
union all
select is(race_invoice_status, 'paid',
  'successful state wins a concurrent success/failure race')
from saas_invoice_concurrency_probe where available
union all
select is(race_grace_cleared, true,
  'successful state clears or prevents raced failure grace')
from saas_invoice_concurrency_probe where available
union all
select is(out_of_order_paid_through, '2030-04-01 00:00:00+00'::timestamptz,
  'out-of-order valid renewal invoices leave paid-through monotonic')
from saas_invoice_concurrency_probe where available
union all
select ok(
  rollback_event_rows = 0
    and rollback_paid_through = '2030-04-01 00:00:00+00'::timestamptz,
  'failed transaction commits neither provider event nor paid-through mutation'
)
from saas_invoice_concurrency_probe where available;

select finish();
rollback;
