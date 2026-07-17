-- Corrective migration for V1 optional cancellation emails.
-- Replaces the deployed cancel_order RPC so the UI can distinguish
-- cancellation success from optional email enqueue success.

drop function if exists public.cancel_order(uuid, text, boolean, boolean);

create function public.cancel_order(
  p_order_id uuid,
  p_canceled_reason text,
  p_restore_inventory boolean default false,
  p_send_buyer_notification boolean default false
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  order_status text,
  payment_status text,
  fulfilled_at timestamptz,
  canceled_at timestamptz,
  updated_at timestamptz,
  buyer_notification_queued boolean,
  seller_copy_queued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_from_order_status text;
  v_from_payment_status text;
  v_to_payment_status text;
  v_canceled_reason text;
  v_restore_inventory boolean;
  v_send_buyer_notification boolean;
  v_actor_type text;
  v_inventory_metadata jsonb;
  v_item record;
  v_cancellation_action_id text;
  v_buyer_cancellation_queued boolean := false;
  v_seller_cancellation_queued boolean := false;
begin
  v_canceled_reason := nullif(trim(p_canceled_reason), '');
  v_restore_inventory := coalesce(p_restore_inventory, false);
  v_send_buyer_notification := coalesce(p_send_buyer_notification, false);

  select o.*
  into v_order
  from public.orders as o
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if not (public.owns_store(v_order.store_id) or public.is_admin()) then
    raise exception 'Order is not available.';
  end if;

  if v_order.order_status not in ('pending', 'open') then
    raise exception 'Only pending or open orders can be canceled.';
  end if;

  v_from_order_status := v_order.order_status;
  v_from_payment_status := v_order.payment_status;
  v_to_payment_status := case
    when v_order.payment_status in ('unpaid', 'pay_at_pickup') then 'canceled'
    else v_order.payment_status
  end;

  drop table if exists pg_temp.cancel_order_items;

  create temporary table pg_temp.cancel_order_items (
    order_item_id uuid primary key,
    item_type text not null,
    inventory_item_id uuid,
    equipment_inventory_item_id uuid,
    processed_poultry_inventory_item_id uuid,
    listing_batch_id uuid,
    listing_batch_breed_id uuid,
    quantity_to_restore integer not null,
    from_quantity_available integer not null
  ) on commit drop;

  if v_restore_inventory then
    insert into pg_temp.cancel_order_items (
      order_item_id,
      item_type,
      inventory_item_id,
      listing_batch_id,
      listing_batch_breed_id,
      quantity_to_restore,
      from_quantity_available
    )
    select
      oi.id,
      'listing_inventory',
      oi.inventory_item_id,
      oi.listing_batch_id,
      oi.listing_batch_breed_id,
      oi.quantity - oi.fulfilled_quantity - oi.restored_quantity,
      ii.quantity_available
    from public.order_items as oi
    join public.inventory_items as ii
      on ii.id = oi.inventory_item_id
     and ii.store_id = v_order.store_id
    where oi.order_id = v_order.id
      and oi.store_id = v_order.store_id
      and coalesce(oi.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
      and oi.inventory_item_id is not null
      and oi.quantity - oi.fulfilled_quantity - oi.restored_quantity > 0
    order by ii.id
    for update of ii, oi;

    insert into pg_temp.cancel_order_items (
      order_item_id,
      item_type,
      equipment_inventory_item_id,
      quantity_to_restore,
      from_quantity_available
    )
    select
      oi.id,
      'equipment_inventory',
      oi.equipment_inventory_item_id,
      oi.quantity - oi.fulfilled_quantity - oi.restored_quantity,
      ei.quantity_available
    from public.order_items as oi
    join public.equipment_inventory_items as ei
      on ei.id = oi.equipment_inventory_item_id
     and ei.store_id = v_order.store_id
    where oi.order_id = v_order.id
      and oi.store_id = v_order.store_id
      and oi.order_item_source = 'equipment_inventory'
      and oi.equipment_inventory_item_id is not null
      and oi.quantity - oi.fulfilled_quantity - oi.restored_quantity > 0
    order by ei.id
    for update of ei, oi;

    insert into pg_temp.cancel_order_items (
      order_item_id,
      item_type,
      processed_poultry_inventory_item_id,
      quantity_to_restore,
      from_quantity_available
    )
    select
      oi.id,
      'processed_poultry_inventory',
      oi.processed_poultry_inventory_item_id,
      oi.quantity - oi.fulfilled_quantity - oi.restored_quantity,
      ppi.quantity_available
    from public.order_items as oi
    join public.processed_poultry_inventory_items as ppi
      on ppi.id = oi.processed_poultry_inventory_item_id
     and ppi.store_id = v_order.store_id
    where oi.order_id = v_order.id
      and oi.store_id = v_order.store_id
      and oi.order_item_source = 'processed_poultry_inventory'
      and oi.processed_poultry_inventory_item_id is not null
      and oi.quantity - oi.fulfilled_quantity - oi.restored_quantity > 0
    order by ppi.id
    for update of ppi, oi;

    update public.inventory_items as ii
    set quantity_available = ii.quantity_available + coi.quantity_to_restore
    from pg_temp.cancel_order_items as coi
    where coi.item_type = 'listing_inventory'
      and ii.id = coi.inventory_item_id
      and ii.store_id = v_order.store_id;

    update public.equipment_inventory_items as ei
    set quantity_available = ei.quantity_available + coi.quantity_to_restore
    from pg_temp.cancel_order_items as coi
    where coi.item_type = 'equipment_inventory'
      and ei.id = coi.equipment_inventory_item_id
      and ei.store_id = v_order.store_id;

    update public.processed_poultry_inventory_items as ppi
    set quantity_available = ppi.quantity_available + coi.quantity_to_restore
    from pg_temp.cancel_order_items as coi
    where coi.item_type = 'processed_poultry_inventory'
      and ppi.id = coi.processed_poultry_inventory_item_id
      and ppi.store_id = v_order.store_id;

    update public.order_items as oi
    set restored_quantity = oi.restored_quantity + coi.quantity_to_restore
    from pg_temp.cancel_order_items as coi
    where oi.id = coi.order_item_id
      and oi.order_id = v_order.id
      and oi.store_id = v_order.store_id;

    for v_item in
      select coi.*
      from pg_temp.cancel_order_items as coi
      where coi.item_type = 'listing_inventory'
      order by coi.inventory_item_id
    loop
      perform public.log_inventory_activity_event(
        v_order.store_id,
        v_item.listing_batch_id,
        v_item.listing_batch_breed_id,
        v_item.inventory_item_id,
        'inventory_quantity_adjusted',
        v_item.from_quantity_available,
        v_item.from_quantity_available + v_item.quantity_to_restore,
        null,
        null,
        'Canceled order inventory restoration',
        jsonb_build_object(
          'order_id', v_order.id,
          'order_number', v_order.order_number,
          'order_item_id', v_item.order_item_id,
          'quantity_restored', v_item.quantity_to_restore,
          'restore_inventory_requested', true
        )
      );
    end loop;
  end if;

  select jsonb_build_object(
    'restore_inventory_requested', v_restore_inventory,
    'inventory_adjustments',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', coi.order_item_id,
          'item_type', coi.item_type,
          'inventory_item_id', coi.inventory_item_id,
          'equipment_inventory_item_id', coi.equipment_inventory_item_id,
          'processed_poultry_inventory_item_id', coi.processed_poultry_inventory_item_id,
          'quantity_restored', coi.quantity_to_restore
        )
        order by coi.item_type, coi.order_item_id
      ) filter (where coi.order_item_id is not null),
      '[]'::jsonb
    )
  )
  into v_inventory_metadata
  from pg_temp.cancel_order_items as coi;

  update public.orders as o
  set
    order_status = 'canceled',
    payment_status = v_to_payment_status,
    canceled_at = now(),
    canceled_reason = v_canceled_reason
  where o.id = v_order.id
  returning o.* into v_order;

  select s.*
  into v_store
  from public.stores as s
  where s.id = v_order.store_id;

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
    'order_canceled',
    v_from_order_status,
    'canceled',
    v_from_payment_status,
    v_to_payment_status,
    v_canceled_reason,
    v_inventory_metadata
  );

  if v_send_buyer_notification and nullif(trim(coalesce(v_order.buyer_email_snapshot, '')), '') is not null then
    v_cancellation_action_id := gen_random_uuid()::text;

    begin
      perform public.enqueue_email_notification(
        v_order.store_id,
        v_order.id,
        'buyer_order_canceled',
        'buyer',
        v_order.buyer_email_snapshot,
        'Order canceled: ' || v_order.order_number,
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
          'canceled_at', v_order.canceled_at,
          'canceled_reason', v_order.canceled_reason,
          'email_action_id', v_cancellation_action_id
        ),
        v_cancellation_action_id
      );

      select exists (
        select 1
        from public.email_notifications
        where email_notifications.store_id = v_order.store_id
          and email_notifications.order_id = v_order.id
          and email_notifications.notification_type = 'buyer_order_canceled'
          and email_notifications.recipient_type = 'buyer'
          and email_notifications.dedupe_key =
            'buyer_order_canceled:order:' || v_order.id::text || ':action:' || v_cancellation_action_id
      )
      into v_buyer_cancellation_queued;
    exception
      when others then
        v_buyer_cancellation_queued := false;
    end;

    if v_buyer_cancellation_queued then
      begin
        perform public.enqueue_email_notification(
          v_order.store_id,
          v_order.id,
          'seller_order_canceled_copy',
          'seller',
          v_store.order_notification_email,
          'Customer copy: Canceled order #' || v_order.order_number,
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
            'canceled_at', v_order.canceled_at,
            'canceled_reason', v_order.canceled_reason,
            'email_action_id', v_cancellation_action_id
          ),
          v_cancellation_action_id
        );

        select exists (
          select 1
          from public.email_notifications
          where email_notifications.store_id = v_order.store_id
            and email_notifications.order_id = v_order.id
            and email_notifications.notification_type = 'seller_order_canceled_copy'
            and email_notifications.recipient_type = 'seller'
            and email_notifications.dedupe_key =
              'seller_order_canceled_copy:order:' || v_order.id::text || ':action:' || v_cancellation_action_id
        )
        into v_seller_cancellation_queued;
      exception
        when others then
          v_seller_cancellation_queued := false;
      end;
    end if;
  end if;

  return query
  select
    o.id,
    o.order_number,
    o.store_id,
    o.order_status,
    o.payment_status,
    o.fulfilled_at,
    o.canceled_at,
    o.updated_at,
    v_buyer_cancellation_queued,
    v_seller_cancellation_queued
  from public.orders as o
  where o.id = v_order.id;
end;
$$;

comment on function public.cancel_order(uuid, text, boolean, boolean) is
'Trusted seller/admin RPC to cancel an eligible order, optionally restore inventory, and optionally enqueue V1 buyer cancellation and seller-copy email notifications. Returns optional email queue results.';

revoke all on function public.cancel_order(uuid, text, boolean, boolean) from public;
grant execute on function public.cancel_order(uuid, text, boolean, boolean) to authenticated, service_role;
