begin;

alter table public.inventory_items
  add column breeding_history text,
  add column feather_condition text,
  add constraint inventory_items_breeding_history_check check (
    breeding_history is null or breeding_history in ('never_bred', 'breeder')
  ),
  add constraint inventory_items_feather_condition_check check (
    feather_condition is null
    or feather_condition in ('excellent', 'good', 'rough', 'very_rough')
  );

comment on column public.inventory_items.breeding_history is
'Optional buyer-facing breeding history for this exact Live Birds inventory lot.';
comment on column public.inventory_items.feather_condition is
'Optional buyer-facing feather condition for this exact Live Birds inventory lot.';

alter table public.order_items
  add column breeding_history_snapshot text,
  add column feather_condition_snapshot text,
  add constraint order_items_breeding_history_snapshot_check check (
    breeding_history_snapshot is null
    or breeding_history_snapshot in ('never_bred', 'breeder')
  ),
  add constraint order_items_feather_condition_snapshot_check check (
    feather_condition_snapshot is null
    or feather_condition_snapshot in ('excellent', 'good', 'rough', 'very_rough')
  );

comment on column public.order_items.breeding_history_snapshot is
'Immutable buyer-facing breeding history captured from the selected inventory UUID when the order line is created.';
comment on column public.order_items.feather_condition_snapshot is
'Immutable buyer-facing feather condition captured from the selected inventory UUID when the order line is created.';

create function public.snapshot_live_bird_advanced_attributes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if new.inventory_item_id is not null then
    select inventory_items.breeding_history, inventory_items.feather_condition
    into new.breeding_history_snapshot, new.feather_condition_snapshot
    from public.inventory_items
    where inventory_items.id = new.inventory_item_id
      and inventory_items.store_id = new.store_id;
  else
    new.breeding_history_snapshot := null;
    new.feather_condition_snapshot := null;
  end if;

  return new;
end;
$function$;

revoke all on function public.snapshot_live_bird_advanced_attributes()
from public, anon, authenticated;

create trigger order_items_snapshot_live_bird_advanced_attributes
before insert on public.order_items
for each row execute function public.snapshot_live_bird_advanced_attributes();

drop function public.seller_create_inventory_item(
  uuid, text, text, integer, numeric, integer, text, text, text
);

create function public.seller_create_inventory_item(
  p_listing_batch_breed_id uuid,
  p_inventory_type text,
  p_custom_inventory_label text default null,
  p_quantity_available integer default 0,
  p_price_override numeric default null,
  p_sort_order integer default 0,
  p_visibility_status text default 'active',
  p_seller_notes text default null,
  p_barn_location text default null,
  p_breeding_history text default null,
  p_feather_condition text default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_batch public.listing_batches%rowtype;
  v_batch_breed public.listing_batch_breeds%rowtype;
  v_item public.inventory_items%rowtype;
begin
  if p_inventory_type is null
    or p_inventory_type not in (
      'female', 'male', 'straight_run', 'unsexed', 'pair', 'trio',
      'hatching_eggs', 'other'
    ) then
    raise exception 'Invalid inventory type.';
  end if;
  if p_inventory_type = 'other'
    and nullif(trim(p_custom_inventory_label), '') is null then
    raise exception 'Custom inventory label is required for other inventory type.';
  end if;
  if p_visibility_status is null
    or p_visibility_status not in ('active', 'hidden', 'archived') then
    raise exception 'Invalid inventory visibility status.';
  end if;
  if coalesce(p_quantity_available, 0) < 0 then
    raise exception 'Inventory quantity cannot be negative.';
  end if;
  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'Sort order must be nonnegative.';
  end if;
  if char_length(btrim(p_barn_location)) > 200 then
    raise exception 'Barn location must be 200 characters or fewer.';
  end if;
  if p_breeding_history is not null
    and p_breeding_history not in ('never_bred', 'breeder') then
    raise exception 'Invalid breeding history.';
  end if;
  if p_feather_condition is not null
    and p_feather_condition not in ('excellent', 'good', 'rough', 'very_rough') then
    raise exception 'Invalid feather condition.';
  end if;

  select * into v_batch_breed
  from public.listing_batch_breeds
  where listing_batch_breeds.id = p_listing_batch_breed_id;
  if v_batch_breed.id is null then
    raise exception 'Listing batch breed not found.';
  end if;
  if not (public.owns_store(v_batch_breed.store_id) or public.is_admin()) then
    raise exception 'Not authorized to add inventory to this listing batch breed.';
  end if;

  select * into v_batch
  from public.listing_batches
  where listing_batches.id = v_batch_breed.listing_batch_id;
  if v_batch.id is null or v_batch.store_id <> v_batch_breed.store_id then
    raise exception 'Listing batch hierarchy is invalid.';
  end if;
  if (v_batch.batch_type = 'hatching_eggs' and p_inventory_type <> 'hatching_eggs')
    or (v_batch.batch_type = 'live_animals' and p_inventory_type = 'hatching_eggs') then
    raise exception 'Inventory type is not compatible with listing batch type.';
  end if;

  insert into public.inventory_items (
    store_id, listing_batch_id, listing_batch_breed_id, inventory_type,
    custom_inventory_label, quantity_available, price_override, sort_order,
    visibility_status, seller_notes, barn_location, breeding_history,
    feather_condition
  ) values (
    v_batch_breed.store_id, v_batch_breed.listing_batch_id, v_batch_breed.id,
    p_inventory_type, nullif(trim(p_custom_inventory_label), ''),
    coalesce(p_quantity_available, 0), p_price_override,
    coalesce(p_sort_order, 0), p_visibility_status,
    nullif(trim(p_seller_notes), ''), nullif(btrim(p_barn_location), ''),
    p_breeding_history, p_feather_condition
  ) returning * into v_item;

  perform public.log_inventory_activity_event(
    v_item.store_id, v_item.listing_batch_id, v_item.listing_batch_breed_id,
    v_item.id, 'inventory_item_created', null, v_item.quantity_available,
    null, v_item.visibility_status, null,
    jsonb_build_object('inventory_type', v_item.inventory_type)
  );
  return v_item;
end;
$function$;

revoke all on function public.seller_create_inventory_item(
  uuid, text, text, integer, numeric, integer, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.seller_create_inventory_item(
  uuid, text, text, integer, numeric, integer, text, text, text, text, text
) to authenticated;

do $patch_creation_functions$
declare
  v_definition text;
  v_patched text;
begin
  v_definition := pg_get_functiondef(
    'public.seller_create_listing_batch_with_inventory(uuid,uuid,text,date,date,numeric,jsonb,boolean,numeric,numeric,text,text,text)'::regprocedure
  );
  v_patched := replace(
    v_definition,
    $$v_item ->> 'barn_location'
      );$$,
    $$v_item ->> 'barn_location',
        v_item ->> 'breeding_history',
        v_item ->> 'feather_condition'
      );$$
  );
  if v_patched = v_definition then
    raise exception 'Could not patch seller_create_listing_batch_with_inventory advanced attributes.';
  end if;
  execute v_patched;

  v_definition := pg_get_functiondef(
    'public.seller_create_live_bird_batches(uuid,uuid,jsonb)'::regprocedure
  );
  v_patched := replace(
    v_definition,
    $$if char_length(btrim(v_item ->> 'barn_location')) > 200 then
          return query select false, false, 'row_validation_error',
            'Barn Location must be 200 characters or fewer.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;$$,
    $$if char_length(btrim(v_item ->> 'barn_location')) > 200 then
          return query select false, false, 'row_validation_error',
            'Barn Location must be 200 characters or fewer.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;
        if nullif(v_item ->> 'breeding_history', '') is not null
          and v_item ->> 'breeding_history' not in ('never_bred', 'breeder') then
          return query select false, false, 'row_validation_error',
            'Choose a valid Breeding History value.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;
        if nullif(v_item ->> 'feather_condition', '') is not null
          and v_item ->> 'feather_condition' not in ('excellent', 'good', 'rough', 'very_rough') then
          return query select false, false, 'row_validation_error',
            'Choose a valid Feather Condition value.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;$$
  );
  if v_patched = v_definition then
    raise exception 'Could not patch seller_create_live_bird_batches advanced validation.';
  end if;
  v_definition := v_patched;

  v_patched := replace(
    v_definition,
    $$'barn_location', nullif(btrim(v_item ->> 'barn_location'), ''),
          'visibility_status', 'active'$$,
    $$'barn_location', nullif(btrim(v_item ->> 'barn_location'), ''),
          'breeding_history', nullif(v_item ->> 'breeding_history', ''),
          'feather_condition', nullif(v_item ->> 'feather_condition', ''),
          'visibility_status', 'active'$$
  );
  if v_patched = v_definition then
    raise exception 'Could not patch seller_create_live_bird_batches advanced attributes.';
  end if;
  execute v_patched;
end;
$patch_creation_functions$;

create or replace view public.public_storefront_breed_inventory
with (security_barrier = true)
as
select
  store_id, store_slug, seller_breed_profile_id, species_id, species_name,
  species_slug, breed_display_name, breed_description, listing_batch_id,
  listing_batch_breed_id, inventory_item_id, inventory_type,
  custom_inventory_label, quantity_available, availability_status,
  available_date, is_available_now, unit_price, featured_image_url,
  featured_image_alt_text, breed_sort_order, inventory_sort_order, batch_type,
  age_at_availability_days, entry_photo_url, entry_photo_alt,
  breeding_history, feather_condition
from (
  select
    stores.id as store_id, stores.store_slug,
    seller_breed_profiles.id as seller_breed_profile_id,
    species.id as species_id, species.common_name as species_name, species.slug as species_slug,
    seller_breed_profiles.display_name as breed_display_name,
    seller_breed_profiles.seller_description as breed_description,
    listing_batches.id as listing_batch_id, listing_batch_breeds.id as listing_batch_breed_id,
    inventory_items.id as inventory_item_id, inventory_items.inventory_type,
    inventory_items.custom_inventory_label, inventory_items.quantity_available,
    case when listing_batches.visibility_status = 'sold_out' or inventory_items.quantity_available <= 0 then 'sold_out'
         when listing_batches.available_date > current_date then 'coming_soon'
         when inventory_items.quantity_available <= 3 then 'limited_availability' else 'available' end as availability_status,
    listing_batches.available_date,
    (listing_batches.available_date <= current_date and listing_batches.visibility_status <> 'sold_out' and inventory_items.quantity_available > 0) as is_available_now,
    public.calculate_inventory_unit_price(listing_batches.base_price, inventory_items.price_override,
      listing_batches.auto_price_adjustment_enabled, listing_batches.price_adjustment_direction,
      listing_batches.price_adjustment_amount, listing_batches.price_adjustment_interval_weeks,
      listing_batches.price_adjustment_max_price, listing_batches.price_adjustment_min_price,
      listing_batches.available_date) as unit_price,
    coalesce(inventory_media.image_url, breed_profile_media.image_url, store_media.image_url) as featured_image_url,
    coalesce(inventory_media.alt_text, breed_profile_media.alt_text, store_media.alt_text) as featured_image_alt_text,
    listing_batch_breeds.sort_order as breed_sort_order, inventory_items.sort_order as inventory_sort_order,
    listing_batches.batch_type,
    case when listing_batches.batch_type = 'live_animals' then listing_batches.age_at_availability_days else null end as age_at_availability_days,
    inventory_media.image_url as entry_photo_url,
    inventory_media.alt_text as entry_photo_alt,
    inventory_items.breeding_history,
    inventory_items.feather_condition
  from public.inventory_items
  join public.listing_batch_breeds on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
  join public.listing_batches on listing_batches.id = inventory_items.listing_batch_id
  join public.seller_breed_profiles on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
  join public.stores on stores.id = inventory_items.store_id
  join public.species on species.id = listing_batches.species_id
  left join lateral (
    select '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links join public.media_assets on media_assets.id = media_links.media_asset_id and media_assets.store_id = media_links.store_id
    where media_links.store_id = inventory_items.store_id and media_links.entity_type = 'inventory_item'
      and media_links.entity_id = inventory_items.id and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active' and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at limit 1
  ) as inventory_media on true
  left join lateral (
    select '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links join public.media_assets on media_assets.id = media_links.media_asset_id and media_assets.store_id = media_links.store_id
    where media_links.store_id = seller_breed_profiles.store_id and media_links.entity_type = 'seller_breed_profile'
      and media_links.entity_id = seller_breed_profiles.id and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active' and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at limit 1
  ) as breed_profile_media on true
  left join lateral (
    select '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links join public.media_assets on media_assets.id = media_links.media_asset_id and media_assets.store_id = media_links.store_id
    where media_links.store_id = stores.id and media_links.entity_type = 'store' and media_links.entity_id = stores.id
      and media_links.visibility_status = 'active' and media_assets.asset_status = 'active' and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at limit 1
  ) as store_media on true
  where stores.storefront_enabled = true and stores.store_status = 'live' and stores.storefront_mode in ('hosted', 'embedded')
    and stores.admin_hold_reason is null and species.is_active = true
    and seller_breed_profiles.visibility_status = 'active' and seller_breed_profiles.moderation_status = 'normal'
    and listing_batches.visibility_status in ('active', 'sold_out') and listing_batches.moderation_status = 'normal'
    and listing_batch_breeds.visibility_status = 'active' and listing_batch_breeds.moderation_status = 'normal'
    and inventory_items.visibility_status = 'active' and inventory_items.moderation_status = 'normal'
    and ((listing_batches.batch_type = 'hatching_eggs' and inventory_items.inventory_type = 'hatching_eggs')
      or (listing_batches.batch_type = 'live_animals' and inventory_items.inventory_type <> 'hatching_eggs'))
) as entitlement_filtered
where public.store_has_active_entitlement(store_id);

create or replace view public.public_storefront_inventory
with (security_barrier = true)
as
select
  public_storefront_breed_inventory.store_id, public_storefront_breed_inventory.store_slug,
  public_storefront_breed_inventory.species_id, public_storefront_breed_inventory.species_name, public_storefront_breed_inventory.species_slug,
  public_storefront_breed_inventory.seller_breed_profile_id, public_storefront_breed_inventory.breed_display_name, public_storefront_breed_inventory.breed_description,
  public_storefront_breed_inventory.listing_batch_id, public_storefront_breed_inventory.listing_batch_breed_id, public_storefront_breed_inventory.inventory_item_id,
  public_storefront_breed_inventory.inventory_type, public_storefront_breed_inventory.custom_inventory_label, public_storefront_breed_inventory.quantity_available,
  case when public_storefront_breed_inventory.quantity_available <= 0 or public_storefront_breed_inventory.availability_status = 'sold_out' then 'sold_out'
       when public_storefront_breed_inventory.available_date > current_date then 'reserve_now' else 'ready_now' end as buyer_availability_code,
  case when public_storefront_breed_inventory.quantity_available <= 0 or public_storefront_breed_inventory.availability_status = 'sold_out' then 'Sold out'
       when public_storefront_breed_inventory.available_date > current_date then 'Reserve now' else 'Ready now' end as buyer_availability_label,
  public_storefront_breed_inventory.available_date, public_storefront_breed_inventory.is_available_now,
  (public_storefront_breed_inventory.quantity_available > 0 and public_storefront_breed_inventory.availability_status <> 'sold_out') as can_checkout,
  public_storefront_breed_inventory.unit_price, public_storefront_breed_inventory.featured_image_url, public_storefront_breed_inventory.featured_image_alt_text,
  public_storefront_breed_inventory.breed_sort_order, public_storefront_breed_inventory.inventory_sort_order, public_storefront_breed_inventory.batch_type,
  public_storefront_breed_inventory.age_at_availability_days, listing_batches.origin_date,
  seller_breed_profiles.breed_category, seller_breed_profiles.egg_color as breed_egg_color,
  seller_breed_profiles.annual_egg_production as breed_annual_egg_production,
  public_storefront_breed_inventory.entry_photo_url, public_storefront_breed_inventory.entry_photo_alt,
  public_storefront_breed_inventory.breeding_history,
  public_storefront_breed_inventory.feather_condition
from public.public_storefront_breed_inventory
join public.stores on stores.id = public_storefront_breed_inventory.store_id
join public.listing_batches on listing_batches.id = public_storefront_breed_inventory.listing_batch_id
left join public.seller_breed_profiles on seller_breed_profiles.id = public_storefront_breed_inventory.seller_breed_profile_id
where (coalesce(public_storefront_breed_inventory.batch_type, '') <> 'hatching_eggs'
  and coalesce(public_storefront_breed_inventory.inventory_type, '') <> 'hatching_eggs')
  or (stores.hatching_eggs_enabled = true and public.store_has_public_market_entitlement(stores.id));

create or replace view public.public_storefront_item_detail
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
  public_storefront_inventory.age_at_availability_days,
  public_storefront_inventory.breeding_history,
  public_storefront_inventory.feather_condition
from public.public_storefront_inventory
join public.public_storefronts
  on public_storefronts.store_id = public_storefront_inventory.store_id;

grant select on public.public_storefront_breed_inventory,
  public.public_storefront_inventory,
  public.public_storefront_item_detail to anon, authenticated;

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
    listing_batches.base_price, inventory_items.price_override,
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
      or inventory_items.visibility_status = 'archived' then 'archived'
    when listing_batches.moderation_status <> 'normal'
      or listing_batch_breeds.moderation_status <> 'normal'
      or inventory_items.moderation_status <> 'normal'
      or seller_breed_profiles.moderation_status <> 'normal' then 'unavailable'
    when listing_batches.visibility_status = 'sold_out'
      or inventory_items.quantity_available <= 0 then 'sold_out'
    when listing_batches.visibility_status <> 'active'
      or listing_batch_breeds.visibility_status <> 'active'
      or inventory_items.visibility_status <> 'active'
      or seller_breed_profiles.visibility_status <> 'active' then 'hidden'
    when listing_batches.available_date > current_date then 'reserve_now'
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
  listing_batches.price_adjustment_min_price,
  inventory_items.cleared_at,
  inventory_items.archived_at,
  inventory_items.barn_location,
  inventory_items.breeding_history,
  inventory_items.feather_condition
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
join public.species on species.id = listing_batches.species_id
where public.owns_store(inventory_items.store_id) or public.is_admin();

comment on view public.seller_inventory_management is
'Seller-private inventory management projection including barn location and advanced buyer attributes.';

grant select on public.seller_inventory_management to authenticated;

create or replace view public.seller_order_item_detail
with (security_barrier = true)
as
select
  oi.store_id, oi.order_id, oi.id as order_item_id, o.order_number,
  oi.inventory_item_id, oi.equipment_inventory_item_id,
  oi.processed_poultry_inventory_item_id, oi.listing_batch_id,
  oi.listing_batch_breed_id, oi.seller_breed_profile_id, oi.species_id,
  oi.species_name_snapshot, oi.species_slug_snapshot,
  oi.breed_display_name_snapshot, oi.breed_description_snapshot,
  oi.inventory_type_snapshot, oi.custom_inventory_label_snapshot,
  oi.batch_type_snapshot, oi.product_type_snapshot, oi.item_name_snapshot,
  oi.item_category_snapshot, oi.available_date_snapshot,
  oi.age_at_availability_days_snapshot, oi.unit_price_snapshot, oi.quantity,
  oi.fulfilled_quantity, oi.restored_quantity,
  case when o.order_status = 'canceled' then 0
       else greatest(oi.quantity - oi.fulfilled_quantity - oi.restored_quantity, 0)
  end as remaining_unfulfilled_quantity,
  oi.line_subtotal, oi.created_at, oi.hatch_date_snapshot,
  oi.age_at_sale_days_snapshot, oi.order_item_source,
  oi.custom_item_name_snapshot, oi.hatching_egg_inventory_item_id,
  oi.breeding_history_snapshot, oi.feather_condition_snapshot
from public.order_items as oi
join public.orders as o on o.id = oi.order_id and o.store_id = oi.store_id
where public.owns_store(oi.store_id) or public.is_admin();

grant select on public.seller_order_item_detail to authenticated;

do $patch_preview$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_seller_storefront_preview_data'
    and pg_get_function_identity_arguments(p.oid) = 'p_store_slug text';

  v_patched := replace(
    v_definition,
    'inventory_items.custom_inventory_label,',
    'inventory_items.custom_inventory_label, inventory_items.breeding_history, inventory_items.feather_condition,'
  );
  if v_definition is null or v_patched = v_definition then
    raise exception 'Could not patch seller storefront preview advanced attributes.';
  end if;
  execute v_patched;
end;
$patch_preview$;

commit;
