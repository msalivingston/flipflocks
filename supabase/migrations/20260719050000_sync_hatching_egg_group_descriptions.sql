begin;

create or replace function public.seller_create_hatching_egg_inventory_item(
  p_store_id uuid,
  p_item_name text,
  p_species_id uuid,
  p_available_date date,
  p_quantity_available integer,
  p_price numeric,
  p_minimum_order_quantity integer default null,
  p_description text default null,
  p_seller_notes text default null
)
returns table (
  hatching_egg_inventory_item_id uuid,
  id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.hatching_egg_inventory_items%rowtype;
  v_description text;
  v_normalized_item_name text;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to create hatching egg inventory.';
  end if;

  v_description := nullif(trim(p_description), '');

  if v_description is null then
    raise exception 'Description is required.';
  end if;

  v_normalized_item_name := lower(regexp_replace(btrim(p_item_name), '\s+', ' ', 'g'));

  perform public.validate_hatching_eggs_module_enabled(p_store_id);
  perform public.validate_hatching_egg_inventory_values(
    p_item_name,
    p_species_id,
    p_available_date,
    p_quantity_available,
    p_price,
    p_minimum_order_quantity
  );

  perform stores.id
  from public.stores as stores
  where stores.id = p_store_id
  for update;

  perform hatching_items.id
  from public.hatching_egg_inventory_items as hatching_items
  where hatching_items.store_id = p_store_id
    and hatching_items.visibility_status <> 'archived'
    and lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g')) =
      v_normalized_item_name
  for update;

  insert into public.hatching_egg_inventory_items (
    store_id,
    item_name,
    species_id,
    available_date,
    description,
    quantity_available,
    price,
    minimum_order_quantity,
    visibility_status,
    seller_notes
  )
  values (
    p_store_id,
    trim(p_item_name),
    p_species_id,
    p_available_date,
    v_description,
    coalesce(p_quantity_available, 0),
    p_price,
    p_minimum_order_quantity,
    'hidden',
    nullif(trim(p_seller_notes), '')
  )
  returning * into v_item;

  update public.hatching_egg_inventory_items as hatching_items
  set description = v_description
  where hatching_items.store_id = p_store_id
    and hatching_items.visibility_status <> 'archived'
    and lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g')) =
      v_normalized_item_name;

  return query
  select v_item.id, v_item.id;
end;
$$;

comment on function public.seller_create_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) is
'Trusted seller/admin RPC for creating standalone Hatching Eggs inventory.';

revoke all on function public.seller_create_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) from public;
grant execute on function public.seller_create_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) to authenticated;

create or replace function public.seller_update_hatching_egg_inventory_item(
  p_hatching_egg_inventory_item_id uuid,
  p_item_name text,
  p_species_id uuid,
  p_available_date date,
  p_quantity_available integer,
  p_price numeric,
  p_minimum_order_quantity integer default null,
  p_description text default null,
  p_seller_notes text default null
)
returns public.hatching_egg_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.hatching_egg_inventory_items%rowtype;
  v_updated_item public.hatching_egg_inventory_items%rowtype;
  v_description text;
  v_normalized_item_name text;
begin
  select *
  into v_item
  from public.hatching_egg_inventory_items
  where hatching_egg_inventory_items.id = p_hatching_egg_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Hatching egg inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this hatching egg inventory.';
  end if;

  v_description := nullif(trim(p_description), '');

  if v_description is null then
    raise exception 'Description is required.';
  end if;

  v_normalized_item_name := lower(regexp_replace(btrim(p_item_name), '\s+', ' ', 'g'));

  perform public.validate_hatching_eggs_module_enabled(v_item.store_id);
  perform public.validate_hatching_egg_inventory_values(
    p_item_name,
    p_species_id,
    p_available_date,
    p_quantity_available,
    p_price,
    p_minimum_order_quantity
  );

  perform stores.id
  from public.stores as stores
  where stores.id = v_item.store_id
  for update;

  update public.hatching_egg_inventory_items
  set
    item_name = trim(p_item_name),
    species_id = p_species_id,
    available_date = p_available_date,
    description = v_description,
    quantity_available = coalesce(p_quantity_available, 0),
    price = p_price,
    minimum_order_quantity = p_minimum_order_quantity,
    seller_notes = nullif(trim(p_seller_notes), '')
  where hatching_egg_inventory_items.id = v_item.id;

  perform hatching_items.id
  from public.hatching_egg_inventory_items as hatching_items
  where hatching_items.store_id = v_item.store_id
    and hatching_items.visibility_status <> 'archived'
    and lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g')) =
      v_normalized_item_name
  for update;

  update public.hatching_egg_inventory_items as hatching_items
  set description = v_description
  where hatching_items.store_id = v_item.store_id
    and hatching_items.visibility_status <> 'archived'
    and lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g')) =
      v_normalized_item_name;

  select *
  into v_updated_item
  from public.hatching_egg_inventory_items
  where hatching_egg_inventory_items.id = v_item.id;

  return v_updated_item;
end;
$$;

comment on function public.seller_update_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) is
'Trusted seller/admin RPC for updating standalone Hatching Eggs inventory.';

revoke all on function public.seller_update_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) from public;
grant execute on function public.seller_update_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) to authenticated;

commit;
