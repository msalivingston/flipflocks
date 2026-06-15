begin;

alter table public.media_links
add column if not exists crop_metadata jsonb;

comment on column public.media_links.crop_metadata is
'Optional non-destructive crop/reposition transform for storefront media previews. Null means use the original image framing.';

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

create or replace function public.seller_update_media_crop(
  p_media_link_id uuid,
  p_crop_metadata jsonb
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.media_links;
  v_normalized_crop jsonb;
begin
  select *
  into v_link
  from public.media_links
  where id = p_media_link_id
    and visibility_status = 'active';

  if not found or not (public.owns_store(v_link.store_id) or public.is_admin()) then
    raise exception 'Media link not found';
  end if;

  if p_crop_metadata is null then
    v_normalized_crop := null;
  else
    if jsonb_typeof(p_crop_metadata) <> 'object' then
      raise exception 'Crop metadata must be a JSON object';
    end if;

    if not (
      p_crop_metadata ? 'aspect'
      and p_crop_metadata ? 'x'
      and p_crop_metadata ? 'y'
      and p_crop_metadata ? 'zoom'
      and p_crop_metadata ? 'rotation'
    ) then
      raise exception 'Crop metadata is missing required fields';
    end if;

    if jsonb_typeof(p_crop_metadata -> 'aspect') <> 'number'
      or (p_crop_metadata ->> 'aspect')::numeric <= 0 then
      raise exception 'Crop aspect must be a positive number';
    end if;

    if jsonb_typeof(p_crop_metadata -> 'zoom') <> 'number'
      or (p_crop_metadata ->> 'zoom')::numeric <= 0 then
      raise exception 'Crop zoom must be a positive number';
    end if;

    if jsonb_typeof(p_crop_metadata -> 'x') <> 'number'
      or jsonb_typeof(p_crop_metadata -> 'y') <> 'number' then
      raise exception 'Crop position must be numeric';
    end if;

    if jsonb_typeof(p_crop_metadata -> 'rotation') <> 'number'
      or (p_crop_metadata ->> 'rotation')::numeric not in (0, 90, 180, 270) then
      raise exception 'Crop rotation must be 0, 90, 180, or 270';
    end if;

    v_normalized_crop := jsonb_build_object(
      'aspect', (p_crop_metadata ->> 'aspect')::numeric,
      'x', (p_crop_metadata ->> 'x')::numeric,
      'y', (p_crop_metadata ->> 'y')::numeric,
      'zoom', (p_crop_metadata ->> 'zoom')::numeric,
      'rotation', (p_crop_metadata ->> 'rotation')::integer
    );
  end if;

  update public.media_links
  set
    crop_metadata = v_normalized_crop,
    updated_at = now()
  where id = v_link.id
  returning * into v_link;

  return query
  select *
  from public.media_management_response_for_links(array[v_link.id]);
end;
$$;

revoke all on function public.seller_update_media_crop(uuid, jsonb) from public;
grant execute on function public.seller_update_media_crop(uuid, jsonb) to authenticated;

commit;
