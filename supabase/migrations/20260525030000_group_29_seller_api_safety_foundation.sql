-- Group 29: Seller API Safety Foundation
--
-- Scope:
-- - Adds safe seller-facing RPCs for UI context, store settings updates,
--   seller breed profile upserts, and create-time listing orchestration.
-- - Reuses existing Group 20 seller inventory RPCs for business logic.
-- - Keeps checkout, Stripe, public order creation, media upload processing,
--   and broad schema redesign out of this group.
--
-- This group does not add:
-- - Edge Function code
-- - checkout or payment behavior
-- - public storefront behavior
-- - storage buckets or storage policies
-- - moderation workflows
-- - new seller tables


create or replace function public.normalize_seller_custom_breed_name(
  p_custom_breed_name text
)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        lower(trim(coalesce(p_custom_breed_name, ''))),
        '[^a-z0-9]+',
        '-',
        'g'
      ),
      '(^-|-$)',
      '',
      'g'
    ),
    ''
  );
$$;

comment on function public.normalize_seller_custom_breed_name(text) is
'Normalizes seller-created custom breed names for per-store uniqueness. This does not create or modify platform breed catalog rows.';


create or replace function public.get_seller_context()
returns table (
  store_id uuid,
  store_name text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  is_publicly_available boolean,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,
  public_email text,
  public_phone text,
  show_public_email boolean,
  show_public_phone boolean,
  website_url text,
  social_url text,
  npip_number text,
  show_npip boolean,
  order_notification_email text,
  billing_plan text,
  subscription_status text,
  storefront_access_until timestamptz,
  trial_ends_at timestamptz,
  profile_complete boolean,
  billing_complete boolean,
  terms_accepted boolean,
  first_listing_created boolean,
  ready_to_launch boolean,
  launched_at timestamptz,
  role text,
  is_admin boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    stores.id as store_id,
    stores.store_name,
    stores.store_slug,
    stores.store_status,
    stores.storefront_mode,
    stores.storefront_enabled,
    (
      stores.storefront_enabled = true
      and stores.store_status = 'live'
      and stores.storefront_mode in ('hosted', 'embedded')
      and stores.admin_hold_reason is null
    ) as is_publicly_available,
    stores.public_city,
    stores.public_state,
    stores.public_country,
    stores.about_text,
    stores.pickup_policy,
    stores.cancellation_policy,
    stores.pickup_instructions,
    stores.public_email,
    stores.public_phone,
    stores.show_public_email,
    stores.show_public_phone,
    stores.website_url,
    stores.social_url,
    stores.npip_number,
    stores.show_npip,
    stores.order_notification_email,
    seller_billing_status.billing_plan,
    seller_billing_status.subscription_status,
    seller_billing_status.storefront_access_until,
    seller_billing_status.trial_ends_at,
    coalesce(seller_onboarding_state.profile_complete, false) as profile_complete,
    coalesce(seller_onboarding_state.billing_complete, false) as billing_complete,
    coalesce(seller_onboarding_state.terms_accepted, false) as terms_accepted,
    coalesce(seller_onboarding_state.first_listing_created, false) as first_listing_created,
    coalesce(seller_onboarding_state.ready_to_launch, false) as ready_to_launch,
    seller_onboarding_state.launched_at,
    user_roles.role,
    public.is_admin() as is_admin
  from public.stores
  left join public.user_roles
    on user_roles.store_id = stores.id
   and user_roles.user_id = auth.uid()
   and user_roles.role in ('seller', 'staff')
  left join public.seller_billing_status
    on seller_billing_status.store_id = stores.id
  left join public.seller_onboarding_state
    on seller_onboarding_state.store_id = stores.id
  where stores.owner_user_id = auth.uid()
     or user_roles.user_id = auth.uid()
     or public.is_admin();
$$;

comment on function public.get_seller_context() is
'Seller-facing context RPC for UI bootstrapping. Omits provider identifiers, admin hold details, suspension metadata, audit fields, and private billing provider IDs.';


create or replace function public.seller_update_store_settings(
  p_store_id uuid,
  p_settings jsonb
)
returns table (
  store_id uuid,
  store_name text,
  store_tagline text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  is_publicly_available boolean,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,
  public_email text,
  public_phone text,
  show_public_email boolean,
  show_public_phone boolean,
  website_url text,
  social_url text,
  npip_number text,
  show_npip boolean,
  order_notification_email text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_allowed_keys text[] := array[
    'store_name',
    'store_tagline',
    'store_slug',
    'storefront_mode',
    'storefront_enabled',
    'public_city',
    'public_state',
    'public_country',
    'about_text',
    'pickup_policy',
    'cancellation_policy',
    'pickup_instructions',
    'public_email',
    'public_phone',
    'show_public_email',
    'show_public_phone',
    'website_url',
    'social_url',
    'npip_number',
    'show_npip',
    'order_notification_email'
  ];
  v_unknown_keys text;
  v_store_name text;
  v_store_slug text;
  v_storefront_mode text;
  v_public_country text;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if p_settings is null
    or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Settings payload must be a JSON object.';
  end if;

  select string_agg(settings_key, ', ' order by settings_key)
  into v_unknown_keys
  from jsonb_object_keys(p_settings) as settings_key
  where not (settings_key = any(v_allowed_keys));

  if v_unknown_keys is not null then
    raise exception 'Unsupported store settings field(s): %', v_unknown_keys;
  end if;

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id
  for update;

  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  if not (public.owns_store(v_store.id) or public.is_admin()) then
    raise exception 'Not authorized to update this store.';
  end if;

  if v_store.store_status in ('suspended', 'canceled') then
    raise exception 'Suspended or canceled stores cannot update seller settings.';
  end if;

  v_store_name := case
    when p_settings ? 'store_name'
      then nullif(trim(p_settings ->> 'store_name'), '')
    else v_store.store_name
  end;

  v_store_slug := case
    when p_settings ? 'store_slug'
      then lower(nullif(trim(p_settings ->> 'store_slug'), ''))
    else v_store.store_slug
  end;

  v_storefront_mode := case
    when p_settings ? 'storefront_mode'
      then nullif(trim(p_settings ->> 'storefront_mode'), '')
    else v_store.storefront_mode
  end;

  v_public_country := case
    when p_settings ? 'public_country'
      then coalesce(nullif(trim(p_settings ->> 'public_country'), ''), 'US')
    else coalesce(v_store.public_country, 'US')
  end;

  if v_store_name is null then
    raise exception 'Store name is required.';
  end if;

  if v_store_slug is null
    or v_store_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Store slug is invalid.';
  end if;

  if v_storefront_mode not in ('hosted', 'embedded', 'private') then
    raise exception 'Storefront mode is not supported.';
  end if;

  update public.stores
  set
    store_name = v_store_name,
    store_tagline = case
      when p_settings ? 'store_tagline' then nullif(trim(p_settings ->> 'store_tagline'), '')
      else stores.store_tagline
    end,
    store_slug = v_store_slug,
    storefront_mode = v_storefront_mode,
    storefront_enabled = case
      when p_settings ? 'storefront_enabled'
        then coalesce((p_settings ->> 'storefront_enabled')::boolean, stores.storefront_enabled)
      else stores.storefront_enabled
    end,
    public_city = case
      when p_settings ? 'public_city' then nullif(trim(p_settings ->> 'public_city'), '')
      else stores.public_city
    end,
    public_state = case
      when p_settings ? 'public_state' then nullif(trim(p_settings ->> 'public_state'), '')
      else stores.public_state
    end,
    public_country = v_public_country,
    about_text = case
      when p_settings ? 'about_text' then nullif(trim(p_settings ->> 'about_text'), '')
      else stores.about_text
    end,
    pickup_policy = case
      when p_settings ? 'pickup_policy' then nullif(trim(p_settings ->> 'pickup_policy'), '')
      else stores.pickup_policy
    end,
    cancellation_policy = case
      when p_settings ? 'cancellation_policy' then nullif(trim(p_settings ->> 'cancellation_policy'), '')
      else stores.cancellation_policy
    end,
    pickup_instructions = case
      when p_settings ? 'pickup_instructions' then nullif(trim(p_settings ->> 'pickup_instructions'), '')
      else stores.pickup_instructions
    end,
    public_email = case
      when p_settings ? 'public_email' then lower(nullif(trim(p_settings ->> 'public_email'), ''))
      else stores.public_email
    end,
    public_phone = case
      when p_settings ? 'public_phone' then nullif(trim(p_settings ->> 'public_phone'), '')
      else stores.public_phone
    end,
    show_public_email = case
      when p_settings ? 'show_public_email'
        then coalesce((p_settings ->> 'show_public_email')::boolean, stores.show_public_email)
      else stores.show_public_email
    end,
    show_public_phone = case
      when p_settings ? 'show_public_phone'
        then coalesce((p_settings ->> 'show_public_phone')::boolean, stores.show_public_phone)
      else stores.show_public_phone
    end,
    website_url = case
      when p_settings ? 'website_url' then nullif(trim(p_settings ->> 'website_url'), '')
      else stores.website_url
    end,
    social_url = case
      when p_settings ? 'social_url' then nullif(trim(p_settings ->> 'social_url'), '')
      else stores.social_url
    end,
    npip_number = case
      when p_settings ? 'npip_number' then nullif(trim(p_settings ->> 'npip_number'), '')
      else stores.npip_number
    end,
    show_npip = case
      when p_settings ? 'show_npip'
        then coalesce((p_settings ->> 'show_npip')::boolean, stores.show_npip)
      else stores.show_npip
    end,
    order_notification_email = case
      when p_settings ? 'order_notification_email' then lower(nullif(trim(p_settings ->> 'order_notification_email'), ''))
      else stores.order_notification_email
    end
  where stores.id = v_store.id
  returning * into v_store;

  return query
  select
    v_store.id,
    v_store.store_name,
    v_store.store_tagline,
    v_store.store_slug,
    v_store.store_status,
    v_store.storefront_mode,
    v_store.storefront_enabled,
    (
      v_store.storefront_enabled = true
      and v_store.store_status = 'live'
      and v_store.storefront_mode in ('hosted', 'embedded')
      and v_store.admin_hold_reason is null
    ) as is_publicly_available,
    v_store.public_city,
    v_store.public_state,
    v_store.public_country,
    v_store.about_text,
    v_store.pickup_policy,
    v_store.cancellation_policy,
    v_store.pickup_instructions,
    v_store.public_email,
    v_store.public_phone,
    v_store.show_public_email,
    v_store.show_public_phone,
    v_store.website_url,
    v_store.social_url,
    v_store.npip_number,
    v_store.show_npip,
    v_store.order_notification_email,
    v_store.updated_at;
end;
$$;

comment on function public.seller_update_store_settings(
  uuid, jsonb
) is
'Seller/admin RPC for updating only seller-editable store settings. It intentionally does not accept ownership, store_status, admin hold/suspension, billing/provider, audit, or system fields.';


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
    from public.species
    where species.id = p_species_id
      and species.is_active = true
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
    select *
    into v_breed
    from public.breeds
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
    select *
    into v_profile
    from public.seller_breed_profiles
    where seller_breed_profiles.id = p_seller_breed_profile_id
      and seller_breed_profiles.store_id = p_store_id
    for update;

    if v_profile.id is null then
      raise exception 'Seller breed profile is not available for this store.';
    end if;

    if exists (
      select 1
      from public.listing_batch_breeds
      where listing_batch_breeds.seller_breed_profile_id = v_profile.id
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

    update public.seller_breed_profiles
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
    where seller_breed_profiles.id = v_profile.id
    returning * into v_profile;
  elsif p_breed_id is not null then
    insert into public.seller_breed_profiles (
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
    on conflict (store_id, species_id, breed_id)
      where breed_id is not null
    do update
    set
      display_name = excluded.display_name,
      seller_description = excluded.seller_description,
      seller_notes = excluded.seller_notes,
      visibility_status = excluded.visibility_status
    returning * into v_profile;
  else
    insert into public.seller_breed_profiles (
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
    on conflict (store_id, species_id, normalized_custom_breed_name)
      where normalized_custom_breed_name is not null
    do update
    set
      custom_breed_name = excluded.custom_breed_name,
      display_name = excluded.display_name,
      seller_description = excluded.seller_description,
      seller_notes = excluded.seller_notes,
      visibility_status = excluded.visibility_status
    returning * into v_profile;
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
'Seller/admin RPC for creating or updating seller-owned breed profiles. Validates species/breed consistency, never accepts moderation fields, and never promotes custom breeds into the platform catalog.';


create or replace function public.seller_create_listing_batch_with_inventory(
  p_store_id uuid,
  p_species_id uuid,
  p_batch_type text,
  p_origin_date date,
  p_available_date date,
  p_base_price numeric,
  p_breed_groups jsonb,
  p_auto_price_increase_enabled boolean default false,
  p_auto_price_increase_amount numeric default null,
  p_auto_price_increase_max_price numeric default null,
  p_internal_batch_label text default null,
  p_seller_notes text default null,
  p_visibility_status text default 'hidden'
)
returns table (
  listing_batch_id uuid,
  store_id uuid,
  species_id uuid,
  batch_type text,
  origin_date date,
  available_date date,
  base_price numeric(10, 2),
  visibility_status text,
  breed_groups jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_group jsonb;
  v_item jsonb;
  v_batch_breed public.listing_batch_breeds%rowtype;
  v_inventory_item public.inventory_items%rowtype;
  v_breed_groups jsonb := '[]'::jsonb;
  v_inventory_items jsonb;
  v_group_index integer := 0;
  v_item_index integer;
begin
  if p_breed_groups is null
    or jsonb_typeof(p_breed_groups) <> 'array'
    or jsonb_array_length(p_breed_groups) = 0 then
    raise exception 'At least one breed group is required.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_breed_groups) as breed_group(value)
    where jsonb_typeof(breed_group.value) <> 'object'
       or not (breed_group.value ? 'seller_breed_profile_id')
       or breed_group.value ->> 'seller_breed_profile_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or not (breed_group.value ? 'inventory_items')
       or jsonb_typeof(breed_group.value -> 'inventory_items') <> 'array'
       or jsonb_array_length(breed_group.value -> 'inventory_items') = 0
       or (
         breed_group.value ? 'sort_order'
         and breed_group.value ->> 'sort_order' !~ '^[0-9]+$'
       )
  ) then
    raise exception 'Each breed group must include a seller breed profile id and at least one inventory item.';
  end if;

  v_batch := public.seller_create_listing_batch(
    p_store_id,
    p_species_id,
    p_batch_type,
    p_origin_date,
    p_available_date,
    p_base_price,
    p_auto_price_increase_enabled,
    p_auto_price_increase_amount,
    p_auto_price_increase_max_price,
    p_internal_batch_label,
    p_seller_notes,
    p_visibility_status
  );

  for v_group in
    select value
    from jsonb_array_elements(p_breed_groups) as breed_group(value)
  loop
    v_group_index := v_group_index + 1;

    v_batch_breed := public.seller_add_listing_batch_breed(
      v_batch.id,
      (v_group ->> 'seller_breed_profile_id')::uuid,
      v_group ->> 'seller_notes',
      coalesce((v_group ->> 'sort_order')::integer, v_group_index - 1),
      coalesce(nullif(v_group ->> 'visibility_status', ''), 'active')
    );

    v_inventory_items := '[]'::jsonb;
    v_item_index := 0;

    for v_item in
      select value
      from jsonb_array_elements(v_group -> 'inventory_items') as inventory_item(value)
    loop
      v_item_index := v_item_index + 1;

      if jsonb_typeof(v_item) <> 'object'
        or not (v_item ? 'inventory_type')
        or not (v_item ? 'quantity_available')
        or v_item ->> 'quantity_available' !~ '^[0-9]+$'
        or (
          v_item ? 'sort_order'
          and v_item ->> 'sort_order' !~ '^[0-9]+$'
        )
        or (
          v_item ? 'price_override'
          and v_item ->> 'price_override' !~ '^[0-9]+(\.[0-9]{1,2})?$'
        ) then
        raise exception 'Each inventory item must include an inventory type and nonnegative quantity.';
      end if;

      v_inventory_item := public.seller_create_inventory_item(
        v_batch_breed.id,
        v_item ->> 'inventory_type',
        v_item ->> 'custom_inventory_label',
        (v_item ->> 'quantity_available')::integer,
        case
          when v_item ? 'price_override'
            then (v_item ->> 'price_override')::numeric
          else null
        end,
        case
          when v_item ? 'sort_order'
            then (v_item ->> 'sort_order')::integer
          else v_item_index - 1
        end,
        coalesce(nullif(v_item ->> 'visibility_status', ''), 'active'),
        v_item ->> 'seller_notes'
      );

      v_inventory_items := v_inventory_items || jsonb_build_array(to_jsonb(v_inventory_item));
    end loop;

    v_breed_groups := v_breed_groups || jsonb_build_array(
      jsonb_build_object(
        'listing_batch_breed', to_jsonb(v_batch_breed),
        'inventory_items', v_inventory_items
      )
    );
  end loop;

  return query
  select
    v_batch.id,
    v_batch.store_id,
    v_batch.species_id,
    v_batch.batch_type,
    v_batch.origin_date,
    v_batch.available_date,
    v_batch.base_price,
    v_batch.visibility_status,
    v_breed_groups;
end;
$$;

comment on function public.seller_create_listing_batch_with_inventory(
  uuid, uuid, text, date, date, numeric, jsonb, boolean, numeric, numeric, text, text, text
) is
'Create-time seller UI orchestration RPC. Reuses existing Group 20 listing batch, breed row, and inventory item RPCs so the client does not need to coordinate a fragile multi-step create flow.';


revoke all on function public.normalize_seller_custom_breed_name(text) from public;
revoke all on function public.get_seller_context() from public;
revoke all on function public.seller_update_store_settings(
  uuid, jsonb
) from public;
revoke all on function public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid
) from public;
revoke all on function public.seller_create_listing_batch_with_inventory(
  uuid, uuid, text, date, date, numeric, jsonb, boolean, numeric, numeric, text, text, text
) from public;

grant execute on function public.normalize_seller_custom_breed_name(text) to authenticated;
grant execute on function public.get_seller_context() to authenticated;
grant execute on function public.seller_update_store_settings(
  uuid, jsonb
) to authenticated;
grant execute on function public.seller_upsert_breed_profile(
  uuid, uuid, uuid, text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.seller_create_listing_batch_with_inventory(
  uuid, uuid, text, date, date, numeric, jsonb, boolean, numeric, numeric, text, text, text
) to authenticated;
