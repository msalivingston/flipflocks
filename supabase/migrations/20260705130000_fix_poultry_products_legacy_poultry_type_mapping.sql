-- Fix Poultry Products V2 RPCs to write legacy poultry_type values safely.
--
-- The shared species table uses buyer/seller display names such as "Chickens",
-- while processed_poultry_inventory_items.poultry_type remains a legacy
-- constrained compatibility field.

begin;

create or replace function public.map_species_slug_to_processed_poultry_type(
  p_species_slug text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(nullif(trim(p_species_slug), ''))
    when 'chicken' then 'Chicken'
    when 'turkey' then 'Turkey'
    when 'duck' then 'Duck'
    when 'goose' then 'Goose'
    else 'Other'
  end;
$$;

create or replace function public.seller_create_poultry_product_inventory_item(
  p_store_id uuid,
  p_product_name text,
  p_product_type text,
  p_species_id uuid,
  p_available_date date,
  p_package_size text default null,
  p_quantity_available integer default 0,
  p_price numeric default 0,
  p_description text default null,
  p_seller_notes text default null
)
returns table (
  processed_poultry_inventory_item_id uuid,
  id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
  v_species public.species%rowtype;
  v_legacy_poultry_type text;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to create poultry product inventory.';
  end if;

  perform public.validate_processed_poultry_module_enabled(p_store_id);
  perform public.validate_poultry_product_inventory_values(
    p_product_name,
    p_product_type,
    p_species_id,
    p_available_date,
    p_quantity_available,
    p_price
  );

  select species.*
  into v_species
  from public.species as species
  where species.id = p_species_id
    and species.is_active = true;

  v_legacy_poultry_type := public.map_species_slug_to_processed_poultry_type(
    v_species.slug
  );

  insert into public.processed_poultry_inventory_items (
    store_id,
    product_name,
    poultry_type,
    species_id,
    available_date,
    product_type,
    package_size,
    description,
    quantity_available,
    price,
    visibility_status,
    seller_notes
  )
  values (
    p_store_id,
    trim(p_product_name),
    v_legacy_poultry_type,
    p_species_id,
    p_available_date,
    p_product_type,
    nullif(trim(p_package_size), ''),
    nullif(trim(p_description), ''),
    coalesce(p_quantity_available, 0),
    p_price,
    'hidden',
    nullif(trim(p_seller_notes), '')
  )
  returning * into v_item;

  return query
  select v_item.id, v_item.id;
end;
$$;

create or replace function public.seller_update_poultry_product_inventory_item(
  p_processed_poultry_inventory_item_id uuid,
  p_product_name text,
  p_product_type text,
  p_species_id uuid,
  p_available_date date,
  p_package_size text default null,
  p_quantity_available integer default 0,
  p_price numeric default 0,
  p_description text default null,
  p_seller_notes text default null
)
returns table (
  processed_poultry_inventory_item_id uuid,
  id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
  v_updated_item public.processed_poultry_inventory_items%rowtype;
  v_species public.species%rowtype;
  v_legacy_poultry_type text;
begin
  select processed_items.*
  into v_item
  from public.processed_poultry_inventory_items as processed_items
  where processed_items.id = p_processed_poultry_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Poultry product inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this poultry product inventory.';
  end if;

  if v_item.visibility_status = 'archived' then
    raise exception 'Archived poultry product inventory cannot be edited.';
  end if;

  perform public.validate_poultry_product_inventory_values(
    p_product_name,
    p_product_type,
    p_species_id,
    p_available_date,
    p_quantity_available,
    p_price
  );

  select species.*
  into v_species
  from public.species as species
  where species.id = p_species_id
    and species.is_active = true;

  v_legacy_poultry_type := public.map_species_slug_to_processed_poultry_type(
    v_species.slug
  );

  update public.processed_poultry_inventory_items as processed_items
  set
    product_name = trim(p_product_name),
    product_type = p_product_type,
    species_id = p_species_id,
    poultry_type = v_legacy_poultry_type,
    available_date = p_available_date,
    package_size = nullif(trim(p_package_size), ''),
    description = nullif(trim(p_description), ''),
    quantity_available = coalesce(p_quantity_available, 0),
    price = p_price,
    seller_notes = nullif(trim(p_seller_notes), '')
  where processed_items.id = v_item.id
  returning processed_items.* into v_updated_item;

  return query
  select v_updated_item.id, v_updated_item.id;
end;
$$;

revoke all on function public.map_species_slug_to_processed_poultry_type(text) from public;
grant execute on function public.map_species_slug_to_processed_poultry_type(text) to authenticated;

grant execute on function public.seller_create_poultry_product_inventory_item(uuid, text, text, uuid, date, text, integer, numeric, text, text) to authenticated;
grant execute on function public.seller_update_poultry_product_inventory_item(uuid, text, text, uuid, date, text, integer, numeric, text, text) to authenticated;

commit;
