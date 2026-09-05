-- Track cancellation independently from fulfillment and physical inventory restoration.

begin;

alter table public.order_items
  add column canceled_quantity integer not null default 0;

alter table public.order_items
  add constraint order_items_canceled_quantity_nonnegative_check
    check (canceled_quantity >= 0),
  add constraint order_items_canceled_quantity_not_over_ordered_check
    check (canceled_quantity <= quantity),
  add constraint order_items_fulfilled_canceled_not_over_ordered_check
    check (fulfilled_quantity + canceled_quantity <= quantity);

comment on column public.order_items.canceled_quantity is
'Quantity removed from the active order. This is independent of restored_quantity, which records physical inventory returned to availability.';

create index if not exists order_items_order_active_quantity_idx
on public.order_items(order_id, fulfilled_quantity, canceled_quantity);

-- Existing rows retain the column default of zero. In particular, historical
-- canceled rows are not inferred from order status, restored quantities, or
-- refund totals.

create or replace view public.seller_order_item_detail
with (security_barrier = true)
as
select
  oi.store_id, oi.order_id, oi.id as order_item_id, o.order_number,
  oi.inventory_item_id, oi.equipment_inventory_item_id,
  oi.processed_poultry_inventory_item_id, oi.listing_batch_id,
  oi.listing_batch_breed_id, oi.seller_breed_profile_id, oi.species_id,
  oi.species_name_snapshot, oi.species_slug_snapshot,
  oi.breed_display_name_snapshot, oi.breed_description_snapshot,
  oi.inventory_type_snapshot, oi.custom_inventory_label_snapshot,
  oi.batch_type_snapshot, oi.product_type_snapshot, oi.item_name_snapshot,
  oi.item_category_snapshot, oi.available_date_snapshot,
  oi.age_at_availability_days_snapshot, oi.unit_price_snapshot, oi.quantity,
  oi.fulfilled_quantity, oi.restored_quantity,
  case when o.order_status = 'canceled' then 0
       else greatest(oi.quantity - oi.fulfilled_quantity - oi.canceled_quantity, 0)
  end as remaining_unfulfilled_quantity,
  oi.line_subtotal, oi.created_at, oi.hatch_date_snapshot,
  oi.age_at_sale_days_snapshot, oi.order_item_source,
  oi.custom_item_name_snapshot, oi.hatching_egg_inventory_item_id,
  oi.breeding_history_snapshot, oi.feather_condition_snapshot,
  oi.canceled_quantity
from public.order_items as oi
join public.orders as o on o.id = oi.order_id and o.store_id = oi.store_id
where public.owns_store(oi.store_id) or public.is_admin();

comment on view public.seller_order_item_detail is
'Seller-private order item projection. Active quantity is ordered minus fulfilled minus canceled; inventory restoration is reported separately.';

grant select on public.seller_order_item_detail to authenticated;

create or replace function public.seller_record_order_fulfillment(
  p_order_id uuid,
  p_items jsonb,
  p_note text default null
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  order_status text,
  payment_status text,
  ready_for_pickup_at timestamptz,
  fulfilled_at timestamptz,
  canceled_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_note text;
  v_actor_type text;
  v_requested_item_count integer;
  v_locked_item_count integer;
  v_all_done boolean;
  v_from_order_status text;
  v_event_type text;
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

  if v_order.order_status not in ('pending', 'open') then
    raise exception 'Only pending or open orders can be fulfilled.';
  end if;

  v_from_order_status := v_order.order_status;

  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one fulfillment item is required.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where jsonb_typeof(item) <> 'object'
       or not (item ? 'order_item_id')
       or not (item ? 'quantity')
       or item ->> 'order_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or item ->> 'quantity' !~ '^[0-9]+$'
       or (item ->> 'quantity')::integer <= 0
  ) then
    raise exception 'Each fulfillment item must include a valid order item ID and positive quantity.';
  end if;

  drop table if exists pg_temp.requested_fulfillment_items;
  drop table if exists pg_temp.locked_fulfillment_items;

  if exists (
    select 1
    from (
      select
        (item ->> 'order_item_id')::uuid as order_item_id,
        count(*) as item_count
      from jsonb_array_elements(p_items) as item
      group by (item ->> 'order_item_id')::uuid
    ) as duplicated_items
    where duplicated_items.item_count > 1
  ) then
    raise exception 'Duplicate order items are not supported in a fulfillment request.';
  end if;

  create temporary table pg_temp.requested_fulfillment_items (
    order_item_id uuid primary key,
    quantity integer not null check (quantity > 0)
  ) on commit drop;

  insert into pg_temp.requested_fulfillment_items (order_item_id, quantity)
  select
    (item ->> 'order_item_id')::uuid,
    (item ->> 'quantity')::integer
  from jsonb_array_elements(p_items) as item;

  select count(*)
  into v_requested_item_count
  from pg_temp.requested_fulfillment_items;

  create temporary table pg_temp.locked_fulfillment_items (
    order_item_id uuid primary key,
    requested_quantity integer not null,
    quantity integer not null,
    fulfilled_quantity integer not null,
    canceled_quantity integer not null
  ) on commit drop;

  insert into pg_temp.locked_fulfillment_items (
    order_item_id,
    requested_quantity,
    quantity,
    fulfilled_quantity,
    canceled_quantity
  )
  select
    order_item.id,
    requested_item.quantity,
    order_item.quantity,
    order_item.fulfilled_quantity,
    order_item.canceled_quantity
  from pg_temp.requested_fulfillment_items as requested_item
  join public.order_items as order_item
    on order_item.id = requested_item.order_item_id
   and order_item.order_id = v_order.id
   and order_item.store_id = v_order.store_id
  order by order_item.id
  for update of order_item;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_fulfillment_items;

  if v_locked_item_count <> v_requested_item_count then
    raise exception 'One or more order items are not available for this order.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_fulfillment_items as locked_item
    where locked_item.requested_quantity > (
      locked_item.quantity
      - locked_item.fulfilled_quantity
      - locked_item.canceled_quantity
    )
  ) then
    raise exception 'Fulfillment quantity exceeds remaining unfulfilled quantity.';
  end if;

  update public.order_items as order_item
  set fulfilled_quantity = order_item.fulfilled_quantity + locked_item.requested_quantity
  from pg_temp.locked_fulfillment_items as locked_item
  where order_item.id = locked_item.order_item_id
    and order_item.order_id = v_order.id
    and order_item.store_id = v_order.store_id;

  select not exists (
    select 1
    from public.order_items as order_item
    where order_item.order_id = v_order.id
      and order_item.store_id = v_order.store_id
      and order_item.fulfilled_quantity + order_item.canceled_quantity < order_item.quantity
  )
  into v_all_done;

  if v_all_done then
    update public.orders as target_order
    set
      order_status = 'fulfilled',
      fulfilled_at = coalesce(target_order.fulfilled_at, now())
    where target_order.id = v_order.id
    returning target_order.* into v_order;
    v_event_type := 'order_fulfilled';
  else
    update public.orders as target_order
    set order_status = 'open'
    where target_order.id = v_order.id
    returning target_order.* into v_order;
    v_event_type := 'order_partially_fulfilled';
  end if;

  v_actor_type := case when public.is_admin() then 'admin' else 'seller' end;

  insert into public.order_events (
    store_id, order_id, actor_user_id, actor_type, event_type,
    from_order_status, to_order_status, from_payment_status,
    to_payment_status, note, metadata
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    v_actor_type,
    v_event_type,
    v_from_order_status,
    v_order.order_status,
    v_order.payment_status,
    v_order.payment_status,
    v_note,
    jsonb_build_object(
      'fulfilled_items',
      (
        select jsonb_agg(
          jsonb_build_object(
            'order_item_id', locked_item.order_item_id,
            'quantity_fulfilled', locked_item.requested_quantity
          ) order by locked_item.order_item_id
        )
        from pg_temp.locked_fulfillment_items as locked_item
      )
    )
  );

  return query
  select
    final_order.id,
    final_order.order_number,
    final_order.store_id,
    final_order.order_status,
    final_order.payment_status,
    final_order.ready_for_pickup_at,
    final_order.fulfilled_at,
    final_order.canceled_at,
    final_order.updated_at
  from public.orders as final_order
  where final_order.id = v_order.id;
end;
$$;

comment on function public.seller_record_order_fulfillment(uuid, jsonb, text) is
'Records selected fulfillment quantities against active ordered quantity. Canceled quantity, not restored inventory, reduces what remains fulfillable.';

revoke all on function public.seller_record_order_fulfillment(uuid, jsonb, text) from public;
grant execute on function public.seller_record_order_fulfillment(uuid, jsonb, text) to authenticated;

create or replace function public.seller_bulk_mark_orders_fulfilled(
  p_order_ids uuid[],
  p_mark_paid boolean default false,
  p_note text default null
)
returns table (
  requested_count integer,
  fulfilled_count integer,
  skipped_count integer,
  payment_updated_count integer,
  payment_skipped_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type text;
  v_note text;
  v_requested_count integer;
  v_owned_count integer;
  v_fulfilled_count integer;
  v_payment_updated_count integer;
  v_payment_candidate_count integer;
begin
  v_note := nullif(trim(p_note), '');
  v_actor_type := case when public.is_admin() then 'admin' else 'seller' end;

  drop table if exists pg_temp.bulk_requested_orders;
  drop table if exists pg_temp.bulk_owned_orders;
  drop table if exists pg_temp.bulk_fulfillment_eligible_orders;
  drop table if exists pg_temp.bulk_fulfillment_items;
  drop table if exists pg_temp.bulk_payment_eligible_orders;

  create temporary table pg_temp.bulk_requested_orders (
    order_id uuid primary key
  ) on commit drop;

  insert into pg_temp.bulk_requested_orders (order_id)
  select distinct requested_order_id
  from unnest(coalesce(p_order_ids, '{}'::uuid[])) as requested_order_id
  where requested_order_id is not null;

  select count(*) into v_requested_count
  from pg_temp.bulk_requested_orders;

  if v_requested_count = 0 then
    raise exception 'Select at least one order.';
  end if;

  create temporary table pg_temp.bulk_owned_orders
  (like public.orders including defaults) on commit drop;

  insert into pg_temp.bulk_owned_orders
  select selected_order.*
  from public.orders as selected_order
  join pg_temp.bulk_requested_orders as requested_order
    on requested_order.order_id = selected_order.id
  where public.owns_store(selected_order.store_id)
     or public.is_admin()
  for update of selected_order;

  select count(*) into v_owned_count
  from pg_temp.bulk_owned_orders;

  if v_owned_count <> v_requested_count then
    raise exception 'One or more selected orders are not available.';
  end if;

  create temporary table pg_temp.bulk_fulfillment_eligible_orders on commit drop as
  select owned_order.*
  from pg_temp.bulk_owned_orders as owned_order
  where owned_order.archived_at is null
    and owned_order.order_status in ('pending', 'open')
    and exists (
      select 1
      from public.order_items as order_item
      where order_item.order_id = owned_order.id
        and order_item.store_id = owned_order.store_id
        and order_item.quantity - order_item.fulfilled_quantity - order_item.canceled_quantity > 0
    );

  create temporary table pg_temp.bulk_fulfillment_items (
    store_id uuid not null,
    order_id uuid not null,
    order_item_id uuid primary key,
    quantity_to_fulfill integer not null check (quantity_to_fulfill > 0)
  ) on commit drop;

  insert into pg_temp.bulk_fulfillment_items (
    store_id, order_id, order_item_id, quantity_to_fulfill
  )
  select
    order_item.store_id,
    order_item.order_id,
    order_item.id,
    order_item.quantity - order_item.fulfilled_quantity - order_item.canceled_quantity
  from public.order_items as order_item
  join pg_temp.bulk_fulfillment_eligible_orders as eligible_order
    on eligible_order.id = order_item.order_id
   and eligible_order.store_id = order_item.store_id
  where order_item.quantity - order_item.fulfilled_quantity - order_item.canceled_quantity > 0
  order by order_item.order_id, order_item.id
  for update of order_item;

  update public.order_items as target_item
  set fulfilled_quantity = target_item.fulfilled_quantity + fulfillment_item.quantity_to_fulfill
  from pg_temp.bulk_fulfillment_items as fulfillment_item
  where target_item.id = fulfillment_item.order_item_id
    and target_item.order_id = fulfillment_item.order_id
    and target_item.store_id = fulfillment_item.store_id;

  update public.orders as target_order
  set
    order_status = 'fulfilled',
    fulfilled_at = coalesce(target_order.fulfilled_at, now())
  from pg_temp.bulk_fulfillment_eligible_orders as eligible_order
  where target_order.id = eligible_order.id;

  get diagnostics v_fulfilled_count = row_count;

  insert into public.order_events (
    store_id, order_id, actor_user_id, actor_type, event_type,
    from_order_status, to_order_status, from_payment_status,
    to_payment_status, note, metadata
  )
  select
    eligible_order.store_id,
    eligible_order.id,
    auth.uid(),
    v_actor_type,
    'order_fulfilled',
    eligible_order.order_status,
    'fulfilled',
    eligible_order.payment_status,
    eligible_order.payment_status,
    v_note,
    jsonb_build_object(
      'bulk_action', true,
      'fulfilled_items',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'order_item_id', fulfillment_item.order_item_id,
              'quantity_fulfilled', fulfillment_item.quantity_to_fulfill
            ) order by fulfillment_item.order_item_id
          )
          from pg_temp.bulk_fulfillment_items as fulfillment_item
          where fulfillment_item.order_id = eligible_order.id
        ),
        '[]'::jsonb
      )
    )
  from pg_temp.bulk_fulfillment_eligible_orders as eligible_order;

  create temporary table pg_temp.bulk_payment_eligible_orders on commit drop as
  select eligible_order.*
  from pg_temp.bulk_fulfillment_eligible_orders as eligible_order
  where p_mark_paid = true
    and eligible_order.payment_provider = 'offline'
    and eligible_order.payment_method = 'pay_at_pickup'
    and eligible_order.payment_status in ('pay_at_pickup', 'unpaid');

  select case when p_mark_paid then v_fulfilled_count else 0 end
  into v_payment_candidate_count;

  update public.orders as target_order
  set
    payment_status = 'paid',
    paid_at = coalesce(target_order.paid_at, now())
  from pg_temp.bulk_payment_eligible_orders as eligible_order
  where target_order.id = eligible_order.id;

  get diagnostics v_payment_updated_count = row_count;

  insert into public.order_events (
    store_id, order_id, actor_user_id, actor_type, event_type,
    from_order_status, to_order_status, from_payment_status,
    to_payment_status, note, metadata
  )
  select
    eligible_order.store_id,
    eligible_order.id,
    auth.uid(),
    v_actor_type,
    'payment_marked_paid',
    'fulfilled',
    'fulfilled',
    eligible_order.payment_status,
    'paid',
    v_note,
    jsonb_build_object('bulk_action', true, 'bulk_fulfillment_action', true)
  from pg_temp.bulk_payment_eligible_orders as eligible_order;

  return query
  select
    v_requested_count,
    v_fulfilled_count,
    v_requested_count - v_fulfilled_count,
    v_payment_updated_count,
    v_payment_candidate_count - v_payment_updated_count;
end;
$$;

comment on function public.seller_bulk_mark_orders_fulfilled(uuid[], boolean, text) is
'Trusted seller/admin RPC to fulfill all active remaining quantities on eligible selected pending/open orders. Canceled quantity, not restored inventory, reduces what remains fulfillable.';

revoke all on function public.seller_bulk_mark_orders_fulfilled(uuid[], boolean, text) from public;
grant execute on function public.seller_bulk_mark_orders_fulfilled(uuid[], boolean, text) to authenticated;

-- Keep the older single-action compatibility RPC aligned with the same active
-- quantity model. Its ownership, lifecycle, event, and notification behavior
-- remains unchanged.
create or replace function public.mark_order_fulfilled(
  p_order_id uuid,
  p_note text default null
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  order_status text,
  payment_status text,
  fulfilled_at timestamptz,
  canceled_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_from_order_status text;
  v_note text;
  v_actor_type text;
begin
  v_note := nullif(trim(p_note), '');

  select *
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if not (public.owns_store(v_order.store_id) or public.is_admin()) then
    raise exception 'Order is not available.';
  end if;

  if v_order.order_status not in ('pending', 'open') then
    raise exception 'Only pending or open orders can be marked fulfilled.';
  end if;

  v_from_order_status := v_order.order_status;

  update public.order_items
  set fulfilled_quantity = quantity - canceled_quantity
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id;

  update public.orders as target_order
  set
    order_status = 'fulfilled',
    fulfilled_at = coalesce(target_order.fulfilled_at, now())
  where target_order.id = v_order.id
  returning * into v_order;

  select *
  into v_store
  from public.stores
  where stores.id = v_order.store_id;

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
    note
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    v_actor_type,
    'order_fulfilled',
    v_from_order_status,
    'fulfilled',
    v_order.payment_status,
    v_order.payment_status,
    v_note
  );

  perform public.enqueue_email_notification(
    v_order.store_id,
    v_order.id,
    'buyer_order_fulfilled',
    'buyer',
    v_order.buyer_email_snapshot,
    'Order completed: ' || v_order.order_number,
    jsonb_build_object(
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
      'fulfilled_at', v_order.fulfilled_at
    )
  );

  return query
  select
    orders.id,
    orders.order_number,
    orders.store_id,
    orders.order_status,
    orders.payment_status,
    orders.fulfilled_at,
    orders.canceled_at,
    orders.updated_at
  from public.orders
  where orders.id = v_order.id;
end;
$$;

comment on function public.mark_order_fulfilled(uuid, text) is
'Compatibility fulfillment action. It fulfills original quantity minus canceled quantity and preserves the existing event and email behavior.';

revoke all on function public.mark_order_fulfilled(uuid, text) from public;
grant execute on function public.mark_order_fulfilled(uuid, text) to authenticated;

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
    coalesce(sum(order_items.restored_quantity), 0) as restored_item_quantity,
    coalesce(sum(order_items.canceled_quantity), 0) as canceled_item_quantity
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
  coalesce(store_pickup_options.label, orders.pickup_option_label_snapshot) as pickup_option_label_snapshot,
  orders.archived_at,
  orders.archived_by,
  coalesce(item_summary.canceled_item_quantity, 0) as canceled_item_quantity
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
left join public.store_pickup_options
  on store_pickup_options.id = orders.pickup_option_id
 and store_pickup_options.store_id = orders.store_id
where public.owns_store(orders.store_id)
   or public.is_admin();

comment on view public.seller_order_management is
'Seller-private order management projection with explicit fulfilled, canceled, and restored item totals. Inventory restoration does not determine active order quantity.';

grant select on public.seller_order_management to authenticated;

alter function public.seller_get_order_list_page(
  uuid, text, text, uuid, text, text, integer, integer
)
rename to seller_get_order_list_page_before_canceled_quantity;

revoke all on function public.seller_get_order_list_page_before_canceled_quantity(
  uuid, text, text, uuid, text, text, integer, integer
) from public, anon, authenticated, service_role;

create function public.seller_get_order_list_page(
  p_store_id uuid,
  p_archive_view text,
  p_status_filter text,
  p_pickup_option_id uuid,
  p_search text,
  p_sort text,
  p_offset integer,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page jsonb;
  v_items jsonb;
begin
  v_page := public.seller_get_order_list_page_before_canceled_quantity(
    p_store_id,
    p_archive_view,
    p_status_filter,
    p_pickup_option_id,
    p_search,
    p_sort,
    p_offset,
    p_limit
  );

  select coalesce(
    jsonb_agg(
      page_item.value || jsonb_build_object(
        'canceled_quantity', order_items.canceled_quantity,
        'remaining_unfulfilled_quantity', case
          when orders.order_status = 'canceled' then 0
          else greatest(
            order_items.quantity
              - order_items.fulfilled_quantity
              - order_items.canceled_quantity,
            0
          )
        end
      )
      order by page_item.ordinality
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(coalesce(v_page -> 'items', '[]'::jsonb))
    with ordinality as page_item(value, ordinality)
  join public.order_items
    on order_items.id = (page_item.value ->> 'order_item_id')::uuid
   and order_items.store_id = p_store_id
  join public.orders
    on orders.id = order_items.order_id
   and orders.store_id = order_items.store_id;

  return jsonb_set(v_page, '{items}', v_items, true);
end;
$$;

comment on function public.seller_get_order_list_page(
  uuid, text, text, uuid, text, text, integer, integer
) is
'Returns the existing bounded seller order page with explicit canceled quantity and active remaining quantity on each order item.';

revoke all on function public.seller_get_order_list_page(
  uuid, text, text, uuid, text, text, integer, integer
) from public, anon, service_role;
grant execute on function public.seller_get_order_list_page(
  uuid, text, text, uuid, text, text, integer, integer
) to authenticated;

commit;
