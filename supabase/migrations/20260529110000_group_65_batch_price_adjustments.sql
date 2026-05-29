-- Group 65: Batch Age-Based Price Adjustment
--
-- Adds generic batch-level price adjustment fields while keeping the earlier
-- auto_price_increase_* columns for compatibility. The new generic fields are
-- the active source of truth for current price calculation.

alter table public.listing_batches
  add column if not exists auto_price_adjustment_enabled boolean not null default false,
  add column if not exists price_adjustment_direction text,
  add column if not exists price_adjustment_amount numeric(10, 2),
  add column if not exists price_adjustment_interval_weeks integer,
  add column if not exists price_adjustment_max_price numeric(10, 2),
  add column if not exists price_adjustment_min_price numeric(10, 2);

update public.listing_batches
set
  auto_price_adjustment_enabled = true,
  price_adjustment_direction = 'increase',
  price_adjustment_amount = auto_price_increase_amount,
  price_adjustment_interval_weeks = 1,
  price_adjustment_max_price = auto_price_increase_max_price,
  price_adjustment_min_price = null
where auto_price_increase_enabled = true
  and auto_price_increase_amount is not null
  and auto_price_adjustment_enabled = false;

update public.listing_batches
set
  price_adjustment_direction = null,
  price_adjustment_amount = null,
  price_adjustment_interval_weeks = null,
  price_adjustment_max_price = null,
  price_adjustment_min_price = null
where auto_price_adjustment_enabled = false;

alter table public.listing_batches
  drop constraint if exists listing_batches_price_adjustment_direction_check,
  drop constraint if exists listing_batches_price_adjustment_amount_positive_check,
  drop constraint if exists listing_batches_price_adjustment_interval_positive_check,
  drop constraint if exists listing_batches_price_adjustment_enabled_fields_check,
  drop constraint if exists listing_batches_price_adjustment_direction_cap_check,
  drop constraint if exists listing_batches_price_adjustment_caps_nonnegative_check;

alter table public.listing_batches
  add constraint listing_batches_price_adjustment_direction_check check (
    price_adjustment_direction is null
    or price_adjustment_direction in ('increase', 'decrease')
  ),
  add constraint listing_batches_price_adjustment_amount_positive_check check (
    price_adjustment_amount is null
    or price_adjustment_amount > 0
  ),
  add constraint listing_batches_price_adjustment_interval_positive_check check (
    price_adjustment_interval_weeks is null
    or price_adjustment_interval_weeks > 0
  ),
  add constraint listing_batches_price_adjustment_enabled_fields_check check (
    (
      auto_price_adjustment_enabled = false
      and price_adjustment_direction is null
      and price_adjustment_amount is null
      and price_adjustment_interval_weeks is null
      and price_adjustment_max_price is null
      and price_adjustment_min_price is null
    )
    or (
      auto_price_adjustment_enabled = true
      and price_adjustment_direction is not null
      and price_adjustment_amount is not null
      and price_adjustment_interval_weeks is not null
    )
  ),
  add constraint listing_batches_price_adjustment_direction_cap_check check (
    (
      coalesce(auto_price_adjustment_enabled, false) = false
      and price_adjustment_max_price is null
      and price_adjustment_min_price is null
    )
    or (
      price_adjustment_direction = 'increase'
      and price_adjustment_min_price is null
    )
    or (
      price_adjustment_direction = 'decrease'
      and price_adjustment_max_price is null
    )
  ),
  add constraint listing_batches_price_adjustment_caps_nonnegative_check check (
    (price_adjustment_max_price is null or price_adjustment_max_price >= 0)
    and (price_adjustment_min_price is null or price_adjustment_min_price >= 0)
  );

comment on column public.listing_batches.auto_price_adjustment_enabled is
'Active Group 65 flag for optional batch-level automatic price adjustment. Replaces increase-only calculation while old auto_price_increase_* columns remain for compatibility.';

comment on column public.listing_batches.price_adjustment_direction is
'Batch-level automatic price adjustment direction: increase or decrease.';

comment on column public.listing_batches.price_adjustment_amount is
'Flat dollar amount applied per completed interval after available_date when automatic price adjustment is enabled.';

comment on column public.listing_batches.price_adjustment_interval_weeks is
'Number of whole weeks per completed automatic price adjustment interval. V1 uses week intervals only.';

comment on column public.listing_batches.price_adjustment_max_price is
'Optional maximum current unit price for increase rules. Null means uncapped above the zero floor.';

comment on column public.listing_batches.price_adjustment_min_price is
'Optional minimum current unit price for decrease rules. Null means no seller cap; calculation still floors at zero to preserve nonnegative order prices.';

create or replace function public.calculate_inventory_unit_price(
  batch_base_price numeric,
  item_price_override numeric,
  auto_price_adjustment_enabled boolean,
  price_adjustment_direction text,
  price_adjustment_amount numeric,
  price_adjustment_interval_weeks integer,
  price_adjustment_max_price numeric,
  price_adjustment_min_price numeric,
  available_date date
)
returns numeric(10, 2)
language sql
stable
as $$
  with price_inputs as (
    select
      coalesce(item_price_override, batch_base_price)::numeric as starting_price,
      case
        when coalesce(auto_price_adjustment_enabled, false)
          and price_adjustment_direction in ('increase', 'decrease')
          and price_adjustment_amount is not null
          and price_adjustment_amount > 0
          and price_adjustment_interval_weeks is not null
          and price_adjustment_interval_weeks > 0
          and available_date is not null
          and current_date > available_date
          then floor(
            (current_date - available_date)::numeric
            / (price_adjustment_interval_weeks * 7)
          )::integer
        else 0
      end as completed_intervals
  ), adjusted_price as (
    select
      starting_price,
      completed_intervals,
      case
        when completed_intervals <= 0 then starting_price
        when price_adjustment_direction = 'increase'
          then starting_price + (price_adjustment_amount * completed_intervals)
        when price_adjustment_direction = 'decrease'
          then starting_price - (price_adjustment_amount * completed_intervals)
        else starting_price
      end as uncapped_price
    from price_inputs
  )
  select case
    when starting_price is null then null::numeric(10, 2)
    when completed_intervals <= 0 then starting_price::numeric(10, 2)
    when price_adjustment_direction = 'increase'
      then least(
        uncapped_price,
        coalesce(price_adjustment_max_price, uncapped_price)
      )::numeric(10, 2)
    when price_adjustment_direction = 'decrease'
      then greatest(
        uncapped_price,
        coalesce(price_adjustment_min_price, 0),
        0
      )::numeric(10, 2)
    else starting_price::numeric(10, 2)
  end
  from adjusted_price;
$$;

comment on function public.calculate_inventory_unit_price(
  numeric, numeric, boolean, text, numeric, integer, numeric, numeric, date
) is
'Calculates the current unit price from row base price, batch available_date, and the active Group 65 batch-level price adjustment rule. Uses completed whole week intervals only.';

create or replace function public.calculate_inventory_unit_price(
  batch_base_price numeric,
  item_price_override numeric,
  auto_price_increase_enabled boolean,
  auto_price_increase_amount numeric,
  auto_price_increase_max_price numeric,
  available_date date
)
returns numeric(10, 2)
language sql
stable
as $$
  select public.calculate_inventory_unit_price(
    batch_base_price,
    item_price_override,
    auto_price_increase_enabled,
    'increase',
    auto_price_increase_amount,
    1,
    auto_price_increase_max_price,
    null,
    available_date
  );
$$;

comment on function public.calculate_inventory_unit_price(
  numeric, numeric, boolean, numeric, numeric, date
) is
'Compatibility wrapper for earlier increase-only callers. New active pricing paths should call the generic Group 65 signature.';

create or replace function public.seller_set_listing_batch_price_adjustment(
  p_listing_batch_id uuid,
  p_auto_price_adjustment_enabled boolean default false,
  p_price_adjustment_direction text default null,
  p_price_adjustment_amount numeric default null,
  p_price_adjustment_interval_weeks integer default null,
  p_price_adjustment_max_price numeric default null,
  p_price_adjustment_min_price numeric default null
)
returns public.listing_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_updated_batch public.listing_batches%rowtype;
  v_enabled boolean;
  v_direction text;
begin
  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id
  for update;

  if v_batch.id is null then
    raise exception 'Listing batch not found.';
  end if;

  if not (public.owns_store(v_batch.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this listing batch.';
  end if;

  v_enabled := coalesce(p_auto_price_adjustment_enabled, false);
  v_direction := nullif(trim(p_price_adjustment_direction), '');

  if v_enabled then
    if v_direction not in ('increase', 'decrease') then
      raise exception 'Price adjustment direction must be increase or decrease.';
    end if;

    if p_price_adjustment_amount is null or p_price_adjustment_amount <= 0 then
      raise exception 'Price adjustment amount must be greater than zero.';
    end if;

    if p_price_adjustment_interval_weeks is null or p_price_adjustment_interval_weeks <= 0 then
      raise exception 'Price adjustment interval must be one week or more.';
    end if;

    if v_direction = 'increase' and p_price_adjustment_min_price is not null then
      raise exception 'Minimum price is only available for decrease rules.';
    end if;

    if v_direction = 'decrease' and p_price_adjustment_max_price is not null then
      raise exception 'Maximum price is only available for increase rules.';
    end if;

    if p_price_adjustment_max_price is not null and p_price_adjustment_max_price < 0 then
      raise exception 'Maximum price cannot be negative.';
    end if;

    if p_price_adjustment_min_price is not null and p_price_adjustment_min_price < 0 then
      raise exception 'Minimum price cannot be negative.';
    end if;
  end if;

  update public.listing_batches
  set
    auto_price_adjustment_enabled = v_enabled,
    price_adjustment_direction = case when v_enabled then v_direction else null end,
    price_adjustment_amount = case when v_enabled then p_price_adjustment_amount else null end,
    price_adjustment_interval_weeks = case when v_enabled then p_price_adjustment_interval_weeks else null end,
    price_adjustment_max_price = case
      when v_enabled and v_direction = 'increase' then p_price_adjustment_max_price
      else null
    end,
    price_adjustment_min_price = case
      when v_enabled and v_direction = 'decrease' then p_price_adjustment_min_price
      else null
    end,
    auto_price_increase_enabled = case when v_enabled and v_direction = 'increase' then true else false end,
    auto_price_increase_amount = case when v_enabled and v_direction = 'increase' then p_price_adjustment_amount else null end,
    auto_price_increase_max_price = case when v_enabled and v_direction = 'increase' then p_price_adjustment_max_price else null end
  where listing_batches.id = v_batch.id
  returning * into v_updated_batch;

  return v_updated_batch;
end;
$$;

comment on function public.seller_set_listing_batch_price_adjustment(
  uuid, boolean, text, numeric, integer, numeric, numeric
) is
'Seller/admin RPC for updating the optional Group 65 batch-level automatic price adjustment rule while preserving old increase-only compatibility columns.';

revoke all on function public.seller_set_listing_batch_price_adjustment(
  uuid, boolean, text, numeric, integer, numeric, numeric
) from public;

grant execute on function public.seller_set_listing_batch_price_adjustment(
  uuid, boolean, text, numeric, integer, numeric, numeric
) to authenticated;


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
    listing_batches.auto_price_adjustment_enabled,
    listing_batches.price_adjustment_direction,
    listing_batches.price_adjustment_amount,
    listing_batches.price_adjustment_interval_weeks,
    listing_batches.price_adjustment_max_price,
    listing_batches.price_adjustment_min_price,
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
    listing_batches.auto_price_adjustment_enabled,
    listing_batches.price_adjustment_direction,
    listing_batches.price_adjustment_amount,
    listing_batches.price_adjustment_interval_weeks,
    listing_batches.price_adjustment_max_price,
    listing_batches.price_adjustment_min_price,
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
'Primary official buyer-facing storefront projection. One enriched public inventory row per item;

create or replace view public.seller_inventory_management
with (security_barrier = true)
as
select
  inventory_items.store_id,
  listing_batches.id as listing_batch_id,
  listing_batch_breeds.id as listing_batch_breed_id,
  inventory_items.id as inventory_item_id,
  species.id as species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  seller_breed_profiles.id as seller_breed_profile_id,
  seller_breed_profiles.display_name as breed_display_name,
  listing_batches.batch_type,
  listing_batches.origin_date,
  listing_batches.available_date,
  listing_batches.age_at_availability_days,
  listing_batches.base_price,
  listing_batches.auto_price_increase_enabled,
  listing_batches.auto_price_increase_amount,
  listing_batches.auto_price_increase_max_price,
  listing_batches.internal_batch_label,
  listing_batches.visibility_status as listing_batch_visibility_status,
  listing_batches.moderation_status as listing_batch_moderation_status,
  listing_batch_breeds.sort_order as listing_batch_breed_sort_order,
  listing_batch_breeds.visibility_status as listing_batch_breed_visibility_status,
  listing_batch_breeds.moderation_status as listing_batch_breed_moderation_status,
  inventory_items.inventory_type,
  inventory_items.custom_inventory_label,
  inventory_items.quantity_available,
  inventory_items.price_override,
  public.calculate_inventory_unit_price(
    listing_batches.base_price,
    inventory_items.price_override,
    listing_batches.auto_price_adjustment_enabled,
    listing_batches.price_adjustment_direction,
    listing_batches.price_adjustment_amount,
    listing_batches.price_adjustment_interval_weeks,
    listing_batches.price_adjustment_max_price,
    listing_batches.price_adjustment_min_price,
    listing_batches.available_date
  ) as effective_unit_price,
  inventory_items.sort_order as inventory_item_sort_order,
  inventory_items.visibility_status as inventory_visibility_status,
  inventory_items.moderation_status as inventory_moderation_status,
  case
    when listing_batches.visibility_status = 'archived'
      or listing_batch_breeds.visibility_status = 'archived'
      or inventory_items.visibility_status = 'archived'
      then 'archived'
    when listing_batches.moderation_status <> 'normal'
      or listing_batch_breeds.moderation_status <> 'normal'
      or inventory_items.moderation_status <> 'normal'
      or seller_breed_profiles.moderation_status <> 'normal'
      then 'unavailable'
    when listing_batches.visibility_status = 'sold_out'
      or inventory_items.quantity_available <= 0
      then 'sold_out'
    when listing_batches.visibility_status <> 'active'
      or listing_batch_breeds.visibility_status <> 'active'
      or inventory_items.visibility_status <> 'active'
      or seller_breed_profiles.visibility_status <> 'active'
      then 'hidden'
    when listing_batches.available_date > current_date
      then 'reserve_now'
    else 'ready_now'
  end as operational_availability_status,
  inventory_items.seller_notes as inventory_seller_notes,
  listing_batch_breeds.seller_notes as listing_batch_breed_seller_notes,
  listing_batches.seller_notes as listing_batch_seller_notes,
  inventory_items.updated_at as inventory_updated_at,
  listing_batches.updated_at as listing_batch_updated_at,
  listing_batches.auto_price_adjustment_enabled,
  listing_batches.price_adjustment_direction,
  listing_batches.price_adjustment_amount,
  listing_batches.price_adjustment_interval_weeks,
  listing_batches.price_adjustment_max_price,
  listing_batches.price_adjustment_min_price
from public.inventory_items
join public.listing_batches
  on listing_batches.id = inventory_items.listing_batch_id
 and listing_batches.store_id = inventory_items.store_id
join public.listing_batch_breeds
  on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
 and listing_batch_breeds.store_id = inventory_items.store_id
join public.seller_breed_profiles
  on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
 and seller_breed_profiles.store_id = inventory_items.store_id
join public.species
  on species.id = listing_batches.species_id
where (
    public.owns_store(inventory_items.store_id)
    or public.is_admin()
  );

comment on view public.seller_inventory_management is
'Seller-private inventory/listing management projection for dashboard screens. It exposes seller-operational fields without adding new inventory business logic.';

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
  p_buyer_user_agent text default null,
  p_pickup_option_id uuid default null
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
set search_path = public, extensions
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
  v_pickup_option public.store_pickup_options%rowtype;
  v_pickup_option_label_snapshot text;

  v_request_hash text;
  v_existing_idempotency public.order_idempotency_keys%rowtype;
  v_store public.stores%rowtype;

  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_order_created_at timestamptz;
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

  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = p_store_id
    and stores.storefront_enabled = true
    and stores.store_status = 'live'
    and stores.storefront_mode in ('hosted', 'embedded')
    and stores.admin_hold_reason is null;

  if v_store.id is null then
    raise exception 'Store is not available for checkout.';
  end if;

  if p_pickup_option_id is not null then
    select pickup_options.*
    into v_pickup_option
    from public.store_pickup_options as pickup_options
    where pickup_options.id = p_pickup_option_id
      and pickup_options.store_id = p_store_id
      and pickup_options.is_active = true;

    if v_pickup_option.id is null then
      raise exception 'Pickup option is not available for this store.';
    end if;

    v_pickup_option_label_snapshot := v_pickup_option.label;
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
    from pg_temp.requested_order_items as requested_order_items
    where requested_order_items.inventory_item_id is null
       or requested_order_items.quantity <= 0
  ) then
    raise exception 'Each order item must include a valid inventory item ID and positive quantity.';
  end if;

  select count(*)
  into v_requested_item_count
  from pg_temp.requested_order_items as requested_order_items;

  if v_requested_item_count = 0 then
    raise exception 'At least one valid order item is required.';
  end if;

  v_request_hash := encode(
    digest(
      (
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
            from pg_temp.requested_order_items as requested_order_items
          )
        )
        || case
          when p_pickup_option_id is not null then jsonb_build_object(
            'pickup_option_id', p_pickup_option_id,
            'pickup_option_label_snapshot', v_pickup_option_label_snapshot
          )
          else '{}'::jsonb
        end
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
  on conflict on constraint order_idempotency_keys_pkey do nothing;

  select idempotency_keys.*
  into v_existing_idempotency
  from public.order_idempotency_keys as idempotency_keys
  where idempotency_keys.store_id = p_store_id
    and idempotency_keys.idempotency_key = v_idempotency_key
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
    from public.orders as orders
    where orders.id = v_existing_idempotency.order_id;

    return;
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
      listing_batches.auto_price_adjustment_enabled,
      listing_batches.price_adjustment_direction,
      listing_batches.price_adjustment_amount,
      listing_batches.price_adjustment_interval_weeks,
      listing_batches.price_adjustment_max_price,
      listing_batches.price_adjustment_min_price,
      listing_batches.available_date
    ),
    (
      public.calculate_inventory_unit_price(
        listing_batches.base_price,
        inventory_items.price_override,
        listing_batches.auto_price_adjustment_enabled,
        listing_batches.price_adjustment_direction,
        listing_batches.price_adjustment_amount,
        listing_batches.price_adjustment_interval_weeks,
        listing_batches.price_adjustment_max_price,
        listing_batches.price_adjustment_min_price,
        listing_batches.available_date
      ) * requested_order_items.quantity
    )::numeric(10, 2)
  from (
    select requested_items.*
    from pg_temp.requested_order_items as requested_items
    order by requested_items.inventory_item_id
  ) as requested_order_items
  join public.inventory_items as inventory_items
    on inventory_items.id = requested_order_items.inventory_item_id
  join public.listing_batches as listing_batches
    on listing_batches.id = inventory_items.listing_batch_id
  join public.listing_batch_breeds as listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
  join public.seller_breed_profiles as seller_breed_profiles
    on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
  join public.species as species
    on species.id = listing_batches.species_id
  where inventory_items.id in (
    select requested_order_items.inventory_item_id
    from pg_temp.requested_order_items as requested_order_items
    order by requested_order_items.inventory_item_id
  )
  for update of inventory_items;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_order_items as locked_order_items;

  if v_locked_item_count <> v_requested_item_count then
    raise exception 'One or more inventory items were not found.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as locked_order_items
    where locked_order_items.store_id <> p_store_id
  ) then
    raise exception 'One or more inventory items do not belong to this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as locked_order_items
    join public.inventory_items as inventory_items
      on inventory_items.id = locked_order_items.inventory_item_id
    join public.listing_batches as listing_batches
      on listing_batches.id = locked_order_items.listing_batch_id
    join public.listing_batch_breeds as listing_batch_breeds
      on listing_batch_breeds.id = locked_order_items.listing_batch_breed_id
    join public.seller_breed_profiles as seller_breed_profiles
      on seller_breed_profiles.id = locked_order_items.seller_breed_profile_id
    join public.species as species
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
    from pg_temp.locked_order_items as locked_order_items
    join public.inventory_items as inventory_items
      on inventory_items.id = locked_order_items.inventory_item_id
    join public.listing_batches as listing_batches
      on listing_batches.id = locked_order_items.listing_batch_id
    join public.listing_batch_breeds as listing_batch_breeds
      on listing_batch_breeds.id = locked_order_items.listing_batch_breed_id
    join public.seller_breed_profiles as seller_breed_profiles
      on seller_breed_profiles.id = locked_order_items.seller_breed_profile_id
    join public.species as species
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
    from pg_temp.locked_order_items as locked_order_items
    where locked_order_items.quantity_available < locked_order_items.requested_quantity
  ) then
    raise exception 'Insufficient inventory quantity available.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as locked_order_items
    where (
      locked_order_items.batch_type = 'hatching_eggs'
      and locked_order_items.inventory_type <> 'hatching_eggs'
    )
    or (
      locked_order_items.batch_type = 'live_animals'
      and locked_order_items.inventory_type = 'hatching_eggs'
    )
  ) then
    raise exception 'Invalid inventory type for listing batch type.';
  end if;

  select coalesce(sum(locked_order_items.line_subtotal), 0)::numeric(10, 2)
  into v_subtotal_amount
  from pg_temp.locked_order_items as locked_order_items;

  v_total_amount := v_subtotal_amount + v_tax_fee_amount;

  perform pg_advisory_xact_lock(
    hashtextextended(p_store_id::text || ':' || v_buyer_email, 0)
  );

  select customers.id
  into v_customer_id
  from public.customers as customers
  where customers.store_id = p_store_id
    and lower(trim(customers.email)) = v_buyer_email
  order by customers.created_at, customers.id
  limit 1;

  if v_customer_id is null then
    insert into public.customers as inserted_customer (
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
    returning inserted_customer.id into v_customer_id;
  else
    update public.customers as customers
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

  insert into public.order_number_counters as inserted_counter (
    store_id
  )
  values (
    p_store_id
  )
  on conflict on constraint order_number_counters_pkey do nothing;

  update public.order_number_counters as counters
  set last_order_number = counters.last_order_number + 1
  where counters.store_id = p_store_id
  returning counters.last_order_number into v_next_order_number;

  v_order_number := v_next_order_number::text;

  insert into public.orders as inserted_order (
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
    pickup_option_id,
    pickup_option_label_snapshot,
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
    v_pickup_option.id,
    v_pickup_option_label_snapshot,
    v_subtotal_amount,
    null,
    null,
    v_tax_fee_amount,
    v_total_amount,
    p_buyer_ip_address,
    v_buyer_user_agent
  )
  returning inserted_order.id, inserted_order.created_at into v_order_id, v_order_created_at;

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
  from pg_temp.locked_order_items as locked_order_items
  order by locked_order_items.inventory_item_id;

  update public.inventory_items as inventory_items
  set quantity_available = inventory_items.quantity_available - locked_order_items.requested_quantity
  from pg_temp.locked_order_items as locked_order_items
  where inventory_items.id = locked_order_items.inventory_item_id;

  update public.order_idempotency_keys as idempotency_keys
  set order_id = v_order_id
  where idempotency_keys.store_id = p_store_id
    and idempotency_keys.idempotency_key = v_idempotency_key;

  perform public.enqueue_email_notification(
    p_store_id,
    v_order_id,
    'buyer_order_received',
    'buyer',
    v_buyer_email,
    'Order received: ' || v_order_number,
    jsonb_build_object(
      'order_id', v_order_id,
      'order_number', v_order_number,
      'store_id', p_store_id,
      'store_name', v_store.store_name,
      'store_slug', v_store.store_slug,
      'buyer_first_name', v_buyer_first_name,
      'buyer_last_name', v_buyer_last_name,
      'buyer_email', v_buyer_email,
      'order_status', 'open',
      'payment_status', 'pay_at_pickup',
      'total_amount', v_total_amount,
      'created_at', v_order_created_at,
      'pickup_note', v_pickup_note,
      'pickup_option_label', v_pickup_option_label_snapshot,
      'buyer_notes', v_buyer_notes
    )
  );

  perform public.enqueue_email_notification(
    p_store_id,
    v_order_id,
    'seller_new_order_received',
    'seller',
    v_store.order_notification_email,
    'New FlipFlocks order: ' || v_order_number,
    jsonb_build_object(
      'order_id', v_order_id,
      'order_number', v_order_number,
      'store_id', p_store_id,
      'store_name', v_store.store_name,
      'store_slug', v_store.store_slug,
      'buyer_first_name', v_buyer_first_name,
      'buyer_last_name', v_buyer_last_name,
      'buyer_email', v_buyer_email,
      'buyer_phone', v_buyer_phone,
      'order_status', 'open',
      'payment_status', 'pay_at_pickup',
      'total_amount', v_total_amount,
      'created_at', v_order_created_at,
      'pickup_option_label', v_pickup_option_label_snapshot,
      'item_count', v_requested_item_count
    )
  );

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
  from public.orders as orders
  where orders.id = v_order_id;
end;
$$;

create or replace function public.seller_create_manual_order(
  p_store_id uuid,
  p_idempotency_key text,
  p_items jsonb,
  p_customer_id uuid default null,
  p_customer_email text default null,
  p_customer_first_name text default null,
  p_customer_last_name text default null,
  p_customer_phone text default null,
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
  p_order_source text default 'manual',
  p_payment_status text default 'pay_at_pickup',
  p_buyer_notes text default null,
  p_pickup_note text default null,
  p_tax_fee_label text default null,
  p_tax_fee_rate numeric default null,
  p_tax_fee_amount numeric default 0,
  p_send_buyer_notification boolean default false,
  p_send_seller_notification boolean default false
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  customer_id uuid,
  order_status text,
  payment_method text,
  payment_status text,
  order_source text,
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
  v_order_source text;
  v_payment_status text;
  v_customer_email text;
  v_customer_first_name text;
  v_customer_last_name text;
  v_customer_phone text;
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
  v_tax_fee_label text;
  v_tax_fee_rate numeric(7, 4);
  v_tax_fee_amount numeric(10, 2);

  v_request_hash text;
  v_existing_idempotency public.order_idempotency_keys%rowtype;
  v_store public.stores%rowtype;
  v_customer public.customers%rowtype;

  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_order_created_at timestamptz;
  v_next_order_number integer;
  v_subtotal_amount numeric(10, 2);
  v_total_amount numeric(10, 2);

  v_requested_item_count integer;
  v_locked_item_count integer;
  v_item record;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Store is not available.';
  end if;

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id;

  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  v_idempotency_key := nullif(trim(p_idempotency_key), '');
  v_order_source := coalesce(nullif(trim(p_order_source), ''), 'manual');
  v_payment_status := coalesce(nullif(trim(p_payment_status), ''), 'pay_at_pickup');
  v_customer_email := lower(nullif(trim(p_customer_email), ''));
  v_customer_first_name := nullif(trim(p_customer_first_name), '');
  v_customer_last_name := nullif(trim(p_customer_last_name), '');
  v_customer_phone := nullif(trim(p_customer_phone), '');
  v_business_name := nullif(trim(p_business_name), '');
  v_city := nullif(trim(p_city), '');
  v_state := nullif(trim(p_state), '');
  v_country := nullif(trim(p_country), '');
  v_delivery_address_line1 := nullif(trim(p_delivery_address_line1), '');
  v_delivery_address_line2 := nullif(trim(p_delivery_address_line2), '');
  v_delivery_city := nullif(trim(p_delivery_city), '');
  v_delivery_state := nullif(trim(p_delivery_state), '');
  v_delivery_postal_code := nullif(trim(p_delivery_postal_code), '');
  v_delivery_country := nullif(trim(p_delivery_country), '');
  v_buyer_notes := nullif(trim(p_buyer_notes), '');
  v_pickup_note := nullif(trim(p_pickup_note), '');
  v_tax_fee_label := nullif(trim(p_tax_fee_label), '');
  v_tax_fee_rate := p_tax_fee_rate::numeric(7, 4);
  v_tax_fee_amount := coalesce(p_tax_fee_amount, 0)::numeric(10, 2);

  if v_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  if length(v_idempotency_key) > 200 then
    raise exception 'Idempotency key must be 200 characters or fewer.';
  end if;

  if v_order_source not in (
    'seller_created',
    'manual',
    'phone',
    'text',
    'market',
    'event'
  ) then
    raise exception 'Manual order source is not supported.';
  end if;

  if v_payment_status not in ('unpaid', 'pay_at_pickup', 'paid') then
    raise exception 'Manual order payment status is not supported.';
  end if;

  if v_tax_fee_amount < 0 then
    raise exception 'Tax or fee amount cannot be negative.';
  end if;

  if v_tax_fee_rate is not null and v_tax_fee_rate < 0 then
    raise exception 'Tax or fee rate cannot be negative.';
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
       or (
         item ? 'unit_price'
         and item ->> 'unit_price' !~ '^[0-9]+(\.[0-9]{1,2})?$'
       )
       or (
         item ? 'allow_inventory_override'
         and jsonb_typeof(item -> 'allow_inventory_override') <> 'boolean'
       )
  ) then
    raise exception 'Each manual order item must include a valid inventory item ID, positive quantity, optional nonnegative unit price, and optional boolean inventory override flag.';
  end if;

  drop table if exists pg_temp.requested_manual_order_items;
  drop table if exists pg_temp.locked_manual_order_items;

  if exists (
    select 1
    from (
      select
        (item ->> 'inventory_item_id')::uuid as inventory_item_id,
        count(*) as item_count
      from jsonb_array_elements(p_items) as item
      group by (item ->> 'inventory_item_id')::uuid
    ) as duplicated_items
    where duplicated_items.item_count > 1
  ) then
    raise exception 'Duplicate inventory items are not supported in a manual order request.';
  end if;

  create temporary table pg_temp.requested_manual_order_items (
    inventory_item_id uuid primary key,
    quantity integer not null check (quantity > 0),
    unit_price_override numeric(10, 2),
    allow_inventory_override boolean not null default false
  ) on commit drop;

  insert into pg_temp.requested_manual_order_items (
    inventory_item_id,
    quantity,
    unit_price_override,
    allow_inventory_override
  )
  select
    (item ->> 'inventory_item_id')::uuid as inventory_item_id,
    (item ->> 'quantity')::integer as quantity,
    case
      when item ? 'unit_price'
        then (item ->> 'unit_price')::numeric(10, 2)
      else null
    end as unit_price_override,
    coalesce((item ->> 'allow_inventory_override')::boolean, false)
      as allow_inventory_override
  from jsonb_array_elements(p_items) as item;

  select count(*)
  into v_requested_item_count
  from pg_temp.requested_manual_order_items;

  if v_requested_item_count = 0 then
    raise exception 'At least one valid order item is required.';
  end if;

  v_request_hash := encode(
    digest(
      jsonb_build_object(
        'operation', 'seller_create_manual_order',
        'store_id', p_store_id,
        'customer_id', p_customer_id,
        'customer_email', v_customer_email,
        'customer_first_name', v_customer_first_name,
        'customer_last_name', v_customer_last_name,
        'customer_phone', v_customer_phone,
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
        'order_source', v_order_source,
        'payment_status', v_payment_status,
        'buyer_notes', v_buyer_notes,
        'pickup_note', v_pickup_note,
        'tax_fee_label', v_tax_fee_label,
        'tax_fee_rate', v_tax_fee_rate,
        'tax_fee_amount', v_tax_fee_amount,
        'send_buyer_notification', p_send_buyer_notification,
        'send_seller_notification', p_send_seller_notification,
        'items', (
          select jsonb_agg(
            jsonb_build_object(
              'inventory_item_id', requested_manual_order_items.inventory_item_id,
              'quantity', requested_manual_order_items.quantity,
              'unit_price_override', requested_manual_order_items.unit_price_override,
              'allow_inventory_override', requested_manual_order_items.allow_inventory_override
            )
            order by requested_manual_order_items.inventory_item_id
          )
          from pg_temp.requested_manual_order_items
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
      orders.order_source,
      orders.subtotal_amount,
      orders.tax_fee_amount,
      orders.total_amount,
      orders.created_at
    from public.orders
    where orders.id = v_existing_idempotency.order_id
      and orders.store_id = p_store_id;

    return;
  end if;

  create temporary table pg_temp.locked_manual_order_items (
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
    deduct_quantity integer not null,
    override_quantity integer not null,
    allow_inventory_override boolean not null,
    unit_price numeric(10, 2) not null,
    line_subtotal numeric(10, 2) not null
  ) on commit drop;

  insert into pg_temp.locked_manual_order_items (
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
    deduct_quantity,
    override_quantity,
    allow_inventory_override,
    unit_price,
    line_subtotal
  )
  select
    inventory_items.id,
    requested_manual_order_items.quantity,
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
    least(inventory_items.quantity_available, requested_manual_order_items.quantity),
    greatest(requested_manual_order_items.quantity - inventory_items.quantity_available, 0),
    requested_manual_order_items.allow_inventory_override,
    coalesce(
      requested_manual_order_items.unit_price_override,
      public.calculate_inventory_unit_price(
        listing_batches.base_price,
        inventory_items.price_override,
        listing_batches.auto_price_adjustment_enabled,
        listing_batches.price_adjustment_direction,
        listing_batches.price_adjustment_amount,
        listing_batches.price_adjustment_interval_weeks,
        listing_batches.price_adjustment_max_price,
        listing_batches.price_adjustment_min_price,
        listing_batches.available_date
      )
    ),
    (
      coalesce(
        requested_manual_order_items.unit_price_override,
        public.calculate_inventory_unit_price(
          listing_batches.base_price,
          inventory_items.price_override,
          listing_batches.auto_price_adjustment_enabled,
          listing_batches.price_adjustment_direction,
          listing_batches.price_adjustment_amount,
          listing_batches.price_adjustment_interval_weeks,
          listing_batches.price_adjustment_max_price,
          listing_batches.price_adjustment_min_price,
          listing_batches.available_date
        )
      ) * requested_manual_order_items.quantity
    )::numeric(10, 2)
  from (
    select *
    from pg_temp.requested_manual_order_items
    order by inventory_item_id
  ) as requested_manual_order_items
  join public.inventory_items
    on inventory_items.id = requested_manual_order_items.inventory_item_id
   and inventory_items.store_id = p_store_id
  join public.listing_batches
    on listing_batches.id = inventory_items.listing_batch_id
   and listing_batches.store_id = p_store_id
  join public.listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
   and listing_batch_breeds.store_id = p_store_id
  join public.seller_breed_profiles
    on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
   and seller_breed_profiles.store_id = p_store_id
  join public.species
    on species.id = listing_batches.species_id
  for update of inventory_items;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_manual_order_items;

  if v_locked_item_count <> v_requested_item_count then
    raise exception 'One or more inventory items are not available for this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_order_items
    join public.inventory_items
      on inventory_items.id = locked_manual_order_items.inventory_item_id
    join public.listing_batches
      on listing_batches.id = locked_manual_order_items.listing_batch_id
    join public.listing_batch_breeds
      on listing_batch_breeds.id = locked_manual_order_items.listing_batch_breed_id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = locked_manual_order_items.seller_breed_profile_id
    where inventory_items.store_id <> p_store_id
       or listing_batches.store_id <> p_store_id
       or listing_batch_breeds.store_id <> p_store_id
       or seller_breed_profiles.store_id <> p_store_id
       or listing_batch_breeds.listing_batch_id <> listing_batches.id
       or inventory_items.listing_batch_id <> listing_batches.id
       or inventory_items.listing_batch_breed_id <> listing_batch_breeds.id
       or seller_breed_profiles.species_id <> listing_batches.species_id
  ) then
    raise exception 'Invalid inventory relationship for this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_order_items
    join public.inventory_items
      on inventory_items.id = locked_manual_order_items.inventory_item_id
    join public.listing_batches
      on listing_batches.id = locked_manual_order_items.listing_batch_id
    join public.listing_batch_breeds
      on listing_batch_breeds.id = locked_manual_order_items.listing_batch_breed_id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = locked_manual_order_items.seller_breed_profile_id
    where inventory_items.visibility_status = 'archived'
       or inventory_items.moderation_status <> 'normal'
       or listing_batches.visibility_status = 'archived'
       or listing_batches.moderation_status <> 'normal'
       or listing_batch_breeds.visibility_status = 'archived'
       or listing_batch_breeds.moderation_status <> 'normal'
       or seller_breed_profiles.visibility_status = 'archived'
       or seller_breed_profiles.moderation_status <> 'normal'
  ) then
    raise exception 'One or more inventory items are not available for manual orders.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_order_items
    where override_quantity > 0
      and allow_inventory_override <> true
  ) then
    raise exception 'Inventory override must be explicitly allowed when manual order quantity exceeds available inventory.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_order_items
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
  from pg_temp.locked_manual_order_items;

  v_total_amount := (v_subtotal_amount + v_tax_fee_amount)::numeric(10, 2);

  if p_customer_id is not null then
    select *
    into v_customer
    from public.customers
    where customers.id = p_customer_id
      and customers.store_id = p_store_id
    for update;

    if v_customer.id is null then
      raise exception 'Customer is not available for this store.';
    end if;

    v_customer_email := coalesce(v_customer_email, lower(trim(v_customer.email)));
    v_customer_first_name := coalesce(v_customer_first_name, v_customer.first_name);
    v_customer_last_name := coalesce(v_customer_last_name, v_customer.last_name);
    v_customer_phone := coalesce(v_customer_phone, v_customer.phone);
    v_business_name := coalesce(v_business_name, v_customer.business_name);
    v_city := coalesce(v_city, v_customer.city);
    v_state := coalesce(v_state, v_customer.state);
    v_country := coalesce(v_country, v_customer.country);
    v_delivery_address_line1 := coalesce(v_delivery_address_line1, v_customer.delivery_address_line1);
    v_delivery_address_line2 := coalesce(v_delivery_address_line2, v_customer.delivery_address_line2);
    v_delivery_city := coalesce(v_delivery_city, v_customer.delivery_city);
    v_delivery_state := coalesce(v_delivery_state, v_customer.delivery_state);
    v_delivery_postal_code := coalesce(v_delivery_postal_code, v_customer.delivery_postal_code);
    v_delivery_country := coalesce(v_delivery_country, v_customer.delivery_country);
  end if;

  if v_customer_email is null then
    raise exception 'Customer email is required.';
  end if;

  if v_customer_first_name is null then
    raise exception 'Customer first name is required.';
  end if;

  if v_customer_last_name is null then
    raise exception 'Customer last name is required.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_store_id::text || ':' || v_customer_email, 0)
  );

  if p_customer_id is null then
    select *
    into v_customer
    from public.customers
    where customers.store_id = p_store_id
      and lower(trim(customers.email)) = v_customer_email
    order by customers.created_at, customers.id
    limit 1
    for update;
  end if;

  if v_customer.id is null then
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
      v_customer_email,
      v_customer_first_name,
      v_customer_last_name,
      v_customer_phone,
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
      email = v_customer_email,
      first_name = v_customer_first_name,
      last_name = v_customer_last_name,
      phone = v_customer_phone,
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
    where customers.id = v_customer.id
      and customers.store_id = p_store_id
    returning customers.id into v_customer_id;
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
    total_amount
  )
  values (
    p_store_id,
    v_customer_id,
    v_order_number,
    v_order_source,
    'open',
    'pay_at_pickup',
    v_payment_status,
    v_customer_email,
    v_customer_first_name,
    v_customer_last_name,
    v_customer_phone,
    v_delivery_address_line1,
    v_delivery_address_line2,
    v_delivery_city,
    v_delivery_state,
    v_delivery_postal_code,
    v_delivery_country,
    v_buyer_notes,
    v_pickup_note,
    v_subtotal_amount,
    v_tax_fee_label,
    v_tax_fee_rate,
    v_tax_fee_amount,
    v_total_amount
  )
  returning id, created_at into v_order_id, v_order_created_at;

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
    locked_manual_order_items.inventory_item_id,
    locked_manual_order_items.listing_batch_id,
    locked_manual_order_items.listing_batch_breed_id,
    locked_manual_order_items.seller_breed_profile_id,
    locked_manual_order_items.species_id,
    locked_manual_order_items.species_name,
    locked_manual_order_items.species_slug,
    locked_manual_order_items.breed_display_name,
    locked_manual_order_items.breed_description,
    locked_manual_order_items.inventory_type,
    locked_manual_order_items.custom_inventory_label,
    locked_manual_order_items.batch_type,
    locked_manual_order_items.available_date,
    locked_manual_order_items.age_at_availability_days,
    locked_manual_order_items.unit_price,
    locked_manual_order_items.requested_quantity,
    locked_manual_order_items.line_subtotal
  from pg_temp.locked_manual_order_items
  order by locked_manual_order_items.inventory_item_id;

  update public.inventory_items
  set quantity_available = greatest(
    inventory_items.quantity_available - locked_manual_order_items.requested_quantity,
    0
  )
  from pg_temp.locked_manual_order_items
  where inventory_items.id = locked_manual_order_items.inventory_item_id
    and inventory_items.store_id = p_store_id;

  for v_item in
    select *
    from pg_temp.locked_manual_order_items
    order by inventory_item_id
  loop
    perform public.log_inventory_activity_event(
      p_store_id,
      v_item.listing_batch_id,
      v_item.listing_batch_breed_id,
      v_item.inventory_item_id,
      'inventory_quantity_adjusted',
      v_item.quantity_available,
      greatest(v_item.quantity_available - v_item.requested_quantity, 0),
      null,
      null,
      'Manual order inventory deduction',
      jsonb_build_object(
        'order_id', v_order_id,
        'order_number', v_order_number,
        'order_source', v_order_source,
        'requested_quantity', v_item.requested_quantity,
        'deducted_quantity', v_item.deduct_quantity,
        'override_quantity', v_item.override_quantity,
        'override_applied', v_item.override_quantity > 0,
        'allow_inventory_override', v_item.allow_inventory_override,
        'unit_price_snapshot', v_item.unit_price,
        'line_subtotal', v_item.line_subtotal
      )
    );
  end loop;

  update public.order_idempotency_keys
  set order_id = v_order_id
  where order_idempotency_keys.store_id = p_store_id
    and order_idempotency_keys.idempotency_key = v_idempotency_key;

  if p_send_buyer_notification then
    perform public.enqueue_email_notification(
      p_store_id,
      v_order_id,
      'buyer_order_received',
      'buyer',
      v_customer_email,
      'Order received: ' || v_order_number,
      jsonb_build_object(
        'order_id', v_order_id,
        'order_number', v_order_number,
        'store_id', p_store_id,
        'store_name', v_store.store_name,
        'store_slug', v_store.store_slug,
        'buyer_first_name', v_customer_first_name,
        'buyer_last_name', v_customer_last_name,
        'buyer_email', v_customer_email,
        'order_status', 'open',
        'payment_status', v_payment_status,
        'total_amount', v_total_amount,
        'created_at', v_order_created_at,
        'pickup_note', v_pickup_note,
        'buyer_notes', v_buyer_notes,
        'order_source', v_order_source
      )
    );
  end if;

  if p_send_seller_notification then
    perform public.enqueue_email_notification(
      p_store_id,
      v_order_id,
      'seller_new_order_received',
      'seller',
      v_store.order_notification_email,
      'New FlipFlocks order: ' || v_order_number,
      jsonb_build_object(
        'order_id', v_order_id,
        'order_number', v_order_number,
        'store_id', p_store_id,
        'store_name', v_store.store_name,
        'store_slug', v_store.store_slug,
        'buyer_first_name', v_customer_first_name,
        'buyer_last_name', v_customer_last_name,
        'buyer_email', v_customer_email,
        'buyer_phone', v_customer_phone,
        'order_status', 'open',
        'payment_status', v_payment_status,
        'total_amount', v_total_amount,
        'created_at', v_order_created_at,
        'item_count', v_requested_item_count,
        'order_source', v_order_source
      )
    );
  end if;

  return query
  select
    orders.id,
    orders.order_number,
    orders.store_id,
    orders.customer_id,
    orders.order_status,
    orders.payment_method,
    orders.payment_status,
    orders.order_source,
    orders.subtotal_amount,
    orders.tax_fee_amount,
    orders.total_amount,
    orders.created_at
  from public.orders
  where orders.id = v_order_id
    and orders.store_id = p_store_id;
end;
$$;

comment on function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, boolean
) is
'Trusted seller/admin RPC for atomically creating manual/offline orders. It reuses existing customer/order/order_item structures, floors inventory at zero when seller override exceeds listed availability, logs inventory override context, preserves idempotency, and can optionally enqueue existing transactional email notifications.';

revoke all on function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, boolean
) from public;

grant execute on function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, boolean
) to authenticated;
