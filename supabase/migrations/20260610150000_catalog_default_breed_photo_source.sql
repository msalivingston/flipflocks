begin;

alter table public.media_assets
add column if not exists source_type text not null default 'seller_upload';

alter table public.media_assets
add column if not exists source_breed_id uuid references public.breeds(id);

alter table public.media_assets
add column if not exists source_image_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_assets_source_type_check'
      and conrelid = 'public.media_assets'::regclass
  ) then
    alter table public.media_assets
    add constraint media_assets_source_type_check check (
      source_type in ('seller_upload', 'catalog_breed_image')
    );
  end if;
end $$;

comment on column public.media_assets.source_type is
'Source marker for seller media. seller_upload is normal seller-uploaded media; catalog_breed_image marks a restored default catalog breed image copied into seller media.';

comment on column public.media_assets.source_breed_id is
'Catalog breed source when source_type is catalog_breed_image.';

comment on column public.media_assets.source_image_url is
'Catalog image URL/path used when source_type is catalog_breed_image. Used to avoid restoring duplicate active default photos.';

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
  media_assets.source_image_url
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
    media_assets.source_image_url
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.id = any(p_media_link_ids);
$$;

commit;
