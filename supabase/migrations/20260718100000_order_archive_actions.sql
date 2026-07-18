-- Add seller-facing order archiving as an organizational flag only.
-- Archiving must not change fulfillment, payment, cancellation, inventory,
-- totals, Stripe state, transactional emails, or saved order snapshots.

alter table public.orders
add column if not exists archived_at timestamptz,
add column if not exists archived_by uuid references auth.users(id) on delete set null;

comment on column public.orders.archived_at is
'Timestamp when the seller/admin archived this order for organization. This is not an order status and must not change fulfillment, payment, inventory, totals, Stripe state, or email behavior.';

comment on column public.orders.archived_by is
'User who archived this order for organization, when available. This is audit metadata only and does not affect order fulfillment, payment, inventory, totals, Stripe state, or email behavior.';

create index if not exists orders_store_archived_created_at_idx
on public.orders(store_id, archived_at, created_at desc);

alter table public.order_events
drop constraint if exists order_events_event_type_check;

alter table public.order_events
add constraint order_events_event_type_check check (
  event_type in (
    'payment_marked_paid',
    'payment_marked_pay_at_pickup',
    'payment_provider_checkout_session_recorded',
    'payment_provider_payment_succeeded',
    'payment_provider_payment_failed',
    'payment_provider_refund_updated',
    'order_ready_for_pickup',
    'order_partially_fulfilled',
    'order_fulfilled',
    'order_unfulfilled',
    'order_canceled',
    'order_reinstated',
    'order_archived',
    'order_unarchived',
    'refund_recorded',
    'order_edited'
  )
);

create or replace view public.seller_dashboard_order_summary
with (security_barrier = true)
as
select
  stores.id as store_id,
  count(orders.id) filter (
    where orders.order_status in ('pending', 'open')
      and orders.archived_at is null
  ) as pending_open_order_count,
  count(orders.id) filter (
    where orders.order_status = 'fulfilled'
      and orders.archived_at is null
  ) as fulfilled_order_count,
  count(orders.id) filter (
    where orders.order_status = 'canceled'
      and orders.archived_at is null
  ) as canceled_order_count,
  min(orders.created_at) filter (
    where orders.order_status in ('pending', 'open')
      and orders.archived_at is null
  ) as oldest_order_requiring_action_at,
  count(orders.id) filter (
    where orders.order_status in ('pending', 'open')
      and orders.pickup_option_label_snapshot is not null
      and orders.archived_at is null
  ) as upcoming_pickup_order_count
from public.stores
left join public.orders
  on orders.store_id = stores.id
where public.owns_store(stores.id)
   or public.is_admin()
group by stores.id;

comment on view public.seller_dashboard_order_summary is
'Seller-private dashboard projection for active operational order counts. Archived orders are organizationally hidden from active dashboard counts but remain available in order history and reports.';

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
  coalesce(order_item_counts.item_count, 0) as item_count,
  orders.pickup_option_id,
  orders.pickup_option_label_snapshot
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
  and orders.archived_at is null
  and (
    public.owns_store(orders.store_id)
    or public.is_admin()
  )
order by orders.created_at asc, orders.id asc;

comment on view public.seller_dashboard_attention_orders is
'Seller-private dashboard projection listing active pending/open orders that need attention, including selected pickup option labels when present. Archived orders are hidden from this active work queue.';

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
          and orders.archived_at is null
      ) as pending_open_order_count,
      count(*) filter (
        where orders.order_status = 'fulfilled'
          and orders.archived_at is null
      ) as fulfilled_order_count,
      count(*) filter (
        where orders.order_status = 'canceled'
          and orders.archived_at is null
      ) as canceled_order_count,
      min(orders.created_at) filter (
        where orders.order_status in ('pending', 'open')
          and orders.archived_at is null
      ) as oldest_order_requiring_action_at,
      count(*) filter (
        where orders.ready_for_pickup_at is not null
          and orders.order_status in ('pending', 'open')
          and orders.archived_at is null
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
'Store-scoped seller dashboard summary. Archived orders are hidden from active order counts but remain available in history and reports.';

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
  notification_summary.latest_notification_updated_at,
  orders.pickup_option_id,
  orders.pickup_option_label_snapshot,
  orders.archived_at,
  orders.archived_by
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
'Seller-private order management projection with fulfillment, refund, notification, pickup-option, archive, and contact snapshots needed for dashboard order lists. Provider identifiers are intentionally omitted. Archived orders remain available in this broad history projection.';

create or replace function public.seller_archive_order(
  p_order_id uuid,
  p_note text default null
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  order_status text,
  payment_status text,
  archived_at timestamptz,
  archived_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_actor_type text;
  v_note text;
begin
  v_note := nullif(trim(p_note), '');

  select selected_order.*
  into v_order
  from public.orders as selected_order
  where selected_order.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if not (public.owns_store(v_order.store_id) or public.is_admin()) then
    raise exception 'Order is not available.';
  end if;

  if v_order.archived_at is not null then
    raise exception 'Order is already archived.';
  end if;

  update public.orders as target_order
  set
    archived_at = now(),
    archived_by = auth.uid()
  where target_order.id = v_order.id
  returning target_order.* into v_order;

  v_actor_type := case when public.is_admin() then 'admin' else 'seller' end;

  insert into public.order_events (
    store_id,
    order_id,
    actor_user_id,
    actor_type,
    event_type,
    from_order_status,
    to_order_status,
    from_payment_status,
    to_payment_status,
    note,
    metadata
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    v_actor_type,
    'order_archived',
    v_order.order_status,
    v_order.order_status,
    v_order.payment_status,
    v_order.payment_status,
    v_note,
    jsonb_build_object(
      'archived_at', v_order.archived_at,
      'archived_by', v_order.archived_by
    )
  );

  return query
  select
    final_order.id,
    final_order.order_number,
    final_order.store_id,
    final_order.order_status,
    final_order.payment_status,
    final_order.archived_at,
    final_order.archived_by
  from public.orders as final_order
  where final_order.id = v_order.id;
end;
$$;

comment on function public.seller_archive_order(uuid, text) is
'Trusted seller/admin RPC to archive an order for organization without changing status, payment, fulfillment, inventory, totals, Stripe state, or emails.';

revoke all on function public.seller_archive_order(uuid, text) from public;
grant execute on function public.seller_archive_order(uuid, text) to authenticated;

create or replace function public.seller_unarchive_order(
  p_order_id uuid,
  p_note text default null
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  order_status text,
  payment_status text,
  archived_at timestamptz,
  archived_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_actor_type text;
  v_note text;
  v_previous_archived_at timestamptz;
  v_previous_archived_by uuid;
begin
  v_note := nullif(trim(p_note), '');

  select selected_order.*
  into v_order
  from public.orders as selected_order
  where selected_order.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if not (public.owns_store(v_order.store_id) or public.is_admin()) then
    raise exception 'Order is not available.';
  end if;

  if v_order.archived_at is null then
    raise exception 'Order is not archived.';
  end if;

  v_previous_archived_at := v_order.archived_at;
  v_previous_archived_by := v_order.archived_by;

  update public.orders as target_order
  set
    archived_at = null,
    archived_by = null
  where target_order.id = v_order.id
  returning target_order.* into v_order;

  v_actor_type := case when public.is_admin() then 'admin' else 'seller' end;

  insert into public.order_events (
    store_id,
    order_id,
    actor_user_id,
    actor_type,
    event_type,
    from_order_status,
    to_order_status,
    from_payment_status,
    to_payment_status,
    note,
    metadata
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    v_actor_type,
    'order_unarchived',
    v_order.order_status,
    v_order.order_status,
    v_order.payment_status,
    v_order.payment_status,
    v_note,
    jsonb_build_object(
      'previous_archived_at', v_previous_archived_at,
      'previous_archived_by', v_previous_archived_by
    )
  );

  return query
  select
    final_order.id,
    final_order.order_number,
    final_order.store_id,
    final_order.order_status,
    final_order.payment_status,
    final_order.archived_at,
    final_order.archived_by
  from public.orders as final_order
  where final_order.id = v_order.id;
end;
$$;

comment on function public.seller_unarchive_order(uuid, text) is
'Trusted seller/admin RPC to unarchive an order for organization without changing status, payment, fulfillment, inventory, totals, Stripe state, or emails.';

revoke all on function public.seller_unarchive_order(uuid, text) from public;
grant execute on function public.seller_unarchive_order(uuid, text) to authenticated;

revoke all on public.seller_dashboard_order_summary from public;
revoke all on public.seller_dashboard_attention_orders from public;
revoke all on public.seller_order_management from public;

grant select on public.seller_dashboard_order_summary to authenticated;
grant select on public.seller_dashboard_attention_orders to authenticated;
grant select on public.seller_order_management to authenticated;

revoke all on function public.get_seller_dashboard_home(uuid) from public;
grant execute on function public.get_seller_dashboard_home(uuid) to authenticated;
