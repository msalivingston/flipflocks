begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

create temporary table refund_concurrency_probe (
  available boolean not null,
  infrastructure_message text,
  distinct_key_successes integer,
  distinct_key_denials integer,
  distinct_key_refund_total numeric(10, 2),
  identical_key_successes integer,
  identical_key_distinct_ids integer,
  identical_key_row_count integer,
  provider_disabled_results integer
) on commit drop;

do $probe$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()),
    current_database()
  );
  v_first_pid integer;
  v_second_pid integer;
  v_waiter_count integer;
  v_deadline timestamptz;
  v_gate_key bigint;
  v_gate_locked boolean := false;
  v_first_outcome text;
  v_first_refund_id uuid;
  v_second_outcome text;
  v_second_refund_id uuid;
  v_distinct_key_successes integer;
  v_distinct_key_denials integer;
  v_distinct_key_refund_total numeric(10, 2);
  v_identical_key_successes integer;
  v_identical_key_distinct_ids integer;
  v_identical_key_row_count integer;
  v_provider_disabled_results integer;
  v_error_message text;
begin
  if not exists (
    select 1
    from pg_available_extensions
    where name = 'dblink'
  ) then
    insert into refund_concurrency_probe (available, infrastructure_message)
    values (false, 'dblink is not available in this PostgreSQL image');
    return;
  end if;

  execute 'create extension if not exists dblink with schema extensions';
  perform extensions.dblink_connect('refund_first', v_connection_string);
  perform extensions.dblink_connect('refund_second', v_connection_string);

  perform extensions.dblink_exec(
    'refund_first',
    $remote$
      set "request.jwt.claim.role" = 'service_role';

      drop function if exists public.__refund_authority_test_attempt(
        uuid, text, numeric, bigint
      );
      drop function if exists public.__refund_provider_disabled_attempt(bigint);

      delete from public.user_roles
      where user_id = 'e2000000-0000-4000-8000-000000000001';
      delete from public.stores
      where id = 'e2000000-0000-4000-8000-000000000010';
      delete from auth.users
      where id = 'e2000000-0000-4000-8000-000000000001';

      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      )
      values (
        'e2000000-0000-4000-8000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        'refund-concurrency-owner@example.test', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb, now(), now(), '', '', '', ''
      );

      insert into public.stores (
        id, owner_user_id, store_name, store_slug, store_status,
        storefront_mode, storefront_enabled, currency, currency_code
      )
      values (
        'e2000000-0000-4000-8000-000000000010',
        'e2000000-0000-4000-8000-000000000001',
        'Refund Concurrency Store', 'refund-concurrency-store', 'live',
        'hosted', true, 'usd', 'USD'
      );

      insert into public.customers (
        id, store_id, email, first_name, last_name
      )
      values (
        'e2000000-0000-4000-8000-000000000020',
        'e2000000-0000-4000-8000-000000000010',
        'refund-concurrency-buyer@example.test', 'Concurrent', 'Buyer'
      );

      insert into public.orders (
        id, store_id, customer_id, order_number, order_source, order_status,
        payment_method, payment_status, payment_provider, paid_at,
        buyer_email_snapshot, buyer_first_name_snapshot,
        buyer_last_name_snapshot, subtotal_amount, tax_fee_amount,
        total_amount, currency_code
      )
      values
        (
          'e2000000-0000-4000-8000-000000000101',
          'e2000000-0000-4000-8000-000000000010',
          'e2000000-0000-4000-8000-000000000020',
          'REF-CONCURRENT-LIMIT', 'seller_created', 'open',
          'pay_at_pickup', 'paid', 'offline', now(),
          'refund-concurrency-buyer@example.test', 'Concurrent', 'Buyer',
          100.00, 0, 100.00, 'USD'
        ),
        (
          'e2000000-0000-4000-8000-000000000102',
          'e2000000-0000-4000-8000-000000000010',
          'e2000000-0000-4000-8000-000000000020',
          'REF-CONCURRENT-IDEMPOTENCY', 'seller_created', 'open',
          'pay_at_pickup', 'paid', 'offline', now(),
          'refund-concurrency-buyer@example.test', 'Concurrent', 'Buyer',
          100.00, 0, 100.00, 'USD'
        );

      create function public.__refund_authority_test_attempt(
        p_order_id uuid,
        p_key text,
        p_amount numeric,
        p_gate_key bigint
      )
      returns table (
        outcome text,
        refund_id uuid,
        error_message text
      )
      language plpgsql
      security definer
      set search_path = public
      as $function$
      declare
        v_message text;
      begin
        perform set_config(
          'request.jwt.claim.role', 'authenticated', true
        );
        perform set_config(
          'request.jwt.claim.sub',
          'e2000000-0000-4000-8000-000000000001',
          true
        );
        perform pg_advisory_xact_lock_shared(p_gate_key);

        return query
        select
          'success'::text,
          result.refund_id,
          null::text
        from public.seller_record_offline_refund(
          p_order_id,
          p_key,
          p_amount,
          'offline_cash',
          'Concurrency test',
          null
        ) as result;
      exception
        when others then
          get stacked diagnostics v_message = message_text;
          return query
          select
            case
              when v_message = 'Refund amount exceeds remaining refundable amount.'
                then 'refund_unavailable'
              else 'infrastructure_error'
            end,
            null::uuid,
            v_message;
      end;
      $function$;

      create function public.__refund_provider_disabled_attempt(
        p_gate_key bigint
      )
      returns table (outcome text, error_message text)
      language plpgsql
      security definer
      set search_path = public
      as $function$
      declare
        v_message text;
      begin
        perform set_config(
          'request.jwt.claim.role', 'service_role', true
        );
        perform set_config('request.jwt.claim.sub', '', true);
        perform pg_advisory_xact_lock_shared(p_gate_key);

        perform public.record_stripe_refund_result(
          gen_random_uuid(), gen_random_uuid(), 're_concurrent_disabled',
          'succeeded', 'succeeded', now()
        );

        return query select 'unexpected_success'::text, null::text;
      exception
        when others then
          get stacked diagnostics v_message = message_text;
          return query
          select
            case
              when v_message = 'Stripe refund reconciliation is disabled until a verified provider refund workflow is deployed.'
                then 'provider_disabled'
              else 'infrastructure_error'
            end,
            v_message;
      end;
      $function$;
    $remote$
  );

  select pid into v_first_pid
  from extensions.dblink(
    'refund_first', 'select pg_backend_pid()'
  ) as result(pid integer);

  select pid into v_second_pid
  from extensions.dblink(
    'refund_second', 'select pg_backend_pid()'
  ) as result(pid integer);

  -- Two different keys compete for a remaining amount that can satisfy only
  -- one request. The order row lock must serialize the ceiling calculation.
  v_gate_key := 852741001;
  perform pg_advisory_lock(v_gate_key);
  v_gate_locked := true;

  perform extensions.dblink_send_query(
    'refund_first',
    format(
      'select * from public.__refund_authority_test_attempt(%L, %L, %L, %s)',
      'e2000000-0000-4000-8000-000000000101'::uuid,
      'concurrent-limit-first', 60.00, v_gate_key
    )
  );
  perform extensions.dblink_send_query(
    'refund_second',
    format(
      'select * from public.__refund_authority_test_attempt(%L, %L, %L, %s)',
      'e2000000-0000-4000-8000-000000000101'::uuid,
      'concurrent-limit-second', 60.00, v_gate_key
    )
  );

  v_deadline := clock_timestamp() + interval '10 seconds';
  loop
    select count(*)::integer into v_waiter_count
    from pg_locks
    where locktype = 'advisory'
      and pid in (v_first_pid, v_second_pid)
      and granted = false;
    exit when v_waiter_count = 2;
    if clock_timestamp() >= v_deadline then
      raise exception 'Distinct-key refund concurrency barrier timed out.';
    end if;
  end loop;

  perform pg_advisory_unlock(v_gate_key);
  v_gate_locked := false;

  select outcome, refund_id
  into v_first_outcome, v_first_refund_id
  from extensions.dblink_get_result('refund_first')
    as result(outcome text, refund_id uuid, error_message text);
  perform * from extensions.dblink_get_result('refund_first')
    as result(outcome text, refund_id uuid, error_message text);

  select outcome, refund_id
  into v_second_outcome, v_second_refund_id
  from extensions.dblink_get_result('refund_second')
    as result(outcome text, refund_id uuid, error_message text);
  perform * from extensions.dblink_get_result('refund_second')
    as result(outcome text, refund_id uuid, error_message text);

  v_distinct_key_successes :=
    (v_first_outcome = 'success')::integer
    + (v_second_outcome = 'success')::integer;
  v_distinct_key_denials :=
    (v_first_outcome = 'refund_unavailable')::integer
    + (v_second_outcome = 'refund_unavailable')::integer;

  select refund_total into v_distinct_key_refund_total
  from extensions.dblink(
    'refund_first',
    $remote$
      select coalesce(sum(refund_amount), 0)::numeric(10, 2)
      from public.order_refunds
      where order_id = 'e2000000-0000-4000-8000-000000000101'
        and refund_status = 'succeeded'
    $remote$
  ) as result(refund_total numeric(10, 2));

  -- Identical requests must both return success but converge on one row and
  -- one refund id.
  v_gate_key := 852741002;
  perform pg_advisory_lock(v_gate_key);
  v_gate_locked := true;

  perform extensions.dblink_send_query(
    'refund_first',
    format(
      'select * from public.__refund_authority_test_attempt(%L, %L, %L, %s)',
      'e2000000-0000-4000-8000-000000000102'::uuid,
      'concurrent-identical', 50.00, v_gate_key
    )
  );
  perform extensions.dblink_send_query(
    'refund_second',
    format(
      'select * from public.__refund_authority_test_attempt(%L, %L, %L, %s)',
      'e2000000-0000-4000-8000-000000000102'::uuid,
      'concurrent-identical', 50.00, v_gate_key
    )
  );

  v_deadline := clock_timestamp() + interval '10 seconds';
  loop
    select count(*)::integer into v_waiter_count
    from pg_locks
    where locktype = 'advisory'
      and pid in (v_first_pid, v_second_pid)
      and granted = false;
    exit when v_waiter_count = 2;
    if clock_timestamp() >= v_deadline then
      raise exception 'Identical-key refund concurrency barrier timed out.';
    end if;
  end loop;

  perform pg_advisory_unlock(v_gate_key);
  v_gate_locked := false;

  select outcome, refund_id
  into v_first_outcome, v_first_refund_id
  from extensions.dblink_get_result('refund_first')
    as result(outcome text, refund_id uuid, error_message text);
  perform * from extensions.dblink_get_result('refund_first')
    as result(outcome text, refund_id uuid, error_message text);

  select outcome, refund_id
  into v_second_outcome, v_second_refund_id
  from extensions.dblink_get_result('refund_second')
    as result(outcome text, refund_id uuid, error_message text);
  perform * from extensions.dblink_get_result('refund_second')
    as result(outcome text, refund_id uuid, error_message text);

  v_identical_key_successes :=
    (v_first_outcome = 'success')::integer
    + (v_second_outcome = 'success')::integer;
  v_identical_key_distinct_ids :=
    case
      when v_first_refund_id is not null
        and v_first_refund_id = v_second_refund_id then 1
      else 2
    end;

  select row_count into v_identical_key_row_count
  from extensions.dblink(
    'refund_first',
    $remote$
      select count(*)::integer
      from public.order_refunds
      where order_id = 'e2000000-0000-4000-8000-000000000102'
        and idempotency_key = 'concurrent-identical'
    $remote$
  ) as result(row_count integer);

  -- Provider result races are safe while the provider path is disabled: both
  -- calls fail closed before inspecting or mutating a refund.
  v_gate_key := 852741003;
  perform pg_advisory_lock(v_gate_key);
  v_gate_locked := true;

  perform extensions.dblink_send_query(
    'refund_first',
    format(
      'select * from public.__refund_provider_disabled_attempt(%s)',
      v_gate_key
    )
  );
  perform extensions.dblink_send_query(
    'refund_second',
    format(
      'select * from public.__refund_provider_disabled_attempt(%s)',
      v_gate_key
    )
  );

  v_deadline := clock_timestamp() + interval '10 seconds';
  loop
    select count(*)::integer into v_waiter_count
    from pg_locks
    where locktype = 'advisory'
      and pid in (v_first_pid, v_second_pid)
      and granted = false;
    exit when v_waiter_count = 2;
    if clock_timestamp() >= v_deadline then
      raise exception 'Provider-disabled concurrency barrier timed out.';
    end if;
  end loop;

  perform pg_advisory_unlock(v_gate_key);
  v_gate_locked := false;

  select outcome into v_first_outcome
  from extensions.dblink_get_result('refund_first')
    as result(outcome text, error_message text);
  perform * from extensions.dblink_get_result('refund_first')
    as result(outcome text, error_message text);

  select outcome into v_second_outcome
  from extensions.dblink_get_result('refund_second')
    as result(outcome text, error_message text);
  perform * from extensions.dblink_get_result('refund_second')
    as result(outcome text, error_message text);

  v_provider_disabled_results :=
    (v_first_outcome = 'provider_disabled')::integer
    + (v_second_outcome = 'provider_disabled')::integer;

  insert into refund_concurrency_probe (
    available,
    distinct_key_successes,
    distinct_key_denials,
    distinct_key_refund_total,
    identical_key_successes,
    identical_key_distinct_ids,
    identical_key_row_count,
    provider_disabled_results
  )
  values (
    true,
    v_distinct_key_successes,
    v_distinct_key_denials,
    v_distinct_key_refund_total,
    v_identical_key_successes,
    v_identical_key_distinct_ids,
    v_identical_key_row_count,
    v_provider_disabled_results
  );

  perform extensions.dblink_exec(
    'refund_first',
    $remote$
      set "request.jwt.claim.role" = 'service_role';
      drop function if exists public.__refund_authority_test_attempt(
        uuid, text, numeric, bigint
      );
      drop function if exists public.__refund_provider_disabled_attempt(bigint);
      delete from public.user_roles
      where user_id = 'e2000000-0000-4000-8000-000000000001';
      delete from public.stores
      where id = 'e2000000-0000-4000-8000-000000000010';
      delete from auth.users
      where id = 'e2000000-0000-4000-8000-000000000001';
    $remote$
  );

  perform extensions.dblink_disconnect('refund_first');
  perform extensions.dblink_disconnect('refund_second');
exception
  when others then
    get stacked diagnostics v_error_message = message_text;

    if v_gate_locked then
      perform pg_advisory_unlock(v_gate_key);
    end if;

    begin
      perform extensions.dblink_exec(
        'refund_first',
        $remote$
          set "request.jwt.claim.role" = 'service_role';
          drop function if exists public.__refund_authority_test_attempt(
            uuid, text, numeric, bigint
          );
          drop function if exists public.__refund_provider_disabled_attempt(bigint);
          delete from public.user_roles
          where user_id = 'e2000000-0000-4000-8000-000000000001';
          delete from public.stores
          where id = 'e2000000-0000-4000-8000-000000000010';
          delete from auth.users
          where id = 'e2000000-0000-4000-8000-000000000001';
        $remote$
      );
    exception when others then null;
    end;

    begin
      perform extensions.dblink_disconnect('refund_first');
    exception when others then null;
    end;
    begin
      perform extensions.dblink_disconnect('refund_second');
    exception when others then null;
    end;

    insert into refund_concurrency_probe (available, infrastructure_message)
    values (true, v_error_message);
end;
$probe$;

select diag(
  'Refund concurrency infrastructure error: '
    || infrastructure_message
)
from refund_concurrency_probe
where available
  and infrastructure_message is not null;

select *
from skip(
  coalesce(
    (select infrastructure_message from refund_concurrency_probe),
    'dblink unavailable; refund concurrency assertions are pending'
  ),
  8
)
where (select not available from refund_concurrency_probe)
union all
select ok(
  infrastructure_message is null,
  'the dblink refund concurrency infrastructure completes without errors'
)
from refund_concurrency_probe
where available
union all
select is(
  distinct_key_successes,
  1,
  'two different refunds competing for the remaining amount produce one success'
)
from refund_concurrency_probe
where available
union all
select is(
  distinct_key_denials,
  1,
  'the competing refund is denied by the locked remaining-amount ceiling'
)
from refund_concurrency_probe
where available
union all
select is(
  distinct_key_refund_total,
  60.00::numeric(10, 2),
  'concurrent different keys cannot over-refund the order'
)
from refund_concurrency_probe
where available
union all
select is(
  identical_key_successes,
  2,
  'two identical concurrent retries both return success'
)
from refund_concurrency_probe
where available
union all
select is(
  identical_key_distinct_ids,
  1,
  'identical concurrent retries return the same refund id'
)
from refund_concurrency_probe
where available
union all
select is(
  identical_key_row_count,
  1,
  'identical concurrent retries create one refund row'
)
from refund_concurrency_probe
where available
union all
select is(
  provider_disabled_results,
  2,
  'concurrent provider-result calls both fail closed while Stripe refunds are disabled'
)
from refund_concurrency_probe
where available;

select * from finish();

rollback;
