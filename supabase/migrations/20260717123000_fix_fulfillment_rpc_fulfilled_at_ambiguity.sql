-- Fix seller_record_order_fulfillment fulfilled_at ambiguity.
--
-- The function returns a column named fulfilled_at, so unqualified references
-- to the orders.fulfilled_at column inside PL/pgSQL are ambiguous. Preserve
-- fulfillment behavior while qualifying table-column references.

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

  insert into pg_temp.requested_fulfillment_items (
    order_item_id,
    quantity
  )
  select
    (item ->> 'order_item_id')::uuid,
    (item ->> 'quantity')::integer
  from jsonb_array_elements(p_items) as item;

  select count(*)
  into v_requested_item_count
  from pg_temp.requested_fulfillment_items as requested_items;

  create temporary table pg_temp.locked_fulfillment_items (
    order_item_id uuid primary key,
    requested_quantity integer not null,
    quantity integer not null,
    fulfilled_quantity integer not null,
    restored_quantity integer not null
  ) on commit drop;

  insert into pg_temp.locked_fulfillment_items (
    order_item_id,
    requested_quantity,
    quantity,
    fulfilled_quantity,
    restored_quantity
  )
  select
    order_item.id,
    requested_item.quantity,
    order_item.quantity,
    order_item.fulfilled_quantity,
    order_item.restored_quantity
  from pg_temp.requested_fulfillment_items as requested_item
  join public.order_items as order_item
    on order_item.id = requested_item.order_item_id
   and order_item.order_id = v_order.id
   and order_item.store_id = v_order.store_id
  order by order_item.id
  for update of order_item;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_fulfillment_items as locked_item;

  if v_locked_item_count <> v_requested_item_count then
    raise exception 'One or more order items are not available for this order.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_fulfillment_items as locked_item
    where locked_item.requested_quantity > (
      locked_item.quantity
      - locked_item.fulfilled_quantity
      - locked_item.restored_quantity
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
      and order_item.fulfilled_quantity + order_item.restored_quantity < order_item.quantity
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
          )
          order by locked_item.order_item_id
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
'Trusted seller/admin RPC to record partial item-level fulfillment and complete the order when all non-restored quantities are fulfilled. Does not enqueue fulfillment email notifications.';

revoke all on function public.seller_record_order_fulfillment(uuid, jsonb, text) from public;
grant execute on function public.seller_record_order_fulfillment(uuid, jsonb, text) to authenticated;
