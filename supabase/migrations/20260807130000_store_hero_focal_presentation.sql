begin;

alter table public.media_links
add column if not exists hero_presentation jsonb;

comment on column public.media_links.hero_presentation is
'Hero-only focal positioning. desktop is required and mobile is an optional override; each focal point contains normalized x/y percentages from 0 through 100. Generic crop_metadata remains unchanged for non-hero media.';

create or replace function public.is_valid_store_hero_presentation(
  p_presentation jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $function$
  select case
    when p_presentation is null
      or jsonb_typeof(p_presentation) <> 'object'
      or not (p_presentation ? 'desktop')
      or (p_presentation - 'desktop' - 'mobile') <> '{}'::jsonb
      or jsonb_typeof(p_presentation -> 'desktop') <> 'object'
      or ((p_presentation -> 'desktop') - 'x' - 'y') <> '{}'::jsonb
      or not (p_presentation -> 'desktop' ? 'x')
      or not (p_presentation -> 'desktop' ? 'y')
      or jsonb_typeof(p_presentation -> 'desktop' -> 'x') <> 'number'
      or jsonb_typeof(p_presentation -> 'desktop' -> 'y') <> 'number'
      then false
    when ((p_presentation -> 'desktop' ->> 'x')::numeric not between 0 and 100)
      or ((p_presentation -> 'desktop' ->> 'y')::numeric not between 0 and 100)
      then false
    when p_presentation ? 'mobile' then
      case
        when jsonb_typeof(p_presentation -> 'mobile') <> 'object'
          or ((p_presentation -> 'mobile') - 'x' - 'y') <> '{}'::jsonb
          or not (p_presentation -> 'mobile' ? 'x')
          or not (p_presentation -> 'mobile' ? 'y')
          or jsonb_typeof(p_presentation -> 'mobile' -> 'x') <> 'number'
          or jsonb_typeof(p_presentation -> 'mobile' -> 'y') <> 'number'
          then false
        else ((p_presentation -> 'mobile' ->> 'x')::numeric between 0 and 100)
          and ((p_presentation -> 'mobile' ->> 'y')::numeric between 0 and 100)
      end
    else true
  end;
$function$;

alter table public.media_links
drop constraint if exists media_links_hero_presentation_check;

alter table public.media_links
add constraint media_links_hero_presentation_check check (
  hero_presentation is null
  or (
    entity_type = 'store'
    and display_context = 'hero'
    and public.is_valid_store_hero_presentation(hero_presentation)
  )
);

create function pg_temp.legacy_hero_focal_point(
  p_crop jsonb,
  p_image_width numeric,
  p_image_height numeric,
  p_frame_width numeric,
  p_frame_height numeric,
  p_translation_factor numeric,
  p_zoom_factor numeric
)
returns jsonb
language plpgsql
as $function$
declare
  v_image_width numeric := greatest(coalesce(p_image_width, 2100), 1);
  v_image_height numeric := greatest(coalesce(p_image_height, 900), 1);
  v_x numeric := coalesce((p_crop ->> 'x')::numeric, 0);
  v_y numeric := coalesce((p_crop ->> 'y')::numeric, 0);
  v_zoom numeric := greatest(coalesce((p_crop ->> 'zoom')::numeric, 1), 0.01)
    * p_zoom_factor;
  v_cover_scale numeric;
  v_rendered_width numeric;
  v_rendered_height numeric;
  v_source_x numeric;
  v_source_y numeric;
  v_focal_x numeric;
  v_focal_y numeric;
begin
  if p_crop is null or jsonb_typeof(p_crop) <> 'object' then
    return '{"x": 50, "y": 50}'::jsonb;
  end if;

  v_cover_scale := greatest(
    p_frame_width / v_image_width,
    p_frame_height / v_image_height
  );
  v_rendered_width := v_image_width * v_cover_scale;
  v_rendered_height := v_image_height * v_cover_scale;
  v_source_x := (v_image_width / 2)
    - ((v_x * p_translation_factor) / (v_cover_scale * v_zoom));
  v_source_y := (v_image_height / 2)
    - ((v_y * p_translation_factor) / (v_cover_scale * v_zoom));

  v_focal_x := case
    when v_rendered_width <= p_frame_width + 0.001 then 50
    else (
      (v_source_x * v_cover_scale - p_frame_width / 2)
      / (v_rendered_width - p_frame_width)
    ) * 100
  end;
  v_focal_y := case
    when v_rendered_height <= p_frame_height + 0.001 then 50
    else (
      (v_source_y * v_cover_scale - p_frame_height / 2)
      / (v_rendered_height - p_frame_height)
    ) * 100
  end;

  return jsonb_build_object(
    'x', round(least(100, greatest(0, v_focal_x)), 2),
    'y', round(least(100, greatest(0, v_focal_y)), 2)
  );
end;
$function$;

update public.media_links as media_links
set
  hero_presentation = jsonb_build_object(
    'desktop',
    pg_temp.legacy_hero_focal_point(
      media_links.crop_metadata,
      coalesce(media_assets.width_px, 2100),
      coalesce(media_assets.height_px, 900),
      1440,
      475.2,
      1,
      1
    ),
    'mobile',
    pg_temp.legacy_hero_focal_point(
      media_links.crop_metadata,
      coalesce(media_assets.width_px, 2100),
      coalesce(media_assets.height_px, 900),
      358,
      213.6,
      0.82,
      1.22
    )
  ),
  updated_at = now()
from public.media_assets as media_assets
where media_links.media_asset_id = media_assets.id
  and media_links.store_id = media_assets.store_id
  and media_links.entity_type = 'store'
  and media_links.display_context = 'hero'
  and media_links.hero_presentation is null;

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
  media_links.crop_metadata,
  media_links.hero_layout,
  media_links.hero_presentation
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
    media_links.crop_metadata,
    media_links.hero_layout,
    media_links.hero_presentation
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.id = any(p_media_link_ids);
$$;


create or replace function public.seller_update_store_hero_presentation(
  p_media_link_id uuid,
  p_hero_presentation jsonb
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_link public.media_links;
  v_normalized jsonb;
begin
  select *
  into v_link
  from public.media_links
  where id = p_media_link_id
    and entity_type = 'store'
    and display_context = 'hero'
    and visibility_status = 'active';

  if not found or not (public.owns_store(v_link.store_id) or public.is_admin()) then
    raise exception 'Media link not found';
  end if;

  if not public.is_valid_store_hero_presentation(p_hero_presentation) then
    raise exception 'Hero presentation must contain desktop x/y and optional mobile x/y values from 0 through 100';
  end if;

  v_normalized := jsonb_build_object(
    'desktop',
    jsonb_build_object(
      'x', round((p_hero_presentation -> 'desktop' ->> 'x')::numeric, 2),
      'y', round((p_hero_presentation -> 'desktop' ->> 'y')::numeric, 2)
    )
  );

  if p_hero_presentation ? 'mobile' then
    v_normalized := v_normalized || jsonb_build_object(
      'mobile',
      jsonb_build_object(
        'x', round((p_hero_presentation -> 'mobile' ->> 'x')::numeric, 2),
        'y', round((p_hero_presentation -> 'mobile' ->> 'y')::numeric, 2)
      )
    );
  end if;

  update public.media_links
  set
    hero_presentation = v_normalized,
    updated_at = now()
  where id = v_link.id
  returning * into v_link;

  return query
  select *
  from public.media_management_response_for_links(array[v_link.id]);
end;
$function$;

drop function if exists public.get_public_storefront_home(text);
drop function if exists public.get_seller_storefront_home_preview(text);

create function public.get_public_storefront_home(
  p_store_slug text
)
returns table (
  store_id uuid,
  store_slug text,
  store_name text,
  store_tagline text,
  hero_subheading text,
  storefront_font_pair text,
  storefront_heading_color text,
  storefront_text_color text,
  storefront_top_menu_color text,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_method text,
  public_email text,
  public_phone text,
  website_url text,
  social_url text,
  npip_number text,
  hero_image_url text,
  hero_image_alt_text text,
  hero_crop_metadata jsonb,
  hero_presentation jsonb,
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
  other_policies text,
  custom_policies jsonb
)
language sql
stable
security definer
set search_path = public
as $function$
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
      coalesce(sum(public_inventory.quantity_available), 0)::bigint as
        total_quantity_available,
      min(public_inventory.available_date) filter (
        where public_inventory.quantity_available > 0
      ) as next_available_date
    from public_inventory
  )
  select
    target_store.id,
    target_store.store_slug,
    target_store.store_name,
    target_store.store_tagline,
    target_store.hero_subheading,
    target_store.storefront_font_pair,
    target_store.storefront_heading_color,
    target_store.storefront_text_color,
    target_store.storefront_top_menu_color,
    target_store.public_city,
    target_store.public_state,
    target_store.public_country,
    target_store.about_text,
    target_store.pickup_policy,
    target_store.cancellation_policy,
    target_store.pickup_method,
    case
      when target_store.show_public_email then target_store.public_email
      else null
    end,
    case
      when target_store.show_public_phone then target_store.public_phone
      else null
    end,
    target_store.website_url,
    target_store.social_url,
    case
      when target_store.show_npip then target_store.npip_number
      else null
    end,
    hero_media.image_url,
    hero_media.alt_text,
    hero_media.crop_metadata,
    hero_media.hero_presentation,
    coalesce(hero_media.hero_layout, 'full'),
    logo_media.image_url,
    logo_media.alt_text,
    coalesce(inventory_summary.public_inventory_item_count, 0),
    coalesce(inventory_summary.ready_now_item_count, 0),
    coalesce(inventory_summary.reserve_now_item_count, 0),
    coalesce(inventory_summary.sold_out_item_count, 0),
    coalesce(inventory_summary.total_quantity_available, 0),
    inventory_summary.next_available_date,
    coalesce(inventory_summary.public_inventory_item_count, 0) > 0,
    target_store.other_policies,
    target_store.custom_policies
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
      media_links.hero_presentation,
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
    order by
      media_links.is_featured desc,
      media_links.sort_order,
      media_links.created_at
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
    order by
      media_links.is_featured desc,
      media_links.sort_order,
      media_links.created_at
    limit 1
  ) as logo_media on true;
$function$;

create function public.get_seller_storefront_home_preview(
  p_store_slug text
)
returns table (
  store_id uuid,
  store_slug text,
  store_name text,
  store_tagline text,
  hero_subheading text,
  storefront_font_pair text,
  storefront_heading_color text,
  storefront_text_color text,
  storefront_top_menu_color text,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_method text,
  public_email text,
  public_phone text,
  website_url text,
  social_url text,
  npip_number text,
  hero_image_url text,
  hero_image_alt_text text,
  hero_crop_metadata jsonb,
  hero_presentation jsonb,
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
  preview_is_hidden boolean,
  other_policies text,
  custom_policies jsonb
)
language sql
stable
security definer
set search_path = public
as $function$
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
      coalesce(sum(public_inventory.quantity_available), 0)::bigint as
        total_quantity_available,
      min(public_inventory.available_date) filter (
        where public_inventory.quantity_available > 0
      ) as next_available_date
    from public_inventory
  )
  select
    target_store.id,
    target_store.store_slug,
    target_store.store_name,
    target_store.store_tagline,
    target_store.hero_subheading,
    target_store.storefront_font_pair,
    target_store.storefront_heading_color,
    target_store.storefront_text_color,
    target_store.storefront_top_menu_color,
    target_store.public_city,
    target_store.public_state,
    target_store.public_country,
    target_store.about_text,
    target_store.pickup_policy,
    target_store.cancellation_policy,
    target_store.pickup_method,
    case
      when target_store.show_public_email then target_store.public_email
      else null
    end,
    case
      when target_store.show_public_phone then target_store.public_phone
      else null
    end,
    target_store.website_url,
    target_store.social_url,
    case
      when target_store.show_npip then target_store.npip_number
      else null
    end,
    hero_media.image_url,
    hero_media.alt_text,
    hero_media.crop_metadata,
    hero_media.hero_presentation,
    coalesce(hero_media.hero_layout, 'full'),
    logo_media.image_url,
    logo_media.alt_text,
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
    ),
    target_store.other_policies,
    target_store.custom_policies
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
      media_links.hero_presentation,
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
    order by
      media_links.is_featured desc,
      media_links.sort_order,
      media_links.created_at
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
    order by
      media_links.is_featured desc,
      media_links.sort_order,
      media_links.created_at
    limit 1
  ) as logo_media on true;
$function$;


comment on function public.seller_update_store_hero_presentation(uuid, jsonb) is
'Updates normalized desktop and optional mobile focal points for an authorized store hero without changing generic crop metadata.';

revoke all on function public.is_valid_store_hero_presentation(jsonb) from public;
revoke all on function public.seller_update_store_hero_presentation(uuid, jsonb) from public;
revoke all on function public.get_public_storefront_home(text) from public;
revoke all on function public.get_seller_storefront_home_preview(text) from public;

grant execute on function public.seller_update_store_hero_presentation(uuid, jsonb)
  to authenticated;
grant execute on function public.get_public_storefront_home(text)
  to anon, authenticated;
grant execute on function public.get_seller_storefront_home_preview(text)
  to authenticated;

commit;
