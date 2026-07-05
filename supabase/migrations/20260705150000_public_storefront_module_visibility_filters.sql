-- Hide disabled selling modules from buyer-facing storefront projections.
--
-- These filters treat seller module preferences as public visibility settings.
-- They do not modify or delete inventory; re-enabling the module makes the same
-- eligible public inventory visible again.

create or replace view public.public_storefront_inventory
with (security_barrier = true)
as
select
  public_storefront_breed_inventory.store_id,
  public_storefront_breed_inventory.store_slug,
  public_storefront_breed_inventory.species_id,
  public_storefront_breed_inventory.species_name,
  public_storefront_breed_inventory.species_slug,
  public_storefront_breed_inventory.seller_breed_profile_id,
  public_storefront_breed_inventory.breed_display_name,
  public_storefront_breed_inventory.breed_description,
  public_storefront_breed_inventory.listing_batch_id,
  public_storefront_breed_inventory.listing_batch_breed_id,
  public_storefront_breed_inventory.inventory_item_id,
  public_storefront_breed_inventory.inventory_type,
  public_storefront_breed_inventory.custom_inventory_label,
  public_storefront_breed_inventory.quantity_available,
  case
    when public_storefront_breed_inventory.quantity_available <= 0
      or public_storefront_breed_inventory.availability_status = 'sold_out'
      then 'sold_out'
    when public_storefront_breed_inventory.available_date > current_date
      then 'reserve_now'
    else 'ready_now'
  end as buyer_availability_code,
  case
    when public_storefront_breed_inventory.quantity_available <= 0
      or public_storefront_breed_inventory.availability_status = 'sold_out'
      then 'Sold out'
    when public_storefront_breed_inventory.available_date > current_date
      then 'Reserve now'
    else 'Ready now'
  end as buyer_availability_label,
  public_storefront_breed_inventory.available_date,
  public_storefront_breed_inventory.is_available_now,
  (
    public_storefront_breed_inventory.quantity_available > 0
    and public_storefront_breed_inventory.availability_status <> 'sold_out'
  ) as can_checkout,
  public_storefront_breed_inventory.unit_price,
  public_storefront_breed_inventory.featured_image_url,
  public_storefront_breed_inventory.featured_image_alt_text,
  public_storefront_breed_inventory.breed_sort_order,
  public_storefront_breed_inventory.inventory_sort_order,
  public_storefront_breed_inventory.batch_type,
  public_storefront_breed_inventory.age_at_availability_days
from public.public_storefront_breed_inventory
join public.stores
  on stores.id = public_storefront_breed_inventory.store_id
left join public.seller_billing_status
  on seller_billing_status.store_id = stores.id
where (
    coalesce(public_storefront_breed_inventory.batch_type, '') <> 'hatching_eggs'
    and coalesce(public_storefront_breed_inventory.inventory_type, '') <> 'hatching_eggs'
  )
  or (
    stores.hatching_eggs_enabled = true
    and coalesce(seller_billing_status.plan_key, 'full_flock') <> 'small_flock'
  );

comment on view public.public_storefront_inventory is
'Buyer-facing storefront inventory projection for V1 UI. Reuses the official public storefront inventory layer, hides hatching egg rows when the seller disables that public module, exposes only public-safe fields including batch_type and age_at_availability_days for buyer option labels, and translates availability to the approved buyer labels: Ready now, Reserve now, and Sold out.';

grant select on public.public_storefront_inventory to anon, authenticated;

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
left join public.seller_billing_status
  on seller_billing_status.store_id = stores.id
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
  and coalesce(seller_billing_status.plan_key, 'full_flock') <> 'small_flock'
  and stores.equipment_supplies_enabled = true
  and equipment_inventory_items.visibility_status = 'active'
  and equipment_inventory_items.moderation_status = 'normal'
  and equipment_inventory_items.quantity_available > 0
  and equipment_inventory_items.available_date <= current_date;

comment on view public.public_storefront_equipment_inventory is
'Buyer-facing public Equipment & Supplies inventory projection. Exposes active in-stock equipment rows only when the seller has enabled the public Equipment & Supplies module and the item is available today or earlier.';

grant select on public.public_storefront_equipment_inventory to anon, authenticated;

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
  (
    processed_items.quantity_available > 0
    and processed_items.available_date <= current_date
  ) as can_checkout,
  processed_items.price as unit_price,
  processed_media.image_url as featured_image_url,
  processed_media.alt_text as featured_image_alt_text,
  processed_items.updated_at,
  processed_items.species_id,
  coalesce(species.common_name, processed_items.poultry_type) as species_name,
  species.slug as species_slug,
  processed_items.available_date
from public.processed_poultry_inventory_items as processed_items
join public.stores as stores
  on stores.id = processed_items.store_id
left join public.seller_billing_status
  on seller_billing_status.store_id = stores.id
left join public.species as species
  on species.id = processed_items.species_id
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
  and coalesce(seller_billing_status.plan_key, 'full_flock') <> 'small_flock'
  and stores.processed_poultry_enabled = true
  and processed_items.visibility_status = 'active'
  and processed_items.moderation_status = 'normal'
  and processed_items.quantity_available > 0
  and processed_items.available_date <= current_date;

comment on view public.public_storefront_processed_poultry_inventory is
'Buyer-facing public Processed Poultry inventory projection. Exposes active in-stock processed poultry rows only when the seller has enabled the public Processed Poultry module and the item is available today or earlier.';

grant select on public.public_storefront_processed_poultry_inventory to anon, authenticated;

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
      public_storefront_inventory.quantity_available,
      public_storefront_inventory.available_date,
      public_storefront_inventory.buyer_availability_code
    from target_store
    join public.public_storefront_inventory
      on public_storefront_inventory.store_id = target_store.id
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
'Slug-scoped public storefront home payload. Uses get_storefront_public_status for public availability, respects disabled public selling modules in inventory summary counts, and returns only public-safe storefront fields.';

revoke all on function public.get_public_storefront_home(text) from public;
grant execute on function public.get_public_storefront_home(text) to anon, authenticated;
