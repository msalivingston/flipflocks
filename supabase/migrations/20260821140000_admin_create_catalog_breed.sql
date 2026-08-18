-- Allow platform admins to create canonical global Breed Catalog records.

begin;

create function public.admin_create_catalog_breed(
  p_species_id uuid,
  p_breed_name text,
  p_variety text default null,
  p_category text default null,
  p_egg_color text default null,
  p_annual_egg_production text default null,
  p_description text default null
)
returns table (
  breed_id uuid,
  breed_slug text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_breed_id uuid;
  v_species_slug text;
  v_breed_name text := nullif(btrim(p_breed_name), '');
  v_variety text := nullif(btrim(p_variety), '');
  v_category text := nullif(btrim(p_category), '');
  v_egg_color text := nullif(btrim(p_egg_color), '');
  v_annual_egg_production text := nullif(btrim(p_annual_egg_production), '');
  v_description text := nullif(btrim(p_description), '');
  v_normalized_breed_name text;
  v_normalized_variety text;
  v_breed_slug text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized to create platform catalog breeds.';
  end if;

  if p_species_id is null then
    raise exception 'Choose an active species.';
  end if;

  select species.slug
  into v_species_slug
  from public.species
  where species.id = p_species_id
    and species.is_active = true;

  if v_species_slug is null then
    raise exception 'Choose an active species.';
  end if;

  if v_breed_name is null then
    raise exception 'Add a breed name.';
  end if;

  if v_variety is not null and char_length(v_variety) > 120 then
    raise exception 'Variety must be 120 characters or less.';
  end if;

  if v_description is not null and char_length(v_description) > 1500 then
    raise exception 'Catalog description must be 1500 characters or less.';
  end if;

  if v_category is not null and v_category not in (
    'Layers', 'Bantams', 'Specialty / Project', 'Meat Birds', 'Dual Purpose'
  ) then
    raise exception 'Choose a supported Breed Category.';
  end if;

  if v_egg_color is not null and v_egg_color not in (
    'white', 'light_brown', 'brown', 'dark_brown', 'blue', 'blue_green',
    'green', 'olive'
  ) then
    raise exception 'Choose a supported egg color.';
  end if;

  if v_annual_egg_production is not null and v_annual_egg_production not in (
    'under_150', '150_200', '200_250', '250_300', 'over_300'
  ) then
    raise exception 'Choose a supported annual egg production range.';
  end if;

  if v_species_slug = 'chicken' then
    if v_category is null then
      raise exception 'Choose a Breed Category for this chicken breed.';
    end if;
  else
    v_category := null;
    v_egg_color := null;
    v_annual_egg_production := null;
  end if;

  v_normalized_breed_name := lower(
    regexp_replace(v_breed_name, '[[:space:]]+', ' ', 'g')
  );
  v_normalized_variety := lower(
    regexp_replace(coalesce(v_variety, ''), '[[:space:]]+', ' ', 'g')
  );

  if exists (
    select 1
    from public.breeds
    where breeds.species_id = p_species_id
      and lower(
        regexp_replace(btrim(breeds.breed_name), '[[:space:]]+', ' ', 'g')
      ) = v_normalized_breed_name
      and lower(
        regexp_replace(
          btrim(coalesce(breeds.variety, '')),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ) = v_normalized_variety
  ) then
    raise exception using
      errcode = '23505',
      message = 'A catalog breed with this Breed and Variety already exists for the selected species.';
  end if;

  v_breed_slug := regexp_replace(
    regexp_replace(
      lower(v_breed_name || case when v_variety is null then '' else ' ' || v_variety end),
      '[^a-z0-9]+',
      '-',
      'g'
    ),
    '(^-|-$)',
    '',
    'g'
  );

  if v_breed_slug = '' then
    raise exception 'Breed and Variety must produce a valid catalog slug.';
  end if;

  begin
    insert into public.breeds (
      species_id,
      breed_name,
      variety,
      breed_slug,
      description,
      category,
      egg_color,
      annual_egg_production,
      is_active,
      is_custom
    ) values (
      p_species_id,
      v_breed_name,
      v_variety,
      v_breed_slug,
      v_description,
      v_category,
      v_egg_color,
      v_annual_egg_production,
      true,
      false
    )
    returning breeds.id into v_breed_id;
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'A catalog breed with this Breed and Variety already exists for the selected species.';
  end;

  return query
  select v_breed_id, v_breed_slug;
end;
$$;

revoke all on function public.admin_create_catalog_breed(
  uuid, text, text, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.admin_create_catalog_breed(
  uuid, text, text, text, text, text, text
) to authenticated;

comment on function public.admin_create_catalog_breed(
  uuid, text, text, text, text, text, text
) is
'Platform-admin-only creation of one canonical active, non-custom global Breed Catalog record. Creates no seller profiles, seller media, aliases, or store-owned records.';

commit;
