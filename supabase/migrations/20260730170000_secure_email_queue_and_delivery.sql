begin;

alter table public.email_notifications
add column if not exists dispatch_attempt_id uuid,
add column if not exists dispatch_started_at timestamptz,
add column if not exists delivery_unknown_at timestamptz;

alter table public.email_notifications
drop constraint if exists email_notifications_notification_status_check;

alter table public.email_notifications
add constraint email_notifications_notification_status_check check (
  notification_status in (
    'pending',
    'processing',
    'dispatching',
    'sent',
    'failed',
    'delivery_unknown'
  )
);

alter table public.email_notifications
add constraint email_notifications_dispatching_state_check check (
  notification_status <> 'dispatching'
  or (
    dispatch_attempt_id is not null
    and dispatch_started_at is not null
    and processing_token is not null
  )
);

alter table public.email_notifications
add constraint email_notifications_delivery_unknown_state_check check (
  notification_status <> 'delivery_unknown'
  or delivery_unknown_at is not null
);

comment on column public.email_notifications.dispatch_attempt_id is
'Stable identifier for the current provider dispatch attempt. Included in provider metadata for later reconciliation.';

comment on column public.email_notifications.dispatch_started_at is
'Time the worker durably marked provider dispatch as started, before making the provider request.';

comment on column public.email_notifications.delivery_unknown_at is
'Time a provider dispatch became ambiguous. delivery_unknown rows are not automatically retried.';

create table public.email_notification_delivery_attempts (
  id uuid primary key,
  notification_id uuid not null
    references public.email_notifications(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  attempt_number integer not null,
  attempt_status text not null,
  provider_name text not null default 'postmark',
  provider_message_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint email_delivery_attempt_number_positive_check check (
    attempt_number >= 1
  ),
  constraint email_delivery_attempt_status_check check (
    attempt_status in ('dispatching', 'succeeded', 'rejected', 'delivery_unknown')
  ),
  constraint email_delivery_attempt_provider_name_not_empty_check check (
    length(trim(provider_name)) > 0
  ),
  constraint email_delivery_attempt_provider_message_id_not_empty_check check (
    provider_message_id is null
    or length(trim(provider_message_id)) > 0
  ),
  constraint email_delivery_attempt_last_error_not_empty_check check (
    last_error is null
    or length(trim(last_error)) > 0
  ),
  constraint email_delivery_attempt_notification_number_unique unique (
    notification_id,
    attempt_number
  )
);

create index email_delivery_attempts_notification_started_idx
on public.email_notification_delivery_attempts(notification_id, started_at desc);

create index email_delivery_attempts_provider_message_idx
on public.email_notification_delivery_attempts(provider_name, provider_message_id)
where provider_message_id is not null;

alter table public.email_notification_delivery_attempts enable row level security;

comment on table public.email_notification_delivery_attempts is
'Provider dispatch audit trail. A row is persisted before Postmark is called and records accepted, rejected, or ambiguous outcomes without automatic retry of ambiguous delivery.';

create or replace function public.enqueue_email_notification(
  p_store_id uuid,
  p_order_id uuid,
  p_notification_type text,
  p_recipient_type text,
  p_recipient_email text,
  p_subject_snapshot text,
  p_payload jsonb,
  p_dedupe_suffix text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_notification_type text;
  v_recipient_type text;
  v_recipient_email text;
  v_subject_snapshot text;
  v_dedupe_suffix text := nullif(trim(coalesce(p_dedupe_suffix, '')), '');
  v_dedupe_key text;
  v_payload jsonb;
begin
  if p_order_id is null then
    raise exception 'Order is required to enqueue email notification.';
  end if;

  select orders.*
  into v_order
  from public.orders as orders
  where orders.id = p_order_id;

  if v_order.id is null
    or p_store_id is null
    or v_order.store_id <> p_store_id then
    raise exception 'Order is not available.';
  end if;

  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = v_order.store_id;

  v_notification_type := case nullif(trim(coalesce(p_notification_type, '')), '')
    when 'buyer_order_received' then 'buyer_order_confirmation'
    when 'seller_new_order_received' then 'seller_new_order'
    else nullif(trim(coalesce(p_notification_type, '')), '')
  end;

  if v_notification_type = 'buyer_order_fulfilled' then
    return;
  end if;

  if v_notification_type not in (
    'buyer_order_confirmation',
    'seller_new_order',
    'buyer_order_updated',
    'seller_order_updated_copy',
    'buyer_order_canceled',
    'seller_order_canceled_copy'
  ) then
    raise exception 'Invalid email notification type.';
  end if;

  v_recipient_type := case
    when v_notification_type in (
      'buyer_order_confirmation',
      'buyer_order_updated',
      'buyer_order_canceled'
    ) then 'buyer'
    else 'seller'
  end;

  if nullif(trim(coalesce(p_recipient_type, '')), '') is not null
    and trim(p_recipient_type) <> v_recipient_type then
    raise exception 'Invalid email notification recipient type.';
  end if;

  v_recipient_email := case
    when v_recipient_type = 'buyer' then
      lower(nullif(trim(v_order.buyer_email_snapshot), ''))
    else
      lower(coalesce(
        nullif(trim(v_store.order_notification_email), ''),
        nullif(trim(v_store.communication_email), ''),
        nullif(trim(v_store.public_email), '')
      ))
  end;

  if v_recipient_email is null then
    return;
  end if;

  if v_notification_type in (
      'buyer_order_updated',
      'seller_order_updated_copy',
      'buyer_order_canceled',
      'seller_order_canceled_copy'
    )
    and v_dedupe_suffix is null then
    raise exception 'Email notification action identifier is required.';
  end if;

  if v_dedupe_suffix is not null and length(v_dedupe_suffix) > 160 then
    raise exception 'Email notification action identifier is too long.';
  end if;

  v_subject_snapshot := case v_notification_type
    when 'buyer_order_confirmation' then
      'Your order with ' ||
      coalesce(nullif(trim(v_store.store_name), ''), 'your store') ||
      ' is confirmed ' || chr(8212) || ' #' || v_order.order_number
    when 'seller_new_order' then
      'New FlockFront order: #' || v_order.order_number
    when 'buyer_order_updated' then
      'Your order with ' ||
      coalesce(nullif(trim(v_store.store_name), ''), 'your store') ||
      ' has been updated ' || chr(8212) || ' #' || v_order.order_number
    when 'seller_order_updated_copy' then
      'Customer copy: Updated order #' || v_order.order_number
    when 'buyer_order_canceled' then
      'Order canceled: #' || v_order.order_number
    when 'seller_order_canceled_copy' then
      'Customer copy: Canceled order #' || v_order.order_number
  end;

  v_payload := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'store_id', v_order.store_id,
    'store_name', v_store.store_name,
    'store_slug', v_store.store_slug,
    'buyer_first_name', v_order.buyer_first_name_snapshot,
    'buyer_last_name', v_order.buyer_last_name_snapshot,
    'buyer_email', v_order.buyer_email_snapshot,
    'order_status', v_order.order_status,
    'payment_status', v_order.payment_status,
    'total_amount', v_order.total_amount,
    'created_at', v_order.created_at,
    'canceled_at', v_order.canceled_at,
    'canceled_reason', v_order.canceled_reason,
    'server_action_id', v_dedupe_suffix,
    'resend', (
      v_notification_type = 'buyer_order_confirmation'
      and v_dedupe_suffix is not null
    )
  );

  v_dedupe_key := v_notification_type || ':order:' || v_order.id::text ||
    case
      when v_dedupe_suffix is null then ''
      else ':action:' || v_dedupe_suffix
    end;

  insert into public.email_notifications (
    store_id,
    order_id,
    dedupe_key,
    recipient_type,
    recipient_email,
    notification_type,
    notification_status,
    subject_snapshot,
    payload
  )
  values (
    v_order.store_id,
    v_order.id,
    v_dedupe_key,
    v_recipient_type,
    v_recipient_email,
    v_notification_type,
    'pending',
    v_subject_snapshot,
    v_payload
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

create or replace function public.enqueue_email_notification(
  p_store_id uuid,
  p_order_id uuid,
  p_notification_type text,
  p_recipient_type text,
  p_recipient_email text,
  p_subject_snapshot text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_email_notification(
    p_store_id,
    p_order_id,
    p_notification_type,
    p_recipient_type,
    p_recipient_email,
    p_subject_snapshot,
    p_payload,
    null
  );
end;
$$;

comment on function public.enqueue_email_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text
) is
'Service-only transactional email primitive. It derives store ownership, canonical recipient, subject, and identity payload from the order and store. Its suffix is accepted only from trusted database/service workflows.';

comment on function public.enqueue_email_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb
) is
'Service-only compatibility overload for trusted order-created email workflows. Browser execution is revoked.';

create or replace function public.claim_email_notifications_internal(
  p_order_id uuid,
  p_phase_1_only boolean,
  p_batch_size integer,
  p_max_attempts integer,
  p_stale_after interval
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

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'Batch size must be between 1 and 100.';
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
    join public.orders as orders
      on orders.id = notifications.order_id
     and orders.store_id = notifications.store_id
    join public.stores as stores
      on stores.id = orders.store_id
    where (p_order_id is null or notifications.order_id = p_order_id)
      and notifications.notification_type in (
        'buyer_order_confirmation',
        'seller_new_order',
        'buyer_order_updated',
        'seller_order_updated_copy',
        'buyer_order_canceled',
        'seller_order_canceled_copy'
      )
      and (
        not coalesce(p_phase_1_only, false)
        or notifications.notification_type in (
          'buyer_order_confirmation',
          'seller_new_order',
          'buyer_order_updated',
          'seller_order_updated_copy',
          'buyer_order_canceled',
          'seller_order_canceled_copy'
        )
      )
      and (
        (
          notifications.recipient_type = 'buyer'
          and notifications.notification_type in (
            'buyer_order_confirmation',
            'buyer_order_updated',
            'buyer_order_canceled'
          )
          and lower(trim(notifications.recipient_email)) =
            lower(trim(orders.buyer_email_snapshot))
        )
        or (
          notifications.recipient_type = 'seller'
          and notifications.notification_type in (
            'seller_new_order',
            'seller_order_updated_copy',
            'seller_order_canceled_copy'
          )
          and lower(trim(notifications.recipient_email)) =
            lower(coalesce(
              nullif(trim(stores.order_notification_email), ''),
              nullif(trim(stores.communication_email), ''),
              nullif(trim(stores.public_email), '')
            ))
        )
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
    limit p_batch_size
    for update of notifications skip locked
  ),
  claimed as (
    update public.email_notifications as notifications
    set
      notification_status = 'processing',
      attempt_count = notifications.attempt_count + 1,
      last_attempt_at = now(),
      processing_started_at = now(),
      processing_token = gen_random_uuid(),
      dispatch_attempt_id = null,
      dispatch_started_at = null,
      delivery_unknown_at = null
    from claimable
    where notifications.id = claimable.id
    returning
      notifications.id,
      notifications.processing_token,
      notifications.store_id,
      notifications.order_id,
      notifications.dedupe_key,
      notifications.recipient_type,
      notifications.recipient_email,
      notifications.notification_type,
      notifications.subject_snapshot,
      notifications.payload,
      notifications.attempt_count
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
language sql
security definer
set search_path = public
as $$
  select *
  from public.claim_email_notifications_internal(
    null,
    false,
    p_batch_size,
    p_max_attempts,
    p_stale_after
  );
$$;

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
language sql
security definer
set search_path = public
as $$
  select *
  from public.claim_email_notifications_internal(
    null,
    true,
    p_batch_size,
    p_max_attempts,
    p_stale_after
  );
$$;

create or replace function public.claim_phase_1_postmark_email_notifications_for_order(
  p_order_id uuid,
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
  if p_order_id is null then
    raise exception 'Order is required.';
  end if;

  return query
  select *
  from public.claim_email_notifications_internal(
    p_order_id,
    true,
    p_batch_size,
    p_max_attempts,
    p_stale_after
  );
end;
$$;

create or replace function public.begin_email_notification_dispatch(
  p_notification_id uuid,
  p_processing_token uuid
)
returns table (
  dispatch_attempt_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.email_notifications%rowtype;
  v_dispatch_attempt_id uuid;
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  select notifications.*
  into v_notification
  from public.email_notifications as notifications
  where notifications.id = p_notification_id
    and notifications.processing_token = p_processing_token
    and notifications.notification_status in ('processing', 'dispatching')
  for update;

  if v_notification.id is null then
    raise exception 'Processing notification claim was not found.';
  end if;

  if v_notification.notification_status = 'dispatching' then
    dispatch_attempt_id := v_notification.dispatch_attempt_id;
    return next;
    return;
  end if;

  v_dispatch_attempt_id := gen_random_uuid();

  insert into public.email_notification_delivery_attempts (
    id,
    notification_id,
    store_id,
    order_id,
    attempt_number,
    attempt_status,
    provider_name,
    started_at
  )
  values (
    v_dispatch_attempt_id,
    v_notification.id,
    v_notification.store_id,
    v_notification.order_id,
    v_notification.attempt_count,
    'dispatching',
    'postmark',
    now()
  );

  update public.email_notifications as notifications
  set
    notification_status = 'dispatching',
    dispatch_attempt_id = v_dispatch_attempt_id,
    dispatch_started_at = now(),
    delivery_unknown_at = null
  where notifications.id = v_notification.id;

  dispatch_attempt_id := v_dispatch_attempt_id;
  return next;
end;
$$;

create or replace function public.mark_email_notification_sent(
  p_notification_id uuid,
  p_processing_token uuid,
  p_provider_message_id text
)
returns public.email_notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.email_notifications%rowtype;
  v_provider_message_id text := nullif(trim(p_provider_message_id), '');
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  select notifications.*
  into v_notification
  from public.email_notifications as notifications
  where notifications.id = p_notification_id
    and notifications.processing_token = p_processing_token
    and notifications.notification_status in ('processing', 'dispatching')
  for update;

  if v_notification.id is null then
    raise exception 'Processing notification claim was not found.';
  end if;

  if v_notification.dispatch_attempt_id is not null then
    update public.email_notification_delivery_attempts as attempts
    set
      attempt_status = 'succeeded',
      provider_message_id = coalesce(v_provider_message_id, attempts.provider_message_id),
      finished_at = now(),
      last_error = null
    where attempts.id = v_notification.dispatch_attempt_id;
  end if;

  update public.email_notifications as notifications
  set
    notification_status = 'sent',
    sent_at = coalesce(notifications.sent_at, now()),
    processing_started_at = null,
    processing_token = null,
    last_error = null,
    provider_name = case
      when v_provider_message_id is not null then 'postmark'
      else notifications.provider_name
    end,
    provider_message_id = coalesce(
      v_provider_message_id,
      notifications.provider_message_id
    ),
    delivery_unknown_at = null
  where notifications.id = v_notification.id
  returning * into v_notification;

  return v_notification;
end;
$$;

create or replace function public.mark_email_notification_sent(
  p_notification_id uuid,
  p_processing_token uuid
)
returns public.email_notifications
language sql
security definer
set search_path = public
as $$
  select public.mark_email_notification_sent(
    p_notification_id,
    p_processing_token,
    null
  );
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
  v_last_error text := nullif(trim(p_last_error), '');
  v_next_attempt_at timestamptz;
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if v_last_error is null then
    raise exception 'Failure error message is required.';
  end if;

  if p_retry_after is null or p_retry_after < interval '0 seconds' then
    raise exception 'Retry interval cannot be negative.';
  end if;

  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'Max attempts must be at least 1.';
  end if;

  select notifications.*
  into v_notification
  from public.email_notifications as notifications
  where notifications.id = p_notification_id
    and notifications.processing_token = p_processing_token
    and notifications.notification_status in ('processing', 'dispatching')
  for update;

  if v_notification.id is null then
    raise exception 'Processing notification claim was not found.';
  end if;

  v_next_attempt_at := case
    when v_notification.attempt_count >= p_max_attempts
      then 'infinity'::timestamptz
    else now() + p_retry_after
  end;

  if v_notification.dispatch_attempt_id is not null then
    update public.email_notification_delivery_attempts as attempts
    set
      attempt_status = 'rejected',
      finished_at = now(),
      last_error = left(v_last_error, 1000)
    where attempts.id = v_notification.dispatch_attempt_id;
  end if;

  update public.email_notifications as notifications
  set
    notification_status = 'failed',
    next_attempt_at = v_next_attempt_at,
    processing_started_at = null,
    processing_token = null,
    last_error = left(v_last_error, 1000),
    delivery_unknown_at = null
  where notifications.id = v_notification.id
  returning * into v_notification;

  return v_notification;
end;
$$;

create or replace function public.mark_email_notification_delivery_unknown(
  p_notification_id uuid,
  p_processing_token uuid,
  p_last_error text,
  p_provider_message_id text default null
)
returns public.email_notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.email_notifications%rowtype;
  v_last_error text := coalesce(
    nullif(trim(p_last_error), ''),
    'Provider delivery outcome is unknown.'
  );
  v_provider_message_id text := nullif(trim(p_provider_message_id), '');
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  select notifications.*
  into v_notification
  from public.email_notifications as notifications
  where notifications.id = p_notification_id
    and notifications.processing_token = p_processing_token
    and notifications.notification_status = 'dispatching'
  for update;

  if v_notification.id is null then
    raise exception 'Dispatching notification claim was not found.';
  end if;

  update public.email_notification_delivery_attempts as attempts
  set
    attempt_status = 'delivery_unknown',
    provider_message_id = coalesce(v_provider_message_id, attempts.provider_message_id),
    finished_at = now(),
    last_error = left(v_last_error, 1000)
  where attempts.id = v_notification.dispatch_attempt_id;

  update public.email_notifications as notifications
  set
    notification_status = 'delivery_unknown',
    next_attempt_at = 'infinity'::timestamptz,
    processing_started_at = null,
    processing_token = null,
    last_error = left(v_last_error, 1000),
    provider_name = 'postmark',
    provider_message_id = coalesce(
      v_provider_message_id,
      notifications.provider_message_id
    ),
    delivery_unknown_at = now()
  where notifications.id = v_notification.id
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

  if p_notification_id is null or p_next_attempt_at is null then
    raise exception 'Notification ID and next attempt time are required.';
  end if;

  update public.email_notifications as notifications
  set
    notification_status = 'pending',
    next_attempt_at = p_next_attempt_at,
    attempt_count = case
      when coalesce(p_reset_attempt_count, false) then 0
      else notifications.attempt_count
    end,
    processing_started_at = null,
    processing_token = null,
    last_error = case
      when coalesce(p_reset_attempt_count, false) then null
      else notifications.last_error
    end,
    dispatch_attempt_id = null,
    dispatch_started_at = null,
    delivery_unknown_at = null,
    provider_name = null,
    provider_message_id = null
  where notifications.id = p_notification_id
    and (
      notifications.notification_status = 'failed'
      or (
        notifications.notification_status = 'processing'
        and notifications.dispatch_started_at is null
      )
    )
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
  v_reason text := nullif(trim(p_reason), '');
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if p_notification_id is null then
    raise exception 'Notification ID is required.';
  end if;

  if v_reason is null then
    raise exception 'Suppression reason is required.';
  end if;

  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'Max attempts must be at least 1.';
  end if;

  update public.email_notifications as notifications
  set
    notification_status = 'failed',
    attempt_count = greatest(notifications.attempt_count, p_max_attempts),
    next_attempt_at = 'infinity'::timestamptz,
    processing_started_at = null,
    processing_token = null,
    last_error = 'Suppressed: ' || left(v_reason, 980)
  where notifications.id = p_notification_id
    and (
      notifications.notification_status in ('pending', 'failed')
      or (
        notifications.notification_status = 'processing'
        and notifications.dispatch_started_at is null
      )
    )
  returning * into v_notification;

  if v_notification.id is null then
    raise exception 'Suppressible notification was not found.';
  end if;

  return v_notification;
end;
$$;

comment on function public.begin_email_notification_dispatch(uuid, uuid) is
'Service-only worker transition that persists a stable dispatch attempt before Postmark is called.';

comment on function public.mark_email_notification_delivery_unknown(
  uuid,
  uuid,
  text,
  text
) is
'Service-only worker transition for ambiguous provider acceptance or failed post-acceptance finalization. These rows are not automatically retried.';

with questionable as (
  select notifications.id
  from public.email_notifications as notifications
  left join public.orders as orders
    on orders.id = notifications.order_id
   and orders.store_id = notifications.store_id
  left join public.stores as stores
    on stores.id = notifications.store_id
  where notifications.notification_status in ('pending', 'failed', 'processing')
    and (
      notifications.notification_status = 'processing'
      or orders.id is null
      or notifications.notification_type not in (
        'buyer_order_confirmation',
        'seller_new_order',
        'buyer_order_updated',
        'seller_order_updated_copy',
        'buyer_order_canceled',
        'seller_order_canceled_copy'
      )
      or (
        notifications.notification_type in (
          'buyer_order_confirmation',
          'buyer_order_updated',
          'buyer_order_canceled'
        )
        and (
          notifications.recipient_type <> 'buyer'
          or nullif(trim(orders.buyer_email_snapshot), '') is null
          or lower(trim(notifications.recipient_email)) <>
            lower(trim(orders.buyer_email_snapshot))
        )
      )
      or (
        notifications.notification_type in (
          'seller_new_order',
          'seller_order_updated_copy',
          'seller_order_canceled_copy'
        )
        and (
          notifications.recipient_type <> 'seller'
          or coalesce(
            nullif(trim(stores.order_notification_email), ''),
            nullif(trim(stores.communication_email), ''),
            nullif(trim(stores.public_email), '')
          ) is null
          or lower(trim(notifications.recipient_email)) <>
            lower(coalesce(
              nullif(trim(stores.order_notification_email), ''),
              nullif(trim(stores.communication_email), ''),
              nullif(trim(stores.public_email), '')
            ))
        )
      )
      or (
        notifications.notification_type = 'buyer_order_confirmation'
        and notifications.dedupe_key like
          'buyer_order_confirmation:order:' ||
          notifications.order_id::text ||
          ':action:%'
      )
      or notifications.dedupe_key not like
        notifications.notification_type ||
        ':order:' ||
        notifications.order_id::text ||
        '%'
    )
)
update public.email_notifications as notifications
set
  notification_status = case
    when notifications.notification_status = 'processing'
      then 'delivery_unknown'
    else 'failed'
  end,
  attempt_count = case
    when notifications.notification_status = 'processing'
      then greatest(notifications.attempt_count, 1)
    else greatest(notifications.attempt_count, 5)
  end,
  next_attempt_at = 'infinity'::timestamptz,
  processing_started_at = null,
  processing_token = null,
  last_error = case
    when notifications.notification_status = 'processing'
      then 'Legacy queue row quarantined during dispatch; delivery outcome requires reconciliation.'
    else 'Suppressed: legacy queue row failed canonical authorization checks.'
  end,
  delivery_unknown_at = case
    when notifications.notification_status = 'processing' then now()
    else notifications.delivery_unknown_at
  end
from questionable
where notifications.id = questionable.id;

with excessive as (
  select ranked.id
  from (
    select
      notifications.id,
      row_number() over (
        partition by notifications.order_id, notifications.notification_type
        order by notifications.created_at desc, notifications.id desc
      ) as notification_rank
    from public.email_notifications as notifications
    where notifications.notification_status in ('pending', 'failed')
      and notifications.notification_type in (
        'buyer_order_updated',
        'seller_order_updated_copy',
        'buyer_order_canceled',
        'seller_order_canceled_copy'
      )
  ) as ranked
  where ranked.notification_rank > 1
)
update public.email_notifications as notifications
set
  notification_status = 'failed',
  attempt_count = greatest(notifications.attempt_count, 5),
  next_attempt_at = 'infinity'::timestamptz,
  processing_started_at = null,
  processing_token = null,
  last_error = 'Suppressed: excessive legacy action-suffix variation requires review.'
from excessive
where notifications.id = excessive.id;

revoke all on function public.can_process_email_notifications()
from public, anon, authenticated, service_role;

revoke all on function public.enqueue_email_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role;

revoke all on function public.enqueue_email_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.claim_email_notifications_internal(
  uuid,
  boolean,
  integer,
  integer,
  interval
) from public, anon, authenticated, service_role;

revoke all on function public.claim_email_notifications(integer, integer, interval)
from public, anon, authenticated, service_role;

revoke all on function public.claim_phase_1_postmark_email_notifications(
  integer,
  integer,
  interval
) from public, anon, authenticated, service_role;

revoke all on function public.claim_phase_1_postmark_email_notifications_for_order(
  uuid,
  integer,
  integer,
  interval
) from public, anon, authenticated, service_role;

revoke all on function public.begin_email_notification_dispatch(uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function public.mark_email_notification_sent(uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function public.mark_email_notification_sent(uuid, uuid, text)
from public, anon, authenticated, service_role;

revoke all on function public.mark_email_notification_failed(
  uuid,
  uuid,
  text,
  interval,
  integer
) from public, anon, authenticated, service_role;

revoke all on function public.mark_email_notification_delivery_unknown(
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated, service_role;

revoke all on function public.retry_email_notification(uuid, timestamptz, boolean)
from public, anon, authenticated, service_role;

revoke all on function public.suppress_email_notification(uuid, text, integer)
from public, anon, authenticated, service_role;

grant execute on function public.enqueue_email_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text
) to service_role;

grant execute on function public.enqueue_email_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;

grant execute on function public.claim_email_notifications_internal(
  uuid,
  boolean,
  integer,
  integer,
  interval
) to service_role;

grant execute on function public.claim_email_notifications(integer, integer, interval)
to service_role;

grant execute on function public.claim_phase_1_postmark_email_notifications(
  integer,
  integer,
  interval
) to service_role;

grant execute on function public.claim_phase_1_postmark_email_notifications_for_order(
  uuid,
  integer,
  integer,
  interval
) to service_role;

grant execute on function public.begin_email_notification_dispatch(uuid, uuid)
to service_role;

grant execute on function public.mark_email_notification_sent(uuid, uuid)
to service_role;

grant execute on function public.mark_email_notification_sent(uuid, uuid, text)
to service_role;

grant execute on function public.mark_email_notification_failed(
  uuid,
  uuid,
  text,
  interval,
  integer
) to service_role;

grant execute on function public.mark_email_notification_delivery_unknown(
  uuid,
  uuid,
  text,
  text
) to service_role;

grant execute on function public.retry_email_notification(uuid, timestamptz, boolean)
to service_role;

grant execute on function public.suppress_email_notification(uuid, text, integer)
to service_role;

commit;
