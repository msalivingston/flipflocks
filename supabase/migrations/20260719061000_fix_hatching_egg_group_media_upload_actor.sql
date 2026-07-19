begin;

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

  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);

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

comment on function public.seller_create_uploaded_hatching_egg_group_media(uuid, uuid, uuid, text, text, text, text, bigint, integer, integer, text, text, integer, boolean) is
'Trusted seller/admin RPC that creates one uploaded media asset and links it to every non-archived standalone Hatching Eggs item in the same normalized-name group.';

revoke all on function public.seller_create_uploaded_hatching_egg_group_media(uuid, uuid, uuid, text, text, text, text, bigint, integer, integer, text, text, integer, boolean) from public;
grant execute on function public.seller_create_uploaded_hatching_egg_group_media(uuid, uuid, uuid, text, text, text, text, bigint, integer, integer, text, text, integer, boolean) to authenticated;

commit;
