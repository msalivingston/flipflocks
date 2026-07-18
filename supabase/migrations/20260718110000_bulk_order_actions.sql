-- Add trusted seller/admin bulk order actions for the Orders list.
-- These actions preserve order totals, saved snapshots, inventory, Stripe state,
-- transactional emails, and unrelated order history.

create or replace function public.seller_bulk_mark_orders_paid(
  p_order_ids uuid[],
  p_note text default null
)
returns table (
  requested_count integer,
  updated_count integer,
  skipped_count integer
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
  v_updated_count integer;
begin
  v_note := nullif(trim(p_note), '');
  v_actor_type := case when public.is_admin() then 'admin' else 'seller' end;

  drop table if exists pg_temp.bulk_requested_orders;
  drop table if exists pg_temp.bulk_owned_orders;
  drop table if exists pg_temp.bulk_payment_eligible_orders;

  create temporary table pg_temp.bulk_requested_orders (
    order_id uuid primary key
  ) on commit drop;

  insert into pg_temp.bulk_requested_orders (order_id)
  select distinct requested_order_id
  from unnest(coalesce(p_order_ids, '{}'::uuid[])) as requested_order_id
  where requested_order_id is not null;

  select count(*)
  into v_requested_count
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

  select count(*)
  into v_owned_count
  from pg_temp.bulk_owned_orders;

  if v_owned_count <> v_requested_count then
    raise exception 'One or more selected orders are not available.';
  end if;

  create temporary table pg_temp.bulk_payment_eligible_orders on commit drop as
  select owned_order.*
  from pg_temp.bulk_owned_orders as owned_order
  where owned_order.archived_at is null
    and owned_order.payment_provider = 'offline'
    and owned_order.payment_method = 'pay_at_pickup'
    and owned_order.order_status in ('pending', 'open', 'fulfilled')
    and owned_order.payment_status in ('pay_at_pickup', 'unpaid');

  update public.orders as target_order
  set
    payment_status = 'paid',
    paid_at = coalesce(target_order.paid_at, now())
  from pg_temp.bulk_payment_eligible_orders as eligible_order
  where target_order.id = eligible_order.id;

  get diagnostics v_updated_count = row_count;

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
  select
    eligible_order.store_id,
    eligible_order.id,
    auth.uid(),
    v_actor_type,
    'payment_marked_paid',
    eligible_order.order_status,
    eligible_order.order_status,
    eligible_order.payment_status,
    'paid',
    v_note,
    jsonb_build_object('bulk_action', true)
  from pg_temp.bulk_payment_eligible_orders as eligible_order;

  return query
  select
    v_requested_count,
    v_updated_count,
    v_requested_count - v_updated_count;
end;
$$;

comment on function public.seller_bulk_mark_orders_paid(uuid[], text) is
'Trusted seller/admin RPC to mark eligible selected offline pay-at-pickup orders paid in bulk without changing Stripe/provider payment state.';

revoke all on function public.seller_bulk_mark_orders_paid(uuid[], text) from public;
grant execute on function public.seller_bulk_mark_orders_paid(uuid[], text) to authenticated;

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

  select count(*)
  into v_requested_count
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

  select count(*)
  into v_owned_count
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
        and order_item.quantity - order_item.fulfilled_quantity - order_item.restored_quantity > 0
    );

  create temporary table pg_temp.bulk_fulfillment_items (
    store_id uuid not null,
    order_id uuid not null,
    order_item_id uuid primary key,
    quantity_to_fulfill integer not null check (quantity_to_fulfill > 0)
  ) on commit drop;

  insert into pg_temp.bulk_fulfillment_items (
    store_id,
    order_id,
    order_item_id,
    quantity_to_fulfill
  )
  select
    order_item.store_id,
    order_item.order_id,
    order_item.id,
    order_item.quantity - order_item.fulfilled_quantity - order_item.restored_quantity
  from public.order_items as order_item
  join pg_temp.bulk_fulfillment_eligible_orders as eligible_order
    on eligible_order.id = order_item.order_id
   and eligible_order.store_id = order_item.store_id
  where order_item.quantity - order_item.fulfilled_quantity - order_item.restored_quantity > 0
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
            )
            order by fulfillment_item.order_item_id
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
'Trusted seller/admin RPC to fulfill all remaining quantities on eligible selected pending/open orders. Optional payment update only marks eligible offline pay-at-pickup orders paid.';

revoke all on function public.seller_bulk_mark_orders_fulfilled(uuid[], boolean, text) from public;
grant execute on function public.seller_bulk_mark_orders_fulfilled(uuid[], boolean, text) to authenticated;

create or replace function public.seller_bulk_archive_orders(
  p_order_ids uuid[],
  p_note text default null
)
returns table (
  requested_count integer,
  updated_count integer,
  skipped_count integer
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
  v_updated_count integer;
begin
  v_note := nullif(trim(p_note), '');
  v_actor_type := case when public.is_admin() then 'admin' else 'seller' end;

  drop table if exists pg_temp.bulk_requested_orders;
  drop table if exists pg_temp.bulk_owned_orders;
  drop table if exists pg_temp.bulk_archive_eligible_orders;

  create temporary table pg_temp.bulk_requested_orders (
    order_id uuid primary key
  ) on commit drop;

  insert into pg_temp.bulk_requested_orders (order_id)
  select distinct requested_order_id
  from unnest(coalesce(p_order_ids, '{}'::uuid[])) as requested_order_id
  where requested_order_id is not null;

  select count(*)
  into v_requested_count
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

  select count(*)
  into v_owned_count
  from pg_temp.bulk_owned_orders;

  if v_owned_count <> v_requested_count then
    raise exception 'One or more selected orders are not available.';
  end if;

  create temporary table pg_temp.bulk_archive_eligible_orders on commit drop as
  select owned_order.*
  from pg_temp.bulk_owned_orders as owned_order
  where owned_order.archived_at is null;

  update public.orders as target_order
  set
    archived_at = now(),
    archived_by = auth.uid()
  from pg_temp.bulk_archive_eligible_orders as eligible_order
  where target_order.id = eligible_order.id;

  get diagnostics v_updated_count = row_count;

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
  select
    eligible_order.store_id,
    eligible_order.id,
    auth.uid(),
    v_actor_type,
    'order_archived',
    eligible_order.order_status,
    eligible_order.order_status,
    eligible_order.payment_status,
    eligible_order.payment_status,
    v_note,
    jsonb_build_object('bulk_action', true)
  from pg_temp.bulk_archive_eligible_orders as eligible_order;

  return query
  select
    v_requested_count,
    v_updated_count,
    v_requested_count - v_updated_count;
end;
$$;

comment on function public.seller_bulk_archive_orders(uuid[], text) is
'Trusted seller/admin RPC to archive selected orders organizationally without changing status, payment, fulfillment, inventory, totals, Stripe state, or emails.';

revoke all on function public.seller_bulk_archive_orders(uuid[], text) from public;
grant execute on function public.seller_bulk_archive_orders(uuid[], text) to authenticated;

create or replace function public.seller_bulk_unarchive_orders(
  p_order_ids uuid[],
  p_note text default null
)
returns table (
  requested_count integer,
  updated_count integer,
  skipped_count integer
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
  v_updated_count integer;
begin
  v_note := nullif(trim(p_note), '');
  v_actor_type := case when public.is_admin() then 'admin' else 'seller' end;

  drop table if exists pg_temp.bulk_requested_orders;
  drop table if exists pg_temp.bulk_owned_orders;
  drop table if exists pg_temp.bulk_unarchive_eligible_orders;

  create temporary table pg_temp.bulk_requested_orders (
    order_id uuid primary key
  ) on commit drop;

  insert into pg_temp.bulk_requested_orders (order_id)
  select distinct requested_order_id
  from unnest(coalesce(p_order_ids, '{}'::uuid[])) as requested_order_id
  where requested_order_id is not null;

  select count(*)
  into v_requested_count
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

  select count(*)
  into v_owned_count
  from pg_temp.bulk_owned_orders;

  if v_owned_count <> v_requested_count then
    raise exception 'One or more selected orders are not available.';
  end if;

  create temporary table pg_temp.bulk_unarchive_eligible_orders on commit drop as
  select owned_order.*
  from pg_temp.bulk_owned_orders as owned_order
  where owned_order.archived_at is not null;

  update public.orders as target_order
  set
    archived_at = null,
    archived_by = null
  from pg_temp.bulk_unarchive_eligible_orders as eligible_order
  where target_order.id = eligible_order.id;

  get diagnostics v_updated_count = row_count;

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
  select
    eligible_order.store_id,
    eligible_order.id,
    auth.uid(),
    v_actor_type,
    'order_unarchived',
    eligible_order.order_status,
    eligible_order.order_status,
    eligible_order.payment_status,
    eligible_order.payment_status,
    v_note,
    jsonb_build_object(
      'bulk_action', true,
      'previous_archived_at', eligible_order.archived_at,
      'previous_archived_by', eligible_order.archived_by
    )
  from pg_temp.bulk_unarchive_eligible_orders as eligible_order;

  return query
  select
    v_requested_count,
    v_updated_count,
    v_requested_count - v_updated_count;
end;
$$;

comment on function public.seller_bulk_unarchive_orders(uuid[], text) is
'Trusted seller/admin RPC to unarchive selected orders organizationally without changing status, payment, fulfillment, inventory, totals, Stripe state, or emails.';

revoke all on function public.seller_bulk_unarchive_orders(uuid[], text) from public;
grant execute on function public.seller_bulk_unarchive_orders(uuid[], text) to authenticated;
