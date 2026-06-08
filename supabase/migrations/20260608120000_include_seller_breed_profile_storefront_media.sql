begin;

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
  and inventory_items.visibility_status = 'active';

comment on view public.public_storefront_media_gallery is
'Public ordered gallery projection for active approved storefront, breed-profile, and listing media.';

grant select on public.public_storefront_media_gallery to anon, authenticated;

commit;
