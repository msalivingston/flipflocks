-- Processed Poultry buyer storefront and typed checkout support.
--
-- Adds processed_poultry_inventory as the third first-class order item source,
-- alongside listing_inventory and equipment_inventory.

begin;

alter table public.order_items
  drop constraint if exists order_items_order_item_source_check,
  drop constraint if exists order_items_listing_source_requires_inventory_check,
  drop constraint if exists order_items_equipment_source_requires_equipment_check,
  drop constraint if exists order_items_processed_poultry_source_requires_processed_check,
  drop constraint if exists order_items_custom_source_requires_custom_name_check,
  drop constraint if exists order_items_inventory_type_snapshot_check,
  drop constraint if exists order_items_batch_type_snapshot_check;

alter table public.order_items
  add constraint order_items_order_item_source_check check (
    order_item_source in ('listing_inventory', 'equipment_inventory', 'processed_poultry_inventory', 'custom')
  ),
  add constraint order_items_inventory_type_snapshot_check check (
    inventory_type_snapshot in (
      'female',
      'male',
      'straight_run',
      'unsexed',
      'pair',
      'trio',
      'hatching_eggs',
      'equipment_supplies',
      'processed_poultry',
      'other'
    )
  ),
  add constraint order_items_batch_type_snapshot_check check (
    batch_type_snapshot in ('live_animals', 'hatching_eggs', 'equipment_supplies', 'processed_poultry', 'custom')
  ),
  add constraint order_items_listing_source_requires_inventory_check check (
    order_item_source <> 'listing_inventory'
    or (
      inventory_item_id is not null
      and equipment_inventory_item_id is null
      and processed_poultry_inventory_item_id is null
      and listing_batch_id is not null
      and listing_batch_breed_id is not null
      and seller_breed_profile_id is not null
      and species_id is not null
      and available_date_snapshot is not null
    )
  ),
  add constraint order_items_equipment_source_requires_equipment_check check (
    order_item_source <> 'equipment_inventory'
    or (
      equipment_inventory_item_id is not null
      and inventory_item_id is null
      and processed_poultry_inventory_item_id is null
      and listing_batch_id is null
      and listing_batch_breed_id is null
      and seller_breed_profile_id is null
      and species_id is null
      and available_date_snapshot is null
      and product_type_snapshot = 'equipment_supplies'
      and item_name_snapshot is not null
      and item_category_snapshot is not null
    )
  ),
  add constraint order_items_processed_poultry_source_requires_processed_check check (
    order_item_source <> 'processed_poultry_inventory'
    or (
      processed_poultry_inventory_item_id is not null
      and inventory_item_id is null
      and equipment_inventory_item_id is null
      and listing_batch_id is null
      and listing_batch_breed_id is null
      and seller_breed_profile_id is null
      and species_id is null
      and available_date_snapshot is null
      and product_type_snapshot = 'processed_poultry'
      and item_name_snapshot is not null
      and item_category_snapshot is not null
    )
  ),
  add constraint order_items_custom_source_requires_custom_name_check check (
    order_item_source <> 'custom'
    or (
      inventory_item_id is null
      and equipment_inventory_item_id is null
      and processed_poultry_inventory_item_id is null
      and listing_batch_id is null
      and listing_batch_breed_id is null
      and seller_breed_profile_id is null
      and species_id is null
      and custom_item_name_snapshot is not null
    )
  );

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
    else 'ready_now'
  end as buyer_availability_code,
  case
    when processed_items.quantity_available <= 0 then 'Sold out'
    else 'Available'
  end as buyer_availability_label,
  (processed_items.quantity_available > 0) as can_checkout,
  processed_items.price as unit_price,
  processed_media.image_url as featured_image_url,
  processed_media.alt_text as featured_image_alt_text,
  processed_items.updated_at
from public.processed_poultry_inventory_items as processed_items
join public.stores as stores
  on stores.id = processed_items.store_id
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

create or replace view public.public_storefront_processed_poultry_media_gallery
with (security_barrier = true)
as
select
  stores.store_slug,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.width_px,
  media_assets.height_px
from public.media_links as media_links
join public.media_assets as media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.processed_poultry_inventory_items as processed_items
  on processed_items.id = media_links.entity_id
 and media_links.entity_type = 'processed_poultry_inventory_item'
join public.stores as stores
  on stores.id = processed_items.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and processed_items.visibility_status = 'active'
  and processed_items.moderation_status = 'normal'
  and processed_items.quantity_available > 0;

grant select on public.public_storefront_processed_poultry_media_gallery to anon, authenticated;

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
      public_storefront_processed_poultry_inventory.poultry_type as item_category,
      'processed_poultry'::text as inventory_type,
      concat_ws(' - ', public_storefront_processed_poultry_inventory.product_type, public_storefront_processed_poultry_inventory.package_size) as custom_inventory_label,
      public_storefront_processed_poultry_inventory.quantity_available,
      public_storefront_processed_poultry_inventory.buyer_availability_code,
      public_storefront_processed_poultry_inventory.buyer_availability_label,
      null::date as available_date,
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

commit;
