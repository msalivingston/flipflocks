-- V1 order-detail action cleanup.
--
-- - Keep fulfillment item/status behavior, but stop enqueueing the legacy
--   fulfilled email notification from the fulfillment RPC.
-- - Allow offline unpaid/pay-at-pickup orders to be marked paid.
-- - Allow offline manually paid orders to be marked unpaid without touching
--   Stripe/provider payment state.

create or replace function public.mark_order_paid(
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
  v_note text;
  v_actor_type text;
  v_from_payment_status text;
begin
  v_note := nullif(trim(p_note), '');

  select *
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order not found.';
  end if;

  if not (
    public.owns_store(v_order.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to manage this order.';
  end if;

  if v_order.payment_provider <> 'offline'
    or v_order.payment_method <> 'pay_at_pickup' then
    raise exception 'Payment correction is only available for offline pay-at-pickup orders.';
  end if;

  if v_order.order_status not in ('pending', 'open', 'fulfilled') then
    raise exception 'Only pending, open, or fulfilled orders can be marked paid.';
  end if;

  if v_order.payment_status not in ('pay_at_pickup', 'unpaid') then
    raise exception 'Only unpaid offline orders can be marked paid.';
  end if;

  v_from_payment_status := v_order.payment_status;

  update public.orders
  set
    payment_status = 'paid',
    paid_at = coalesce(paid_at, now())
  where orders.id = v_order.id
  returning * into v_order;

  v_actor_type := case
    when public.is_admin() then 'admin'
    else 'seller'
  end;

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
    'payment_marked_paid',
    v_order.order_status,
    v_order.order_status,
    v_from_payment_status,
    'paid',
    v_note
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

create or replace function public.mark_order_pay_at_pickup(
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
    raise exception 'Order not found.';
  end if;

  if not (
    public.owns_store(v_order.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to manage this order.';
  end if;

  if v_order.payment_provider <> 'offline'
    or v_order.payment_method <> 'pay_at_pickup' then
    raise exception 'Payment correction is only available for offline pay-at-pickup orders.';
  end if;

  if v_order.order_status not in ('pending', 'open', 'fulfilled') then
    raise exception 'Only pending, open, or fulfilled orders can be marked unpaid.';
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'Only paid offline orders can be marked unpaid.';
  end if;

  update public.orders
  set
    payment_status = 'unpaid',
    paid_at = null
  where orders.id = v_order.id
  returning * into v_order;

  v_actor_type := case
    when public.is_admin() then 'admin'
    else 'seller'
  end;

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
    'payment_marked_pay_at_pickup',
    v_order.order_status,
    v_order.order_status,
    'paid',
    'unpaid',
    v_note
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
  from pg_temp.requested_fulfillment_items;

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
    order_items.id,
    requested_fulfillment_items.quantity,
    order_items.quantity,
    order_items.fulfilled_quantity,
    order_items.restored_quantity
  from pg_temp.requested_fulfillment_items
  join public.order_items
    on order_items.id = requested_fulfillment_items.order_item_id
   and order_items.order_id = v_order.id
   and order_items.store_id = v_order.store_id
  order by order_items.id
  for update of order_items;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_fulfillment_items;

  if v_locked_item_count <> v_requested_item_count then
    raise exception 'One or more order items are not available for this order.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_fulfillment_items
    where requested_quantity > (quantity - fulfilled_quantity - restored_quantity)
  ) then
    raise exception 'Fulfillment quantity exceeds remaining unfulfilled quantity.';
  end if;

  update public.order_items
  set fulfilled_quantity = order_items.fulfilled_quantity + locked_fulfillment_items.requested_quantity
  from pg_temp.locked_fulfillment_items
  where order_items.id = locked_fulfillment_items.order_item_id
    and order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id;

  select not exists (
    select 1
    from public.order_items
    where order_items.order_id = v_order.id
      and order_items.store_id = v_order.store_id
      and order_items.fulfilled_quantity + order_items.restored_quantity < order_items.quantity
  )
  into v_all_done;

  if v_all_done then
    update public.orders
    set
      order_status = 'fulfilled',
      fulfilled_at = coalesce(fulfilled_at, now())
    where orders.id = v_order.id
    returning * into v_order;
    v_event_type := 'order_fulfilled';
  else
    update public.orders
    set order_status = 'open'
    where orders.id = v_order.id
    returning * into v_order;
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
            'order_item_id', locked_fulfillment_items.order_item_id,
            'quantity_fulfilled', locked_fulfillment_items.requested_quantity
          )
          order by locked_fulfillment_items.order_item_id
        )
        from pg_temp.locked_fulfillment_items
      )
    )
  );

  return query
  select
    orders.id,
    orders.order_number,
    orders.store_id,
    orders.order_status,
    orders.payment_status,
    orders.ready_for_pickup_at,
    orders.fulfilled_at,
    orders.canceled_at,
    orders.updated_at
  from public.orders
  where orders.id = v_order.id;
end;
$$;

comment on function public.mark_order_paid(uuid, text) is
'Trusted seller/admin RPC to mark an eligible offline pay-at-pickup order paid and set paid_at for manual payment tracking.';

comment on function public.mark_order_pay_at_pickup(uuid, text) is
'Trusted seller/admin RPC to correct a manually paid offline order back to unpaid without touching Stripe/provider state.';

comment on function public.seller_record_order_fulfillment(uuid, jsonb, text) is
'Trusted seller/admin RPC to record partial item-level fulfillment and complete the order when all non-restored quantities are fulfilled. Does not enqueue fulfillment email notifications.';

revoke all on function public.mark_order_paid(uuid, text) from public;
revoke all on function public.mark_order_pay_at_pickup(uuid, text) from public;
revoke all on function public.seller_record_order_fulfillment(uuid, jsonb, text) from public;

grant execute on function public.mark_order_paid(uuid, text) to authenticated;
grant execute on function public.mark_order_pay_at_pickup(uuid, text) to authenticated;
grant execute on function public.seller_record_order_fulfillment(uuid, jsonb, text) to authenticated;
