-- Complete V1 order-email notification plumbing.
-- This migration is intended to be deployed immediately before the matching
-- Postmark worker update that can render all V1 notification types.

do $$
declare
  v_migration_started_at timestamptz := statement_timestamp();
begin
  update public.email_notifications
  set
    notification_status = 'failed',
    attempt_count = greatest(email_notifications.attempt_count, 5),
    next_attempt_at = 'infinity'::timestamptz,
    processing_started_at = null,
    processing_token = null,
    last_error = 'Suppressed: historical pending cancellation notification predates V1 email rollout'
  where email_notifications.notification_type = 'buyer_order_canceled'
    and email_notifications.notification_status = 'pending'
    and email_notifications.created_at < v_migration_started_at;
end;
$$;

alter table public.email_notifications
drop constraint if exists email_notifications_notification_type_check;

alter table public.email_notifications
add constraint email_notifications_notification_type_check check (
  notification_type in (
    'buyer_order_confirmation',
    'seller_new_order',
    'buyer_order_updated',
    'seller_order_updated_copy',
    'buyer_order_canceled',
    'seller_order_canceled_copy',
    -- Retained for backward compatibility with historical fulfillment callers.
    -- The enqueue helper continues to no-op this type, and the Phase 1
    -- Postmark claim RPC does not claim it.
    'buyer_order_fulfilled'
  )
);

create or replace function public.enqueue_email_notification(
  p_store_id uuid,
  p_order_id uuid,
  p_notification_type text,
  p_recipient_type text,
  p_recipient_email text,
  p_subject_snapshot text,
  p_payload jsonb,
  p_dedupe_suffix text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification_type text;
  v_recipient_email text;
  v_dedupe_key text;
  v_dedupe_suffix text;
  v_payload jsonb;
begin
  v_notification_type := case nullif(trim(coalesce(p_notification_type, '')), '')
    when 'buyer_order_received' then 'buyer_order_confirmation'
    when 'seller_new_order_received' then 'seller_new_order'
    else nullif(trim(coalesce(p_notification_type, '')), '')
  end;

  -- Fulfilled is internal seller tracking only. Keep old fulfillment callers
  -- from blocking order actions, but do not enqueue a fulfillment email.
  if v_notification_type = 'buyer_order_fulfilled' then
    return;
  end if;

  v_recipient_email := lower(nullif(trim(p_recipient_email), ''));
  v_dedupe_suffix := nullif(trim(coalesce(p_dedupe_suffix, '')), '');
  v_payload := coalesce(p_payload, '{}'::jsonb);

  if p_store_id is null then
    raise exception 'Store is required to enqueue email notification.';
  end if;

  if p_order_id is null then
    raise exception 'Order is required to enqueue email notification.';
  end if;

  if not exists (
    select 1
    from public.orders
    where orders.id = p_order_id
      and orders.store_id = p_store_id
  ) then
    raise exception 'Order does not belong to store.';
  end if;

  if v_notification_type is null
    or v_notification_type not in (
      'buyer_order_confirmation',
      'seller_new_order',
      'buyer_order_updated',
      'seller_order_updated_copy',
      'buyer_order_canceled',
      'seller_order_canceled_copy'
    ) then
    raise exception 'Invalid email notification type.';
  end if;

  if p_recipient_type is null
    or p_recipient_type not in ('buyer', 'seller') then
    raise exception 'Invalid email notification recipient type.';
  end if;

  if v_notification_type in (
      'buyer_order_confirmation',
      'buyer_order_updated',
      'buyer_order_canceled'
    )
    and p_recipient_type <> 'buyer' then
    raise exception 'Buyer notification type requires buyer recipient type.';
  end if;

  if v_notification_type in (
      'seller_new_order',
      'seller_order_updated_copy',
      'seller_order_canceled_copy'
    )
    and p_recipient_type <> 'seller' then
    raise exception 'Seller notification type requires seller recipient type.';
  end if;

  if v_notification_type in (
      'buyer_order_updated',
      'seller_order_updated_copy',
      'seller_order_canceled_copy'
    )
    and v_dedupe_suffix is null then
    raise exception 'Email notification action identifier is required.';
  end if;

  if v_dedupe_suffix is not null and length(v_dedupe_suffix) > 160 then
    raise exception 'Email notification action identifier is too long.';
  end if;

  if p_recipient_type = 'seller'
    and v_notification_type in (
      'seller_new_order',
      'seller_order_updated_copy',
      'seller_order_canceled_copy'
    )
    and v_recipient_email is null then
    select lower(nullif(trim(coalesce(
      stores.order_notification_email,
      stores.communication_email,
      stores.public_email
    )), ''))
    into v_recipient_email
    from public.stores
    where stores.id = p_store_id;
  end if;

  if v_recipient_email is null then
    return;
  end if;

  if p_subject_snapshot is null
    or length(trim(p_subject_snapshot)) = 0 then
    raise exception 'Email notification subject is required.';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'Email notification payload must be a JSON object.';
  end if;

  v_dedupe_key := v_notification_type || ':order:' || p_order_id::text ||
    case
      when v_dedupe_suffix is null then ''
      else ':action:' || v_dedupe_suffix
    end;

  insert into public.email_notifications (
    store_id,
    order_id,
    dedupe_key,
    recipient_type,
    recipient_email,
    notification_type,
    notification_status,
    subject_snapshot,
    payload
  )
  values (
    p_store_id,
    p_order_id,
    v_dedupe_key,
    p_recipient_type,
    v_recipient_email,
    v_notification_type,
    'pending',
    trim(p_subject_snapshot),
    v_payload
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

create or replace function public.enqueue_email_notification(
  p_store_id uuid,
  p_order_id uuid,
  p_notification_type text,
  p_recipient_type text,
  p_recipient_email text,
  p_subject_snapshot text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_email_notification(
    p_store_id,
    p_order_id,
    p_notification_type,
    p_recipient_type,
    p_recipient_email,
    p_subject_snapshot,
    p_payload,
    null
  );
end;
$$;

comment on function public.enqueue_email_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text
) is
'Trusted provider-agnostic helper for enqueueing V1 transactional order email notifications. The optional action identifier suffix allows repeatable update/cancellation actions while keeping retries idempotent.';

comment on function public.enqueue_email_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb
) is
'Backward-compatible wrapper for enqueueing transactional order email notifications without an action identifier. Confirmation and seller new-order notifications remain idempotent per order.';

revoke all on function public.enqueue_email_notification(uuid, uuid, text, text, text, text, jsonb, text) from public;
grant execute on function public.enqueue_email_notification(uuid, uuid, text, text, text, text, jsonb, text) to authenticated, service_role;

revoke all on function public.enqueue_email_notification(uuid, uuid, text, text, text, text, jsonb) from public;
grant execute on function public.enqueue_email_notification(uuid, uuid, text, text, text, text, jsonb) to authenticated, service_role;

create or replace function public.claim_phase_1_postmark_email_notifications(
  p_batch_size integer default 10,
  p_max_attempts integer default 5,
  p_stale_after interval default interval '15 minutes'
)
returns table (
  notification_id uuid,
  processing_token uuid,
  store_id uuid,
  order_id uuid,
  dedupe_key text,
  recipient_type text,
  recipient_email text,
  notification_type text,
  subject_snapshot text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if p_batch_size is null
    or p_batch_size < 1
    or p_batch_size > 100 then
    raise exception 'Batch size must be between 1 and 100.';
  end if;

  if p_max_attempts is null
    or p_max_attempts < 1 then
    raise exception 'Max attempts must be at least 1.';
  end if;

  if p_stale_after is null
    or p_stale_after <= interval '0 seconds' then
    raise exception 'Stale processing interval must be positive.';
  end if;

  return query
  with claimable as (
    select email_notifications.id
    from public.email_notifications
    where email_notifications.notification_type in (
        'buyer_order_confirmation',
        'seller_new_order',
        'buyer_order_updated',
        'seller_order_updated_copy',
        'buyer_order_canceled',
        'seller_order_canceled_copy'
      )
      and (
        (
          email_notifications.notification_status in ('pending', 'failed')
          and email_notifications.next_attempt_at <= now()
          and email_notifications.attempt_count < p_max_attempts
        )
        or (
          email_notifications.notification_status = 'processing'
          and email_notifications.processing_started_at <= now() - p_stale_after
          and email_notifications.attempt_count < p_max_attempts
        )
      )
    order by email_notifications.next_attempt_at, email_notifications.created_at
    limit p_batch_size
    for update skip locked
  ),
  claimed as (
    update public.email_notifications
    set
      notification_status = 'processing',
      attempt_count = email_notifications.attempt_count + 1,
      last_attempt_at = now(),
      processing_started_at = now(),
      processing_token = gen_random_uuid()
    from claimable
    where email_notifications.id = claimable.id
    returning
      email_notifications.id,
      email_notifications.processing_token,
      email_notifications.store_id,
      email_notifications.order_id,
      email_notifications.dedupe_key,
      email_notifications.recipient_type,
      email_notifications.recipient_email,
      email_notifications.notification_type,
      email_notifications.subject_snapshot,
      email_notifications.payload,
      email_notifications.attempt_count
  )
  select
    claimed.id,
    claimed.processing_token,
    claimed.store_id,
    claimed.order_id,
    claimed.dedupe_key,
    claimed.recipient_type,
    claimed.recipient_email,
    claimed.notification_type,
    claimed.subject_snapshot,
    claimed.payload,
    claimed.attempt_count
  from claimed
  order by claimed.attempt_count, claimed.id;
end;
$$;

comment on function public.claim_phase_1_postmark_email_notifications(integer, integer, interval) is
'Phase 1 Postmark worker RPC that atomically claims only supported V1 order email notifications. buyer_order_fulfilled remains excluded.';

revoke all on function public.claim_phase_1_postmark_email_notifications(integer, integer, interval) from public;
grant execute on function public.claim_phase_1_postmark_email_notifications(integer, integer, interval) to authenticated, service_role;

drop function if exists public.cancel_order(uuid, text, boolean);

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

    if v_buyer_cancellation_queued then
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
    o.updated_at
  from public.orders as o
  where o.id = v_order.id;
end;
$$;

comment on function public.cancel_order(uuid, text, boolean, boolean) is
'Trusted seller/admin RPC to cancel an eligible order, optionally restore inventory, and optionally enqueue V1 buyer cancellation and seller-copy email notifications.';

revoke all on function public.cancel_order(uuid, text, boolean, boolean) from public;
grant execute on function public.cancel_order(uuid, text, boolean, boolean) to authenticated, service_role;
