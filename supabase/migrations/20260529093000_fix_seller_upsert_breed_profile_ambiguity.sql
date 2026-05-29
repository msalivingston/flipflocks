-- Group 64B: Fix ambiguous column references in seller_upsert_breed_profile.
--
-- The previous function used ON CONFLICT (store_id, species_id, breed_id)
-- inside a RETURNS TABLE PL/pgSQL function. Those returned column names are
-- also PL/pgSQL variables, so Postgres could raise 42702 when inferring the
-- conflict target. This replacement keeps the same API and behavior while
-- using explicit qualified lookups before update/insert.

create or replace function public.seller_upsert_breed_profile(
  p_store_id uuid,
  p_species_id uuid,
  p_breed_id uuid default null,
  p_custom_breed_name text default null,
  p_display_name text default null,
  p_seller_description text default null,
  p_seller_notes text default null,
  p_visibility_status text default 'active',
  p_seller_breed_profile_id uuid default null
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
  updated_at timestamptz
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

  if v_visibility_status not in ('active', 'hidden', 'archived') then
    raise exception 'Breed profile visibility status is not supported.';
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
      visibility_status = v_visibility_status
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
        visibility_status = v_visibility_status
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
        visibility_status
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
        v_visibility_status
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
        visibility_status = v_visibility_status
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
        visibility_status
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
        v_visibility_status
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
    v_profile.updated_at;
end;
$$;

comment on function public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid
) is
'Seller/admin RPC for creating or updating seller-owned breed profiles. Validates species/breed consistency, never accepts moderation fields, and avoids ambiguous PL/pgSQL output-column references in upsert logic.';
