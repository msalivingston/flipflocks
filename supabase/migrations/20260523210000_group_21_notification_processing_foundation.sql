-- Group 21: Notification Processing Foundation
--
-- Scope:
-- - Adds database-side processing controls for the Group 18 email outbox.
-- - Provides worker/admin RPCs to claim, complete, fail, retry, and suppress
--   queued transactional email notifications safely.
--
-- This group does not add:
-- - email provider integration
-- - synchronous email sending from Postgres
-- - marketing email
-- - template management
-- - worker scheduling
-- - a new notification table


alter table public.email_notifications
add column if not exists processing_started_at timestamptz;

alter table public.email_notifications
add column if not exists processing_token uuid;

update public.email_notifications
set
  processing_started_at = coalesce(
    processing_started_at,
    last_attempt_at,
    updated_at,
    created_at,
    now()
  ),
  processing_token = coalesce(processing_token, gen_random_uuid())
where notification_status = 'processing'
  and (
    processing_started_at is null
    or processing_token is null
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'email_notifications_processing_lock_status_check'
      and conrelid = 'public.email_notifications'::regclass
  ) then
    alter table public.email_notifications
    add constraint email_notifications_processing_lock_status_check check (
      notification_status <> 'processing'
      or (
        processing_started_at is not null
        and processing_token is not null
      )
    );
  end if;
end;
$$;

comment on column public.email_notifications.processing_started_at is
'Timestamp when the current async processor claim started. Used to identify stale processing attempts without sending email from Postgres.';

comment on column public.email_notifications.processing_token is
'Per-claim token returned to the async processor. Completion/failure RPCs require this token so stale workers cannot acknowledge a later claim.';


create index if not exists email_notifications_processing_started_idx
on public.email_notifications(processing_started_at, created_at)
where notification_status = 'processing';

create index if not exists email_notifications_worker_claim_idx
on public.email_notifications(next_attempt_at, created_at)
where notification_status in ('pending', 'failed');


create or replace function public.can_process_email_notifications()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role'
    or public.is_admin();
$$;

comment on function public.can_process_email_notifications() is
'Internal helper for notification processing RPCs. Allows platform admins and service-role workers to process email outbox rows.';

revoke all on function public.can_process_email_notifications() from public;


create or replace function public.claim_email_notifications(
  p_batch_size integer default 10,
  p_max_attempts integer default 5,
  p_stale_after interval default interval '15 minutes'
)
returns table (
  notification_id uuid,
  processing_token uuid,
  store_id uuid,
  order_id uuid,
  dedupe_key text,
  recipient_type text,
  recipient_email text,
  notification_type text,
  subject_snapshot text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if p_batch_size is null
    or p_batch_size < 1
    or p_batch_size > 100 then
    raise exception 'Batch size must be between 1 and 100.';
  end if;

  if p_max_attempts is null
    or p_max_attempts < 1 then
    raise exception 'Max attempts must be at least 1.';
  end if;

  if p_stale_after is null
    or p_stale_after <= interval '0 seconds' then
    raise exception 'Stale processing interval must be positive.';
  end if;

  return query
  with claimable as (
    select email_notifications.id
    from public.email_notifications
    where (
        email_notifications.notification_status in ('pending', 'failed')
        and email_notifications.next_attempt_at <= now()
        and email_notifications.attempt_count < p_max_attempts
      )
      or (
        email_notifications.notification_status = 'processing'
        and email_notifications.processing_started_at <= now() - p_stale_after
        and email_notifications.attempt_count < p_max_attempts
      )
    order by email_notifications.next_attempt_at, email_notifications.created_at
    limit p_batch_size
    for update skip locked
  ),
  claimed as (
    update public.email_notifications
    set
      notification_status = 'processing',
      attempt_count = email_notifications.attempt_count + 1,
      last_attempt_at = now(),
      processing_started_at = now(),
      processing_token = gen_random_uuid()
    from claimable
    where email_notifications.id = claimable.id
    returning
      email_notifications.id,
      email_notifications.processing_token,
      email_notifications.store_id,
      email_notifications.order_id,
      email_notifications.dedupe_key,
      email_notifications.recipient_type,
      email_notifications.recipient_email,
      email_notifications.notification_type,
      email_notifications.subject_snapshot,
      email_notifications.payload,
      email_notifications.attempt_count
  )
  select
    claimed.id,
    claimed.processing_token,
    claimed.store_id,
    claimed.order_id,
    claimed.dedupe_key,
    claimed.recipient_type,
    claimed.recipient_email,
    claimed.notification_type,
    claimed.subject_snapshot,
    claimed.payload,
    claimed.attempt_count
  from claimed
  order by claimed.attempt_count, claimed.id;
end;
$$;


create or replace function public.mark_email_notification_sent(
  p_notification_id uuid,
  p_processing_token uuid
)
returns public.email_notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.email_notifications%rowtype;
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if p_notification_id is null
    or p_processing_token is null then
    raise exception 'Notification ID and processing token are required.';
  end if;

  update public.email_notifications
  set
    notification_status = 'sent',
    sent_at = coalesce(sent_at, now()),
    processing_started_at = null,
    processing_token = null,
    last_error = null
  where email_notifications.id = p_notification_id
    and email_notifications.processing_token = p_processing_token
    and email_notifications.notification_status = 'processing'
  returning * into v_notification;

  if v_notification.id is null then
    raise exception 'Processing notification claim was not found.';
  end if;

  return v_notification;
end;
$$;


create or replace function public.mark_email_notification_failed(
  p_notification_id uuid,
  p_processing_token uuid,
  p_last_error text,
  p_retry_after interval default interval '5 minutes',
  p_max_attempts integer default 5
)
returns public.email_notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.email_notifications%rowtype;
  v_last_error text;
  v_next_attempt_at timestamptz;
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if p_notification_id is null
    or p_processing_token is null then
    raise exception 'Notification ID and processing token are required.';
  end if;

  v_last_error := nullif(trim(p_last_error), '');

  if v_last_error is null then
    raise exception 'Failure error message is required.';
  end if;

  if p_retry_after is null
    or p_retry_after < interval '0 seconds' then
    raise exception 'Retry interval cannot be negative.';
  end if;

  if p_max_attempts is null
    or p_max_attempts < 1 then
    raise exception 'Max attempts must be at least 1.';
  end if;

  select *
  into v_notification
  from public.email_notifications
  where email_notifications.id = p_notification_id
    and email_notifications.processing_token = p_processing_token
    and email_notifications.notification_status = 'processing'
  for update;

  if v_notification.id is null then
    raise exception 'Processing notification claim was not found.';
  end if;

  if v_notification.attempt_count >= p_max_attempts then
    v_next_attempt_at := 'infinity'::timestamptz;
  else
    v_next_attempt_at := now() + p_retry_after;
  end if;

  update public.email_notifications
  set
    notification_status = 'failed',
    next_attempt_at = v_next_attempt_at,
    processing_started_at = null,
    processing_token = null,
    last_error = v_last_error
  where email_notifications.id = v_notification.id
  returning * into v_notification;

  return v_notification;
end;
$$;


create or replace function public.retry_email_notification(
  p_notification_id uuid,
  p_next_attempt_at timestamptz default now(),
  p_reset_attempt_count boolean default false
)
returns public.email_notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.email_notifications%rowtype;
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if p_notification_id is null then
    raise exception 'Notification ID is required.';
  end if;

  if p_next_attempt_at is null then
    raise exception 'Next attempt time is required.';
  end if;

  update public.email_notifications
  set
    notification_status = 'pending',
    next_attempt_at = p_next_attempt_at,
    attempt_count = case
      when coalesce(p_reset_attempt_count, false)
        then 0
      else email_notifications.attempt_count
    end,
    processing_started_at = null,
    processing_token = null,
    last_error = case
      when coalesce(p_reset_attempt_count, false)
        then null
      else email_notifications.last_error
    end
  where email_notifications.id = p_notification_id
    and email_notifications.notification_status in ('failed', 'processing')
  returning * into v_notification;

  if v_notification.id is null then
    raise exception 'Retryable notification was not found.';
  end if;

  return v_notification;
end;
$$;


create or replace function public.suppress_email_notification(
  p_notification_id uuid,
  p_reason text,
  p_max_attempts integer default 5
)
returns public.email_notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.email_notifications%rowtype;
  v_reason text;
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if p_notification_id is null then
    raise exception 'Notification ID is required.';
  end if;

  if p_max_attempts is null
    or p_max_attempts < 1 then
    raise exception 'Max attempts must be at least 1.';
  end if;

  v_reason := nullif(trim(p_reason), '');

  if v_reason is null then
    raise exception 'Suppression reason is required.';
  end if;

  update public.email_notifications
  set
    notification_status = 'failed',
    attempt_count = greatest(email_notifications.attempt_count, p_max_attempts),
    next_attempt_at = 'infinity'::timestamptz,
    processing_started_at = null,
    processing_token = null,
    last_error = 'Suppressed: ' || v_reason
  where email_notifications.id = p_notification_id
    and email_notifications.notification_status in ('pending', 'processing', 'failed')
  returning * into v_notification;

  if v_notification.id is null then
    raise exception 'Suppressible notification was not found.';
  end if;

  return v_notification;
end;
$$;


comment on function public.claim_email_notifications(integer, integer, interval) is
'Worker/admin RPC that atomically claims due pending/failed notifications, recovers stale processing claims, increments attempt_count, and returns provider-agnostic payloads for asynchronous email delivery.';

comment on function public.mark_email_notification_sent(uuid, uuid) is
'Worker/admin RPC that marks a processing notification sent. Requires the per-claim processing token to prevent stale acknowledgements.';

comment on function public.mark_email_notification_failed(uuid, uuid, text, interval, integer) is
'Worker/admin RPC that marks a processing notification failed, records a safe last_error, and schedules retry unless max attempts has been reached.';

comment on function public.retry_email_notification(uuid, timestamptz, boolean) is
'Admin/worker RPC that resets a failed or stale processing notification to pending for a future retry without creating duplicate notification rows. Can optionally reset attempt_count for terminal failed recovery.';

comment on function public.suppress_email_notification(uuid, text, integer) is
'Admin/worker RPC that suppresses a pending, processing, or failed notification using the existing failed status vocabulary. No canceled status is introduced.';


revoke all on function public.claim_email_notifications(integer, integer, interval) from public;
revoke all on function public.mark_email_notification_sent(uuid, uuid) from public;
revoke all on function public.mark_email_notification_failed(uuid, uuid, text, interval, integer) from public;
revoke all on function public.retry_email_notification(uuid, timestamptz, boolean) from public;
revoke all on function public.suppress_email_notification(uuid, text, integer) from public;

grant execute on function public.claim_email_notifications(integer, integer, interval) to authenticated, service_role;
grant execute on function public.mark_email_notification_sent(uuid, uuid) to authenticated, service_role;
grant execute on function public.mark_email_notification_failed(uuid, uuid, text, interval, integer) to authenticated, service_role;
grant execute on function public.retry_email_notification(uuid, timestamptz, boolean) to authenticated, service_role;
grant execute on function public.suppress_email_notification(uuid, text, integer) to authenticated, service_role;
