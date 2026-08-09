-- Split the existing farm bootstrap into minimal Farm Basics, a later
-- storefront-details step, and a combined pickup-address/policy step without
-- changing any SaaS Checkout, webhook, entitlement, or billing authority.

begin;

alter table public.seller_onboarding_state
  add column if not exists storefront_details_complete boolean not null default false;

-- Before this migration, profile_complete could only be reached by supplying
-- the hero copy, farm description, and location preference. Those rows have
-- therefore already completed the new Storefront Details step.
update public.seller_onboarding_state
set storefront_details_complete = true
where profile_complete = true
  and storefront_details_complete = false;

comment on column public.seller_onboarding_state.storefront_details_complete is
'True after the seller has explicitly saved the editable storefront hero copy, farm description, and public-location preference. Historical completed profiles were backfilled because those fields were required by the former combined Farm Information step.';

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
set search_path = pg_catalog, public
as $function$
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
  v_legacy_tagline text;
  v_legacy_subline text;
  v_legacy_description text;
  v_legacy_location_preference text;
  v_legacy_pickup_address_line1 text;
  v_legacy_pickup_address_line2 text;
  v_legacy_pickup_city text;
  v_legacy_pickup_state text;
  v_legacy_pickup_postal_code text;
  v_legacy_pickup_country text;
  v_legacy_combined_profile boolean := false;
  v_slug_base text;
  v_slug_candidate text;
  v_slug_suffix integer := 1;
  v_starter_tagline constant text := 'Local poultry, raised with care.';
  v_starter_subline constant text :=
    'Quality birds and farm goods for backyard flock owners, homesteaders, and small farms.';
  v_starter_description constant text := $description$We’re a local farm offering poultry and farm goods for backyard flock owners, homesteaders, and small farms.

For many people, raising poultry is about more than eggs or meat. It’s about knowing where your food comes from, building a flock that fits your home, teaching kids responsibility, adding beauty and life to the yard, and enjoying the daily rhythm of caring for animals.

Our birds and products change with the season, the hatch, and the natural pace of farm life. Depending on what’s available, you may find chicks, started birds, laying hens, hatching eggs, eating eggs, poultry products, supplies, equipment, or other farm goods listed here.

Buying from a small poultry farm keeps things local, supports the people doing the daily work, and gives you a closer connection to where your birds and farm products are coming from.

Check our current listings to see what’s ready now. Thank you for supporting small farms, local food, and backyard flocks.$description$;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Farm basics must be provided.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_profile) as supplied(key)
    where supplied.key not in (
      'store_name', 'phone', 'billing_address_line1', 'billing_city',
      'billing_state', 'billing_postal_code', 'billing_country',
      -- Rolling-deploy compatibility for the former combined Step 2. The new
      -- client sends none of these fields.
      'public_city', 'public_state', 'store_tagline', 'hero_subheading',
      'about_text', 'location_display_preference',
      'pickup_address_line1', 'pickup_address_line2', 'pickup_city',
      'pickup_state', 'pickup_postal_code', 'pickup_country'
    )
  ) then
    raise exception 'Only Farm Basics fields may be saved in this step.';
  end if;

  v_store_name := nullif(trim(p_profile ->> 'store_name'), '');
  v_phone := nullif(trim(p_profile ->> 'phone'), '');
  v_billing_address_line1 := nullif(trim(p_profile ->> 'billing_address_line1'), '');
  v_billing_city := nullif(trim(p_profile ->> 'billing_city'), '');
  v_billing_state := upper(nullif(trim(p_profile ->> 'billing_state'), ''));
  v_billing_postal_code := nullif(trim(p_profile ->> 'billing_postal_code'), '');
  v_billing_country := upper(coalesce(
    nullif(trim(p_profile ->> 'billing_country'), ''),
    'US'
  ));
  v_legacy_combined_profile := p_profile ? 'store_tagline'
    or p_profile ? 'hero_subheading'
    or p_profile ? 'about_text'
    or p_profile ? 'location_display_preference'
    or p_profile ? 'pickup_address_line1';
  v_legacy_tagline := nullif(trim(p_profile ->> 'store_tagline'), '');
  v_legacy_subline := nullif(trim(p_profile ->> 'hero_subheading'), '');
  v_legacy_description := nullif(trim(p_profile ->> 'about_text'), '');
  v_legacy_location_preference := nullif(
    trim(p_profile ->> 'location_display_preference'),
    ''
  );
  v_legacy_pickup_address_line1 := nullif(
    trim(p_profile ->> 'pickup_address_line1'),
    ''
  );
  v_legacy_pickup_address_line2 := nullif(
    trim(p_profile ->> 'pickup_address_line2'),
    ''
  );
  v_legacy_pickup_city := nullif(trim(p_profile ->> 'pickup_city'), '');
  v_legacy_pickup_state := upper(nullif(trim(p_profile ->> 'pickup_state'), ''));
  v_legacy_pickup_postal_code := nullif(
    trim(p_profile ->> 'pickup_postal_code'),
    ''
  );
  v_legacy_pickup_country := upper(coalesce(
    nullif(trim(p_profile ->> 'pickup_country'), ''),
    'US'
  ));

  if v_store_name is null then raise exception 'Farm or seller name is required.'; end if;
  if v_phone is null then raise exception 'Phone number is required.'; end if;
  if v_billing_address_line1 is null then raise exception 'Billing address is required.'; end if;
  if v_billing_city is null then raise exception 'City is required.'; end if;
  if v_billing_state is null then raise exception 'State is required.'; end if;
  if v_billing_postal_code is null then raise exception 'ZIP code is required.'; end if;
  if v_billing_country !~ '^[A-Z]{2}$' then
    raise exception 'Billing country is invalid.';
  end if;
  if v_legacy_combined_profile then
    if v_legacy_tagline is null then raise exception 'Hero tagline is required.'; end if;
    if char_length(v_legacy_tagline) > 45 then raise exception 'Hero tagline must be 45 characters or fewer.'; end if;
    if v_legacy_subline is null then raise exception 'Hero subline is required.'; end if;
    if char_length(v_legacy_subline) > 90 then raise exception 'Hero subline must be 90 characters or fewer.'; end if;
    if v_legacy_description is null then raise exception 'Farm description is required.'; end if;
    if array_length(regexp_split_to_array(trim(v_legacy_description), '\s+'), 1) > 250 then
      raise exception 'Farm description must be 250 words or fewer.';
    end if;
    if v_legacy_location_preference not in ('full_address', 'city_state', 'manual') then
      raise exception 'Location display preference is invalid.';
    end if;
    if v_legacy_pickup_address_line1 is null
      or v_legacy_pickup_city is null
      or v_legacy_pickup_state is null
      or v_legacy_pickup_postal_code is null then
      raise exception 'Pickup address is required.';
    end if;
    if v_legacy_pickup_country !~ '^[A-Z]{2}$' then
      raise exception 'Pickup country is invalid.';
    end if;
  end if;

  v_slug_base := lower(v_store_name);
  v_slug_base := regexp_replace(v_slug_base, '[^a-z0-9]+', '-', 'g');
  v_slug_base := regexp_replace(v_slug_base, '(^-+|-+$)', '', 'g');
  v_slug_base := left(v_slug_base, 48);
  v_slug_base := regexp_replace(v_slug_base, '-+$', '', 'g');
  if v_slug_base is null or v_slug_base = '' then
    v_slug_base := 'farm-store';
  end if;

  select stores.*
  into v_existing_store
  from public.stores
  where stores.owner_user_id = v_user_id
  order by stores.created_at, stores.id
  limit 1
  for update;

  if v_existing_store.id is not null and (
    v_existing_store.store_status <> 'draft'
    or exists (
      select 1
      from public.seller_onboarding_state as onboarding
      where onboarding.store_id = v_existing_store.id
        and onboarding.onboarding_complete
    )
  ) then
    raise exception 'This account already has a store that is past onboarding.';
  end if;

  loop
    v_slug_candidate := case
      when v_slug_suffix = 1 then v_slug_base
      else v_slug_base || '-' || v_slug_suffix::text
    end;
    exit when not exists (
      select 1
      from public.stores
      where stores.store_slug = v_slug_candidate
        and (v_existing_store.id is null or stores.id <> v_existing_store.id)
    );
    v_slug_suffix := v_slug_suffix + 1;
  end loop;

  if v_existing_store.id is null then
    insert into public.stores (
      owner_user_id, store_name, store_slug, store_status, storefront_mode,
      storefront_enabled, hatching_eggs_enabled, equipment_supplies_enabled,
      processed_poultry_enabled, public_city, public_state, public_country,
      public_phone, show_public_phone, store_tagline, hero_subheading,
      about_text, billing_address_line1, billing_city, billing_state,
      billing_postal_code, billing_country, location_display_preference,
      pickup_address_line1, pickup_address_line2, pickup_city, pickup_state,
      pickup_postal_code, pickup_country
    ) values (
      v_user_id, v_store_name, v_slug_candidate, 'draft', 'hosted',
      false, false, false, false, v_billing_city, v_billing_state, 'US',
      v_phone, false, coalesce(v_legacy_tagline, v_starter_tagline),
      coalesce(v_legacy_subline, v_starter_subline),
      coalesce(v_legacy_description, v_starter_description),
      v_billing_address_line1, v_billing_city, v_billing_state,
      v_billing_postal_code, v_billing_country,
      coalesce(v_legacy_location_preference, 'city_state'),
      v_legacy_pickup_address_line1, v_legacy_pickup_address_line2,
      v_legacy_pickup_city, v_legacy_pickup_state,
      v_legacy_pickup_postal_code,
      case when v_legacy_combined_profile
        then v_legacy_pickup_country else null end
    )
    returning * into v_store;
  else
    update public.stores as stores
    set store_name = v_store_name,
        store_slug = v_slug_candidate,
        public_city = v_billing_city,
        public_state = v_billing_state,
        public_country = coalesce(stores.public_country, 'US'),
        public_phone = v_phone,
        billing_address_line1 = v_billing_address_line1,
        billing_city = v_billing_city,
        billing_state = v_billing_state,
        billing_postal_code = v_billing_postal_code,
        billing_country = v_billing_country,
        store_tagline = case when v_legacy_combined_profile
          then v_legacy_tagline else stores.store_tagline end,
        hero_subheading = case when v_legacy_combined_profile
          then v_legacy_subline else stores.hero_subheading end,
        about_text = case when v_legacy_combined_profile
          then v_legacy_description else stores.about_text end,
        location_display_preference = case when v_legacy_combined_profile
          then v_legacy_location_preference
          else stores.location_display_preference end,
        pickup_address_line1 = case when v_legacy_combined_profile
          then v_legacy_pickup_address_line1
          else stores.pickup_address_line1 end,
        pickup_address_line2 = case when v_legacy_combined_profile
          then v_legacy_pickup_address_line2
          else stores.pickup_address_line2 end,
        pickup_city = case when v_legacy_combined_profile
          then v_legacy_pickup_city else stores.pickup_city end,
        pickup_state = case when v_legacy_combined_profile
          then v_legacy_pickup_state else stores.pickup_state end,
        pickup_postal_code = case when v_legacy_combined_profile
          then v_legacy_pickup_postal_code
          else stores.pickup_postal_code end,
        pickup_country = case when v_legacy_combined_profile
          then v_legacy_pickup_country else stores.pickup_country end,
        updated_at = statement_timestamp()
    where stores.id = v_existing_store.id
    returning stores.* into v_store;
  end if;

  insert into public.user_roles (user_id, role, store_id)
  values (v_user_id, 'seller', v_store.id)
  on conflict do nothing;

  insert into public.seller_onboarding_state (
    store_id, profile_complete, storefront_details_complete,
    billing_complete, categories_complete, pickup_complete,
    terms_accepted, first_listing_created, ready_to_launch
  ) values (
    v_store.id, true, v_legacy_combined_profile,
    false, false, false, false, false, false
  )
  on conflict on constraint seller_onboarding_state_store_id_key do update
  set profile_complete = true,
      storefront_details_complete = (
        seller_onboarding_state.storefront_details_complete
        or v_legacy_combined_profile
      ),
      updated_at = statement_timestamp();

  return query
  select v_store.id, v_store.store_name, v_store.store_slug, true, 3;
end;
$function$;

comment on function public.seller_bootstrap_store_from_onboarding(jsonb) is
'Owner-only Farm Basics bootstrap. It creates or updates the private draft store, seller role, onboarding row, and private billing address; new clients receive real starter storefront copy while pickup remains unset. The former combined payload is accepted temporarily for rolling-deploy compatibility.';

revoke all on function public.seller_bootstrap_store_from_onboarding(jsonb)
  from public, anon, service_role;
grant execute on function public.seller_bootstrap_store_from_onboarding(jsonb)
  to authenticated;

create or replace function public.seller_save_onboarding_storefront_details(
  p_details jsonb
)
returns table (
  store_id uuid,
  storefront_details_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_tagline text;
  v_subline text;
  v_description text;
  v_location_preference text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Storefront details must be provided.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_details) as supplied(key)
    where supplied.key not in (
      'store_tagline', 'hero_subheading', 'about_text',
      'location_display_preference'
    )
  ) then
    raise exception 'Unsupported storefront-details field.';
  end if;

  v_tagline := nullif(trim(p_details ->> 'store_tagline'), '');
  v_subline := nullif(trim(p_details ->> 'hero_subheading'), '');
  v_description := nullif(trim(p_details ->> 'about_text'), '');
  v_location_preference := nullif(
    trim(p_details ->> 'location_display_preference'),
    ''
  );

  if v_tagline is null then raise exception 'Hero tagline is required.'; end if;
  if char_length(v_tagline) > 45 then
    raise exception 'Hero tagline must be 45 characters or fewer.';
  end if;
  if v_subline is null then raise exception 'Hero subline is required.'; end if;
  if char_length(v_subline) > 90 then
    raise exception 'Hero subline must be 90 characters or fewer.';
  end if;
  if v_description is null then raise exception 'Farm description is required.'; end if;
  if array_length(regexp_split_to_array(trim(v_description), '\s+'), 1) > 250 then
    raise exception 'Farm description must be 250 words or fewer.';
  end if;
  if v_location_preference not in ('full_address', 'city_state', 'manual') then
    raise exception 'Location display preference is invalid.';
  end if;

  select stores.*
  into v_store
  from public.stores
  where stores.owner_user_id = v_user_id
  order by stores.created_at, stores.id
  limit 1
  for update;

  if v_store.id is null or v_store.store_status <> 'draft' then
    raise exception 'Complete Farm Basics before saving storefront details.';
  end if;
  if not exists (
    select 1
    from public.seller_onboarding_state as onboarding
    where onboarding.store_id = v_store.id
      and onboarding.profile_complete
      and onboarding.billing_complete
      and not onboarding.onboarding_complete
  ) then
    raise exception 'Complete plan and payment before saving storefront details.';
  end if;

  update public.stores
  set store_tagline = v_tagline,
      hero_subheading = v_subline,
      about_text = v_description,
      location_display_preference = v_location_preference,
      updated_at = statement_timestamp()
  where stores.id = v_store.id;

  update public.seller_onboarding_state as onboarding
  set storefront_details_complete = true,
      updated_at = statement_timestamp()
  where onboarding.store_id = v_store.id;

  return query select v_store.id, true, 5;
end;
$function$;

comment on function public.seller_save_onboarding_storefront_details(jsonb) is
'Owner-only onboarding Step 4 save for hero copy, farm description, and location-display preference. It preserves billing, ownership, slug, modules, pickup data, and unrelated store configuration.';

revoke all on function public.seller_save_onboarding_storefront_details(jsonb)
  from public, anon, service_role;
grant execute on function public.seller_save_onboarding_storefront_details(jsonb)
  to authenticated;

create or replace function public.seller_save_onboarding_pickup(
  p_pickup jsonb
)
returns table (
  store_id uuid,
  pickup_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_address_line1 text;
  v_address_line2 text;
  v_city text;
  v_state text;
  v_postal_code text;
  v_country text;
  v_pickup_policy text;
  v_email_enabled boolean;
  v_text_enabled boolean;
  v_phone_enabled boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_pickup is null or jsonb_typeof(p_pickup) <> 'object' then
    raise exception 'Pickup details must be provided.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_pickup) as supplied(key)
    where supplied.key not in (
      'pickup_address_line1', 'pickup_address_line2', 'pickup_city',
      'pickup_state', 'pickup_postal_code', 'pickup_country',
      'pickup_policy', 'email_enabled', 'text_enabled', 'phone_enabled'
    )
  ) then
    raise exception 'Unsupported pickup-details field.';
  end if;

  v_address_line1 := nullif(trim(p_pickup ->> 'pickup_address_line1'), '');
  v_address_line2 := nullif(trim(p_pickup ->> 'pickup_address_line2'), '');
  v_city := nullif(trim(p_pickup ->> 'pickup_city'), '');
  v_state := upper(nullif(trim(p_pickup ->> 'pickup_state'), ''));
  v_postal_code := nullif(trim(p_pickup ->> 'pickup_postal_code'), '');
  v_country := upper(coalesce(
    nullif(trim(p_pickup ->> 'pickup_country'), ''),
    'US'
  ));
  v_pickup_policy := nullif(trim(p_pickup ->> 'pickup_policy'), '');
  v_email_enabled := coalesce((p_pickup ->> 'email_enabled')::boolean, false);
  v_text_enabled := coalesce((p_pickup ->> 'text_enabled')::boolean, false);
  v_phone_enabled := coalesce((p_pickup ->> 'phone_enabled')::boolean, false);

  if v_address_line1 is null then raise exception 'Pickup address is required.'; end if;
  if v_city is null then raise exception 'Pickup city is required.'; end if;
  if v_state is null then raise exception 'Pickup state is required.'; end if;
  if v_postal_code is null then raise exception 'Pickup ZIP code is required.'; end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'Pickup country is invalid.'; end if;
  if v_pickup_policy is null then raise exception 'Pickup policy is required.'; end if;
  if not (v_email_enabled or v_text_enabled or v_phone_enabled) then
    raise exception 'Choose at least one buyer contact method.';
  end if;

  select stores.*
  into v_store
  from public.stores
  left join public.user_roles
    on user_roles.store_id = stores.id
   and user_roles.user_id = v_user_id
   and user_roles.role in ('seller', 'staff')
  where stores.owner_user_id = v_user_id
     or user_roles.store_id = stores.id
  order by stores.created_at, stores.id
  limit 1
  for update of stores;

  if v_store.id is null then
    raise exception 'Complete Farm Basics before saving pickup details.';
  end if;
  if not exists (
    select 1
    from public.seller_onboarding_state as onboarding
    where onboarding.store_id = v_store.id
      and onboarding.profile_complete
      and onboarding.billing_complete
      and onboarding.storefront_details_complete
      and onboarding.categories_complete
      and not onboarding.onboarding_complete
  ) then
    raise exception 'Complete the earlier onboarding steps before saving pickup details.';
  end if;

  update public.stores
  set pickup_address_line1 = v_address_line1,
      pickup_address_line2 = v_address_line2,
      pickup_city = v_city,
      pickup_state = v_state,
      pickup_postal_code = v_postal_code,
      pickup_country = v_country,
      pickup_policy = v_pickup_policy,
      buyer_contact_email_enabled = v_email_enabled,
      buyer_contact_text_enabled = v_text_enabled,
      buyer_contact_phone_enabled = v_phone_enabled,
      show_public_phone = (v_text_enabled or v_phone_enabled),
      updated_at = statement_timestamp()
  where stores.id = v_store.id;

  update public.seller_onboarding_state as onboarding
  set pickup_complete = true,
      updated_at = statement_timestamp()
  where onboarding.store_id = v_store.id;

  return query select v_store.id, true, 7;
end;
$function$;

comment on function public.seller_save_onboarding_pickup(jsonb) is
'Owner/staff onboarding Step 6 save for the private pickup address, buyer-facing pickup policy, and contact preferences. Billing and pickup addresses remain independent.';

revoke all on function public.seller_save_onboarding_pickup(jsonb)
  from public, anon, service_role;
grant execute on function public.seller_save_onboarding_pickup(jsonb)
  to authenticated;

create or replace function public.seller_complete_onboarding()
returns table (
  store_id uuid,
  onboarding_complete boolean,
  onboarding_completed_at timestamptz,
  next_path text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_completed_at timestamptz := statement_timestamp();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select stores.*
  into v_store
  from public.stores
  left join public.user_roles
    on user_roles.store_id = stores.id
   and user_roles.user_id = v_user_id
   and user_roles.role in ('seller', 'staff')
  where stores.owner_user_id = v_user_id
     or user_roles.store_id = stores.id
  order by stores.created_at, stores.id
  limit 1
  for update of stores;

  if v_store.id is null then
    raise exception 'Complete Farm Basics before finishing onboarding.';
  end if;
  if not exists (
    select 1
    from public.seller_onboarding_state as onboarding
    where onboarding.store_id = v_store.id
      and onboarding.profile_complete
      and onboarding.billing_complete
      and onboarding.storefront_details_complete
      and onboarding.categories_complete
      and onboarding.pickup_complete
  ) then
    raise exception 'Complete all onboarding steps before finishing.';
  end if;
  if not exists (
    select 1
    from public.seller_terms_acceptances as acceptances
    where acceptances.store_id = v_store.id
      and acceptances.accepted_by_user_id = v_store.owner_user_id
      and acceptances.terms_version = public.current_seller_terms_version()
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SELLER_TERMS_ACCEPTANCE_REQUIRED';
  end if;

  update public.seller_onboarding_state as onboarding
  set onboarding_complete = true,
      onboarding_completed_at = coalesce(
        onboarding.onboarding_completed_at,
        v_completed_at
      ),
      updated_at = statement_timestamp()
  where onboarding.store_id = v_store.id
  returning onboarding.onboarding_completed_at into v_completed_at;

  if not found then
    raise exception 'Onboarding state could not be found.';
  end if;

  return query select v_store.id, true, v_completed_at, '/dashboard'::text;
end;
$function$;

comment on function public.seller_complete_onboarding() is
'Completes seller onboarding only after Farm Basics, verified billing, storefront details, categories, pickup details, and current Seller Terms acceptance.';

revoke all on function public.seller_complete_onboarding()
  from public, anon;
grant execute on function public.seller_complete_onboarding()
  to authenticated;

commit;
