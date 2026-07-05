-- Equipment & Supplies Available Date backend compatibility.
--
-- Keeps existing equipment RPC signatures intact while adding V2 create/update
-- functions for the upcoming one-page Equipment & Supplies flow.

begin;

alter table public.equipment_inventory_items
  add column if not exists available_date date;

update public.equipment_inventory_items
set available_date = created_at::date
where available_date is null;

alter table public.equipment_inventory_items
  alter column available_date set default current_date,
  alter column available_date set not null;

comment on column public.equipment_inventory_items.available_date is
'Date this equipment or supply item is available to buyers.';

create index if not exists equipment_inventory_items_store_available_date_idx
on public.equipment_inventory_items(store_id, available_date);

create or replace view public.seller_equipment_inventory_management
with (security_barrier = true)
as
select
  equipment_inventory_items.id as equipment_inventory_item_id,
  equipment_inventory_items.store_id,
  equipment_inventory_items.item_name,
  equipment_inventory_items.category,
  equipment_inventory_items.condition,
  equipment_inventory_items.description,
  equipment_inventory_items.quantity_available,
  equipment_inventory_items.price,
  equipment_inventory_items.visibility_status,
  equipment_inventory_items.moderation_status,
  case
    when equipment_inventory_items.visibility_status = 'archived'
      then 'archived'
    when equipment_inventory_items.moderation_status <> 'normal'
      then 'unavailable'
    when equipment_inventory_items.visibility_status = 'sold_out'
      or equipment_inventory_items.quantity_available <= 0
      then 'sold_out'
    when equipment_inventory_items.visibility_status <> 'active'
      then 'hidden'
    when equipment_inventory_items.available_date > current_date
      then 'coming_soon'
    else 'ready_now'
  end as operational_availability_status,
  equipment_inventory_items.seller_notes,
  equipment_inventory_items.first_published_at,
  equipment_inventory_items.archived_at,
  equipment_inventory_items.created_at,
  equipment_inventory_items.updated_at,
  equipment_inventory_items.available_date
from public.equipment_inventory_items
where public.owns_store(equipment_inventory_items.store_id)
   or public.is_admin();

comment on view public.seller_equipment_inventory_management is
'Seller-private Equipment & Supplies management projection. Includes available_date for seller inventory flows.';

grant select on public.seller_equipment_inventory_management to authenticated;

create or replace view public.public_storefront_equipment_inventory
with (security_barrier = true)
as
select
  equipment_inventory_items.store_id,
  stores.store_slug,
  equipment_inventory_items.id as equipment_inventory_item_id,
  'equipment_inventory'::text as item_type,
  equipment_inventory_items.item_name,
  equipment_inventory_items.category,
  equipment_inventory_items.condition,
  equipment_inventory_items.description,
  equipment_inventory_items.quantity_available,
  case
    when equipment_inventory_items.quantity_available <= 0 then 'sold_out'
    when equipment_inventory_items.available_date > current_date then 'coming_soon'
    else 'ready_now'
  end as buyer_availability_code,
  case
    when equipment_inventory_items.quantity_available <= 0 then 'Sold out'
    when equipment_inventory_items.available_date > current_date then 'Coming soon'
    else 'Available'
  end as buyer_availability_label,
  (
    equipment_inventory_items.quantity_available > 0
    and equipment_inventory_items.available_date <= current_date
  ) as can_checkout,
  equipment_inventory_items.price as unit_price,
  equipment_media.image_url as featured_image_url,
  equipment_media.alt_text as featured_image_alt_text,
  equipment_inventory_items.updated_at,
  equipment_inventory_items.available_date
from public.equipment_inventory_items
join public.stores
  on stores.id = equipment_inventory_items.store_id
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = equipment_inventory_items.store_id
    and media_links.entity_type = 'equipment_inventory_item'
    and media_links.entity_id = equipment_inventory_items.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as equipment_media on true
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and equipment_inventory_items.visibility_status = 'active'
  and equipment_inventory_items.moderation_status = 'normal'
  and equipment_inventory_items.quantity_available > 0;

comment on view public.public_storefront_equipment_inventory is
'Buyer-facing public Equipment & Supplies inventory projection. Exposes active in-stock equipment rows with available dates.';

grant select on public.public_storefront_equipment_inventory to anon, authenticated;

create or replace function public.seller_create_equipment_inventory_item_v2(
  p_store_id uuid,
  p_item_name text,
  p_category text,
  p_available_date date,
  p_quantity_available integer,
  p_price numeric,
  p_condition text default null,
  p_description text default null,
  p_seller_notes text default null
)
returns public.equipment_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.equipment_inventory_items%rowtype;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if p_available_date is null then
    raise exception 'Available date is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to create equipment inventory.';
  end if;

  perform public.validate_equipment_module_enabled(p_store_id);
  perform public.validate_equipment_inventory_values(
    p_item_name,
    p_category,
    nullif(trim(p_condition), ''),
    p_quantity_available,
    p_price
  );

  insert into public.equipment_inventory_items (
    store_id,
    item_name,
    category,
    condition,
    available_date,
    description,
    quantity_available,
    price,
    visibility_status,
    seller_notes
  )
  values (
    p_store_id,
    trim(p_item_name),
    p_category,
    nullif(trim(p_condition), ''),
    p_available_date,
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

create or replace function public.seller_update_equipment_inventory_item_v2(
  p_equipment_inventory_item_id uuid,
  p_item_name text,
  p_category text,
  p_available_date date,
  p_quantity_available integer,
  p_price numeric,
  p_condition text default null,
  p_description text default null,
  p_seller_notes text default null
)
returns public.equipment_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.equipment_inventory_items%rowtype;
  v_updated_item public.equipment_inventory_items%rowtype;
begin
  if p_available_date is null then
    raise exception 'Available date is required.';
  end if;

  select *
  into v_item
  from public.equipment_inventory_items
  where equipment_inventory_items.id = p_equipment_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Equipment inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this equipment inventory.';
  end if;

  if v_item.visibility_status = 'archived' then
    raise exception 'Archived equipment inventory cannot be edited.';
  end if;

  perform public.validate_equipment_inventory_values(
    p_item_name,
    p_category,
    nullif(trim(p_condition), ''),
    p_quantity_available,
    p_price
  );

  update public.equipment_inventory_items
  set
    item_name = trim(p_item_name),
    category = p_category,
    condition = nullif(trim(p_condition), ''),
    available_date = p_available_date,
    description = nullif(trim(p_description), ''),
    quantity_available = coalesce(p_quantity_available, 0),
    price = p_price,
    seller_notes = nullif(trim(p_seller_notes), '')
  where equipment_inventory_items.id = v_item.id
  returning * into v_updated_item;

  return v_updated_item;
end;
$$;

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
      public_storefront_equipment_inventory.available_date,
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
    matched_summary.subtotal_amount,
    matched_summary.items
  from normalized_input
  left join storefront on true
  cross join requested_summary
  cross join item_validation
  cross join matched_summary;
$$;

comment on function public.seller_create_equipment_inventory_item_v2(
  uuid, text, text, date, integer, numeric, text, text, text
) is
'Trusted seller/admin RPC for creating Equipment & Supplies draft inventory with available_date.';

comment on function public.seller_update_equipment_inventory_item_v2(
  uuid, text, text, date, integer, numeric, text, text, text
) is
'Trusted seller/admin RPC for updating Equipment & Supplies inventory details with available_date.';

revoke all on function public.seller_create_equipment_inventory_item_v2(
  uuid, text, text, date, integer, numeric, text, text, text
) from public;
revoke all on function public.seller_update_equipment_inventory_item_v2(
  uuid, text, text, date, integer, numeric, text, text, text
) from public;

grant execute on function public.seller_create_equipment_inventory_item_v2(
  uuid, text, text, date, integer, numeric, text, text, text
) to authenticated;
grant execute on function public.seller_update_equipment_inventory_item_v2(
  uuid, text, text, date, integer, numeric, text, text, text
) to authenticated;

grant execute on function public.get_public_checkout_summary(text, jsonb)
to anon, authenticated;

commit;
