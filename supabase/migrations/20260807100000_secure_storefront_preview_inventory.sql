-- Seller-authorized buyer-safe inventory for hidden storefront home previews.
--
-- This intentionally leaves every public storefront view unchanged. The RPC
-- removes only the store publication gate and retains the item, module,
-- entitlement, species/profile, and media eligibility used by those views.

begin;

create or replace function public.get_seller_storefront_preview_data(
  p_store_slug text
)
returns table (
  storefront_home jsonb,
  inventory jsonb,
  equipment jsonb,
  hatching_eggs jsonb,
  processed_poultry jsonb,
  live_poultry_profile_images jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_store_id uuid;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  select stores.id
  into v_store_id
  from public.stores as stores
  where stores.store_slug = p_store_slug;

  if v_store_id is null
     or not (public.owns_store(v_store_id) or public.is_admin()) then
    raise exception using
      errcode = '42501',
      message = 'Storefront preview is not available for this account.';
  end if;

  return query
  with target_store as (
    select stores.*
    from public.stores as stores
    where stores.id = v_store_id
  ),
  target_entitlement as (
    select
      entitlement.has_active_access,
      entitlement.effective_plan_key,
      entitlement.held
    from target_store
    cross join lateral public.resolve_store_entitlement(target_store.id)
      as entitlement
  ),
  preview_inventory as (
    select
      target_store.id as store_id,
      target_store.store_slug,
      species.id as species_id,
      species.common_name as species_name,
      species.slug as species_slug,
      seller_breed_profiles.id as seller_breed_profile_id,
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
          then 'reserve_now'
        else 'ready_now'
      end as buyer_availability_code,
      case
        when listing_batches.visibility_status = 'sold_out'
          or inventory_items.quantity_available <= 0
          then 'Sold out'
        when listing_batches.available_date > current_date
          then 'Reserve now'
        else 'Ready now'
      end as buyer_availability_label,
      listing_batches.available_date,
      (
        listing_batches.available_date <= current_date
        and listing_batches.visibility_status <> 'sold_out'
        and inventory_items.quantity_available > 0
      ) as is_available_now,
      (
        inventory_items.quantity_available > 0
        and listing_batches.visibility_status <> 'sold_out'
      ) as can_checkout,
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
      listing_batches.age_at_availability_days,
      listing_batches.origin_date,
      coalesce(seller_breed_profiles.bird_type, breeds.bird_type)
        as breed_bird_type,
      coalesce(seller_breed_profiles.egg_color, breeds.egg_color)
        as breed_egg_color,
      coalesce(
        seller_breed_profiles.annual_egg_production,
        breeds.annual_egg_production
      ) as breed_annual_egg_production
    from target_store
    join public.inventory_items as inventory_items
      on inventory_items.store_id = target_store.id
    join public.listing_batch_breeds as listing_batch_breeds
      on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
     and listing_batch_breeds.store_id = target_store.id
    join public.listing_batches as listing_batches
      on listing_batches.id = inventory_items.listing_batch_id
     and listing_batches.store_id = target_store.id
    join public.seller_breed_profiles as seller_breed_profiles
      on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
     and seller_breed_profiles.store_id = target_store.id
    join public.species as species
      on species.id = listing_batches.species_id
    left join public.breeds as breeds
      on breeds.id = seller_breed_profiles.breed_id
    left join lateral (
      select
        '/storage/v1/object/public/' || media_assets.bucket_name || '/' ||
          media_assets.storage_path as image_url,
        coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
      from public.media_links as media_links
      join public.media_assets as media_assets
        on media_assets.id = media_links.media_asset_id
       and media_assets.store_id = media_links.store_id
      where media_links.store_id = target_store.id
        and media_links.entity_type = 'inventory_item'
        and media_links.entity_id = inventory_items.id
        and media_links.visibility_status = 'active'
        and media_assets.asset_status = 'active'
        and media_assets.moderation_status = 'approved'
      order by
        media_links.is_featured desc,
        media_links.sort_order,
        media_links.created_at
      limit 1
    ) as inventory_media on true
    left join lateral (
      select
        '/storage/v1/object/public/' || media_assets.bucket_name || '/' ||
          media_assets.storage_path as image_url,
        coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
      from public.media_links as media_links
      join public.media_assets as media_assets
        on media_assets.id = media_links.media_asset_id
       and media_assets.store_id = media_links.store_id
      where media_links.store_id = target_store.id
        and media_links.entity_type = 'seller_breed_profile'
        and media_links.entity_id = seller_breed_profiles.id
        and media_links.visibility_status = 'active'
        and media_assets.asset_status = 'active'
        and media_assets.moderation_status = 'approved'
      order by
        media_links.is_featured desc,
        media_links.sort_order,
        media_links.created_at
      limit 1
    ) as breed_profile_media on true
    left join lateral (
      select
        '/storage/v1/object/public/' || media_assets.bucket_name || '/' ||
          media_assets.storage_path as image_url,
        coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
      from public.media_links as media_links
      join public.media_assets as media_assets
        on media_assets.id = media_links.media_asset_id
       and media_assets.store_id = media_links.store_id
      where media_links.store_id = target_store.id
        and media_links.entity_type = 'store'
        and media_links.entity_id = target_store.id
        and media_links.visibility_status = 'active'
        and media_assets.asset_status = 'active'
        and media_assets.moderation_status = 'approved'
      order by
        media_links.is_featured desc,
        media_links.sort_order,
        media_links.created_at
      limit 1
    ) as store_media on true
    where species.is_active = true
      and seller_breed_profiles.visibility_status = 'active'
      and seller_breed_profiles.moderation_status = 'normal'
      and listing_batches.visibility_status in ('active', 'sold_out')
      and listing_batches.moderation_status = 'normal'
      and listing_batch_breeds.visibility_status = 'active'
      and listing_batch_breeds.moderation_status = 'normal'
      and inventory_items.visibility_status = 'active'
      and inventory_items.moderation_status = 'normal'
      and listing_batches.batch_type = 'live_animals'
      and inventory_items.inventory_type <> 'hatching_eggs'
  ),
  preview_equipment as (
    select
      target_store.id as store_id,
      target_store.store_slug,
      equipment_items.id as equipment_inventory_item_id,
      'equipment_inventory'::text as item_type,
      equipment_items.item_name,
      equipment_items.category,
      equipment_items.condition,
      equipment_items.description,
      equipment_items.quantity_available,
      'ready_now'::text as buyer_availability_code,
      'Available'::text as buyer_availability_label,
      true as can_checkout,
      equipment_items.price as unit_price,
      equipment_media.image_url as featured_image_url,
      equipment_media.alt_text as featured_image_alt_text,
      equipment_items.updated_at,
      equipment_items.available_date
    from target_store
    cross join target_entitlement
    join public.equipment_inventory_items as equipment_items
      on equipment_items.store_id = target_store.id
    left join lateral (
      select
        '/storage/v1/object/public/' || media_assets.bucket_name || '/' ||
          media_assets.storage_path as image_url,
        coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
      from public.media_links as media_links
      join public.media_assets as media_assets
        on media_assets.id = media_links.media_asset_id
       and media_assets.store_id = media_links.store_id
      where media_links.store_id = target_store.id
        and media_links.entity_type = 'equipment_inventory_item'
        and media_links.entity_id = equipment_items.id
        and media_links.display_context = 'gallery'
        and media_links.visibility_status = 'active'
        and media_assets.asset_status = 'active'
        and media_assets.moderation_status = 'approved'
      order by
        media_links.is_featured desc,
        media_links.sort_order,
        media_links.created_at
      limit 1
    ) as equipment_media on true
    where target_entitlement.has_active_access = true
      and target_entitlement.held = false
      and target_entitlement.effective_plan_key = 'full_flock'
      and target_store.equipment_supplies_enabled = true
      and equipment_items.visibility_status = 'active'
      and equipment_items.moderation_status = 'normal'
      and equipment_items.quantity_available > 0
      and equipment_items.available_date <= current_date
  ),
  preview_hatching_eggs as (
    select
      target_store.id as store_id,
      target_store.store_slug,
      hatching_items.id as hatching_egg_inventory_item_id,
      'hatching_egg_inventory'::text as item_type,
      (
        'he-' || md5(
          hatching_items.store_id::text || ':' ||
          lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g'))
        )
      ) as hatching_egg_product_id,
      lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g'))
        as normalized_item_name,
      hatching_items.item_name,
      hatching_items.species_id,
      species.common_name as species_name,
      species.slug as species_slug,
      hatching_items.description,
      hatching_items.quantity_available,
      case
        when hatching_items.available_date > current_date then 'reserve_now'
        else 'ready_now'
      end as buyer_availability_code,
      case
        when hatching_items.available_date > current_date then 'Reserve now'
        else 'Ready now'
      end as buyer_availability_label,
      hatching_items.available_date,
      hatching_items.available_date <= current_date as is_available_now,
      (
        hatching_items.quantity_available >=
          coalesce(hatching_items.minimum_order_quantity, 1)
      ) as can_checkout,
      hatching_items.price as unit_price,
      hatching_items.minimum_order_quantity,
      hatching_media.image_url as featured_image_url,
      hatching_media.alt_text as featured_image_alt_text,
      hatching_items.created_at,
      hatching_items.updated_at
    from target_store
    cross join target_entitlement
    join public.hatching_egg_inventory_items as hatching_items
      on hatching_items.store_id = target_store.id
    join public.species as species
      on species.id = hatching_items.species_id
    left join lateral (
      select
        '/storage/v1/object/public/' || media_assets.bucket_name || '/' ||
          media_assets.storage_path as image_url,
        coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
      from public.media_links as media_links
      join public.media_assets as media_assets
        on media_assets.id = media_links.media_asset_id
       and media_assets.store_id = media_links.store_id
      where media_links.store_id = target_store.id
        and media_links.entity_type = 'hatching_egg_inventory_item'
        and media_links.entity_id = hatching_items.id
        and media_links.display_context = 'gallery'
        and media_links.visibility_status = 'active'
        and media_assets.asset_status = 'active'
        and media_assets.moderation_status = 'approved'
      order by
        media_links.is_featured desc,
        media_links.sort_order,
        media_links.created_at
      limit 1
    ) as hatching_media on true
    where target_entitlement.has_active_access = true
      and target_entitlement.held = false
      and target_entitlement.effective_plan_key = 'full_flock'
      and target_store.hatching_eggs_enabled = true
      and hatching_items.visibility_status = 'active'
      and hatching_items.moderation_status = 'normal'
      and hatching_items.archived_at is null
      and species.is_active = true
      and hatching_items.quantity_available > 0
  ),
  preview_processed_poultry as (
    select
      target_store.id as store_id,
      target_store.store_slug,
      processed_items.id as processed_poultry_inventory_item_id,
      'processed_poultry_inventory'::text as item_type,
      processed_items.product_name,
      processed_items.poultry_type,
      processed_items.product_type,
      processed_items.package_size,
      processed_items.description,
      processed_items.quantity_available,
      'ready_now'::text as buyer_availability_code,
      'Available'::text as buyer_availability_label,
      true as can_checkout,
      processed_items.price as unit_price,
      processed_media.image_url as featured_image_url,
      processed_media.alt_text as featured_image_alt_text,
      processed_items.updated_at,
      processed_items.species_id,
      coalesce(species.common_name, processed_items.poultry_type) as species_name,
      species.slug as species_slug,
      processed_items.available_date
    from target_store
    cross join target_entitlement
    join public.processed_poultry_inventory_items as processed_items
      on processed_items.store_id = target_store.id
    left join public.species as species
      on species.id = processed_items.species_id
    left join lateral (
      select
        '/storage/v1/object/public/' || media_assets.bucket_name || '/' ||
          media_assets.storage_path as image_url,
        coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
      from public.media_links as media_links
      join public.media_assets as media_assets
        on media_assets.id = media_links.media_asset_id
       and media_assets.store_id = media_links.store_id
      where media_links.store_id = target_store.id
        and media_links.entity_type = 'processed_poultry_inventory_item'
        and media_links.entity_id = processed_items.id
        and media_links.display_context = 'gallery'
        and media_links.visibility_status = 'active'
        and media_assets.asset_status = 'active'
        and media_assets.moderation_status = 'approved'
      order by
        media_links.is_featured desc,
        media_links.sort_order,
        media_links.created_at
      limit 1
    ) as processed_media on true
    where target_entitlement.has_active_access = true
      and target_entitlement.held = false
      and target_entitlement.effective_plan_key = 'full_flock'
      and target_store.processed_poultry_enabled = true
      and processed_items.visibility_status = 'active'
      and processed_items.moderation_status = 'normal'
      and processed_items.quantity_available > 0
      and processed_items.available_date <= current_date
  ),
  eligible_profile_media as (
    select distinct on (media_links.entity_id)
      media_links.entity_id as seller_breed_profile_id,
      '/storage/v1/object/public/' || media_assets.bucket_name || '/' ||
        media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from preview_inventory
    join public.media_links as media_links
      on media_links.store_id = v_store_id
     and media_links.entity_type = 'seller_breed_profile'
     and media_links.entity_id = preview_inventory.seller_breed_profile_id
    join public.media_assets as media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved'
    order by
      media_links.entity_id,
      media_links.is_featured desc,
      media_links.sort_order,
      media_links.created_at
  ),
  summary_rows as (
    select
      preview_inventory.quantity_available,
      preview_inventory.available_date,
      preview_inventory.buyer_availability_code
    from preview_inventory
    union all
    select
      preview_equipment.quantity_available,
      preview_equipment.available_date,
      preview_equipment.buyer_availability_code
    from preview_equipment
    union all
    select
      preview_hatching_eggs.quantity_available,
      preview_hatching_eggs.available_date,
      preview_hatching_eggs.buyer_availability_code
    from preview_hatching_eggs
    union all
    select
      preview_processed_poultry.quantity_available,
      preview_processed_poultry.available_date,
      preview_processed_poultry.buyer_availability_code
    from preview_processed_poultry
  ),
  inventory_summary as (
    select
      count(*) as item_count,
      count(*) filter (where buyer_availability_code = 'ready_now')
        as ready_now_item_count,
      count(*) filter (where buyer_availability_code = 'reserve_now')
        as reserve_now_item_count,
      count(*) filter (where buyer_availability_code = 'sold_out')
        as sold_out_item_count,
      coalesce(sum(quantity_available), 0)::bigint as total_quantity_available,
      min(available_date) filter (where quantity_available > 0)
        as next_available_date
    from summary_rows
  ),
  home_payload as (
    select
      to_jsonb(home_preview) || jsonb_build_object(
        'public_inventory_item_count', inventory_summary.item_count,
        'ready_now_item_count', inventory_summary.ready_now_item_count,
        'reserve_now_item_count', inventory_summary.reserve_now_item_count,
        'sold_out_item_count', inventory_summary.sold_out_item_count,
        'total_quantity_available', inventory_summary.total_quantity_available,
        'next_available_date', inventory_summary.next_available_date,
        'has_public_inventory', inventory_summary.item_count > 0
      ) as storefront_home
    from public.get_seller_storefront_home_preview(p_store_slug) as home_preview
    cross join inventory_summary
  ),
  inventory_payload as (
    select coalesce(
      jsonb_agg(
        to_jsonb(preview_inventory)
        order by breed_sort_order nulls last,
          inventory_sort_order nulls last,
          available_date
      ),
      '[]'::jsonb
    ) as inventory
    from preview_inventory
  ),
  equipment_payload as (
    select coalesce(
      jsonb_agg(
        to_jsonb(preview_equipment)
        order by category, item_name
      ),
      '[]'::jsonb
    ) as equipment
    from preview_equipment
  ),
  hatching_egg_payload as (
    select coalesce(
      jsonb_agg(
        to_jsonb(preview_hatching_eggs)
        order by normalized_item_name, available_date, unit_price
      ),
      '[]'::jsonb
    ) as hatching_eggs
    from preview_hatching_eggs
  ),
  processed_poultry_payload as (
    select coalesce(
      jsonb_agg(
        to_jsonb(preview_processed_poultry)
        order by poultry_type, product_type, product_name
      ),
      '[]'::jsonb
    ) as processed_poultry
    from preview_processed_poultry
  ),
  profile_image_payload as (
    select coalesce(
      jsonb_object_agg(
        seller_breed_profile_id::text,
        jsonb_build_object('imageAlt', alt_text, 'imageUrl', image_url)
      ),
      '{}'::jsonb
    ) as live_poultry_profile_images
    from eligible_profile_media
  )
  select
    home_payload.storefront_home,
    inventory_payload.inventory,
    equipment_payload.equipment,
    hatching_egg_payload.hatching_eggs,
    processed_poultry_payload.processed_poultry,
    profile_image_payload.live_poultry_profile_images
  from home_payload
  cross join inventory_payload
  cross join equipment_payload
  cross join hatching_egg_payload
  cross join processed_poultry_payload
  cross join profile_image_payload;
end;
$function$;

comment on function public.get_seller_storefront_preview_data(text) is
'Authenticated owner/platform-admin storefront home preview. Returns buyer-safe eligible inventory and approved media while bypassing only the store publication gate; public storefront views remain unchanged.';

revoke all on function public.get_seller_storefront_preview_data(text)
from public, anon, authenticated, service_role;
grant execute on function public.get_seller_storefront_preview_data(text)
to authenticated;

commit;
