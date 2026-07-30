-- Make unrecognized or unavailable seller plan state fail closed to Coop.

alter table public.seller_billing_status
alter column plan_key set default 'small_flock';

create or replace function public.get_store_plan_key(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (
      select seller_billing_status.plan_key
      from public.seller_billing_status
      where seller_billing_status.store_id = p_store_id
      limit 1
    ) = 'full_flock' then 'full_flock'
    else 'small_flock'
  end;
$$;

comment on function public.get_store_plan_key(uuid) is
'Returns the effective store plan. Only full_flock grants Market capabilities; missing, null, malformed, and unknown values fail closed to small_flock (Coop).';

revoke all on function public.get_store_plan_key(uuid) from public;
grant execute on function public.get_store_plan_key(uuid) to authenticated;

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
    public.get_store_plan_key(stores.id),
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

revoke all on function public.get_seller_context() from public;
grant execute on function public.get_seller_context() to authenticated;

create or replace function public.seller_save_onboarding_categories(
  p_categories jsonb
)
returns table (
  store_id uuid,
  hatching_eggs_enabled boolean,
  processed_poultry_enabled boolean,
  equipment_supplies_enabled boolean,
  categories_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_plan_key text;
  v_hatching_eggs_enabled boolean;
  v_processed_poultry_enabled boolean;
  v_equipment_supplies_enabled boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if p_categories is null or jsonb_typeof(p_categories) <> 'object' then
    raise exception 'Selling categories must be provided.';
  end if;

  v_hatching_eggs_enabled := coalesce((p_categories ->> 'hatching_eggs')::boolean, false);
  v_processed_poultry_enabled := coalesce((p_categories ->> 'poultry_products')::boolean, false);
  v_equipment_supplies_enabled := coalesce((p_categories ->> 'equipment_supplies')::boolean, false);

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
    raise exception 'Complete farm basics before choosing selling categories.';
  end if;

  v_plan_key := public.get_store_plan_key(v_store.id);

  if not exists (
    select 1
    from public.seller_onboarding_state as sos
    where sos.store_id = v_store.id
      and sos.profile_complete = true
      and sos.billing_complete = true
  ) then
    raise exception 'Choose a plan before choosing selling categories.';
  end if;

  if v_plan_key = 'small_flock'
    and (
      v_hatching_eggs_enabled
      or v_processed_poultry_enabled
      or v_equipment_supplies_enabled
    ) then
    raise exception 'This category is included with Market.';
  end if;

  update public.stores as s
  set
    hatching_eggs_enabled = v_hatching_eggs_enabled,
    processed_poultry_enabled = v_processed_poultry_enabled,
    equipment_supplies_enabled = v_equipment_supplies_enabled,
    updated_at = now()
  where s.id = v_store.id
  returning s.* into v_store;

  update public.seller_onboarding_state as sos
  set
    categories_complete = true,
    updated_at = now()
  where sos.store_id = v_store.id;

  if not found then
    insert into public.seller_onboarding_state (
      store_id,
      profile_complete,
      categories_complete,
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
      false,
      false,
      false
    );
  end if;

  return query
  select
    v_store.id,
    v_store.hatching_eggs_enabled,
    v_store.processed_poultry_enabled,
    v_store.equipment_supplies_enabled,
    true,
    5;
end;
$function$;

revoke all on function public.seller_save_onboarding_categories(jsonb) from public;
grant execute on function public.seller_save_onboarding_categories(jsonb) to authenticated;

create or replace function public.validate_hatching_eggs_module_enabled(
  p_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_enabled boolean;
begin
  if public.get_store_plan_key(p_store_id) <> 'full_flock' then
    raise exception 'Hatching egg listings are included with Market.';
  end if;

  select stores.hatching_eggs_enabled
  into v_enabled
  from public.stores
  where stores.id = p_store_id;

  if v_enabled is distinct from true then
    raise exception 'Hatching Eggs is not enabled for this store.';
  end if;
end;
$function$;

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
  coalesce(seller_breed_profiles.bird_type, breeds.bird_type) as breed_bird_type,
  coalesce(seller_breed_profiles.egg_color, breeds.egg_color) as breed_egg_color,
  coalesce(
    seller_breed_profiles.annual_egg_production,
    breeds.annual_egg_production
  ) as breed_annual_egg_production
from public.public_storefront_breed_inventory
join public.stores
  on stores.id = public_storefront_breed_inventory.store_id
join public.listing_batches
  on listing_batches.id = public_storefront_breed_inventory.listing_batch_id
left join public.seller_breed_profiles
  on seller_breed_profiles.id = public_storefront_breed_inventory.seller_breed_profile_id
left join public.breeds
  on breeds.id = seller_breed_profiles.breed_id
where (
    coalesce(public_storefront_breed_inventory.batch_type, '') <> 'hatching_eggs'
    and coalesce(public_storefront_breed_inventory.inventory_type, '') <> 'hatching_eggs'
  )
  or (
    stores.hatching_eggs_enabled = true
    and public.get_store_plan_key(stores.id) = 'full_flock'
  );

comment on view public.public_storefront_inventory is
'Buyer-facing storefront inventory projection for V1 UI. Reuses the official public storefront inventory layer, hides hatching egg rows when the seller disables that public module, exposes public-safe breed facts plus origin_date, batch_type, and age_at_availability_days for buyer option labels, and translates availability to the approved buyer labels: Ready now, Reserve now, and Sold out.';

grant select on public.public_storefront_inventory to anon, authenticated;

create or replace view public.public_storefront_equipment_inventory
with (security_barrier = true)
as
select
  equipment_inventory_items.store_id,
  stores.store_slug,
  equipment_inventory_items.id as equipment_inventory_item_id,
  'equipment_inventory'::text as item_type,
  equipment_inventory_items.item_name,
  equipment_inventory_items.category,
  equipment_inventory_items.condition,
  equipment_inventory_items.description,
  equipment_inventory_items.quantity_available,
  case
    when equipment_inventory_items.quantity_available <= 0 then 'sold_out'
    else 'ready_now'
  end as buyer_availability_code,
  case
    when equipment_inventory_items.quantity_available <= 0 then 'Sold out'
    else 'Available'
  end as buyer_availability_label,
  (
    equipment_inventory_items.quantity_available > 0
    and equipment_inventory_items.available_date <= current_date
  ) as can_checkout,
  equipment_inventory_items.price as unit_price,
  equipment_media.image_url as featured_image_url,
  equipment_media.alt_text as featured_image_alt_text,
  equipment_inventory_items.updated_at,
  equipment_inventory_items.available_date
from public.equipment_inventory_items
join public.stores
  on stores.id = equipment_inventory_items.store_id
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = equipment_inventory_items.store_id
    and media_links.entity_type = 'equipment_inventory_item'
    and media_links.entity_id = equipment_inventory_items.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as equipment_media on true
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and public.get_store_plan_key(stores.id) = 'full_flock'
  and stores.equipment_supplies_enabled = true
  and equipment_inventory_items.visibility_status = 'active'
  and equipment_inventory_items.moderation_status = 'normal'
  and equipment_inventory_items.quantity_available > 0
  and equipment_inventory_items.available_date <= current_date;

comment on view public.public_storefront_equipment_inventory is
'Buyer-facing public Equipment & Supplies inventory projection. Exposes active in-stock equipment rows only when the seller has enabled the public Equipment & Supplies module and the item is available today or earlier.';

grant select on public.public_storefront_equipment_inventory to anon, authenticated;

create or replace view public.public_storefront_processed_poultry_inventory
with (security_barrier = true)
as
select
  processed_items.store_id,
  stores.store_slug,
  processed_items.id as processed_poultry_inventory_item_id,
  'processed_poultry_inventory'::text as item_type,
  processed_items.product_name,
  processed_items.poultry_type,
  processed_items.product_type,
  processed_items.package_size,
  processed_items.description,
  processed_items.quantity_available,
  case
    when processed_items.quantity_available <= 0 then 'sold_out'
    else 'ready_now'
  end as buyer_availability_code,
  case
    when processed_items.quantity_available <= 0 then 'Sold out'
    else 'Available'
  end as buyer_availability_label,
  (
    processed_items.quantity_available > 0
    and processed_items.available_date <= current_date
  ) as can_checkout,
  processed_items.price as unit_price,
  processed_media.image_url as featured_image_url,
  processed_media.alt_text as featured_image_alt_text,
  processed_items.updated_at,
  processed_items.species_id,
  coalesce(species.common_name, processed_items.poultry_type) as species_name,
  species.slug as species_slug,
  processed_items.available_date
from public.processed_poultry_inventory_items as processed_items
join public.stores as stores
  on stores.id = processed_items.store_id
left join public.species as species
  on species.id = processed_items.species_id
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links as media_links
  join public.media_assets as media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = processed_items.store_id
    and media_links.entity_type = 'processed_poultry_inventory_item'
    and media_links.entity_id = processed_items.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as processed_media on true
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and public.get_store_plan_key(stores.id) = 'full_flock'
  and stores.processed_poultry_enabled = true
  and processed_items.visibility_status = 'active'
  and processed_items.moderation_status = 'normal'
  and processed_items.quantity_available > 0
  and processed_items.available_date <= current_date;

comment on view public.public_storefront_processed_poultry_inventory is
'Buyer-facing public Processed Poultry inventory projection. Exposes active in-stock processed poultry rows only when the seller has enabled the public Processed Poultry module and the item is available today or earlier.';

grant select on public.public_storefront_processed_poultry_inventory to anon, authenticated;

create or replace view public.public_storefront_hatching_egg_inventory
with (security_barrier = true)
as
select
  hatching_items.store_id,
  stores.store_slug,
  hatching_items.id as hatching_egg_inventory_item_id,
  'hatching_egg_inventory'::text as item_type,
  (
    'he-' ||
    md5(
      hatching_items.store_id::text ||
      ':' ||
      lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g'))
    )
  ) as hatching_egg_product_id,
  lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g')) as normalized_item_name,
  hatching_items.item_name,
  hatching_items.species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  hatching_items.description,
  hatching_items.quantity_available,
  case
    when hatching_items.quantity_available <= 0 then 'sold_out'
    when hatching_items.available_date > current_date then 'reserve_now'
    else 'ready_now'
  end as buyer_availability_code,
  case
    when hatching_items.quantity_available <= 0 then 'Sold out'
    when hatching_items.available_date > current_date then 'Reserve now'
    else 'Ready now'
  end as buyer_availability_label,
  hatching_items.available_date,
  hatching_items.available_date <= current_date as is_available_now,
  (
    hatching_items.quantity_available >=
    coalesce(hatching_items.minimum_order_quantity, 1)
  ) as can_checkout,
  hatching_items.price as unit_price,
  hatching_items.minimum_order_quantity,
  hatching_media.image_url as featured_image_url,
  hatching_media.alt_text as featured_image_alt_text,
  hatching_items.created_at,
  hatching_items.updated_at
from public.hatching_egg_inventory_items as hatching_items
join public.stores as stores
  on stores.id = hatching_items.store_id
join public.species as species
  on species.id = hatching_items.species_id
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links as media_links
  join public.media_assets as media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = hatching_items.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = hatching_items.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as hatching_media on true
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and stores.hatching_eggs_enabled = true
  and public.get_store_plan_key(stores.id) = 'full_flock'
  and hatching_items.visibility_status = 'active'
  and hatching_items.moderation_status = 'normal'
  and hatching_items.archived_at is null
  and species.is_active = true
  and hatching_items.quantity_available > 0;

comment on view public.public_storefront_hatching_egg_inventory is
'Buyer-facing public standalone Hatching Eggs projection. Active, in-stock rows are grouped by normalized item_name in application code. can_checkout indicates whether current stock can satisfy the row minimum; requested quantities remain subject to checkout summary and transactional validation.';

grant select on public.public_storefront_hatching_egg_inventory to anon, authenticated;

create or replace view public.public_storefront_media_gallery
with (security_barrier = true)
as
select
  stores.store_slug,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.width_px,
  media_assets.height_px,
  media_links.crop_metadata
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.stores
  on stores.id = media_links.store_id
where media_links.entity_type = 'store'
  and media_links.entity_id = stores.id
  and media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
union all
select
  stores.store_slug,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.width_px,
  media_assets.height_px,
  media_links.crop_metadata
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.seller_breed_profiles
  on seller_breed_profiles.id = media_links.entity_id
 and media_links.entity_type = 'seller_breed_profile'
join public.stores
  on stores.id = seller_breed_profiles.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and seller_breed_profiles.visibility_status = 'active'
  and seller_breed_profiles.moderation_status = 'normal'
union all
select
  stores.store_slug,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.width_px,
  media_assets.height_px,
  media_links.crop_metadata
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.inventory_items
  on inventory_items.id = media_links.entity_id
 and media_links.entity_type = 'inventory_item'
join public.listing_batch_breeds
  on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
join public.seller_breed_profiles
  on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
join public.listing_batches
  on listing_batches.id = inventory_items.listing_batch_id
join public.stores
  on stores.id = inventory_items.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batch_breeds.visibility_status = 'active'
  and seller_breed_profiles.visibility_status = 'active'
  and inventory_items.visibility_status = 'active'
union all
select
  stores.store_slug,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.width_px,
  media_assets.height_px,
  media_links.crop_metadata
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.equipment_inventory_items
  on equipment_inventory_items.id = media_links.entity_id
 and media_links.entity_type = 'equipment_inventory_item'
join public.stores
  on stores.id = equipment_inventory_items.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and public.get_store_plan_key(stores.id) = 'full_flock'
  and equipment_inventory_items.visibility_status = 'active'
  and equipment_inventory_items.moderation_status = 'normal'
  and equipment_inventory_items.quantity_available > 0
union all
select
  stores.store_slug,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.width_px,
  media_assets.height_px,
  media_links.crop_metadata
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.hatching_egg_inventory_items
  on hatching_egg_inventory_items.id = media_links.entity_id
 and media_links.entity_type = 'hatching_egg_inventory_item'
join public.stores
  on stores.id = hatching_egg_inventory_items.store_id
 and stores.id = media_links.store_id
where media_links.display_context = 'gallery'
  and media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and stores.hatching_eggs_enabled = true
  and public.get_store_plan_key(stores.id) = 'full_flock'
  and hatching_egg_inventory_items.visibility_status = 'active'
  and hatching_egg_inventory_items.moderation_status = 'normal'
  and hatching_egg_inventory_items.quantity_available > 0;

comment on view public.public_storefront_media_gallery is
'Buyer-facing public media gallery for active store branding, active seller breed profiles, active inventory items, active equipment, and active hatching egg inventory. Legacy listing-batch media owners are excluded.';

grant select on public.public_storefront_media_gallery to anon, authenticated;
