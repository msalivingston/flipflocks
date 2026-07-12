begin;

alter table public.stores
add column if not exists storefront_font_pair text not null default 'farmstead',
add column if not exists storefront_heading_color text not null default '#073f1e',
add column if not exists storefront_text_color text not null default '#1f2f37',
add column if not exists storefront_top_menu_color text not null default '#ffffff';

update public.stores
set
  storefront_font_pair = coalesce(nullif(trim(storefront_font_pair), ''), 'farmstead'),
  storefront_heading_color = lower(coalesce(nullif(trim(storefront_heading_color), ''), '#073f1e')),
  storefront_text_color = lower(coalesce(nullif(trim(storefront_text_color), ''), '#1f2f37')),
  storefront_top_menu_color = lower(coalesce(nullif(trim(storefront_top_menu_color), ''), '#ffffff'));

alter table public.stores
drop constraint if exists stores_storefront_font_pair_check,
drop constraint if exists stores_storefront_heading_color_hex_check,
drop constraint if exists stores_storefront_text_color_hex_check,
drop constraint if exists stores_storefront_top_menu_color_hex_check;

alter table public.stores
add constraint stores_storefront_font_pair_check
check (storefront_font_pair in (
  'farmstead',
  'homestead',
  'modern_farm',
  'heritage',
  'country_classic'
)),
add constraint stores_storefront_heading_color_hex_check
check (storefront_heading_color ~* '^#[0-9a-f]{6}$'),
add constraint stores_storefront_text_color_hex_check
check (storefront_text_color ~* '^#[0-9a-f]{6}$'),
add constraint stores_storefront_top_menu_color_hex_check
check (storefront_top_menu_color ~* '^#[0-9a-f]{6}$');

comment on column public.stores.storefront_font_pair is
'Seller-selected public storefront font pair. Controlled enum applied through storefront theme variables.';
comment on column public.stores.storefront_heading_color is
'Seller-selected public storefront heading color as a six-digit hex value.';
comment on column public.stores.storefront_text_color is
'Seller-selected public storefront body text color as a six-digit hex value.';
comment on column public.stores.storefront_top_menu_color is
'Seller-selected public storefront top menu background color as a six-digit hex value.';

drop function if exists public.get_seller_context();

create or replace function public.get_seller_context()
returns table (
  store_id uuid,
  store_name text,
  store_tagline text,
  hero_subheading text,
  storefront_font_pair text,
  storefront_heading_color text,
  storefront_text_color text,
  storefront_top_menu_color text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  hatching_eggs_enabled boolean,
  equipment_supplies_enabled boolean,
  processed_poultry_enabled boolean,
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
  plan_key text,
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
  other_policies text,
  custom_policies jsonb
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
    stores.hero_subheading,
    stores.storefront_font_pair,
    stores.storefront_heading_color,
    stores.storefront_text_color,
    stores.storefront_top_menu_color,
    stores.store_slug,
    stores.store_status,
    stores.storefront_mode,
    stores.storefront_enabled,
    stores.hatching_eggs_enabled,
    stores.equipment_supplies_enabled,
    stores.processed_poultry_enabled,
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
    coalesce(seller_billing_status.plan_key, 'full_flock') as plan_key,
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
    stores.other_policies,
    stores.custom_policies
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
     or user_roles.store_id = stores.id;
$$;

comment on function public.get_seller_context() is
'Seller dashboard bootstrap context. Returns only stores the current user owns or has scoped seller/staff membership for; includes seller storefront appearance settings.';

revoke all on function public.get_seller_context() from public;
grant execute on function public.get_seller_context() to authenticated;

drop function if exists public.seller_update_store_settings(uuid, jsonb);

create or replace function public.seller_update_store_settings(
  p_store_id uuid,
  p_settings jsonb
)
returns table (
  store_id uuid,
  store_name text,
  store_tagline text,
  hero_subheading text,
  storefront_font_pair text,
  storefront_heading_color text,
  storefront_text_color text,
  storefront_top_menu_color text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  hatching_eggs_enabled boolean,
  equipment_supplies_enabled boolean,
  processed_poultry_enabled boolean,
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
  other_policies text,
  custom_policies jsonb
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
    'hero_subheading',
    'storefront_font_pair',
    'storefront_heading_color',
    'storefront_text_color',
    'storefront_top_menu_color',
    'store_slug',
    'storefront_mode',
    'storefront_enabled',
    'hatching_eggs_enabled',
    'equipment_supplies_enabled',
    'processed_poultry_enabled',
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
    'other_policies',
    'custom_policies'
  ];
  v_unknown_keys text;
  v_store_name text;
  v_store_slug text;
  v_storefront_mode text;
  v_public_country text;
  v_hero_subheading text;
  v_storefront_font_pair text;
  v_storefront_heading_color text;
  v_storefront_text_color text;
  v_storefront_top_menu_color text;
  v_custom_policies jsonb;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Settings payload must be a JSON object.';
  end if;

  select string_agg(settings_key, ', ' order by settings_key)
  into v_unknown_keys
  from jsonb_object_keys(p_settings) as settings_key
  where not (settings_key = any(v_allowed_keys));

  if v_unknown_keys is not null then
    raise exception 'Unsupported store settings field(s): %', v_unknown_keys;
  end if;

  select stores.*
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
    when p_settings ? 'store_name' then nullif(trim(p_settings ->> 'store_name'), '')
    else v_store.store_name
  end;

  v_store_slug := case
    when p_settings ? 'store_slug' then lower(nullif(trim(p_settings ->> 'store_slug'), ''))
    else v_store.store_slug
  end;

  v_storefront_mode := case
    when p_settings ? 'storefront_mode' then nullif(trim(p_settings ->> 'storefront_mode'), '')
    else v_store.storefront_mode
  end;

  v_public_country := case
    when p_settings ? 'public_country' then coalesce(nullif(trim(p_settings ->> 'public_country'), ''), 'US')
    else coalesce(v_store.public_country, 'US')
  end;

  v_hero_subheading := case
    when p_settings ? 'hero_subheading' then nullif(trim(p_settings ->> 'hero_subheading'), '')
    else v_store.hero_subheading
  end;

  v_storefront_font_pair := case
    when p_settings ? 'storefront_font_pair' then nullif(trim(p_settings ->> 'storefront_font_pair'), '')
    else v_store.storefront_font_pair
  end;

  v_storefront_heading_color := case
    when p_settings ? 'storefront_heading_color' then lower(nullif(trim(p_settings ->> 'storefront_heading_color'), ''))
    else v_store.storefront_heading_color
  end;

  v_storefront_text_color := case
    when p_settings ? 'storefront_text_color' then lower(nullif(trim(p_settings ->> 'storefront_text_color'), ''))
    else v_store.storefront_text_color
  end;

  v_storefront_top_menu_color := case
    when p_settings ? 'storefront_top_menu_color' then lower(nullif(trim(p_settings ->> 'storefront_top_menu_color'), ''))
    else v_store.storefront_top_menu_color
  end;

  if p_settings ? 'custom_policies' then
    v_custom_policies := p_settings -> 'custom_policies';

    if jsonb_typeof(v_custom_policies) <> 'array' then
      raise exception 'Custom policies must be an array.';
    end if;

    if jsonb_array_length(v_custom_policies) > 4 then
      raise exception 'Custom policies are limited to 4 sections.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_custom_policies) as policy
      where jsonb_typeof(policy) <> 'object'
         or nullif(trim(policy ->> 'title'), '') is null
         or nullif(trim(policy ->> 'body'), '') is null
    ) then
      raise exception 'Each custom policy needs a title and policy text.';
    end if;
  else
    v_custom_policies := v_store.custom_policies;
  end if;

  if v_store_name is null then raise exception 'Store name is required.'; end if;

  if v_store_slug is null or v_store_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Store slug is invalid.';
  end if;

  if v_hero_subheading is null then
    raise exception 'Hero subheading is required.';
  end if;

  if length(v_hero_subheading) > 90 then
    raise exception 'Hero subheading must be 90 characters or fewer.';
  end if;

  if v_storefront_font_pair not in (
    'farmstead',
    'homestead',
    'modern_farm',
    'heritage',
    'country_classic'
  ) then
    raise exception 'Storefront font style is not supported.';
  end if;

  if v_storefront_heading_color !~* '^#[0-9a-f]{6}$' then
    raise exception 'Heading color must be a 6-digit hex value.';
  end if;

  if v_storefront_text_color !~* '^#[0-9a-f]{6}$' then
    raise exception 'Text color must be a 6-digit hex value.';
  end if;

  if v_storefront_top_menu_color !~* '^#[0-9a-f]{6}$' then
    raise exception 'Top menu color must be a 6-digit hex value.';
  end if;

  if v_storefront_mode not in ('hosted', 'embedded', 'private') then
    raise exception 'Storefront mode is not supported.';
  end if;

  update public.stores
  set
    store_name = v_store_name,
    store_tagline = case when p_settings ? 'store_tagline' then nullif(trim(p_settings ->> 'store_tagline'), '') else stores.store_tagline end,
    hero_subheading = v_hero_subheading,
    storefront_font_pair = v_storefront_font_pair,
    storefront_heading_color = v_storefront_heading_color,
    storefront_text_color = v_storefront_text_color,
    storefront_top_menu_color = v_storefront_top_menu_color,
    store_slug = v_store_slug,
    storefront_mode = v_storefront_mode,
    storefront_enabled = case when p_settings ? 'storefront_enabled' then coalesce((p_settings ->> 'storefront_enabled')::boolean, stores.storefront_enabled) else stores.storefront_enabled end,
    hatching_eggs_enabled = case when p_settings ? 'hatching_eggs_enabled' then coalesce((p_settings ->> 'hatching_eggs_enabled')::boolean, stores.hatching_eggs_enabled) else stores.hatching_eggs_enabled end,
    equipment_supplies_enabled = case when p_settings ? 'equipment_supplies_enabled' then coalesce((p_settings ->> 'equipment_supplies_enabled')::boolean, stores.equipment_supplies_enabled) else stores.equipment_supplies_enabled end,
    processed_poultry_enabled = case when p_settings ? 'processed_poultry_enabled' then coalesce((p_settings ->> 'processed_poultry_enabled')::boolean, stores.processed_poultry_enabled) else stores.processed_poultry_enabled end,
    public_city = case when p_settings ? 'public_city' then nullif(trim(p_settings ->> 'public_city'), '') else stores.public_city end,
    public_state = case when p_settings ? 'public_state' then nullif(trim(p_settings ->> 'public_state'), '') else stores.public_state end,
    public_country = v_public_country,
    about_text = case when p_settings ? 'about_text' then nullif(trim(p_settings ->> 'about_text'), '') else stores.about_text end,
    pickup_policy = case when p_settings ? 'pickup_policy' then nullif(trim(p_settings ->> 'pickup_policy'), '') else stores.pickup_policy end,
    cancellation_policy = case when p_settings ? 'cancellation_policy' then nullif(trim(p_settings ->> 'cancellation_policy'), '') else stores.cancellation_policy end,
    other_policies = case when p_settings ? 'other_policies' then nullif(trim(p_settings ->> 'other_policies'), '') else stores.other_policies end,
    custom_policies = v_custom_policies,
    pickup_instructions = case when p_settings ? 'pickup_instructions' then nullif(trim(p_settings ->> 'pickup_instructions'), '') else stores.pickup_instructions end,
    public_email = case when p_settings ? 'public_email' then lower(nullif(trim(p_settings ->> 'public_email'), '')) else stores.public_email end,
    public_phone = case when p_settings ? 'public_phone' then nullif(trim(p_settings ->> 'public_phone'), '') else stores.public_phone end,
    show_public_email = case when p_settings ? 'show_public_email' then coalesce((p_settings ->> 'show_public_email')::boolean, stores.show_public_email) else stores.show_public_email end,
    show_public_phone = case when p_settings ? 'show_public_phone' then coalesce((p_settings ->> 'show_public_phone')::boolean, stores.show_public_phone) else stores.show_public_phone end,
    website_url = case when p_settings ? 'website_url' then nullif(trim(p_settings ->> 'website_url'), '') else stores.website_url end,
    social_url = case when p_settings ? 'social_url' then nullif(trim(p_settings ->> 'social_url'), '') else stores.social_url end,
    npip_number = case when p_settings ? 'npip_number' then nullif(trim(p_settings ->> 'npip_number'), '') else stores.npip_number end,
    show_npip = case when p_settings ? 'show_npip' then coalesce((p_settings ->> 'show_npip')::boolean, stores.show_npip) else stores.show_npip end,
    order_notification_email = case when p_settings ? 'order_notification_email' then lower(nullif(trim(p_settings ->> 'order_notification_email'), '')) else stores.order_notification_email end
  where stores.id = v_store.id
  returning stores.* into v_store;

  return query
  select
    v_store.id,
    v_store.store_name,
    v_store.store_tagline,
    v_store.hero_subheading,
    v_store.storefront_font_pair,
    v_store.storefront_heading_color,
    v_store.storefront_text_color,
    v_store.storefront_top_menu_color,
    v_store.store_slug,
    v_store.store_status,
    v_store.storefront_mode,
    v_store.storefront_enabled,
    v_store.hatching_eggs_enabled,
    v_store.equipment_supplies_enabled,
    v_store.processed_poultry_enabled,
    (
      v_store.storefront_enabled = true
      and v_store.store_status = 'live'
      and v_store.storefront_mode in ('hosted', 'embedded')
      and v_store.admin_hold_reason is null
    ),
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
    v_store.other_policies,
    v_store.custom_policies;
end;
$$;

comment on function public.seller_update_store_settings(uuid, jsonb) is
'Seller/admin RPC for updating seller-editable store settings, including public storefront appearance settings.';

revoke all on function public.seller_update_store_settings(uuid, jsonb) from public;
grant execute on function public.seller_update_store_settings(uuid, jsonb) to authenticated;

drop function if exists public.get_public_storefront_home(text);

create or replace function public.get_public_storefront_home(
  p_store_slug text
)
returns table (
  store_id uuid,
  store_slug text,
  store_name text,
  store_tagline text,
  hero_subheading text,
  storefront_font_pair text,
  storefront_heading_color text,
  storefront_text_color text,
  storefront_top_menu_color text,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,
  pickup_method text,
  public_email text,
  public_phone text,
  website_url text,
  social_url text,
  npip_number text,
  hero_image_url text,
  hero_image_alt_text text,
  hero_crop_metadata jsonb,
  hero_image_layout text,
  logo_image_url text,
  logo_image_alt_text text,
  public_inventory_item_count bigint,
  ready_now_item_count bigint,
  reserve_now_item_count bigint,
  sold_out_item_count bigint,
  total_quantity_available bigint,
  next_available_date date,
  has_public_inventory boolean,
  other_policies text,
  custom_policies jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with storefront_status as (
    select *
    from public.get_storefront_public_status(p_store_slug)
  ),
  target_store as (
    select stores.*
    from public.stores
    join storefront_status
      on storefront_status.store_slug = stores.store_slug
    where storefront_status.store_exists = true
      and storefront_status.is_publicly_available = true
  ),
  public_inventory as (
    select
      public_storefront_inventory.quantity_available,
      public_storefront_inventory.available_date,
      public_storefront_inventory.buyer_availability_code
    from target_store
    join public.public_storefront_inventory
      on public_storefront_inventory.store_id = target_store.id
  ),
  inventory_summary as (
    select
      count(*) as public_inventory_item_count,
      count(*) filter (where public_inventory.buyer_availability_code = 'ready_now') as ready_now_item_count,
      count(*) filter (where public_inventory.buyer_availability_code = 'reserve_now') as reserve_now_item_count,
      count(*) filter (where public_inventory.buyer_availability_code = 'sold_out') as sold_out_item_count,
      coalesce(sum(public_inventory.quantity_available), 0)::bigint as total_quantity_available,
      min(public_inventory.available_date) filter (where public_inventory.quantity_available > 0) as next_available_date
    from public_inventory
  )
  select
    target_store.id as store_id,
    target_store.store_slug,
    target_store.store_name,
    target_store.store_tagline,
    target_store.hero_subheading,
    target_store.storefront_font_pair,
    target_store.storefront_heading_color,
    target_store.storefront_text_color,
    target_store.storefront_top_menu_color,
    target_store.public_city,
    target_store.public_state,
    target_store.public_country,
    target_store.about_text,
    target_store.pickup_policy,
    target_store.cancellation_policy,
    target_store.pickup_instructions,
    target_store.pickup_method,
    case when target_store.show_public_email then target_store.public_email else null end as public_email,
    case when target_store.show_public_phone then target_store.public_phone else null end as public_phone,
    target_store.website_url,
    target_store.social_url,
    case when target_store.show_npip then target_store.npip_number else null end as npip_number,
    hero_media.image_url as hero_image_url,
    hero_media.alt_text as hero_image_alt_text,
    hero_media.crop_metadata as hero_crop_metadata,
    coalesce(hero_media.hero_layout, 'full') as hero_image_layout,
    logo_media.image_url as logo_image_url,
    logo_media.alt_text as logo_image_alt_text,
    coalesce(inventory_summary.public_inventory_item_count, 0),
    coalesce(inventory_summary.ready_now_item_count, 0),
    coalesce(inventory_summary.reserve_now_item_count, 0),
    coalesce(inventory_summary.sold_out_item_count, 0),
    coalesce(inventory_summary.total_quantity_available, 0),
    inventory_summary.next_available_date,
    coalesce(inventory_summary.public_inventory_item_count, 0) > 0,
    target_store.other_policies,
    target_store.custom_policies
  from target_store
  cross join inventory_summary
  left join lateral (
    select
      public.media_asset_public_url(
        media_assets.source_type,
        media_assets.source_image_url,
        media_assets.bucket_name,
        media_assets.storage_path
      ) as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
      media_links.crop_metadata,
      media_links.hero_layout
    from public.media_links
    join public.media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.store_id = target_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = target_store.id
      and media_links.display_context = 'hero'
      and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
    limit 1
  ) as hero_media on true
  left join lateral (
    select
      public.media_asset_public_url(
        media_assets.source_type,
        media_assets.source_image_url,
        media_assets.bucket_name,
        media_assets.storage_path
      ) as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links
    join public.media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.store_id = target_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = target_store.id
      and media_links.display_context = 'logo'
      and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
    limit 1
  ) as logo_media on true;
$$;

comment on function public.get_public_storefront_home(text) is
'Slug-scoped public storefront home payload. Includes public-safe store policy and storefront appearance fields.';

revoke all on function public.get_public_storefront_home(text) from public;
grant execute on function public.get_public_storefront_home(text) to anon, authenticated;

drop function if exists public.get_seller_storefront_home_preview(text);

create or replace function public.get_seller_storefront_home_preview(
  p_store_slug text
)
returns table (
  store_id uuid,
  store_slug text,
  store_name text,
  store_tagline text,
  hero_subheading text,
  storefront_font_pair text,
  storefront_heading_color text,
  storefront_text_color text,
  storefront_top_menu_color text,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,
  pickup_method text,
  public_email text,
  public_phone text,
  website_url text,
  social_url text,
  npip_number text,
  hero_image_url text,
  hero_image_alt_text text,
  hero_crop_metadata jsonb,
  hero_image_layout text,
  logo_image_url text,
  logo_image_alt_text text,
  public_inventory_item_count bigint,
  ready_now_item_count bigint,
  reserve_now_item_count bigint,
  sold_out_item_count bigint,
  total_quantity_available bigint,
  next_available_date date,
  has_public_inventory boolean,
  preview_is_hidden boolean,
  other_policies text,
  custom_policies jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with target_store as (
    select stores.*
    from public.stores
    where stores.store_slug = p_store_slug
      and (public.owns_store(stores.id) or public.is_admin())
  ),
  public_inventory as (
    select
      public_storefront_inventory.quantity_available,
      public_storefront_inventory.available_date,
      public_storefront_inventory.buyer_availability_code
    from target_store
    join public.public_storefront_inventory
      on public_storefront_inventory.store_id = target_store.id
  ),
  inventory_summary as (
    select
      count(*) as public_inventory_item_count,
      count(*) filter (where public_inventory.buyer_availability_code = 'ready_now') as ready_now_item_count,
      count(*) filter (where public_inventory.buyer_availability_code = 'reserve_now') as reserve_now_item_count,
      count(*) filter (where public_inventory.buyer_availability_code = 'sold_out') as sold_out_item_count,
      coalesce(sum(public_inventory.quantity_available), 0)::bigint as total_quantity_available,
      min(public_inventory.available_date) filter (where public_inventory.quantity_available > 0) as next_available_date
    from public_inventory
  )
  select
    target_store.id as store_id,
    target_store.store_slug,
    target_store.store_name,
    target_store.store_tagline,
    target_store.hero_subheading,
    target_store.storefront_font_pair,
    target_store.storefront_heading_color,
    target_store.storefront_text_color,
    target_store.storefront_top_menu_color,
    target_store.public_city,
    target_store.public_state,
    target_store.public_country,
    target_store.about_text,
    target_store.pickup_policy,
    target_store.cancellation_policy,
    target_store.pickup_instructions,
    target_store.pickup_method,
    case when target_store.show_public_email then target_store.public_email else null end as public_email,
    case when target_store.show_public_phone then target_store.public_phone else null end as public_phone,
    target_store.website_url,
    target_store.social_url,
    case when target_store.show_npip then target_store.npip_number else null end as npip_number,
    hero_media.image_url as hero_image_url,
    hero_media.alt_text as hero_image_alt_text,
    hero_media.crop_metadata as hero_crop_metadata,
    coalesce(hero_media.hero_layout, 'full') as hero_image_layout,
    logo_media.image_url as logo_image_url,
    logo_media.alt_text as logo_image_alt_text,
    coalesce(inventory_summary.public_inventory_item_count, 0),
    coalesce(inventory_summary.ready_now_item_count, 0),
    coalesce(inventory_summary.reserve_now_item_count, 0),
    coalesce(inventory_summary.sold_out_item_count, 0),
    coalesce(inventory_summary.total_quantity_available, 0),
    inventory_summary.next_available_date,
    coalesce(inventory_summary.public_inventory_item_count, 0) > 0,
    not (
      target_store.storefront_enabled = true
      and target_store.store_status = 'live'
      and target_store.storefront_mode in ('hosted', 'embedded')
      and target_store.admin_hold_reason is null
    ) as preview_is_hidden,
    target_store.other_policies,
    target_store.custom_policies
  from target_store
  cross join inventory_summary
  left join lateral (
    select
      public.media_asset_public_url(
        media_assets.source_type,
        media_assets.source_image_url,
        media_assets.bucket_name,
        media_assets.storage_path
      ) as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
      media_links.crop_metadata,
      media_links.hero_layout
    from public.media_links
    join public.media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.store_id = target_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = target_store.id
      and media_links.display_context = 'hero'
      and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
    limit 1
  ) as hero_media on true
  left join lateral (
    select
      public.media_asset_public_url(
        media_assets.source_type,
        media_assets.source_image_url,
        media_assets.bucket_name,
        media_assets.storage_path
      ) as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links
    join public.media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.store_id = target_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = target_store.id
      and media_links.display_context = 'logo'
      and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
    limit 1
  ) as logo_media on true;
$$;

comment on function public.get_seller_storefront_home_preview(text) is
'Seller-only storefront preview payload. Includes appearance settings and can load hidden stores for their owners.';

revoke all on function public.get_seller_storefront_home_preview(text) from public;
grant execute on function public.get_seller_storefront_home_preview(text) to authenticated;

commit;
