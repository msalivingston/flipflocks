-- Fix ambiguous store_id references in the Step 2 seller onboarding bootstrap RPC.
--
-- The function returns a column named store_id, so PL/pgSQL can treat
-- unqualified SQL references to store_id as ambiguous. Keep behavior the same,
-- but qualify table references and avoid an unqualified ON CONFLICT target.

begin;

create or replace function public.seller_bootstrap_store_from_onboarding(
  p_profile jsonb
)
returns table (
  store_id uuid,
  store_name text,
  store_slug text,
  profile_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_store public.stores%rowtype;
  v_store public.stores%rowtype;
  v_store_name text;
  v_phone text;
  v_billing_address_line1 text;
  v_billing_city text;
  v_billing_state text;
  v_billing_postal_code text;
  v_billing_country text;
  v_public_city text;
  v_public_state text;
  v_about_text text;
  v_location_display_preference text;
  v_slug_base text;
  v_slug_candidate text;
  v_slug_suffix integer := 1;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Onboarding profile must be provided.';
  end if;

  v_store_name := nullif(trim(p_profile ->> 'store_name'), '');
  v_phone := nullif(trim(p_profile ->> 'phone'), '');
  v_billing_address_line1 := nullif(trim(p_profile ->> 'billing_address_line1'), '');
  v_billing_city := nullif(trim(p_profile ->> 'billing_city'), '');
  v_billing_state := upper(nullif(trim(p_profile ->> 'billing_state'), ''));
  v_billing_postal_code := nullif(trim(p_profile ->> 'billing_postal_code'), '');
  v_billing_country := upper(coalesce(nullif(trim(p_profile ->> 'billing_country'), ''), 'US'));
  v_public_city := nullif(trim(p_profile ->> 'public_city'), '');
  v_public_state := upper(nullif(trim(p_profile ->> 'public_state'), ''));
  v_about_text := nullif(trim(p_profile ->> 'about_text'), '');
  v_location_display_preference := coalesce(
    nullif(trim(p_profile ->> 'location_display_preference'), ''),
    'city_state'
  );

  if v_store_name is null then raise exception 'Farm or seller name is required.'; end if;
  if v_phone is null then raise exception 'Phone number is required.'; end if;
  if v_billing_address_line1 is null then raise exception 'Billing address is required.'; end if;
  if v_billing_city is null then raise exception 'City is required.'; end if;
  if v_billing_state is null then raise exception 'State is required.'; end if;
  if v_billing_postal_code is null then raise exception 'ZIP code is required.'; end if;

  if v_billing_country !~ '^[A-Z]{2}$' then
    raise exception 'Billing country is invalid.';
  end if;

  if v_location_display_preference not in ('full_address', 'city_state', 'manual') then
    raise exception 'Location display preference is invalid.';
  end if;

  if v_about_text is not null and length(v_about_text) > 250 then
    raise exception 'Farm description must be 250 characters or fewer.';
  end if;

  v_slug_base := lower(v_store_name);
  v_slug_base := regexp_replace(v_slug_base, '[^a-z0-9]+', '-', 'g');
  v_slug_base := regexp_replace(v_slug_base, '(^-+|-+$)', '', 'g');
  v_slug_base := left(v_slug_base, 48);
  v_slug_base := regexp_replace(v_slug_base, '-+$', '', 'g');

  if v_slug_base is null or v_slug_base = '' then
    v_slug_base := 'farm-store';
  end if;

  select s.*
  into v_existing_store
  from public.stores as s
  where s.owner_user_id = v_user_id
  order by s.created_at asc
  limit 1
  for update;

  if v_existing_store.id is not null
    and v_existing_store.store_status <> 'draft' then
    raise exception 'This account already has a store that is past onboarding.';
  end if;

  loop
    v_slug_candidate := case
      when v_slug_suffix = 1 then v_slug_base
      else v_slug_base || '-' || v_slug_suffix::text
    end;

    exit when not exists (
      select 1
      from public.stores as s
      where s.store_slug = v_slug_candidate
        and (
          v_existing_store.id is null
          or s.id <> v_existing_store.id
        )
    );

    v_slug_suffix := v_slug_suffix + 1;
  end loop;

  if v_existing_store.id is null then
    insert into public.stores (
      owner_user_id,
      store_name,
      store_slug,
      store_status,
      storefront_mode,
      storefront_enabled,
      hatching_eggs_enabled,
      equipment_supplies_enabled,
      processed_poultry_enabled,
      public_city,
      public_state,
      public_country,
      public_phone,
      show_public_phone,
      about_text,
      billing_address_line1,
      billing_city,
      billing_state,
      billing_postal_code,
      billing_country,
      location_display_preference
    )
    values (
      v_user_id,
      v_store_name,
      v_slug_candidate,
      'draft',
      'hosted',
      false,
      false,
      false,
      false,
      v_public_city,
      v_public_state,
      'US',
      v_phone,
      false,
      v_about_text,
      v_billing_address_line1,
      v_billing_city,
      v_billing_state,
      v_billing_postal_code,
      v_billing_country,
      v_location_display_preference
    )
    returning * into v_store;
  else
    update public.stores as s
    set
      store_name = v_store_name,
      store_slug = v_slug_candidate,
      storefront_enabled = false,
      storefront_mode = 'hosted',
      hatching_eggs_enabled = false,
      equipment_supplies_enabled = false,
      processed_poultry_enabled = false,
      public_city = v_public_city,
      public_state = v_public_state,
      public_country = 'US',
      public_phone = v_phone,
      show_public_phone = false,
      about_text = v_about_text,
      billing_address_line1 = v_billing_address_line1,
      billing_city = v_billing_city,
      billing_state = v_billing_state,
      billing_postal_code = v_billing_postal_code,
      billing_country = v_billing_country,
      location_display_preference = v_location_display_preference
    where s.id = v_existing_store.id
    returning s.* into v_store;
  end if;

  insert into public.user_roles (
    user_id,
    role,
    store_id
  )
  values (
    v_user_id,
    'seller',
    v_store.id
  )
  on conflict do nothing;

  update public.seller_onboarding_state as sos
  set
    profile_complete = true,
    billing_complete = false,
    terms_accepted = false,
    first_listing_created = false,
    ready_to_launch = false,
    updated_at = now()
  where sos.store_id = v_store.id;

  if not found then
    insert into public.seller_onboarding_state (
      store_id,
      profile_complete,
      billing_complete,
      terms_accepted,
      first_listing_created,
      ready_to_launch
    )
    values (
      v_store.id,
      true,
      false,
      false,
      false,
      false
    );
  end if;

  return query
  select
    v_store.id,
    v_store.store_name,
    v_store.store_slug,
    true,
    3;
end;
$$;

comment on function public.seller_bootstrap_store_from_onboarding(jsonb) is
'Trusted seller onboarding Step 2 bootstrap. Creates or updates the authenticated user draft store, creates seller role membership, and marks profile setup complete without creating billing or Stripe records.';

revoke all on function public.seller_bootstrap_store_from_onboarding(jsonb) from public;
grant execute on function public.seller_bootstrap_store_from_onboarding(jsonb) to authenticated;

commit;
