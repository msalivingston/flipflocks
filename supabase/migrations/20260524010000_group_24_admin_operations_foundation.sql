-- Group 24: Admin Operations Foundation
--
-- Scope:
-- - Adds a lightweight platform admin activity log.
-- - Adds explicit store suspension metadata around existing store_status and
--   admin_hold_reason fields.
-- - Adds admin-only operational projection views for support and recovery.
-- - Adds audited admin RPCs for store suspension/reactivation and notification
--   retry/suppression.
--
-- This group does not add:
-- - moderation queues
-- - seller scoring or reputation systems
-- - customer support ticketing
-- - messaging
-- - accounting exports
-- - analytics warehouse


alter table public.stores
add column admin_suspended_at timestamptz,
add column admin_suspended_by_user_id uuid references auth.users(id),
add column admin_reactivated_at timestamptz,
add column admin_reactivated_by_user_id uuid references auth.users(id),
add column admin_suspension_previous_store_status text;

alter table public.stores
add constraint stores_admin_suspension_previous_status_check check (
  admin_suspension_previous_store_status is null
  or admin_suspension_previous_store_status in (
    'draft',
    'live',
    'paused',
    'dormant',
    'suspended',
    'canceled'
  )
);

comment on column public.stores.admin_suspended_at is
'Timestamp when a platform admin most recently suspended this store.';

comment on column public.stores.admin_suspended_by_user_id is
'Platform admin user who most recently suspended this store.';

comment on column public.stores.admin_reactivated_at is
'Timestamp when a platform admin most recently reactivated this store after suspension.';

comment on column public.stores.admin_reactivated_by_user_id is
'Platform admin user who most recently reactivated this store after suspension.';

comment on column public.stores.admin_suspension_previous_store_status is
'Store status captured before the latest admin suspension. Used for operational context only; reactivation intentionally defaults to paused unless an admin chooses another safe status.';

create index if not exists stores_admin_suspended_at_idx
on public.stores(admin_suspended_at desc)
where admin_suspended_at is not null;


create table public.admin_activity_events (
  id uuid primary key default gen_random_uuid(),

  actor_user_id uuid references auth.users(id),

  action_type text not null,

  target_store_id uuid references public.stores(id) on delete set null,
  target_order_id uuid references public.orders(id) on delete set null,
  target_refund_id uuid references public.order_refunds(id) on delete set null,
  target_notification_id uuid references public.email_notifications(id) on delete set null,

  reason text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint admin_activity_events_action_type_check check (
    action_type in (
      'store_suspended',
      'store_reactivated',
      'notification_retried',
      'notification_suppressed'
    )
  ),

  constraint admin_activity_events_reason_not_empty_check check (
    reason is null
    or length(trim(reason)) > 0
  ),

  constraint admin_activity_events_metadata_object_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

comment on table public.admin_activity_events is
'Append-only platform admin activity log for operational support, troubleshooting, recovery actions, and store controls. This is not a moderation workflow or support ticket system.';

comment on column public.admin_activity_events.actor_user_id is
'Platform admin user who performed the action when available.';

comment on column public.admin_activity_events.action_type is
'Simple action type for operational admin actions.';

comment on column public.admin_activity_events.target_store_id is
'Store affected by the admin action when applicable.';

comment on column public.admin_activity_events.target_order_id is
'Order affected by the admin action when applicable.';

comment on column public.admin_activity_events.target_refund_id is
'Refund affected by the admin action when applicable.';

comment on column public.admin_activity_events.target_notification_id is
'Notification affected by the admin action when applicable.';

comment on column public.admin_activity_events.metadata is
'Small JSON object for action-specific operational context. Keep practical; not intended for analytics or workflow state.';

create index admin_activity_events_created_at_idx
on public.admin_activity_events(created_at desc);

create index admin_activity_events_store_created_at_idx
on public.admin_activity_events(target_store_id, created_at desc)
where target_store_id is not null;

create index admin_activity_events_notification_created_at_idx
on public.admin_activity_events(target_notification_id, created_at desc)
where target_notification_id is not null;

alter table public.admin_activity_events enable row level security;

create policy "Platform admins can read admin activity events"
on public.admin_activity_events
for select
to authenticated
using (
  public.is_admin()
);

revoke all on public.admin_activity_events from public;
grant select on public.admin_activity_events to authenticated;


create or replace view public.admin_store_overview
with (security_barrier = true)
as
select
  stores.id as store_id,
  stores.owner_user_id,
  stores.store_name,
  stores.store_slug,
  stores.store_status,
  stores.storefront_mode,
  stores.storefront_enabled,
  stores.admin_hold_reason,
  stores.admin_suspended_at,
  stores.admin_suspended_by_user_id,
  stores.admin_reactivated_at,
  stores.admin_reactivated_by_user_id,
  stores.admin_suspension_previous_store_status,
  stores.created_at,
  stores.updated_at,
  coalesce(order_counts.open_order_count, 0) as open_order_count,
  coalesce(order_counts.canceled_order_count, 0) as canceled_order_count,
  coalesce(order_counts.fulfilled_order_count, 0) as fulfilled_order_count,
  coalesce(refund_counts.pending_refund_count, 0) as pending_refund_count,
  coalesce(notification_counts.failed_notification_count, 0) as failed_notification_count
from public.stores
left join lateral (
  select
    count(*) filter (where orders.order_status in ('pending', 'open')) as open_order_count,
    count(*) filter (where orders.order_status = 'canceled') as canceled_order_count,
    count(*) filter (where orders.order_status = 'fulfilled') as fulfilled_order_count
  from public.orders
  where orders.store_id = stores.id
) as order_counts on true
left join lateral (
  select
    count(*) filter (where order_refunds.refund_status = 'pending') as pending_refund_count
  from public.order_refunds
  where order_refunds.store_id = stores.id
) as refund_counts on true
left join lateral (
  select
    count(*) filter (where email_notifications.notification_status = 'failed') as failed_notification_count
  from public.email_notifications
  where email_notifications.store_id = stores.id
) as notification_counts on true
where public.is_admin();

comment on view public.admin_store_overview is
'Admin-only operational overview of stores, suspension state, and high-level support counts. Not for public or seller dashboard use.';


create or replace view public.admin_seller_accounts
with (security_barrier = true)
as
select
  user_roles.id as user_role_id,
  user_roles.user_id,
  user_roles.role,
  user_roles.store_id,
  stores.store_name,
  stores.store_slug,
  stores.store_status,
  stores.created_at as store_created_at,
  user_roles.created_at as role_created_at
from public.user_roles
left join public.stores
  on stores.id = user_roles.store_id
where public.is_admin();

comment on view public.admin_seller_accounts is
'Admin-only view of platform role assignments and associated stores. Auth user email/profile data is intentionally not duplicated here.';


create or replace view public.admin_order_overview
with (security_barrier = true)
as
select
  orders.id as order_id,
  orders.store_id,
  stores.store_name,
  stores.store_slug,
  orders.customer_id,
  orders.order_number,
  orders.order_source,
  orders.order_status,
  orders.payment_method,
  orders.payment_status,
  orders.ready_for_pickup_at,
  orders.fulfilled_at,
  orders.canceled_at,
  orders.created_at,
  orders.updated_at,
  orders.total_amount,
  orders.buyer_first_name_snapshot,
  orders.buyer_last_name_snapshot,
  orders.buyer_email_snapshot,
  orders.buyer_phone_snapshot,
  coalesce(item_counts.item_count, 0) as item_count,
  coalesce(refund_counts.refund_count, 0) as refund_count,
  coalesce(refund_counts.succeeded_refund_amount, 0)::numeric(10, 2) as succeeded_refund_amount,
  coalesce(refund_counts.pending_refund_amount, 0)::numeric(10, 2) as pending_refund_amount
from public.orders
join public.stores
  on stores.id = orders.store_id
left join lateral (
  select count(*) as item_count
  from public.order_items
  where order_items.order_id = orders.id
) as item_counts on true
left join lateral (
  select
    count(*) as refund_count,
    sum(order_refunds.refund_amount) filter (where order_refunds.refund_status = 'succeeded') as succeeded_refund_amount,
    sum(order_refunds.refund_amount) filter (where order_refunds.refund_status = 'pending') as pending_refund_amount
  from public.order_refunds
  where order_refunds.order_id = orders.id
) as refund_counts on true
where public.is_admin();

comment on view public.admin_order_overview is
'Admin-only operational order overview across stores, including limited buyer contact snapshots needed for support troubleshooting.';


create or replace view public.admin_refund_overview
with (security_barrier = true)
as
select
  order_refunds.id as refund_id,
  order_refunds.store_id,
  stores.store_name,
  stores.store_slug,
  order_refunds.order_id,
  orders.order_number,
  orders.payment_status as order_payment_status,
  order_refunds.refund_amount,
  order_refunds.refund_method,
  order_refunds.refund_status,
  order_refunds.provider_refund_id,
  order_refunds.provider_status,
  order_refunds.reason,
  order_refunds.created_by_user_id,
  order_refunds.processed_at,
  order_refunds.created_at,
  order_refunds.updated_at
from public.order_refunds
join public.orders
  on orders.id = order_refunds.order_id
join public.stores
  on stores.id = order_refunds.store_id
where public.is_admin();

comment on view public.admin_refund_overview is
'Admin-only refund overview across stores for operational troubleshooting. This is not an accounting export.';


create or replace view public.admin_notification_failures
with (security_barrier = true)
as
select
  email_notifications.id as notification_id,
  email_notifications.store_id,
  stores.store_name,
  stores.store_slug,
  email_notifications.order_id,
  orders.order_number,
  email_notifications.recipient_type,
  email_notifications.recipient_email,
  email_notifications.notification_type,
  email_notifications.notification_status,
  email_notifications.attempt_count,
  email_notifications.next_attempt_at,
  email_notifications.last_attempt_at,
  email_notifications.processing_started_at,
  email_notifications.last_error,
  email_notifications.created_at,
  email_notifications.updated_at
from public.email_notifications
join public.stores
  on stores.id = email_notifications.store_id
join public.orders
  on orders.id = email_notifications.order_id
where public.is_admin()
  and email_notifications.notification_status = 'failed';

comment on view public.admin_notification_failures is
'Admin-only view of failed transactional email notifications for operational recovery.';


create or replace view public.admin_inventory_activity_overview
with (security_barrier = true)
as
select
  inventory_activity_events.id as activity_event_id,
  inventory_activity_events.store_id,
  stores.store_name,
  stores.store_slug,
  inventory_activity_events.listing_batch_id,
  inventory_activity_events.listing_batch_breed_id,
  inventory_activity_events.inventory_item_id,
  inventory_activity_events.actor_user_id,
  inventory_activity_events.actor_type,
  inventory_activity_events.event_type,
  inventory_activity_events.from_quantity_available,
  inventory_activity_events.to_quantity_available,
  inventory_activity_events.from_visibility_status,
  inventory_activity_events.to_visibility_status,
  inventory_activity_events.note,
  inventory_activity_events.metadata,
  inventory_activity_events.created_at
from public.inventory_activity_events
join public.stores
  on stores.id = inventory_activity_events.store_id
where public.is_admin();

comment on view public.admin_inventory_activity_overview is
'Admin-only inventory activity history across stores for troubleshooting quantity and visibility changes.';


create or replace view public.admin_order_activity_overview
with (security_barrier = true)
as
select
  order_events.id as order_event_id,
  order_events.store_id,
  stores.store_name,
  stores.store_slug,
  order_events.order_id,
  orders.order_number,
  order_events.actor_user_id,
  order_events.actor_type,
  order_events.event_type,
  order_events.from_order_status,
  order_events.to_order_status,
  order_events.from_payment_status,
  order_events.to_payment_status,
  order_events.note,
  order_events.metadata,
  order_events.created_at
from public.order_events
join public.stores
  on stores.id = order_events.store_id
join public.orders
  on orders.id = order_events.order_id
where public.is_admin();

comment on view public.admin_order_activity_overview is
'Admin-only order lifecycle activity across stores for operational support and recovery.';


create or replace function public.admin_suspend_store(
  p_store_id uuid,
  p_reason text
)
returns public.stores
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_reason text;
  v_previous_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;

  v_reason := nullif(trim(p_reason), '');

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if v_reason is null then
    raise exception 'Suspension reason is required.';
  end if;

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id
  for update;

  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  v_previous_status := case
    when v_store.store_status = 'suspended'
      then v_store.admin_suspension_previous_store_status
    else v_store.store_status
  end;

  update public.stores
  set
    store_status = 'suspended',
    storefront_enabled = false,
    admin_hold_reason = v_reason,
    admin_suspended_at = now(),
    admin_suspended_by_user_id = auth.uid(),
    admin_reactivated_at = null,
    admin_reactivated_by_user_id = null,
    admin_suspension_previous_store_status = v_previous_status
  where stores.id = v_store.id
  returning * into v_store;

  insert into public.admin_activity_events (
    actor_user_id,
    action_type,
    target_store_id,
    reason,
    metadata
  )
  values (
    auth.uid(),
    'store_suspended',
    v_store.id,
    v_reason,
    jsonb_build_object(
      'previous_store_status', v_previous_status,
      'storefront_enabled_after', v_store.storefront_enabled
    )
  );

  return v_store;
end;
$$;


create or replace function public.admin_reactivate_store(
  p_store_id uuid,
  p_store_status text default 'paused',
  p_reason text default null
)
returns public.stores
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_store_status text;
  v_reason text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  v_store_status := coalesce(nullif(trim(p_store_status), ''), 'paused');
  v_reason := nullif(trim(p_reason), '');

  if v_store_status not in ('draft', 'live', 'paused', 'dormant') then
    raise exception 'Reactivation store status is not supported.';
  end if;

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id
  for update;

  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  if v_store.store_status <> 'suspended' then
    raise exception 'Only suspended stores can be reactivated.';
  end if;

  update public.stores
  set
    store_status = v_store_status,
    storefront_enabled = false,
    admin_hold_reason = null,
    admin_reactivated_at = now(),
    admin_reactivated_by_user_id = auth.uid()
  where stores.id = v_store.id
  returning * into v_store;

  insert into public.admin_activity_events (
    actor_user_id,
    action_type,
    target_store_id,
    reason,
    metadata
  )
  values (
    auth.uid(),
    'store_reactivated',
    v_store.id,
    v_reason,
    jsonb_build_object(
      'reactivated_store_status', v_store.store_status,
      'storefront_enabled_after', v_store.storefront_enabled
    )
  );

  return v_store;
end;
$$;


create or replace function public.admin_retry_email_notification(
  p_notification_id uuid,
  p_next_attempt_at timestamptz default now(),
  p_reset_attempt_count boolean default false,
  p_reason text default null
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
  if not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;

  v_reason := nullif(trim(p_reason), '');

  v_notification := public.retry_email_notification(
    p_notification_id,
    p_next_attempt_at,
    p_reset_attempt_count
  );

  insert into public.admin_activity_events (
    actor_user_id,
    action_type,
    target_store_id,
    target_order_id,
    target_notification_id,
    reason,
    metadata
  )
  values (
    auth.uid(),
    'notification_retried',
    v_notification.store_id,
    v_notification.order_id,
    v_notification.id,
    v_reason,
    jsonb_build_object(
      'notification_status', v_notification.notification_status,
      'next_attempt_at', v_notification.next_attempt_at,
      'attempt_count', v_notification.attempt_count,
      'reset_attempt_count', coalesce(p_reset_attempt_count, false)
    )
  );

  return v_notification;
end;
$$;


create or replace function public.admin_suppress_email_notification(
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
  if not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;

  v_reason := nullif(trim(p_reason), '');

  if v_reason is null then
    raise exception 'Suppression reason is required.';
  end if;

  v_notification := public.suppress_email_notification(
    p_notification_id,
    v_reason,
    p_max_attempts
  );

  insert into public.admin_activity_events (
    actor_user_id,
    action_type,
    target_store_id,
    target_order_id,
    target_notification_id,
    reason,
    metadata
  )
  values (
    auth.uid(),
    'notification_suppressed',
    v_notification.store_id,
    v_notification.order_id,
    v_notification.id,
    v_reason,
    jsonb_build_object(
      'notification_status', v_notification.notification_status,
      'next_attempt_at', v_notification.next_attempt_at,
      'attempt_count', v_notification.attempt_count,
      'last_error', v_notification.last_error
    )
  );

  return v_notification;
end;
$$;


comment on function public.admin_suspend_store(uuid, text) is
'Platform-admin RPC to suspend a store, disable its public storefront, set admin_hold_reason, and record an admin activity event.';

comment on function public.admin_reactivate_store(uuid, text, text) is
'Platform-admin RPC to reactivate a suspended store to a safe non-public default status unless another supported status is provided, and record an admin activity event.';

comment on function public.admin_retry_email_notification(uuid, timestamptz, boolean, text) is
'Platform-admin RPC wrapper around notification retry that records an admin activity event.';

comment on function public.admin_suppress_email_notification(uuid, text, integer) is
'Platform-admin RPC wrapper around notification suppression that records an admin activity event.';


revoke all on public.admin_store_overview from public;
revoke all on public.admin_seller_accounts from public;
revoke all on public.admin_order_overview from public;
revoke all on public.admin_refund_overview from public;
revoke all on public.admin_notification_failures from public;
revoke all on public.admin_inventory_activity_overview from public;
revoke all on public.admin_order_activity_overview from public;

grant select on public.admin_store_overview to authenticated;
grant select on public.admin_seller_accounts to authenticated;
grant select on public.admin_order_overview to authenticated;
grant select on public.admin_refund_overview to authenticated;
grant select on public.admin_notification_failures to authenticated;
grant select on public.admin_inventory_activity_overview to authenticated;
grant select on public.admin_order_activity_overview to authenticated;

revoke all on function public.admin_suspend_store(uuid, text) from public;
revoke all on function public.admin_reactivate_store(uuid, text, text) from public;
revoke all on function public.admin_retry_email_notification(uuid, timestamptz, boolean, text) from public;
revoke all on function public.admin_suppress_email_notification(uuid, text, integer) from public;

grant execute on function public.admin_suspend_store(uuid, text) to authenticated;
grant execute on function public.admin_reactivate_store(uuid, text, text) to authenticated;
grant execute on function public.admin_retry_email_notification(uuid, timestamptz, boolean, text) to authenticated;
grant execute on function public.admin_suppress_email_notification(uuid, text, integer) to authenticated;
