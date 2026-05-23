-- Group 17: Seller Dashboard Operational Projection Layer
--
-- Scope:
-- - Adds private, computed seller dashboard views for operational visibility.
-- - Helps sellers answer whether their storefront is working, what needs
--   attention, and which orders are oldest.
--
-- This group does not add:
-- - dashboard tables
-- - materialized views
-- - stored dashboard metrics
-- - reporting or analytics features
-- - notification systems
-- - workflow engines or task tables
-- - revenue dashboards, charts, or KPI packages


create or replace view public.seller_dashboard_storefront_status
with (security_barrier = true)
as
select
  stores.id as store_id,
  stores.store_name,
  stores.store_slug,
  stores.storefront_enabled,
  stores.store_status,
  stores.storefront_mode,
  (
    stores.storefront_enabled = true
    and stores.store_status = 'live'
    and stores.storefront_mode in ('hosted', 'embedded')
    and stores.admin_hold_reason is null
  ) as is_publicly_available,
  case
    when stores.admin_hold_reason is not null then 'admin_hold'
    when stores.storefront_enabled = false then 'storefront_disabled'
    when stores.store_status <> 'live' then 'store_not_live'
    when stores.storefront_mode not in ('hosted', 'embedded') then 'storefront_private'
    else 'available'
  end as unavailable_reason_code
from public.stores
where public.owns_store(stores.id)
   or public.is_admin();


comment on view public.seller_dashboard_storefront_status is
'Seller-private dashboard projection for storefront publication and availability state. Computes a simple unavailable_reason_code without exposing raw admin hold details.';


create or replace view public.seller_dashboard_inventory_summary
with (security_barrier = true)
as
with inventory_availability as (
  select
    inventory_items.store_id,
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
  from public.inventory_items
  join public.listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
  join public.listing_batches
    on listing_batches.id = inventory_items.listing_batch_id
  join public.seller_breed_profiles
    on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
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
    inventory_availability.store_id,
    count(*) filter (
      where inventory_availability.availability_status <> 'sold_out'
    ) as active_listing_count,
    count(*) filter (
      where inventory_availability.availability_status = 'sold_out'
    ) as sold_out_listing_count,
    coalesce(
      sum(inventory_availability.quantity_available) filter (
        where inventory_availability.availability_status <> 'sold_out'
      ),
      0
    ) as total_active_inventory_quantity
  from inventory_availability
  group by inventory_availability.store_id
)
select
  stores.id as store_id,
  coalesce(inventory_summary.active_listing_count, 0) as active_listing_count,
  coalesce(inventory_summary.sold_out_listing_count, 0) as sold_out_listing_count,
  coalesce(inventory_summary.total_active_inventory_quantity, 0) as total_active_inventory_quantity
from public.stores
left join inventory_summary
  on inventory_summary.store_id = stores.id
where public.owns_store(stores.id)
   or public.is_admin();


comment on view public.seller_dashboard_inventory_summary is
'Seller-private dashboard projection for operational inventory counts. Uses the same inventory availability classification as the public storefront inventory projection, while remaining visible to sellers before storefront publication.';


create or replace view public.seller_dashboard_order_summary
with (security_barrier = true)
as
select
  stores.id as store_id,
  count(orders.id) filter (
    where orders.order_status in ('pending', 'open')
  ) as pending_open_order_count,
  count(orders.id) filter (
    where orders.order_status = 'fulfilled'
  ) as fulfilled_order_count,
  count(orders.id) filter (
    where orders.order_status = 'canceled'
  ) as canceled_order_count,
  min(orders.created_at) filter (
    where orders.order_status in ('pending', 'open')
  ) as oldest_order_requiring_action_at
from public.stores
left join public.orders
  on orders.store_id = stores.id
where public.owns_store(stores.id)
   or public.is_admin()
group by stores.id;


comment on view public.seller_dashboard_order_summary is
'Seller-private dashboard projection for operational order counts. Pending and open orders are treated as requiring seller attention for V1.';


create or replace view public.seller_dashboard_attention_orders
with (security_barrier = true)
as
select
  orders.store_id,
  orders.id as order_id,
  orders.order_number,
  orders.order_status,
  orders.payment_status,
  orders.buyer_first_name_snapshot,
  orders.buyer_last_name_snapshot,
  orders.buyer_email_snapshot,
  orders.buyer_phone_snapshot,
  orders.created_at,
  orders.total_amount,
  coalesce(order_item_counts.item_count, 0) as item_count
from public.orders
left join (
  select
    order_items.order_id,
    count(*) as item_count
  from public.order_items
  group by order_items.order_id
) as order_item_counts
  on order_item_counts.order_id = orders.id
where orders.order_status in ('pending', 'open')
  and (
    public.owns_store(orders.store_id)
    or public.is_admin()
  )
order by orders.created_at asc, orders.id asc;


comment on view public.seller_dashboard_attention_orders is
'Seller-private dashboard projection listing pending/open orders that need attention, oldest first. This is an operational queue, not a workflow/task system.';


revoke all on public.seller_dashboard_storefront_status from public;
revoke all on public.seller_dashboard_inventory_summary from public;
revoke all on public.seller_dashboard_order_summary from public;
revoke all on public.seller_dashboard_attention_orders from public;

grant select on public.seller_dashboard_storefront_status to authenticated;
grant select on public.seller_dashboard_inventory_summary to authenticated;
grant select on public.seller_dashboard_order_summary to authenticated;
grant select on public.seller_dashboard_attention_orders to authenticated;
