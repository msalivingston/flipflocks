-- Finalize the default/seller Breed + Variety + Breed Category structure.
-- This migration deliberately does not recreate or alter any view.

begin;

alter table public.breeds
  add column variety text null;

alter table public.seller_breed_profiles
  add column variety text null,
  add column breed_category text null;

alter table public.breeds
  add constraint breeds_variety_length_check
    check (variety is null or length(btrim(variety)) between 1 and 120),
  add constraint breeds_category_allowed_check
    check (
      category is null
      or category in (
        'Layers',
        'Bantams',
        'Specialty / Project',
        'Meat Birds',
        'Dual Purpose',
        'Gamebird',
        'ornamental',
        'pigeon-dove',
        'ratite',
        'turkey',
        'Waterfowl'
      )
    );

create function public.validate_chicken_breed_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.species
    where species.id = new.species_id and species.slug = 'chicken'
  ) and (
    new.category is null
    or new.category not in (
      'Layers',
      'Bantams',
      'Specialty / Project',
      'Meat Birds',
      'Dual Purpose'
    )
  ) then
    raise exception 'Chicken Breed Category must use a finalized controlled value.';
  end if;
  return new;
end;
$$;

create trigger validate_chicken_breed_category_trigger
before insert or update of species_id, category on public.breeds
for each row execute function public.validate_chicken_breed_category();

revoke all on function public.validate_chicken_breed_category() from public;

alter table public.seller_breed_profiles
  add constraint seller_breed_profiles_variety_length_check
    check (variety is null or length(btrim(variety)) between 1 and 120),
  add constraint seller_breed_profiles_breed_category_check
    check (
      breed_category is null
      or breed_category in (
        'Layers',
        'Bantams',
        'Specialty / Project',
        'Meat Birds',
        'Dual Purpose'
      )
    );

create temporary table breed_identity_before_migration
on commit drop
as
select
  breeds.id,
  breeds.breed_slug,
  breeds.breed_name,
  breeds.category
from public.breeds;

do $$
begin
  if exists (
    select 1
    from public.breeds
    join public.species on species.id = breeds.species_id
    where species.slug = 'chicken'
      and breeds.is_active = true
      and breeds.is_custom = false
      and breeds.breed_name like '% - %'
      and cardinality(string_to_array(breeds.breed_name, ' - ')) <> 2
  ) then
    raise exception 'Active chicken Breed Library contains an ambiguous Breed - Variety label.';
  end if;
end;
$$;

update public.breeds
set
  breed_name = btrim(split_part(breed_name, ' - ', 1)),
  variety = nullif(btrim(split_part(breed_name, ' - ', 2)), ''),
  updated_at = now()
from public.species
where species.id = breeds.species_id
  and species.slug = 'chicken'
  and breeds.is_active = true
  and breeds.is_custom = false
  and breeds.breed_name like '% - %';

do $$
begin
  if (
    select count(*) from public.breeds
  ) <> (
    select count(*) from breed_identity_before_migration
  ) then
    raise exception 'Breed record count changed during Breed + Variety backfill.';
  end if;

  if exists (
    select 1
    from breed_identity_before_migration as before
    left join public.breeds as after on after.id = before.id
    where after.id is null
      or after.breed_slug is distinct from before.breed_slug
      or after.category is distinct from before.category
  ) then
    raise exception 'Breed ID, slug, or category changed during Breed + Variety backfill.';
  end if;

  if exists (
    select 1
    from public.breeds
    join public.species on species.id = breeds.species_id
    where species.slug = 'chicken'
      and breeds.is_active = true
      and breeds.is_custom = false
      and breeds.breed_name like '% - %'
  ) then
    raise exception 'An active chicken Breed Library name remained combined after backfill.';
  end if;
end;
$$;

-- Fill only the newly introduced independent seller snapshot fields. Existing
-- display names and every pre-existing seller-owned field remain untouched.
update public.seller_breed_profiles as seller_profiles
set
  variety = coalesce(seller_profiles.variety, breeds.variety),
  breed_category = coalesce(
    seller_profiles.breed_category,
    case when species.slug = 'chicken' then breeds.category else null end
  )
from public.breeds as breeds
join public.species on species.id = breeds.species_id
where seller_profiles.breed_id = breeds.id
  and seller_profiles.breed_id is not null
  and (
    (seller_profiles.variety is null and breeds.variety is not null)
    or (
      seller_profiles.breed_category is null
      and species.slug = 'chicken'
      and breeds.category is not null
    )
  );

drop index if exists public.seller_breed_profiles_store_species_custom_name_unique_idx;

create unique index seller_breed_profiles_store_species_custom_name_unique_idx
on public.seller_breed_profiles (
  store_id,
  species_id,
  normalized_custom_breed_name,
  lower(btrim(coalesce(variety, ''))),
  coalesce(breed_category, '')
)
where breed_id is null;

drop function if exists public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, text
);

create function public.seller_upsert_breed_profile(
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
  p_annual_egg_production text default null,
  p_variety text default null,
  p_breed_category text default null,
  p_update_identity boolean default false
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
  annual_egg_production text,
  variety text,
  breed_category text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.seller_breed_profiles%rowtype;
  v_breed public.breeds%rowtype;
  v_custom_breed_name text := nullif(btrim(p_custom_breed_name), '');
  v_normalized_custom_breed_name text;
  v_display_name text;
  v_visibility_status text := coalesce(nullif(btrim(p_visibility_status), ''), 'active');
  v_bird_type text := nullif(btrim(p_bird_type), '');
  v_egg_color text := nullif(btrim(p_egg_color), '');
  v_annual_egg_production text := nullif(btrim(p_annual_egg_production), '');
  v_variety text := nullif(btrim(p_variety), '');
  v_breed_category text := nullif(btrim(p_breed_category), '');
  v_species_slug text;
begin
  if p_store_id is null or p_species_id is null then
    raise exception 'Store and species are required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to manage breed profiles for this store.';
  end if;

  select species.slug into v_species_slug
  from public.species
  where species.id = p_species_id and species.is_active = true;
  if v_species_slug is null then
    raise exception 'Species is not available.';
  end if;

  if v_visibility_status not in ('active', 'hidden', 'archived') then
    raise exception 'Breed profile visibility status is not supported.';
  end if;

  if v_bird_type is not null
    and v_bird_type not in ('layer', 'meat', 'dual_purpose') then
    raise exception 'Choose a supported bird type.';
  end if;

  if p_breed_id is null and v_breed_category is not null
    and v_breed_category not in (
      'Layers', 'Bantams', 'Specialty / Project', 'Meat Birds', 'Dual Purpose'
    ) then
    raise exception 'Choose a supported Breed Category.';
  end if;

  if v_egg_color is not null
    and v_egg_color not in (
      'white', 'light_brown', 'brown', 'dark_brown', 'blue', 'blue_green',
      'green', 'olive'
    ) then
    raise exception 'Choose a supported egg color.';
  end if;

  if v_annual_egg_production is not null
    and v_annual_egg_production not in (
      'under_150', '150_200', '200_250', '250_300', 'over_300'
    ) then
    raise exception 'Choose a supported annual egg production range.';
  end if;

  if (p_breed_id is null and v_custom_breed_name is null)
    or (p_breed_id is not null and v_custom_breed_name is not null) then
    raise exception 'Provide exactly one breed source: platform breed or custom breed name.';
  end if;

  if p_breed_id is not null then
    select breeds.* into v_breed
    from public.breeds
    where breeds.id = p_breed_id and breeds.is_active = true;

    if v_breed.id is null then
      raise exception 'Breed is not available.';
    end if;
    if v_breed.species_id <> p_species_id then
      raise exception 'Breed does not belong to the selected species.';
    end if;
  end if;

  v_normalized_custom_breed_name :=
    public.normalize_seller_custom_breed_name(v_custom_breed_name);

  if v_custom_breed_name is not null and v_normalized_custom_breed_name is null then
    raise exception 'Custom breed name is invalid.';
  end if;

  v_display_name := coalesce(
    nullif(btrim(p_display_name), ''),
    case
      when v_custom_breed_name is not null and v_variety is not null
        then v_custom_breed_name || ' - ' || v_variety
      else v_custom_breed_name
    end,
    case
      when v_breed.variety is not null
        then v_breed.breed_name || ' - ' || v_breed.variety
      else v_breed.breed_name
    end
  );

  if v_display_name is null then
    raise exception 'Display name is required.';
  end if;

  if p_seller_breed_profile_id is not null then
    select seller_profiles.* into v_profile
    from public.seller_breed_profiles as seller_profiles
    where seller_profiles.id = p_seller_breed_profile_id
      and seller_profiles.store_id = p_store_id
    for update;

    if v_profile.id is null then
      raise exception 'Seller breed profile is not available for this store.';
    end if;

    if exists (
      select 1 from public.listing_batch_breeds
      where listing_batch_breeds.seller_breed_profile_id = v_profile.id
    ) and (
      v_profile.species_id is distinct from p_species_id
      or v_profile.breed_id is distinct from p_breed_id
    ) then
      raise exception 'Breed source cannot be changed after the profile is used in listing batches.';
    end if;

    update public.seller_breed_profiles as seller_profiles
    set
      species_id = p_species_id,
      breed_id = p_breed_id,
      custom_breed_name = v_custom_breed_name,
      normalized_custom_breed_name = case
        when p_breed_id is null then v_normalized_custom_breed_name else null
      end,
      display_name = v_display_name,
      variety = case when p_update_identity then v_variety else seller_profiles.variety end,
      breed_category = case
        when p_update_identity then v_breed_category
        else seller_profiles.breed_category
      end,
      seller_description = nullif(btrim(p_seller_description), ''),
      seller_notes = nullif(btrim(p_seller_notes), ''),
      visibility_status = v_visibility_status,
      bird_type = coalesce(v_bird_type, seller_profiles.bird_type),
      egg_color = coalesce(v_egg_color, seller_profiles.egg_color),
      annual_egg_production = coalesce(
        v_annual_egg_production, seller_profiles.annual_egg_production
      )
    where seller_profiles.id = v_profile.id
    returning seller_profiles.* into v_profile;
  elsif p_breed_id is not null then
    insert into public.seller_breed_profiles as seller_profiles (
      store_id, species_id, breed_id, custom_breed_name,
      normalized_custom_breed_name, display_name, variety, breed_category,
      seller_description, seller_notes, visibility_status, bird_type,
      egg_color, annual_egg_production
    ) values (
      p_store_id, p_species_id, p_breed_id, null, null,
      case when v_breed.variety is not null
        then v_breed.breed_name || ' - ' || v_breed.variety
        else v_breed.breed_name end,
      v_breed.variety,
      case when v_species_slug = 'chicken' then v_breed.category else null end,
      nullif(btrim(v_breed.description), ''), nullif(btrim(p_seller_notes), ''),
      v_visibility_status, v_breed.bird_type, v_breed.egg_color,
      v_breed.annual_egg_production
    )
    on conflict do nothing
    returning seller_profiles.* into v_profile;

    if v_profile.id is null then
      select seller_profiles.* into v_profile
      from public.seller_breed_profiles as seller_profiles
      where seller_profiles.store_id = p_store_id
        and seller_profiles.species_id = p_species_id
        and seller_profiles.breed_id = p_breed_id
      for update;

      if v_profile.id is null then
        raise exception 'Seller breed profile could not be resolved.';
      end if;

      if v_profile.visibility_status = 'archived' then
        update public.seller_breed_profiles as seller_profiles
        set visibility_status = 'active'
        where seller_profiles.id = v_profile.id
        returning seller_profiles.* into v_profile;
      end if;
    end if;
  else
    select seller_profiles.* into v_profile
    from public.seller_breed_profiles as seller_profiles
    where seller_profiles.store_id = p_store_id
      and seller_profiles.species_id = p_species_id
      and seller_profiles.normalized_custom_breed_name = v_normalized_custom_breed_name
      and lower(btrim(coalesce(seller_profiles.variety, ''))) = lower(coalesce(v_variety, ''))
      and coalesce(seller_profiles.breed_category, '') = coalesce(v_breed_category, '')
    for update;

    if v_profile.id is not null then
      update public.seller_breed_profiles as seller_profiles
      set
        custom_breed_name = v_custom_breed_name,
        display_name = v_display_name,
        variety = v_variety,
        breed_category = v_breed_category,
        seller_description = nullif(btrim(p_seller_description), ''),
        seller_notes = nullif(btrim(p_seller_notes), ''),
        visibility_status = v_visibility_status,
        bird_type = coalesce(v_bird_type, seller_profiles.bird_type),
        egg_color = coalesce(v_egg_color, seller_profiles.egg_color),
        annual_egg_production = coalesce(
          v_annual_egg_production, seller_profiles.annual_egg_production
        )
      where seller_profiles.id = v_profile.id
      returning seller_profiles.* into v_profile;
    else
      insert into public.seller_breed_profiles as seller_profiles (
        store_id, species_id, breed_id, custom_breed_name,
        normalized_custom_breed_name, display_name, variety, breed_category,
        seller_description, seller_notes, visibility_status, bird_type,
        egg_color, annual_egg_production
      ) values (
        p_store_id, p_species_id, null, v_custom_breed_name,
        v_normalized_custom_breed_name, v_display_name, v_variety,
        v_breed_category, nullif(btrim(p_seller_description), ''),
        nullif(btrim(p_seller_notes), ''), v_visibility_status, v_bird_type,
        v_egg_color, v_annual_egg_production
      )
      returning seller_profiles.* into v_profile;
    end if;
  end if;

  return query select
    v_profile.id, v_profile.store_id, v_profile.species_id,
    v_profile.breed_id, v_profile.custom_breed_name,
    v_profile.normalized_custom_breed_name, v_profile.display_name,
    v_profile.seller_description, v_profile.seller_notes,
    v_profile.visibility_status, v_profile.created_at, v_profile.updated_at,
    v_profile.bird_type, v_profile.egg_color,
    v_profile.annual_egg_production, v_profile.variety,
    v_profile.breed_category;
end;
$$;

revoke all on function public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, text,
  text, text, boolean
) from public;
grant execute on function public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, text,
  text, text, boolean
) to authenticated;

comment on function public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, text,
  text, text, boolean
) is
'Creates complete seller-owned Breed, Variety, Breed Category, and metadata snapshots; existing platform copies are returned or reactivated without implicit refresh.';

-- Admin RPC return contracts gain the canonical identity and temperament fields.
drop function if exists public.admin_update_catalog_breed_image_url(uuid, text);
drop function if exists public.admin_update_catalog_breed_details(
  uuid, text, text, text, text, text, text
);
drop function if exists public.admin_catalog_breed_detail(uuid);
drop function if exists public.admin_catalog_breed_list();

create function public.admin_catalog_breed_list()
returns table (
  breed_id uuid, species_id uuid, species_name text, species_slug text,
  breed_name text, variety text, breed_slug text, image_url text,
  has_image boolean, category text, bird_type text, egg_color text,
  annual_egg_production text, temperament text, image_prompt text,
  is_active boolean, sort_order integer, updated_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized to view platform admin breed data.';
  end if;
  return query
  select breeds.id, species.id, species.common_name, species.slug,
    breeds.breed_name, breeds.variety, breeds.breed_slug, breeds.image_url,
    nullif(btrim(coalesce(breeds.image_url, '')), '') is not null,
    breeds.category, breeds.bird_type, breeds.egg_color,
    breeds.annual_egg_production, breeds.temperament, breeds.image_prompt,
    breeds.is_active, breeds.sort_order, breeds.updated_at
  from public.breeds
  join public.species on species.id = breeds.species_id
  order by species.common_name, breeds.breed_name, breeds.variety nulls first;
end;
$$;

create function public.admin_catalog_breed_detail(p_breed_id uuid)
returns table (
  breed_id uuid, species_id uuid, species_name text, species_slug text,
  breed_name text, variety text, breed_slug text, description text,
  image_url text, has_image boolean, category text, bird_type text,
  egg_color text, annual_egg_production text, temperament text,
  image_prompt text, is_active boolean, sort_order integer,
  updated_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized to view platform admin breed data.';
  end if;
  if p_breed_id is null then raise exception 'Breed is required.'; end if;
  return query
  select breeds.id, species.id, species.common_name, species.slug,
    breeds.breed_name, breeds.variety, breeds.breed_slug, breeds.description,
    breeds.image_url,
    nullif(btrim(coalesce(breeds.image_url, '')), '') is not null,
    breeds.category, breeds.bird_type, breeds.egg_color,
    breeds.annual_egg_production, breeds.temperament, breeds.image_prompt,
    breeds.is_active, breeds.sort_order, breeds.updated_at
  from public.breeds
  join public.species on species.id = breeds.species_id
  where breeds.id = p_breed_id;
end;
$$;

create function public.admin_update_catalog_breed_details(
  p_breed_id uuid,
  p_description text default null,
  p_category text default null,
  p_bird_type text default null,
  p_egg_color text default null,
  p_annual_egg_production text default null,
  p_image_prompt text default null,
  p_breed_name text default null,
  p_variety text default null,
  p_temperament text default null
)
returns table (
  breed_id uuid, species_id uuid, species_name text, species_slug text,
  breed_name text, variety text, breed_slug text, description text,
  image_url text, has_image boolean, category text, bird_type text,
  egg_color text, annual_egg_production text, temperament text,
  image_prompt text, is_active boolean, sort_order integer,
  updated_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_breed_name text := nullif(btrim(p_breed_name), '');
  v_variety text := nullif(btrim(p_variety), '');
  v_category text := nullif(btrim(p_category), '');
  v_bird_type text := nullif(btrim(p_bird_type), '');
  v_annual_egg_production text := nullif(btrim(p_annual_egg_production), '');
  v_species_slug text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to update platform admin breed data.';
  end if;
  if p_breed_id is null then raise exception 'Breed is required.'; end if;
  if v_breed_name is null then raise exception 'Base Breed is required.'; end if;
  select species.slug into v_species_slug
  from public.breeds
  join public.species on species.id = breeds.species_id
  where breeds.id = p_breed_id;
  if v_species_slug is null then raise exception 'Breed not found.'; end if;
  if v_species_slug = 'chicken' and v_category not in (
    'Layers', 'Bantams', 'Specialty / Project', 'Meat Birds', 'Dual Purpose'
  ) then raise exception 'Invalid Breed Category.'; end if;
  if v_bird_type is not null
    and v_bird_type not in ('layer', 'meat', 'dual_purpose') then
    raise exception 'Invalid bird type.';
  end if;
  if v_annual_egg_production is not null
    and v_annual_egg_production not in (
      'under_150', '150_200', '200_250', '250_300', 'over_300'
    ) then raise exception 'Invalid annual egg production.'; end if;

  update public.breeds set
    breed_name = v_breed_name,
    variety = v_variety,
    description = nullif(btrim(p_description), ''),
    category = v_category,
    bird_type = v_bird_type,
    egg_color = nullif(btrim(p_egg_color), ''),
    annual_egg_production = v_annual_egg_production,
    temperament = nullif(btrim(p_temperament), ''),
    image_prompt = nullif(btrim(p_image_prompt), ''),
    updated_at = now()
  where breeds.id = p_breed_id;
  if not found then raise exception 'Breed not found.'; end if;
  return query select * from public.admin_catalog_breed_detail(p_breed_id);
end;
$$;

create function public.admin_update_catalog_breed_image_url(
  p_breed_id uuid, p_image_url text
)
returns table (
  breed_id uuid, species_id uuid, species_name text, species_slug text,
  breed_name text, variety text, breed_slug text, description text,
  image_url text, has_image boolean, category text, bird_type text,
  egg_color text, annual_egg_production text, temperament text,
  image_prompt text, is_active boolean, sort_order integer,
  updated_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare v_image_url text := nullif(btrim(p_image_url), '');
begin
  if not public.is_admin() then
    raise exception 'Not authorized to update platform admin breed data.';
  end if;
  if p_breed_id is null then raise exception 'Breed is required.'; end if;
  if v_image_url is not null and length(v_image_url) > 2048 then
    raise exception 'Image URL is too long.';
  end if;
  update public.breeds set image_url = v_image_url, updated_at = now()
  where breeds.id = p_breed_id;
  if not found then raise exception 'Breed not found.'; end if;
  return query select * from public.admin_catalog_breed_detail(p_breed_id);
end;
$$;

revoke all on function public.admin_catalog_breed_list() from public;
revoke all on function public.admin_catalog_breed_detail(uuid) from public;
revoke all on function public.admin_update_catalog_breed_details(
  uuid, text, text, text, text, text, text, text, text, text
) from public;
revoke all on function public.admin_update_catalog_breed_image_url(uuid, text) from public;

grant execute on function public.admin_catalog_breed_list() to authenticated;
grant execute on function public.admin_catalog_breed_detail(uuid) to authenticated;
grant execute on function public.admin_update_catalog_breed_details(
  uuid, text, text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.admin_update_catalog_breed_image_url(uuid, text) to authenticated;

comment on function public.admin_catalog_breed_list() is
'Platform-admin-only Breed Library projection with Base Breed, Variety, Breed Category, and canonical chicken metadata.';
comment on function public.admin_catalog_breed_detail(uuid) is
'Platform-admin-only detail projection for one default Breed Library record.';
comment on function public.admin_update_catalog_breed_details(
  uuid, text, text, text, text, text, text, text, text, text
) is
'Platform-admin-only updater for Base Breed, Variety, Breed Category, and existing catalog metadata. Stable IDs and slugs are unchanged.';
comment on function public.admin_update_catalog_breed_image_url(uuid, text) is
'Platform-admin-only fallback updater for a default Breed Library image URL.';

commit;
