-- Fix public storefront preview regression from Group 70B.
--
-- get_public_storefront_home was introduced as a slug-scoped public helper, but
-- it read public.stores as the anon caller. public.stores intentionally has no
-- public read RLS policy, so the public storefront page could not see otherwise
-- live stores. Keep stores private and make this public-safe RPC follow the
-- existing get_storefront_public_status pattern.

create or replace function public.get_public_storefront_home(
  p_store_slug text
)
returns table (
  store_id uuid,
  store_slug text,
  store_name text,
  store_tagline text,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,
  public_email text,
  public_phone text,
  website_url text,
  social_url text,
  npip_number text,
  hero_image_url text,
  hero_image_alt_text text,
  logo_image_url text,
  logo_image_alt_text text,
  public_inventory_item_count bigint,
  ready_now_item_count bigint,
  reserve_now_item_count bigint,
  sold_out_item_count bigint,
  total_quantity_available bigint,
  next_available_date date,
  has_public_inventory boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with storefront_status as (
    select *
    from public.get_storefront_public_status(p_store_slug)
  ),
  target_store as (
    select stores.*
    from public.stores
    join storefront_status
      on storefront_status.store_slug = stores.store_slug
    where storefront_status.store_exists = true
      and storefront_status.is_publicly_available = true
  ),
  public_inventory as (
    select
      inventory_items.quantity_available,
      listing_batches.available_date,
      case
        when listing_batches.visibility_status = 'sold_out'
          or inventory_items.quantity_available <= 0
          then 'sold_out'
        when listing_batches.available_date > current_date
          then 'reserve_now'
        else 'ready_now'
      end as buyer_availability_code
    from target_store
    join public.inventory_items
      on inventory_items.store_id = target_store.id
    join public.listing_batches
      on listing_batches.id = inventory_items.listing_batch_id
     and listing_batches.store_id = target_store.id
    join public.listing_batch_breeds
      on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
     and listing_batch_breeds.store_id = target_store.id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
     and seller_breed_profiles.store_id = target_store.id
    join public.species
      on species.id = listing_batches.species_id
    where species.is_active = true
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
      )
  ),
  inventory_summary as (
    select
      count(*) as public_inventory_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'ready_now'
      ) as ready_now_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'reserve_now'
      ) as reserve_now_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'sold_out'
      ) as sold_out_item_count,
      coalesce(sum(public_inventory.quantity_available), 0)::bigint as total_quantity_available,
      min(public_inventory.available_date) filter (
        where public_inventory.quantity_available > 0
      ) as next_available_date
    from public_inventory
  )
  select
    target_store.id as store_id,
    target_store.store_slug,
    target_store.store_name,
    target_store.store_tagline,
    target_store.public_city,
    target_store.public_state,
    target_store.public_country,
    target_store.about_text,
    target_store.pickup_policy,
    target_store.cancellation_policy,
    target_store.pickup_instructions,
    case
      when target_store.show_public_email then target_store.public_email
      else null
    end as public_email,
    case
      when target_store.show_public_phone then target_store.public_phone
      else null
    end as public_phone,
    target_store.website_url,
    target_store.social_url,
    case
      when target_store.show_npip then target_store.npip_number
      else null
    end as npip_number,
    hero_media.image_url as hero_image_url,
    hero_media.alt_text as hero_image_alt_text,
    logo_media.image_url as logo_image_url,
    logo_media.alt_text as logo_image_alt_text,
    coalesce(inventory_summary.public_inventory_item_count, 0),
    coalesce(inventory_summary.ready_now_item_count, 0),
    coalesce(inventory_summary.reserve_now_item_count, 0),
    coalesce(inventory_summary.sold_out_item_count, 0),
    coalesce(inventory_summary.total_quantity_available, 0),
    inventory_summary.next_available_date,
    coalesce(inventory_summary.public_inventory_item_count, 0) > 0
  from target_store
  cross join inventory_summary
  left join lateral (
    select
      '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links
    join public.media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.store_id = target_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = target_store.id
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
    where media_links.store_id = target_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = target_store.id
      and media_links.display_context = 'logo'
      and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
    limit 1
  ) as logo_media on true;
$$;

comment on function public.get_public_storefront_home(text) is
'Slug-scoped public storefront home payload. Uses get_storefront_public_status for public availability and returns only public-safe storefront fields.';

revoke all on function public.get_public_storefront_home(text) from public;
grant execute on function public.get_public_storefront_home(text) to anon, authenticated;
