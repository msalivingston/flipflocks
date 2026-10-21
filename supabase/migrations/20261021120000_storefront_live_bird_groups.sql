-- Resolve buyer-facing live-bird groups into ordinary inventory UUIDs. The
-- existing checkout creators, coupon calculation, order snapshots and release
-- paths continue to operate on those ordinary UUIDs.
begin;

create function public.storefront_live_bird_group_identity(p_item public.public_storefront_inventory)
returns jsonb language sql stable set search_path = pg_catalog, public as $$
  select to_jsonb(p_item)
    - 'inventory_item_id' - 'quantity_available' - 'inventory_sort_order'
    - 'breed_sort_order' - 'buyer_availability_code'
    - 'buyer_availability_label' - 'can_checkout' - 'is_available_now';
$$;
revoke all on function public.storefront_live_bird_group_identity(public.public_storefront_inventory)
  from public, anon, authenticated;

create function public.expand_storefront_live_bird_groups(
  p_store_id uuid, p_items jsonb, p_lock boolean default false,
  p_existing_order_id uuid default null
)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public as $$
declare
  v_item jsonb;
  v_anchor public.public_storefront_inventory%rowtype;
  v_current_anchor public.public_storefront_inventory%rowtype;
  v_candidate public.public_storefront_inventory%rowtype;
  v_key jsonb;
  v_seen_keys jsonb[] := array[]::jsonb[];
  v_candidate_ids uuid[];
  v_direct_ids uuid[];
  v_allocated_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_quantity integer;
  v_remaining integer;
  v_take integer;
  v_existing_lines jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return p_items;
  end if;

  select coalesce(array_agg(coalesce(item->>'item_id',item->>'inventory_item_id')::uuid), array[]::uuid[])
    into v_direct_ids
  from jsonb_array_elements(p_items) item
  where (item->>'item_type' = 'listing_inventory' or item ? 'inventory_item_id')
    and coalesce(item->>'item_id',item->>'inventory_item_id') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_item->>'item_type' is distinct from 'listing_inventory_group' then
      v_result := v_result || jsonb_build_array(v_item);
      continue;
    end if;
    if coalesce(v_item->>'item_id','') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_item->>'quantity','') !~ '^[0-9]+$'
      or length(v_item->>'quantity') > 10
      or (v_item->>'quantity')::bigint not between 1 and 2147483647 then
      raise exception 'Invalid grouped inventory request.';
    end if;
    v_quantity := (v_item->>'quantity')::integer;
    select * into v_anchor from public.public_storefront_inventory
    where store_id = p_store_id and inventory_item_id = (v_item->>'item_id')::uuid
      and batch_type = 'live_animals' and inventory_type <> 'hatching_eggs';
    if not found then raise exception 'Grouped inventory is no longer available.'; end if;
    v_key := public.storefront_live_bird_group_identity(v_anchor);
    if v_key = any(v_seen_keys) then
      raise exception 'Duplicate grouped inventory request.';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_key);

    -- Lock every current member in UUID order, avoiding opposing lock orders
    -- when concurrent buyers select different anchors in the same group.
    select coalesce(array_agg(i.id order by i.id), array[]::uuid[])
      into v_candidate_ids
    from public.public_storefront_inventory view_item
    join public.inventory_items i on i.id = view_item.inventory_item_id
    where view_item.store_id = p_store_id
      and public.storefront_live_bird_group_identity(view_item) = v_key;
    if v_candidate_ids && v_direct_ids or v_candidate_ids && v_allocated_ids then
      raise exception 'Overlapping inventory requests are not allowed.';
    end if;
    if p_existing_order_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_type','listing_inventory','item_id',oi.inventory_item_id,
        'quantity',oi.quantity) order by i.sort_order,i.created_at,i.id),'[]'::jsonb)
        into v_existing_lines
      from public.order_items oi
      join public.inventory_items i on i.id = oi.inventory_item_id
      where oi.order_id = p_existing_order_id and oi.store_id = p_store_id
        and oi.inventory_item_id = any(v_candidate_ids);
      if (select coalesce(sum((line->>'quantity')::integer),0)
          from jsonb_array_elements(v_existing_lines) line) <> v_quantity then
        raise exception 'Idempotent grouped request does not match the original order.';
      end if;
      v_result := v_result || v_existing_lines;
      v_allocated_ids := v_allocated_ids || v_candidate_ids;
      continue;
    end if;
    if p_lock then
      foreach v_id in array v_candidate_ids loop
        perform 1 from public.inventory_items where id = v_id for update;
      end loop;
    end if;
    select * into v_current_anchor from public.public_storefront_inventory
    where store_id = p_store_id and inventory_item_id = v_anchor.inventory_item_id;
    if not found or public.storefront_live_bird_group_identity(v_current_anchor) <> v_key then
      raise exception 'Grouped inventory changed. Please refresh your cart.';
    end if;

    v_remaining := v_quantity;
    for v_candidate in
      select view_item.* from public.public_storefront_inventory view_item
      join public.inventory_items i on i.id = view_item.inventory_item_id
      where view_item.inventory_item_id = any(v_candidate_ids)
        and view_item.store_id = p_store_id
        and public.storefront_live_bird_group_identity(view_item) = v_key
        and view_item.can_checkout and view_item.quantity_available > 0
      order by i.sort_order, i.created_at, i.id
    loop
      exit when v_remaining = 0;
      v_take := least(v_remaining, v_candidate.quantity_available);
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'item_type','listing_inventory', 'item_id',v_candidate.inventory_item_id,
        'quantity',v_take));
      v_allocated_ids := array_append(v_allocated_ids, v_candidate.inventory_item_id);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then
      raise exception 'Insufficient inventory quantity available.';
    end if;
  end loop;
  return v_result;
end;
$$;
revoke all on function public.expand_storefront_live_bird_groups(uuid,jsonb,boolean,uuid)
  from public, anon, authenticated;

-- Preserve all existing summary and minimum-order logic after expansion.
alter function public.get_public_checkout_summary(text,jsonb)
  rename to get_public_checkout_summary_ungrouped;
revoke all on function public.get_public_checkout_summary_ungrouped(text,jsonb)
  from public, anon, authenticated;
create function public.get_public_checkout_summary(p_store_slug text,p_items jsonb)
returns table (store_id uuid,store_slug text,is_checkout_available boolean,
  message text,item_count integer,total_quantity integer,
  subtotal_amount numeric(10,2),items jsonb)
language sql volatile security definer set search_path = pg_catalog, public as $$
  select * from public.get_public_checkout_summary_ungrouped(
    p_store_slug,
    public.expand_storefront_live_bird_groups(
      (select id from public.stores where store_slug = lower(trim(p_store_slug))),
      p_items, false));
$$;
revoke all on function public.get_public_checkout_summary(text,jsonb) from public;
grant execute on function public.get_public_checkout_summary(text,jsonb)
  to anon, authenticated, service_role;

-- Extend only the two buyer reservation entry points. Their existing lock,
-- pricing, coupon, idempotency, snapshot and inventory code remains intact.
do $patch$
declare
  v_name text;
  v_definition text;
  v_anchor text;
begin
  foreach v_name in array array[
    'create_pay_at_pickup_order_v2', 'reserve_storefront_card_checkout'
  ] loop
    select replace(pg_get_functiondef(p.oid),chr(13),'') into strict v_definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name;
    v_anchor := case when v_name = 'create_pay_at_pickup_order_v2'
      then E'  return query\n  select *\n  from public.create_pay_at_pickup_order_v2_batch_d_internal('
      else 'p_items := public.normalize_order_inventory_items(p_items, false);' end;
    if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1 then
      raise exception 'Group expansion anchor missing or ambiguous in %.',v_name;
    end if;
    execute replace(v_definition,v_anchor,
      case when v_name = 'create_pay_at_pickup_order_v2'
        then E'  p_items := public.expand_storefront_live_bird_groups(p_store_id,p_items,true,v_existing_order_id);\n\n'
          || v_anchor
        else E'p_items := public.expand_storefront_live_bird_groups(p_store_id,p_items,true);\n  '
          || v_anchor end);
  end loop;
end;
$patch$;
commit;
