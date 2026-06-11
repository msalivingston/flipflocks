-- Group 72 follow-up: editable platform catalog breed details.
--
-- Scope:
-- - Keep /admin/breeds image workflow intact.
-- - Add narrow platform-admin editing for descriptive catalog fields only.
-- - No seller_breed_profiles changes, seller media writes, breed creation, or
--   breed deletion.

begin;

drop function if exists public.admin_update_catalog_breed_image_url(uuid, text);
drop function if exists public.admin_catalog_breed_detail(uuid);
drop function if exists public.admin_catalog_breed_list();

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
  category text,
  bird_type text,
  egg_color text,
  annual_egg_production text,
  image_prompt text,
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
    breeds.category,
    breeds.bird_type,
    breeds.egg_color,
    breeds.annual_egg_production,
    breeds.image_prompt,
    breeds.is_active,
    breeds.sort_order,
    breeds.updated_at
  from public.breeds
  join public.species
    on species.id = breeds.species_id
  order by
    species.common_name asc,
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
  category text,
  bird_type text,
  egg_color text,
  annual_egg_production text,
  image_prompt text,
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
    breeds.category,
    breeds.bird_type,
    breeds.egg_color,
    breeds.annual_egg_production,
    breeds.image_prompt,
    breeds.is_active,
    breeds.sort_order,
    breeds.updated_at
  from public.breeds
  join public.species
    on species.id = breeds.species_id
  where breeds.id = p_breed_id;
end;
$$;

create or replace function public.admin_update_catalog_breed_details(
  p_breed_id uuid,
  p_description text default null,
  p_category text default null,
  p_bird_type text default null,
  p_egg_color text default null,
  p_annual_egg_production text default null,
  p_image_prompt text default null
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
  category text,
  bird_type text,
  egg_color text,
  annual_egg_production text,
  image_prompt text,
  is_active boolean,
  sort_order integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_category text := nullif(trim(coalesce(p_category, '')), '');
  v_bird_type text := nullif(trim(coalesce(p_bird_type, '')), '');
  v_egg_color text := nullif(trim(coalesce(p_egg_color, '')), '');
  v_annual_egg_production text := nullif(trim(coalesce(p_annual_egg_production, '')), '');
  v_image_prompt text := nullif(trim(coalesce(p_image_prompt, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Not authorized to update platform admin breed data.';
  end if;

  if p_breed_id is null then
    raise exception 'Breed is required.';
  end if;

  if v_bird_type is not null
    and v_bird_type not in ('layer', 'meat', 'dual_purpose') then
    raise exception 'Invalid bird type.';
  end if;

  if v_annual_egg_production is not null
    and v_annual_egg_production not in (
      'under_150',
      '150_200',
      '200_250',
      '250_300',
      'over_300'
    ) then
    raise exception 'Invalid annual egg production.';
  end if;

  update public.breeds
  set
    description = v_description,
    category = v_category,
    bird_type = v_bird_type,
    egg_color = v_egg_color,
    annual_egg_production = v_annual_egg_production,
    image_prompt = v_image_prompt,
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
  category text,
  bird_type text,
  egg_color text,
  annual_egg_production text,
  image_prompt text,
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

comment on function public.admin_update_catalog_breed_details(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) is
'Platform-admin-only updater for descriptive public.breeds catalog fields. Does not update identity, active state, sort order, seller profiles, or media.';

revoke all on function public.admin_update_catalog_breed_details(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.admin_update_catalog_breed_details(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

commit;
