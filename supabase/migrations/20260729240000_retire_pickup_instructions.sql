-- Retire the duplicate seller pickup guidance field.
-- pickup_policy is the sole seller-authored public pickup guidance field.

update public.stores
set pickup_policy = nullif(trim(stores.pickup_instructions), '')
where nullif(trim(stores.pickup_policy), '') is null
  and nullif(trim(stores.pickup_instructions), '') is not null;

-- These RPCs change their table return shapes, so they must be dropped before
-- being recreated without pickup_instructions.
drop function public.get_seller_context();
drop function public.seller_update_store_settings(uuid, jsonb);
drop function public.get_public_storefront_home(text);
drop function public.get_seller_storefront_home_preview(text);
drop function public.seller_update_store_defaults(uuid, jsonb);

-- Preserve the full launch-readiness implementation while changing only its
-- pickup guidance check and copy.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.evaluate_store_launch_readiness(uuid,uuid)'::regprocedure
  )
  into v_definition;

  v_definition := replace(v_definition, 'pickup_instructions', 'pickup_policy');
  v_definition := replace(v_definition, 'Pickup instructions', 'Pickup policy');

  execute v_definition;
end;
$migration$;

-- Remove view dependencies before dropping the physical column.
drop view public.public_breed_availability;
drop view public.public_discoverable_inventory;
drop view public.public_discoverable_storefronts;
drop view public.public_storefront_home;
drop view public.public_storefront_item_detail;
drop view public.seller_store_defaults;
drop view public.public_storefronts;

alter table public.stores
drop column pickup_instructions;

create view public.public_storefronts
with (security_barrier = true)
as
select
  stores.id as store_id,
  stores.store_slug,
  stores.store_name,
  stores.store_tagline,
  stores.public_city,
  stores.public_state,
  stores.public_country,
  stores.about_text,
  stores.pickup_policy,
  stores.cancellation_policy,
  case when stores.show_public_email then stores.public_email else null end as public_email,
  case when stores.show_public_phone then stores.public_phone else null end as public_phone,
  stores.website_url,
  stores.social_url,
  case when stores.show_npip then stores.npip_number else null end as npip_number,
  hero_media.image_url as hero_image_url,
  hero_media.alt_text as hero_image_alt_text,
  logo_media.image_url as logo_image_url,
  logo_media.alt_text as logo_image_alt_text
from public.stores
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' ||
      media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = stores.id
    and media_links.entity_type = 'store'
    and media_links.entity_id = stores.id
    and media_links.display_context = 'hero'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as hero_media on true
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' ||
      media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = stores.id
    and media_links.entity_type = 'store'
    and media_links.entity_id = stores.id
    and media_links.display_context = 'logo'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as logo_media on true
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null;

create view public.public_discoverable_storefronts
with (security_barrier = true)
as
select
  public_storefronts.store_id,
  public_storefronts.store_slug,
  public_storefronts.store_name,
  public_storefronts.store_tagline,
  public_storefronts.public_city,
  public_storefronts.public_state,
  public_storefronts.public_country,
  public_storefronts.about_text,
  public_storefronts.pickup_policy,
  storefront_discovery_settings.service_area_summary,
  public_storefronts.website_url,
  public_storefronts.social_url,
  public_storefronts.hero_image_url,
  public_storefronts.hero_image_alt_text,
  public_storefronts.logo_image_url,
  public_storefronts.logo_image_alt_text,
  trim(concat_ws(
    ' ',
    public_storefronts.store_name,
    public_storefronts.store_tagline,
    public_storefronts.public_city,
    public_storefronts.public_state,
    public_storefronts.public_country,
    public_storefronts.about_text,
    public_storefronts.pickup_policy,
    storefront_discovery_settings.service_area_summary,
    storefront_discovery_settings.search_keywords
  )) as search_text
from public.public_storefronts
join public.storefront_discovery_settings
  on storefront_discovery_settings.store_id = public_storefronts.store_id
where storefront_discovery_settings.is_discoverable = true;

create view public.public_discoverable_inventory
with (security_barrier = true)
as
select
  public_storefronts.store_id,
  public_storefronts.store_slug,
  public_storefronts.store_name,
  public_storefronts.store_tagline,
  public_storefronts.public_city,
  public_storefronts.public_state,
  public_storefronts.public_country,
  storefront_discovery_settings.service_area_summary,
  public_storefront_breed_inventory.species_id,
  public_storefront_breed_inventory.species_name,
  public_storefront_breed_inventory.species_slug,
  public_storefront_breed_inventory.seller_breed_profile_id,
  seller_breed_profiles.breed_id,
  public_storefront_breed_inventory.breed_display_name,
  public_storefront_breed_inventory.breed_description,
  breeds.category as breed_category,
  public_storefront_breed_inventory.listing_batch_id,
  public_storefront_breed_inventory.listing_batch_breed_id,
  public_storefront_breed_inventory.inventory_item_id,
  public_storefront_breed_inventory.inventory_type,
  public_storefront_breed_inventory.custom_inventory_label,
  public_storefront_breed_inventory.quantity_available,
  public_storefront_breed_inventory.availability_status,
  public_storefront_breed_inventory.available_date,
  public_storefront_breed_inventory.is_available_now,
  public_storefront_breed_inventory.unit_price,
  public_storefront_breed_inventory.featured_image_url,
  public_storefront_breed_inventory.featured_image_alt_text,
  trim(concat_ws(
    ' ',
    public_storefronts.store_name,
    public_storefronts.store_tagline,
    public_storefronts.public_city,
    public_storefronts.public_state,
    public_storefronts.public_country,
    storefront_discovery_settings.service_area_summary,
    storefront_discovery_settings.search_keywords,
    public_storefront_breed_inventory.species_name,
    public_storefront_breed_inventory.species_slug,
    public_storefront_breed_inventory.breed_display_name,
    public_storefront_breed_inventory.breed_description,
    breeds.category,
    public_storefront_breed_inventory.inventory_type,
    public_storefront_breed_inventory.custom_inventory_label
  )) as search_text
from public.public_storefront_breed_inventory
join public.public_storefronts
  on public_storefronts.store_id = public_storefront_breed_inventory.store_id
join public.storefront_discovery_settings
  on storefront_discovery_settings.store_id =
    public_storefront_breed_inventory.store_id
left join public.seller_breed_profiles
  on seller_breed_profiles.id =
    public_storefront_breed_inventory.seller_breed_profile_id
left join public.breeds
  on breeds.id = seller_breed_profiles.breed_id
where storefront_discovery_settings.is_discoverable = true;

create view public.public_breed_availability
with (security_barrier = true)
as
select
  species_id,
  species_name,
  species_slug,
  breed_display_name,
  breed_category,
  count(distinct store_id) as store_count,
  count(*) filter (
    where availability_status in ('available', 'limited_availability', 'coming_soon')
  ) as available_inventory_count,
  coalesce(sum(quantity_available) filter (
    where availability_status in ('available', 'limited_availability', 'coming_soon')
  ), 0) as total_quantity_available,
  min(available_date) filter (
    where availability_status in ('available', 'limited_availability', 'coming_soon')
  ) as next_available_date,
  min(unit_price) filter (
    where availability_status in ('available', 'limited_availability', 'coming_soon')
  ) as min_unit_price,
  bool_or(is_available_now) as has_available_now,
  (array_agg(featured_image_url) filter (
    where featured_image_url is not null
  ))[1] as sample_image_url
from public.public_discoverable_inventory
group by
  species_id,
  species_name,
  species_slug,
  breed_display_name,
  breed_category;

create view public.public_storefront_home
with (security_barrier = true)
as
with inventory_summary as (
  select
    public_storefront_inventory.store_id,
    count(*) as public_inventory_item_count,
    count(*) filter (
      where public_storefront_inventory.buyer_availability_code = 'ready_now'
    ) as ready_now_item_count,
    count(*) filter (
      where public_storefront_inventory.buyer_availability_code = 'reserve_now'
    ) as reserve_now_item_count,
    count(*) filter (
      where public_storefront_inventory.buyer_availability_code = 'sold_out'
    ) as sold_out_item_count,
    coalesce(sum(public_storefront_inventory.quantity_available), 0) as
      total_quantity_available,
    min(public_storefront_inventory.available_date) filter (
      where public_storefront_inventory.quantity_available > 0
    ) as next_available_date
  from public.public_storefront_inventory
  group by public_storefront_inventory.store_id
)
select
  public_storefronts.store_id,
  public_storefronts.store_slug,
  public_storefronts.store_name,
  public_storefronts.store_tagline,
  public_storefronts.public_city,
  public_storefronts.public_state,
  public_storefronts.public_country,
  public_storefronts.about_text,
  public_storefronts.pickup_policy,
  public_storefronts.cancellation_policy,
  public_storefronts.public_email,
  public_storefronts.public_phone,
  public_storefronts.website_url,
  public_storefronts.social_url,
  public_storefronts.npip_number,
  public_storefronts.hero_image_url,
  public_storefronts.hero_image_alt_text,
  public_storefronts.logo_image_url,
  public_storefronts.logo_image_alt_text,
  coalesce(inventory_summary.public_inventory_item_count, 0) as
    public_inventory_item_count,
  coalesce(inventory_summary.ready_now_item_count, 0) as ready_now_item_count,
  coalesce(inventory_summary.reserve_now_item_count, 0) as reserve_now_item_count,
  coalesce(inventory_summary.sold_out_item_count, 0) as sold_out_item_count,
  coalesce(inventory_summary.total_quantity_available, 0) as
    total_quantity_available,
  inventory_summary.next_available_date,
  coalesce(inventory_summary.public_inventory_item_count, 0) > 0 as
    has_public_inventory
from public.public_storefronts
left join inventory_summary
  on inventory_summary.store_id = public_storefronts.store_id;

create view public.public_storefront_item_detail
with (security_barrier = true)
as
select
  public_storefront_inventory.store_id,
  public_storefront_inventory.store_slug,
  public_storefronts.store_name,
  public_storefronts.pickup_policy,
  public_storefronts.cancellation_policy,
  public_storefront_inventory.species_id,
  public_storefront_inventory.species_name,
  public_storefront_inventory.species_slug,
  public_storefront_inventory.seller_breed_profile_id,
  public_storefront_inventory.breed_display_name,
  public_storefront_inventory.breed_description,
  public_storefront_inventory.listing_batch_id,
  public_storefront_inventory.listing_batch_breed_id,
  public_storefront_inventory.inventory_item_id,
  public_storefront_inventory.inventory_type,
  public_storefront_inventory.custom_inventory_label,
  public_storefront_inventory.quantity_available,
  public_storefront_inventory.buyer_availability_code,
  public_storefront_inventory.buyer_availability_label,
  public_storefront_inventory.available_date,
  public_storefront_inventory.is_available_now,
  public_storefront_inventory.can_checkout,
  public_storefront_inventory.unit_price,
  public_storefront_inventory.featured_image_url,
  public_storefront_inventory.featured_image_alt_text,
  public_storefront_inventory.batch_type,
  public_storefront_inventory.age_at_availability_days
from public.public_storefront_inventory
join public.public_storefronts
  on public_storefronts.store_id = public_storefront_inventory.store_id;

create view public.seller_store_defaults
with (security_barrier = true)
as
select
  stores.id as store_id,
  stores.pickup_location_text,
  stores.default_pickup_option_id,
  store_pickup_options.label as default_pickup_option_label,
  stores.communication_email,
  stores.order_notification_email,
  stores.currency,
  stores.updated_at,
  stores.pickup_method,
  stores.delivery_enabled,
  stores.pickup_address_line1,
  stores.pickup_address_line2,
  stores.pickup_city,
  stores.pickup_state,
  stores.pickup_postal_code,
  stores.pickup_country
from public.stores
left join public.store_pickup_options
  on store_pickup_options.id = stores.default_pickup_option_id
 and store_pickup_options.store_id = stores.id
where public.owns_store(stores.id) or public.is_admin();

create function public.get_seller_context()
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
as $function$
  select
    stores.id,
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
    ),
    stores.public_city,
    stores.public_state,
    stores.public_country,
    stores.about_text,
    stores.pickup_policy,
    stores.cancellation_policy,
    stores.public_email,
    stores.public_phone,
    stores.show_public_email,
    stores.show_public_phone,
    stores.website_url,
    stores.social_url,
    stores.npip_number,
    stores.show_npip,
    stores.order_notification_email,
    coalesce(seller_billing_status.plan_key, 'full_flock'),
    seller_billing_status.billing_plan,
    seller_billing_status.subscription_status,
    seller_billing_status.storefront_access_until,
    seller_billing_status.trial_ends_at,
    coalesce(seller_onboarding_state.profile_complete, false),
    coalesce(seller_onboarding_state.billing_complete, false),
    coalesce(seller_onboarding_state.terms_accepted, false),
    coalesce(seller_onboarding_state.first_listing_created, false),
    coalesce(seller_onboarding_state.ready_to_launch, false),
    seller_onboarding_state.launched_at,
    user_roles.role,
    public.is_admin(),
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
$function$;

create function public.seller_update_store_settings(
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
as $function$
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

  v_hero_subheading := case
    when p_settings ? 'hero_subheading'
      then nullif(trim(p_settings ->> 'hero_subheading'), '')
    else v_store.hero_subheading
  end;

  v_storefront_font_pair := case
    when p_settings ? 'storefront_font_pair'
      then nullif(trim(p_settings ->> 'storefront_font_pair'), '')
    else v_store.storefront_font_pair
  end;

  if v_storefront_font_pair in ('heritage', 'country_classic') then
    v_storefront_font_pair := 'farmstead';
  end if;

  v_storefront_heading_color := case
    when p_settings ? 'storefront_heading_color'
      then lower(nullif(trim(p_settings ->> 'storefront_heading_color'), ''))
    else v_store.storefront_heading_color
  end;

  v_storefront_text_color := case
    when p_settings ? 'storefront_text_color'
      then lower(nullif(trim(p_settings ->> 'storefront_text_color'), ''))
    else v_store.storefront_text_color
  end;

  v_storefront_top_menu_color := case
    when p_settings ? 'storefront_top_menu_color'
      then lower(nullif(trim(p_settings ->> 'storefront_top_menu_color'), ''))
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

  if v_store_name is null then
    raise exception 'Store name is required.';
  end if;

  if v_store_slug is null
    or v_store_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  then
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
    'farm_market',
    'modern_farm',
    'friendly_fields',
    'clean_simple'
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
    store_tagline = case
      when p_settings ? 'store_tagline'
        then nullif(trim(p_settings ->> 'store_tagline'), '')
      else stores.store_tagline
    end,
    hero_subheading = v_hero_subheading,
    storefront_font_pair = v_storefront_font_pair,
    storefront_heading_color = v_storefront_heading_color,
    storefront_text_color = v_storefront_text_color,
    storefront_top_menu_color = v_storefront_top_menu_color,
    store_slug = v_store_slug,
    storefront_mode = v_storefront_mode,
    storefront_enabled = case
      when p_settings ? 'storefront_enabled'
        then coalesce(
          (p_settings ->> 'storefront_enabled')::boolean,
          stores.storefront_enabled
        )
      else stores.storefront_enabled
    end,
    hatching_eggs_enabled = case
      when p_settings ? 'hatching_eggs_enabled'
        then coalesce(
          (p_settings ->> 'hatching_eggs_enabled')::boolean,
          stores.hatching_eggs_enabled
        )
      else stores.hatching_eggs_enabled
    end,
    equipment_supplies_enabled = case
      when p_settings ? 'equipment_supplies_enabled'
        then coalesce(
          (p_settings ->> 'equipment_supplies_enabled')::boolean,
          stores.equipment_supplies_enabled
        )
      else stores.equipment_supplies_enabled
    end,
    processed_poultry_enabled = case
      when p_settings ? 'processed_poultry_enabled'
        then coalesce(
          (p_settings ->> 'processed_poultry_enabled')::boolean,
          stores.processed_poultry_enabled
        )
      else stores.processed_poultry_enabled
    end,
    public_city = case
      when p_settings ? 'public_city'
        then nullif(trim(p_settings ->> 'public_city'), '')
      else stores.public_city
    end,
    public_state = case
      when p_settings ? 'public_state'
        then nullif(trim(p_settings ->> 'public_state'), '')
      else stores.public_state
    end,
    public_country = v_public_country,
    about_text = case
      when p_settings ? 'about_text'
        then nullif(trim(p_settings ->> 'about_text'), '')
      else stores.about_text
    end,
    pickup_policy = case
      when p_settings ? 'pickup_policy'
        then nullif(trim(p_settings ->> 'pickup_policy'), '')
      else stores.pickup_policy
    end,
    cancellation_policy = case
      when p_settings ? 'cancellation_policy'
        then nullif(trim(p_settings ->> 'cancellation_policy'), '')
      else stores.cancellation_policy
    end,
    other_policies = case
      when p_settings ? 'other_policies'
        then nullif(trim(p_settings ->> 'other_policies'), '')
      else stores.other_policies
    end,
    custom_policies = v_custom_policies,
    public_email = case
      when p_settings ? 'public_email'
        then lower(nullif(trim(p_settings ->> 'public_email'), ''))
      else stores.public_email
    end,
    public_phone = case
      when p_settings ? 'public_phone'
        then nullif(trim(p_settings ->> 'public_phone'), '')
      else stores.public_phone
    end,
    show_public_email = case
      when p_settings ? 'show_public_email'
        then coalesce(
          (p_settings ->> 'show_public_email')::boolean,
          stores.show_public_email
        )
      else stores.show_public_email
    end,
    show_public_phone = case
      when p_settings ? 'show_public_phone'
        then coalesce(
          (p_settings ->> 'show_public_phone')::boolean,
          stores.show_public_phone
        )
      else stores.show_public_phone
    end,
    website_url = case
      when p_settings ? 'website_url'
        then nullif(trim(p_settings ->> 'website_url'), '')
      else stores.website_url
    end,
    social_url = case
      when p_settings ? 'social_url'
        then nullif(trim(p_settings ->> 'social_url'), '')
      else stores.social_url
    end,
    npip_number = case
      when p_settings ? 'npip_number'
        then nullif(trim(p_settings ->> 'npip_number'), '')
      else stores.npip_number
    end,
    show_npip = case
      when p_settings ? 'show_npip'
        then coalesce(
          (p_settings ->> 'show_npip')::boolean,
          stores.show_npip
        )
      else stores.show_npip
    end,
    order_notification_email = case
      when p_settings ? 'order_notification_email'
        then lower(nullif(trim(p_settings ->> 'order_notification_email'), ''))
      else stores.order_notification_email
    end
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
$function$;


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
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_pickup_policy text;
  v_email_enabled boolean;
  v_text_enabled boolean;
  v_phone_enabled boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if p_pickup is null or jsonb_typeof(p_pickup) <> 'object' then
    raise exception 'Pickup details must be provided.';
  end if;

  v_pickup_policy := nullif(trim(p_pickup ->> 'pickup_policy'), '');
  v_email_enabled := coalesce((p_pickup ->> 'email_enabled')::boolean, false);
  v_text_enabled := coalesce((p_pickup ->> 'text_enabled')::boolean, false);
  v_phone_enabled := coalesce((p_pickup ->> 'phone_enabled')::boolean, false);

  if v_pickup_policy is null then
    raise exception 'Pickup policy is required.';
  end if;

  if not (v_email_enabled or v_text_enabled or v_phone_enabled) then
    raise exception 'Choose at least one buyer contact method.';
  end if;

  select s.*
  into v_store
  from public.stores as s
  left join public.user_roles as ur
    on ur.store_id = s.id
   and ur.user_id = v_user_id
   and ur.role in ('seller', 'staff')
  where s.owner_user_id = v_user_id
     or ur.store_id = s.id
  order by s.created_at asc
  limit 1
  for update of s;

  if v_store.id is null then
    raise exception 'Complete farm basics before saving pickup policy.';
  end if;

  if not exists (
    select 1
    from public.seller_onboarding_state as sos
    where sos.store_id = v_store.id
      and sos.profile_complete = true
      and sos.billing_complete = true
      and sos.categories_complete = true
  ) then
    raise exception 'Complete selling categories before saving pickup policy.';
  end if;

  update public.stores as s
  set
    pickup_policy = v_pickup_policy,
    buyer_contact_email_enabled = v_email_enabled,
    buyer_contact_text_enabled = v_text_enabled,
    buyer_contact_phone_enabled = v_phone_enabled,
    show_public_phone = (v_text_enabled or v_phone_enabled),
    updated_at = now()
  where s.id = v_store.id
  returning s.* into v_store;

  update public.seller_onboarding_state as sos
  set
    pickup_complete = true,
    updated_at = now()
  where sos.store_id = v_store.id;

  if not found then
    insert into public.seller_onboarding_state (
      store_id,
      profile_complete,
      categories_complete,
      pickup_complete,
      billing_complete,
      terms_accepted,
      first_listing_created,
      ready_to_launch
    )
    values (
      v_store.id,
      true,
      true,
      true,
      true,
      false,
      false,
      false
    );
  end if;

  return query
  select v_store.id, true, 6;
end;
$function$;

create function public.seller_update_store_defaults(
  p_store_id uuid,
  p_defaults jsonb
)
returns setof public.seller_store_defaults
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_allowed_keys text[] := array[
    'pickup_method',
    'pickup_location_text',
    'pickup_address_line1',
    'pickup_address_line2',
    'pickup_city',
    'pickup_state',
    'pickup_postal_code',
    'pickup_country',
    'default_pickup_option_id',
    'communication_email',
    'order_notification_email',
    'currency'
  ];
  v_unknown_keys text;
  v_default_pickup_option_id uuid;
  v_currency text;
  v_pickup_method text;
  v_pickup_country text;
begin
  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to update defaults for this store.';
  end if;

  if p_defaults is null or jsonb_typeof(p_defaults) <> 'object' then
    raise exception 'Defaults must be provided as an object.';
  end if;

  select string_agg(key, ', ' order by key)
  into v_unknown_keys
  from jsonb_object_keys(p_defaults) as key
  where key <> all (v_allowed_keys);

  if v_unknown_keys is not null then
    raise exception 'Unsupported store default fields: %', v_unknown_keys;
  end if;

  if p_defaults ? 'pickup_method' then
    v_pickup_method := nullif(trim(p_defaults ->> 'pickup_method'), '');

    if v_pickup_method not in ('notes', 'manual_options') then
      raise exception 'Pickup method must be notes or manual_options.';
    end if;
  end if;

  if p_defaults ? 'default_pickup_option_id'
    and nullif(trim(p_defaults ->> 'default_pickup_option_id'), '') is not null
  then
    v_default_pickup_option_id :=
      (p_defaults ->> 'default_pickup_option_id')::uuid;

    if not exists (
      select 1
      from public.store_pickup_options
      where store_pickup_options.id = v_default_pickup_option_id
        and store_pickup_options.store_id = p_store_id
        and store_pickup_options.is_active = true
    ) then
      raise exception 'Default pickup option is not available for this store.';
    end if;
  end if;

  if p_defaults ? 'currency' then
    v_currency := lower(nullif(trim(p_defaults ->> 'currency'), ''));

    if v_currency is null or v_currency !~ '^[a-z]{3}$' then
      raise exception 'Currency must be a three-letter ISO code.';
    end if;
  end if;

  if p_defaults ? 'pickup_country' then
    v_pickup_country := upper(coalesce(
      nullif(trim(p_defaults ->> 'pickup_country'), ''),
      'US'
    ));

    if v_pickup_country !~ '^[A-Z]{2}$' then
      raise exception 'Pickup country must be a two-letter country code.';
    end if;
  end if;

  update public.stores
  set
    pickup_method = case
      when p_defaults ? 'pickup_method' then v_pickup_method
      else stores.pickup_method
    end,
    pickup_location_text = case
      when p_defaults ? 'pickup_location_text'
        then nullif(trim(p_defaults ->> 'pickup_location_text'), '')
      else stores.pickup_location_text
    end,
    pickup_address_line1 = case
      when p_defaults ? 'pickup_address_line1'
        then nullif(trim(p_defaults ->> 'pickup_address_line1'), '')
      else stores.pickup_address_line1
    end,
    pickup_address_line2 = case
      when p_defaults ? 'pickup_address_line2'
        then nullif(trim(p_defaults ->> 'pickup_address_line2'), '')
      else stores.pickup_address_line2
    end,
    pickup_city = case
      when p_defaults ? 'pickup_city'
        then nullif(trim(p_defaults ->> 'pickup_city'), '')
      else stores.pickup_city
    end,
    pickup_state = case
      when p_defaults ? 'pickup_state'
        then upper(nullif(trim(p_defaults ->> 'pickup_state'), ''))
      else stores.pickup_state
    end,
    pickup_postal_code = case
      when p_defaults ? 'pickup_postal_code'
        then nullif(trim(p_defaults ->> 'pickup_postal_code'), '')
      else stores.pickup_postal_code
    end,
    pickup_country = case
      when p_defaults ? 'pickup_country' then v_pickup_country
      else stores.pickup_country
    end,
    default_pickup_option_id = case
      when p_defaults ? 'default_pickup_option_id'
        then v_default_pickup_option_id
      else stores.default_pickup_option_id
    end,
    communication_email = case
      when p_defaults ? 'communication_email'
        then lower(nullif(trim(p_defaults ->> 'communication_email'), ''))
      else stores.communication_email
    end,
    order_notification_email = case
      when p_defaults ? 'order_notification_email'
        then lower(nullif(trim(p_defaults ->> 'order_notification_email'), ''))
      else stores.order_notification_email
    end,
    currency = case
      when p_defaults ? 'currency' then v_currency
      else stores.currency
    end
  where stores.id = p_store_id;

  return query
  select *
  from public.seller_store_defaults
  where seller_store_defaults.store_id = p_store_id;
end;
$function$;

create function public.get_public_storefront_home(
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
as $function$
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
      count(*) filter (
        where public_inventory.buyer_availability_code = 'ready_now'
      ) as ready_now_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'reserve_now'
      ) as reserve_now_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'sold_out'
      ) as sold_out_item_count,
      coalesce(sum(public_inventory.quantity_available), 0)::bigint as
        total_quantity_available,
      min(public_inventory.available_date) filter (
        where public_inventory.quantity_available > 0
      ) as next_available_date
    from public_inventory
  )
  select
    target_store.id,
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
    target_store.pickup_method,
    case
      when target_store.show_public_email then target_store.public_email
      else null
    end,
    case
      when target_store.show_public_phone then target_store.public_phone
      else null
    end,
    target_store.website_url,
    target_store.social_url,
    case
      when target_store.show_npip then target_store.npip_number
      else null
    end,
    hero_media.image_url,
    hero_media.alt_text,
    hero_media.crop_metadata,
    coalesce(hero_media.hero_layout, 'full'),
    logo_media.image_url,
    logo_media.alt_text,
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
    order by
      media_links.is_featured desc,
      media_links.sort_order,
      media_links.created_at
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
    order by
      media_links.is_featured desc,
      media_links.sort_order,
      media_links.created_at
    limit 1
  ) as logo_media on true;
$function$;

create function public.get_seller_storefront_home_preview(
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
as $function$
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
      count(*) filter (
        where public_inventory.buyer_availability_code = 'ready_now'
      ) as ready_now_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'reserve_now'
      ) as reserve_now_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'sold_out'
      ) as sold_out_item_count,
      coalesce(sum(public_inventory.quantity_available), 0)::bigint as
        total_quantity_available,
      min(public_inventory.available_date) filter (
        where public_inventory.quantity_available > 0
      ) as next_available_date
    from public_inventory
  )
  select
    target_store.id,
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
    target_store.pickup_method,
    case
      when target_store.show_public_email then target_store.public_email
      else null
    end,
    case
      when target_store.show_public_phone then target_store.public_phone
      else null
    end,
    target_store.website_url,
    target_store.social_url,
    case
      when target_store.show_npip then target_store.npip_number
      else null
    end,
    hero_media.image_url,
    hero_media.alt_text,
    hero_media.crop_metadata,
    coalesce(hero_media.hero_layout, 'full'),
    logo_media.image_url,
    logo_media.alt_text,
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
    ),
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
    order by
      media_links.is_featured desc,
      media_links.sort_order,
      media_links.created_at
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
    order by
      media_links.is_featured desc,
      media_links.sort_order,
      media_links.created_at
    limit 1
  ) as logo_media on true;
$function$;

comment on function public.seller_save_onboarding_pickup(jsonb) is
'Saves the required seller pickup policy and buyer contact preferences during onboarding.';

comment on function public.seller_update_store_defaults(uuid, jsonb) is
'Updates seller-owned operational defaults without accepting the retired pickup_instructions field.';

grant execute on function public.get_seller_context() to authenticated;
grant execute on function public.seller_update_store_settings(uuid, jsonb)
  to authenticated;
grant execute on function public.seller_save_onboarding_pickup(jsonb)
  to authenticated;
grant execute on function public.seller_update_store_defaults(uuid, jsonb)
  to authenticated;
grant execute on function public.get_public_storefront_home(text)
  to anon, authenticated;
grant execute on function public.get_seller_storefront_home_preview(text)
  to authenticated;

grant select on public.public_discoverable_storefronts to anon, authenticated;
grant select on public.public_discoverable_inventory to anon, authenticated;
grant select on public.public_breed_availability to anon, authenticated;
grant select on public.public_storefront_home to anon, authenticated;
grant select on public.public_storefront_item_detail to anon, authenticated;
grant select on public.seller_store_defaults to authenticated;
