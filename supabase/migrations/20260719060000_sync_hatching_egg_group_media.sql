begin;

create or replace function public.normalize_hatching_egg_item_name(
  p_item_name text
)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(btrim(coalesce(p_item_name, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.seller_attach_hatching_egg_group_media(
  p_hatching_egg_inventory_item_id uuid,
  p_media_asset_id uuid,
  p_display_context text default 'gallery',
  p_alt_text_override text default null,
  p_caption text default null,
  p_sort_order integer default 0,
  p_is_featured boolean default false,
  p_crop_metadata jsonb default null
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.hatching_egg_inventory_items%rowtype;
  v_asset public.media_assets%rowtype;
  v_context text := lower(trim(coalesce(p_display_context, 'gallery')));
  v_group_key text;
  v_group_ids uuid[];
  v_active_asset_count integer;
  v_link_ids uuid[];
begin
  if v_context <> 'gallery' then
    raise exception 'Unsupported media display context';
  end if;

  select *
  into v_item
  from public.hatching_egg_inventory_items
  where id = p_hatching_egg_inventory_item_id
    and visibility_status <> 'archived'
  for update;

  if not found or not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Hatching egg item not found';
  end if;

  select *
  into v_asset
  from public.media_assets
  where id = p_media_asset_id
    and store_id = v_item.store_id
    and asset_status = 'active';

  if not found then
    raise exception 'Media asset not found';
  end if;

  v_group_key := public.normalize_hatching_egg_item_name(v_item.item_name);

  v_group_ids := array(
    select hatching_items.id
    from public.hatching_egg_inventory_items as hatching_items
    where hatching_items.store_id = v_item.store_id
      and hatching_items.visibility_status <> 'archived'
      and public.normalize_hatching_egg_item_name(hatching_items.item_name) = v_group_key
    order by hatching_items.id
    for update
  );

  if coalesce(array_length(v_group_ids, 1), 0) = 0 then
    raise exception 'Hatching egg group not found';
  end if;

  perform media_links.id
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.display_context = v_context
  for update;

  select count(distinct media_links.media_asset_id)
  into v_active_asset_count
  from public.media_links as media_links
  join public.media_assets as media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.display_context = v_context
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_links.media_asset_id <> p_media_asset_id;

  if v_active_asset_count >= 4 then
    raise exception 'Hatching Eggs can have up to 4 photos.';
  end if;

  if coalesce(p_is_featured, false) then
    update public.media_links
    set
      is_featured = false,
      updated_at = now()
    where store_id = v_item.store_id
      and entity_type = 'hatching_egg_inventory_item'
      and entity_id = any(v_group_ids)
      and display_context = v_context
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
    crop_metadata,
    visibility_status
  )
  select
    v_item.store_id,
    v_asset.id,
    'hatching_egg_inventory_item',
    group_item_id,
    v_context,
    greatest(coalesce(p_sort_order, 0), 0),
    coalesce(p_is_featured, false),
    nullif(trim(p_alt_text_override), ''),
    nullif(trim(p_caption), ''),
    p_crop_metadata,
    'active'
  from unnest(v_group_ids) as group_item_id
  on conflict (entity_type, entity_id, media_asset_id) do update
  set
    display_context = excluded.display_context,
    sort_order = excluded.sort_order,
    is_featured = excluded.is_featured,
    alt_text_override = excluded.alt_text_override,
    caption = excluded.caption,
    crop_metadata = excluded.crop_metadata,
    visibility_status = 'active',
    updated_at = now();

  if not coalesce(p_is_featured, false) then
    perform public.promote_next_featured_media_link(
      'hatching_egg_inventory_item',
      group_item_id,
      v_context
    )
    from unnest(v_group_ids) as group_item_id;
  end if;

  select array_agg(media_links.id order by media_links.sort_order, media_links.created_at, media_links.id)
  into v_link_ids
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = v_item.id
    and media_links.display_context = v_context
    and media_links.visibility_status = 'active';

  return query
  select *
  from public.media_management_response_for_links(coalesce(v_link_ids, array[]::uuid[])) as media
  order by media.is_featured desc, media.sort_order asc, media.linked_at asc;
end;
$$;

create or replace function public.seller_create_uploaded_hatching_egg_group_media(
  p_actor_user_id uuid,
  p_store_id uuid,
  p_hatching_egg_inventory_item_id uuid,
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
  v_asset public.media_assets%rowtype;
begin
  if not public.is_media_actor_store_authorized(p_actor_user_id, p_store_id) then
    raise exception 'Not authorized to create media for this store';
  end if;

  if not public.validate_seller_media_entity(
    p_store_id,
    'hatching_egg_inventory_item',
    p_hatching_egg_inventory_item_id
  ) then
    raise exception 'Media entity does not belong to this store';
  end if;

  if lower(trim(coalesce(p_display_context, 'gallery'))) <> 'gallery' then
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

  return query
  select *
  from public.seller_attach_hatching_egg_group_media(
    p_hatching_egg_inventory_item_id,
    v_asset.id,
    p_display_context,
    p_alt_text,
    p_caption,
    p_sort_order,
    p_is_featured,
    null
  );
end;
$$;

create or replace function public.seller_archive_hatching_egg_group_media(
  p_hatching_egg_inventory_item_id uuid,
  p_media_asset_id uuid
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.hatching_egg_inventory_items%rowtype;
  v_group_key text;
  v_group_ids uuid[];
  v_link_ids uuid[];
begin
  select *
  into v_item
  from public.hatching_egg_inventory_items
  where id = p_hatching_egg_inventory_item_id
    and visibility_status <> 'archived'
  for update;

  if not found or not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Hatching egg item not found';
  end if;

  v_group_key := public.normalize_hatching_egg_item_name(v_item.item_name);

  v_group_ids := array(
    select hatching_items.id
    from public.hatching_egg_inventory_items as hatching_items
    where hatching_items.store_id = v_item.store_id
      and hatching_items.visibility_status <> 'archived'
      and public.normalize_hatching_egg_item_name(hatching_items.item_name) = v_group_key
    order by hatching_items.id
    for update
  );

  perform media_links.id
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.display_context = 'gallery'
  for update;

  update public.media_links
  set
    visibility_status = 'archived',
    is_featured = false,
    updated_at = now()
  where store_id = v_item.store_id
    and entity_type = 'hatching_egg_inventory_item'
    and entity_id = any(v_group_ids)
    and display_context = 'gallery'
    and media_asset_id = p_media_asset_id
    and visibility_status = 'active';

  perform public.promote_next_featured_media_link(
    'hatching_egg_inventory_item',
    group_item_id,
    'gallery'
  )
  from unnest(v_group_ids) as group_item_id;

  select array_agg(media_links.id order by media_links.sort_order, media_links.created_at, media_links.id)
  into v_link_ids
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = v_item.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active';

  return query
  select *
  from public.media_management_response_for_links(coalesce(v_link_ids, array[]::uuid[])) as media
  order by media.is_featured desc, media.sort_order asc, media.linked_at asc;
end;
$$;

create or replace function public.seller_reorder_hatching_egg_group_media(
  p_hatching_egg_inventory_item_id uuid,
  p_media_asset_ids uuid[]
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.hatching_egg_inventory_items%rowtype;
  v_group_key text;
  v_group_ids uuid[];
  v_expected_count integer;
  v_actual_count integer;
  v_link_ids uuid[];
begin
  select *
  into v_item
  from public.hatching_egg_inventory_items
  where id = p_hatching_egg_inventory_item_id
    and visibility_status <> 'archived'
  for update;

  if not found or not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Hatching egg item not found';
  end if;

  select count(*), count(distinct media_asset_id)
  into v_expected_count, v_actual_count
  from unnest(coalesce(p_media_asset_ids, array[]::uuid[])) as ordered(media_asset_id);

  if v_expected_count = 0 or v_expected_count > 4 or v_expected_count <> v_actual_count then
    raise exception 'Media reorder list contains invalid links';
  end if;

  v_group_key := public.normalize_hatching_egg_item_name(v_item.item_name);

  v_group_ids := array(
    select hatching_items.id
    from public.hatching_egg_inventory_items as hatching_items
    where hatching_items.store_id = v_item.store_id
      and hatching_items.visibility_status <> 'archived'
      and public.normalize_hatching_egg_item_name(hatching_items.item_name) = v_group_key
    order by hatching_items.id
    for update
  );

  perform media_links.id
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.display_context = 'gallery'
  for update;

  select count(distinct media_links.media_asset_id)
  into v_actual_count
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active'
    and media_links.media_asset_id = any(p_media_asset_ids);

  if v_actual_count <> v_expected_count then
    raise exception 'Media reorder list contains invalid links';
  end if;

  update public.media_links
  set
    visibility_status = 'archived',
    is_featured = false,
    updated_at = now()
  where store_id = v_item.store_id
    and entity_type = 'hatching_egg_inventory_item'
    and entity_id = any(v_group_ids)
    and display_context = 'gallery'
    and visibility_status = 'active'
    and not (media_asset_id = any(p_media_asset_ids));

  update public.media_links
  set
    sort_order = ordered.ordinality - 1,
    is_featured = ordered.ordinality = 1,
    visibility_status = 'active',
    updated_at = now()
  from unnest(p_media_asset_ids) with ordinality as ordered(media_asset_id, ordinality)
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.display_context = 'gallery'
    and media_links.media_asset_id = ordered.media_asset_id;

  select array_agg(media_links.id order by media_links.sort_order, media_links.created_at, media_links.id)
  into v_link_ids
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = v_item.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active';

  return query
  select *
  from public.media_management_response_for_links(coalesce(v_link_ids, array[]::uuid[])) as media
  order by media.is_featured desc, media.sort_order asc, media.linked_at asc;
end;
$$;

create or replace function public.seller_set_hatching_egg_group_media_featured(
  p_hatching_egg_inventory_item_id uuid,
  p_media_asset_id uuid
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_assets uuid[];
begin
  select array_agg(media_asset_id order by sort_order, linked_at, media_link_id)
  into v_current_assets
  from public.seller_media_management
  where entity_type = 'hatching_egg_inventory_item'
    and entity_id = p_hatching_egg_inventory_item_id
    and display_context = 'gallery'
    and visibility_status = 'active'
    and asset_status = 'active'
    and moderation_status = 'approved';

  if v_current_assets is null or not (p_media_asset_id = any(v_current_assets)) then
    raise exception 'Media link not found';
  end if;

  return query
  select *
  from public.seller_reorder_hatching_egg_group_media(
    p_hatching_egg_inventory_item_id,
    array[p_media_asset_id] || array_remove(v_current_assets, p_media_asset_id)
  );
end;
$$;

create or replace function public.seller_replace_hatching_egg_group_media(
  p_hatching_egg_inventory_item_id uuid,
  p_old_media_asset_id uuid,
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
  v_old_link public.media_links%rowtype;
begin
  select media_links.*
  into v_old_link
  from public.media_links as media_links
  join public.hatching_egg_inventory_items as hatching_items
    on hatching_items.id = media_links.entity_id
   and hatching_items.store_id = media_links.store_id
  where media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = p_hatching_egg_inventory_item_id
    and media_links.display_context = 'gallery'
    and media_links.media_asset_id = p_old_media_asset_id
    and media_links.visibility_status = 'active'
    and hatching_items.visibility_status <> 'archived'
  for update;

  if not found or not (public.owns_store(v_old_link.store_id) or public.is_admin()) then
    raise exception 'Media link not found';
  end if;

  perform public.seller_archive_hatching_egg_group_media(
    p_hatching_egg_inventory_item_id,
    p_old_media_asset_id
  );

  return query
  select *
  from public.seller_attach_hatching_egg_group_media(
    p_hatching_egg_inventory_item_id,
    p_new_media_asset_id,
    'gallery',
    p_alt_text_override,
    p_caption,
    v_old_link.sort_order,
    v_old_link.is_featured,
    v_old_link.crop_metadata
  );
end;
$$;

create or replace function public.seller_update_hatching_egg_group_media_text(
  p_hatching_egg_inventory_item_id uuid,
  p_media_asset_id uuid,
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
  v_item public.hatching_egg_inventory_items%rowtype;
  v_group_key text;
  v_group_ids uuid[];
  v_link_ids uuid[];
begin
  select *
  into v_item
  from public.hatching_egg_inventory_items
  where id = p_hatching_egg_inventory_item_id
    and visibility_status <> 'archived'
  for update;

  if not found or not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Hatching egg item not found';
  end if;

  v_group_key := public.normalize_hatching_egg_item_name(v_item.item_name);

  v_group_ids := array(
    select hatching_items.id
    from public.hatching_egg_inventory_items as hatching_items
    where hatching_items.store_id = v_item.store_id
      and hatching_items.visibility_status <> 'archived'
      and public.normalize_hatching_egg_item_name(hatching_items.item_name) = v_group_key
    order by hatching_items.id
    for update
  );

  perform media_links.id
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.display_context = 'gallery'
    and media_links.media_asset_id = p_media_asset_id
  for update;

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
  where store_id = v_item.store_id
    and entity_type = 'hatching_egg_inventory_item'
    and entity_id = any(v_group_ids)
    and display_context = 'gallery'
    and media_asset_id = p_media_asset_id
    and visibility_status = 'active';

  if not found then
    raise exception 'Media link not found';
  end if;

  if p_asset_alt_text is not null then
    update public.media_assets
    set
      alt_text = nullif(trim(p_asset_alt_text), ''),
      updated_at = now()
    where id = p_media_asset_id
      and store_id = v_item.store_id;
  end if;

  select array_agg(media_links.id order by media_links.sort_order, media_links.created_at, media_links.id)
  into v_link_ids
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = v_item.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active';

  return query
  select *
  from public.media_management_response_for_links(coalesce(v_link_ids, array[]::uuid[])) as media
  order by media.is_featured desc, media.sort_order asc, media.linked_at asc;
end;
$$;

create or replace function public.seller_update_hatching_egg_group_media_crop(
  p_hatching_egg_inventory_item_id uuid,
  p_media_asset_id uuid,
  p_crop_metadata jsonb
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.hatching_egg_inventory_items%rowtype;
  v_group_key text;
  v_group_ids uuid[];
  v_link_ids uuid[];
  v_normalized_crop jsonb;
begin
  select *
  into v_item
  from public.hatching_egg_inventory_items
  where id = p_hatching_egg_inventory_item_id
    and visibility_status <> 'archived'
  for update;

  if not found or not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Hatching egg item not found';
  end if;

  if p_crop_metadata is null then
    v_normalized_crop := null;
  else
    v_normalized_crop := jsonb_build_object(
      'x', least(1, greatest(0, coalesce((p_crop_metadata->>'x')::numeric, 0))),
      'y', least(1, greatest(0, coalesce((p_crop_metadata->>'y')::numeric, 0))),
      'scale', least(3, greatest(1, coalesce((p_crop_metadata->>'scale')::numeric, 1)))
    );
  end if;

  v_group_key := public.normalize_hatching_egg_item_name(v_item.item_name);

  v_group_ids := array(
    select hatching_items.id
    from public.hatching_egg_inventory_items as hatching_items
    where hatching_items.store_id = v_item.store_id
      and hatching_items.visibility_status <> 'archived'
      and public.normalize_hatching_egg_item_name(hatching_items.item_name) = v_group_key
    order by hatching_items.id
    for update
  );

  perform media_links.id
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.display_context = 'gallery'
    and media_links.media_asset_id = p_media_asset_id
  for update;

  update public.media_links
  set
    crop_metadata = v_normalized_crop,
    updated_at = now()
  where store_id = v_item.store_id
    and entity_type = 'hatching_egg_inventory_item'
    and entity_id = any(v_group_ids)
    and display_context = 'gallery'
    and media_asset_id = p_media_asset_id
    and visibility_status = 'active';

  if not found then
    raise exception 'Media link not found';
  end if;

  select array_agg(media_links.id order by media_links.sort_order, media_links.created_at, media_links.id)
  into v_link_ids
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = v_item.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active';

  return query
  select *
  from public.media_management_response_for_links(coalesce(v_link_ids, array[]::uuid[])) as media
  order by media.is_featured desc, media.sort_order asc, media.linked_at asc;
end;
$$;

create or replace function public.seller_sync_hatching_egg_group_media_from_item(
  p_hatching_egg_inventory_item_id uuid
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.hatching_egg_inventory_items%rowtype;
  v_group_key text;
  v_group_ids uuid[];
  v_source_item_id uuid;
  v_link_ids uuid[];
begin
  select *
  into v_item
  from public.hatching_egg_inventory_items
  where id = p_hatching_egg_inventory_item_id
    and visibility_status <> 'archived'
  for update;

  if not found or not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Hatching egg item not found';
  end if;

  v_group_key := public.normalize_hatching_egg_item_name(v_item.item_name);

  v_group_ids := array(
    select hatching_items.id
    from public.hatching_egg_inventory_items as hatching_items
    where hatching_items.store_id = v_item.store_id
      and hatching_items.visibility_status <> 'archived'
      and public.normalize_hatching_egg_item_name(hatching_items.item_name) = v_group_key
    order by hatching_items.id
    for update
  );

  perform media_links.id
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.display_context = 'gallery'
  for update;

  select media_links.entity_id
  into v_source_item_id
  from public.media_links as media_links
  join public.media_assets as media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.entity_id <> v_item.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
  order by media_links.entity_id, media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1;

  if v_source_item_id is null then
    v_source_item_id := v_item.id;
  end if;

  update public.media_links
  set
    visibility_status = 'archived',
    is_featured = false,
    updated_at = now()
  where store_id = v_item.store_id
    and entity_type = 'hatching_egg_inventory_item'
    and entity_id = any(v_group_ids)
    and display_context = 'gallery'
    and visibility_status = 'active'
    and media_asset_id not in (
      select source_links.media_asset_id
      from public.media_links as source_links
      where source_links.store_id = v_item.store_id
        and source_links.entity_type = 'hatching_egg_inventory_item'
        and source_links.entity_id = v_source_item_id
        and source_links.display_context = 'gallery'
        and source_links.visibility_status = 'active'
    );

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
    crop_metadata,
    visibility_status
  )
  select
    v_item.store_id,
    source_links.media_asset_id,
    'hatching_egg_inventory_item',
    group_item_id,
    'gallery',
    source_links.sort_order,
    source_links.is_featured,
    source_links.alt_text_override,
    source_links.caption,
    source_links.crop_metadata,
    'active'
  from public.media_links as source_links
  cross join unnest(v_group_ids) as group_item_id
  where source_links.store_id = v_item.store_id
    and source_links.entity_type = 'hatching_egg_inventory_item'
    and source_links.entity_id = v_source_item_id
    and source_links.display_context = 'gallery'
    and source_links.visibility_status = 'active'
  on conflict (entity_type, entity_id, media_asset_id) do update
  set
    display_context = excluded.display_context,
    sort_order = excluded.sort_order,
    is_featured = excluded.is_featured,
    alt_text_override = excluded.alt_text_override,
    caption = excluded.caption,
    crop_metadata = excluded.crop_metadata,
    visibility_status = 'active',
    updated_at = now();

  select array_agg(media_links.id order by media_links.sort_order, media_links.created_at, media_links.id)
  into v_link_ids
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = v_item.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active';

  return query
  select *
  from public.media_management_response_for_links(coalesce(v_link_ids, array[]::uuid[])) as media
  order by media.is_featured desc, media.sort_order asc, media.linked_at asc;
end;
$$;

comment on function public.normalize_hatching_egg_item_name(text) is
'Normalizes standalone Hatching Eggs item names for same-store shared description and media grouping.';

comment on function public.seller_create_uploaded_hatching_egg_group_media(uuid, uuid, uuid, text, text, text, text, bigint, integer, integer, text, text, integer, boolean) is
'Trusted seller/admin RPC that creates one uploaded media asset and links it to every non-archived standalone Hatching Eggs item in the same normalized-name group.';

comment on function public.seller_attach_hatching_egg_group_media(uuid, uuid, text, text, text, integer, boolean, jsonb) is
'Trusted seller/admin RPC that links an existing media asset to every non-archived standalone Hatching Eggs item in the same normalized-name group.';

comment on function public.seller_archive_hatching_egg_group_media(uuid, uuid) is
'Trusted seller/admin RPC that archives links for one media asset across a standalone Hatching Eggs normalized-name group without deleting the media asset.';

comment on function public.seller_reorder_hatching_egg_group_media(uuid, uuid[]) is
'Trusted seller/admin RPC that applies one gallery order and featured photo across a standalone Hatching Eggs normalized-name group.';

comment on function public.seller_set_hatching_egg_group_media_featured(uuid, uuid) is
'Trusted seller/admin RPC that makes one media asset the featured photo across a standalone Hatching Eggs normalized-name group.';

comment on function public.seller_replace_hatching_egg_group_media(uuid, uuid, uuid, text, text) is
'Trusted seller/admin RPC that replaces one media asset with another across a standalone Hatching Eggs normalized-name group.';

comment on function public.seller_update_hatching_egg_group_media_text(uuid, uuid, text, text, text) is
'Trusted seller/admin RPC that synchronizes media alt text and captions across a standalone Hatching Eggs normalized-name group.';

comment on function public.seller_update_hatching_egg_group_media_crop(uuid, uuid, jsonb) is
'Trusted seller/admin RPC that synchronizes media crop metadata across a standalone Hatching Eggs normalized-name group.';

comment on function public.seller_sync_hatching_egg_group_media_from_item(uuid) is
'Trusted seller/admin RPC that reconciles one standalone Hatching Eggs item with the media set for its current normalized-name group, used after create/load/rename.';

revoke all on function public.normalize_hatching_egg_item_name(text) from public;
revoke all on function public.seller_create_uploaded_hatching_egg_group_media(uuid, uuid, uuid, text, text, text, text, bigint, integer, integer, text, text, integer, boolean) from public;
revoke all on function public.seller_attach_hatching_egg_group_media(uuid, uuid, text, text, text, integer, boolean, jsonb) from public;
revoke all on function public.seller_archive_hatching_egg_group_media(uuid, uuid) from public;
revoke all on function public.seller_reorder_hatching_egg_group_media(uuid, uuid[]) from public;
revoke all on function public.seller_set_hatching_egg_group_media_featured(uuid, uuid) from public;
revoke all on function public.seller_replace_hatching_egg_group_media(uuid, uuid, uuid, text, text) from public;
revoke all on function public.seller_update_hatching_egg_group_media_text(uuid, uuid, text, text, text) from public;
revoke all on function public.seller_update_hatching_egg_group_media_crop(uuid, uuid, jsonb) from public;
revoke all on function public.seller_sync_hatching_egg_group_media_from_item(uuid) from public;

grant execute on function public.seller_create_uploaded_hatching_egg_group_media(uuid, uuid, uuid, text, text, text, text, bigint, integer, integer, text, text, integer, boolean) to authenticated;
grant execute on function public.seller_attach_hatching_egg_group_media(uuid, uuid, text, text, text, integer, boolean, jsonb) to authenticated;
grant execute on function public.seller_archive_hatching_egg_group_media(uuid, uuid) to authenticated;
grant execute on function public.seller_reorder_hatching_egg_group_media(uuid, uuid[]) to authenticated;
grant execute on function public.seller_set_hatching_egg_group_media_featured(uuid, uuid) to authenticated;
grant execute on function public.seller_replace_hatching_egg_group_media(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.seller_update_hatching_egg_group_media_text(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.seller_update_hatching_egg_group_media_crop(uuid, uuid, jsonb) to authenticated;
grant execute on function public.seller_sync_hatching_egg_group_media_from_item(uuid) to authenticated;

commit;
