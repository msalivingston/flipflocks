-- Add a seller-authorized action to reopen a fulfilled order without touching
-- payment, inventory, totals, pickup, or delivery data.

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
    'refund_recorded',
    'order_edited'
  )
);

create or replace function public.seller_mark_order_unfulfilled(
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
  v_previous_fulfilled_at timestamptz;
  v_reset_items jsonb;
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

  if v_order.order_status = 'canceled' then
    raise exception 'Canceled orders cannot be marked unfulfilled.';
  end if;

  if v_order.order_status <> 'fulfilled' then
    raise exception 'Only fulfilled orders can be marked unfulfilled.';
  end if;

  v_previous_fulfilled_at := v_order.fulfilled_at;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_item_id', order_item.id,
        'fulfilled_quantity_reset', order_item.fulfilled_quantity
      )
      order by order_item.id
    ),
    '[]'::jsonb
  )
  into v_reset_items
  from public.order_items as order_item
  where order_item.order_id = v_order.id
    and order_item.store_id = v_order.store_id
    and order_item.fulfilled_quantity <> 0;

  update public.order_items as order_item
  set fulfilled_quantity = 0
  where order_item.order_id = v_order.id
    and order_item.store_id = v_order.store_id
    and order_item.fulfilled_quantity <> 0;

  update public.orders as target_order
  set
    order_status = 'open',
    fulfilled_at = null
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
    'order_unfulfilled',
    'fulfilled',
    'open',
    v_order.payment_status,
    v_order.payment_status,
    v_note,
    jsonb_build_object(
      'previous_fulfilled_at', v_previous_fulfilled_at,
      'reset_items', v_reset_items
    )
  );

  return query
  select
    final_order.id,
    final_order.order_number,
    final_order.store_id,
    final_order.order_status,
    final_order.payment_status,
    final_order.fulfilled_at,
    final_order.canceled_at,
    final_order.updated_at
  from public.orders as final_order
  where final_order.id = v_order.id;
end;
$$;

comment on function public.seller_mark_order_unfulfilled(uuid, text) is
'Trusted seller/admin RPC to reopen a fulfilled order by clearing order/item fulfillment state without changing payment, inventory, totals, pickup, or delivery data.';

revoke all on function public.seller_mark_order_unfulfilled(uuid, text) from public;
grant execute on function public.seller_mark_order_unfulfilled(uuid, text) to authenticated;
