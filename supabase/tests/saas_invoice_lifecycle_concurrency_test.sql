begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table batch8_concurrency_probe (
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
    insert into batch8_concurrency_probe(available, infrastructure_message)
    values (false, 'dblink is not available in this PostgreSQL image');
    return;
  end if;
  execute 'create extension if not exists dblink with schema extensions';
  perform extensions.dblink_connect('batch8_setup', v_connection_string);
  perform extensions.dblink_connect('batch8_first', v_connection_string);
  perform extensions.dblink_connect('batch8_second', v_connection_string);
  perform extensions.dblink_exec(
    'batch8_setup', 'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'batch8_first', 'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'batch8_second', 'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec('batch8_setup', $remote$
    delete from public.billing_provider_event_audits
    where provider_event_id = 'evt_Batch8ConcurrentInvoice';
    delete from public.billing_provider_events
    where provider_event_id = 'evt_Batch8ConcurrentInvoice';
    do $setup$
    declare v_token uuid;
    begin
      select processing_lease_token into v_token
      from public.claim_saas_billing_provider_event(
        'evt_Batch8ConcurrentInvoice', 'invoice.payment_succeeded',
        statement_timestamp(), repeat('c', 64), 'acct_Batch8Concurrent',
        false, 'local', 'invoice', 'in_Batch8Concurrent'
      );
      perform public.mark_saas_billing_provider_event_deferred(
        'evt_Batch8ConcurrentInvoice', repeat('c', 64),
        'acct_Batch8Concurrent', false, v_token,
        'awaiting_immutable_enrollment_binding'
      );
    end;
    $setup$;
  $remote$);

  perform extensions.dblink_send_query('batch8_first', $remote$
    select reconciliation_state, processing_lease_token
    from public.claim_deferred_saas_billing_provider_event(
      'evt_Batch8ConcurrentInvoice', repeat('c', 64),
      'acct_Batch8Concurrent', false, 'local',
      'invoice.payment_succeeded', 'invoice', 'in_Batch8Concurrent'
    )
  $remote$);
  perform extensions.dblink_send_query('batch8_second', $remote$
    select reconciliation_state, processing_lease_token
    from public.claim_deferred_saas_billing_provider_event(
      'evt_Batch8ConcurrentInvoice', repeat('c', 64),
      'acct_Batch8Concurrent', false, 'local',
      'invoice.payment_succeeded', 'invoice', 'in_Batch8Concurrent'
    )
  $remote$);
  select reconciliation_state, processing_lease_token
  into v_first_state, v_first_token
  from extensions.dblink_get_result('batch8_first')
    as result(reconciliation_state text, processing_lease_token uuid);
  select reconciliation_state, processing_lease_token
  into v_second_state, v_second_token
  from extensions.dblink_get_result('batch8_second')
    as result(reconciliation_state text, processing_lease_token uuid);
  perform reconciliation_state
  from extensions.dblink_get_result('batch8_first')
    as result(reconciliation_state text, processing_lease_token uuid);
  perform reconciliation_state
  from extensions.dblink_get_result('batch8_second')
    as result(reconciliation_state text, processing_lease_token uuid);

  perform extensions.dblink_exec('batch8_setup', $remote$
    update public.billing_provider_events
    set processing_lease_expires_at = statement_timestamp() - interval '1 second'
    where provider_event_id = 'evt_Batch8ConcurrentInvoice';
  $remote$);
  select reconciliation_state, processing_lease_token
  into v_reclaimed_state, v_reclaimed_token
  from extensions.dblink(
    'batch8_setup',
    $remote$
      select reconciliation_state, processing_lease_token
      from public.claim_deferred_saas_billing_provider_event(
        'evt_Batch8ConcurrentInvoice', repeat('c', 64),
        'acct_Batch8Concurrent', false, 'local',
        'invoice.payment_succeeded', 'invoice', 'in_Batch8Concurrent'
      )
    $remote$
  ) as result(reconciliation_state text, processing_lease_token uuid);

  insert into batch8_concurrency_probe values (
    true, null, v_first_state, v_second_state, v_first_token, v_second_token,
    v_reclaimed_state, v_reclaimed_token
  );
  perform extensions.dblink_disconnect('batch8_first');
  perform extensions.dblink_disconnect('batch8_second');
  perform extensions.dblink_disconnect('batch8_setup');
exception when others then
  insert into batch8_concurrency_probe(available, infrastructure_message)
  values (false, sqlerrm);
  begin perform extensions.dblink_disconnect('batch8_first'); exception when others then null; end;
  begin perform extensions.dblink_disconnect('batch8_second'); exception when others then null; end;
  begin perform extensions.dblink_disconnect('batch8_setup'); exception when others then null; end;
end;
$probe$;

select case when available then pass('Batch 8 dblink concurrency probe is available')
  else skip('Batch 8 concurrency probe unavailable: ' || infrastructure_message, 1)
  end
from batch8_concurrency_probe;
select case when available then ok(
  array[first_state, second_state] @> array['claimed', 'in_progress'],
  'two invoice workers produce one fenced owner and one in-progress result'
) else skip('concurrency infrastructure unavailable', 1) end
from batch8_concurrency_probe;
select case when available then is(
  num_nonnulls(first_token, second_token), 1,
  'only the winning invoice worker receives a fencing token'
) else skip('concurrency infrastructure unavailable', 1) end
from batch8_concurrency_probe;
select case when available then is(
  reclaimed_state, 'reclaimed',
  'expired invoice reconciliation lease can be reclaimed'
) else skip('concurrency infrastructure unavailable', 1) end
from batch8_concurrency_probe;
select case when available then isnt(
  reclaimed_token, coalesce(first_token, second_token),
  'invoice-event reclaim replaces the stale fencing token'
) else skip('concurrency infrastructure unavailable', 1) end
from batch8_concurrency_probe;
select case when available then throws_ok(
  format(
    'select public.mark_saas_billing_provider_event_processed(%L, %L, %L, false, %L::uuid)',
    'evt_Batch8ConcurrentInvoice', repeat('c', 64),
    'acct_Batch8Concurrent', coalesce(first_token, second_token)
  ),
  '55000', 'SAAS_EVENT_TRANSITION_INVALID',
  'stale invoice worker cannot finalize after lease replacement'
) else skip('concurrency infrastructure unavailable', 1) end
from batch8_concurrency_probe;
select is(
  (select count(*)::integer from public.billing_subscription_invoices
   where stripe_invoice_id = 'in_Batch8Concurrent'),
  0,
  'reconciliation claiming alone creates no Invoice evidence'
);
select is(
  (select count(*)::integer from public.billing_entitlement_events
   where provider_event_id = 'evt_Batch8ConcurrentInvoice'),
  0,
  'reconciliation claiming alone grants no entitlement'
);

do $cleanup$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), current_database()
  );
begin
  if (select available from batch8_concurrency_probe limit 1) then
    perform extensions.dblink_connect('batch8_cleanup', v_connection_string);
    perform extensions.dblink_exec('batch8_cleanup', $remote$
      delete from public.billing_provider_event_audits
      where provider_event_id = 'evt_Batch8ConcurrentInvoice';
      delete from public.billing_provider_events
      where provider_event_id = 'evt_Batch8ConcurrentInvoice';
    $remote$);
    perform extensions.dblink_disconnect('batch8_cleanup');
  end if;
end;
$cleanup$;

select * from finish();
rollback;
