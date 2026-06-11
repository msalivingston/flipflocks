-- Lightweight platform admin dashboard read layer.
--
-- Scope:
-- - Adds narrow, admin-checked read RPCs for the first /admin UI slice.
-- - Reuses existing admin operational views where practical.
-- - Exposes owner email only through explicit platform-admin checks.
--
-- This migration does not add broad CRUD, impersonation, catalog/breed
-- management, catalog photo handling, or new direct table mutation grants.

begin;

create or replace function public.admin_platform_store_list()
returns table (
  store_id uuid,
  owner_user_id uuid,
  owner_email text,
  store_name text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  admin_hold_reason text,
  hatching_eggs_enabled boolean,
  equipment_supplies_enabled boolean,
  processed_poultry_enabled boolean,
  listing_batch_count bigint,
  inventory_item_count bigint,
  total_inventory_quantity bigint,
  customer_count bigint,
  equipment_item_count bigint,
  processed_poultry_item_count bigint,
  open_order_count bigint,
  canceled_order_count bigint,
  fulfilled_order_count bigint,
  pending_refund_count bigint,
  failed_notification_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized to view platform admin data.';
  end if;

  return query
  select
    admin_store_overview.store_id,
    admin_store_overview.owner_user_id,
    auth_users.email::text as owner_email,
    admin_store_overview.store_name,
    admin_store_overview.store_slug,
    admin_store_overview.store_status,
    admin_store_overview.storefront_mode,
    admin_store_overview.storefront_enabled,
    admin_store_overview.admin_hold_reason,
    stores.hatching_eggs_enabled,
    stores.equipment_supplies_enabled,
    stores.processed_poultry_enabled,
    coalesce(listing_counts.listing_batch_count, 0) as listing_batch_count,
    coalesce(inventory_counts.inventory_item_count, 0) as inventory_item_count,
    coalesce(inventory_counts.total_inventory_quantity, 0) as total_inventory_quantity,
    coalesce(customer_counts.customer_count, 0) as customer_count,
    coalesce(equipment_counts.equipment_item_count, 0) as equipment_item_count,
    coalesce(processed_counts.processed_poultry_item_count, 0) as processed_poultry_item_count,
    admin_store_overview.open_order_count,
    admin_store_overview.canceled_order_count,
    admin_store_overview.fulfilled_order_count,
    admin_store_overview.pending_refund_count,
    admin_store_overview.failed_notification_count,
    admin_store_overview.created_at,
    admin_store_overview.updated_at
  from public.admin_store_overview
  join public.stores
    on stores.id = admin_store_overview.store_id
  left join auth.users as auth_users
    on auth_users.id = admin_store_overview.owner_user_id
  left join lateral (
    select count(*) as listing_batch_count
    from public.listing_batches
    where listing_batches.store_id = admin_store_overview.store_id
  ) as listing_counts on true
  left join lateral (
    select
      count(*) as inventory_item_count,
      sum(greatest(coalesce(inventory_items.quantity_available, 0), 0)) as total_inventory_quantity
    from public.inventory_items
    where inventory_items.store_id = admin_store_overview.store_id
  ) as inventory_counts on true
  left join lateral (
    select count(*) as customer_count
    from public.customers
    where customers.store_id = admin_store_overview.store_id
  ) as customer_counts on true
  left join lateral (
    select count(*) as equipment_item_count
    from public.equipment_inventory_items
    where equipment_inventory_items.store_id = admin_store_overview.store_id
  ) as equipment_counts on true
  left join lateral (
    select count(*) as processed_poultry_item_count
    from public.processed_poultry_inventory_items
    where processed_poultry_inventory_items.store_id = admin_store_overview.store_id
  ) as processed_counts on true
  order by admin_store_overview.updated_at desc nulls last, admin_store_overview.created_at desc;
end;
$$;

create or replace function public.admin_platform_store_detail(
  p_store_id uuid
)
returns table (
  store_id uuid,
  owner_user_id uuid,
  owner_email text,
  store_name text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  admin_hold_reason text,
  admin_suspended_at timestamptz,
  admin_suspended_by_user_id uuid,
  admin_reactivated_at timestamptz,
  admin_reactivated_by_user_id uuid,
  admin_suspension_previous_store_status text,
  hatching_eggs_enabled boolean,
  equipment_supplies_enabled boolean,
  processed_poultry_enabled boolean,
  listing_batch_count bigint,
  inventory_item_count bigint,
  total_inventory_quantity bigint,
  customer_count bigint,
  equipment_item_count bigint,
  processed_poultry_item_count bigint,
  open_order_count bigint,
  canceled_order_count bigint,
  fulfilled_order_count bigint,
  pending_refund_count bigint,
  failed_notification_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized to view platform admin data.';
  end if;

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  return query
  select
    store_list.store_id,
    store_list.owner_user_id,
    store_list.owner_email,
    store_list.store_name,
    store_list.store_slug,
    store_list.store_status,
    store_list.storefront_mode,
    store_list.storefront_enabled,
    store_list.admin_hold_reason,
    admin_store_overview.admin_suspended_at,
    admin_store_overview.admin_suspended_by_user_id,
    admin_store_overview.admin_reactivated_at,
    admin_store_overview.admin_reactivated_by_user_id,
    admin_store_overview.admin_suspension_previous_store_status,
    store_list.hatching_eggs_enabled,
    store_list.equipment_supplies_enabled,
    store_list.processed_poultry_enabled,
    store_list.listing_batch_count,
    store_list.inventory_item_count,
    store_list.total_inventory_quantity,
    store_list.customer_count,
    store_list.equipment_item_count,
    store_list.processed_poultry_item_count,
    store_list.open_order_count,
    store_list.canceled_order_count,
    store_list.fulfilled_order_count,
    store_list.pending_refund_count,
    store_list.failed_notification_count,
    store_list.created_at,
    store_list.updated_at
  from public.admin_platform_store_list() as store_list
  join public.admin_store_overview
    on admin_store_overview.store_id = store_list.store_id
  where store_list.store_id = p_store_id;
end;
$$;

create or replace function public.admin_platform_store_recent_activity(
  p_store_id uuid,
  p_limit integer default 10
)
returns table (
  admin_activity_event_id uuid,
  actor_user_id uuid,
  action_type text,
  target_store_id uuid,
  target_order_id uuid,
  target_refund_id uuid,
  target_notification_id uuid,
  reason text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to view platform admin data.';
  end if;

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 10), 1), 25);

  return query
  select
    admin_activity_events.id as admin_activity_event_id,
    admin_activity_events.actor_user_id,
    admin_activity_events.action_type,
    admin_activity_events.target_store_id,
    admin_activity_events.target_order_id,
    admin_activity_events.target_refund_id,
    admin_activity_events.target_notification_id,
    admin_activity_events.reason,
    admin_activity_events.metadata,
    admin_activity_events.created_at
  from public.admin_activity_events
  where admin_activity_events.target_store_id = p_store_id
  order by admin_activity_events.created_at desc
  limit v_limit;
end;
$$;

create or replace function public.admin_platform_store_recent_orders(
  p_store_id uuid,
  p_limit integer default 10
)
returns table (
  order_id uuid,
  order_number text,
  order_status text,
  payment_method text,
  payment_status text,
  total_amount numeric,
  item_count bigint,
  refund_count bigint,
  buyer_email_snapshot text,
  buyer_phone_snapshot text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to view platform admin data.';
  end if;

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 10), 1), 25);

  return query
  select
    admin_order_overview.order_id,
    admin_order_overview.order_number,
    admin_order_overview.order_status,
    admin_order_overview.payment_method,
    admin_order_overview.payment_status,
    admin_order_overview.total_amount,
    admin_order_overview.item_count,
    admin_order_overview.refund_count,
    admin_order_overview.buyer_email_snapshot,
    admin_order_overview.buyer_phone_snapshot,
    admin_order_overview.created_at,
    admin_order_overview.updated_at
  from public.admin_order_overview
  where admin_order_overview.store_id = p_store_id
  order by admin_order_overview.created_at desc
  limit v_limit;
end;
$$;

comment on function public.admin_platform_store_list() is
'Platform-admin-only read projection for the lightweight internal /admin stores list. Includes owner email through an explicit admin check and bounded support counts.';

comment on function public.admin_platform_store_detail(uuid) is
'Platform-admin-only read projection for one store in the lightweight internal /admin store detail view.';

comment on function public.admin_platform_store_recent_activity(uuid, integer) is
'Platform-admin-only bounded recent admin activity feed for one store.';

comment on function public.admin_platform_store_recent_orders(uuid, integer) is
'Platform-admin-only bounded support-safe recent order summary for one store.';

revoke all on function public.admin_platform_store_list() from public;
revoke all on function public.admin_platform_store_detail(uuid) from public;
revoke all on function public.admin_platform_store_recent_activity(uuid, integer) from public;
revoke all on function public.admin_platform_store_recent_orders(uuid, integer) from public;

grant execute on function public.admin_platform_store_list() to authenticated;
grant execute on function public.admin_platform_store_detail(uuid) to authenticated;
grant execute on function public.admin_platform_store_recent_activity(uuid, integer) to authenticated;
grant execute on function public.admin_platform_store_recent_orders(uuid, integer) to authenticated;

commit;
