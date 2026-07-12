-- Phase 1 Postmark worker claim filter.
--
-- Adds a dedicated claim RPC for the Phase 1 Postmark worker so historical or
-- future non-Phase-1 notification types cannot consume the worker batch.

begin;

create or replace function public.claim_phase_1_postmark_email_notifications(
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
    where email_notifications.notification_type in (
        'buyer_order_confirmation',
        'seller_new_order'
      )
      and (
        (
          email_notifications.notification_status in ('pending', 'failed')
          and email_notifications.next_attempt_at <= now()
          and email_notifications.attempt_count < p_max_attempts
        )
        or (
          email_notifications.notification_status = 'processing'
          and email_notifications.processing_started_at <= now() - p_stale_after
          and email_notifications.attempt_count < p_max_attempts
        )
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

comment on function public.claim_phase_1_postmark_email_notifications(integer, integer, interval) is
'Phase 1 Postmark worker RPC that atomically claims only buyer_order_confirmation and seller_new_order email notifications. Historical cancellation or fulfilled notification rows are intentionally ignored.';

revoke all on function public.claim_phase_1_postmark_email_notifications(integer, integer, interval) from public;
grant execute on function public.claim_phase_1_postmark_email_notifications(integer, integer, interval) to authenticated, service_role;

commit;
