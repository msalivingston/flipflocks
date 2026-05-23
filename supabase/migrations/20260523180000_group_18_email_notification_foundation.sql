-- Group 18: Email Notification Foundation
--
-- Scope:
-- - Adds a private seller order notification email field to stores.
-- - Adds a provider-agnostic transactional email outbox/history table.
--
-- This group does not add:
-- - marketing email
-- - newsletters or promotional campaigns
-- - buyer-to-seller messaging
-- - internal chat
-- - SMS or push notifications
-- - reminder campaigns or drip sequences
-- - review requests
-- - template management tables
-- - provider-specific delivery schema
-- - synchronous email delivery


alter table public.stores
add column order_notification_email text;

alter table public.stores
add constraint stores_order_notification_email_not_empty_check check (
  order_notification_email is null
  or length(trim(order_notification_email)) > 0
);

comment on column public.stores.order_notification_email is
'Private seller-facing email address for operational order notifications. This is not a public storefront contact field and is not controlled by show_public_email.';


create table public.email_notifications (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,

  dedupe_key text not null,

  recipient_type text not null,
  recipient_email text not null,

  notification_type text not null,
  notification_status text not null default 'pending',

  subject_snapshot text not null,
  payload jsonb not null default '{}'::jsonb,

  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_notifications_dedupe_key_unique unique (dedupe_key),

  constraint email_notifications_dedupe_key_not_empty_check check (
    length(trim(dedupe_key)) > 0
  ),

  constraint email_notifications_recipient_type_check check (
    recipient_type in ('buyer', 'seller')
  ),

  constraint email_notifications_recipient_email_not_empty_check check (
    length(trim(recipient_email)) > 0
  ),

  constraint email_notifications_notification_type_check check (
    notification_type in (
      'buyer_order_received',
      'buyer_order_fulfilled',
      'buyer_order_canceled',
      'seller_new_order_received'
    )
  ),

  constraint email_notifications_notification_status_check check (
    notification_status in (
      'pending',
      'processing',
      'sent',
      'failed'
    )
  ),

  constraint email_notifications_subject_snapshot_not_empty_check check (
    length(trim(subject_snapshot)) > 0
  ),

  constraint email_notifications_payload_object_check check (
    jsonb_typeof(payload) = 'object'
  ),

  constraint email_notifications_attempt_count_nonnegative_check check (
    attempt_count >= 0
  ),

  constraint email_notifications_last_error_not_empty_check check (
    last_error is null
    or length(trim(last_error)) > 0
  ),

  constraint email_notifications_sent_at_status_check check (
    notification_status <> 'sent'
    or sent_at is not null
  )
);

comment on table public.email_notifications is
'Provider-agnostic transactional email outbox and delivery history for order lifecycle notifications. Rows are intended to be enqueued by trusted order lifecycle code and processed asynchronously by a worker or Edge Function.';

comment on column public.email_notifications.store_id is
'Store associated with this transactional notification. Used for tenant access control and seller/admin review.';

comment on column public.email_notifications.order_id is
'Order associated with this transactional notification.';

comment on column public.email_notifications.dedupe_key is
'Stable unique key preventing duplicate enqueueing for the same notification type and order. Recommended format: {notification_type}:order:{order_id}.';

comment on column public.email_notifications.recipient_type is
'Recipient category for the notification: buyer or seller.';

comment on column public.email_notifications.recipient_email is
'Email address snapshot used for this notification attempt. Stored so later changes to buyer or seller contact details do not rewrite notification history.';

comment on column public.email_notifications.notification_type is
'Transactional notification type. V1 supports buyer order received, fulfilled, canceled, and seller new order received emails only.';

comment on column public.email_notifications.notification_status is
'Outbox delivery status. pending/processing are used by async workers; sent and failed preserve delivery history.';

comment on column public.email_notifications.subject_snapshot is
'Subject line snapshot selected by trusted application code when the notification is enqueued. Template rendering remains in application code.';

comment on column public.email_notifications.payload is
'Provider-agnostic JSON payload snapshot with order/store details needed by application email templates. Must be a JSON object.';

comment on column public.email_notifications.attempt_count is
'Number of delivery attempts made by the async email processor.';

comment on column public.email_notifications.next_attempt_at is
'Earliest time the async email processor should attempt or retry this notification.';

comment on column public.email_notifications.last_attempt_at is
'Timestamp of the most recent delivery attempt.';

comment on column public.email_notifications.sent_at is
'Timestamp when the notification was successfully sent. Present only when notification_status = sent.';

comment on column public.email_notifications.last_error is
'Most recent delivery error captured by the async email processor. Provider-specific error payloads should stay out of the schema.';


create index email_notifications_store_created_at_idx
on public.email_notifications(store_id, created_at desc);

create index email_notifications_order_created_at_idx
on public.email_notifications(order_id, created_at desc);

create index email_notifications_store_order_created_at_idx
on public.email_notifications(store_id, order_id, created_at desc);

create index email_notifications_status_next_attempt_idx
on public.email_notifications(notification_status, next_attempt_at, created_at)
where notification_status in ('pending', 'failed');

create index email_notifications_type_created_at_idx
on public.email_notifications(notification_type, created_at desc);


create trigger email_notifications_set_updated_at
before update on public.email_notifications
for each row
execute function public.set_updated_at();


alter table public.email_notifications enable row level security;


create policy "Store owners can read own email notifications"
on public.email_notifications
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Platform admins can insert email notifications"
on public.email_notifications
for insert
to authenticated
with check (
  public.is_admin()
);


create policy "Platform admins can update email notifications"
on public.email_notifications
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);


create policy "Platform admins can delete email notifications"
on public.email_notifications
for delete
to authenticated
using (
  public.is_admin()
);
