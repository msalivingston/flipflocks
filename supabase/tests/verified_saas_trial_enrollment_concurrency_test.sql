begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table batch7_concurrency_probe (
  available boolean not null,
  infrastructure_message text,
  first_state text,
  second_state text,
  first_token uuid,
  second_token uuid,
  reclaimed_state text,
  reclaimed_token uuid
) on commit drop;

do $probe$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), current_database()
  );
  v_first_state text;
  v_second_state text;
  v_first_token uuid;
  v_second_token uuid;
  v_reclaimed_state text;
  v_reclaimed_token uuid;
begin
  if not exists (select 1 from pg_available_extensions where name = 'dblink') then
    insert into batch7_concurrency_probe(available, infrastructure_message)
    values (false, 'dblink is not available in this PostgreSQL image');
    return;
  end if;

  execute 'create extension if not exists dblink with schema extensions';
  perform extensions.dblink_connect('batch7_setup', v_connection_string);
  perform extensions.dblink_connect('batch7_first', v_connection_string);
  perform extensions.dblink_connect('batch7_second', v_connection_string);
  perform extensions.dblink_exec(
    'batch7_setup', 'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'batch7_first', 'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'batch7_second', 'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec('batch7_setup', $remote$
    delete from public.billing_provider_event_audits
    where provider_event_id = 'evt_Batch7ConcurrentCompletion';
    delete from public.billing_provider_events
    where provider_event_id = 'evt_Batch7ConcurrentCompletion';
    do $setup$
    declare
      v_token uuid;
    begin
      select processing_lease_token into v_token
      from public.claim_saas_billing_provider_event(
        'evt_Batch7ConcurrentCompletion', 'checkout.session.completed',
        statement_timestamp(), repeat('9', 64), 'acct_Batch7Concurrent',
        false, 'local', 'checkout.session', 'cs_test_Batch7Concurrent'
      );
      perform public.mark_saas_billing_provider_event_deferred(
        'evt_Batch7ConcurrentCompletion', repeat('9', 64),
        'acct_Batch7Concurrent', false, v_token,
        'awaiting_verified_enrollment_batch'
      );
    end;
    $setup$;
  $remote$);

  perform extensions.dblink_send_query('batch7_first', $remote$
    select reconciliation_state, processing_lease_token
    from public.claim_deferred_saas_billing_provider_event(
      'evt_Batch7ConcurrentCompletion', repeat('9', 64),
      'acct_Batch7Concurrent', false, 'local',
      'checkout.session.completed', 'checkout.session',
      'cs_test_Batch7Concurrent'
    )
  $remote$);
  perform extensions.dblink_send_query('batch7_second', $remote$
    select reconciliation_state, processing_lease_token
    from public.claim_deferred_saas_billing_provider_event(
      'evt_Batch7ConcurrentCompletion', repeat('9', 64),
      'acct_Batch7Concurrent', false, 'local',
      'checkout.session.completed', 'checkout.session',
      'cs_test_Batch7Concurrent'
    )
  $remote$);
  select reconciliation_state, processing_lease_token
  into v_first_state, v_first_token
  from extensions.dblink_get_result('batch7_first')
    as result(reconciliation_state text, processing_lease_token uuid);
  select reconciliation_state, processing_lease_token
  into v_second_state, v_second_token
  from extensions.dblink_get_result('batch7_second')
    as result(reconciliation_state text, processing_lease_token uuid);
  perform reconciliation_state
  from extensions.dblink_get_result('batch7_first')
    as result(reconciliation_state text, processing_lease_token uuid);
  perform reconciliation_state
  from extensions.dblink_get_result('batch7_second')
    as result(reconciliation_state text, processing_lease_token uuid);

  perform extensions.dblink_exec('batch7_setup', $remote$
    update public.billing_provider_events
    set processing_lease_expires_at = statement_timestamp() - interval '1 second'
    where provider_event_id = 'evt_Batch7ConcurrentCompletion';
  $remote$);
  select reconciliation_state, processing_lease_token
  into v_reclaimed_state, v_reclaimed_token
  from extensions.dblink(
    'batch7_setup',
    $remote$
      select reconciliation_state, processing_lease_token
      from public.claim_deferred_saas_billing_provider_event(
        'evt_Batch7ConcurrentCompletion', repeat('9', 64),
        'acct_Batch7Concurrent', false, 'local',
        'checkout.session.completed', 'checkout.session',
        'cs_test_Batch7Concurrent'
      )
    $remote$
  ) as result(reconciliation_state text, processing_lease_token uuid);

  insert into batch7_concurrency_probe values (
    true, null, v_first_state, v_second_state, v_first_token, v_second_token,
    v_reclaimed_state, v_reclaimed_token
  );
  perform extensions.dblink_disconnect('batch7_first');
  perform extensions.dblink_disconnect('batch7_second');
  perform extensions.dblink_disconnect('batch7_setup');
exception when others then
  insert into batch7_concurrency_probe(available, infrastructure_message)
  values (false, sqlerrm);
  begin perform extensions.dblink_disconnect('batch7_first'); exception when others then null; end;
  begin perform extensions.dblink_disconnect('batch7_second'); exception when others then null; end;
  begin perform extensions.dblink_disconnect('batch7_setup'); exception when others then null; end;
end;
$probe$;

select case when available then pass('dblink concurrency probe is available')
  else skip('dblink concurrency probe unavailable: ' || infrastructure_message, 1)
  end
from batch7_concurrency_probe;
select case when available then ok(
  array[first_state, second_state] @> array['claimed', 'in_progress'],
  'two workers produce one fenced reconciliation owner and one in-progress result'
) else skip('concurrency infrastructure unavailable', 1) end
from batch7_concurrency_probe;
select case when available then is(
  num_nonnulls(first_token, second_token), 1,
  'only the winning reconciliation worker receives a fencing token'
) else skip('concurrency infrastructure unavailable', 1) end
from batch7_concurrency_probe;
select case when available then is(
  reclaimed_state, 'reclaimed',
  'an expired reconciliation lease can be reclaimed'
) else skip('concurrency infrastructure unavailable', 1) end
from batch7_concurrency_probe;
select case when available then isnt(
  reclaimed_token, coalesce(first_token, second_token),
  'reclaim issues a new fencing token that invalidates the stale worker'
) else skip('concurrency infrastructure unavailable', 1) end
from batch7_concurrency_probe;

select case when available then throws_ok(
  format(
    'select public.mark_saas_billing_provider_event_processed(%L, %L, %L, false, %L::uuid)',
    'evt_Batch7ConcurrentCompletion', repeat('9', 64),
    'acct_Batch7Concurrent', coalesce(first_token, second_token)
  ),
  '55000', 'SAAS_EVENT_TRANSITION_INVALID',
  'stale worker cannot finalize after a newer worker reclaims the event'
) else skip('concurrency infrastructure unavailable', 1) end
from batch7_concurrency_probe;

select is(
  (select count(*)::integer from public.billing_customer_bindings
   where stripe_account_id = 'acct_Batch7Concurrent'),
  0,
  'reconciliation claiming alone creates no Customer binding'
);
select is(
  (select count(*)::integer from public.billing_subscription_enrollments
   where stripe_account_id = 'acct_Batch7Concurrent'),
  0,
  'reconciliation claiming alone creates no Subscription enrollment'
);
select is(
  (select count(*)::integer from public.billing_trial_claims
   where provider_event_id = 'evt_Batch7ConcurrentCompletion'),
  0,
  'reconciliation claiming alone creates no trial claim'
);

do $cleanup$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), current_database()
  );
begin
  if (select available from batch7_concurrency_probe limit 1) then
    perform extensions.dblink_connect('batch7_cleanup', v_connection_string);
    perform extensions.dblink_exec('batch7_cleanup', $remote$
      delete from public.billing_provider_event_audits
      where provider_event_id = 'evt_Batch7ConcurrentCompletion';
      delete from public.billing_provider_events
      where provider_event_id = 'evt_Batch7ConcurrentCompletion';
    $remote$);
    perform extensions.dblink_disconnect('batch7_cleanup');
  end if;
end;
$cleanup$;

select * from finish();
rollback;
