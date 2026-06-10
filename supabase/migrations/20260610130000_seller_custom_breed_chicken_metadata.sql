-- Seller custom breed chicken metadata.
--
-- Seller-created custom breeds continue to live only in seller_breed_profiles.
-- These optional fields capture controlled chicken traits when supplied by the
-- seller workflow; non-chicken profiles can leave them null.

alter table public.seller_breed_profiles
add column if not exists bird_type text;

alter table public.seller_breed_profiles
add column if not exists egg_color text;

alter table public.seller_breed_profiles
add column if not exists annual_egg_production text;

alter table public.seller_breed_profiles
drop constraint if exists seller_breed_profiles_bird_type_check,
add constraint seller_breed_profiles_bird_type_check check (
  bird_type is null
  or bird_type in ('layer', 'meat', 'dual_purpose')
);

alter table public.seller_breed_profiles
drop constraint if exists seller_breed_profiles_egg_color_check,
add constraint seller_breed_profiles_egg_color_check check (
  egg_color is null
  or egg_color in (
    'white',
    'light_brown',
    'brown',
    'dark_brown',
    'blue',
    'blue_green',
    'green',
    'olive'
  )
);

alter table public.seller_breed_profiles
drop constraint if exists seller_breed_profiles_annual_egg_production_check,
add constraint seller_breed_profiles_annual_egg_production_check check (
  annual_egg_production is null
  or annual_egg_production in (
    'under_150',
    '150_200',
    '200_250',
    '250_300',
    'over_300'
  )
);

comment on column public.seller_breed_profiles.bird_type is
'Optional controlled chicken-purpose value supplied by sellers for custom breed profiles.';

comment on column public.seller_breed_profiles.egg_color is
'Optional controlled egg-color value supplied by sellers for custom chicken breed profiles.';

comment on column public.seller_breed_profiles.annual_egg_production is
'Optional controlled annual egg production range supplied by sellers for custom chicken breed profiles.';

drop function if exists public.seller_upsert_breed_profile(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid
);

create or replace function public.seller_upsert_breed_profile(
  p_store_id uuid,
  p_species_id uuid,
  p_breed_id uuid default null,
  p_custom_breed_name text default null,
  p_display_name text default null,
  p_seller_description text default null,
  p_seller_notes text default null,
  p_visibility_status text default 'active',
  p_seller_breed_profile_id uuid default null,
  p_bird_type text default null,
  p_egg_color text default null,
  p_annual_egg_production text default null
)
returns table (
  seller_breed_profile_id uuid,
  store_id uuid,
  species_id uuid,
  breed_id uuid,
  custom_breed_name text,
  normalized_custom_breed_name text,
  display_name text,
  seller_description text,
  seller_notes text,
  visibility_status text,
  created_at timestamptz,
  updated_at timestamptz,
  bird_type text,
  egg_color text,
  annual_egg_production text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.seller_breed_profiles%rowtype;
  v_breed public.breeds%rowtype;
  v_custom_breed_name text;
  v_normalized_custom_breed_name text;
  v_display_name text;
  v_visibility_status text;
  v_bird_type text;
  v_egg_color text;
  v_annual_egg_production text;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if p_species_id is null then
    raise exception 'Species is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to manage breed profiles for this store.';
  end if;

  if not exists (
    select 1
    from public.species as s
    where s.id = p_species_id
      and s.is_active = true
  ) then
    raise exception 'Species is not available.';
  end if;

  v_custom_breed_name := nullif(trim(p_custom_breed_name), '');
  v_normalized_custom_breed_name := public.normalize_seller_custom_breed_name(v_custom_breed_name);
  v_visibility_status := coalesce(nullif(trim(p_visibility_status), ''), 'active');
  v_bird_type := nullif(trim(p_bird_type), '');
  v_egg_color := nullif(trim(p_egg_color), '');
  v_annual_egg_production := nullif(trim(p_annual_egg_production), '');

  if v_visibility_status not in ('active', 'hidden', 'archived') then
    raise exception 'Breed profile visibility status is not supported.';
  end if;

  if v_bird_type is not null
    and v_bird_type not in ('layer', 'meat', 'dual_purpose') then
    raise exception 'Choose a supported bird type.';
  end if;

  if v_egg_color is not null
    and v_egg_color not in (
      'white',
      'light_brown',
      'brown',
      'dark_brown',
      'blue',
      'blue_green',
      'green',
      'olive'
    ) then
    raise exception 'Choose a supported egg color.';
  end if;

  if v_annual_egg_production is not null
    and v_annual_egg_production not in (
      'under_150',
      '150_200',
      '200_250',
      '250_300',
      'over_300'
    ) then
    raise exception 'Choose a supported annual egg production range.';
  end if;

  if (p_breed_id is null and v_custom_breed_name is null)
    or (p_breed_id is not null and v_custom_breed_name is not null) then
    raise exception 'Provide exactly one breed source: platform breed or custom breed name.';
  end if;

  if p_breed_id is not null then
    select b.*
    into v_breed
    from public.breeds as b
    where b.id = p_breed_id
      and b.is_active = true;

    if v_breed.id is null then
      raise exception 'Breed is not available.';
    end if;

    if v_breed.species_id <> p_species_id then
      raise exception 'Breed does not belong to the selected species.';
    end if;
  end if;

  if v_custom_breed_name is not null
    and v_normalized_custom_breed_name is null then
    raise exception 'Custom breed name is invalid.';
  end if;

  v_display_name := coalesce(
    nullif(trim(p_display_name), ''),
    v_custom_breed_name,
    v_breed.breed_name
  );

  if v_display_name is null then
    raise exception 'Display name is required.';
  end if;

  if p_seller_breed_profile_id is not null then
    select sbp.*
    into v_profile
    from public.seller_breed_profiles as sbp
    where sbp.id = p_seller_breed_profile_id
      and sbp.store_id = p_store_id
    for update;

    if v_profile.id is null then
      raise exception 'Seller breed profile is not available for this store.';
    end if;

    if exists (
      select 1
      from public.listing_batch_breeds as lbb
      where lbb.seller_breed_profile_id = v_profile.id
    )
    and (
      v_profile.species_id is distinct from p_species_id
      or v_profile.breed_id is distinct from p_breed_id
      or v_profile.normalized_custom_breed_name is distinct from case
        when p_breed_id is null then v_normalized_custom_breed_name
        else null
      end
    ) then
      raise exception 'Breed source cannot be changed after the profile is used in listing batches.';
    end if;

    update public.seller_breed_profiles as sbp
    set
      species_id = p_species_id,
      breed_id = p_breed_id,
      custom_breed_name = v_custom_breed_name,
      normalized_custom_breed_name = case
        when p_breed_id is null then v_normalized_custom_breed_name
        else null
      end,
      display_name = v_display_name,
      seller_description = nullif(trim(p_seller_description), ''),
      seller_notes = nullif(trim(p_seller_notes), ''),
      visibility_status = v_visibility_status,
      bird_type = coalesce(v_bird_type, sbp.bird_type),
      egg_color = coalesce(v_egg_color, sbp.egg_color),
      annual_egg_production = coalesce(
        v_annual_egg_production,
        sbp.annual_egg_production
      )
    where sbp.id = v_profile.id
    returning sbp.* into v_profile;
  elsif p_breed_id is not null then
    select sbp.*
    into v_profile
    from public.seller_breed_profiles as sbp
    where sbp.store_id = p_store_id
      and sbp.species_id = p_species_id
      and sbp.breed_id = p_breed_id
    for update;

    if v_profile.id is not null then
      update public.seller_breed_profiles as sbp
      set
        display_name = v_display_name,
        seller_description = nullif(trim(p_seller_description), ''),
        seller_notes = nullif(trim(p_seller_notes), ''),
        visibility_status = v_visibility_status,
        bird_type = coalesce(v_bird_type, sbp.bird_type),
        egg_color = coalesce(v_egg_color, sbp.egg_color),
        annual_egg_production = coalesce(
          v_annual_egg_production,
          sbp.annual_egg_production
        )
      where sbp.id = v_profile.id
      returning sbp.* into v_profile;
    else
      insert into public.seller_breed_profiles as sbp (
        store_id,
        species_id,
        breed_id,
        custom_breed_name,
        normalized_custom_breed_name,
        display_name,
        seller_description,
        seller_notes,
        visibility_status,
        bird_type,
        egg_color,
        annual_egg_production
      )
      values (
        p_store_id,
        p_species_id,
        p_breed_id,
        null,
        null,
        v_display_name,
        nullif(trim(p_seller_description), ''),
        nullif(trim(p_seller_notes), ''),
        v_visibility_status,
        v_bird_type,
        v_egg_color,
        v_annual_egg_production
      )
      returning sbp.* into v_profile;
    end if;
  else
    select sbp.*
    into v_profile
    from public.seller_breed_profiles as sbp
    where sbp.store_id = p_store_id
      and sbp.species_id = p_species_id
      and sbp.normalized_custom_breed_name = v_normalized_custom_breed_name
    for update;

    if v_profile.id is not null then
      update public.seller_breed_profiles as sbp
      set
        custom_breed_name = v_custom_breed_name,
        display_name = v_display_name,
        seller_description = nullif(trim(p_seller_description), ''),
        seller_notes = nullif(trim(p_seller_notes), ''),
        visibility_status = v_visibility_status,
        bird_type = coalesce(v_bird_type, sbp.bird_type),
        egg_color = coalesce(v_egg_color, sbp.egg_color),
        annual_egg_production = coalesce(
          v_annual_egg_production,
          sbp.annual_egg_production
        )
      where sbp.id = v_profile.id
      returning sbp.* into v_profile;
    else
      insert into public.seller_breed_profiles as sbp (
        store_id,
        species_id,
        breed_id,
        custom_breed_name,
        normalized_custom_breed_name,
        display_name,
        seller_description,
        seller_notes,
        visibility_status,
        bird_type,
        egg_color,
        annual_egg_production
      )
      values (
        p_store_id,
        p_species_id,
        null,
        v_custom_breed_name,
        v_normalized_custom_breed_name,
        v_display_name,
        nullif(trim(p_seller_description), ''),
        nullif(trim(p_seller_notes), ''),
        v_visibility_status,
        v_bird_type,
        v_egg_color,
        v_annual_egg_production
      )
      returning sbp.* into v_profile;
    end if;
  end if;

  return query
  select
    v_profile.id,
    v_profile.store_id,
    v_profile.species_id,
    v_profile.breed_id,
    v_profile.custom_breed_name,
    v_profile.normalized_custom_breed_name,
    v_profile.display_name,
    v_profile.seller_description,
    v_profile.seller_notes,
    v_profile.visibility_status,
    v_profile.created_at,
    v_profile.updated_at,
    v_profile.bird_type,
    v_profile.egg_color,
    v_profile.annual_egg_production;
end;
$$;

comment on function public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, text
) is
'Seller/admin RPC for creating or updating seller-owned breed profiles. Validates species/breed consistency, accepts optional controlled chicken metadata, never accepts moderation fields, and keeps seller-created custom breeds in seller_breed_profiles only.';
