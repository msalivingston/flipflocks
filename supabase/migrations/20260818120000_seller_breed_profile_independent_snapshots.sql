-- Make platform-derived seller breed profiles independent snapshots.
--
-- Scope:
-- - Backfill only missing seller-owned values from the linked platform breed.
-- - Preserve seller-authored values and all identifiers/history.
-- - Make platform auto-add idempotent and conflict-safe without refreshing an
--   existing seller profile from the platform catalog.
-- - Remove ongoing platform metadata fallback from public and owner-preview
--   storefront inventory.

begin;

-- Snapshot the values that existing application reads currently borrow from
-- public.breeds. Blank descriptions count as missing because the Breed Catalog
-- UI historically treated them as missing and displayed the platform value.
update public.seller_breed_profiles as seller_profiles
set
  seller_description = case
    when nullif(btrim(seller_profiles.seller_description), '') is null
      and nullif(btrim(breeds.description), '') is not null
      then breeds.description
    else seller_profiles.seller_description
  end,
  bird_type = coalesce(seller_profiles.bird_type, breeds.bird_type),
  egg_color = coalesce(seller_profiles.egg_color, breeds.egg_color),
  annual_egg_production = coalesce(
    seller_profiles.annual_egg_production,
    breeds.annual_egg_production
  )
from public.breeds as breeds
where seller_profiles.breed_id is not null
  and breeds.id = seller_profiles.breed_id
  and (
    (
      nullif(btrim(seller_profiles.seller_description), '') is null
      and nullif(btrim(breeds.description), '') is not null
    )
    or (seller_profiles.bird_type is null and breeds.bird_type is not null)
    or (seller_profiles.egg_color is null and breeds.egg_color is not null)
    or (
      seller_profiles.annual_egg_production is null
      and breeds.annual_egg_production is not null
    )
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
    from public.species as species
    where species.id = p_species_id
      and species.is_active = true
  ) then
    raise exception 'Species is not available.';
  end if;

  v_custom_breed_name := nullif(trim(p_custom_breed_name), '');
  v_normalized_custom_breed_name :=
    public.normalize_seller_custom_breed_name(v_custom_breed_name);
  v_visibility_status :=
    coalesce(nullif(trim(p_visibility_status), ''), 'active');
  v_bird_type := nullif(trim(p_bird_type), '');
  v_egg_color := nullif(trim(p_egg_color), '');
  v_annual_egg_production :=
    nullif(trim(p_annual_egg_production), '');

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
    select breeds.*
    into v_breed
    from public.breeds as breeds
    where breeds.id = p_breed_id
      and breeds.is_active = true;

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
    select seller_profiles.*
    into v_profile
    from public.seller_breed_profiles as seller_profiles
    where seller_profiles.id = p_seller_breed_profile_id
      and seller_profiles.store_id = p_store_id
    for update;

    if v_profile.id is null then
      raise exception 'Seller breed profile is not available for this store.';
    end if;

    if exists (
      select 1
      from public.listing_batch_breeds as listing_breeds
      where listing_breeds.seller_breed_profile_id = v_profile.id
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

    update public.seller_breed_profiles as seller_profiles
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
      bird_type = coalesce(v_bird_type, seller_profiles.bird_type),
      egg_color = coalesce(v_egg_color, seller_profiles.egg_color),
      annual_egg_production = coalesce(
        v_annual_egg_production,
        seller_profiles.annual_egg_production
      )
    where seller_profiles.id = v_profile.id
    returning seller_profiles.* into v_profile;
  elsif p_breed_id is not null then
    -- Initial platform copies are complete snapshots from the authoritative
    -- catalog row. ON CONFLICT makes simultaneous first-time adds converge on
    -- the same seller profile instead of surfacing a uniqueness failure.
    insert into public.seller_breed_profiles as seller_profiles (
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
      v_breed.breed_name,
      nullif(trim(v_breed.description), ''),
      nullif(trim(p_seller_notes), ''),
      v_visibility_status,
      v_breed.bird_type,
      v_breed.egg_color,
      v_breed.annual_egg_production
    )
    on conflict do nothing
    returning seller_profiles.* into v_profile;

    if v_profile.id is null then
      select seller_profiles.*
      into v_profile
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
    -- Preserve the existing custom-breed upsert behavior. Custom breeds never
    -- acquire a platform breed source automatically.
    select seller_profiles.*
    into v_profile
    from public.seller_breed_profiles as seller_profiles
    where seller_profiles.store_id = p_store_id
      and seller_profiles.species_id = p_species_id
      and seller_profiles.normalized_custom_breed_name =
        v_normalized_custom_breed_name
    for update;

    if v_profile.id is not null then
      update public.seller_breed_profiles as seller_profiles
      set
        custom_breed_name = v_custom_breed_name,
        display_name = v_display_name,
        seller_description = nullif(trim(p_seller_description), ''),
        seller_notes = nullif(trim(p_seller_notes), ''),
        visibility_status = v_visibility_status,
        bird_type = coalesce(v_bird_type, seller_profiles.bird_type),
        egg_color = coalesce(v_egg_color, seller_profiles.egg_color),
        annual_egg_production = coalesce(
          v_annual_egg_production,
          seller_profiles.annual_egg_production
        )
      where seller_profiles.id = v_profile.id
      returning seller_profiles.* into v_profile;
    else
      insert into public.seller_breed_profiles as seller_profiles (
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
      returning seller_profiles.* into v_profile;
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
'Seller/admin RPC for editing seller-owned breed profiles or resolving an independent platform-breed snapshot. First-time platform adds copy all supported catalog facts, existing copies are never refreshed implicitly, archived copies reactivate without losing customization, and concurrent adds converge on one profile.';

-- Public inventory facts now come exclusively from the seller-owned profile.
-- The platform breed relationship remains available on seller_breed_profiles,
-- but it is no longer an implicit public metadata source.
create or replace view public.public_storefront_inventory
with (security_barrier = true)
as
select
  public_storefront_breed_inventory.store_id,
  public_storefront_breed_inventory.store_slug,
  public_storefront_breed_inventory.species_id,
  public_storefront_breed_inventory.species_name,
  public_storefront_breed_inventory.species_slug,
  public_storefront_breed_inventory.seller_breed_profile_id,
  public_storefront_breed_inventory.breed_display_name,
  public_storefront_breed_inventory.breed_description,
  public_storefront_breed_inventory.listing_batch_id,
  public_storefront_breed_inventory.listing_batch_breed_id,
  public_storefront_breed_inventory.inventory_item_id,
  public_storefront_breed_inventory.inventory_type,
  public_storefront_breed_inventory.custom_inventory_label,
  public_storefront_breed_inventory.quantity_available,
  case
    when public_storefront_breed_inventory.quantity_available <= 0
      or public_storefront_breed_inventory.availability_status = 'sold_out'
      then 'sold_out'
    when public_storefront_breed_inventory.available_date > current_date
      then 'reserve_now'
    else 'ready_now'
  end as buyer_availability_code,
  case
    when public_storefront_breed_inventory.quantity_available <= 0
      or public_storefront_breed_inventory.availability_status = 'sold_out'
      then 'Sold out'
    when public_storefront_breed_inventory.available_date > current_date
      then 'Reserve now'
    else 'Ready now'
  end as buyer_availability_label,
  public_storefront_breed_inventory.available_date,
  public_storefront_breed_inventory.is_available_now,
  (
    public_storefront_breed_inventory.quantity_available > 0
    and public_storefront_breed_inventory.availability_status <> 'sold_out'
  ) as can_checkout,
  public_storefront_breed_inventory.unit_price,
  public_storefront_breed_inventory.featured_image_url,
  public_storefront_breed_inventory.featured_image_alt_text,
  public_storefront_breed_inventory.breed_sort_order,
  public_storefront_breed_inventory.inventory_sort_order,
  public_storefront_breed_inventory.batch_type,
  public_storefront_breed_inventory.age_at_availability_days,
  listing_batches.origin_date,
  seller_breed_profiles.bird_type as breed_bird_type,
  seller_breed_profiles.egg_color as breed_egg_color,
  seller_breed_profiles.annual_egg_production
    as breed_annual_egg_production
from public.public_storefront_breed_inventory
join public.stores
  on stores.id = public_storefront_breed_inventory.store_id
join public.listing_batches
  on listing_batches.id = public_storefront_breed_inventory.listing_batch_id
left join public.seller_breed_profiles
  on seller_breed_profiles.id =
    public_storefront_breed_inventory.seller_breed_profile_id
where (
    coalesce(public_storefront_breed_inventory.batch_type, '') <>
      'hatching_eggs'
    and coalesce(public_storefront_breed_inventory.inventory_type, '') <>
      'hatching_eggs'
  )
  or (
    stores.hatching_eggs_enabled = true
    and public.get_store_plan_key(stores.id) = 'full_flock'
  );

comment on view public.public_storefront_inventory is
'Buyer-facing storefront inventory projection. Breed names, descriptions, and supported breed facts come only from the independent seller breed profile; the linked platform breed is not an implicit fallback.';

-- The hidden-store owner preview is a security-definer function rather than a
-- view. Patch only its three known metadata expressions while preserving its
-- authorization, public-safe column set, media precedence, and module gates.
do $preview_patch$
declare
  v_function regprocedure :=
    'public.get_seller_storefront_preview_data(text)'::regprocedure;
  v_definition text;
  v_patched text;
begin
  v_definition := pg_get_functiondef(v_function);
  v_patched := replace(
    v_definition,
    'coalesce(seller_breed_profiles.bird_type, breeds.bird_type)',
    'seller_breed_profiles.bird_type'
  );
  v_patched := replace(
    v_patched,
    'coalesce(seller_breed_profiles.egg_color, breeds.egg_color)',
    'seller_breed_profiles.egg_color'
  );
  v_patched := replace(
    v_patched,
    'coalesce(
        seller_breed_profiles.annual_egg_production,
        breeds.annual_egg_production
      )',
    'seller_breed_profiles.annual_egg_production'
  );

  if v_patched = v_definition
    or position(
      'coalesce(seller_breed_profiles.bird_type, breeds.bird_type)'
      in v_patched
    ) > 0
    or position(
      'coalesce(seller_breed_profiles.egg_color, breeds.egg_color)'
      in v_patched
    ) > 0
    or position(
      'seller_breed_profiles.annual_egg_production' in v_patched
    ) = 0 then
    raise exception
      'Could not safely update seller storefront preview breed metadata.';
  end if;

  execute v_patched;
end;
$preview_patch$;

comment on function public.get_seller_storefront_preview_data(text) is
'Returns buyer-safe hidden-store preview data to the owning seller or platform admin. Breed metadata comes only from the independent seller breed profile; private notes and platform fallback values are not exposed.';

commit;
