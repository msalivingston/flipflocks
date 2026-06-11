-- Group 72: Admin breed catalog image manager.
--
-- Scope:
-- - Public catalog image storage bucket for platform-managed breed photos.
-- - Narrow platform-admin RPCs for listing/detail and image_url fallback update.
-- - No seller_breed_profiles changes, seller media writes, breed CRUD, or restore
--   behavior changes.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog-images',
  'catalog-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.admin_catalog_breed_list()
returns table (
  breed_id uuid,
  species_id uuid,
  species_name text,
  species_slug text,
  breed_name text,
  breed_slug text,
  image_url text,
  has_image boolean,
  bird_type text,
  egg_color text,
  annual_egg_production text,
  is_active boolean,
  sort_order integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized to view platform admin breed data.';
  end if;

  return query
  select
    breeds.id as breed_id,
    species.id as species_id,
    species.common_name as species_name,
    species.slug as species_slug,
    breeds.breed_name,
    breeds.breed_slug,
    breeds.image_url,
    nullif(trim(coalesce(breeds.image_url, '')), '') is not null as has_image,
    breeds.bird_type,
    breeds.egg_color,
    breeds.annual_egg_production,
    breeds.is_active,
    breeds.sort_order,
    breeds.updated_at
  from public.breeds
  join public.species
    on species.id = breeds.species_id
  order by
    (nullif(trim(coalesce(breeds.image_url, '')), '') is not null) asc,
    species.sort_order asc,
    species.common_name asc,
    breeds.sort_order asc,
    breeds.breed_name asc;
end;
$$;

create or replace function public.admin_catalog_breed_detail(
  p_breed_id uuid
)
returns table (
  breed_id uuid,
  species_id uuid,
  species_name text,
  species_slug text,
  breed_name text,
  breed_slug text,
  description text,
  image_url text,
  has_image boolean,
  bird_type text,
  egg_color text,
  annual_egg_production text,
  is_active boolean,
  sort_order integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized to view platform admin breed data.';
  end if;

  if p_breed_id is null then
    raise exception 'Breed is required.';
  end if;

  return query
  select
    breeds.id as breed_id,
    species.id as species_id,
    species.common_name as species_name,
    species.slug as species_slug,
    breeds.breed_name,
    breeds.breed_slug,
    breeds.description,
    breeds.image_url,
    nullif(trim(coalesce(breeds.image_url, '')), '') is not null as has_image,
    breeds.bird_type,
    breeds.egg_color,
    breeds.annual_egg_production,
    breeds.is_active,
    breeds.sort_order,
    breeds.updated_at
  from public.breeds
  join public.species
    on species.id = breeds.species_id
  where breeds.id = p_breed_id;
end;
$$;

create or replace function public.admin_update_catalog_breed_image_url(
  p_breed_id uuid,
  p_image_url text
)
returns table (
  breed_id uuid,
  species_id uuid,
  species_name text,
  species_slug text,
  breed_name text,
  breed_slug text,
  description text,
  image_url text,
  has_image boolean,
  bird_type text,
  egg_color text,
  annual_egg_production text,
  is_active boolean,
  sort_order integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_image_url text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to update platform admin breed data.';
  end if;

  if p_breed_id is null then
    raise exception 'Breed is required.';
  end if;

  v_image_url := nullif(trim(coalesce(p_image_url, '')), '');

  if v_image_url is not null and length(v_image_url) > 2048 then
    raise exception 'Image URL is too long.';
  end if;

  update public.breeds
  set
    image_url = v_image_url,
    updated_at = now()
  where breeds.id = p_breed_id;

  if not found then
    raise exception 'Breed not found.';
  end if;

  return query
  select *
  from public.admin_catalog_breed_detail(p_breed_id);
end;
$$;

comment on function public.admin_catalog_breed_list() is
'Platform-admin-only breed catalog image work queue for /admin/breeds.';

comment on function public.admin_catalog_breed_detail(uuid) is
'Platform-admin-only breed catalog detail projection for image management.';

comment on function public.admin_update_catalog_breed_image_url(uuid, text) is
'Platform-admin-only fallback updater for public.breeds.image_url. Normal uploads go through the admin catalog image Edge Function.';

revoke all on function public.admin_catalog_breed_list() from public;
revoke all on function public.admin_catalog_breed_detail(uuid) from public;
revoke all on function public.admin_update_catalog_breed_image_url(uuid, text) from public;

grant execute on function public.admin_catalog_breed_list() to authenticated;
grant execute on function public.admin_catalog_breed_detail(uuid) to authenticated;
grant execute on function public.admin_update_catalog_breed_image_url(uuid, text) to authenticated;

commit;
