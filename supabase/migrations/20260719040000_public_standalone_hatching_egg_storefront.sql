-- Public storefront projection for standalone Hatching Eggs.
--
-- This keeps buyer-facing standalone Hatching Eggs separate from listing batches,
-- listing batch breeds, seller breed profiles, and the breed library.

create or replace view public.public_storefront_hatching_egg_inventory
with (security_barrier = true)
as
select
  hatching_items.store_id,
  stores.store_slug,
  hatching_items.id as hatching_egg_inventory_item_id,
  'hatching_egg_inventory'::text as item_type,
  (
    'he-' ||
    md5(
      hatching_items.store_id::text ||
      ':' ||
      lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g'))
    )
  ) as hatching_egg_product_id,
  lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g')) as normalized_item_name,
  hatching_items.item_name,
  hatching_items.species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  hatching_items.description,
  hatching_items.quantity_available,
  case
    when hatching_items.quantity_available <= 0 then 'sold_out'
    when hatching_items.available_date > current_date then 'reserve_now'
    else 'ready_now'
  end as buyer_availability_code,
  case
    when hatching_items.quantity_available <= 0 then 'Sold out'
    when hatching_items.available_date > current_date then 'Reserve now'
    else 'Ready now'
  end as buyer_availability_label,
  hatching_items.available_date,
  hatching_items.available_date <= current_date as is_available_now,
  false as can_checkout,
  hatching_items.price as unit_price,
  hatching_items.minimum_order_quantity,
  hatching_media.image_url as featured_image_url,
  hatching_media.alt_text as featured_image_alt_text,
  hatching_items.created_at,
  hatching_items.updated_at
from public.hatching_egg_inventory_items as hatching_items
join public.stores as stores
  on stores.id = hatching_items.store_id
left join public.seller_billing_status
  on seller_billing_status.store_id = stores.id
join public.species as species
  on species.id = hatching_items.species_id
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links as media_links
  join public.media_assets as media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = hatching_items.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = hatching_items.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as hatching_media on true
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and stores.hatching_eggs_enabled = true
  and coalesce(seller_billing_status.plan_key, 'full_flock') <> 'small_flock'
  and hatching_items.visibility_status = 'active'
  and hatching_items.moderation_status = 'normal'
  and hatching_items.quantity_available > 0;

comment on view public.public_storefront_hatching_egg_inventory is
'Buyer-facing public standalone Hatching Eggs projection. Exposes active in-stock hatching egg rows from hatching_egg_inventory_items only, grouped by normalized item_name in application code, with checkout intentionally disabled until standalone Hatching Eggs checkout is wired.';

grant select on public.public_storefront_hatching_egg_inventory to anon, authenticated;
