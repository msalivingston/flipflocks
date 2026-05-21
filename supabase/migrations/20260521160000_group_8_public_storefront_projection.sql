-- Group 8: Public Storefront Projection
--
-- Filename:
-- 20260521160000_group_8_public_storefront_projection.sql
--
-- Scope:
-- - Creates the official buyer-facing public storefront read layer.
-- - Adds one reusable pricing helper function used by the public views.
-- - Creates public views for storefront profile, listing batches, inventory items,
--   and breed-first storefront inventory.
-- - Does not create RPCs.
-- - Does not create public_media_assets.
-- - Does not add new indexes.
-- - Does not add public read policies to base tables.
--
-- Public access model:
-- - These views are the official buyer-facing read layer.
-- - Public frontend code should query these views only, never the protected base tables.
-- - Base tables remain protected by RLS.
-- - View definitions intentionally enumerate buyer-safe columns only.
-- - Do not use SELECT * in public storefront projections.
--
-- Storefront eligibility:
-- - stores.store_status = 'live'
-- - stores.storefront_mode in ('hosted', 'embedded')
-- - stores.admin_hold_reason is null
--
-- Content eligibility:
-- - species.is_active = true
-- - seller_breed_profiles visibility active and moderation normal
-- - listing_batches visibility active/sold_out and moderation normal
-- - listing_batch_breeds visibility active and moderation normal
-- - inventory_items visibility active and moderation normal
-- - media assets active and approved, exposed only through active media links
--
-- Media URL assumption:
-- - Storefront media is assumed to live in public-readable Supabase Storage buckets.
-- - image_url values are relative public storage object paths:
--   /storage/v1/object/public/{bucket_name}/{storage_path}
-- - If private buckets or signed URLs are required later, image delivery should move
--   to a trusted server route or RPC.
--
-- Pricing behavior:
-- - unit_price is calculated at query time by public.calculate_inventory_unit_price().
-- - Auto price increases are current_date-dependent and apply weekly starting on
--   available_date.
-- - unit_price can change as the calendar date changes even when no row is updated.
-- - Order creation must snapshot trusted server-calculated pricing and must not rely
--   on historical public view output.


create or replace function public.calculate_inventory_unit_price(
  batch_base_price numeric,
  item_price_override numeric,
  auto_price_increase_enabled boolean,
  auto_price_increase_amount numeric,
  auto_price_increase_max_price numeric,
  available_date date
)
returns numeric(10, 2)
language sql
stable
set search_path = public
as $$
  with price_inputs as (
    select
      coalesce(item_price_override, batch_base_price) as starting_price,
      case
        when coalesce(auto_price_increase_enabled, false)
          and auto_price_increase_amount is not null
          and available_date <= current_date
          then floor((current_date - available_date)::numeric / 7)
        else 0
      end as elapsed_week_count
  ),
  calculated_price as (
    select
      starting_price,
      starting_price + (coalesce(auto_price_increase_amount, 0) * elapsed_week_count) as uncapped_price
    from price_inputs
  )
  select least(
    uncapped_price,
    coalesce(
      greatest(auto_price_increase_max_price, starting_price),
      uncapped_price
    )
  )::numeric(10, 2)
  from calculated_price;
$$;


comment on function public.calculate_inventory_unit_price(
  numeric,
  numeric,
  boolean,
  numeric,
  numeric,
  date
) is
'Calculates buyer-facing inventory unit price at query time. Auto price increases are current_date-dependent and apply weekly starting on available_date. Because this value can change as the date changes without row updates, order creation must snapshot trusted server-calculated pricing instead of relying on historical view output.';


create or replace view public.public_storefronts
with (security_barrier = true)
as
select
  stores.id as store_id,
  stores.store_slug,
  stores.store_name,
  stores.store_tagline,
  stores.public_city,
  stores.public_state,
  stores.public_country,
  stores.about_text,
  stores.pickup_policy,
  stores.cancellation_policy,
  stores.pickup_instructions,
  case
    when stores.show_public_email then stores.public_email
    else null
  end as public_email,
  case
    when stores.show_public_phone then stores.public_phone
    else null
  end as public_phone,
  stores.website_url,
  stores.social_url,
  case
    when stores.show_npip then stores.npip_number
    else null
  end as npip_number,
  hero_media.image_url as hero_image_url,
  hero_media.alt_text as hero_image_alt_text,
  logo_media.image_url as logo_image_url,
  logo_media.alt_text as logo_image_alt_text
from public.stores
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
    and media_links.display_context = 'hero'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as hero_media on true
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
    and media_links.display_context = 'logo'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as logo_media on true
where stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null;


comment on view public.public_storefronts is
'Official buyer-facing public store profile projection. Exposes only public-safe storefront fields and approved linked store hero/logo media. Public clients should use this view instead of querying stores directly.';


create or replace view public.public_listing_batches
with (security_barrier = true)
as
select
  listing_batches.id as listing_batch_id,
  listing_batches.store_id,
  stores.store_slug,
  listing_batches.species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  listing_batches.batch_type,
  listing_batches.available_date,
  case
    when listing_batches.batch_type = 'live_animals'
      then listing_batches.age_at_availability_days
    else null
  end as age_at_availability_days,
  listing_batches.available_date <= current_date as is_available_now,
  case
    when listing_batches.visibility_status = 'sold_out' then 'sold_out'
    when listing_batches.available_date > current_date then 'coming_soon'
    else 'available'
  end as batch_availability_status
from public.listing_batches
join public.stores
  on stores.id = listing_batches.store_id
join public.species
  on species.id = listing_batches.species_id
where stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and species.is_active = true
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batches.moderation_status = 'normal';


comment on view public.public_listing_batches is
'Official buyer-facing public batch projection. Supports storefront views without exposing internal batch labels, seller notes, moderation fields, or raw pricing internals.';


create or replace view public.public_inventory_items
with (security_barrier = true)
as
select
  inventory_items.id as inventory_item_id,
  inventory_items.store_id,
  stores.store_slug,
  listing_batches.id as listing_batch_id,
  listing_batch_breeds.id as listing_batch_breed_id,
  seller_breed_profiles.id as seller_breed_profile_id,
  species.id as species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  seller_breed_profiles.display_name as breed_display_name,
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
    listing_batches.auto_price_increase_enabled,
    listing_batches.auto_price_increase_amount,
    listing_batches.auto_price_increase_max_price,
    listing_batches.available_date
  ) as unit_price,
  inventory_items.sort_order
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
where stores.store_status = 'live'
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


comment on view public.public_inventory_items is
'Official buyer-facing public inventory projection. Exposes quantity_available, availability_status, and computed unit_price without exposing private seller notes, moderation fields, or raw pricing internals. unit_price is current_date-dependent through calculate_inventory_unit_price.';


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
    listing_batches.auto_price_increase_enabled,
    listing_batches.auto_price_increase_amount,
    listing_batches.auto_price_increase_max_price,
    listing_batches.available_date
  ) as unit_price,
  coalesce(
    inventory_media.image_url,
    batch_breed_media.image_url,
    batch_media.image_url,
    breed_profile_media.image_url,
    store_media.image_url
  ) as featured_image_url,
  coalesce(
    inventory_media.alt_text,
    batch_breed_media.alt_text,
    batch_media.alt_text,
    breed_profile_media.alt_text,
    store_media.alt_text
  ) as featured_image_alt_text,
  listing_batch_breeds.sort_order as breed_sort_order,
  inventory_items.sort_order as inventory_sort_order
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
  where media_links.store_id = listing_batch_breeds.store_id
    and media_links.entity_type = 'listing_batch_breed'
    and media_links.entity_id = listing_batch_breeds.id
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as batch_breed_media on true
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = listing_batches.store_id
    and media_links.entity_type = 'listing_batch'
    and media_links.entity_id = listing_batches.id
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as batch_media on true
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
where stores.store_status = 'live'
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


comment on view public.public_storefront_breed_inventory is
'Primary official buyer-facing storefront projection. One enriched public inventory row per item; frontend groups rows into breed-first storefront cards. Exposes buyer-safe fields only and applies featured image fallback from inventory item, listing batch breed, listing batch, seller breed profile, then store. unit_price is current_date-dependent through calculate_inventory_unit_price.';
