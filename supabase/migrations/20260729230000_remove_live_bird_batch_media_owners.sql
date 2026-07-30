begin;

delete from public.media_links
where media_links.entity_type in ('listing_batch', 'listing_batch_breed');

alter table public.media_links
  drop constraint if exists media_links_entity_type_check;

alter table public.media_links
  add constraint media_links_entity_type_check check (
    entity_type in (
      'store',
      'seller_breed_profile',
      'inventory_item',
      'equipment_inventory_item',
      'processed_poultry_inventory_item',
      'hatching_egg_inventory_item'
    )
  );

create or replace function public.validate_seller_media_entity(
  p_store_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_store_id is null or p_entity_type is null or p_entity_id is null then
    return false;
  end if;

  case p_entity_type
    when 'store' then
      return p_entity_id = p_store_id and exists (
        select 1 from public.stores as stores where stores.id = p_store_id
      );
    when 'seller_breed_profile' then
      return exists (
        select 1 from public.seller_breed_profiles as seller_breed_profiles
        where seller_breed_profiles.id = p_entity_id and seller_breed_profiles.store_id = p_store_id
      );
    when 'inventory_item' then
      return exists (
        select 1 from public.inventory_items as inventory_items
        where inventory_items.id = p_entity_id and inventory_items.store_id = p_store_id
      );
    when 'equipment_inventory_item' then
      return exists (
        select 1 from public.equipment_inventory_items as equipment_items
        where equipment_items.id = p_entity_id and equipment_items.store_id = p_store_id
      );
    when 'processed_poultry_inventory_item' then
      return exists (
        select 1 from public.processed_poultry_inventory_items as processed_items
        where processed_items.id = p_entity_id and processed_items.store_id = p_store_id
      );
    when 'hatching_egg_inventory_item' then
      return exists (
        select 1 from public.hatching_egg_inventory_items as hatching_items
        where hatching_items.id = p_entity_id and hatching_items.store_id = p_store_id
      );
    else
      return false;
  end case;
end;
$$;

create or replace function public.validate_seller_media_context(
  p_entity_type text,
  p_display_context text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_entity_type
    when 'store' then p_display_context in ('logo', 'hero', 'gallery')
    when 'seller_breed_profile' then p_display_context in ('primary', 'gallery')
    when 'inventory_item' then p_display_context in ('primary', 'gallery')
    when 'equipment_inventory_item' then p_display_context in ('primary', 'gallery')
    when 'processed_poultry_inventory_item' then p_display_context in ('primary', 'gallery')
    when 'hatching_egg_inventory_item' then p_display_context in ('primary', 'gallery')
    else false
  end;
$$;

create or replace view public.public_storefront_breed_inventory
with (security_barrier = true)
as
select
  stores.id as store_id,
  stores.store_slug,
  seller_breed_profiles.id as seller_breed_profile_id,
  species.id as species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  seller_breed_profiles.display_name as breed_display_name,
  seller_breed_profiles.seller_description as breed_description,
  listing_batches.id as listing_batch_id,
  listing_batch_breeds.id as listing_batch_breed_id,
  inventory_items.id as inventory_item_id,
  inventory_items.inventory_type,
  inventory_items.custom_inventory_label,
  inventory_items.quantity_available,
  case
    when listing_batches.visibility_status = 'sold_out'
      or inventory_items.quantity_available <= 0
      then 'sold_out'
    when listing_batches.available_date > current_date
      then 'coming_soon'
    when inventory_items.quantity_available <= 3
      then 'limited_availability'
    else 'available'
  end as availability_status,
  listing_batches.available_date,
  (
    listing_batches.available_date <= current_date
    and listing_batches.visibility_status <> 'sold_out'
    and inventory_items.quantity_available > 0
  ) as is_available_now,
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
  ) as unit_price,
  coalesce(
    inventory_media.image_url,
    breed_profile_media.image_url,
    store_media.image_url
  ) as featured_image_url,
  coalesce(
    inventory_media.alt_text,
    breed_profile_media.alt_text,
    store_media.alt_text
  ) as featured_image_alt_text,
  listing_batch_breeds.sort_order as breed_sort_order,
  inventory_items.sort_order as inventory_sort_order,
  listing_batches.batch_type,
  case
    when listing_batches.batch_type = 'live_animals'
      then listing_batches.age_at_availability_days
    else null
  end as age_at_availability_days
from public.inventory_items
join public.listing_batch_breeds
  on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
join public.listing_batches
  on listing_batches.id = inventory_items.listing_batch_id
join public.seller_breed_profiles
  on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
join public.stores
  on stores.id = inventory_items.store_id
join public.species
  on species.id = listing_batches.species_id
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = inventory_items.store_id
    and media_links.entity_type = 'inventory_item'
    and media_links.entity_id = inventory_items.id
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as inventory_media on true
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = seller_breed_profiles.store_id
    and media_links.entity_type = 'seller_breed_profile'
    and media_links.entity_id = seller_breed_profiles.id
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as breed_profile_media on true
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = stores.id
    and media_links.entity_type = 'store'
    and media_links.entity_id = stores.id
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as store_media on true
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and species.is_active = true
  and seller_breed_profiles.visibility_status = 'active'
  and seller_breed_profiles.moderation_status = 'normal'
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batches.moderation_status = 'normal'
  and listing_batch_breeds.visibility_status = 'active'
  and listing_batch_breeds.moderation_status = 'normal'
  and inventory_items.visibility_status = 'active'
  and inventory_items.moderation_status = 'normal'
  and (
    (
      listing_batches.batch_type = 'hatching_eggs'
      and inventory_items.inventory_type = 'hatching_eggs'
    )
    or (
      listing_batches.batch_type = 'live_animals'
      and inventory_items.inventory_type <> 'hatching_eggs'
    )
  );

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
  media_assets.height_px,
  media_links.crop_metadata
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
  media_assets.height_px,
  media_links.crop_metadata
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
  media_assets.height_px,
  media_links.crop_metadata
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
  media_assets.height_px,
  media_links.crop_metadata
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
  and equipment_inventory_items.quantity_available > 0
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
  media_assets.height_px,
  media_links.crop_metadata
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.hatching_egg_inventory_items
  on hatching_egg_inventory_items.id = media_links.entity_id
 and media_links.entity_type = 'hatching_egg_inventory_item'
join public.stores
  on stores.id = hatching_egg_inventory_items.store_id
 and stores.id = media_links.store_id
left join public.seller_billing_status
  on seller_billing_status.store_id = stores.id
where media_links.display_context = 'gallery'
  and media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and stores.hatching_eggs_enabled = true
  and coalesce(seller_billing_status.plan_key, 'full_flock') <> 'small_flock'
  and hatching_egg_inventory_items.visibility_status = 'active'
  and hatching_egg_inventory_items.moderation_status = 'normal'
  and hatching_egg_inventory_items.quantity_available > 0;

comment on view public.public_storefront_breed_inventory is
'Official buyer-facing public inventory projection grouped by seller breed profile and sellable inventory row. Featured media precedence is inventory item, seller breed profile, then store.';

comment on view public.public_storefront_media_gallery is
  'Public storefront media that is approved, active, and safe to render, including saved crop metadata.';

grant select on public.public_storefront_breed_inventory to anon, authenticated;
grant select on public.public_storefront_media_gallery to anon, authenticated;

commit;
