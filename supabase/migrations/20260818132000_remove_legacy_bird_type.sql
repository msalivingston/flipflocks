-- Remove the legacy breed bird_type field and make seller Breed Category the
-- source for the existing buyer-facing storefront Purpose value.

begin;

-- Preserve the current view object, dependencies, ACL, owner, and column order.
-- Rename the existing output column in place, then replace only its source
-- expression in the current definition. This intentionally does not copy a
-- historical view definition into this migration.
alter view public.public_storefront_inventory
  rename column breed_bird_type to breed_category;

do $$
declare
  v_definition text;
begin
  v_definition := pg_get_viewdef(
    'public.public_storefront_inventory'::regclass,
    true
  );

  if position('seller_breed_profiles.bird_type' in v_definition) = 0 then
    raise exception 'Current public_storefront_inventory definition no longer has the expected seller bird_type source.';
  end if;

  if position('store_has_public_market_entitlement' in v_definition) = 0 then
    raise exception 'Current public_storefront_inventory entitlement predicate is not the expected production-safe predicate.';
  end if;

  v_definition := replace(
    v_definition,
    'seller_breed_profiles.bird_type',
    'seller_breed_profiles.breed_category'
  );

  execute 'create or replace view public.public_storefront_inventory '
    || 'with (security_barrier=true) as '
    || v_definition;
end;
$$;

-- The seller preview function has its own seller-profile projection. Update
-- only that projection in the current function definition so it emits the same
-- breed_category contract as the public inventory view.
do $$
declare
  v_definition text;
begin
  v_definition := pg_get_functiondef(
    'public.get_seller_storefront_preview_data(text)'::regprocedure
  );

  if position('seller_breed_profiles.bird_type' in v_definition) = 0
    or position('breed_bird_type' in v_definition) = 0 then
    raise exception 'Current seller storefront preview function no longer has the expected bird_type projection.';
  end if;

  v_definition := replace(
    v_definition,
    'seller_breed_profiles.bird_type',
    'seller_breed_profiles.breed_category'
  );
  v_definition := replace(v_definition, 'breed_bird_type', 'breed_category');

  execute v_definition;
end;
$$;

drop function if exists public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, text,
  text, text, boolean
);

drop function if exists public.admin_update_catalog_breed_image_url(uuid, text);
drop function if exists public.admin_update_catalog_breed_details(
  uuid, text, text, text, text, text, text, text, text, text
);
drop function if exists public.admin_catalog_breed_detail(uuid);
drop function if exists public.admin_catalog_breed_list();

alter table public.breeds
  drop constraint if exists breeds_bird_type_check,
  drop column bird_type;

alter table public.seller_breed_profiles
  drop constraint if exists seller_breed_profiles_bird_type_check,
  drop column bird_type;

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

  if p_breed_id is null and v_breed_category is not null
    and v_breed_category not in (
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

  if (p_breed_id is null and v_custom_breed_name is null)
    or (p_breed_id is not null and v_custom_breed_name is not null) then
    raise exception 'Provide exactly one breed source: platform breed or custom breed name.';
  end if;

  if p_breed_id is not null then
    select breeds.* into v_breed
    from public.breeds
    where breeds.id = p_breed_id and breeds.is_active = true;
    if v_breed.id is null then raise exception 'Breed is not available.'; end if;
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
    case when v_custom_breed_name is not null and v_variety is not null
      then v_custom_breed_name || ' - ' || v_variety
      else v_custom_breed_name end,
    case when v_breed.variety is not null
      then v_breed.breed_name || ' - ' || v_breed.variety
      else v_breed.breed_name end
  );
  if v_display_name is null then raise exception 'Display name is required.'; end if;

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

    update public.seller_breed_profiles as seller_profiles set
      species_id = p_species_id,
      breed_id = p_breed_id,
      custom_breed_name = v_custom_breed_name,
      normalized_custom_breed_name = case
        when p_breed_id is null then v_normalized_custom_breed_name else null end,
      display_name = v_display_name,
      variety = case when p_update_identity then v_variety else seller_profiles.variety end,
      breed_category = case
        when p_update_identity then v_breed_category else seller_profiles.breed_category end,
      seller_description = nullif(btrim(p_seller_description), ''),
      seller_notes = nullif(btrim(p_seller_notes), ''),
      visibility_status = v_visibility_status,
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
      seller_description, seller_notes, visibility_status,
      egg_color, annual_egg_production
    ) values (
      p_store_id, p_species_id, p_breed_id, null, null,
      case when v_breed.variety is not null
        then v_breed.breed_name || ' - ' || v_breed.variety
        else v_breed.breed_name end,
      v_breed.variety,
      case when v_species_slug = 'chicken' then v_breed.category else null end,
      nullif(btrim(v_breed.description), ''), nullif(btrim(p_seller_notes), ''),
      v_visibility_status, v_breed.egg_color, v_breed.annual_egg_production
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
      update public.seller_breed_profiles as seller_profiles set
        custom_breed_name = v_custom_breed_name,
        display_name = v_display_name,
        variety = v_variety,
        breed_category = v_breed_category,
        seller_description = nullif(btrim(p_seller_description), ''),
        seller_notes = nullif(btrim(p_seller_notes), ''),
        visibility_status = v_visibility_status,
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
        seller_description, seller_notes, visibility_status,
        egg_color, annual_egg_production
      ) values (
        p_store_id, p_species_id, null, v_custom_breed_name,
        v_normalized_custom_breed_name, v_display_name, v_variety,
        v_breed_category, nullif(btrim(p_seller_description), ''),
        nullif(btrim(p_seller_notes), ''), v_visibility_status,
        v_egg_color, v_annual_egg_production
      ) returning seller_profiles.* into v_profile;
    end if;
  end if;

  return query select
    v_profile.id, v_profile.store_id, v_profile.species_id,
    v_profile.breed_id, v_profile.custom_breed_name,
    v_profile.normalized_custom_breed_name, v_profile.display_name,
    v_profile.seller_description, v_profile.seller_notes,
    v_profile.visibility_status, v_profile.created_at, v_profile.updated_at,
    v_profile.egg_color, v_profile.annual_egg_production,
    v_profile.variety, v_profile.breed_category;
end;
$$;

revoke all on function public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, text,
  text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, text,
  text, boolean
) to authenticated, service_role;

comment on function public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, text,
  text, boolean
) is
'Creates seller-owned Breed, Variety, Breed Category, and metadata snapshots without the removed legacy bird_type field; existing platform copies are returned or reactivated without implicit refresh.';

create function public.admin_catalog_breed_list()
returns table (
  breed_id uuid, species_id uuid, species_name text, species_slug text,
  breed_name text, variety text, breed_slug text, image_url text,
  has_image boolean, category text, egg_color text,
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
    breeds.category, breeds.egg_color, breeds.annual_egg_production,
    breeds.temperament, breeds.image_prompt, breeds.is_active,
    breeds.sort_order, breeds.updated_at
  from public.breeds
  join public.species on species.id = breeds.species_id
  order by species.common_name, breeds.breed_name, breeds.variety nulls first;
end;
$$;

create function public.admin_catalog_breed_detail(p_breed_id uuid)
returns table (
  breed_id uuid, species_id uuid, species_name text, species_slug text,
  breed_name text, variety text, breed_slug text, description text,
  image_url text, has_image boolean, category text, egg_color text,
  annual_egg_production text, temperament text, image_prompt text,
  is_active boolean, sort_order integer, updated_at timestamptz
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
    breeds.category, breeds.egg_color, breeds.annual_egg_production,
    breeds.temperament, breeds.image_prompt, breeds.is_active,
    breeds.sort_order, breeds.updated_at
  from public.breeds
  join public.species on species.id = breeds.species_id
  where breeds.id = p_breed_id;
end;
$$;

create function public.admin_update_catalog_breed_details(
  p_breed_id uuid,
  p_description text default null,
  p_category text default null,
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
  image_url text, has_image boolean, category text, egg_color text,
  annual_egg_production text, temperament text, image_prompt text,
  is_active boolean, sort_order integer, updated_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_breed_name text := nullif(btrim(p_breed_name), '');
  v_variety text := nullif(btrim(p_variety), '');
  v_category text := nullif(btrim(p_category), '');
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
  if v_annual_egg_production is not null and v_annual_egg_production not in (
    'under_150', '150_200', '200_250', '250_300', 'over_300'
  ) then raise exception 'Invalid annual egg production.'; end if;

  update public.breeds set
    breed_name = v_breed_name,
    variety = v_variety,
    description = nullif(btrim(p_description), ''),
    category = v_category,
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
  image_url text, has_image boolean, category text, egg_color text,
  annual_egg_production text, temperament text, image_prompt text,
  is_active boolean, sort_order integer, updated_at timestamptz
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

revoke all on function public.admin_catalog_breed_list()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_catalog_breed_detail(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_catalog_breed_details(
  uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_catalog_breed_image_url(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_catalog_breed_list()
  to authenticated, service_role;
grant execute on function public.admin_catalog_breed_detail(uuid)
  to authenticated, service_role;
grant execute on function public.admin_update_catalog_breed_details(
  uuid, text, text, text, text, text, text, text, text
) to authenticated, service_role;
grant execute on function public.admin_update_catalog_breed_image_url(uuid, text)
  to authenticated, service_role;

comment on function public.admin_catalog_breed_list() is
'Platform-admin-only Breed Library projection with Base Breed, Variety, Breed Category, and canonical chicken metadata.';
comment on function public.admin_catalog_breed_detail(uuid) is
'Platform-admin-only detail projection for one default Breed Library record without legacy bird_type.';
comment on function public.admin_update_catalog_breed_details(
  uuid, text, text, text, text, text, text, text, text
) is
'Platform-admin-only updater for Base Breed, Variety, Breed Category, and existing catalog metadata. Stable IDs and slugs are unchanged.';
comment on function public.admin_update_catalog_breed_image_url(uuid, text) is
'Platform-admin-only fallback updater for a default Breed Library image URL.';

commit;
