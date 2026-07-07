begin;

create or replace function public.get_seller_storefront_home_preview(
  p_store_slug text
)
returns table (
  store_id uuid,
  store_slug text,
  store_name text,
  store_tagline text,
  hero_subheading text,
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
  hero_crop_metadata jsonb,
  hero_image_layout text,
  logo_image_url text,
  logo_image_alt_text text,
  public_inventory_item_count bigint,
  ready_now_item_count bigint,
  reserve_now_item_count bigint,
  sold_out_item_count bigint,
  total_quantity_available bigint,
  next_available_date date,
  has_public_inventory boolean,
  preview_is_hidden boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with target_store as (
    select stores.*
    from public.stores
    where stores.store_slug = p_store_slug
      and (public.owns_store(stores.id) or public.is_admin())
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
    target_store.hero_subheading,
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
    hero_media.crop_metadata as hero_crop_metadata,
    coalesce(hero_media.hero_layout, 'full') as hero_image_layout,
    logo_media.image_url as logo_image_url,
    logo_media.alt_text as logo_image_alt_text,
    coalesce(inventory_summary.public_inventory_item_count, 0),
    coalesce(inventory_summary.ready_now_item_count, 0),
    coalesce(inventory_summary.reserve_now_item_count, 0),
    coalesce(inventory_summary.sold_out_item_count, 0),
    coalesce(inventory_summary.total_quantity_available, 0),
    inventory_summary.next_available_date,
    coalesce(inventory_summary.public_inventory_item_count, 0) > 0,
    not (
      target_store.storefront_enabled = true
      and target_store.store_status = 'live'
      and target_store.storefront_mode in ('hosted', 'embedded')
      and target_store.admin_hold_reason is null
    ) as preview_is_hidden
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
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
      media_links.crop_metadata,
      media_links.hero_layout
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

comment on function public.get_seller_storefront_home_preview(text) is
'Authenticated seller/admin storefront preview payload for hidden store previews. Does not change public storefront availability.';

revoke all on function public.get_seller_storefront_home_preview(text) from public;
grant execute on function public.get_seller_storefront_home_preview(text) to authenticated;

commit;
