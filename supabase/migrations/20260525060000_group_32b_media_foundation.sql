-- Group 32B - Media Foundation
-- Production-safe seller media support for storefront branding and live animal listings.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'seller-media',
  'seller-media',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Store owners can insert own media assets" on public.media_assets;
drop policy if exists "Store owners can update own media assets" on public.media_assets;
drop policy if exists "Store owners can insert own media links" on public.media_links;
drop policy if exists "Store owners can update own media links" on public.media_links;

create or replace function public.is_media_actor_store_authorized(
  p_actor_user_id uuid,
  p_store_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_actor_user_id is not null
    and p_store_id is not null
    and (
      exists (
        select 1
        from public.stores
        where stores.id = p_store_id
          and stores.owner_user_id = p_actor_user_id
      )
      or exists (
        select 1
        from public.user_roles
        where user_roles.user_id = p_actor_user_id
          and user_roles.role = 'admin'
          and user_roles.store_id is null
      )
    );
$$;

create or replace function public.validate_seller_media_entity(
  p_store_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_store_id is null or p_entity_type is null or p_entity_id is null then
    return false;
  end if;

  case p_entity_type
    when 'store' then
      return p_entity_id = p_store_id
        and exists (
          select 1
          from public.stores
          where stores.id = p_store_id
        );
    when 'listing_batch' then
      return exists (
        select 1
        from public.listing_batches
        where listing_batches.id = p_entity_id
          and listing_batches.store_id = p_store_id
      );
    when 'listing_batch_breed' then
      return exists (
        select 1
        from public.listing_batch_breeds
        where listing_batch_breeds.id = p_entity_id
          and listing_batch_breeds.store_id = p_store_id
      );
    when 'inventory_item' then
      return exists (
        select 1
        from public.inventory_items
        where inventory_items.id = p_entity_id
          and inventory_items.store_id = p_store_id
      );
    when 'seller_breed_profile' then
      return exists (
        select 1
        from public.seller_breed_profiles
        where seller_breed_profiles.id = p_entity_id
          and seller_breed_profiles.store_id = p_store_id
      );
    else
      return false;
  end case;
end;
$$;

create or replace function public.validate_seller_media_context(
  p_entity_type text,
  p_display_context text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_entity_type
    when 'store' then p_display_context in ('logo', 'hero', 'gallery')
    when 'listing_batch' then p_display_context in ('primary', 'gallery')
    when 'listing_batch_breed' then p_display_context in ('primary', 'gallery')
    when 'inventory_item' then p_display_context in ('primary', 'gallery')
    when 'seller_breed_profile' then p_display_context in ('primary', 'gallery')
    else false
  end;
$$;

create or replace function public.promote_next_featured_media_link(
  p_entity_type text,
  p_entity_id uuid,
  p_display_context text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_link_id uuid;
begin
  if exists (
    select 1
    from public.media_links
    where media_links.entity_type = p_entity_type
      and media_links.entity_id = p_entity_id
      and media_links.display_context = p_display_context
      and media_links.visibility_status = 'active'
      and media_links.is_featured = true
  ) then
    return;
  end if;

  select media_links.id
  into v_next_link_id
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.entity_type = p_entity_type
    and media_links.entity_id = p_entity_id
    and media_links.display_context = p_display_context
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
  order by media_links.sort_order asc, media_links.created_at asc, media_links.id asc
  limit 1;

  if v_next_link_id is not null then
    update public.media_links
    set
      is_featured = true,
      updated_at = now()
    where id = v_next_link_id;
  end if;
end;
$$;

create or replace view public.seller_media_management as
select
  media_assets.id as media_asset_id,
  media_links.id as media_link_id,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
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
  media_assets.updated_at as asset_updated_at
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
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
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
    media_assets.updated_at as asset_updated_at
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.id = any(p_media_link_ids);
$$;

create or replace function public.seller_create_uploaded_media(
  p_actor_user_id uuid,
  p_store_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_display_context text,
  p_storage_path text,
  p_original_filename text,
  p_content_type text,
  p_file_size_bytes bigint,
  p_width_px integer default null,
  p_height_px integer default null,
  p_alt_text text default null,
  p_caption text default null,
  p_sort_order integer default 0,
  p_is_featured boolean default false
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_type text := lower(trim(p_entity_type));
  v_display_context text := lower(trim(coalesce(p_display_context, 'gallery')));
  v_asset public.media_assets;
  v_link public.media_links;
begin
  if not public.is_media_actor_store_authorized(p_actor_user_id, p_store_id) then
    raise exception 'Not authorized to create media for this store';
  end if;

  if not public.validate_seller_media_entity(p_store_id, v_entity_type, p_entity_id) then
    raise exception 'Media entity does not belong to this store';
  end if;

  if not public.validate_seller_media_context(v_entity_type, v_display_context) then
    raise exception 'Unsupported media display context';
  end if;

  if p_content_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Unsupported media type';
  end if;

  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 8388608 then
    raise exception 'Media file size is invalid';
  end if;

  if (p_width_px is not null and p_width_px <= 0)
    or (p_height_px is not null and p_height_px <= 0) then
    raise exception 'Media dimensions are invalid';
  end if;

  if p_storage_path is null
    or p_storage_path !~ ('^stores/' || p_store_id::text || '/images/[0-9]{4}/[0-9]{2}/[0-9a-f-]+\.(jpg|jpeg|png|webp)$')
    or position('..' in p_storage_path) > 0 then
    raise exception 'Storage path is invalid';
  end if;

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
    moderation_checked_at
  )
  values (
    p_store_id,
    p_actor_user_id,
    'seller-media',
    p_storage_path,
    nullif(left(trim(coalesce(p_original_filename, '')), 255), ''),
    p_content_type,
    p_file_size_bytes,
    p_width_px,
    p_height_px,
    nullif(trim(p_alt_text), ''),
    'active',
    'approved',
    now()
  )
  returning * into v_asset;

  if p_is_featured then
    update public.media_links
    set
      is_featured = false,
      updated_at = now()
    where entity_type = v_entity_type
      and entity_id = p_entity_id
      and display_context = v_display_context
      and visibility_status = 'active';
  end if;

  if v_entity_type = 'store' and v_display_context in ('logo', 'hero') then
    update public.media_links
    set
      visibility_status = 'archived',
      is_featured = false,
      updated_at = now()
    where store_id = p_store_id
      and entity_type = 'store'
      and entity_id = p_store_id
      and display_context = v_display_context
      and visibility_status = 'active';
  end if;

  insert into public.media_links (
    store_id,
    media_asset_id,
    entity_type,
    entity_id,
    display_context,
    sort_order,
    is_featured,
    alt_text_override,
    caption,
    visibility_status
  )
  values (
    p_store_id,
    v_asset.id,
    v_entity_type,
    p_entity_id,
    v_display_context,
    greatest(coalesce(p_sort_order, 0), 0),
    coalesce(p_is_featured, false) or (v_entity_type = 'store' and v_display_context in ('logo', 'hero')),
    nullif(trim(p_alt_text), ''),
    nullif(trim(p_caption), ''),
    'active'
  )
  returning * into v_link;

  if not v_link.is_featured then
    perform public.promote_next_featured_media_link(v_entity_type, p_entity_id, v_display_context);
  end if;

  return query
  select *
  from public.media_management_response_for_links(array[v_link.id]);
end;
$$;

create or replace function public.seller_attach_media(
  p_media_asset_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_display_context text default 'gallery',
  p_alt_text_override text default null,
  p_caption text default null,
  p_sort_order integer default 0,
  p_is_featured boolean default false
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.media_assets;
  v_entity_type text := lower(trim(p_entity_type));
  v_display_context text := lower(trim(coalesce(p_display_context, 'gallery')));
  v_link public.media_links;
begin
  select *
  into v_asset
  from public.media_assets
  where id = p_media_asset_id
    and asset_status = 'active';

  if not found or not (public.owns_store(v_asset.store_id) or public.is_admin()) then
    raise exception 'Media asset not found';
  end if;

  if not public.validate_seller_media_entity(v_asset.store_id, v_entity_type, p_entity_id) then
    raise exception 'Media entity does not belong to this store';
  end if;

  if not public.validate_seller_media_context(v_entity_type, v_display_context) then
    raise exception 'Unsupported media display context';
  end if;

  if p_is_featured then
    update public.media_links
    set
      is_featured = false,
      updated_at = now()
    where entity_type = v_entity_type
      and entity_id = p_entity_id
      and display_context = v_display_context
      and visibility_status = 'active';
  end if;

  insert into public.media_links (
    store_id,
    media_asset_id,
    entity_type,
    entity_id,
    display_context,
    sort_order,
    is_featured,
    alt_text_override,
    caption,
    visibility_status
  )
  values (
    v_asset.store_id,
    v_asset.id,
    v_entity_type,
    p_entity_id,
    v_display_context,
    greatest(coalesce(p_sort_order, 0), 0),
    coalesce(p_is_featured, false),
    nullif(trim(p_alt_text_override), ''),
    nullif(trim(p_caption), ''),
    'active'
  )
  on conflict (entity_type, entity_id, media_asset_id) do update
  set
    display_context = excluded.display_context,
    sort_order = excluded.sort_order,
    is_featured = excluded.is_featured,
    alt_text_override = excluded.alt_text_override,
    caption = excluded.caption,
    visibility_status = 'active',
    updated_at = now()
  returning * into v_link;

  if not v_link.is_featured then
    perform public.promote_next_featured_media_link(v_entity_type, p_entity_id, v_display_context);
  end if;

  return query
  select *
  from public.media_management_response_for_links(array[v_link.id]);
end;
$$;

create or replace function public.seller_reorder_media(
  p_entity_type text,
  p_entity_id uuid,
  p_display_context text,
  p_media_link_ids uuid[]
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_type text := lower(trim(p_entity_type));
  v_display_context text := lower(trim(p_display_context));
  v_store_id uuid;
  v_expected_count integer;
  v_actual_count integer;
begin
  select media_links.store_id
  into v_store_id
  from public.media_links
  where media_links.entity_type = v_entity_type
    and media_links.entity_id = p_entity_id
    and media_links.display_context = v_display_context
    and media_links.id = any(p_media_link_ids)
  limit 1;

  if v_store_id is null or not (public.owns_store(v_store_id) or public.is_admin()) then
    raise exception 'Media links not found';
  end if;

  if not public.validate_seller_media_entity(v_store_id, v_entity_type, p_entity_id) then
    raise exception 'Media entity does not belong to this store';
  end if;

  select count(*) into v_expected_count
  from unnest(p_media_link_ids) as link_id;

  select count(*) into v_actual_count
  from public.media_links
  where media_links.store_id = v_store_id
    and media_links.entity_type = v_entity_type
    and media_links.entity_id = p_entity_id
    and media_links.display_context = v_display_context
    and media_links.visibility_status = 'active'
    and media_links.id = any(p_media_link_ids);

  if v_expected_count = 0 or v_expected_count <> v_actual_count then
    raise exception 'Media reorder list contains invalid links';
  end if;

  update public.media_links
  set
    sort_order = ordered.ordinality - 1,
    updated_at = now()
  from unnest(p_media_link_ids) with ordinality as ordered(link_id, ordinality)
  where media_links.id = ordered.link_id;

  return query
  select *
  from public.media_management_response_for_links(p_media_link_ids)
  order by sort_order asc, linked_at asc;
end;
$$;

create or replace function public.seller_replace_store_media(
  p_store_id uuid,
  p_media_asset_id uuid,
  p_display_context text,
  p_alt_text_override text default null,
  p_caption text default null
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context text := lower(trim(p_display_context));
  v_asset public.media_assets;
  v_link public.media_links;
begin
  if v_context not in ('logo', 'hero') then
    raise exception 'Store replacement context must be logo or hero';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to update store media';
  end if;

  select *
  into v_asset
  from public.media_assets
  where id = p_media_asset_id
    and store_id = p_store_id
    and asset_status = 'active';

  if not found then
    raise exception 'Media asset not found';
  end if;

  update public.media_links
  set
    visibility_status = 'archived',
    is_featured = false,
    updated_at = now()
  where store_id = p_store_id
    and entity_type = 'store'
    and entity_id = p_store_id
    and display_context = v_context
    and visibility_status = 'active';

  insert into public.media_links (
    store_id,
    media_asset_id,
    entity_type,
    entity_id,
    display_context,
    sort_order,
    is_featured,
    alt_text_override,
    caption,
    visibility_status
  )
  values (
    p_store_id,
    p_media_asset_id,
    'store',
    p_store_id,
    v_context,
    0,
    true,
    nullif(trim(p_alt_text_override), ''),
    nullif(trim(p_caption), ''),
    'active'
  )
  on conflict (entity_type, entity_id, media_asset_id) do update
  set
    display_context = excluded.display_context,
    sort_order = excluded.sort_order,
    is_featured = excluded.is_featured,
    alt_text_override = excluded.alt_text_override,
    caption = excluded.caption,
    visibility_status = 'active',
    updated_at = now()
  returning * into v_link;

  return query
  select *
  from public.media_management_response_for_links(array[v_link.id]);
end;
$$;

create or replace function public.seller_replace_media_link(
  p_media_link_id uuid,
  p_new_media_asset_id uuid,
  p_alt_text_override text default null,
  p_caption text default null
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_link public.media_links;
  v_new_asset public.media_assets;
  v_new_link public.media_links;
begin
  select *
  into v_old_link
  from public.media_links
  where id = p_media_link_id
    and visibility_status = 'active';

  if not found or not (public.owns_store(v_old_link.store_id) or public.is_admin()) then
    raise exception 'Media link not found';
  end if;

  select *
  into v_new_asset
  from public.media_assets
  where id = p_new_media_asset_id
    and store_id = v_old_link.store_id
    and asset_status = 'active';

  if not found then
    raise exception 'Replacement media asset not found';
  end if;

  update public.media_links
  set
    visibility_status = 'archived',
    is_featured = false,
    updated_at = now()
  where id = v_old_link.id;

  if v_old_link.is_featured then
    update public.media_links
    set
      is_featured = false,
      updated_at = now()
    where entity_type = v_old_link.entity_type
      and entity_id = v_old_link.entity_id
      and display_context = v_old_link.display_context
      and visibility_status = 'active';
  end if;

  insert into public.media_links (
    store_id,
    media_asset_id,
    entity_type,
    entity_id,
    display_context,
    sort_order,
    is_featured,
    alt_text_override,
    caption,
    visibility_status
  )
  values (
    v_old_link.store_id,
    v_new_asset.id,
    v_old_link.entity_type,
    v_old_link.entity_id,
    v_old_link.display_context,
    v_old_link.sort_order,
    v_old_link.is_featured,
    nullif(trim(p_alt_text_override), ''),
    nullif(trim(p_caption), ''),
    'active'
  )
  on conflict (entity_type, entity_id, media_asset_id) do update
  set
    display_context = excluded.display_context,
    sort_order = excluded.sort_order,
    is_featured = excluded.is_featured,
    alt_text_override = excluded.alt_text_override,
    caption = excluded.caption,
    visibility_status = 'active',
    updated_at = now()
  returning * into v_new_link;

  if not v_new_link.is_featured then
    perform public.promote_next_featured_media_link(
      v_new_link.entity_type,
      v_new_link.entity_id,
      v_new_link.display_context
    );
  end if;

  return query
  select *
  from public.media_management_response_for_links(array[v_new_link.id]);
end;
$$;

create or replace function public.seller_archive_media_link(
  p_media_link_id uuid
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.media_links;
  v_was_featured boolean;
begin
  select *
  into v_link
  from public.media_links
  where id = p_media_link_id;

  if not found or not (public.owns_store(v_link.store_id) or public.is_admin()) then
    raise exception 'Media link not found';
  end if;

  v_was_featured := v_link.is_featured;

  update public.media_links
  set
    visibility_status = 'archived',
    is_featured = false,
    updated_at = now()
  where id = v_link.id
  returning * into v_link;

  if v_was_featured then
    perform public.promote_next_featured_media_link(
      v_link.entity_type,
      v_link.entity_id,
      v_link.display_context
    );
  end if;

  return query
  select *
  from public.media_management_response_for_links(array[v_link.id]);
end;
$$;

create or replace function public.seller_set_media_featured(
  p_media_link_id uuid
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.media_links;
begin
  select *
  into v_link
  from public.media_links
  where id = p_media_link_id
    and visibility_status = 'active';

  if not found or not (public.owns_store(v_link.store_id) or public.is_admin()) then
    raise exception 'Media link not found';
  end if;

  update public.media_links
  set
    is_featured = false,
    updated_at = now()
  where entity_type = v_link.entity_type
    and entity_id = v_link.entity_id
    and display_context = v_link.display_context
    and visibility_status = 'active';

  update public.media_links
  set
    is_featured = true,
    updated_at = now()
  where id = v_link.id
  returning * into v_link;

  return query
  select *
  from public.media_management_response_for_links(array[v_link.id]);
end;
$$;

create or replace function public.seller_update_media_text(
  p_media_link_id uuid,
  p_alt_text_override text default null,
  p_caption text default null,
  p_asset_alt_text text default null
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.media_links;
begin
  select *
  into v_link
  from public.media_links
  where id = p_media_link_id;

  if not found or not (public.owns_store(v_link.store_id) or public.is_admin()) then
    raise exception 'Media link not found';
  end if;

  update public.media_links
  set
    alt_text_override = case
      when p_alt_text_override is null then alt_text_override
      else nullif(trim(p_alt_text_override), '')
    end,
    caption = case
      when p_caption is null then caption
      else nullif(trim(p_caption), '')
    end,
    updated_at = now()
  where id = v_link.id;

  if p_asset_alt_text is not null then
    update public.media_assets
    set
      alt_text = nullif(trim(p_asset_alt_text), ''),
      updated_at = now()
    where id = v_link.media_asset_id
      and store_id = v_link.store_id;
  end if;

  return query
  select *
  from public.media_management_response_for_links(array[v_link.id]);
end;
$$;

create or replace view public.public_storefront_media_gallery as
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
  and stores.store_status = 'live'
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
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.store_status = 'live'
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
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.store_status = 'live'
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
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.store_status = 'live'
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batch_breeds.visibility_status = 'active'
  and seller_breed_profiles.visibility_status = 'active'
  and inventory_items.visibility_status = 'active';

comment on view public.seller_media_management is
  'Seller-safe media management projection for edit screens. Shows media owned by the current seller store.';

comment on view public.public_storefront_media_gallery is
  'Public ordered gallery projection for active approved storefront and listing media.';

revoke all on function public.is_media_actor_store_authorized(uuid, uuid) from public;
revoke all on function public.validate_seller_media_entity(uuid, text, uuid) from public;
revoke all on function public.validate_seller_media_context(text, text) from public;
revoke all on function public.promote_next_featured_media_link(text, uuid, text) from public;
revoke all on function public.media_management_response_for_links(uuid[]) from public;
revoke all on function public.seller_create_uploaded_media(uuid, uuid, text, uuid, text, text, text, text, bigint, integer, integer, text, text, integer, boolean) from public;
revoke all on function public.seller_attach_media(uuid, text, uuid, text, text, text, integer, boolean) from public;
revoke all on function public.seller_reorder_media(text, uuid, text, uuid[]) from public;
revoke all on function public.seller_replace_store_media(uuid, uuid, text, text, text) from public;
revoke all on function public.seller_replace_media_link(uuid, uuid, text, text) from public;
revoke all on function public.seller_archive_media_link(uuid) from public;
revoke all on function public.seller_set_media_featured(uuid) from public;
revoke all on function public.seller_update_media_text(uuid, text, text, text) from public;

grant execute on function public.seller_create_uploaded_media(uuid, uuid, text, uuid, text, text, text, text, bigint, integer, integer, text, text, integer, boolean) to service_role;

grant execute on function public.seller_attach_media(uuid, text, uuid, text, text, text, integer, boolean) to authenticated;
grant execute on function public.seller_reorder_media(text, uuid, text, uuid[]) to authenticated;
grant execute on function public.seller_replace_store_media(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.seller_replace_media_link(uuid, uuid, text, text) to authenticated;
grant execute on function public.seller_archive_media_link(uuid) to authenticated;
grant execute on function public.seller_set_media_featured(uuid) to authenticated;
grant execute on function public.seller_update_media_text(uuid, text, text, text) to authenticated;

grant select on public.seller_media_management to authenticated;
grant select on public.public_storefront_media_gallery to anon, authenticated;

commit;
