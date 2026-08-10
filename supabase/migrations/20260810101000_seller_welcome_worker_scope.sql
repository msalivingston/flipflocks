-- Narrow worker claim used by the verified enrollment webhook's best-effort
-- Postmark kick. It cannot claim order emails or another seller enrollment.

begin;

create function public.claim_seller_subscription_welcome_email(
  p_subscription_enrollment_id uuid,
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
as $function$
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if p_subscription_enrollment_id is null then
    raise exception 'Subscription enrollment is required.';
  end if;

  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'Max attempts must be at least 1.';
  end if;

  if p_stale_after is null or p_stale_after <= interval '0 seconds' then
    raise exception 'Stale processing interval must be positive.';
  end if;

  return query
  with claimable as (
    select notifications.id
    from public.email_notifications as notifications
    join public.billing_subscription_enrollments as enrollment
      on enrollment.id = notifications.subscription_enrollment_id
     and enrollment.store_id = notifications.store_id
    where enrollment.id = p_subscription_enrollment_id
      and notifications.notification_type = 'seller_subscription_welcome'
      and notifications.recipient_type = 'seller_account'
      and notifications.order_id is null
      and notifications.dedupe_key =
        'seller_subscription_welcome:subscription:' ||
        enrollment.stripe_subscription_id
      and notifications.payload = pg_catalog.jsonb_build_object(
        'schema_version', 'seller_subscription_welcome_v1',
        'subscription_enrollment_id', enrollment.id
      )
      and (
        (
          notifications.notification_status in ('pending', 'failed')
          and notifications.next_attempt_at <= now()
          and notifications.attempt_count < p_max_attempts
        )
        or (
          notifications.notification_status = 'processing'
          and notifications.dispatch_started_at is null
          and notifications.processing_started_at <= now() - p_stale_after
          and notifications.attempt_count < p_max_attempts
        )
      )
    order by notifications.next_attempt_at, notifications.created_at
    limit 1
    for update of notifications skip locked
  ),
  claimed as (
    update public.email_notifications as notifications
    set notification_status = 'processing',
        attempt_count = notifications.attempt_count + 1,
        last_attempt_at = now(),
        processing_started_at = now(),
        processing_token = gen_random_uuid(),
        dispatch_attempt_id = null,
        dispatch_started_at = null,
        delivery_unknown_at = null
    from claimable
    where notifications.id = claimable.id
    returning notifications.*
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
  from claimed;
end;
$function$;

revoke all on function public.claim_seller_subscription_welcome_email(
  uuid, integer, interval
) from public, anon, authenticated, service_role;
grant execute on function public.claim_seller_subscription_welcome_email(
  uuid, integer, interval
) to service_role;

comment on function public.claim_seller_subscription_welcome_email(
  uuid, integer, interval
) is 'Service-only claim for one verified enrollment welcome; never claims order notifications or a different enrollment.';

commit;
