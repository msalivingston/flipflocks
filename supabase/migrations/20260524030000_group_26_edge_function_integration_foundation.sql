-- Group 26: Edge Function & Integration Foundation
--
-- Scope:
-- - Adds lightweight worker/integration invocation audit records.
-- - Adds service/admin recovery helpers for payment provider events.
-- - Adds admin-only operational views for integration queues and worker runs.
--
-- This group does not add:
-- - Edge Function TypeScript code
-- - Stripe or email provider API calls from Postgres
-- - webhook signature verification in Postgres
-- - a second notification queue or payment event table
-- - scheduling, rate limiting, analytics, or marketplace payout workflows


create table public.integration_worker_runs (
  id uuid primary key default gen_random_uuid(),

  worker_name text not null,
  worker_type text not null,
  invocation_id text,
  run_status text not null default 'started',

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  last_error text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint integration_worker_runs_worker_name_not_empty_check check (
    length(trim(worker_name)) > 0
  ),

  constraint integration_worker_runs_worker_type_check check (
    worker_type in (
      'notification',
      'stripe',
      'payment_provider',
      'integration',
      'maintenance'
    )
  ),

  constraint integration_worker_runs_invocation_id_not_empty_check check (
    invocation_id is null
    or length(trim(invocation_id)) > 0
  ),

  constraint integration_worker_runs_status_check check (
    run_status in ('started', 'completed', 'failed')
  ),

  constraint integration_worker_runs_completed_at_check check (
    run_status <> 'completed'
    or completed_at is not null
  ),

  constraint integration_worker_runs_failed_at_check check (
    run_status <> 'failed'
    or failed_at is not null
  ),

  constraint integration_worker_runs_last_error_not_empty_check check (
    last_error is null
    or length(trim(last_error)) > 0
  ),

  constraint integration_worker_runs_metadata_object_check check (
    jsonb_typeof(metadata) = 'object'
  ),

  constraint integration_worker_runs_invocation_unique unique (
    worker_name,
    invocation_id
  )
);

comment on table public.integration_worker_runs is
'Operational audit records for future Edge Functions and workers. This is not a scheduler and does not perform external API calls.';

comment on column public.integration_worker_runs.worker_name is
'Stable application-defined worker name, such as stripe-webhook-handler or email-notification-worker.';

comment on column public.integration_worker_runs.worker_type is
'Broad worker category used for operational filtering.';

comment on column public.integration_worker_runs.invocation_id is
'Optional idempotency/correlation id supplied by Edge Function or worker runtime. Unique per worker when present.';

comment on column public.integration_worker_runs.metadata is
'Small operational metadata only. Do not store secrets, raw provider payloads, card data, or full email bodies here.';

create index integration_worker_runs_started_at_idx
on public.integration_worker_runs(started_at desc);

create index integration_worker_runs_type_status_started_idx
on public.integration_worker_runs(worker_type, run_status, started_at desc);

create index integration_worker_runs_failed_idx
on public.integration_worker_runs(failed_at desc)
where run_status = 'failed';

create trigger integration_worker_runs_set_updated_at
before update on public.integration_worker_runs
for each row
execute function public.set_updated_at();

alter table public.integration_worker_runs enable row level security;

create policy "Platform admins can read integration worker runs"
on public.integration_worker_runs
for select
to authenticated
using (
  public.is_admin()
);

revoke all on public.integration_worker_runs from public;
grant select on public.integration_worker_runs to authenticated;
grant select, insert, update on public.integration_worker_runs to service_role;


create index if not exists payment_provider_events_processing_started_idx
on public.payment_provider_events(processing_started_at, received_at)
where event_status = 'processing';


create or replace view public.admin_integration_queue_overview
with (security_barrier = true) as
select
  'email_notifications'::text as queue_name,
  count(*) filter (where email_notifications.notification_status = 'pending') as pending_count,
  count(*) filter (where email_notifications.notification_status = 'processing') as processing_count,
  count(*) filter (where email_notifications.notification_status = 'failed') as failed_count,
  count(*) filter (
    where email_notifications.notification_status = 'processing'
      and email_notifications.processing_started_at <= now() - interval '15 minutes'
  ) as stale_processing_count,
  min(email_notifications.next_attempt_at) filter (
    where email_notifications.notification_status in ('pending', 'failed')
      and email_notifications.next_attempt_at <= now()
  ) as next_due_at,
  max(email_notifications.updated_at) as last_updated_at
from public.email_notifications
where public.is_admin()
union all
select
  'payment_provider_events'::text as queue_name,
  count(*) filter (where payment_provider_events.event_status = 'received') as pending_count,
  count(*) filter (where payment_provider_events.event_status = 'processing') as processing_count,
  count(*) filter (where payment_provider_events.event_status = 'failed') as failed_count,
  count(*) filter (
    where payment_provider_events.event_status = 'processing'
      and payment_provider_events.processing_started_at <= now() - interval '15 minutes'
  ) as stale_processing_count,
  min(payment_provider_events.received_at) filter (
    where payment_provider_events.event_status in ('received', 'failed')
  ) as next_due_at,
  max(payment_provider_events.updated_at) as last_updated_at
from public.payment_provider_events
where public.is_admin();

comment on view public.admin_integration_queue_overview is
'Admin-only operational queue health view for notification and payment provider processing. It exposes counts, not provider payloads.';

revoke all on public.admin_integration_queue_overview from public;
grant select on public.admin_integration_queue_overview to authenticated;


create or replace view public.admin_integration_worker_runs
with (security_barrier = true) as
select
  integration_worker_runs.id as worker_run_id,
  integration_worker_runs.worker_name,
  integration_worker_runs.worker_type,
  integration_worker_runs.invocation_id,
  integration_worker_runs.run_status,
  integration_worker_runs.started_at,
  integration_worker_runs.completed_at,
  integration_worker_runs.failed_at,
  integration_worker_runs.last_error,
  integration_worker_runs.metadata,
  integration_worker_runs.created_at,
  integration_worker_runs.updated_at
from public.integration_worker_runs
where public.is_admin();

comment on view public.admin_integration_worker_runs is
'Admin-only operational view of future Edge Function and worker invocation history.';

revoke all on public.admin_integration_worker_runs from public;
grant select on public.admin_integration_worker_runs to authenticated;


create or replace function public.can_manage_integration_operations()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role'
    or public.is_admin();
$$;

comment on function public.can_manage_integration_operations() is
'Internal helper for integration worker and provider event recovery RPCs. Allows platform admins and service-role Edge/server workers.';

revoke all on function public.can_manage_integration_operations() from public;


create or replace function public.record_integration_worker_started(
  p_worker_name text,
  p_worker_type text,
  p_invocation_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.integration_worker_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker_name text;
  v_worker_type text;
  v_invocation_id text;
  v_metadata jsonb;
  v_run public.integration_worker_runs%rowtype;
begin
  if not public.can_manage_integration_operations() then
    raise exception 'Not authorized to manage integration worker runs.';
  end if;

  v_worker_name := nullif(trim(p_worker_name), '');
  v_worker_type := nullif(trim(p_worker_type), '');
  v_invocation_id := nullif(trim(p_invocation_id), '');
  v_metadata := coalesce(p_metadata, '{}'::jsonb);

  if v_worker_name is null then
    raise exception 'Worker name is required.';
  end if;

  if v_worker_type not in (
    'notification',
    'stripe',
    'payment_provider',
    'integration',
    'maintenance'
  ) then
    raise exception 'Worker type is not supported.';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'Worker metadata must be a JSON object.';
  end if;

  if v_invocation_id is null then
    insert into public.integration_worker_runs (
      worker_name,
      worker_type,
      run_status,
      metadata
    )
    values (
      v_worker_name,
      v_worker_type,
      'started',
      v_metadata
    )
    returning * into v_run;
  else
    insert into public.integration_worker_runs (
      worker_name,
      worker_type,
      invocation_id,
      run_status,
      started_at,
      completed_at,
      failed_at,
      last_error,
      metadata
    )
    values (
      v_worker_name,
      v_worker_type,
      v_invocation_id,
      'started',
      now(),
      null,
      null,
      null,
      v_metadata
    )
    on conflict (worker_name, invocation_id) do update
    set
      worker_type = excluded.worker_type,
      run_status = 'started',
      started_at = now(),
      completed_at = null,
      failed_at = null,
      last_error = null,
      metadata = excluded.metadata
    where integration_worker_runs.run_status <> 'completed'
    returning * into v_run;

    if v_run.id is null then
      select *
      into v_run
      from public.integration_worker_runs
      where integration_worker_runs.worker_name = v_worker_name
        and integration_worker_runs.invocation_id = v_invocation_id;
    end if;
  end if;

  return v_run;
end;
$$;


create or replace function public.mark_integration_worker_completed(
  p_worker_run_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns public.integration_worker_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metadata jsonb;
  v_run public.integration_worker_runs%rowtype;
begin
  if not public.can_manage_integration_operations() then
    raise exception 'Not authorized to manage integration worker runs.';
  end if;

  v_metadata := coalesce(p_metadata, '{}'::jsonb);

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'Worker metadata must be a JSON object.';
  end if;

  update public.integration_worker_runs
  set
    run_status = 'completed',
    completed_at = now(),
    failed_at = null,
    last_error = null,
    metadata = integration_worker_runs.metadata || v_metadata
  where integration_worker_runs.id = p_worker_run_id
    and integration_worker_runs.run_status in ('started', 'failed')
  returning * into v_run;

  if v_run.id is null then
    raise exception 'Completable worker run was not found.';
  end if;

  return v_run;
end;
$$;


create or replace function public.mark_integration_worker_failed(
  p_worker_run_id uuid,
  p_last_error text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.integration_worker_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_error text;
  v_metadata jsonb;
  v_run public.integration_worker_runs%rowtype;
begin
  if not public.can_manage_integration_operations() then
    raise exception 'Not authorized to manage integration worker runs.';
  end if;

  v_last_error := nullif(trim(p_last_error), '');
  v_metadata := coalesce(p_metadata, '{}'::jsonb);

  if v_last_error is null then
    raise exception 'Worker failure error is required.';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'Worker metadata must be a JSON object.';
  end if;

  update public.integration_worker_runs
  set
    run_status = 'failed',
    failed_at = now(),
    last_error = v_last_error,
    metadata = integration_worker_runs.metadata || v_metadata
  where integration_worker_runs.id = p_worker_run_id
    and integration_worker_runs.run_status in ('started', 'failed')
  returning * into v_run;

  if v_run.id is null then
    raise exception 'Failable worker run was not found.';
  end if;

  return v_run;
end;
$$;


-- Active processing rows are protected unless stale, so recovery actions do
-- not race with a verified webhook handler or worker that is still running.
create or replace function public.retry_payment_provider_event(
  p_payment_provider_event_id uuid,
  p_reason text default null,
  p_stale_after interval default interval '15 minutes'
)
returns public.payment_provider_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_event public.payment_provider_events%rowtype;
begin
  if not public.can_manage_integration_operations() then
    raise exception 'Not authorized to manage payment provider events.';
  end if;

  if p_stale_after is null
    or p_stale_after <= interval '0 seconds' then
    raise exception 'Stale processing interval must be positive.';
  end if;

  v_reason := nullif(trim(p_reason), '');

  update public.payment_provider_events
  set
    event_status = 'received',
    processing_started_at = null,
    failed_at = null,
    last_error = case
      when v_reason is null then last_error
      else 'Retry requested: ' || v_reason
    end
  where payment_provider_events.id = p_payment_provider_event_id
    and (
      payment_provider_events.event_status in ('failed', 'ignored')
      or (
        payment_provider_events.event_status = 'processing'
        and payment_provider_events.processing_started_at <= now() - p_stale_after
      )
    )
  returning * into v_event;

  if v_event.id is null then
    raise exception 'Retryable payment provider event was not found.';
  end if;

  return v_event;
end;
$$;


-- Active processing rows are protected unless stale, so recovery actions do
-- not race with a verified webhook handler or worker that is still running.
create or replace function public.ignore_payment_provider_event(
  p_payment_provider_event_id uuid,
  p_reason text,
  p_stale_after interval default interval '15 minutes'
)
returns public.payment_provider_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_event public.payment_provider_events%rowtype;
begin
  if not public.can_manage_integration_operations() then
    raise exception 'Not authorized to manage payment provider events.';
  end if;

  if p_stale_after is null
    or p_stale_after <= interval '0 seconds' then
    raise exception 'Stale processing interval must be positive.';
  end if;

  v_reason := nullif(trim(p_reason), '');

  if v_reason is null then
    raise exception 'Ignore reason is required.';
  end if;

  update public.payment_provider_events
  set
    event_status = 'ignored',
    processing_started_at = null,
    failed_at = null,
    last_error = 'Ignored: ' || v_reason
  where payment_provider_events.id = p_payment_provider_event_id
    and (
      payment_provider_events.event_status in ('received', 'failed')
      or (
        payment_provider_events.event_status = 'processing'
        and payment_provider_events.processing_started_at <= now() - p_stale_after
      )
    )
  returning * into v_event;

  if v_event.id is null then
    raise exception 'Ignorable payment provider event was not found.';
  end if;

  return v_event;
end;
$$;


comment on function public.record_integration_worker_started(text, text, text, jsonb) is
'Service/admin RPC to record or idempotently restart a future Edge Function or worker invocation. Does not schedule or run work.';

comment on function public.mark_integration_worker_completed(uuid, jsonb) is
'Service/admin RPC to mark a worker run completed and merge small operational metadata.';

comment on function public.mark_integration_worker_failed(uuid, text, jsonb) is
'Service/admin RPC to mark a worker run failed with a safe error summary.';

comment on function public.retry_payment_provider_event(uuid, text, interval) is
'Service/admin RPC to reset a failed or stale processing payment provider event to received so a future verified handler can process it.';

comment on function public.ignore_payment_provider_event(uuid, text, interval) is
'Service/admin RPC to mark a received, processing, or failed payment provider event ignored with a required reason.';

revoke all on function public.record_integration_worker_started(text, text, text, jsonb) from public;
revoke all on function public.mark_integration_worker_completed(uuid, jsonb) from public;
revoke all on function public.mark_integration_worker_failed(uuid, text, jsonb) from public;
revoke all on function public.retry_payment_provider_event(uuid, text, interval) from public;
revoke all on function public.ignore_payment_provider_event(uuid, text, interval) from public;

grant execute on function public.record_integration_worker_started(text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.mark_integration_worker_completed(uuid, jsonb) to authenticated, service_role;
grant execute on function public.mark_integration_worker_failed(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.retry_payment_provider_event(uuid, text, interval) to authenticated, service_role;
grant execute on function public.ignore_payment_provider_event(uuid, text, interval) to authenticated, service_role;
