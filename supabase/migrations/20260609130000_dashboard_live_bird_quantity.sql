-- Keep the seller dashboard "Available birds" quantity limited to live birds.
-- Hatching eggs can remain visible in inventory, but they should not inflate
-- bird totals.

create or replace function public.get_seller_dashboard_home(
  p_store_id uuid
)
returns table (
  store_id uuid,
  store_name text,
  store_slug text,
  storefront_enabled boolean,
  store_status text,
  storefront_mode text,
  is_publicly_available boolean,
  unavailable_reason_code text,
  active_listing_count bigint,
  sold_out_listing_count bigint,
  total_active_inventory_quantity bigint,
  pending_open_order_count bigint,
  fulfilled_order_count bigint,
  canceled_order_count bigint,
  oldest_order_requiring_action_at timestamptz,
  pending_refund_count bigint,
  failed_refund_count bigint,
  failed_notification_count bigint,
  pending_notification_count bigint,
  upcoming_pickup_order_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with target_store as (
    select stores.*
    from public.stores
    where stores.id = p_store_id
      and (
        public.owns_store(stores.id)
        or public.is_admin()
      )
  ),
  inventory_availability as (
    select
      listing_batches.batch_type,
      inventory_items.inventory_type,
      inventory_items.quantity_available,
      case
        when listing_batches.visibility_status = 'sold_out'
          or inventory_items.quantity_available <= 0
          then 'sold_out'
        when listing_batches.available_date > current_date
          then 'coming_soon'
        when inventory_items.quantity_available <= 3
          then 'limited_availability'
        else 'available'
      end as availability_status
    from target_store
    join public.inventory_items
      on inventory_items.store_id = target_store.id
    join public.listing_batch_breeds
      on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
     and listing_batch_breeds.store_id = target_store.id
    join public.listing_batches
      on listing_batches.id = inventory_items.listing_batch_id
     and listing_batches.store_id = target_store.id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
     and seller_breed_profiles.store_id = target_store.id
    join public.species
      on species.id = listing_batches.species_id
    where species.is_active = true
      and seller_breed_profiles.visibility_status = 'active'
      and seller_breed_profiles.moderation_status = 'normal'
      and listing_batches.visibility_status in ('active', 'sold_out')
      and listing_batches.moderation_status = 'normal'
      and listing_batch_breeds.visibility_status = 'active'
      and listing_batch_breeds.moderation_status = 'normal'
      and inventory_items.visibility_status = 'active'
      and inventory_items.moderation_status = 'normal'
      and (
        (
          listing_batches.batch_type = 'hatching_eggs'
          and inventory_items.inventory_type = 'hatching_eggs'
        )
        or (
          listing_batches.batch_type = 'live_animals'
          and inventory_items.inventory_type <> 'hatching_eggs'
        )
      )
  ),
  inventory_summary as (
    select
      count(*) filter (
        where inventory_availability.availability_status <> 'sold_out'
      ) as active_listing_count,
      count(*) filter (
        where inventory_availability.availability_status = 'sold_out'
      ) as sold_out_listing_count,
      coalesce(
        sum(inventory_availability.quantity_available) filter (
          where inventory_availability.availability_status <> 'sold_out'
            and inventory_availability.batch_type = 'live_animals'
            and inventory_availability.inventory_type <> 'hatching_eggs'
        ),
        0
      )::bigint as total_active_inventory_quantity
    from inventory_availability
  ),
  order_summary as (
    select
      count(*) filter (
        where orders.order_status in ('pending', 'open')
      ) as pending_open_order_count,
      count(*) filter (
        where orders.order_status = 'fulfilled'
      ) as fulfilled_order_count,
      count(*) filter (
        where orders.order_status = 'canceled'
      ) as canceled_order_count,
      min(orders.created_at) filter (
        where orders.order_status in ('pending', 'open')
      ) as oldest_order_requiring_action_at,
      count(*) filter (
        where orders.ready_for_pickup_at is not null
          and orders.order_status in ('pending', 'open')
      ) as upcoming_pickup_order_count
    from target_store
    left join public.orders
      on orders.store_id = target_store.id
  ),
  refund_summary as (
    select
      count(*) filter (where order_refunds.refund_status = 'pending') as pending_refund_count,
      count(*) filter (where order_refunds.refund_status = 'failed') as failed_refund_count
    from target_store
    left join public.order_refunds
      on order_refunds.store_id = target_store.id
  ),
  notification_summary as (
    select
      count(*) filter (where email_notifications.notification_status = 'failed') as failed_notification_count,
      count(*) filter (where email_notifications.notification_status = 'pending') as pending_notification_count
    from target_store
    left join public.email_notifications
      on email_notifications.store_id = target_store.id
  )
  select
    target_store.id as store_id,
    target_store.store_name,
    target_store.store_slug,
    target_store.storefront_enabled,
    target_store.store_status,
    target_store.storefront_mode,
    (
      target_store.storefront_enabled = true
      and target_store.store_status = 'live'
      and target_store.storefront_mode in ('hosted', 'embedded')
      and target_store.admin_hold_reason is null
    ) as is_publicly_available,
    case
      when target_store.admin_hold_reason is not null then 'admin_hold'
      when target_store.storefront_enabled = false then 'storefront_disabled'
      when target_store.store_status <> 'live' then 'store_not_live'
      when target_store.storefront_mode not in ('hosted', 'embedded') then 'storefront_private'
      else 'available'
    end as unavailable_reason_code,
    coalesce(inventory_summary.active_listing_count, 0),
    coalesce(inventory_summary.sold_out_listing_count, 0),
    coalesce(inventory_summary.total_active_inventory_quantity, 0),
    coalesce(order_summary.pending_open_order_count, 0),
    coalesce(order_summary.fulfilled_order_count, 0),
    coalesce(order_summary.canceled_order_count, 0),
    order_summary.oldest_order_requiring_action_at,
    coalesce(refund_summary.pending_refund_count, 0),
    coalesce(refund_summary.failed_refund_count, 0),
    coalesce(notification_summary.failed_notification_count, 0),
    coalesce(notification_summary.pending_notification_count, 0),
    coalesce(order_summary.upcoming_pickup_order_count, 0)
  from target_store
  cross join inventory_summary
  cross join order_summary
  cross join refund_summary
  cross join notification_summary;
$$;

comment on function public.get_seller_dashboard_home(uuid) is
'Store-scoped seller dashboard summary. Filters to the requested store before aggregating inventory, order, refund, and notification data. The available inventory quantity is live-bird-only.';

revoke all on function public.get_seller_dashboard_home(uuid) from public;
grant execute on function public.get_seller_dashboard_home(uuid) to authenticated;
