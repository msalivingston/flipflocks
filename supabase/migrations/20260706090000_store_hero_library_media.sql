begin;

alter table public.media_assets
drop constraint if exists media_assets_source_type_check;

alter table public.media_assets
add constraint media_assets_source_type_check check (
  source_type in (
    'seller_upload',
    'catalog_breed_image',
    'storefront_hero_library'
  )
);

comment on column public.media_assets.source_type is
'Source marker for seller media. seller_upload is normal seller-uploaded media; catalog_breed_image marks a restored default catalog breed image; storefront_hero_library marks a FlipFlocks-provided storefront hero image.';

create or replace function public.media_asset_public_url(
  p_source_type text,
  p_source_image_url text,
  p_bucket_name text,
  p_storage_path text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_source_type = 'storefront_hero_library' then p_source_image_url
    else '/storage/v1/object/public/' || p_bucket_name || '/' || p_storage_path
  end;
$$;

create or replace function public.is_storefront_hero_library_image(
  p_source_image_url text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_source_image_url = any(array[
    '/storefront-heroes/sunlit-pasture-flock.png',
    '/storefront-heroes/barnyard-golden-hour.png',
    '/storefront-heroes/open-field-chickens.png',
    '/storefront-heroes/mountain-farm-flock.png',
    '/storefront-heroes/coop-pathway-morning.png',
    '/storefront-heroes/pasture-hens-wide.png',
    '/storefront-heroes/farmhouse-flock-sunset.png',
    '/storefront-heroes/green-meadow-chickens.png',
    '/storefront-heroes/country-barn-flock.png',
    '/storefront-heroes/fence-line-poultry.png',
    '/storefront-heroes/orchard-hens.png',
    '/storefront-heroes/prairie-coop-flock.png',
    '/storefront-heroes/homestead-chickens.png',
    '/storefront-heroes/rolling-hills-flock.png',
    '/storefront-heroes/warm-coop-yard.png',
    '/storefront-heroes/family-farm-pasture.png',
    '/storefront-heroes/wide-farmstead-flock.png',
    '/storefront-heroes/quiet-country-coop.png'
  ]);
$$;

create or replace view public.seller_media_management as
select
  media_assets.id as media_asset_id,
  media_links.id as media_link_id,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  public.media_asset_public_url(
    media_assets.source_type,
    media_assets.source_image_url,
    media_assets.bucket_name,
    media_assets.storage_path
  ) as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_assets.alt_text as asset_alt_text,
  media_links.alt_text_override,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.moderation_status,
  media_assets.asset_status,
  media_links.visibility_status,
  media_assets.bucket_name,
  media_assets.storage_path,
  media_assets.original_filename,
  media_assets.content_type,
  media_assets.file_size_bytes,
  media_assets.width_px,
  media_assets.height_px,
  media_links.created_at as linked_at,
  media_links.updated_at as link_updated_at,
  media_assets.created_at as asset_created_at,
  media_assets.updated_at as asset_updated_at,
  media_assets.source_type,
  media_assets.source_breed_id,
  media_assets.source_image_url,
  media_links.crop_metadata
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
where public.owns_store(media_links.store_id)
   or public.is_admin();

create or replace function public.media_management_response_for_links(
  p_media_link_ids uuid[]
)
returns setof public.seller_media_management
language sql
stable
security definer
set search_path = public
as $$
  select
    media_assets.id as media_asset_id,
    media_links.id as media_link_id,
    media_links.store_id,
    media_links.entity_type,
    media_links.entity_id,
    media_links.display_context,
    public.media_asset_public_url(
      media_assets.source_type,
      media_assets.source_image_url,
      media_assets.bucket_name,
      media_assets.storage_path
    ) as public_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
    media_assets.alt_text as asset_alt_text,
    media_links.alt_text_override,
    media_links.caption,
    media_links.sort_order,
    media_links.is_featured,
    media_assets.moderation_status,
    media_assets.asset_status,
    media_links.visibility_status,
    media_assets.bucket_name,
    media_assets.storage_path,
    media_assets.original_filename,
    media_assets.content_type,
    media_assets.file_size_bytes,
    media_assets.width_px,
    media_assets.height_px,
    media_links.created_at as linked_at,
    media_links.updated_at as link_updated_at,
    media_assets.created_at as asset_created_at,
    media_assets.updated_at as asset_updated_at,
    media_assets.source_type,
    media_assets.source_breed_id,
    media_assets.source_image_url,
    media_links.crop_metadata
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.id = any(p_media_link_ids);
$$;

create or replace function public.seller_select_store_hero_library(
  p_store_id uuid,
  p_source_image_url text,
  p_alt_text text default null
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_image_url text := trim(p_source_image_url);
  v_media_asset public.media_assets;
  v_media_link public.media_links;
begin
  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to update store media';
  end if;

  if not public.is_storefront_hero_library_image(v_source_image_url) then
    raise exception 'Unsupported storefront hero library image';
  end if;

  update public.media_links
  set
    visibility_status = 'archived',
    is_featured = false,
    updated_at = now()
  where store_id = p_store_id
    and entity_type = 'store'
    and entity_id = p_store_id
    and display_context = 'hero'
    and visibility_status = 'active';

  insert into public.media_assets (
    store_id,
    uploaded_by_user_id,
    bucket_name,
    storage_path,
    original_filename,
    content_type,
    file_size_bytes,
    width_px,
    height_px,
    alt_text,
    asset_status,
    moderation_status,
    moderation_checked_at,
    source_type,
    source_image_url
  )
  values (
    p_store_id,
    auth.uid(),
    'flipflocks-public',
    'stores/' || p_store_id::text || '/library-hero/' || regexp_replace(v_source_image_url, '^.*/', ''),
    regexp_replace(v_source_image_url, '^.*/', ''),
    'image/png',
    1,
    2100,
    900,
    nullif(trim(p_alt_text), ''),
    'active',
    'approved',
    now(),
    'storefront_hero_library',
    v_source_image_url
  )
  on conflict (bucket_name, storage_path) do update
  set
    alt_text = excluded.alt_text,
    asset_status = 'active',
    moderation_status = 'approved',
    moderation_checked_at = now(),
    source_type = 'storefront_hero_library',
    source_image_url = excluded.source_image_url,
    width_px = 2100,
    height_px = 900,
    updated_at = now()
  returning * into v_media_asset;

  insert into public.media_links (
    store_id,
    media_asset_id,
    entity_type,
    entity_id,
    display_context,
    sort_order,
    is_featured,
    alt_text_override,
    visibility_status
  )
  values (
    p_store_id,
    v_media_asset.id,
    'store',
    p_store_id,
    'hero',
    0,
    true,
    nullif(trim(p_alt_text), ''),
    'active'
  )
  on conflict (entity_type, entity_id, media_asset_id) do update
  set
    display_context = 'hero',
    sort_order = 0,
    is_featured = true,
    alt_text_override = excluded.alt_text_override,
    visibility_status = 'active',
    updated_at = now()
  returning * into v_media_link;

  return query
  select *
  from public.media_management_response_for_links(array[v_media_link.id]);
end;
$$;

drop function if exists public.get_public_storefront_home(text);

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
  pickup_method text,
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
    target_store.pickup_method,
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
      public.media_asset_public_url(
        media_assets.source_type,
        media_assets.source_image_url,
        media_assets.bucket_name,
        media_assets.storage_path
      ) as image_url,
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
      public.media_asset_public_url(
        media_assets.source_type,
        media_assets.source_image_url,
        media_assets.bucket_name,
        media_assets.storage_path
      ) as image_url,
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
'Slug-scoped public storefront home payload. Uses get_storefront_public_status for public availability, respects disabled public selling modules in inventory summary counts, includes pickup_method, and returns only public-safe storefront fields.';

revoke all on function public.media_asset_public_url(text, text, text, text) from public;
revoke all on function public.is_storefront_hero_library_image(text) from public;
revoke all on function public.seller_select_store_hero_library(uuid, text, text) from public;
revoke all on function public.get_public_storefront_home(text) from public;

grant execute on function public.media_asset_public_url(text, text, text, text) to anon, authenticated;
grant execute on function public.is_storefront_hero_library_image(text) to authenticated;
grant execute on function public.seller_select_store_hero_library(uuid, text, text) to authenticated;
grant execute on function public.get_public_storefront_home(text) to anon, authenticated;

commit;
