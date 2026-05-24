-- Group 27: Seller Dashboard API Support Layer
--
-- Scope:
-- - Adds seller-private read projections for common dashboard screens.
-- - Keeps existing trusted RPCs as the source of truth for mutations.
-- - Avoids exposing provider IDs, admin audit data, or cross-store records.
--
-- This group does not add:
-- - new business workflows
-- - dashboard tables or stored metrics
-- - marketplace features
-- - buyer-facing storefront APIs
-- - payment/refund rule changes


create index if not exists orders_store_status_created_at_idx
on public.orders(store_id, order_status, created_at desc);

create index if not exists order_items_store_order_id_idx
on public.order_items(store_id, order_id);

create index if not exists email_notifications_store_status_created_at_idx
on public.email_notifications(store_id, notification_status, created_at desc);


create or replace view public.seller_dashboard_home
with (security_barrier = true)
as
with refund_summary as (
  select
    order_refunds.store_id,
    count(*) filter (where order_refunds.refund_status = 'pending') as pending_refund_count,
    count(*) filter (where order_refunds.refund_status = 'failed') as failed_refund_count
  from public.order_refunds
  group by order_refunds.store_id
),
notification_summary as (
  select
    email_notifications.store_id,
    count(*) filter (where email_notifications.notification_status = 'failed') as failed_notification_count,
    count(*) filter (where email_notifications.notification_status = 'pending') as pending_notification_count
  from public.email_notifications
  group by email_notifications.store_id
)
select
  stores.id as store_id,
  stores.store_name,
  stores.store_slug,
  storefront_status.storefront_enabled,
  storefront_status.store_status,
  storefront_status.storefront_mode,
  storefront_status.is_publicly_available,
  storefront_status.unavailable_reason_code,
  inventory_summary.active_listing_count,
  inventory_summary.sold_out_listing_count,
  inventory_summary.total_active_inventory_quantity,
  order_summary.pending_open_order_count,
  order_summary.fulfilled_order_count,
  order_summary.canceled_order_count,
  order_summary.oldest_order_requiring_action_at,
  coalesce(refund_summary.pending_refund_count, 0) as pending_refund_count,
  coalesce(refund_summary.failed_refund_count, 0) as failed_refund_count,
  coalesce(notification_summary.failed_notification_count, 0) as failed_notification_count,
  coalesce(notification_summary.pending_notification_count, 0) as pending_notification_count
from public.stores
left join public.seller_dashboard_storefront_status as storefront_status
  on storefront_status.store_id = stores.id
left join public.seller_dashboard_inventory_summary as inventory_summary
  on inventory_summary.store_id = stores.id
left join public.seller_dashboard_order_summary as order_summary
  on order_summary.store_id = stores.id
left join refund_summary
  on refund_summary.store_id = stores.id
left join notification_summary
  on notification_summary.store_id = stores.id
where public.owns_store(stores.id)
   or public.is_admin();

comment on view public.seller_dashboard_home is
'Seller-private dashboard home projection combining existing operational summaries with refund and notification counts. This is read-only UI support, not stored analytics.';


create or replace view public.seller_inventory_management
with (security_barrier = true)
as
select
  inventory_items.store_id,
  listing_batches.id as listing_batch_id,
  listing_batch_breeds.id as listing_batch_breed_id,
  inventory_items.id as inventory_item_id,
  species.id as species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  seller_breed_profiles.id as seller_breed_profile_id,
  seller_breed_profiles.display_name as breed_display_name,
  listing_batches.batch_type,
  listing_batches.origin_date,
  listing_batches.available_date,
  listing_batches.age_at_availability_days,
  listing_batches.base_price,
  listing_batches.auto_price_increase_enabled,
  listing_batches.auto_price_increase_amount,
  listing_batches.auto_price_increase_max_price,
  listing_batches.internal_batch_label,
  listing_batches.visibility_status as listing_batch_visibility_status,
  listing_batches.moderation_status as listing_batch_moderation_status,
  listing_batch_breeds.sort_order as listing_batch_breed_sort_order,
  listing_batch_breeds.visibility_status as listing_batch_breed_visibility_status,
  listing_batch_breeds.moderation_status as listing_batch_breed_moderation_status,
  inventory_items.inventory_type,
  inventory_items.custom_inventory_label,
  inventory_items.quantity_available,
  inventory_items.price_override,
  public.calculate_inventory_unit_price(
    listing_batches.base_price,
    inventory_items.price_override,
    listing_batches.auto_price_increase_enabled,
    listing_batches.auto_price_increase_amount,
    listing_batches.auto_price_increase_max_price,
    listing_batches.available_date
  ) as effective_unit_price,
  inventory_items.sort_order as inventory_item_sort_order,
  inventory_items.visibility_status as inventory_visibility_status,
  inventory_items.moderation_status as inventory_moderation_status,
  case
    when listing_batches.visibility_status = 'archived'
      or listing_batch_breeds.visibility_status = 'archived'
      or inventory_items.visibility_status = 'archived'
      then 'archived'
    when listing_batches.moderation_status <> 'normal'
      or listing_batch_breeds.moderation_status <> 'normal'
      or inventory_items.moderation_status <> 'normal'
      or seller_breed_profiles.moderation_status <> 'normal'
      then 'unavailable'
    when listing_batches.visibility_status = 'sold_out'
      or inventory_items.quantity_available <= 0
      then 'sold_out'
    when listing_batches.visibility_status <> 'active'
      or listing_batch_breeds.visibility_status <> 'active'
      or inventory_items.visibility_status <> 'active'
      or seller_breed_profiles.visibility_status <> 'active'
      then 'hidden'
    when listing_batches.available_date > current_date
      then 'reserve_now'
    else 'ready_now'
  end as operational_availability_status,
  inventory_items.seller_notes as inventory_seller_notes,
  listing_batch_breeds.seller_notes as listing_batch_breed_seller_notes,
  listing_batches.seller_notes as listing_batch_seller_notes,
  inventory_items.updated_at as inventory_updated_at,
  listing_batches.updated_at as listing_batch_updated_at
from public.inventory_items
join public.listing_batches
  on listing_batches.id = inventory_items.listing_batch_id
 and listing_batches.store_id = inventory_items.store_id
join public.listing_batch_breeds
  on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
 and listing_batch_breeds.store_id = inventory_items.store_id
join public.seller_breed_profiles
  on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
 and seller_breed_profiles.store_id = inventory_items.store_id
join public.species
  on species.id = listing_batches.species_id
where (
    public.owns_store(inventory_items.store_id)
    or public.is_admin()
  );

comment on view public.seller_inventory_management is
'Seller-private inventory/listing management projection for dashboard screens. It exposes seller-operational fields without adding new inventory business logic.';


create or replace view public.seller_order_management
with (security_barrier = true)
as
with item_summary as (
  select
    order_items.store_id,
    order_items.order_id,
    count(*) as item_count,
    coalesce(sum(order_items.quantity), 0) as total_item_quantity,
    coalesce(sum(order_items.fulfilled_quantity), 0) as fulfilled_item_quantity,
    coalesce(sum(order_items.restored_quantity), 0) as restored_item_quantity
  from public.order_items
  group by order_items.store_id, order_items.order_id
),
refund_summary as (
  select
    order_refunds.store_id,
    order_refunds.order_id,
    count(*) as refund_count,
    coalesce(sum(order_refunds.refund_amount) filter (
      where order_refunds.refund_status in ('pending', 'succeeded')
    ), 0)::numeric(10, 2) as reserved_refund_amount,
    coalesce(sum(order_refunds.refund_amount) filter (
      where order_refunds.refund_status = 'succeeded'
    ), 0)::numeric(10, 2) as succeeded_refund_amount,
    max(order_refunds.created_at) as latest_refund_created_at
  from public.order_refunds
  group by order_refunds.store_id, order_refunds.order_id
),
notification_summary as (
  select
    email_notifications.store_id,
    email_notifications.order_id,
    count(*) filter (where email_notifications.notification_status = 'failed') as failed_notification_count,
    count(*) filter (where email_notifications.notification_status = 'pending') as pending_notification_count,
    max(email_notifications.updated_at) as latest_notification_updated_at
  from public.email_notifications
  group by email_notifications.store_id, email_notifications.order_id
)
select
  orders.store_id,
  orders.id as order_id,
  orders.order_number,
  orders.order_source,
  orders.order_status,
  orders.payment_method,
  orders.payment_status,
  orders.payment_provider,
  orders.provider_payment_status,
  orders.ready_for_pickup_at,
  orders.paid_at,
  orders.fulfilled_at,
  orders.canceled_at,
  orders.created_at,
  orders.updated_at,
  orders.customer_id,
  orders.buyer_first_name_snapshot,
  orders.buyer_last_name_snapshot,
  orders.buyer_email_snapshot,
  orders.buyer_phone_snapshot,
  orders.buyer_address_line1_snapshot,
  orders.buyer_address_line2_snapshot,
  orders.buyer_city_snapshot,
  orders.buyer_state_snapshot,
  orders.buyer_postal_code_snapshot,
  orders.buyer_country_snapshot,
  orders.pickup_note,
  orders.buyer_notes,
  orders.subtotal_amount,
  orders.tax_fee_label_snapshot,
  orders.tax_fee_amount,
  orders.total_amount,
  coalesce(item_summary.item_count, 0) as item_count,
  coalesce(item_summary.total_item_quantity, 0) as total_item_quantity,
  coalesce(item_summary.fulfilled_item_quantity, 0) as fulfilled_item_quantity,
  coalesce(item_summary.restored_item_quantity, 0) as restored_item_quantity,
  coalesce(refund_summary.refund_count, 0) as refund_count,
  coalesce(refund_summary.reserved_refund_amount, 0)::numeric(10, 2) as reserved_refund_amount,
  coalesce(refund_summary.succeeded_refund_amount, 0)::numeric(10, 2) as succeeded_refund_amount,
  greatest(
    orders.total_amount - coalesce(refund_summary.reserved_refund_amount, 0),
    0
  )::numeric(10, 2) as refundable_amount_remaining,
  refund_summary.latest_refund_created_at,
  coalesce(notification_summary.failed_notification_count, 0) as failed_notification_count,
  coalesce(notification_summary.pending_notification_count, 0) as pending_notification_count,
  notification_summary.latest_notification_updated_at
from public.orders
left join item_summary
  on item_summary.store_id = orders.store_id
 and item_summary.order_id = orders.id
left join refund_summary
  on refund_summary.store_id = orders.store_id
 and refund_summary.order_id = orders.id
left join notification_summary
  on notification_summary.store_id = orders.store_id
 and notification_summary.order_id = orders.id
where public.owns_store(orders.store_id)
   or public.is_admin();

comment on view public.seller_order_management is
'Seller-private order management projection with fulfillment, refund, notification, and contact snapshots needed for dashboard order lists. Provider identifiers are intentionally omitted.';


create or replace view public.seller_order_item_detail
with (security_barrier = true)
as
select
  order_items.store_id,
  order_items.order_id,
  order_items.id as order_item_id,
  orders.order_number,
  order_items.inventory_item_id,
  order_items.listing_batch_id,
  order_items.listing_batch_breed_id,
  order_items.seller_breed_profile_id,
  order_items.species_id,
  order_items.species_name_snapshot,
  order_items.species_slug_snapshot,
  order_items.breed_display_name_snapshot,
  order_items.breed_description_snapshot,
  order_items.inventory_type_snapshot,
  order_items.custom_inventory_label_snapshot,
  order_items.batch_type_snapshot,
  order_items.available_date_snapshot,
  order_items.age_at_availability_days_snapshot,
  order_items.unit_price_snapshot,
  order_items.quantity,
  order_items.fulfilled_quantity,
  order_items.restored_quantity,
  greatest(
    order_items.quantity - order_items.fulfilled_quantity - order_items.restored_quantity,
    0
  ) as remaining_unfulfilled_quantity,
  order_items.line_subtotal,
  order_items.created_at
from public.order_items
join public.orders
  on orders.id = order_items.order_id
 and orders.store_id = order_items.store_id
where public.owns_store(order_items.store_id)
   or public.is_admin();

comment on view public.seller_order_item_detail is
'Seller-private order line detail projection for order detail and fulfillment screens.';


create or replace view public.seller_customer_summary
with (security_barrier = true)
as
with customer_order_summary as (
  select
    orders.store_id,
    orders.customer_id,
    count(*) as order_count,
    max(orders.created_at) as latest_order_created_at,
    count(*) filter (where orders.order_status in ('pending', 'open')) as open_order_count,
    coalesce(sum(orders.total_amount), 0)::numeric(10, 2) as lifetime_order_total
  from public.orders
  group by orders.store_id, orders.customer_id
)
select
  customers.store_id,
  customers.id as customer_id,
  customers.email,
  customers.first_name,
  customers.last_name,
  customers.phone,
  customers.business_name,
  customers.city,
  customers.state,
  customers.country,
  customers.delivery_city,
  customers.delivery_state,
  customers.delivery_postal_code,
  customers.delivery_country,
  customers.created_at,
  customers.updated_at,
  coalesce(customer_order_summary.order_count, 0) as order_count,
  coalesce(customer_order_summary.open_order_count, 0) as open_order_count,
  coalesce(customer_order_summary.lifetime_order_total, 0)::numeric(10, 2) as lifetime_order_total,
  customer_order_summary.latest_order_created_at
from public.customers
left join customer_order_summary
  on customer_order_summary.store_id = customers.store_id
 and customer_order_summary.customer_id = customers.id
where public.owns_store(customers.store_id)
   or public.is_admin();

comment on view public.seller_customer_summary is
'Seller-private customer/contact summary for dashboard lookup and fulfillment support. Internal notes are intentionally omitted.';


create or replace view public.seller_refund_summary
with (security_barrier = true)
as
select
  order_refunds.store_id,
  order_refunds.order_id,
  order_refunds.id as refund_id,
  orders.order_number,
  order_refunds.refund_amount,
  order_refunds.refund_method,
  order_refunds.refund_status,
  order_refunds.provider_status,
  order_refunds.reason,
  order_refunds.note,
  order_refunds.created_by_user_id,
  order_refunds.created_at,
  order_refunds.updated_at,
  order_refunds.processed_at
from public.order_refunds
join public.orders
  on orders.id = order_refunds.order_id
 and orders.store_id = order_refunds.store_id
where public.owns_store(order_refunds.store_id)
   or public.is_admin();

comment on view public.seller_refund_summary is
'Seller-private refund summary for order management. Provider refund identifiers are intentionally omitted.';


create or replace view public.seller_notification_summary
with (security_barrier = true)
as
select
  email_notifications.store_id,
  email_notifications.order_id,
  orders.order_number,
  email_notifications.id as notification_id,
  email_notifications.recipient_type,
  email_notifications.notification_type,
  email_notifications.notification_status,
  email_notifications.attempt_count,
  email_notifications.next_attempt_at,
  email_notifications.last_attempt_at,
  email_notifications.sent_at,
  email_notifications.last_error,
  email_notifications.created_at,
  email_notifications.updated_at
from public.email_notifications
left join public.orders
  on orders.id = email_notifications.order_id
 and orders.store_id = email_notifications.store_id
where public.owns_store(email_notifications.store_id)
   or public.is_admin();

comment on view public.seller_notification_summary is
'Seller-private notification delivery summary for operational visibility. Recipient emails and payload JSON are intentionally omitted.';


revoke all on public.seller_dashboard_home from public;
revoke all on public.seller_inventory_management from public;
revoke all on public.seller_order_management from public;
revoke all on public.seller_order_item_detail from public;
revoke all on public.seller_customer_summary from public;
revoke all on public.seller_refund_summary from public;
revoke all on public.seller_notification_summary from public;

grant select on public.seller_dashboard_home to authenticated;
grant select on public.seller_inventory_management to authenticated;
grant select on public.seller_order_management to authenticated;
grant select on public.seller_order_item_detail to authenticated;
grant select on public.seller_customer_summary to authenticated;
grant select on public.seller_refund_summary to authenticated;
grant select on public.seller_notification_summary to authenticated;
