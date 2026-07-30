begin;

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
  set fulfilled_quantity = quantity - restored_quantity
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

commit;
