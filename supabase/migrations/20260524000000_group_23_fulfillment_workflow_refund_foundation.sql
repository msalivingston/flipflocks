-- Group 23: Fulfillment Workflow & Refund Foundation
--
-- Scope:
-- - Adds item-level fulfillment/restoration tracking to existing order_items.
-- - Adds a lightweight order_refunds table for V1 refund auditability.
-- - Extends trusted seller/admin RPCs for ready-for-pickup, partial
--   fulfillment, full fulfillment, cancellation/restoration, and refund
--   recording.
--
-- This group does not add:
-- - provider API calls
-- - Stripe webhook handling
-- - chargebacks/disputes
-- - store credits
-- - refund approval queues
-- - accounting exports
-- - customer messaging or marketplace mediation


alter table public.order_items
add column fulfilled_quantity integer not null default 0,
add column restored_quantity integer not null default 0;

alter table public.order_items
add constraint order_items_fulfilled_quantity_nonnegative_check check (
  fulfilled_quantity >= 0
),
add constraint order_items_restored_quantity_nonnegative_check check (
  restored_quantity >= 0
),
add constraint order_items_fulfilled_quantity_not_over_ordered_check check (
  fulfilled_quantity <= quantity
),
add constraint order_items_restored_quantity_not_over_ordered_check check (
  restored_quantity <= quantity
),
add constraint order_items_fulfilled_restored_not_over_ordered_check check (
  fulfilled_quantity + restored_quantity <= quantity
);

comment on column public.order_items.fulfilled_quantity is
'Quantity from this order line that has been fulfilled. Used for partial fulfillment without changing the historical ordered quantity snapshot.';

comment on column public.order_items.restored_quantity is
'Quantity from this order line that has been restored back to inventory after cancellation or correction. Prevents double-restoration.';

update public.order_items
set fulfilled_quantity = order_items.quantity
from public.orders
where orders.id = order_items.order_id
  and orders.store_id = order_items.store_id
  and orders.order_status = 'fulfilled';

update public.order_items
set restored_quantity = order_items.quantity
from public.orders
where orders.id = order_items.order_id
  and orders.store_id = order_items.store_id
  and orders.order_status = 'canceled';

create index if not exists order_items_order_fulfillment_idx
on public.order_items(order_id, fulfilled_quantity, restored_quantity);


alter table public.orders
add column ready_for_pickup_at timestamptz;

comment on column public.orders.ready_for_pickup_at is
'Timestamp set when a seller/admin marks an order ready for pickup. This is operational state, not a separate complex fulfillment workflow.';

create index if not exists orders_store_ready_for_pickup_idx
on public.orders(store_id, ready_for_pickup_at desc)
where ready_for_pickup_at is not null;


alter table public.orders
drop constraint if exists orders_payment_status_check;

alter table public.orders
add constraint orders_payment_status_check check (
  payment_status in (
    'unpaid',
    'pay_at_pickup',
    'paid',
    'canceled',
    'partially_refunded',
    'refunded'
  )
);


alter table public.order_events
drop constraint if exists order_events_event_type_check;

alter table public.order_events
add constraint order_events_event_type_check check (
  event_type in (
    'payment_marked_paid',
    'payment_marked_pay_at_pickup',
    'order_ready_for_pickup',
    'order_partially_fulfilled',
    'order_fulfilled',
    'order_canceled',
    'order_reinstated',
    'refund_recorded'
  )
);


create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,

  idempotency_key text not null,
  request_hash text not null,

  refund_amount numeric(10, 2) not null,
  refund_method text not null,
  refund_status text not null default 'succeeded',

  provider_refund_id text,
  provider_status text,

  reason text,
  note text,
  metadata jsonb not null default '{}'::jsonb,

  created_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,

  constraint order_refunds_store_order_idempotency_unique unique (
    store_id,
    order_id,
    idempotency_key
  ),

  constraint order_refunds_idempotency_key_not_empty_check check (
    length(trim(idempotency_key)) > 0
  ),

  constraint order_refunds_idempotency_key_length_check check (
    length(idempotency_key) <= 200
  ),

  constraint order_refunds_request_hash_not_empty_check check (
    length(trim(request_hash)) > 0
  ),

  constraint order_refunds_amount_positive_check check (
    refund_amount > 0
  ),

  constraint order_refunds_refund_method_check check (
    refund_method in (
      'stripe',
      'offline_cash',
      'offline_check',
      'offline_other'
    )
  ),

  constraint order_refunds_refund_status_check check (
    refund_status in (
      'pending',
      'succeeded',
      'failed',
      'canceled'
    )
  ),

  constraint order_refunds_provider_refund_id_not_empty_check check (
    provider_refund_id is null
    or length(trim(provider_refund_id)) > 0
  ),

  constraint order_refunds_provider_status_not_empty_check check (
    provider_status is null
    or length(trim(provider_status)) > 0
  ),

  constraint order_refunds_reason_not_empty_check check (
    reason is null
    or length(trim(reason)) > 0
  ),

  constraint order_refunds_note_not_empty_check check (
    note is null
    or length(trim(note)) > 0
  ),

  constraint order_refunds_metadata_object_check check (
    jsonb_typeof(metadata) = 'object'
  ),

  constraint order_refunds_succeeded_processed_at_check check (
    refund_status <> 'succeeded'
    or processed_at is not null
  )
);

comment on table public.order_refunds is
'Store-scoped refund audit records for V1 full and partial refunds. Provider calls happen outside Postgres; this table records the operational refund state and future provider identifiers.';

comment on column public.order_refunds.idempotency_key is
'Client/server supplied unique key for a refund record attempt, scoped to store and order. Prevents duplicate refund records during retries.';

comment on column public.order_refunds.request_hash is
'Hash of stable refund-affecting request inputs. Reusing an idempotency key with different refund details raises an error.';

comment on column public.order_refunds.refund_amount is
'Positive refund amount recorded for this refund event.';

comment on column public.order_refunds.refund_method is
'Refund rail or method. Stripe is provider-compatible; offline values support cash/check/manual refunds without provider integration.';

comment on column public.order_refunds.refund_status is
'Operational refund status. Only pending and succeeded refunds reserve refundable amount; only succeeded refunds update order payment status.';

comment on column public.order_refunds.provider_refund_id is
'Optional future provider refund identifier, such as a Stripe refund id.';

comment on column public.order_refunds.provider_status is
'Optional future provider-specific status snapshot.';

create index order_refunds_store_created_at_idx
on public.order_refunds(store_id, created_at desc);

create index order_refunds_order_created_at_idx
on public.order_refunds(order_id, created_at desc);

create index order_refunds_store_status_created_at_idx
on public.order_refunds(store_id, refund_status, created_at desc);

create index order_refunds_provider_refund_id_idx
on public.order_refunds(provider_refund_id)
where provider_refund_id is not null;

create trigger order_refunds_set_updated_at
before update on public.order_refunds
for each row
execute function public.set_updated_at();

alter table public.order_refunds enable row level security;

create policy "Store owners can read own order refunds"
on public.order_refunds
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Platform admins can delete order refunds"
on public.order_refunds
for delete
to authenticated
using (
  public.is_admin()
);


create or replace function public.seller_mark_order_ready_for_pickup(
  p_order_id uuid,
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
    raise exception 'Only pending or open orders can be marked ready for pickup.';
  end if;

  update public.orders
  set ready_for_pickup_at = coalesce(ready_for_pickup_at, now())
  where orders.id = v_order.id
  returning * into v_order;

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
    'order_ready_for_pickup',
    v_order.order_status,
    v_order.order_status,
    v_order.payment_status,
    v_order.payment_status,
    v_note
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
  v_store public.stores%rowtype;
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

  if v_event_type = 'order_fulfilled' then
    select *
    into v_store
    from public.stores
    where stores.id = v_order.store_id;

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
  end if;

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

  update public.orders
  set
    order_status = 'fulfilled',
    fulfilled_at = coalesce(fulfilled_at, now())
  where orders.id = v_order.id
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


create or replace function public.cancel_order(
  p_order_id uuid,
  p_canceled_reason text
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
  v_actor_type text;
  v_inventory_metadata jsonb;
  v_item record;
begin
  v_canceled_reason := nullif(trim(p_canceled_reason), '');

  if v_canceled_reason is null then
    raise exception 'Cancellation reason is required.';
  end if;

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
    inventory_item_id uuid not null,
    listing_batch_id uuid not null,
    listing_batch_breed_id uuid not null,
    quantity_to_restore integer not null,
    from_quantity_available integer not null
  ) on commit drop;

  insert into pg_temp.cancel_order_items (
    order_item_id,
    inventory_item_id,
    listing_batch_id,
    listing_batch_breed_id,
    quantity_to_restore,
    from_quantity_available
  )
  select
    order_items.id,
    order_items.inventory_item_id,
    order_items.listing_batch_id,
    order_items.listing_batch_breed_id,
    order_items.quantity - order_items.fulfilled_quantity - order_items.restored_quantity,
    inventory_items.quantity_available
  from public.order_items
  join public.inventory_items
    on inventory_items.id = order_items.inventory_item_id
   and inventory_items.store_id = v_order.store_id
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id
    and order_items.quantity - order_items.fulfilled_quantity - order_items.restored_quantity > 0
  order by inventory_items.id
  for update of inventory_items, order_items;

  update public.inventory_items
  set quantity_available = inventory_items.quantity_available + cancel_order_items.quantity_to_restore
  from pg_temp.cancel_order_items
  where inventory_items.id = cancel_order_items.inventory_item_id
    and inventory_items.store_id = v_order.store_id;

  update public.order_items
  set restored_quantity = order_items.restored_quantity + cancel_order_items.quantity_to_restore
  from pg_temp.cancel_order_items
  where order_items.id = cancel_order_items.order_item_id
    and order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id;

  for v_item in
    select *
    from pg_temp.cancel_order_items
    order by inventory_item_id
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
        'quantity_restored', v_item.quantity_to_restore
      )
    );
  end loop;

  select jsonb_build_object(
    'inventory_adjustments',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', cancel_order_items.order_item_id,
          'inventory_item_id', cancel_order_items.inventory_item_id,
          'quantity_restored', cancel_order_items.quantity_to_restore
        )
        order by cancel_order_items.inventory_item_id
      ),
      '[]'::jsonb
    )
  )
  into v_inventory_metadata
  from pg_temp.cancel_order_items;

  update public.orders
  set
    order_status = 'canceled',
    payment_status = v_to_payment_status,
    canceled_at = now(),
    canceled_reason = v_canceled_reason
  where orders.id = v_order.id
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
      'canceled_at', v_order.canceled_at
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


create or replace function public.reinstate_order(
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
  v_inventory_metadata jsonb;
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

  if v_order.order_status <> 'canceled' then
    raise exception 'Only canceled orders can be reinstated.';
  end if;

  if v_order.payment_method <> 'pay_at_pickup' then
    raise exception 'Only pay-at-pickup orders can be reinstated.';
  end if;

  if v_order.payment_status <> 'canceled' then
    raise exception 'Only unpaid canceled orders can be reinstated.';
  end if;

  if exists (
    select 1
    from public.order_items
    where order_items.order_id = v_order.id
      and order_items.store_id = v_order.store_id
      and (
        order_items.fulfilled_quantity <> 0
        or order_items.restored_quantity <> order_items.quantity
      )
  ) then
    raise exception 'Partially fulfilled or partially restored orders cannot be reinstated.';
  end if;

  drop table if exists pg_temp.reinstate_requested_items;
  drop table if exists pg_temp.reinstate_order_items;

  create temporary table pg_temp.reinstate_requested_items (
    inventory_item_id uuid primary key,
    quantity integer not null
  ) on commit drop;

  insert into pg_temp.reinstate_requested_items (
    inventory_item_id,
    quantity
  )
  select
    order_items.inventory_item_id,
    sum(order_items.quantity)::integer
  from public.order_items
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id
  group by order_items.inventory_item_id;

  create temporary table pg_temp.reinstate_order_items (
    inventory_item_id uuid primary key,
    quantity integer not null,
    quantity_available integer not null
  ) on commit drop;

  insert into pg_temp.reinstate_order_items (
    inventory_item_id,
    quantity,
    quantity_available
  )
  select
    inventory_items.id,
    reinstate_requested_items.quantity,
    inventory_items.quantity_available
  from pg_temp.reinstate_requested_items
  join public.inventory_items
    on inventory_items.id = reinstate_requested_items.inventory_item_id
   and inventory_items.store_id = v_order.store_id
  order by inventory_items.id
  for update of inventory_items;

  if (
    select count(*)
    from pg_temp.reinstate_order_items
  ) <> (
    select count(*)
    from pg_temp.reinstate_requested_items
  ) then
    raise exception 'Order inventory is no longer available for reinstatement.';
  end if;

  if exists (
    select 1
    from pg_temp.reinstate_order_items
    where quantity_available < quantity
  ) then
    raise exception 'Insufficient inventory quantity available to reinstate this order.';
  end if;

  update public.inventory_items
  set quantity_available = inventory_items.quantity_available - reinstate_order_items.quantity
  from pg_temp.reinstate_order_items
  where inventory_items.id = reinstate_order_items.inventory_item_id
    and inventory_items.store_id = v_order.store_id;

  update public.order_items
  set
    fulfilled_quantity = 0,
    restored_quantity = 0
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id;

  select jsonb_build_object(
    'inventory_adjustments',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'inventory_item_id', reinstate_order_items.inventory_item_id,
          'quantity_redecremented', reinstate_order_items.quantity
        )
        order by reinstate_order_items.inventory_item_id
      ),
      '[]'::jsonb
    )
  )
  into v_inventory_metadata
  from pg_temp.reinstate_order_items;

  update public.orders
  set
    order_status = 'open',
    payment_status = 'pay_at_pickup',
    canceled_at = null,
    canceled_reason = null,
    fulfilled_at = null
  where orders.id = v_order.id
  returning * into v_order;

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
    'order_reinstated',
    'canceled',
    'open',
    'canceled',
    'pay_at_pickup',
    v_note,
    v_inventory_metadata
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


create or replace function public.seller_record_refund(
  p_order_id uuid,
  p_idempotency_key text,
  p_refund_amount numeric,
  p_refund_method text,
  p_refund_status text default 'succeeded',
  p_provider_refund_id text default null,
  p_provider_status text default null,
  p_reason text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  refund_id uuid,
  order_id uuid,
  store_id uuid,
  refund_amount numeric(10, 2),
  refund_method text,
  refund_status text,
  payment_status text,
  refundable_amount_remaining numeric(10, 2),
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_refund public.order_refunds%rowtype;
  v_idempotency_key text;
  v_refund_amount numeric(10, 2);
  v_refund_method text;
  v_refund_status text;
  v_provider_refund_id text;
  v_provider_status text;
  v_reason text;
  v_note text;
  v_metadata jsonb;
  v_request_hash text;
  v_reserved_refund_total numeric(10, 2);
  v_succeeded_refund_total numeric(10, 2);
  v_from_payment_status text;
  v_new_payment_status text;
  v_actor_type text;
begin
  v_idempotency_key := nullif(trim(p_idempotency_key), '');
  v_refund_amount := p_refund_amount::numeric(10, 2);
  v_refund_method := nullif(trim(p_refund_method), '');
  v_refund_status := coalesce(nullif(trim(p_refund_status), ''), 'succeeded');
  v_provider_refund_id := nullif(trim(p_provider_refund_id), '');
  v_provider_status := nullif(trim(p_provider_status), '');
  v_reason := nullif(trim(p_reason), '');
  v_note := nullif(trim(p_note), '');
  v_metadata := coalesce(p_metadata, '{}'::jsonb);

  if v_idempotency_key is null then
    raise exception 'Refund idempotency key is required.';
  end if;

  if length(v_idempotency_key) > 200 then
    raise exception 'Refund idempotency key must be 200 characters or fewer.';
  end if;

  if v_refund_amount is null or v_refund_amount <= 0 then
    raise exception 'Refund amount must be greater than zero.';
  end if;

  if v_refund_method not in ('stripe', 'offline_cash', 'offline_check', 'offline_other') then
    raise exception 'Refund method is not supported.';
  end if;

  if v_refund_status not in ('pending', 'succeeded', 'failed', 'canceled') then
    raise exception 'Refund status is not supported.';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'Refund metadata must be a JSON object.';
  end if;

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

  if v_order.payment_status not in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'Only paid or previously refunded orders can receive refund records.';
  end if;

  v_from_payment_status := v_order.payment_status;

  v_request_hash := encode(
    digest(
      jsonb_build_object(
        'operation', 'seller_record_refund',
        'order_id', p_order_id,
        'refund_amount', v_refund_amount,
        'refund_method', v_refund_method,
        'refund_status', v_refund_status,
        'provider_refund_id', v_provider_refund_id,
        'provider_status', v_provider_status,
        'reason', v_reason,
        'note', v_note,
        'metadata', v_metadata
      )::text,
      'sha256'
    ),
    'hex'
  );

  select *
  into v_refund
  from public.order_refunds
  where order_refunds.store_id = v_order.store_id
    and order_refunds.order_id = v_order.id
    and order_refunds.idempotency_key = v_idempotency_key
  for update;

  if v_refund.id is not null then
    if v_refund.request_hash <> v_request_hash then
      raise exception 'Refund idempotency key was already used with different refund details.';
    end if;

    select coalesce(sum(order_refunds.refund_amount), 0)::numeric(10, 2)
    into v_reserved_refund_total
    from public.order_refunds
    where order_refunds.order_id = v_order.id
      and order_refunds.refund_status in ('pending', 'succeeded');

    return query
    select
      v_refund.id,
      v_refund.order_id,
      v_refund.store_id,
      v_refund.refund_amount,
      v_refund.refund_method,
      v_refund.refund_status,
      v_order.payment_status,
      greatest(v_order.total_amount - v_reserved_refund_total, 0)::numeric(10, 2),
      v_refund.created_at;

    return;
  end if;

  select coalesce(sum(order_refunds.refund_amount), 0)::numeric(10, 2)
  into v_reserved_refund_total
  from public.order_refunds
  where order_refunds.order_id = v_order.id
    and order_refunds.refund_status in ('pending', 'succeeded');

  if v_refund_amount > v_order.total_amount then
    raise exception 'Refund amount exceeds order total.';
  end if;

  if v_refund_status in ('pending', 'succeeded')
    and v_reserved_refund_total + v_refund_amount > v_order.total_amount then
    raise exception 'Refund amount exceeds remaining refundable amount.';
  end if;

  insert into public.order_refunds (
    store_id,
    order_id,
    idempotency_key,
    request_hash,
    refund_amount,
    refund_method,
    refund_status,
    provider_refund_id,
    provider_status,
    reason,
    note,
    metadata,
    created_by_user_id,
    processed_at
  )
  values (
    v_order.store_id,
    v_order.id,
    v_idempotency_key,
    v_request_hash,
    v_refund_amount,
    v_refund_method,
    v_refund_status,
    v_provider_refund_id,
    v_provider_status,
    v_reason,
    v_note,
    v_metadata,
    auth.uid(),
    case when v_refund_status = 'succeeded' then now() else null end
  )
  returning * into v_refund;

  select coalesce(sum(order_refunds.refund_amount), 0)::numeric(10, 2)
  into v_reserved_refund_total
  from public.order_refunds
  where order_refunds.order_id = v_order.id
    and order_refunds.refund_status in ('pending', 'succeeded');

  select coalesce(sum(order_refunds.refund_amount), 0)::numeric(10, 2)
  into v_succeeded_refund_total
  from public.order_refunds
  where order_refunds.order_id = v_order.id
    and order_refunds.refund_status = 'succeeded';

  if v_succeeded_refund_total >= v_order.total_amount then
    v_new_payment_status := 'refunded';
  elsif v_succeeded_refund_total > 0 then
    v_new_payment_status := 'partially_refunded';
  else
    v_new_payment_status := v_order.payment_status;
  end if;

  if v_new_payment_status <> v_order.payment_status then
    update public.orders
    set payment_status = v_new_payment_status
    where orders.id = v_order.id
    returning * into v_order;
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
    'refund_recorded',
    v_order.order_status,
    v_order.order_status,
    v_from_payment_status,
    v_new_payment_status,
    v_note,
    jsonb_build_object(
      'refund_id', v_refund.id,
      'refund_amount', v_refund.refund_amount,
      'refund_method', v_refund.refund_method,
      'refund_status', v_refund.refund_status,
      'provider_refund_id', v_refund.provider_refund_id,
      'reason', v_refund.reason
    )
  );

  return query
  select
    v_refund.id,
    v_refund.order_id,
    v_refund.store_id,
    v_refund.refund_amount,
    v_refund.refund_method,
    v_refund.refund_status,
    v_order.payment_status,
    greatest(v_order.total_amount - v_reserved_refund_total, 0)::numeric(10, 2),
    v_refund.created_at;
end;
$$;


comment on function public.seller_mark_order_ready_for_pickup(uuid, text) is
'Trusted seller/admin RPC to mark an eligible order ready for pickup without adding a new order status.';

comment on function public.seller_record_order_fulfillment(uuid, jsonb, text) is
'Trusted seller/admin RPC to record partial item-level fulfillment and complete the order when all non-restored quantities are fulfilled.';

comment on function public.mark_order_fulfilled(uuid, text) is
'Trusted seller/admin RPC to mark a pending or open order fulfilled, set all unrestored line quantities fulfilled, and enqueue the buyer fulfilled transactional email.';

comment on function public.cancel_order(uuid, text) is
'Trusted seller/admin RPC to cancel an eligible pending/open order, restore only unfulfilled and unrestored inventory quantities, preserve paid/refunded payment state, and enqueue the buyer canceled transactional email.';

comment on function public.reinstate_order(uuid, text) is
'Trusted seller/admin RPC to reinstate simple unpaid canceled pay-at-pickup orders after validating and re-decrementing inventory, while resetting item restoration tracking.';

comment on function public.seller_record_refund(uuid, text, numeric, text, text, text, text, text, text, jsonb) is
'Trusted seller/admin RPC to record idempotent full or partial refunds without calling a payment provider. Pending and succeeded refunds reserve refundable amount; succeeded refunds update order payment status.';

revoke all on function public.seller_mark_order_ready_for_pickup(uuid, text) from public;
revoke all on function public.seller_record_order_fulfillment(uuid, jsonb, text) from public;
revoke all on function public.mark_order_fulfilled(uuid, text) from public;
revoke all on function public.cancel_order(uuid, text) from public;
revoke all on function public.reinstate_order(uuid, text) from public;
revoke all on function public.seller_record_refund(uuid, text, numeric, text, text, text, text, text, text, jsonb) from public;

grant execute on function public.seller_mark_order_ready_for_pickup(uuid, text) to authenticated;
grant execute on function public.seller_record_order_fulfillment(uuid, jsonb, text) to authenticated;
grant execute on function public.mark_order_fulfilled(uuid, text) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
grant execute on function public.reinstate_order(uuid, text) to authenticated;
grant execute on function public.seller_record_refund(uuid, text, numeric, text, text, text, text, text, text, jsonb) to authenticated;
