-- Poultry Products backend compatibility.
--
-- Keeps the internal processed_poultry model while allowing the seller-facing
-- Poultry Products flow to use shared species, available dates, and the final
-- V1 product type values.

begin;

alter table public.processed_poultry_inventory_items
  add column if not exists species_id uuid references public.species(id),
  add column if not exists available_date date;

update public.processed_poultry_inventory_items as processed_items
set species_id = species.id
from public.species as species
where processed_items.species_id is null
  and lower(species.slug) = case processed_items.poultry_type
    when 'Chicken' then 'chicken'
    when 'Turkey' then 'turkey'
    when 'Duck' then 'duck'
    when 'Goose' then 'goose'
    else null
  end;

update public.processed_poultry_inventory_items
set available_date = created_at::date
where available_date is null;

alter table public.processed_poultry_inventory_items
  drop constraint if exists processed_poultry_product_type_check;

update public.processed_poultry_inventory_items
set product_type = case product_type
  when 'Whole Bird' then 'Meat & Broth'
  when 'Halves' then 'Meat & Broth'
  when 'Parts' then 'Meat & Broth'
  when 'Other' then 'Other'
  else product_type
end
where product_type in ('Whole Bird', 'Halves', 'Parts', 'Other');

alter table public.processed_poultry_inventory_items
  alter column available_date set default current_date,
  alter column available_date set not null;

alter table public.processed_poultry_inventory_items
  add constraint processed_poultry_product_type_check check (
    product_type in ('Eating Eggs', 'Meat & Broth', 'Feathers', 'Other')
  );

comment on column public.processed_poultry_inventory_items.species_id is
'Shared species reference for seller-facing Poultry Products. The legacy poultry_type text column is retained for compatibility.';

comment on column public.processed_poultry_inventory_items.available_date is
'Date this poultry product is available to buyers.';

create index if not exists processed_poultry_inventory_store_species_idx
on public.processed_poultry_inventory_items(store_id, species_id);

create index if not exists processed_poultry_inventory_store_product_type_only_idx
on public.processed_poultry_inventory_items(store_id, product_type);

create index if not exists processed_poultry_inventory_store_available_date_idx
on public.processed_poultry_inventory_items(store_id, available_date);

create or replace function public.normalize_poultry_product_type(p_product_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case nullif(trim(p_product_type), '')
    when 'Whole Bird' then 'Meat & Broth'
    when 'Halves' then 'Meat & Broth'
    when 'Parts' then 'Meat & Broth'
    when 'Eating Eggs' then 'Eating Eggs'
    when 'Meat & Broth' then 'Meat & Broth'
    when 'Feathers' then 'Feathers'
    when 'Other' then 'Other'
    else null
  end;
$$;

create or replace function public.validate_processed_poultry_inventory_values(
  p_product_name text,
  p_poultry_type text,
  p_product_type text,
  p_quantity_available integer,
  p_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_product_name), '') is null then
    raise exception 'Product name is required.';
  end if;

  if p_poultry_type not in ('Chicken', 'Turkey', 'Duck', 'Goose', 'Other') then
    raise exception 'Choose a supported poultry type.';
  end if;

  if public.normalize_poultry_product_type(p_product_type) is null then
    raise exception 'Choose a supported product type.';
  end if;

  if coalesce(p_quantity_available, -1) < 0 then
    raise exception 'Quantity available must be zero or more.';
  end if;

  if coalesce(p_price, -1) < 0 then
    raise exception 'Price must be zero or more.';
  end if;
end;
$$;

create or replace function public.validate_poultry_product_inventory_values(
  p_product_name text,
  p_product_type text,
  p_species_id uuid,
  p_available_date date,
  p_quantity_available integer,
  p_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_product_name), '') is null then
    raise exception 'Product name is required.';
  end if;

  if p_product_type not in ('Eating Eggs', 'Meat & Broth', 'Feathers', 'Other') then
    raise exception 'Choose a supported product type.';
  end if;

  if p_species_id is null or not exists (
    select 1
    from public.species as species
    where species.id = p_species_id
      and species.is_active = true
  ) then
    raise exception 'Choose a supported species.';
  end if;

  if p_available_date is null then
    raise exception 'Available date is required.';
  end if;

  if coalesce(p_quantity_available, -1) < 0 then
    raise exception 'Quantity available must be zero or more.';
  end if;

  if coalesce(p_price, -1) < 0 then
    raise exception 'Price must be zero or more.';
  end if;
end;
$$;

create or replace function public.seller_create_processed_poultry_inventory_item(
  p_store_id uuid,
  p_product_name text,
  p_poultry_type text,
  p_product_type text,
  p_quantity_available integer,
  p_price numeric,
  p_package_size text default null,
  p_description text default null,
  p_seller_notes text default null
)
returns public.processed_poultry_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
  v_normalized_product_type text;
  v_species_id uuid;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to create processed poultry inventory.';
  end if;

  perform public.validate_processed_poultry_module_enabled(p_store_id);
  perform public.validate_processed_poultry_inventory_values(
    p_product_name,
    p_poultry_type,
    p_product_type,
    p_quantity_available,
    p_price
  );

  v_normalized_product_type := public.normalize_poultry_product_type(p_product_type);

  select species.id
  into v_species_id
  from public.species as species
  where species.is_active = true
    and lower(species.slug) = case p_poultry_type
      when 'Chicken' then 'chicken'
      when 'Turkey' then 'turkey'
      when 'Duck' then 'duck'
      when 'Goose' then 'goose'
      else null
    end
  order by species.sort_order, species.common_name
  limit 1;

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
    p_poultry_type,
    v_species_id,
    current_date,
    v_normalized_product_type,
    nullif(trim(p_package_size), ''),
    nullif(trim(p_description), ''),
    coalesce(p_quantity_available, 0),
    p_price,
    'hidden',
    nullif(trim(p_seller_notes), '')
  )
  returning * into v_item;

  return v_item;
end;
$$;

create or replace function public.seller_update_processed_poultry_inventory_item(
  p_processed_poultry_inventory_item_id uuid,
  p_product_name text,
  p_poultry_type text,
  p_product_type text,
  p_quantity_available integer,
  p_price numeric,
  p_package_size text default null,
  p_description text default null,
  p_seller_notes text default null
)
returns public.processed_poultry_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
  v_updated_item public.processed_poultry_inventory_items%rowtype;
  v_normalized_product_type text;
  v_species_id uuid;
begin
  select processed_items.*
  into v_item
  from public.processed_poultry_inventory_items as processed_items
  where processed_items.id = p_processed_poultry_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Processed poultry inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this processed poultry inventory.';
  end if;

  if v_item.visibility_status = 'archived' then
    raise exception 'Archived processed poultry inventory cannot be edited.';
  end if;

  perform public.validate_processed_poultry_inventory_values(
    p_product_name,
    p_poultry_type,
    p_product_type,
    p_quantity_available,
    p_price
  );

  v_normalized_product_type := public.normalize_poultry_product_type(p_product_type);

  select species.id
  into v_species_id
  from public.species as species
  where species.is_active = true
    and lower(species.slug) = case p_poultry_type
      when 'Chicken' then 'chicken'
      when 'Turkey' then 'turkey'
      when 'Duck' then 'duck'
      when 'Goose' then 'goose'
      else null
    end
  order by species.sort_order, species.common_name
  limit 1;

  update public.processed_poultry_inventory_items as processed_items
  set
    product_name = trim(p_product_name),
    poultry_type = p_poultry_type,
    species_id = v_species_id,
    product_type = v_normalized_product_type,
    package_size = nullif(trim(p_package_size), ''),
    description = nullif(trim(p_description), ''),
    quantity_available = coalesce(p_quantity_available, 0),
    price = p_price,
    seller_notes = nullif(trim(p_seller_notes), '')
  where processed_items.id = v_item.id
  returning processed_items.* into v_updated_item;

  return v_updated_item;
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
    v_species.common_name,
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

  update public.processed_poultry_inventory_items as processed_items
  set
    product_name = trim(p_product_name),
    product_type = p_product_type,
    species_id = p_species_id,
    poultry_type = v_species.common_name,
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

create or replace view public.seller_processed_poultry_inventory_management
with (security_barrier = true)
as
select
  processed_items.id as processed_poultry_inventory_item_id,
  processed_items.store_id,
  processed_items.product_name,
  processed_items.poultry_type,
  processed_items.product_type,
  processed_items.package_size,
  processed_items.description,
  processed_items.quantity_available,
  processed_items.price,
  processed_items.visibility_status,
  processed_items.moderation_status,
  case
    when processed_items.visibility_status = 'archived' then 'archived'
    when processed_items.moderation_status <> 'normal' then 'unavailable'
    when processed_items.visibility_status = 'sold_out' or processed_items.quantity_available <= 0 then 'sold_out'
    when processed_items.visibility_status <> 'active' then 'hidden'
    when processed_items.available_date > current_date then 'coming_soon'
    else 'ready_now'
  end as operational_availability_status,
  processed_items.seller_notes,
  processed_items.first_published_at,
  processed_items.archived_at,
  processed_items.created_at,
  processed_items.updated_at,
  processed_items.species_id,
  coalesce(species.common_name, processed_items.poultry_type) as species_name,
  species.slug as species_slug,
  processed_items.available_date
from public.processed_poultry_inventory_items as processed_items
left join public.species as species
  on species.id = processed_items.species_id
where public.owns_store(processed_items.store_id)
   or public.is_admin();

grant select on public.seller_processed_poultry_inventory_management to authenticated;

create or replace view public.public_storefront_processed_poultry_inventory
with (security_barrier = true)
as
select
  processed_items.store_id,
  stores.store_slug,
  processed_items.id as processed_poultry_inventory_item_id,
  'processed_poultry_inventory'::text as item_type,
  processed_items.product_name,
  processed_items.poultry_type,
  processed_items.product_type,
  processed_items.package_size,
  processed_items.description,
  processed_items.quantity_available,
  case
    when processed_items.quantity_available <= 0 then 'sold_out'
    when processed_items.available_date > current_date then 'coming_soon'
    else 'ready_now'
  end as buyer_availability_code,
  case
    when processed_items.quantity_available <= 0 then 'Sold out'
    when processed_items.available_date > current_date then 'Coming soon'
    else 'Available'
  end as buyer_availability_label,
  (
    processed_items.quantity_available > 0
    and processed_items.available_date <= current_date
  ) as can_checkout,
  processed_items.price as unit_price,
  processed_media.image_url as featured_image_url,
  processed_media.alt_text as featured_image_alt_text,
  processed_items.updated_at,
  processed_items.species_id,
  coalesce(species.common_name, processed_items.poultry_type) as species_name,
  species.slug as species_slug,
  processed_items.available_date
from public.processed_poultry_inventory_items as processed_items
join public.stores as stores
  on stores.id = processed_items.store_id
left join public.species as species
  on species.id = processed_items.species_id
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links as media_links
  join public.media_assets as media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = processed_items.store_id
    and media_links.entity_type = 'processed_poultry_inventory_item'
    and media_links.entity_id = processed_items.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as processed_media on true
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and processed_items.visibility_status = 'active'
  and processed_items.moderation_status = 'normal'
  and processed_items.quantity_available > 0;

grant select on public.public_storefront_processed_poultry_inventory to anon, authenticated;

create or replace function public.get_public_checkout_summary(
  p_store_slug text,
  p_items jsonb
)
returns table (
  store_id uuid,
  store_slug text,
  is_checkout_available boolean,
  message text,
  item_count integer,
  total_quantity integer,
  subtotal_amount numeric(10, 2),
  items jsonb
)
language sql
stable
set search_path = public
as $$
  with normalized_input as (
    select
      lower(trim(p_store_slug)) as normalized_store_slug,
      case when p_items is not null and jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end as normalized_items,
      (p_items is not null and jsonb_typeof(p_items) = 'array') as items_are_array
  ),
  storefront as (
    select public_storefront_home.store_id, public_storefront_home.store_slug
    from public.public_storefront_home
    join normalized_input
      on normalized_input.normalized_store_slug = public_storefront_home.store_slug
  ),
  raw_items as (
    select raw_item.value as item
    from normalized_input
    cross join lateral jsonb_array_elements(normalized_input.normalized_items) as raw_item(value)
  ),
  normalized_items as (
    select
      case when raw_items.item ? 'inventory_item_id' then 'listing_inventory' else raw_items.item ->> 'item_type' end as item_type,
      case when raw_items.item ? 'inventory_item_id' then raw_items.item ->> 'inventory_item_id' else raw_items.item ->> 'item_id' end as item_id_text,
      raw_items.item ->> 'quantity' as quantity_text,
      raw_items.item
    from raw_items
  ),
  item_validation as (
    select
      count(*) as raw_item_count,
      count(*) filter (
        where jsonb_typeof(normalized_items.item) <> 'object'
           or normalized_items.item_type not in ('listing_inventory', 'equipment_inventory', 'processed_poultry_inventory')
           or normalized_items.item_id_text is null
           or normalized_items.item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           or normalized_items.quantity_text !~ '^[0-9]+$'
           or (normalized_items.quantity_text)::integer <= 0
      ) as invalid_item_count
    from normalized_items
  ),
  requested_items as (
    select
      normalized_items.item_type,
      normalized_items.item_id_text::uuid as item_id,
      sum(normalized_items.quantity_text::integer)::integer as requested_quantity
    from normalized_items
    where normalized_items.item_type in ('listing_inventory', 'equipment_inventory', 'processed_poultry_inventory')
      and normalized_items.item_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and normalized_items.quantity_text ~ '^[0-9]+$'
      and (normalized_items.quantity_text)::integer > 0
    group by normalized_items.item_type, normalized_items.item_id_text::uuid
  ),
  requested_summary as (
    select
      count(*)::integer as item_count,
      coalesce(sum(requested_items.requested_quantity), 0)::integer as total_quantity
    from requested_items
  ),
  matched_listing_items as (
    select
      requested_items.item_type,
      requested_items.item_id as requested_item_id,
      requested_items.requested_quantity,
      public_storefront_inventory.store_id,
      public_storefront_inventory.store_slug,
      public_storefront_inventory.inventory_item_id as item_id,
      public_storefront_inventory.breed_display_name as item_name,
      public_storefront_inventory.species_name as item_category,
      public_storefront_inventory.inventory_type,
      public_storefront_inventory.custom_inventory_label,
      public_storefront_inventory.quantity_available,
      public_storefront_inventory.buyer_availability_code,
      public_storefront_inventory.buyer_availability_label,
      public_storefront_inventory.available_date,
      public_storefront_inventory.can_checkout,
      public_storefront_inventory.unit_price,
      (public_storefront_inventory.unit_price * requested_items.requested_quantity)::numeric(10, 2) as line_subtotal
    from requested_items
    left join public.public_storefront_inventory
      on requested_items.item_type = 'listing_inventory'
     and public_storefront_inventory.inventory_item_id = requested_items.item_id
     and public_storefront_inventory.store_slug = (select storefront.store_slug from storefront limit 1)
    where requested_items.item_type = 'listing_inventory'
  ),
  matched_equipment_items as (
    select
      requested_items.item_type,
      requested_items.item_id as requested_item_id,
      requested_items.requested_quantity,
      public_storefront_equipment_inventory.store_id,
      public_storefront_equipment_inventory.store_slug,
      public_storefront_equipment_inventory.equipment_inventory_item_id as item_id,
      public_storefront_equipment_inventory.item_name,
      public_storefront_equipment_inventory.category as item_category,
      'equipment_supplies'::text as inventory_type,
      public_storefront_equipment_inventory.condition as custom_inventory_label,
      public_storefront_equipment_inventory.quantity_available,
      public_storefront_equipment_inventory.buyer_availability_code,
      public_storefront_equipment_inventory.buyer_availability_label,
      null::date as available_date,
      public_storefront_equipment_inventory.can_checkout,
      public_storefront_equipment_inventory.unit_price,
      (public_storefront_equipment_inventory.unit_price * requested_items.requested_quantity)::numeric(10, 2) as line_subtotal
    from requested_items
    left join public.public_storefront_equipment_inventory
      on requested_items.item_type = 'equipment_inventory'
     and public_storefront_equipment_inventory.equipment_inventory_item_id = requested_items.item_id
     and public_storefront_equipment_inventory.store_slug = (select storefront.store_slug from storefront limit 1)
    where requested_items.item_type = 'equipment_inventory'
  ),
  matched_processed_items as (
    select
      requested_items.item_type,
      requested_items.item_id as requested_item_id,
      requested_items.requested_quantity,
      public_storefront_processed_poultry_inventory.store_id,
      public_storefront_processed_poultry_inventory.store_slug,
      public_storefront_processed_poultry_inventory.processed_poultry_inventory_item_id as item_id,
      public_storefront_processed_poultry_inventory.product_name as item_name,
      public_storefront_processed_poultry_inventory.species_name as item_category,
      'processed_poultry'::text as inventory_type,
      concat_ws(' - ', public_storefront_processed_poultry_inventory.product_type, public_storefront_processed_poultry_inventory.package_size) as custom_inventory_label,
      public_storefront_processed_poultry_inventory.quantity_available,
      public_storefront_processed_poultry_inventory.buyer_availability_code,
      public_storefront_processed_poultry_inventory.buyer_availability_label,
      public_storefront_processed_poultry_inventory.available_date,
      public_storefront_processed_poultry_inventory.can_checkout,
      public_storefront_processed_poultry_inventory.unit_price,
      (public_storefront_processed_poultry_inventory.unit_price * requested_items.requested_quantity)::numeric(10, 2) as line_subtotal
    from requested_items
    left join public.public_storefront_processed_poultry_inventory
      on requested_items.item_type = 'processed_poultry_inventory'
     and public_storefront_processed_poultry_inventory.processed_poultry_inventory_item_id = requested_items.item_id
     and public_storefront_processed_poultry_inventory.store_slug = (select storefront.store_slug from storefront limit 1)
    where requested_items.item_type = 'processed_poultry_inventory'
  ),
  matched_items as (
    select * from matched_listing_items
    union all
    select * from matched_equipment_items
    union all
    select * from matched_processed_items
  ),
  matched_summary as (
    select
      count(*) filter (where matched_items.item_id is null)::integer as missing_item_count,
      count(*) filter (
        where matched_items.item_id is not null
          and (matched_items.can_checkout = false or matched_items.quantity_available < matched_items.requested_quantity)
      )::integer as unavailable_item_count,
      coalesce(sum(matched_items.line_subtotal) filter (where matched_items.item_id is not null), 0)::numeric(10, 2) as subtotal_amount,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'store_id', matched_items.store_id,
            'store_slug', matched_items.store_slug,
            'item_type', matched_items.item_type,
            'item_id', matched_items.item_id,
            'inventory_item_id', case when matched_items.item_type = 'listing_inventory' then matched_items.item_id else null end,
            'equipment_inventory_item_id', case when matched_items.item_type = 'equipment_inventory' then matched_items.item_id else null end,
            'processed_poultry_inventory_item_id', case when matched_items.item_type = 'processed_poultry_inventory' then matched_items.item_id else null end,
            'item_name', matched_items.item_name,
            'item_category', matched_items.item_category,
            'inventory_type', matched_items.inventory_type,
            'custom_inventory_label', matched_items.custom_inventory_label,
            'requested_quantity', matched_items.requested_quantity,
            'quantity_available', matched_items.quantity_available,
            'buyer_availability_code', matched_items.buyer_availability_code,
            'buyer_availability_label', matched_items.buyer_availability_label,
            'available_date', matched_items.available_date,
            'unit_price', matched_items.unit_price,
            'line_subtotal', matched_items.line_subtotal
          )
          order by matched_items.item_type, matched_items.item_name, matched_items.item_id
        ) filter (where matched_items.item_id is not null),
        '[]'::jsonb
      ) as items
    from matched_items
  )
  select
    storefront.store_id,
    normalized_input.normalized_store_slug as store_slug,
    (
      storefront.store_id is not null
      and normalized_input.items_are_array = true
      and item_validation.raw_item_count > 0
      and item_validation.invalid_item_count = 0
      and requested_summary.item_count > 0
      and matched_summary.missing_item_count = 0
      and matched_summary.unavailable_item_count = 0
    ) as is_checkout_available,
    case
      when storefront.store_id is null then 'This store is currently unavailable.'
      when normalized_input.items_are_array = false then 'Checkout items are invalid.'
      when item_validation.raw_item_count = 0 or requested_summary.item_count = 0 then 'At least one checkout item is required.'
      when item_validation.invalid_item_count > 0 then 'Checkout items are invalid.'
      when matched_summary.missing_item_count > 0 then 'One or more items are no longer available.'
      when matched_summary.unavailable_item_count > 0 then 'Insufficient inventory quantity available.'
      else null::text
    end as message,
    requested_summary.item_count,
    requested_summary.total_quantity,
    case
      when storefront.store_id is not null
        and normalized_input.items_are_array = true
        and item_validation.raw_item_count > 0
        and item_validation.invalid_item_count = 0
        and requested_summary.item_count > 0
        and matched_summary.missing_item_count = 0
        and matched_summary.unavailable_item_count = 0
        then matched_summary.subtotal_amount
      else 0::numeric(10, 2)
    end as subtotal_amount,
    case
      when storefront.store_id is not null
        and normalized_input.items_are_array = true
        and item_validation.raw_item_count > 0
        and item_validation.invalid_item_count = 0
        and requested_summary.item_count > 0
        and matched_summary.missing_item_count = 0
        and matched_summary.unavailable_item_count = 0
        then matched_summary.items
      else '[]'::jsonb
    end as items
  from normalized_input
  left join storefront on true
  cross join item_validation
  cross join requested_summary
  cross join matched_summary;
$$;

grant execute on function public.get_public_checkout_summary(text, jsonb) to anon, authenticated;

revoke all on function public.normalize_poultry_product_type(text) from public;
revoke all on function public.validate_poultry_product_inventory_values(text, text, uuid, date, integer, numeric) from public;
revoke all on function public.seller_create_poultry_product_inventory_item(uuid, text, text, uuid, date, text, integer, numeric, text, text) from public;
revoke all on function public.seller_update_poultry_product_inventory_item(uuid, text, text, uuid, date, text, integer, numeric, text, text) from public;

grant execute on function public.seller_create_poultry_product_inventory_item(uuid, text, text, uuid, date, text, integer, numeric, text, text) to authenticated;
grant execute on function public.seller_update_poultry_product_inventory_item(uuid, text, text, uuid, date, text, integer, numeric, text, text) to authenticated;

commit;
