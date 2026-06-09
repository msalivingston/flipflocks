-- Phase 1 seller inventory modules: Equipment & Supplies toggle.
--
-- This flag only controls whether sellers see entry points for creating future
-- equipment and supplies inventory. Existing records and history are not
-- hidden, deleted, archived, or otherwise changed.

alter table public.stores
add column if not exists equipment_supplies_enabled boolean not null default false;

comment on column public.stores.equipment_supplies_enabled is
'Seller-controlled Store Admin setting for showing future Equipment & Supplies creation entry points. It does not hide or modify existing inventory, listings, orders, or history.';

drop function if exists public.get_seller_context();

create or replace function public.get_seller_context()
returns table (
  store_id uuid,
  store_name text,
  store_tagline text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  hatching_eggs_enabled boolean,
  equipment_supplies_enabled boolean,
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
  is_admin boolean,
  other_policies text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    stores.id as store_id,
    stores.store_name,
    stores.store_tagline,
    stores.store_slug,
    stores.store_status,
    stores.storefront_mode,
    stores.storefront_enabled,
    stores.hatching_eggs_enabled,
    stores.equipment_supplies_enabled,
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
    public.is_admin() as is_admin,
    stores.other_policies
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
'Seller-facing context RPC for UI bootstrapping. Includes Store Admin module flags while omitting provider identifiers, admin hold details, suspension metadata, audit fields, and private billing provider IDs.';

drop function if exists public.seller_update_store_settings(uuid, jsonb);

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
  hatching_eggs_enabled boolean,
  equipment_supplies_enabled boolean,
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
  updated_at timestamptz,
  other_policies text
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
    'hatching_eggs_enabled',
    'equipment_supplies_enabled',
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
    'order_notification_email',
    'other_policies'
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
    hatching_eggs_enabled = case
      when p_settings ? 'hatching_eggs_enabled'
        then coalesce((p_settings ->> 'hatching_eggs_enabled')::boolean, stores.hatching_eggs_enabled)
      else stores.hatching_eggs_enabled
    end,
    equipment_supplies_enabled = case
      when p_settings ? 'equipment_supplies_enabled'
        then coalesce((p_settings ->> 'equipment_supplies_enabled')::boolean, stores.equipment_supplies_enabled)
      else stores.equipment_supplies_enabled
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
    other_policies = case
      when p_settings ? 'other_policies' then nullif(trim(p_settings ->> 'other_policies'), '')
      else stores.other_policies
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
    v_store.hatching_eggs_enabled,
    v_store.equipment_supplies_enabled,
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
    v_store.updated_at,
    v_store.other_policies;
end;
$$;

comment on function public.seller_update_store_settings(uuid, jsonb) is
'Seller/admin RPC for updating only seller-editable store settings, including Store Admin other_policies and inventory module preferences. It intentionally does not accept ownership, store_status, admin hold/suspension, billing/provider, audit, or system fields.';

revoke all on function public.get_seller_context() from public;
revoke all on function public.seller_update_store_settings(uuid, jsonb) from public;
grant execute on function public.get_seller_context() to authenticated;
grant execute on function public.seller_update_store_settings(uuid, jsonb) to authenticated;
