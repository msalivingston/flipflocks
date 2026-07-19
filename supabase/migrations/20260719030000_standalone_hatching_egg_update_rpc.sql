begin;

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

  perform public.validate_hatching_eggs_module_enabled(v_item.store_id);
  perform public.validate_hatching_egg_inventory_values(
    p_item_name,
    p_species_id,
    p_available_date,
    p_quantity_available,
    p_price,
    p_minimum_order_quantity
  );

  update public.hatching_egg_inventory_items
  set
    item_name = trim(p_item_name),
    species_id = p_species_id,
    available_date = p_available_date,
    description = nullif(trim(p_description), ''),
    quantity_available = coalesce(p_quantity_available, 0),
    price = p_price,
    minimum_order_quantity = p_minimum_order_quantity,
    seller_notes = nullif(trim(p_seller_notes), '')
  where hatching_egg_inventory_items.id = v_item.id
  returning * into v_updated_item;

  return v_updated_item;
end;
$$;

comment on function public.seller_update_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) is
'Trusted seller/admin RPC for updating standalone Hatching Eggs inventory.';

revoke all on function public.seller_update_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) from public;
grant execute on function public.seller_update_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) to authenticated;

commit;
