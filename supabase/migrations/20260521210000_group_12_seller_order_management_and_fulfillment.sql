-- Group 12: Seller Order Management and Fulfillment Foundation
-- Objects:
-- - order_events
-- - seller order management RPCs
--
-- Scope:
-- - Adds simple append-only order event auditing.
-- - Adds trusted seller/admin RPCs for:
--   - Mark Paid
--   - Mark Unpaid
--   - Mark Fulfilled
--   - Cancel Order
--   - Reinstate Order
-- - Restores inventory on eligible cancellation.
-- - Re-decrements inventory on eligible reinstatement.
-- - Does not add pickup_status or picked_up_at.
-- - Does not create refunds, Stripe workflows, partial fulfillment,
--   order item editing, customer self-service, reporting views,
--   or admin correction tooling.


create table public.order_events (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,

  actor_user_id uuid references auth.users(id),
  actor_type text not null,
  event_type text not null,

  from_order_status text,
  to_order_status text,
  from_payment_status text,
  to_payment_status text,

  note text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint order_events_actor_type_check check (
    actor_type in ('seller', 'admin', 'system')
  ),

  constraint order_events_event_type_check check (
    event_type in (
      'payment_marked_paid',
      'payment_marked_pay_at_pickup',
      'order_fulfilled',
      'order_canceled',
      'order_reinstated'
    )
  ),

  constraint order_events_note_not_empty_check check (
    note is null
    or length(trim(note)) > 0
  ),

  constraint order_events_metadata_object_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

comment on table public.order_events is
'Append-only seller/admin order event log for auditability, troubleshooting, and inventory restoration tracking. Events are written by trusted order management RPCs.';

comment on column public.order_events.store_id is
'Tenant ownership field used for RLS and seller/admin access checks.';

comment on column public.order_events.order_id is
'Order associated with this event.';

comment on column public.order_events.actor_user_id is
'Authenticated user who caused the event when available.';

comment on column public.order_events.actor_type is
'Actor category for the event: seller, admin, or system.';

comment on column public.order_events.event_type is
'Simple event type describing the trusted order management action.';

comment on column public.order_events.from_order_status is
'Order status before the event when relevant.';

comment on column public.order_events.to_order_status is
'Order status after the event when relevant.';

comment on column public.order_events.from_payment_status is
'Payment status before the event when relevant.';

comment on column public.order_events.to_payment_status is
'Payment status after the event when relevant.';

comment on column public.order_events.note is
'Optional seller/admin note for the event.';

comment on column public.order_events.metadata is
'Small JSON object for event-specific details such as inventory quantities restored or re-decremented. Keep simple; not intended as a workflow engine.';


create index order_events_store_created_at_idx
on public.order_events(store_id, created_at desc);

create index order_events_order_created_at_idx
on public.order_events(order_id, created_at desc);

create index order_events_store_order_created_at_idx
on public.order_events(store_id, order_id, created_at desc);


alter table public.order_events enable row level security;


create policy "Store owners can read own order events"
on public.order_events
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);


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

  if v_order.payment_method <> 'pay_at_pickup' then
    raise exception 'Payment correction is only available for pay-at-pickup orders.';
  end if;

  if v_order.order_status not in ('pending', 'open', 'fulfilled') then
    raise exception 'Only pending, open, or fulfilled orders can be marked paid.';
  end if;

  if v_order.payment_status <> 'pay_at_pickup' then
    raise exception 'Only pay-at-pickup orders can be marked paid.';
  end if;

  update public.orders
  set payment_status = 'paid'
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
    'pay_at_pickup',
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

  if v_order.payment_method <> 'pay_at_pickup' then
    raise exception 'Payment correction is only available for pay-at-pickup orders.';
  end if;

  if v_order.order_status not in ('pending', 'open', 'fulfilled') then
    raise exception 'Only pending, open, or fulfilled orders can be marked unpaid.';
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'Only paid pay-at-pickup orders can be marked unpaid.';
  end if;

  update public.orders
  set payment_status = 'pay_at_pickup'
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
    'pay_at_pickup',
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
    raise exception 'Order not found.';
  end if;

  if not (
    public.owns_store(v_order.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to manage this order.';
  end if;

  if v_order.order_status not in ('pending', 'open') then
    raise exception 'Only pending or open orders can be marked fulfilled.';
  end if;

  v_from_order_status := v_order.order_status;

  update public.orders
  set
    order_status = 'fulfilled',
    fulfilled_at = now()
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
    'order_fulfilled',
    v_from_order_status,
    'fulfilled',
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
  v_from_order_status text;
  v_from_payment_status text;
  v_canceled_reason text;
  v_actor_type text;
  v_inventory_metadata jsonb;
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
    raise exception 'Order not found.';
  end if;

  if not (
    public.owns_store(v_order.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to manage this order.';
  end if;

  if v_order.order_status not in ('pending', 'open') then
    raise exception 'Only pending or open orders can be canceled.';
  end if;

  if v_order.payment_status = 'paid' then
    raise exception 'Paid orders cannot be canceled. Mark the order unpaid before canceling.';
  end if;

  v_from_order_status := v_order.order_status;
  v_from_payment_status := v_order.payment_status;

  create temporary table pg_temp.cancel_order_items (
    inventory_item_id uuid primary key,
    quantity integer not null
  ) on commit drop;

  insert into pg_temp.cancel_order_items (
    inventory_item_id,
    quantity
  )
  select
    order_items.inventory_item_id,
    sum(order_items.quantity)::integer
  from public.order_items
  where order_items.order_id = v_order.id
  group by order_items.inventory_item_id;

  perform 1
  from public.inventory_items
  join pg_temp.cancel_order_items
    on cancel_order_items.inventory_item_id = inventory_items.id
  order by inventory_items.id
  for update of inventory_items;

  update public.inventory_items
  set quantity_available = inventory_items.quantity_available + cancel_order_items.quantity
  from pg_temp.cancel_order_items
  where inventory_items.id = cancel_order_items.inventory_item_id;

  select jsonb_build_object(
    'inventory_adjustments',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'inventory_item_id', cancel_order_items.inventory_item_id,
          'quantity_restored', cancel_order_items.quantity
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
    payment_status = 'canceled',
    canceled_at = now(),
    canceled_reason = v_canceled_reason
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
    'canceled',
    v_canceled_reason,
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
    raise exception 'Order not found.';
  end if;

  if not (
    public.owns_store(v_order.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to manage this order.';
  end if;

  if v_order.order_status <> 'canceled' then
    raise exception 'Only canceled orders can be reinstated.';
  end if;

  if v_order.payment_method <> 'pay_at_pickup' then
    raise exception 'Only pay-at-pickup orders can be reinstated.';
  end if;

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
  join public.order_items
    on order_items.order_id = v_order.id
   and order_items.inventory_item_id = inventory_items.id
  join public.listing_batches
    on listing_batches.id = order_items.listing_batch_id
  join public.listing_batch_breeds
    on listing_batch_breeds.id = order_items.listing_batch_breed_id
  join public.seller_breed_profiles
    on seller_breed_profiles.id = order_items.seller_breed_profile_id
  join public.species
    on species.id = order_items.species_id
  where inventory_items.store_id = v_order.store_id
    and listing_batches.store_id = v_order.store_id
    and listing_batch_breeds.store_id = v_order.store_id
    and seller_breed_profiles.store_id = v_order.store_id
    and order_items.store_id = v_order.store_id
    and inventory_items.listing_batch_id = listing_batches.id
    and inventory_items.listing_batch_breed_id = listing_batch_breeds.id
    and listing_batch_breeds.listing_batch_id = listing_batches.id
    and seller_breed_profiles.species_id = listing_batches.species_id
    and species.id = listing_batches.species_id
    and inventory_items.visibility_status = 'active'
    and inventory_items.moderation_status = 'normal'
    and listing_batches.visibility_status = 'active'
    and listing_batches.moderation_status = 'normal'
    and listing_batch_breeds.visibility_status = 'active'
    and listing_batch_breeds.moderation_status = 'normal'
    and seller_breed_profiles.visibility_status = 'active'
    and seller_breed_profiles.moderation_status = 'normal'
    and species.is_active = true
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
  group by
    inventory_items.id,
    reinstate_requested_items.quantity,
    inventory_items.quantity_available
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
  where inventory_items.id = reinstate_order_items.inventory_item_id;

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


comment on function public.mark_order_paid(uuid, text) is
'Trusted seller/admin RPC to mark a pending, open, or fulfilled pay-at-pickup order as paid.';

comment on function public.mark_order_pay_at_pickup(uuid, text) is
'Trusted seller/admin RPC to correct a paid pay-at-pickup order back to pay-at-pickup/unpaid operational state.';

comment on function public.mark_order_fulfilled(uuid, text) is
'Trusted seller/admin RPC to mark a pending or open order fulfilled. Does not modify payment status or inventory.';

comment on function public.cancel_order(uuid, text) is
'Trusted seller/admin RPC to cancel an eligible unpaid order and restore inventory quantities atomically.';

comment on function public.reinstate_order(uuid, text) is
'Trusted seller/admin RPC to reinstate an eligible canceled pay-at-pickup order after validating and re-decrementing inventory atomically.';


revoke all on function public.mark_order_paid(uuid, text) from public;
revoke all on function public.mark_order_pay_at_pickup(uuid, text) from public;
revoke all on function public.mark_order_fulfilled(uuid, text) from public;
revoke all on function public.cancel_order(uuid, text) from public;
revoke all on function public.reinstate_order(uuid, text) from public;

grant execute on function public.mark_order_paid(uuid, text) to authenticated;
grant execute on function public.mark_order_pay_at_pickup(uuid, text) to authenticated;
grant execute on function public.mark_order_fulfilled(uuid, text) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
grant execute on function public.reinstate_order(uuid, text) to authenticated;
