begin;

-- Each live-bird sellable row may have one buyer-facing option photo. Keep the
-- restriction isolated to active image gallery links on live-animal inventory.
create or replace function public.enforce_live_bird_inventory_entry_photo_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_is_live_bird boolean;
begin
  if new.entity_type <> 'inventory_item'
    or new.display_context <> 'gallery'
    or new.visibility_status <> 'active' then
    return new;
  end if;

  select listing_batches.batch_type = 'live_animals'
  into v_is_live_bird
  from public.inventory_items
  join public.listing_batches on listing_batches.id = inventory_items.listing_batch_id
  where inventory_items.id = new.entity_id
    and inventory_items.store_id = new.store_id;

  if coalesce(v_is_live_bird, false)
    and exists (
      select 1
      from public.media_assets
      where media_assets.id = new.media_asset_id
        and media_assets.store_id = new.store_id
        and media_assets.content_type like 'image/%'
    ) then
    -- The upload reaches storage before metadata is created. Archive an older
    -- active option image in this transaction so a replacement never leaves two.
    update public.media_links as existing_links
    set visibility_status = 'archived', is_featured = false, updated_at = now()
    from public.media_assets as existing_assets
    where existing_links.entity_type = 'inventory_item'
      and existing_links.entity_id = new.entity_id
      and existing_links.display_context = 'gallery'
      and existing_links.visibility_status = 'active'
      and existing_links.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and existing_assets.id = existing_links.media_asset_id
      and existing_assets.store_id = existing_links.store_id
      and existing_assets.content_type like 'image/%';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_live_bird_inventory_entry_photo_limit_trigger on public.media_links;
create trigger enforce_live_bird_inventory_entry_photo_limit_trigger
before insert or update of entity_type, entity_id, display_context, visibility_status, media_asset_id
on public.media_links
for each row execute function public.enforce_live_bird_inventory_entry_photo_limit();

create or replace view public.public_storefront_breed_inventory
with (security_barrier = true)
as
select
  store_id, store_slug, seller_breed_profile_id, species_id, species_name,
  species_slug, breed_display_name, breed_description, listing_batch_id,
  listing_batch_breed_id, inventory_item_id, inventory_type,
  custom_inventory_label, quantity_available, availability_status,
  available_date, is_available_now, unit_price, featured_image_url,
  featured_image_alt_text, breed_sort_order, inventory_sort_order, batch_type,
  age_at_availability_days, entry_photo_url, entry_photo_alt
from (
  select
    stores.id as store_id, stores.store_slug,
    seller_breed_profiles.id as seller_breed_profile_id,
    species.id as species_id, species.common_name as species_name, species.slug as species_slug,
    seller_breed_profiles.display_name as breed_display_name,
    seller_breed_profiles.seller_description as breed_description,
    listing_batches.id as listing_batch_id, listing_batch_breeds.id as listing_batch_breed_id,
    inventory_items.id as inventory_item_id, inventory_items.inventory_type,
    inventory_items.custom_inventory_label, inventory_items.quantity_available,
    case when listing_batches.visibility_status = 'sold_out' or inventory_items.quantity_available <= 0 then 'sold_out'
         when listing_batches.available_date > current_date then 'coming_soon'
         when inventory_items.quantity_available <= 3 then 'limited_availability' else 'available' end as availability_status,
    listing_batches.available_date,
    (listing_batches.available_date <= current_date and listing_batches.visibility_status <> 'sold_out' and inventory_items.quantity_available > 0) as is_available_now,
    public.calculate_inventory_unit_price(listing_batches.base_price, inventory_items.price_override,
      listing_batches.auto_price_adjustment_enabled, listing_batches.price_adjustment_direction,
      listing_batches.price_adjustment_amount, listing_batches.price_adjustment_interval_weeks,
      listing_batches.price_adjustment_max_price, listing_batches.price_adjustment_min_price,
      listing_batches.available_date) as unit_price,
    coalesce(inventory_media.image_url, breed_profile_media.image_url, store_media.image_url) as featured_image_url,
    coalesce(inventory_media.alt_text, breed_profile_media.alt_text, store_media.alt_text) as featured_image_alt_text,
    listing_batch_breeds.sort_order as breed_sort_order, inventory_items.sort_order as inventory_sort_order,
    listing_batches.batch_type,
    case when listing_batches.batch_type = 'live_animals' then listing_batches.age_at_availability_days else null end as age_at_availability_days,
    inventory_media.image_url as entry_photo_url,
    inventory_media.alt_text as entry_photo_alt
  from public.inventory_items
  join public.listing_batch_breeds on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
  join public.listing_batches on listing_batches.id = inventory_items.listing_batch_id
  join public.seller_breed_profiles on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
  join public.stores on stores.id = inventory_items.store_id
  join public.species on species.id = listing_batches.species_id
  left join lateral (
    select '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links join public.media_assets on media_assets.id = media_links.media_asset_id and media_assets.store_id = media_links.store_id
    where media_links.store_id = inventory_items.store_id and media_links.entity_type = 'inventory_item'
      and media_links.entity_id = inventory_items.id and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active' and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at limit 1
  ) as inventory_media on true
  left join lateral (
    select '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links join public.media_assets on media_assets.id = media_links.media_asset_id and media_assets.store_id = media_links.store_id
    where media_links.store_id = seller_breed_profiles.store_id and media_links.entity_type = 'seller_breed_profile'
      and media_links.entity_id = seller_breed_profiles.id and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active' and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at limit 1
  ) as breed_profile_media on true
  left join lateral (
    select '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links join public.media_assets on media_assets.id = media_links.media_asset_id and media_assets.store_id = media_links.store_id
    where media_links.store_id = stores.id and media_links.entity_type = 'store' and media_links.entity_id = stores.id
      and media_links.visibility_status = 'active' and media_assets.asset_status = 'active' and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at limit 1
  ) as store_media on true
  where stores.storefront_enabled = true and stores.store_status = 'live' and stores.storefront_mode in ('hosted', 'embedded')
    and stores.admin_hold_reason is null and species.is_active = true
    and seller_breed_profiles.visibility_status = 'active' and seller_breed_profiles.moderation_status = 'normal'
    and listing_batches.visibility_status in ('active', 'sold_out') and listing_batches.moderation_status = 'normal'
    and listing_batch_breeds.visibility_status = 'active' and listing_batch_breeds.moderation_status = 'normal'
    and inventory_items.visibility_status = 'active' and inventory_items.moderation_status = 'normal'
    and ((listing_batches.batch_type = 'hatching_eggs' and inventory_items.inventory_type = 'hatching_eggs')
      or (listing_batches.batch_type = 'live_animals' and inventory_items.inventory_type <> 'hatching_eggs'))
) as entitlement_filtered
where public.store_has_active_entitlement(store_id);

create or replace view public.public_storefront_inventory
with (security_barrier = true)
as
select
  public_storefront_breed_inventory.store_id, public_storefront_breed_inventory.store_slug,
  public_storefront_breed_inventory.species_id, public_storefront_breed_inventory.species_name, public_storefront_breed_inventory.species_slug,
  public_storefront_breed_inventory.seller_breed_profile_id, public_storefront_breed_inventory.breed_display_name, public_storefront_breed_inventory.breed_description,
  public_storefront_breed_inventory.listing_batch_id, public_storefront_breed_inventory.listing_batch_breed_id, public_storefront_breed_inventory.inventory_item_id,
  public_storefront_breed_inventory.inventory_type, public_storefront_breed_inventory.custom_inventory_label, public_storefront_breed_inventory.quantity_available,
  case when public_storefront_breed_inventory.quantity_available <= 0 or public_storefront_breed_inventory.availability_status = 'sold_out' then 'sold_out'
       when public_storefront_breed_inventory.available_date > current_date then 'reserve_now' else 'ready_now' end as buyer_availability_code,
  case when public_storefront_breed_inventory.quantity_available <= 0 or public_storefront_breed_inventory.availability_status = 'sold_out' then 'Sold out'
       when public_storefront_breed_inventory.available_date > current_date then 'Reserve now' else 'Ready now' end as buyer_availability_label,
  public_storefront_breed_inventory.available_date, public_storefront_breed_inventory.is_available_now,
  (public_storefront_breed_inventory.quantity_available > 0 and public_storefront_breed_inventory.availability_status <> 'sold_out') as can_checkout,
  public_storefront_breed_inventory.unit_price, public_storefront_breed_inventory.featured_image_url, public_storefront_breed_inventory.featured_image_alt_text,
  public_storefront_breed_inventory.breed_sort_order, public_storefront_breed_inventory.inventory_sort_order, public_storefront_breed_inventory.batch_type,
  public_storefront_breed_inventory.age_at_availability_days, listing_batches.origin_date,
  seller_breed_profiles.breed_category, seller_breed_profiles.egg_color as breed_egg_color,
  seller_breed_profiles.annual_egg_production as breed_annual_egg_production,
  public_storefront_breed_inventory.entry_photo_url, public_storefront_breed_inventory.entry_photo_alt
from public.public_storefront_breed_inventory
join public.stores on stores.id = public_storefront_breed_inventory.store_id
join public.listing_batches on listing_batches.id = public_storefront_breed_inventory.listing_batch_id
left join public.seller_breed_profiles on seller_breed_profiles.id = public_storefront_breed_inventory.seller_breed_profile_id
where (coalesce(public_storefront_breed_inventory.batch_type, '') <> 'hatching_eggs'
  and coalesce(public_storefront_breed_inventory.inventory_type, '') <> 'hatching_eggs')
  or (stores.hatching_eggs_enabled = true and public.store_has_public_market_entitlement(stores.id));

grant select on public.public_storefront_breed_inventory, public.public_storefront_inventory to anon, authenticated;

commit;
