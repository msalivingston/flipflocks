begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table batch6_concurrency_probe (
  available boolean not null,
  infrastructure_message text,
  same_first text,
  same_second text,
  same_row_count bigint,
  conflict_first text,
  conflict_second text,
  conflict_row_count bigint,
  reconcile_first text,
  reconcile_second text,
  reconcile_row_status text,
  rollback_row_count bigint,
  post_rollback_state text
) on commit drop;

do $probe$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), current_database()
  );
  v_same_first text;
  v_same_second text;
  v_conflict_first text;
  v_conflict_second text;
  v_reconcile_first text;
  v_reconcile_second text;
  v_reconcile_status text;
  v_same_count bigint;
  v_conflict_count bigint;
  v_rollback_count bigint;
  v_post_rollback text;
begin
  if not exists (select 1 from pg_available_extensions where name = 'dblink') then
    insert into batch6_concurrency_probe(available, infrastructure_message)
    values (false, 'dblink is not available in this PostgreSQL image');
    return;
  end if;

  execute 'create extension if not exists dblink with schema extensions';
  perform extensions.dblink_connect('batch6_setup', v_connection_string);
  perform extensions.dblink_connect('batch6_first', v_connection_string);
  perform extensions.dblink_connect('batch6_second', v_connection_string);
  perform extensions.dblink_exec('batch6_setup', $remote$
    delete from public.billing_provider_event_audits
    where provider_event_id in (
      'evt_Batch6ConcurrentSame', 'evt_Batch6ConcurrentConflict',
      'evt_Batch6ConcurrentReconcile', 'evt_Batch6TransactionRollback'
    );
    delete from public.billing_provider_events
    where provider_event_id in (
      'evt_Batch6ConcurrentSame', 'evt_Batch6ConcurrentConflict',
      'evt_Batch6ConcurrentReconcile', 'evt_Batch6TransactionRollback'
    );
  $remote$);
  perform extensions.dblink_exec(
    'batch6_first', 'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'batch6_second', 'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'batch6_setup', 'set "request.jwt.claim.role" = ''service_role'''
  );

  perform extensions.dblink_send_query('batch6_first', $remote$
    select claim_state from public.claim_saas_billing_provider_event(
      'evt_Batch6ConcurrentSame', 'invoice.payment_succeeded',
      timestamptz '2026-08-02 13:00:00+00', repeat('1', 64),
      'acct_Batch6', false, 'local', 'invoice', 'in_Batch6ConcurrentSame')
  $remote$);
  perform extensions.dblink_send_query('batch6_second', $remote$
    select claim_state from public.claim_saas_billing_provider_event(
      'evt_Batch6ConcurrentSame', 'invoice.payment_succeeded',
      timestamptz '2026-08-02 13:00:00+00', repeat('1', 64),
      'acct_Batch6', false, 'local', 'invoice', 'in_Batch6ConcurrentSame')
  $remote$);
  select claim_state into v_same_first
  from extensions.dblink_get_result('batch6_first') as result(claim_state text);
  select claim_state into v_same_second
  from extensions.dblink_get_result('batch6_second') as result(claim_state text);
  perform claim_state
  from extensions.dblink_get_result('batch6_first') as result(claim_state text);
  perform claim_state
  from extensions.dblink_get_result('batch6_second') as result(claim_state text);

  perform extensions.dblink_exec('batch6_setup', $remote$
    do $defer$
    declare
      v_token uuid;
    begin
      select processing_lease_token into v_token
      from public.claim_saas_billing_provider_event(
        'evt_Batch6ConcurrentReconcile', 'checkout.session.completed',
        timestamptz '2026-08-02 13:01:30+00', repeat('5', 64),
        'acct_Batch6', false, 'local', 'checkout.session',
        'cs_test_Batch6ConcurrentReconcile'
      );
      perform public.mark_saas_billing_provider_event_deferred(
        'evt_Batch6ConcurrentReconcile', repeat('5', 64),
        'acct_Batch6', false, v_token,
        'awaiting_verified_enrollment_batch'
      );
    end;
    $defer$;
  $remote$);

  perform extensions.dblink_send_query('batch6_first', $remote$
    select reconciliation_state
    from public.claim_deferred_saas_billing_provider_event(
      'evt_Batch6ConcurrentReconcile', repeat('5', 64),
      'acct_Batch6', false, 'local', 'checkout.session.completed',
      'checkout.session', 'cs_test_Batch6ConcurrentReconcile')
  $remote$);
  perform extensions.dblink_send_query('batch6_second', $remote$
    select reconciliation_state
    from public.claim_deferred_saas_billing_provider_event(
      'evt_Batch6ConcurrentReconcile', repeat('5', 64),
      'acct_Batch6', false, 'local', 'checkout.session.completed',
      'checkout.session', 'cs_test_Batch6ConcurrentReconcile')
  $remote$);
  select reconciliation_state into v_reconcile_first
  from extensions.dblink_get_result('batch6_first')
    as result(reconciliation_state text);
  select reconciliation_state into v_reconcile_second
  from extensions.dblink_get_result('batch6_second')
    as result(reconciliation_state text);
  perform reconciliation_state
  from extensions.dblink_get_result('batch6_first')
    as result(reconciliation_state text);
  perform reconciliation_state
  from extensions.dblink_get_result('batch6_second')
    as result(reconciliation_state text);
  select processing_status into v_reconcile_status
  from public.billing_provider_events
  where provider_event_id = 'evt_Batch6ConcurrentReconcile';

  perform extensions.dblink_send_query('batch6_first', $remote$
    select claim_state from public.claim_saas_billing_provider_event(
      'evt_Batch6ConcurrentConflict', 'invoice.payment_succeeded',
      timestamptz '2026-08-02 13:01:00+00', repeat('2', 64),
      'acct_Batch6', false, 'local', 'invoice', 'in_Batch6ConcurrentConflict')
  $remote$);
  perform extensions.dblink_send_query('batch6_second', $remote$
    select claim_state from public.claim_saas_billing_provider_event(
      'evt_Batch6ConcurrentConflict', 'invoice.payment_succeeded',
      timestamptz '2026-08-02 13:01:00+00', repeat('3', 64),
      'acct_Batch6', false, 'local', 'invoice', 'in_Batch6ConcurrentConflict')
  $remote$);
  select claim_state into v_conflict_first
  from extensions.dblink_get_result('batch6_first') as result(claim_state text);
  select claim_state into v_conflict_second
  from extensions.dblink_get_result('batch6_second') as result(claim_state text);
  perform claim_state
  from extensions.dblink_get_result('batch6_first') as result(claim_state text);
  perform claim_state
  from extensions.dblink_get_result('batch6_second') as result(claim_state text);

  perform extensions.dblink_exec('batch6_first', 'begin');
  perform extensions.dblink_send_query('batch6_first', $remote$
    select claim_state from public.claim_saas_billing_provider_event(
      'evt_Batch6TransactionRollback', 'invoice.payment_failed',
      timestamptz '2026-08-02 13:02:00+00', repeat('4', 64),
      'acct_Batch6', false, 'local', 'invoice', 'in_Batch6Rollback')
  $remote$);
  perform claim_state
  from extensions.dblink_get_result('batch6_first') as result(claim_state text);
  perform claim_state
  from extensions.dblink_get_result('batch6_first') as result(claim_state text);
  perform extensions.dblink_exec('batch6_first', 'rollback');

  select count(*) into v_same_count
  from public.billing_provider_events
  where provider_event_id = 'evt_Batch6ConcurrentSame';
  select count(*) into v_conflict_count
  from public.billing_provider_events
  where provider_event_id = 'evt_Batch6ConcurrentConflict';
  select count(*) into v_rollback_count
  from public.billing_provider_events
  where provider_event_id = 'evt_Batch6TransactionRollback';
  select claim_state into v_post_rollback
  from public.claim_saas_billing_provider_event(
    'evt_Batch6TransactionRollback', 'invoice.payment_failed',
    timestamptz '2026-08-02 13:02:00+00', repeat('4', 64),
    'acct_Batch6', false, 'local', 'invoice', 'in_Batch6Rollback');

  insert into batch6_concurrency_probe(
    available, same_first, same_second, same_row_count,
    conflict_first, conflict_second, conflict_row_count,
    reconcile_first, reconcile_second, reconcile_row_status,
    rollback_row_count, post_rollback_state
  ) values (
    true, v_same_first, v_same_second, v_same_count,
    v_conflict_first, v_conflict_second, v_conflict_count,
    v_reconcile_first, v_reconcile_second, v_reconcile_status,
    v_rollback_count, v_post_rollback
  );

  perform extensions.dblink_exec('batch6_setup', $cleanup$
    delete from public.billing_provider_event_audits
    where provider_event_id in (
      'evt_Batch6ConcurrentSame', 'evt_Batch6ConcurrentConflict',
      'evt_Batch6ConcurrentReconcile', 'evt_Batch6TransactionRollback'
    );
    delete from public.billing_provider_events
    where provider_event_id in (
      'evt_Batch6ConcurrentSame', 'evt_Batch6ConcurrentConflict',
      'evt_Batch6ConcurrentReconcile', 'evt_Batch6TransactionRollback'
    );
  $cleanup$);
  perform extensions.dblink_disconnect('batch6_first');
  perform extensions.dblink_disconnect('batch6_second');
  perform extensions.dblink_disconnect('batch6_setup');
exception when others then
  begin
    perform extensions.dblink_exec('batch6_setup', $cleanup$
      delete from public.billing_provider_event_audits
      where provider_event_id like 'evt_Batch6%';
      delete from public.billing_provider_events
      where provider_event_id like 'evt_Batch6%';
    $cleanup$);
  exception when others then null;
  end;
  raise;
end;
$probe$;

select case when available
  then pass('dblink webhook concurrency infrastructure is available')
  else skip(infrastructure_message, 1) end
from batch6_concurrency_probe;
select ok(
  same_first in ('claimed', 'in_progress')
  and same_second in ('claimed', 'in_progress')
  and same_first <> same_second,
  'two simultaneous exact deliveries produce one active processor'
) from batch6_concurrency_probe where available;
select is(same_row_count, 1::bigint, 'simultaneous exact deliveries persist one ledger row')
from batch6_concurrency_probe where available;
select ok(
  conflict_first in ('claimed', 'conflict')
  and conflict_second in ('claimed', 'conflict')
  and conflict_first <> conflict_second,
  'a conflicting-hash race claims one identity and rejects the other'
) from batch6_concurrency_probe where available;
select is(conflict_row_count, 1::bigint, 'conflicting hash race persists one authoritative identity')
from batch6_concurrency_probe where available;
select ok(
  reconcile_first in ('claimed', 'in_progress')
  and reconcile_second in ('claimed', 'in_progress')
  and reconcile_first <> reconcile_second,
  'two reconciliation workers cannot claim the same deferred event'
) from batch6_concurrency_probe where available;
select is(reconcile_row_status, 'processing',
  'one reconciliation worker owns the deferred event processing lease')
from batch6_concurrency_probe where available;
select is(rollback_row_count, 0::bigint, 'transaction failure before terminal state rolls back the claim')
from batch6_concurrency_probe where available;
select is(post_rollback_state, 'claimed', 'delivery after transaction rollback can claim cleanly')
from batch6_concurrency_probe where available;

select * from finish();
rollback;
