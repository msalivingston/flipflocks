-- Phase 1 Postmark transactional email alignment.
--
-- Keeps the existing provider-agnostic outbox, standardizes newly stored
-- order-created notification names, records provider message identifiers, and
-- makes deprecated fulfillment notification enqueue requests a no-op.

begin;

alter table public.email_notifications
add column if not exists provider_name text,
add column if not exists provider_message_id text;

alter table public.email_notifications
add constraint email_notifications_provider_name_not_empty_check check (
  provider_name is null
  or length(trim(provider_name)) > 0
);

alter table public.email_notifications
add constraint email_notifications_provider_message_id_not_empty_check check (
  provider_message_id is null
  or length(trim(provider_message_id)) > 0
);

comment on column public.email_notifications.provider_name is
'Email provider that accepted the message, such as postmark. Null until a provider send succeeds.';

comment on column public.email_notifications.provider_message_id is
'Provider-assigned message identifier returned after a successful send. For Postmark this stores MessageID.';

alter table public.email_notifications
drop constraint if exists email_notifications_notification_type_check;

delete from public.email_notifications as old_notification
where old_notification.notification_type = 'buyer_order_received'
  and exists (
    select 1
    from public.email_notifications as standardized
    where standardized.order_id = old_notification.order_id
      and standardized.notification_type = 'buyer_order_confirmation'
      and standardized.recipient_type = old_notification.recipient_type
  );

update public.email_notifications
set
  notification_type = 'buyer_order_confirmation',
  dedupe_key = 'buyer_order_confirmation:order:' || order_id::text
where notification_type = 'buyer_order_received';

delete from public.email_notifications as old_notification
where old_notification.notification_type = 'seller_new_order_received'
  and exists (
    select 1
    from public.email_notifications as standardized
    where standardized.order_id = old_notification.order_id
      and standardized.notification_type = 'seller_new_order'
      and standardized.recipient_type = old_notification.recipient_type
  );

update public.email_notifications
set
  notification_type = 'seller_new_order',
  dedupe_key = 'seller_new_order:order:' || order_id::text
where notification_type = 'seller_new_order_received';

alter table public.email_notifications
add constraint email_notifications_notification_type_check check (
  notification_type in (
    'buyer_order_confirmation',
    'seller_new_order',
    'buyer_order_canceled',
    'buyer_order_fulfilled'
  )
);

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
declare
  v_notification_type text;
  v_recipient_email text;
  v_dedupe_key text;
  v_payload jsonb;
begin
  v_notification_type := case nullif(trim(coalesce(p_notification_type, '')), '')
    when 'buyer_order_received' then 'buyer_order_confirmation'
    when 'seller_new_order_received' then 'seller_new_order'
    else nullif(trim(coalesce(p_notification_type, '')), '')
  end;

  -- Fulfilled is internal seller tracking only. Keep old fulfillment callers from
  -- blocking order actions, but do not enqueue a fulfillment email.
  if v_notification_type = 'buyer_order_fulfilled' then
    return;
  end if;

  v_recipient_email := lower(nullif(trim(p_recipient_email), ''));
  v_payload := coalesce(p_payload, '{}'::jsonb);

  if p_store_id is null then
    raise exception 'Store is required to enqueue email notification.';
  end if;

  if p_order_id is null then
    raise exception 'Order is required to enqueue email notification.';
  end if;

  if not exists (
    select 1
    from public.orders
    where orders.id = p_order_id
      and orders.store_id = p_store_id
  ) then
    raise exception 'Order does not belong to store.';
  end if;

  if v_notification_type is null
    or v_notification_type not in (
      'buyer_order_confirmation',
      'seller_new_order',
      'buyer_order_canceled'
    ) then
    raise exception 'Invalid email notification type.';
  end if;

  if p_recipient_type is null
    or p_recipient_type not in ('buyer', 'seller') then
    raise exception 'Invalid email notification recipient type.';
  end if;

  if v_notification_type = 'seller_new_order'
    and p_recipient_type = 'seller'
    and v_recipient_email is null then
    select lower(nullif(trim(coalesce(
      stores.order_notification_email,
      stores.communication_email,
      stores.public_email
    )), ''))
    into v_recipient_email
    from public.stores
    where stores.id = p_store_id;
  end if;

  if v_recipient_email is null then
    return;
  end if;

  if p_subject_snapshot is null
    or length(trim(p_subject_snapshot)) = 0 then
    raise exception 'Email notification subject is required.';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'Email notification payload must be a JSON object.';
  end if;

  v_dedupe_key := v_notification_type || ':order:' || p_order_id::text;

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
    p_store_id,
    p_order_id,
    v_dedupe_key,
    p_recipient_type,
    v_recipient_email,
    v_notification_type,
    'pending',
    trim(p_subject_snapshot),
    v_payload
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

comment on function public.enqueue_email_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb
) is
'Trusted provider-agnostic helper for enqueueing transactional order email notifications. Phase 1 stores buyer_order_confirmation and seller_new_order for order-created emails, maps legacy order-created names, ignores deprecated fulfillment notifications, applies seller recipient fallback, and inserts one pending outbox row per order/type.';

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
  v_provider_message_id text;
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if p_notification_id is null
    or p_processing_token is null then
    raise exception 'Notification ID and processing token are required.';
  end if;

  v_provider_message_id := nullif(trim(p_provider_message_id), '');

  update public.email_notifications
  set
    notification_status = 'sent',
    sent_at = coalesce(sent_at, now()),
    processing_started_at = null,
    processing_token = null,
    last_error = null,
    provider_name = case
      when v_provider_message_id is not null then 'postmark'
      else provider_name
    end,
    provider_message_id = coalesce(v_provider_message_id, provider_message_id)
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

grant execute on function public.mark_email_notification_sent(uuid, uuid, text) to authenticated, service_role;

commit;
