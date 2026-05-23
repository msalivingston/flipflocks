-- Group 16: Seller Storefront Configuration Foundation
--
-- Scope:
-- - Adds a seller-controlled storefront_enabled publication flag to stores.
-- - Updates public storefront visibility and checkout eligibility to require
--   storefront_enabled = true alongside the existing platform availability checks.
--
-- Rollout choice:
-- - Existing stores remain disabled by default. This makes public storefront
--   publication an explicit seller/admin action during beta instead of
--   automatically publishing stores that happen to have store_status = 'live'.
--
-- This group does not add:
-- - new storefront settings tables
-- - buyer_order_instructions or duplicate instruction fields
-- - seller onboarding workflow fields
-- - marketplace behavior
-- - buyer accounts
-- - messaging/reviews
-- - payment processing or deposits
-- - cart holds/reservations


alter table public.stores
add column storefront_enabled boolean not null default false;

comment on column public.stores.storefront_enabled is
'Seller-controlled public storefront publication toggle. A storefront is publicly available only when this is true and the existing platform availability checks also pass: store_status = live, storefront_mode hosted/embedded, and no admin hold.';


create or replace view public.public_storefronts
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
  stores.pickup_instructions,
  case
    when stores.show_public_email then stores.public_email
    else null
  end as public_email,
  case
    when stores.show_public_phone then stores.public_phone
    else null
  end as public_phone,
  stores.website_url,
  stores.social_url,
  case
    when stores.show_npip then stores.npip_number
    else null
  end as npip_number,
  hero_media.image_url as hero_image_url,
  hero_media.alt_text as hero_image_alt_text,
  logo_media.image_url as logo_image_url,
  logo_media.alt_text as logo_image_alt_text
from public.stores
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
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
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
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


comment on view public.public_storefronts is
'Official buyer-facing public store profile projection. Exposes only public-safe storefront fields and approved linked store hero/logo media. Public clients should use this view instead of querying stores directly. Storefront rows are visible only when the seller publication toggle and platform availability checks both pass.';


create or replace view public.public_listing_batches
with (security_barrier = true)
as
select
  listing_batches.id as listing_batch_id,
  listing_batches.store_id,
  stores.store_slug,
  listing_batches.species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  listing_batches.batch_type,
  listing_batches.available_date,
  case
    when listing_batches.batch_type = 'live_animals'
      then listing_batches.age_at_availability_days
    else null
  end as age_at_availability_days,
  listing_batches.available_date <= current_date as is_available_now,
  case
    when listing_batches.visibility_status = 'sold_out' then 'sold_out'
    when listing_batches.available_date > current_date then 'coming_soon'
    else 'available'
  end as batch_availability_status
from public.listing_batches
join public.stores
  on stores.id = listing_batches.store_id
join public.species
  on species.id = listing_batches.species_id
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and species.is_active = true
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batches.moderation_status = 'normal';


comment on view public.public_listing_batches is
'Official buyer-facing public batch projection. Supports storefront views without exposing internal batch labels, seller notes, moderation fields, or raw pricing internals. Batch rows are visible only when the seller publication toggle and platform availability checks both pass.';


create or replace view public.public_inventory_items
with (security_barrier = true)
as
select
  inventory_items.id as inventory_item_id,
  inventory_items.store_id,
  stores.store_slug,
  listing_batches.id as listing_batch_id,
  listing_batch_breeds.id as listing_batch_breed_id,
  seller_breed_profiles.id as seller_breed_profile_id,
  species.id as species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  seller_breed_profiles.display_name as breed_display_name,
  inventory_items.inventory_type,
  inventory_items.custom_inventory_label,
  inventory_items.quantity_available,
  case
    when listing_batches.visibility_status = 'sold_out'
      or inventory_items.quantity_available <= 0
      then 'sold_out'
    when listing_batches.available_date > current_date
      then 'coming_soon'
    when inventory_items.quantity_available <= 3
      then 'limited_availability'
    else 'available'
  end as availability_status,
  listing_batches.available_date,
  (
    listing_batches.available_date <= current_date
    and listing_batches.visibility_status <> 'sold_out'
    and inventory_items.quantity_available > 0
  ) as is_available_now,
  public.calculate_inventory_unit_price(
    listing_batches.base_price,
    inventory_items.price_override,
    listing_batches.auto_price_increase_enabled,
    listing_batches.auto_price_increase_amount,
    listing_batches.auto_price_increase_max_price,
    listing_batches.available_date
  ) as unit_price,
  inventory_items.sort_order
from public.inventory_items
join public.listing_batch_breeds
  on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
join public.listing_batches
  on listing_batches.id = inventory_items.listing_batch_id
join public.seller_breed_profiles
  on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
join public.stores
  on stores.id = inventory_items.store_id
join public.species
  on species.id = listing_batches.species_id
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and species.is_active = true
  and seller_breed_profiles.visibility_status = 'active'
  and seller_breed_profiles.moderation_status = 'normal'
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batches.moderation_status = 'normal'
  and listing_batch_breeds.visibility_status = 'active'
  and listing_batch_breeds.moderation_status = 'normal'
  and inventory_items.visibility_status = 'active'
  and inventory_items.moderation_status = 'normal'
  and (
    (
      listing_batches.batch_type = 'hatching_eggs'
      and inventory_items.inventory_type = 'hatching_eggs'
    )
    or (
      listing_batches.batch_type = 'live_animals'
      and inventory_items.inventory_type <> 'hatching_eggs'
    )
  );


comment on view public.public_inventory_items is
'Official buyer-facing public inventory projection. Exposes quantity_available, availability_status, and computed unit_price without exposing private seller notes, moderation fields, or raw pricing internals. unit_price is current_date-dependent through calculate_inventory_unit_price. Inventory rows are visible only when the seller publication toggle and platform availability checks both pass.';


create or replace view public.public_storefront_breed_inventory
with (security_barrier = true)
as
select
  stores.id as store_id,
  stores.store_slug,
  seller_breed_profiles.id as seller_breed_profile_id,
  species.id as species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  seller_breed_profiles.display_name as breed_display_name,
  seller_breed_profiles.seller_description as breed_description,
  listing_batches.id as listing_batch_id,
  listing_batch_breeds.id as listing_batch_breed_id,
  inventory_items.id as inventory_item_id,
  inventory_items.inventory_type,
  inventory_items.custom_inventory_label,
  inventory_items.quantity_available,
  case
    when listing_batches.visibility_status = 'sold_out'
      or inventory_items.quantity_available <= 0
      then 'sold_out'
    when listing_batches.available_date > current_date
      then 'coming_soon'
    when inventory_items.quantity_available <= 3
      then 'limited_availability'
    else 'available'
  end as availability_status,
  listing_batches.available_date,
  (
    listing_batches.available_date <= current_date
    and listing_batches.visibility_status <> 'sold_out'
    and inventory_items.quantity_available > 0
  ) as is_available_now,
  public.calculate_inventory_unit_price(
    listing_batches.base_price,
    inventory_items.price_override,
    listing_batches.auto_price_increase_enabled,
    listing_batches.auto_price_increase_amount,
    listing_batches.auto_price_increase_max_price,
    listing_batches.available_date
  ) as unit_price,
  coalesce(
    inventory_media.image_url,
    batch_breed_media.image_url,
    batch_media.image_url,
    breed_profile_media.image_url,
    store_media.image_url
  ) as featured_image_url,
  coalesce(
    inventory_media.alt_text,
    batch_breed_media.alt_text,
    batch_media.alt_text,
    breed_profile_media.alt_text,
    store_media.alt_text
  ) as featured_image_alt_text,
  listing_batch_breeds.sort_order as breed_sort_order,
  inventory_items.sort_order as inventory_sort_order
from public.inventory_items
join public.listing_batch_breeds
  on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
join public.listing_batches
  on listing_batches.id = inventory_items.listing_batch_id
join public.seller_breed_profiles
  on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
join public.stores
  on stores.id = inventory_items.store_id
join public.species
  on species.id = listing_batches.species_id
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = inventory_items.store_id
    and media_links.entity_type = 'inventory_item'
    and media_links.entity_id = inventory_items.id
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as inventory_media on true
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = listing_batch_breeds.store_id
    and media_links.entity_type = 'listing_batch_breed'
    and media_links.entity_id = listing_batch_breeds.id
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as batch_breed_media on true
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = listing_batches.store_id
    and media_links.entity_type = 'listing_batch'
    and media_links.entity_id = listing_batches.id
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as batch_media on true
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = seller_breed_profiles.store_id
    and media_links.entity_type = 'seller_breed_profile'
    and media_links.entity_id = seller_breed_profiles.id
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as breed_profile_media on true
left join lateral (
  select
    '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
    coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.store_id = stores.id
    and media_links.entity_type = 'store'
    and media_links.entity_id = stores.id
    and media_links.visibility_status = 'active'
    and media_assets.asset_status = 'active'
    and media_assets.moderation_status = 'approved'
  order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
  limit 1
) as store_media on true
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and species.is_active = true
  and seller_breed_profiles.visibility_status = 'active'
  and seller_breed_profiles.moderation_status = 'normal'
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batches.moderation_status = 'normal'
  and listing_batch_breeds.visibility_status = 'active'
  and listing_batch_breeds.moderation_status = 'normal'
  and inventory_items.visibility_status = 'active'
  and inventory_items.moderation_status = 'normal'
  and (
    (
      listing_batches.batch_type = 'hatching_eggs'
      and inventory_items.inventory_type = 'hatching_eggs'
    )
    or (
      listing_batches.batch_type = 'live_animals'
      and inventory_items.inventory_type <> 'hatching_eggs'
    )
  );


comment on view public.public_storefront_breed_inventory is
'Primary official buyer-facing storefront projection. One enriched public inventory row per item; frontend groups rows into breed-first storefront cards. Exposes buyer-safe fields only and applies featured image fallback from inventory item, listing batch breed, listing batch, seller breed profile, then store. unit_price is current_date-dependent through calculate_inventory_unit_price. Inventory rows are visible only when the seller publication toggle and platform availability checks both pass.';


create or replace function public.get_storefront_public_status(
  p_store_slug text
)
returns table (
  store_slug text,
  store_exists boolean,
  is_publicly_available boolean,
  message text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_normalized_slug text;
  v_store record;
  v_is_publicly_available boolean;
begin
  v_normalized_slug := lower(trim(p_store_slug));

  if v_normalized_slug is null
    or v_normalized_slug = ''
    or v_normalized_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    return query
    select
      v_normalized_slug,
      false,
      false,
      'not_found'::text;
    return;
  end if;

  select
    stores.store_slug,
    stores.storefront_enabled,
    stores.store_status,
    stores.storefront_mode,
    stores.admin_hold_reason
  into v_store
  from public.stores
  where stores.store_slug = v_normalized_slug
  limit 1;

  if not found then
    return query
    select
      v_normalized_slug,
      false,
      false,
      'not_found'::text;
    return;
  end if;

  v_is_publicly_available :=
    v_store.storefront_enabled = true
    and v_store.store_status = 'live'
    and v_store.storefront_mode in ('hosted', 'embedded')
    and v_store.admin_hold_reason is null;

  return query
  select
    v_store.store_slug::text,
    true,
    v_is_publicly_available,
    case
      when v_is_publicly_available then null::text
      else 'This store is currently unavailable.'::text
    end;
end;
$$;


comment on function public.get_storefront_public_status(text) is
'Public-safe hosted storefront status lookup. Distinguishes not found, unavailable, and publicly available stores without exposing internal status reasons such as seller publication state, admin hold details, or suspension context.';


revoke all on function public.get_storefront_public_status(text) from public;
grant execute on function public.get_storefront_public_status(text) to anon, authenticated;


create or replace function public.create_pay_at_pickup_order(
  p_store_id uuid,
  p_idempotency_key text,
  p_buyer_email text,
  p_buyer_first_name text,
  p_buyer_last_name text,
  p_items jsonb,
  p_buyer_phone text default null,
  p_business_name text default null,
  p_city text default null,
  p_state text default null,
  p_country text default null,
  p_delivery_address_line1 text default null,
  p_delivery_address_line2 text default null,
  p_delivery_city text default null,
  p_delivery_state text default null,
  p_delivery_postal_code text default null,
  p_delivery_country text default null,
  p_buyer_notes text default null,
  p_pickup_note text default null,
  p_buyer_ip_address inet default null,
  p_buyer_user_agent text default null
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  customer_id uuid,
  order_status text,
  payment_method text,
  payment_status text,
  subtotal_amount numeric(10, 2),
  tax_fee_amount numeric(10, 2),
  total_amount numeric(10, 2),
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idempotency_key text;
  v_buyer_email text;
  v_buyer_first_name text;
  v_buyer_last_name text;
  v_buyer_phone text;
  v_business_name text;
  v_city text;
  v_state text;
  v_country text;
  v_delivery_address_line1 text;
  v_delivery_address_line2 text;
  v_delivery_city text;
  v_delivery_state text;
  v_delivery_postal_code text;
  v_delivery_country text;
  v_buyer_notes text;
  v_pickup_note text;
  v_buyer_user_agent text;

  v_request_hash text;
  v_existing_idempotency public.order_idempotency_keys%rowtype;

  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_next_order_number integer;
  v_subtotal_amount numeric(10, 2);
  v_tax_fee_amount numeric(10, 2) := 0;
  v_total_amount numeric(10, 2);

  v_requested_item_count integer;
  v_locked_item_count integer;
begin
  v_idempotency_key := nullif(trim(p_idempotency_key), '');
  v_buyer_email := lower(nullif(trim(p_buyer_email), ''));
  v_buyer_first_name := nullif(trim(p_buyer_first_name), '');
  v_buyer_last_name := nullif(trim(p_buyer_last_name), '');
  v_buyer_phone := nullif(trim(p_buyer_phone), '');
  v_business_name := nullif(trim(p_business_name), '');
  v_delivery_address_line1 := nullif(trim(p_delivery_address_line1), '');
  v_delivery_address_line2 := nullif(trim(p_delivery_address_line2), '');
  v_delivery_city := nullif(trim(p_delivery_city), '');
  v_delivery_state := nullif(trim(p_delivery_state), '');
  v_delivery_postal_code := nullif(trim(p_delivery_postal_code), '');
  v_delivery_country := coalesce(nullif(trim(p_delivery_country), ''), 'US');
  v_city := nullif(trim(p_city), '');
  v_state := nullif(trim(p_state), '');
  v_country := coalesce(nullif(trim(p_country), ''), v_delivery_country);
  v_buyer_notes := nullif(trim(p_buyer_notes), '');
  v_pickup_note := nullif(trim(p_pickup_note), '');
  v_buyer_user_agent := nullif(trim(p_buyer_user_agent), '');

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if v_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  if length(v_idempotency_key) > 200 then
    raise exception 'Idempotency key must be 200 characters or fewer.';
  end if;

  if v_buyer_email is null then
    raise exception 'Buyer email is required.';
  end if;

  if v_buyer_first_name is null then
    raise exception 'Buyer first name is required.';
  end if;

  if v_buyer_last_name is null then
    raise exception 'Buyer last name is required.';
  end if;

  if v_buyer_phone is null then
    raise exception 'Buyer phone is required.';
  end if;

  if v_delivery_address_line1 is null then
    raise exception 'Buyer address line 1 is required.';
  end if;

  if v_delivery_city is null then
    raise exception 'Buyer city is required.';
  end if;

  if v_delivery_state is null then
    raise exception 'Buyer state is required.';
  end if;

  if v_delivery_postal_code is null then
    raise exception 'Buyer postal code is required.';
  end if;

  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one order item is required.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where jsonb_typeof(item) <> 'object'
       or not (item ? 'inventory_item_id')
       or not (item ? 'quantity')
       or item ->> 'inventory_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or item ->> 'quantity' !~ '^[0-9]+$'
       or (item ->> 'quantity')::integer <= 0
  ) then
    raise exception 'Each order item must include a valid inventory item ID and positive quantity.';
  end if;

  create temporary table pg_temp.requested_order_items (
    inventory_item_id uuid primary key,
    quantity integer not null check (quantity > 0)
  ) on commit drop;

  insert into pg_temp.requested_order_items (
    inventory_item_id,
    quantity
  )
  select
    (item ->> 'inventory_item_id')::uuid as inventory_item_id,
    sum((item ->> 'quantity')::integer) as quantity
  from jsonb_array_elements(p_items) as item
  group by (item ->> 'inventory_item_id')::uuid;

  if exists (
    select 1
    from pg_temp.requested_order_items
    where inventory_item_id is null
       or quantity <= 0
  ) then
    raise exception 'Each order item must include a valid inventory item ID and positive quantity.';
  end if;

  select count(*)
  into v_requested_item_count
  from pg_temp.requested_order_items;

  if v_requested_item_count = 0 then
    raise exception 'At least one valid order item is required.';
  end if;

  v_request_hash := encode(
    digest(
      jsonb_build_object(
        'store_id', p_store_id,
        'buyer_email', v_buyer_email,
        'buyer_first_name', v_buyer_first_name,
        'buyer_last_name', v_buyer_last_name,
        'buyer_phone', v_buyer_phone,
        'business_name', v_business_name,
        'city', v_city,
        'state', v_state,
        'country', v_country,
        'delivery_address_line1', v_delivery_address_line1,
        'delivery_address_line2', v_delivery_address_line2,
        'delivery_city', v_delivery_city,
        'delivery_state', v_delivery_state,
        'delivery_postal_code', v_delivery_postal_code,
        'delivery_country', v_delivery_country,
        'buyer_notes', v_buyer_notes,
        'pickup_note', v_pickup_note,
        'items', (
          select jsonb_agg(
            jsonb_build_object(
              'inventory_item_id', requested_order_items.inventory_item_id,
              'quantity', requested_order_items.quantity
            )
            order by requested_order_items.inventory_item_id
          )
          from pg_temp.requested_order_items
        )
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.order_idempotency_keys (
    store_id,
    idempotency_key,
    request_hash
  )
  values (
    p_store_id,
    v_idempotency_key,
    v_request_hash
  )
  on conflict (store_id, idempotency_key) do nothing;

  select *
  into v_existing_idempotency
  from public.order_idempotency_keys
  where order_idempotency_keys.store_id = p_store_id
    and order_idempotency_keys.idempotency_key = v_idempotency_key
  for update;

  if v_existing_idempotency.request_hash <> v_request_hash then
    raise exception 'Idempotency key was already used with a different request.';
  end if;

  if v_existing_idempotency.order_id is not null then
    return query
    select
      orders.id,
      orders.order_number,
      orders.store_id,
      orders.customer_id,
      orders.order_status,
      orders.payment_method,
      orders.payment_status,
      orders.subtotal_amount,
      orders.tax_fee_amount,
      orders.total_amount,
      orders.created_at
    from public.orders
    where orders.id = v_existing_idempotency.order_id;

    return;
  end if;

  if not exists (
    select 1
    from public.stores
    where stores.id = p_store_id
      and stores.storefront_enabled = true
      and stores.store_status = 'live'
      and stores.storefront_mode in ('hosted', 'embedded')
      and stores.admin_hold_reason is null
  ) then
    raise exception 'Store is not available for checkout.';
  end if;

  create temporary table pg_temp.locked_order_items (
    inventory_item_id uuid primary key,
    requested_quantity integer not null,
    store_id uuid not null,
    listing_batch_id uuid not null,
    listing_batch_breed_id uuid not null,
    seller_breed_profile_id uuid not null,
    species_id uuid not null,
    species_name text not null,
    species_slug text not null,
    breed_display_name text not null,
    breed_description text,
    inventory_type text not null,
    custom_inventory_label text,
    batch_type text not null,
    available_date date not null,
    age_at_availability_days integer,
    quantity_available integer not null,
    unit_price numeric(10, 2) not null,
    line_subtotal numeric(10, 2) not null
  ) on commit drop;

  insert into pg_temp.locked_order_items (
    inventory_item_id,
    requested_quantity,
    store_id,
    listing_batch_id,
    listing_batch_breed_id,
    seller_breed_profile_id,
    species_id,
    species_name,
    species_slug,
    breed_display_name,
    breed_description,
    inventory_type,
    custom_inventory_label,
    batch_type,
    available_date,
    age_at_availability_days,
    quantity_available,
    unit_price,
    line_subtotal
  )
  select
    inventory_items.id,
    requested_order_items.quantity,
    inventory_items.store_id,
    listing_batches.id,
    listing_batch_breeds.id,
    seller_breed_profiles.id,
    species.id,
    species.common_name,
    species.slug,
    seller_breed_profiles.display_name,
    seller_breed_profiles.seller_description,
    inventory_items.inventory_type,
    inventory_items.custom_inventory_label,
    listing_batches.batch_type,
    listing_batches.available_date,
    case
      when listing_batches.batch_type = 'live_animals'
        then listing_batches.age_at_availability_days
      else null
    end,
    inventory_items.quantity_available,
    public.calculate_inventory_unit_price(
      listing_batches.base_price,
      inventory_items.price_override,
      listing_batches.auto_price_increase_enabled,
      listing_batches.auto_price_increase_amount,
      listing_batches.auto_price_increase_max_price,
      listing_batches.available_date
    ),
    (
      public.calculate_inventory_unit_price(
        listing_batches.base_price,
        inventory_items.price_override,
        listing_batches.auto_price_increase_enabled,
        listing_batches.auto_price_increase_amount,
        listing_batches.auto_price_increase_max_price,
        listing_batches.available_date
      ) * requested_order_items.quantity
    )::numeric(10, 2)
  from (
    select *
    from pg_temp.requested_order_items
    order by inventory_item_id
  ) as requested_order_items
  join public.inventory_items
    on inventory_items.id = requested_order_items.inventory_item_id
  join public.listing_batches
    on listing_batches.id = inventory_items.listing_batch_id
  join public.listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
  join public.seller_breed_profiles
    on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
  join public.species
    on species.id = listing_batches.species_id
  where inventory_items.id in (
    select requested_order_items.inventory_item_id
    from pg_temp.requested_order_items
    order by requested_order_items.inventory_item_id
  )
  for update of inventory_items;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_order_items;

  if v_locked_item_count <> v_requested_item_count then
    raise exception 'One or more inventory items were not found.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    where store_id <> p_store_id
  ) then
    raise exception 'One or more inventory items do not belong to this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    join public.inventory_items
      on inventory_items.id = locked_order_items.inventory_item_id
    join public.listing_batches
      on listing_batches.id = locked_order_items.listing_batch_id
    join public.listing_batch_breeds
      on listing_batch_breeds.id = locked_order_items.listing_batch_breed_id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = locked_order_items.seller_breed_profile_id
    join public.species
      on species.id = locked_order_items.species_id
    where inventory_items.store_id <> p_store_id
       or listing_batches.store_id <> p_store_id
       or listing_batch_breeds.store_id <> p_store_id
       or seller_breed_profiles.store_id <> p_store_id
       or listing_batch_breeds.listing_batch_id <> listing_batches.id
       or inventory_items.listing_batch_id <> listing_batches.id
       or inventory_items.listing_batch_breed_id <> listing_batch_breeds.id
       or seller_breed_profiles.species_id <> listing_batches.species_id
       or species.id <> listing_batches.species_id
  ) then
    raise exception 'Invalid inventory relationship for checkout.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    join public.inventory_items
      on inventory_items.id = locked_order_items.inventory_item_id
    join public.listing_batches
      on listing_batches.id = locked_order_items.listing_batch_id
    join public.listing_batch_breeds
      on listing_batch_breeds.id = locked_order_items.listing_batch_breed_id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = locked_order_items.seller_breed_profile_id
    join public.species
      on species.id = locked_order_items.species_id
    where inventory_items.visibility_status <> 'active'
       or inventory_items.moderation_status <> 'normal'
       or listing_batches.visibility_status <> 'active'
       or listing_batches.moderation_status <> 'normal'
       or listing_batch_breeds.visibility_status <> 'active'
       or listing_batch_breeds.moderation_status <> 'normal'
       or seller_breed_profiles.visibility_status <> 'active'
       or seller_breed_profiles.moderation_status <> 'normal'
       or species.is_active <> true
  ) then
    raise exception 'One or more inventory items are not available for checkout.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    where quantity_available < requested_quantity
  ) then
    raise exception 'Insufficient inventory quantity available.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    where (
      batch_type = 'hatching_eggs'
      and inventory_type <> 'hatching_eggs'
    )
    or (
      batch_type = 'live_animals'
      and inventory_type = 'hatching_eggs'
    )
  ) then
    raise exception 'Invalid inventory type for listing batch type.';
  end if;

  select coalesce(sum(line_subtotal), 0)::numeric(10, 2)
  into v_subtotal_amount
  from pg_temp.locked_order_items;

  v_total_amount := v_subtotal_amount + v_tax_fee_amount;

  perform pg_advisory_xact_lock(
    hashtextextended(p_store_id::text || ':' || v_buyer_email, 0)
  );

  select customers.id
  into v_customer_id
  from public.customers
  where customers.store_id = p_store_id
    and lower(trim(customers.email)) = v_buyer_email
  order by customers.created_at, customers.id
  limit 1;

  if v_customer_id is null then
    insert into public.customers (
      store_id,
      email,
      first_name,
      last_name,
      phone,
      business_name,
      city,
      state,
      country,
      delivery_address_line1,
      delivery_address_line2,
      delivery_city,
      delivery_state,
      delivery_postal_code,
      delivery_country
    )
    values (
      p_store_id,
      v_buyer_email,
      v_buyer_first_name,
      v_buyer_last_name,
      v_buyer_phone,
      v_business_name,
      v_city,
      v_state,
      v_country,
      v_delivery_address_line1,
      v_delivery_address_line2,
      v_delivery_city,
      v_delivery_state,
      v_delivery_postal_code,
      v_delivery_country
    )
    returning id into v_customer_id;
  else
    update public.customers
    set
      first_name = v_buyer_first_name,
      last_name = v_buyer_last_name,
      phone = v_buyer_phone,
      business_name = v_business_name,
      city = v_city,
      state = v_state,
      country = v_country,
      delivery_address_line1 = v_delivery_address_line1,
      delivery_address_line2 = v_delivery_address_line2,
      delivery_city = v_delivery_city,
      delivery_state = v_delivery_state,
      delivery_postal_code = v_delivery_postal_code,
      delivery_country = v_delivery_country
    where customers.id = v_customer_id;
  end if;

  insert into public.order_number_counters (
    store_id
  )
  values (
    p_store_id
  )
  on conflict (store_id) do nothing;

  update public.order_number_counters
  set last_order_number = last_order_number + 1
  where order_number_counters.store_id = p_store_id
  returning last_order_number into v_next_order_number;

  v_order_number := v_next_order_number::text;

  insert into public.orders (
    store_id,
    customer_id,
    order_number,
    order_source,
    order_status,
    payment_method,
    payment_status,
    buyer_email_snapshot,
    buyer_first_name_snapshot,
    buyer_last_name_snapshot,
    buyer_phone_snapshot,
    buyer_address_line1_snapshot,
    buyer_address_line2_snapshot,
    buyer_city_snapshot,
    buyer_state_snapshot,
    buyer_postal_code_snapshot,
    buyer_country_snapshot,
    buyer_notes,
    pickup_note,
    subtotal_amount,
    tax_fee_label_snapshot,
    tax_fee_rate_snapshot,
    tax_fee_amount,
    total_amount,
    buyer_ip_address,
    buyer_user_agent
  )
  values (
    p_store_id,
    v_customer_id,
    v_order_number,
    'storefront',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    v_buyer_email,
    v_buyer_first_name,
    v_buyer_last_name,
    v_buyer_phone,
    v_delivery_address_line1,
    v_delivery_address_line2,
    v_delivery_city,
    v_delivery_state,
    v_delivery_postal_code,
    v_delivery_country,
    v_buyer_notes,
    v_pickup_note,
    v_subtotal_amount,
    null,
    null,
    v_tax_fee_amount,
    v_total_amount,
    p_buyer_ip_address,
    v_buyer_user_agent
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id,
    store_id,
    inventory_item_id,
    listing_batch_id,
    listing_batch_breed_id,
    seller_breed_profile_id,
    species_id,
    species_name_snapshot,
    species_slug_snapshot,
    breed_display_name_snapshot,
    breed_description_snapshot,
    inventory_type_snapshot,
    custom_inventory_label_snapshot,
    batch_type_snapshot,
    available_date_snapshot,
    age_at_availability_days_snapshot,
    unit_price_snapshot,
    quantity,
    line_subtotal
  )
  select
    v_order_id,
    p_store_id,
    locked_order_items.inventory_item_id,
    locked_order_items.listing_batch_id,
    locked_order_items.listing_batch_breed_id,
    locked_order_items.seller_breed_profile_id,
    locked_order_items.species_id,
    locked_order_items.species_name,
    locked_order_items.species_slug,
    locked_order_items.breed_display_name,
    locked_order_items.breed_description,
    locked_order_items.inventory_type,
    locked_order_items.custom_inventory_label,
    locked_order_items.batch_type,
    locked_order_items.available_date,
    locked_order_items.age_at_availability_days,
    locked_order_items.unit_price,
    locked_order_items.requested_quantity,
    locked_order_items.line_subtotal
  from pg_temp.locked_order_items
  order by locked_order_items.inventory_item_id;

  update public.inventory_items
  set quantity_available = inventory_items.quantity_available - locked_order_items.requested_quantity
  from pg_temp.locked_order_items
  where inventory_items.id = locked_order_items.inventory_item_id;

  update public.order_idempotency_keys
  set order_id = v_order_id
  where order_idempotency_keys.store_id = p_store_id
    and order_idempotency_keys.idempotency_key = v_idempotency_key;

  return query
  select
    orders.id,
    orders.order_number,
    orders.store_id,
    orders.customer_id,
    orders.order_status,
    orders.payment_method,
    orders.payment_status,
    orders.subtotal_amount,
    orders.tax_fee_amount,
    orders.total_amount,
    orders.created_at
  from public.orders
  where orders.id = v_order_id;
end;
$$;


comment on function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text
) is
'Trusted pay-at-pickup storefront order creation RPC. Validates seller storefront publication status, platform storefront availability, inventory eligibility, reuses or creates a customer by normalized email, generates a numeric store-scoped order number, inserts trusted order snapshots, decrements inventory atomically, and protects retries with idempotency keys.';


revoke all on function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text
) from public;

grant execute on function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text
) to anon, authenticated;
