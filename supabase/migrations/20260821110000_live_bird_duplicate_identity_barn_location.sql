begin;

alter table public.inventory_items
  add column barn_location text;

alter table public.inventory_items
  add constraint inventory_items_barn_location_length_check check (
    barn_location is null
    or char_length(barn_location) between 1 and 200
  );

comment on column public.inventory_items.barn_location is
'Optional seller-private operational location for a live-bird inventory row. Never expose through buyer/public storefront projections.';

create function public.normalize_inventory_item_barn_location()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.barn_location := nullif(btrim(new.barn_location), '');

  if char_length(new.barn_location) > 200 then
    raise exception 'Barn location must be 200 characters or fewer.';
  end if;

  return new;
end;
$function$;

create trigger inventory_items_normalize_barn_location
before insert or update of barn_location on public.inventory_items
for each row
execute function public.normalize_inventory_item_barn_location();

alter table public.inventory_items
  drop constraint inventory_items_batch_breed_type_unique;

drop function public.seller_create_inventory_item(
  uuid, text, text, integer, numeric, integer, text, text
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
  p_barn_location text default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
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

  select *
  into v_batch_breed
  from public.listing_batch_breeds
  where listing_batch_breeds.id = p_listing_batch_breed_id;

  if v_batch_breed.id is null then
    raise exception 'Listing batch breed not found.';
  end if;

  if not (public.owns_store(v_batch_breed.store_id) or public.is_admin()) then
    raise exception 'Not authorized to add inventory to this listing batch breed.';
  end if;

  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = v_batch_breed.listing_batch_id;

  if v_batch.id is null or v_batch.store_id <> v_batch_breed.store_id then
    raise exception 'Listing batch hierarchy is invalid.';
  end if;

  if (
    v_batch.batch_type = 'hatching_eggs'
    and p_inventory_type <> 'hatching_eggs'
  ) or (
    v_batch.batch_type = 'live_animals'
    and p_inventory_type = 'hatching_eggs'
  ) then
    raise exception 'Inventory type is not compatible with listing batch type.';
  end if;

  insert into public.inventory_items (
    store_id, listing_batch_id, listing_batch_breed_id, inventory_type,
    custom_inventory_label, quantity_available, price_override, sort_order,
    visibility_status, seller_notes, barn_location
  )
  values (
    v_batch_breed.store_id, v_batch_breed.listing_batch_id, v_batch_breed.id,
    p_inventory_type, nullif(trim(p_custom_inventory_label), ''),
    coalesce(p_quantity_available, 0), p_price_override,
    coalesce(p_sort_order, 0), p_visibility_status,
    nullif(trim(p_seller_notes), ''), nullif(btrim(p_barn_location), '')
  )
  returning * into v_item;

  perform public.log_inventory_activity_event(
    v_item.store_id, v_item.listing_batch_id, v_item.listing_batch_breed_id,
    v_item.id, 'inventory_item_created', null, v_item.quantity_available,
    null, v_item.visibility_status, null,
    jsonb_build_object('inventory_type', v_item.inventory_type)
  );

  return v_item;
end;
$function$;

comment on function public.seller_create_inventory_item(
  uuid, text, text, integer, numeric, integer, text, text, text
) is
'Trusted seller/admin RPC to create an inventory row, including optional private barn location, while enforcing ownership, hierarchy, quantity, and batch type compatibility.';

revoke all on function public.seller_create_inventory_item(
  uuid, text, text, integer, numeric, integer, text, text, text
) from public;
grant execute on function public.seller_create_inventory_item(
  uuid, text, text, integer, numeric, integer, text, text, text
) to authenticated;

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
as $function$
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

  if exists (
    select 1
    from jsonb_array_elements(p_breed_groups) as breed_group(value)
    cross join lateral jsonb_array_elements(breed_group.value -> 'inventory_items')
      as inventory_item(value)
    where nullif(btrim(inventory_item.value ->> 'client_row_token'), '') is not null
    group by btrim(inventory_item.value ->> 'client_row_token')
    having count(*) > 1
  ) then
    raise exception 'Client row tokens must be unique within one inventory creation request.';
  end if;

  v_batch := public.seller_create_listing_batch(
    p_store_id, p_species_id, p_batch_type, p_origin_date, p_available_date,
    p_base_price, p_auto_price_increase_enabled, p_auto_price_increase_amount,
    p_auto_price_increase_max_price, p_internal_batch_label, p_seller_notes,
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
      from jsonb_array_elements(v_group -> 'inventory_items')
        as inventory_item(value)
    loop
      v_item_index := v_item_index + 1;

      if jsonb_typeof(v_item) <> 'object'
        or not (v_item ? 'inventory_type')
        or not (v_item ? 'quantity_available')
        or v_item ->> 'quantity_available' !~ '^[0-9]+$'
        or (v_item ? 'sort_order' and v_item ->> 'sort_order' !~ '^[0-9]+$')
        or (
          v_item ? 'price_override'
          and v_item ->> 'price_override' !~ '^[0-9]+(\.[0-9]{1,2})?$'
        )
        or char_length(btrim(v_item ->> 'client_row_token')) > 200
        or char_length(btrim(v_item ->> 'barn_location')) > 200 then
        raise exception 'Each inventory item must include a valid inventory type, nonnegative quantity, and optional values within their limits.';
      end if;

      v_inventory_item := public.seller_create_inventory_item(
        v_batch_breed.id,
        v_item ->> 'inventory_type',
        v_item ->> 'custom_inventory_label',
        (v_item ->> 'quantity_available')::integer,
        case when v_item ? 'price_override'
          then (v_item ->> 'price_override')::numeric else null end,
        case when v_item ? 'sort_order'
          then (v_item ->> 'sort_order')::integer else v_item_index - 1 end,
        coalesce(nullif(v_item ->> 'visibility_status', ''), 'active'),
        v_item ->> 'seller_notes',
        v_item ->> 'barn_location'
      );

      v_inventory_items := v_inventory_items || jsonb_build_array(
        to_jsonb(v_inventory_item) || jsonb_build_object(
          'client_row_token', nullif(btrim(v_item ->> 'client_row_token'), '')
        )
      );
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
    v_batch.id, v_batch.store_id, v_batch.species_id, v_batch.batch_type,
    v_batch.origin_date, v_batch.available_date, v_batch.base_price,
    v_batch.visibility_status, v_breed_groups;
end;
$function$;

comment on function public.seller_create_listing_batch_with_inventory(
  uuid, uuid, text, date, date, numeric, jsonb, boolean, numeric, numeric,
  text, text, text
) is
'Create-time seller UI orchestration RPC. Echoes optional client row tokens beside generated inventory UUIDs and accepts optional private barn location.';

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
  inventory_items.barn_location
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
'Seller-private inventory/listing management projection for dashboard screens. Includes private barn location and archive metadata.';

grant select on public.seller_inventory_management to authenticated;

commit;
