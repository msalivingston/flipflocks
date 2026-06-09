begin;

alter table public.order_items
  add column if not exists equipment_inventory_item_id uuid references public.equipment_inventory_items(id),
  add column if not exists product_type_snapshot text,
  add column if not exists item_name_snapshot text,
  add column if not exists item_category_snapshot text;

alter table public.order_items
  drop constraint if exists order_items_order_item_source_check,
  drop constraint if exists order_items_inventory_source_requires_inventory_check,
  drop constraint if exists order_items_custom_source_requires_custom_name_check,
  drop constraint if exists order_items_batch_type_snapshot_check,
  drop constraint if exists order_items_inventory_type_snapshot_check,
  drop constraint if exists order_items_product_type_snapshot_not_empty_check,
  drop constraint if exists order_items_item_name_snapshot_not_empty_check,
  drop constraint if exists order_items_item_category_snapshot_not_empty_check,
  drop constraint if exists order_items_listing_source_requires_inventory_check,
  drop constraint if exists order_items_equipment_source_requires_equipment_check;

update public.order_items
set order_item_source = 'listing_inventory'
where order_item_source = 'inventory';

update public.order_items
set
  product_type_snapshot = coalesce(product_type_snapshot, batch_type_snapshot),
  item_name_snapshot = coalesce(item_name_snapshot, custom_item_name_snapshot, breed_display_name_snapshot),
  item_category_snapshot = coalesce(item_category_snapshot, species_name_snapshot)
where product_type_snapshot is null
   or item_name_snapshot is null
   or item_category_snapshot is null;

alter table public.order_items
  add constraint order_items_order_item_source_check check (
    order_item_source in ('listing_inventory', 'equipment_inventory', 'custom')
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
      'other'
    )
  ),
  add constraint order_items_batch_type_snapshot_check check (
    batch_type_snapshot in ('live_animals', 'hatching_eggs', 'equipment_supplies', 'custom')
  ),
  add constraint order_items_product_type_snapshot_not_empty_check check (
    product_type_snapshot is null
    or length(trim(product_type_snapshot)) > 0
  ),
  add constraint order_items_item_name_snapshot_not_empty_check check (
    item_name_snapshot is null
    or length(trim(item_name_snapshot)) > 0
  ),
  add constraint order_items_item_category_snapshot_not_empty_check check (
    item_category_snapshot is null
    or length(trim(item_category_snapshot)) > 0
  ),
  add constraint order_items_listing_source_requires_inventory_check check (
    order_item_source <> 'listing_inventory'
    or (
      inventory_item_id is not null
      and equipment_inventory_item_id is null
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
  add constraint order_items_custom_source_requires_custom_name_check check (
    order_item_source <> 'custom'
    or (
      inventory_item_id is null
      and equipment_inventory_item_id is null
      and listing_batch_id is null
      and listing_batch_breed_id is null
      and seller_breed_profile_id is null
      and species_id is null
      and custom_item_name_snapshot is not null
    )
  );

create index if not exists order_items_equipment_inventory_item_id_idx
on public.order_items(equipment_inventory_item_id);

comment on column public.order_items.equipment_inventory_item_id is
'Referenced Equipment & Supplies inventory item for equipment-backed order lines.';

comment on column public.order_items.product_type_snapshot is
'Generic product type captured at checkout/order creation time, such as live_animals, hatching_eggs, equipment_supplies, or custom.';

comment on column public.order_items.item_name_snapshot is
'Generic buyer-facing item name captured at checkout/order creation time.';

comment on column public.order_items.item_category_snapshot is
'Generic buyer-facing item category captured at checkout/order creation time.';

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
    else 'ready_now'
  end as buyer_availability_code,
  case
    when equipment_inventory_items.quantity_available <= 0 then 'Sold out'
    else 'Available'
  end as buyer_availability_label,
  (equipment_inventory_items.quantity_available > 0) as can_checkout,
  equipment_inventory_items.price as unit_price,
  equipment_media.image_url as featured_image_url,
  equipment_media.alt_text as featured_image_alt_text,
  equipment_inventory_items.updated_at
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
'Buyer-facing public Equipment & Supplies inventory projection. Exposes active in-stock equipment rows without using bird/listing inventory tables.';

grant select on public.public_storefront_equipment_inventory to anon, authenticated;

create or replace view public.public_storefront_media_gallery
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
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.stores
  on stores.id = media_links.store_id
where media_links.entity_type = 'store'
  and media_links.entity_id = stores.id
  and media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
union all
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
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.seller_breed_profiles
  on seller_breed_profiles.id = media_links.entity_id
 and media_links.entity_type = 'seller_breed_profile'
join public.stores
  on stores.id = seller_breed_profiles.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and seller_breed_profiles.visibility_status = 'active'
  and seller_breed_profiles.moderation_status = 'normal'
union all
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
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.listing_batches
  on listing_batches.id = media_links.entity_id
 and media_links.entity_type = 'listing_batch'
join public.stores
  on stores.id = listing_batches.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and listing_batches.visibility_status in ('active', 'sold_out')
union all
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
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.listing_batch_breeds
  on listing_batch_breeds.id = media_links.entity_id
 and media_links.entity_type = 'listing_batch_breed'
join public.seller_breed_profiles
  on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
join public.listing_batches
  on listing_batches.id = listing_batch_breeds.listing_batch_id
join public.stores
  on stores.id = listing_batch_breeds.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batch_breeds.visibility_status = 'active'
  and seller_breed_profiles.visibility_status = 'active'
union all
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
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.inventory_items
  on inventory_items.id = media_links.entity_id
 and media_links.entity_type = 'inventory_item'
join public.listing_batch_breeds
  on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
join public.seller_breed_profiles
  on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
join public.listing_batches
  on listing_batches.id = inventory_items.listing_batch_id
join public.stores
  on stores.id = inventory_items.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batch_breeds.visibility_status = 'active'
  and seller_breed_profiles.visibility_status = 'active'
  and inventory_items.visibility_status = 'active'
union all
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
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.equipment_inventory_items
  on equipment_inventory_items.id = media_links.entity_id
 and media_links.entity_type = 'equipment_inventory_item'
join public.stores
  on stores.id = equipment_inventory_items.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and equipment_inventory_items.visibility_status = 'active'
  and equipment_inventory_items.moderation_status = 'normal'
  and equipment_inventory_items.quantity_available > 0;

grant select on public.public_storefront_media_gallery to anon, authenticated;

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
      case
        when raw_items.item ? 'inventory_item_id' then 'listing_inventory'
        else raw_items.item ->> 'item_type'
      end as item_type,
      case
        when raw_items.item ? 'inventory_item_id' then raw_items.item ->> 'inventory_item_id'
        else raw_items.item ->> 'item_id'
      end as item_id_text,
      raw_items.item ->> 'quantity' as quantity_text,
      raw_items.item
    from raw_items
  ),
  item_validation as (
    select
      count(*) as raw_item_count,
      count(*) filter (
        where jsonb_typeof(normalized_items.item) <> 'object'
           or normalized_items.item_type not in ('listing_inventory', 'equipment_inventory')
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
    where normalized_items.item_type in ('listing_inventory', 'equipment_inventory')
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
  matched_items as (
    select * from matched_listing_items
    union all
    select * from matched_equipment_items
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

create or replace function public.create_pay_at_pickup_order(
  p_store_id uuid,
  p_idempotency_key text,
  p_buyer_email text,
  p_buyer_first_name text,
  p_buyer_last_name text,
  p_items jsonb,
  p_buyer_phone text default null,
  p_business_name text default null,
  p_city text default null,
  p_state text default null,
  p_country text default null,
  p_delivery_address_line1 text default null,
  p_delivery_address_line2 text default null,
  p_delivery_city text default null,
  p_delivery_state text default null,
  p_delivery_postal_code text default null,
  p_delivery_country text default null,
  p_buyer_notes text default null,
  p_pickup_note text default null,
  p_buyer_ip_address inet default null,
  p_buyer_user_agent text default null,
  p_pickup_option_id uuid default null
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  customer_id uuid,
  order_status text,
  payment_method text,
  payment_status text,
  subtotal_amount numeric(10, 2),
  tax_fee_amount numeric(10, 2),
  total_amount numeric(10, 2),
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_idempotency_key text := nullif(trim(p_idempotency_key), '');
  v_buyer_email text := lower(nullif(trim(p_buyer_email), ''));
  v_buyer_first_name text := nullif(trim(p_buyer_first_name), '');
  v_buyer_last_name text := nullif(trim(p_buyer_last_name), '');
  v_buyer_phone text := nullif(trim(p_buyer_phone), '');
  v_delivery_address_line1 text := nullif(trim(p_delivery_address_line1), '');
  v_delivery_address_line2 text := nullif(trim(p_delivery_address_line2), '');
  v_delivery_city text := nullif(trim(p_delivery_city), '');
  v_delivery_state text := nullif(trim(p_delivery_state), '');
  v_delivery_postal_code text := nullif(trim(p_delivery_postal_code), '');
  v_delivery_country text := coalesce(nullif(trim(p_delivery_country), ''), 'US');
  v_business_name text := nullif(trim(p_business_name), '');
  v_city text := nullif(trim(p_city), '');
  v_state text := nullif(trim(p_state), '');
  v_country text := coalesce(nullif(trim(p_country), ''), coalesce(nullif(trim(p_delivery_country), ''), 'US'));
  v_buyer_notes text := nullif(trim(p_buyer_notes), '');
  v_pickup_note text := nullif(trim(p_pickup_note), '');
  v_buyer_user_agent text := nullif(trim(p_buyer_user_agent), '');
  v_pickup_option public.store_pickup_options%rowtype;
  v_pickup_option_label_snapshot text;
  v_request_hash text;
  v_existing_idempotency public.order_idempotency_keys%rowtype;
  v_store public.stores%rowtype;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_order_created_at timestamptz;
  v_next_order_number integer;
  v_subtotal_amount numeric(10, 2);
  v_tax_fee_amount numeric(10, 2) := 0;
  v_total_amount numeric(10, 2);
  v_requested_item_count integer;
  v_locked_item_count integer;
begin
  if p_store_id is null then raise exception 'Store is required.'; end if;
  if v_idempotency_key is null then raise exception 'Idempotency key is required.'; end if;
  if length(v_idempotency_key) > 200 then raise exception 'Idempotency key must be 200 characters or fewer.'; end if;
  if v_buyer_email is null then raise exception 'Buyer email is required.'; end if;
  if v_buyer_first_name is null then raise exception 'Buyer first name is required.'; end if;
  if v_buyer_last_name is null then raise exception 'Buyer last name is required.'; end if;
  if v_buyer_phone is null then raise exception 'Buyer phone is required.'; end if;
  if v_delivery_address_line1 is null then raise exception 'Buyer address line 1 is required.'; end if;
  if v_delivery_city is null then raise exception 'Buyer city is required.'; end if;
  if v_delivery_state is null then raise exception 'Buyer state is required.'; end if;
  if v_delivery_postal_code is null then raise exception 'Buyer postal code is required.'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one order item is required.';
  end if;

  select stores.*
  into v_store
  from public.stores
  where stores.id = p_store_id
    and stores.storefront_enabled = true
    and stores.store_status = 'live'
    and stores.storefront_mode in ('hosted', 'embedded')
    and stores.admin_hold_reason is null;

  if v_store.id is null then
    raise exception 'Store is not available for checkout.';
  end if;

  if p_pickup_option_id is not null then
    select pickup_options.*
    into v_pickup_option
    from public.store_pickup_options as pickup_options
    where pickup_options.id = p_pickup_option_id
      and pickup_options.store_id = p_store_id
      and pickup_options.is_active = true;

    if v_pickup_option.id is null then
      raise exception 'Pickup option is not available for this store.';
    end if;

    v_pickup_option_label_snapshot := v_pickup_option.label;
  end if;

  create temporary table pg_temp.requested_order_items (
    item_type text not null,
    item_id uuid not null,
    quantity integer not null check (quantity > 0),
    primary key (item_type, item_id)
  ) on commit drop;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where jsonb_typeof(item) <> 'object'
       or (
        not (
          item ? 'inventory_item_id'
          and item ->> 'inventory_item_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
        and not (
          item ->> 'item_type' in ('listing_inventory', 'equipment_inventory')
          and item ->> 'item_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
       or item ->> 'quantity' !~ '^[0-9]+$'
       or (item ->> 'quantity')::integer <= 0
  ) then
    raise exception 'Each order item must include a valid item type, item ID, and positive quantity.';
  end if;

  insert into pg_temp.requested_order_items (item_type, item_id, quantity)
  select
    case
      when item ? 'inventory_item_id' then 'listing_inventory'
      else item ->> 'item_type'
    end,
    case
      when item ? 'inventory_item_id' then (item ->> 'inventory_item_id')::uuid
      else (item ->> 'item_id')::uuid
    end,
    sum((item ->> 'quantity')::integer)::integer
  from jsonb_array_elements(p_items) as item
  where jsonb_typeof(item) = 'object'
    and (
      (
        item ? 'inventory_item_id'
        and item ->> 'inventory_item_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or (
        item ->> 'item_type' in ('listing_inventory', 'equipment_inventory')
        and item ->> 'item_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    )
    and item ->> 'quantity' ~ '^[0-9]+$'
    and (item ->> 'quantity')::integer > 0
  group by 1, 2;

  select count(*) into v_requested_item_count from pg_temp.requested_order_items;

  if v_requested_item_count = 0 then
    raise exception 'Each order item must include a valid item type, item ID, and positive quantity.';
  end if;

  v_request_hash := encode(
    digest(
      jsonb_build_object(
        'store_id', p_store_id,
        'buyer_email', v_buyer_email,
        'buyer_first_name', v_buyer_first_name,
        'buyer_last_name', v_buyer_last_name,
        'buyer_phone', v_buyer_phone,
        'business_name', v_business_name,
        'city', v_city,
        'state', v_state,
        'country', v_country,
        'delivery_address_line1', v_delivery_address_line1,
        'delivery_address_line2', v_delivery_address_line2,
        'delivery_city', v_delivery_city,
        'delivery_state', v_delivery_state,
        'delivery_postal_code', v_delivery_postal_code,
        'delivery_country', v_delivery_country,
        'buyer_notes', v_buyer_notes,
        'pickup_note', v_pickup_note,
        'pickup_option_id', p_pickup_option_id,
        'items', (
          select jsonb_agg(
            jsonb_build_object(
              'item_type', requested_order_items.item_type,
              'item_id', requested_order_items.item_id,
              'quantity', requested_order_items.quantity
            )
            order by requested_order_items.item_type, requested_order_items.item_id
          )
          from pg_temp.requested_order_items as requested_order_items
        )
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.order_idempotency_keys (store_id, idempotency_key, request_hash)
  values (p_store_id, v_idempotency_key, v_request_hash)
  on conflict on constraint order_idempotency_keys_pkey do nothing;

  select idempotency_keys.*
  into v_existing_idempotency
  from public.order_idempotency_keys as idempotency_keys
  where idempotency_keys.store_id = p_store_id
    and idempotency_keys.idempotency_key = v_idempotency_key
  for update;

  if v_existing_idempotency.request_hash <> v_request_hash then
    raise exception 'Idempotency key was already used with a different request.';
  end if;

  if v_existing_idempotency.order_id is not null then
    return query
    select
      orders.id,
      orders.order_number,
      orders.store_id,
      orders.customer_id,
      orders.order_status,
      orders.payment_method,
      orders.payment_status,
      orders.subtotal_amount,
      orders.tax_fee_amount,
      orders.total_amount,
      orders.created_at
    from public.orders
    where orders.id = v_existing_idempotency.order_id;

    return;
  end if;

  create temporary table pg_temp.locked_order_items (
    item_type text not null,
    item_id uuid not null,
    requested_quantity integer not null,
    store_id uuid not null,
    inventory_item_id uuid,
    equipment_inventory_item_id uuid,
    listing_batch_id uuid,
    listing_batch_breed_id uuid,
    seller_breed_profile_id uuid,
    species_id uuid,
    species_name text not null,
    species_slug text not null,
    breed_display_name text not null,
    breed_description text,
    inventory_type text not null,
    custom_inventory_label text,
    batch_type text not null,
    product_type text not null,
    item_name text not null,
    item_category text not null,
    available_date date,
    age_at_availability_days integer,
    quantity_available integer not null,
    unit_price numeric(10, 2) not null,
    line_subtotal numeric(10, 2) not null,
    primary key (item_type, item_id)
  ) on commit drop;

  insert into pg_temp.locked_order_items (
    item_type,
    item_id,
    requested_quantity,
    store_id,
    inventory_item_id,
    listing_batch_id,
    listing_batch_breed_id,
    seller_breed_profile_id,
    species_id,
    species_name,
    species_slug,
    breed_display_name,
    breed_description,
    inventory_type,
    custom_inventory_label,
    batch_type,
    product_type,
    item_name,
    item_category,
    available_date,
    age_at_availability_days,
    quantity_available,
    unit_price,
    line_subtotal
  )
  select
    'listing_inventory',
    inventory_items.id,
    requested_order_items.quantity,
    inventory_items.store_id,
    inventory_items.id,
    listing_batches.id,
    listing_batch_breeds.id,
    seller_breed_profiles.id,
    species.id,
    species.common_name,
    species.slug,
    seller_breed_profiles.display_name,
    seller_breed_profiles.seller_description,
    inventory_items.inventory_type,
    inventory_items.custom_inventory_label,
    listing_batches.batch_type,
    listing_batches.batch_type,
    seller_breed_profiles.display_name,
    species.common_name,
    listing_batches.available_date,
    case when listing_batches.batch_type = 'live_animals' then listing_batches.age_at_availability_days else null end,
    inventory_items.quantity_available,
    public.calculate_inventory_unit_price(
      listing_batches.base_price,
      inventory_items.price_override,
      listing_batches.auto_price_adjustment_enabled,
      listing_batches.price_adjustment_direction,
      listing_batches.price_adjustment_amount,
      listing_batches.price_adjustment_interval_weeks,
      listing_batches.price_adjustment_max_price,
      listing_batches.price_adjustment_min_price,
      listing_batches.available_date
    ),
    (
      public.calculate_inventory_unit_price(
        listing_batches.base_price,
        inventory_items.price_override,
        listing_batches.auto_price_adjustment_enabled,
        listing_batches.price_adjustment_direction,
        listing_batches.price_adjustment_amount,
        listing_batches.price_adjustment_interval_weeks,
        listing_batches.price_adjustment_max_price,
        listing_batches.price_adjustment_min_price,
        listing_batches.available_date
      ) * requested_order_items.quantity
    )::numeric(10, 2)
  from pg_temp.requested_order_items as requested_order_items
  join public.inventory_items
    on inventory_items.id = requested_order_items.item_id
  join public.listing_batches
    on listing_batches.id = inventory_items.listing_batch_id
  join public.listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
  join public.seller_breed_profiles
    on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
  join public.species
    on species.id = listing_batches.species_id
  where requested_order_items.item_type = 'listing_inventory'
  order by inventory_items.id
  for update of inventory_items;

  insert into pg_temp.locked_order_items (
    item_type,
    item_id,
    requested_quantity,
    store_id,
    equipment_inventory_item_id,
    species_name,
    species_slug,
    breed_display_name,
    breed_description,
    inventory_type,
    custom_inventory_label,
    batch_type,
    product_type,
    item_name,
    item_category,
    quantity_available,
    unit_price,
    line_subtotal
  )
  select
    'equipment_inventory',
    equipment_inventory_items.id,
    requested_order_items.quantity,
    equipment_inventory_items.store_id,
    equipment_inventory_items.id,
    'Equipment & Supplies',
    'equipment-supplies',
    equipment_inventory_items.item_name,
    equipment_inventory_items.description,
    'equipment_supplies',
    equipment_inventory_items.condition,
    'equipment_supplies',
    'equipment_supplies',
    equipment_inventory_items.item_name,
    equipment_inventory_items.category,
    equipment_inventory_items.quantity_available,
    equipment_inventory_items.price,
    (equipment_inventory_items.price * requested_order_items.quantity)::numeric(10, 2)
  from pg_temp.requested_order_items as requested_order_items
  join public.equipment_inventory_items
    on equipment_inventory_items.id = requested_order_items.item_id
  where requested_order_items.item_type = 'equipment_inventory'
  order by equipment_inventory_items.id
  for update of equipment_inventory_items;

  select count(*) into v_locked_item_count from pg_temp.locked_order_items;

  if v_locked_item_count <> v_requested_item_count then
    raise exception 'One or more inventory items were not found.';
  end if;

  if exists (
    select 1 from pg_temp.locked_order_items
    where store_id <> p_store_id
  ) then
    raise exception 'One or more inventory items do not belong to this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    left join public.inventory_items
      on inventory_items.id = locked_order_items.inventory_item_id
     and locked_order_items.item_type = 'listing_inventory'
    left join public.listing_batches
      on listing_batches.id = locked_order_items.listing_batch_id
     and locked_order_items.item_type = 'listing_inventory'
    left join public.listing_batch_breeds
      on listing_batch_breeds.id = locked_order_items.listing_batch_breed_id
     and locked_order_items.item_type = 'listing_inventory'
    left join public.seller_breed_profiles
      on seller_breed_profiles.id = locked_order_items.seller_breed_profile_id
     and locked_order_items.item_type = 'listing_inventory'
    left join public.species
      on species.id = locked_order_items.species_id
     and locked_order_items.item_type = 'listing_inventory'
    left join public.equipment_inventory_items
      on equipment_inventory_items.id = locked_order_items.equipment_inventory_item_id
     and locked_order_items.item_type = 'equipment_inventory'
    where (
      locked_order_items.item_type = 'listing_inventory'
      and (
        inventory_items.visibility_status <> 'active'
        or inventory_items.moderation_status <> 'normal'
        or listing_batches.visibility_status <> 'active'
        or listing_batches.moderation_status <> 'normal'
        or listing_batch_breeds.visibility_status <> 'active'
        or listing_batch_breeds.moderation_status <> 'normal'
        or seller_breed_profiles.visibility_status <> 'active'
        or seller_breed_profiles.moderation_status <> 'normal'
        or species.is_active <> true
      )
    )
    or (
      locked_order_items.item_type = 'equipment_inventory'
      and (
        equipment_inventory_items.visibility_status <> 'active'
        or equipment_inventory_items.moderation_status <> 'normal'
      )
    )
  ) then
    raise exception 'One or more inventory items are not available for checkout.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    where quantity_available < requested_quantity
  ) then
    raise exception 'Insufficient inventory quantity available.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    where item_type = 'listing_inventory'
      and (
        (batch_type = 'hatching_eggs' and inventory_type <> 'hatching_eggs')
        or (batch_type = 'live_animals' and inventory_type = 'hatching_eggs')
      )
  ) then
    raise exception 'Invalid inventory type for listing batch type.';
  end if;

  select coalesce(sum(line_subtotal), 0)::numeric(10, 2)
  into v_subtotal_amount
  from pg_temp.locked_order_items;

  v_total_amount := v_subtotal_amount + v_tax_fee_amount;

  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || ':' || v_buyer_email, 0));

  select customers.id
  into v_customer_id
  from public.customers
  where customers.store_id = p_store_id
    and lower(trim(customers.email)) = v_buyer_email
  order by customers.created_at, customers.id
  limit 1;

  if v_customer_id is null then
    insert into public.customers (
      store_id,
      email,
      first_name,
      last_name,
      phone,
      business_name,
      city,
      state,
      country,
      delivery_address_line1,
      delivery_address_line2,
      delivery_city,
      delivery_state,
      delivery_postal_code,
      delivery_country
    )
    values (
      p_store_id,
      v_buyer_email,
      v_buyer_first_name,
      v_buyer_last_name,
      v_buyer_phone,
      v_business_name,
      v_city,
      v_state,
      v_country,
      v_delivery_address_line1,
      v_delivery_address_line2,
      v_delivery_city,
      v_delivery_state,
      v_delivery_postal_code,
      v_delivery_country
    )
    returning id into v_customer_id;
  else
    update public.customers
    set
      first_name = v_buyer_first_name,
      last_name = v_buyer_last_name,
      phone = v_buyer_phone,
      business_name = v_business_name,
      city = v_city,
      state = v_state,
      country = v_country,
      delivery_address_line1 = v_delivery_address_line1,
      delivery_address_line2 = v_delivery_address_line2,
      delivery_city = v_delivery_city,
      delivery_state = v_delivery_state,
      delivery_postal_code = v_delivery_postal_code,
      delivery_country = v_delivery_country
    where customers.id = v_customer_id;
  end if;

  insert into public.order_number_counters (store_id)
  values (p_store_id)
  on conflict (store_id) do nothing;

  update public.order_number_counters
  set last_order_number = order_number_counters.last_order_number + 1
  where order_number_counters.store_id = p_store_id
  returning last_order_number into v_next_order_number;

  v_order_number := v_next_order_number::text;

  insert into public.orders (
    store_id,
    customer_id,
    order_number,
    order_source,
    order_status,
    payment_method,
    payment_status,
    buyer_email_snapshot,
    buyer_first_name_snapshot,
    buyer_last_name_snapshot,
    buyer_phone_snapshot,
    buyer_address_line1_snapshot,
    buyer_address_line2_snapshot,
    buyer_city_snapshot,
    buyer_state_snapshot,
    buyer_postal_code_snapshot,
    buyer_country_snapshot,
    buyer_notes,
    pickup_note,
    pickup_option_id,
    pickup_option_label_snapshot,
    subtotal_amount,
    tax_fee_label_snapshot,
    tax_fee_rate_snapshot,
    tax_fee_amount,
    total_amount,
    buyer_ip_address,
    buyer_user_agent
  )
  values (
    p_store_id,
    v_customer_id,
    v_order_number,
    'storefront',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    v_buyer_email,
    v_buyer_first_name,
    v_buyer_last_name,
    v_buyer_phone,
    v_delivery_address_line1,
    v_delivery_address_line2,
    v_delivery_city,
    v_delivery_state,
    v_delivery_postal_code,
    v_delivery_country,
    v_buyer_notes,
    v_pickup_note,
    v_pickup_option.id,
    v_pickup_option_label_snapshot,
    v_subtotal_amount,
    null,
    null,
    v_tax_fee_amount,
    v_total_amount,
    p_buyer_ip_address,
    v_buyer_user_agent
  )
  returning id, created_at into v_order_id, v_order_created_at;

  insert into public.order_items (
    order_id,
    store_id,
    order_item_source,
    inventory_item_id,
    equipment_inventory_item_id,
    listing_batch_id,
    listing_batch_breed_id,
    seller_breed_profile_id,
    species_id,
    species_name_snapshot,
    species_slug_snapshot,
    breed_display_name_snapshot,
    breed_description_snapshot,
    inventory_type_snapshot,
    custom_inventory_label_snapshot,
    batch_type_snapshot,
    product_type_snapshot,
    item_name_snapshot,
    item_category_snapshot,
    available_date_snapshot,
    age_at_availability_days_snapshot,
    unit_price_snapshot,
    quantity,
    line_subtotal
  )
  select
    v_order_id,
    p_store_id,
    locked_order_items.item_type,
    locked_order_items.inventory_item_id,
    locked_order_items.equipment_inventory_item_id,
    locked_order_items.listing_batch_id,
    locked_order_items.listing_batch_breed_id,
    locked_order_items.seller_breed_profile_id,
    locked_order_items.species_id,
    locked_order_items.species_name,
    locked_order_items.species_slug,
    locked_order_items.breed_display_name,
    locked_order_items.breed_description,
    locked_order_items.inventory_type,
    locked_order_items.custom_inventory_label,
    locked_order_items.batch_type,
    locked_order_items.product_type,
    locked_order_items.item_name,
    locked_order_items.item_category,
    locked_order_items.available_date,
    locked_order_items.age_at_availability_days,
    locked_order_items.unit_price,
    locked_order_items.requested_quantity,
    locked_order_items.line_subtotal
  from pg_temp.locked_order_items
  order by locked_order_items.item_type, locked_order_items.item_id;

  update public.inventory_items
  set quantity_available = inventory_items.quantity_available - locked_order_items.requested_quantity
  from pg_temp.locked_order_items
  where locked_order_items.item_type = 'listing_inventory'
    and inventory_items.id = locked_order_items.inventory_item_id;

  update public.equipment_inventory_items
  set quantity_available = equipment_inventory_items.quantity_available - locked_order_items.requested_quantity
  from pg_temp.locked_order_items
  where locked_order_items.item_type = 'equipment_inventory'
    and equipment_inventory_items.id = locked_order_items.equipment_inventory_item_id;

  update public.order_idempotency_keys
  set order_id = v_order_id
  where order_idempotency_keys.store_id = p_store_id
    and order_idempotency_keys.idempotency_key = v_idempotency_key;

  perform public.enqueue_email_notification(
    p_store_id,
    v_order_id,
    'buyer_order_received',
    'buyer',
    v_buyer_email,
    'Order received: ' || v_order_number,
    jsonb_build_object(
      'order_id', v_order_id,
      'order_number', v_order_number,
      'store_id', p_store_id,
      'store_name', v_store.store_name,
      'store_slug', v_store.store_slug,
      'buyer_first_name', v_buyer_first_name,
      'buyer_last_name', v_buyer_last_name,
      'buyer_email', v_buyer_email,
      'order_status', 'open',
      'payment_status', 'pay_at_pickup',
      'total_amount', v_total_amount,
      'created_at', v_order_created_at,
      'pickup_note', v_pickup_note,
      'pickup_option_label', v_pickup_option_label_snapshot,
      'buyer_notes', v_buyer_notes
    )
  );

  perform public.enqueue_email_notification(
    p_store_id,
    v_order_id,
    'seller_new_order_received',
    'seller',
    v_store.order_notification_email,
    'New FlipFlocks order: ' || v_order_number,
    jsonb_build_object(
      'order_id', v_order_id,
      'order_number', v_order_number,
      'store_id', p_store_id,
      'store_name', v_store.store_name,
      'store_slug', v_store.store_slug,
      'buyer_first_name', v_buyer_first_name,
      'buyer_last_name', v_buyer_last_name,
      'buyer_email', v_buyer_email,
      'buyer_phone', v_buyer_phone,
      'order_status', 'open',
      'payment_status', 'pay_at_pickup',
      'total_amount', v_total_amount,
      'created_at', v_order_created_at,
      'pickup_option_label', v_pickup_option_label_snapshot,
      'item_count', v_requested_item_count
    )
  );

  return query
  select
    orders.id,
    orders.order_number,
    orders.store_id,
    orders.customer_id,
    orders.order_status,
    orders.payment_method,
    orders.payment_status,
    orders.subtotal_amount,
    orders.tax_fee_amount,
    orders.total_amount,
    orders.created_at
  from public.orders
  where orders.id = v_order_id;
end;
$$;

grant execute on function public.create_pay_at_pickup_order(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, inet, text, uuid
) to service_role;

drop view if exists public.seller_order_item_detail;

create or replace view public.seller_order_item_detail
with (security_barrier = true)
as
select
  order_items.store_id,
  order_items.order_id,
  order_items.id as order_item_id,
  orders.order_number,
  order_items.inventory_item_id,
  order_items.equipment_inventory_item_id,
  order_items.listing_batch_id,
  order_items.listing_batch_breed_id,
  order_items.seller_breed_profile_id,
  order_items.species_id,
  order_items.species_name_snapshot,
  order_items.species_slug_snapshot,
  order_items.breed_display_name_snapshot,
  order_items.breed_description_snapshot,
  order_items.inventory_type_snapshot,
  order_items.custom_inventory_label_snapshot,
  order_items.batch_type_snapshot,
  order_items.product_type_snapshot,
  order_items.item_name_snapshot,
  order_items.item_category_snapshot,
  order_items.available_date_snapshot,
  order_items.age_at_availability_days_snapshot,
  order_items.unit_price_snapshot,
  order_items.quantity,
  order_items.fulfilled_quantity,
  order_items.restored_quantity,
  greatest(
    order_items.quantity
      - order_items.fulfilled_quantity
      - order_items.restored_quantity,
    0
  ) as remaining_unfulfilled_quantity,
  order_items.line_subtotal,
  order_items.created_at,
  order_items.hatch_date_snapshot,
  order_items.age_at_sale_days_snapshot,
  order_items.order_item_source,
  order_items.custom_item_name_snapshot
from public.order_items
join public.orders
  on orders.id = order_items.order_id
 and orders.store_id = order_items.store_id
where public.owns_store(order_items.store_id)
   or public.is_admin();

grant select on public.seller_order_item_detail to authenticated;

create or replace function public.cancel_order(
  p_order_id uuid,
  p_canceled_reason text,
  p_restore_inventory boolean default false
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
  v_restore_inventory boolean;
  v_actor_type text;
  v_inventory_metadata jsonb;
  v_item record;
begin
  v_canceled_reason := nullif(trim(p_canceled_reason), '');
  v_restore_inventory := coalesce(p_restore_inventory, false);

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
    item_type text not null,
    inventory_item_id uuid,
    equipment_inventory_item_id uuid,
    listing_batch_id uuid,
    listing_batch_breed_id uuid,
    quantity_to_restore integer not null,
    from_quantity_available integer not null
  ) on commit drop;

  if v_restore_inventory then
    insert into pg_temp.cancel_order_items (
      order_item_id,
      item_type,
      inventory_item_id,
      listing_batch_id,
      listing_batch_breed_id,
      quantity_to_restore,
      from_quantity_available
    )
    select
      order_items.id,
      'listing_inventory',
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
      and coalesce(order_items.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
      and order_items.inventory_item_id is not null
      and order_items.quantity - order_items.fulfilled_quantity - order_items.restored_quantity > 0
    order by inventory_items.id
    for update of inventory_items, order_items;

    insert into pg_temp.cancel_order_items (
      order_item_id,
      item_type,
      equipment_inventory_item_id,
      quantity_to_restore,
      from_quantity_available
    )
    select
      order_items.id,
      'equipment_inventory',
      order_items.equipment_inventory_item_id,
      order_items.quantity - order_items.fulfilled_quantity - order_items.restored_quantity,
      equipment_inventory_items.quantity_available
    from public.order_items
    join public.equipment_inventory_items
      on equipment_inventory_items.id = order_items.equipment_inventory_item_id
     and equipment_inventory_items.store_id = v_order.store_id
    where order_items.order_id = v_order.id
      and order_items.store_id = v_order.store_id
      and order_items.order_item_source = 'equipment_inventory'
      and order_items.equipment_inventory_item_id is not null
      and order_items.quantity - order_items.fulfilled_quantity - order_items.restored_quantity > 0
    order by equipment_inventory_items.id
    for update of equipment_inventory_items, order_items;

    update public.inventory_items
    set quantity_available = inventory_items.quantity_available + cancel_order_items.quantity_to_restore
    from pg_temp.cancel_order_items
    where cancel_order_items.item_type = 'listing_inventory'
      and inventory_items.id = cancel_order_items.inventory_item_id
      and inventory_items.store_id = v_order.store_id;

    update public.equipment_inventory_items
    set quantity_available = equipment_inventory_items.quantity_available + cancel_order_items.quantity_to_restore
    from pg_temp.cancel_order_items
    where cancel_order_items.item_type = 'equipment_inventory'
      and equipment_inventory_items.id = cancel_order_items.equipment_inventory_item_id
      and equipment_inventory_items.store_id = v_order.store_id;

    update public.order_items
    set restored_quantity = order_items.restored_quantity + cancel_order_items.quantity_to_restore
    from pg_temp.cancel_order_items
    where order_items.id = cancel_order_items.order_item_id
      and order_items.order_id = v_order.id
      and order_items.store_id = v_order.store_id;

    for v_item in
      select *
      from pg_temp.cancel_order_items
      where item_type = 'listing_inventory'
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
          'quantity_restored', v_item.quantity_to_restore,
          'restore_inventory_requested', true
        )
      );
    end loop;
  end if;

  select jsonb_build_object(
    'restore_inventory_requested', v_restore_inventory,
    'inventory_adjustments',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', cancel_order_items.order_item_id,
          'item_type', cancel_order_items.item_type,
          'inventory_item_id', cancel_order_items.inventory_item_id,
          'equipment_inventory_item_id', cancel_order_items.equipment_inventory_item_id,
          'quantity_restored', cancel_order_items.quantity_to_restore
        )
        order by cancel_order_items.item_type, cancel_order_items.order_item_id
      ) filter (where cancel_order_items.order_item_id is not null),
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

grant execute on function public.cancel_order(uuid, text, boolean) to authenticated;

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

  drop table if exists pg_temp.reinstate_order_items;

  create temporary table pg_temp.reinstate_order_items (
    item_type text not null,
    inventory_item_id uuid,
    equipment_inventory_item_id uuid,
    quantity integer not null,
    quantity_available integer not null
  ) on commit drop;

  perform 1
  from public.order_items
  join public.inventory_items
    on inventory_items.id = order_items.inventory_item_id
   and inventory_items.store_id = v_order.store_id
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id
    and coalesce(order_items.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
  order by inventory_items.id
  for update of inventory_items;

  perform 1
  from public.order_items
  join public.equipment_inventory_items
    on equipment_inventory_items.id = order_items.equipment_inventory_item_id
   and equipment_inventory_items.store_id = v_order.store_id
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id
    and order_items.order_item_source = 'equipment_inventory'
  order by equipment_inventory_items.id
  for update of equipment_inventory_items;

  insert into pg_temp.reinstate_order_items (
    item_type,
    inventory_item_id,
    quantity,
    quantity_available
  )
  select
    'listing_inventory',
    inventory_items.id,
    sum(order_items.quantity)::integer,
    inventory_items.quantity_available
  from public.order_items
  join public.inventory_items
    on inventory_items.id = order_items.inventory_item_id
   and inventory_items.store_id = v_order.store_id
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id
    and coalesce(order_items.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
  group by inventory_items.id, inventory_items.quantity_available;

  insert into pg_temp.reinstate_order_items (
    item_type,
    equipment_inventory_item_id,
    quantity,
    quantity_available
  )
  select
    'equipment_inventory',
    equipment_inventory_items.id,
    sum(order_items.quantity)::integer,
    equipment_inventory_items.quantity_available
  from public.order_items
  join public.equipment_inventory_items
    on equipment_inventory_items.id = order_items.equipment_inventory_item_id
   and equipment_inventory_items.store_id = v_order.store_id
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id
    and order_items.order_item_source = 'equipment_inventory'
  group by equipment_inventory_items.id, equipment_inventory_items.quantity_available;

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
  where reinstate_order_items.item_type = 'listing_inventory'
    and inventory_items.id = reinstate_order_items.inventory_item_id
    and inventory_items.store_id = v_order.store_id;

  update public.equipment_inventory_items
  set quantity_available = equipment_inventory_items.quantity_available - reinstate_order_items.quantity
  from pg_temp.reinstate_order_items
  where reinstate_order_items.item_type = 'equipment_inventory'
    and equipment_inventory_items.id = reinstate_order_items.equipment_inventory_item_id
    and equipment_inventory_items.store_id = v_order.store_id;

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
          'item_type', reinstate_order_items.item_type,
          'inventory_item_id', reinstate_order_items.inventory_item_id,
          'equipment_inventory_item_id', reinstate_order_items.equipment_inventory_item_id,
          'quantity_redecremented', reinstate_order_items.quantity
        )
        order by reinstate_order_items.item_type,
          coalesce(reinstate_order_items.inventory_item_id, reinstate_order_items.equipment_inventory_item_id)
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

grant execute on function public.reinstate_order(uuid, text) to authenticated;

commit;
