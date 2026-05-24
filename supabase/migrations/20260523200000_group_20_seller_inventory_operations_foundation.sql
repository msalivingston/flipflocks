-- Group 20: Seller Inventory Operations Foundation
--
-- Scope:
-- - Adds a trusted seller inventory operation layer over the existing
--   listing_batches, listing_batch_breeds, and inventory_items tables.
-- - Adds a lightweight inventory activity history for practical seller
--   operations and troubleshooting.
--
-- This group does not add:
-- - marketplace behavior
-- - buyer accounts
-- - payment or reservation logic
-- - materialized dashboard/storefront projections
-- - an ERP-style inventory ledger


create table public.inventory_activity_events (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  listing_batch_id uuid references public.listing_batches(id) on delete set null,
  listing_batch_breed_id uuid references public.listing_batch_breeds(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,

  actor_user_id uuid references auth.users(id),
  actor_type text not null,
  event_type text not null,

  from_quantity_available integer,
  to_quantity_available integer,
  from_visibility_status text,
  to_visibility_status text,

  note text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint inventory_activity_events_actor_type_check check (
    actor_type in ('seller', 'admin', 'system')
  ),

  constraint inventory_activity_events_event_type_check check (
    event_type in (
      'listing_batch_created',
      'listing_batch_updated',
      'listing_batch_visibility_changed',
      'listing_batch_breed_created',
      'listing_batch_breed_updated',
      'listing_batch_breed_visibility_changed',
      'inventory_item_created',
      'inventory_item_updated',
      'inventory_quantity_adjusted',
      'inventory_visibility_changed'
    )
  ),

  constraint inventory_activity_events_from_quantity_nonnegative_check check (
    from_quantity_available is null
    or from_quantity_available >= 0
  ),

  constraint inventory_activity_events_to_quantity_nonnegative_check check (
    to_quantity_available is null
    or to_quantity_available >= 0
  ),

  constraint inventory_activity_events_note_not_empty_check check (
    note is null
    or length(trim(note)) > 0
  ),

  constraint inventory_activity_events_metadata_object_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

comment on table public.inventory_activity_events is
'Append-only seller/admin inventory activity history for V1 inventory operations. This is a lightweight operational audit trail, not a financial or ERP inventory ledger.';

comment on column public.inventory_activity_events.store_id is
'Tenant ownership field used for RLS and seller/admin access checks.';

comment on column public.inventory_activity_events.listing_batch_id is
'Related listing batch when the inventory operation applies to a batch or descendant row.';

comment on column public.inventory_activity_events.listing_batch_breed_id is
'Related batch breed row when the inventory operation applies to a breed grouping or descendant inventory item.';

comment on column public.inventory_activity_events.inventory_item_id is
'Related inventory item when the inventory operation applies to an inventory row.';

comment on column public.inventory_activity_events.actor_user_id is
'Authenticated user who caused the inventory operation when available.';

comment on column public.inventory_activity_events.actor_type is
'Actor category for the event: seller, admin, or system.';

comment on column public.inventory_activity_events.event_type is
'Simple event type describing the trusted inventory operation.';

comment on column public.inventory_activity_events.note is
'Optional seller/admin note explaining the operation. Intended for practical reasons such as offline sale, miscount, holdback, or correction.';

comment on column public.inventory_activity_events.metadata is
'Small JSON object for operation-specific context. Keep simple; not intended as a workflow engine.';

create index inventory_activity_events_store_created_at_idx
on public.inventory_activity_events(store_id, created_at desc);

create index inventory_activity_events_inventory_item_created_at_idx
on public.inventory_activity_events(inventory_item_id, created_at desc)
where inventory_item_id is not null;

create index inventory_activity_events_listing_batch_created_at_idx
on public.inventory_activity_events(listing_batch_id, created_at desc)
where listing_batch_id is not null;

alter table public.inventory_activity_events enable row level security;

create policy "Store owners can read own inventory activity events"
on public.inventory_activity_events
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Platform admins can delete inventory activity events"
on public.inventory_activity_events
for delete
to authenticated
using (
  public.is_admin()
);


create or replace function public.log_inventory_activity_event(
  p_store_id uuid,
  p_listing_batch_id uuid,
  p_listing_batch_breed_id uuid,
  p_inventory_item_id uuid,
  p_event_type text,
  p_from_quantity_available integer,
  p_to_quantity_available integer,
  p_from_visibility_status text,
  p_to_visibility_status text,
  p_note text,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type text;
begin
  if public.is_admin() then
    v_actor_type := 'admin';
  else
    v_actor_type := 'seller';
  end if;

  insert into public.inventory_activity_events (
    store_id,
    listing_batch_id,
    listing_batch_breed_id,
    inventory_item_id,
    actor_user_id,
    actor_type,
    event_type,
    from_quantity_available,
    to_quantity_available,
    from_visibility_status,
    to_visibility_status,
    note,
    metadata
  )
  values (
    p_store_id,
    p_listing_batch_id,
    p_listing_batch_breed_id,
    p_inventory_item_id,
    auth.uid(),
    v_actor_type,
    p_event_type,
    p_from_quantity_available,
    p_to_quantity_available,
    p_from_visibility_status,
    p_to_visibility_status,
    nullif(trim(p_note), ''),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

comment on function public.log_inventory_activity_event(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  integer,
  integer,
  text,
  text,
  text,
  jsonb
) is
'Internal trusted helper used by seller inventory operation RPCs to append lightweight inventory activity events.';

revoke all on function public.log_inventory_activity_event(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  integer,
  integer,
  text,
  text,
  text,
  jsonb
) from public;


create or replace function public.seller_create_listing_batch(
  p_store_id uuid,
  p_species_id uuid,
  p_batch_type text,
  p_origin_date date,
  p_available_date date,
  p_base_price numeric,
  p_auto_price_increase_enabled boolean default false,
  p_auto_price_increase_amount numeric default null,
  p_auto_price_increase_max_price numeric default null,
  p_internal_batch_label text default null,
  p_seller_notes text default null,
  p_visibility_status text default 'hidden'
)
returns public.listing_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_origin_date date;
begin
  if not (
    public.owns_store(p_store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to create listing batches for this store.';
  end if;

  if p_batch_type is null
    or p_batch_type not in ('live_animals', 'hatching_eggs') then
    raise exception 'Invalid listing batch type.';
  end if;

  if p_visibility_status is null
    or p_visibility_status not in ('active', 'hidden', 'sold_out', 'archived') then
    raise exception 'Invalid listing batch visibility status.';
  end if;

  if p_available_date is null then
    raise exception 'Available date is required.';
  end if;

  if p_batch_type = 'hatching_eggs' then
    v_origin_date := p_available_date;
  else
    if p_origin_date is null then
      raise exception 'Origin date is required for live animal batches.';
    end if;

    v_origin_date := p_origin_date;
  end if;

  if not exists (
    select 1
    from public.species
    where species.id = p_species_id
      and species.is_active = true
  ) then
    raise exception 'Species is not available.';
  end if;

  insert into public.listing_batches (
    store_id,
    species_id,
    batch_type,
    origin_date,
    available_date,
    base_price,
    auto_price_increase_enabled,
    auto_price_increase_amount,
    auto_price_increase_max_price,
    internal_batch_label,
    seller_notes,
    visibility_status
  )
  values (
    p_store_id,
    p_species_id,
    p_batch_type,
    v_origin_date,
    p_available_date,
    p_base_price,
    coalesce(p_auto_price_increase_enabled, false),
    case
      when coalesce(p_auto_price_increase_enabled, false)
        then p_auto_price_increase_amount
      else null
    end,
    case
      when coalesce(p_auto_price_increase_enabled, false)
        then p_auto_price_increase_max_price
      else null
    end,
    nullif(trim(p_internal_batch_label), ''),
    nullif(trim(p_seller_notes), ''),
    p_visibility_status
  )
  returning * into v_batch;

  perform public.log_inventory_activity_event(
    v_batch.store_id,
    v_batch.id,
    null,
    null,
    'listing_batch_created',
    null,
    null,
    null,
    v_batch.visibility_status,
    null,
    jsonb_build_object(
      'species_id', v_batch.species_id,
      'batch_type', v_batch.batch_type
    )
  );

  return v_batch;
end;
$$;


create or replace function public.seller_update_listing_batch(
  p_listing_batch_id uuid,
  p_origin_date date,
  p_available_date date,
  p_base_price numeric,
  p_auto_price_increase_enabled boolean default false,
  p_auto_price_increase_amount numeric default null,
  p_auto_price_increase_max_price numeric default null,
  p_internal_batch_label text default null,
  p_seller_notes text default null
)
returns public.listing_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_updated_batch public.listing_batches%rowtype;
  v_origin_date date;
begin
  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id
  for update;

  if v_batch.id is null then
    raise exception 'Listing batch not found.';
  end if;

  if not (
    public.owns_store(v_batch.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this listing batch.';
  end if;

  if p_available_date is null then
    raise exception 'Available date is required.';
  end if;

  if v_batch.batch_type = 'hatching_eggs' then
    v_origin_date := p_available_date;
  else
    if p_origin_date is null then
      raise exception 'Origin date is required for live animal batches.';
    end if;

    v_origin_date := p_origin_date;
  end if;

  update public.listing_batches
  set
    origin_date = v_origin_date,
    available_date = p_available_date,
    base_price = p_base_price,
    auto_price_increase_enabled = coalesce(p_auto_price_increase_enabled, false),
    auto_price_increase_amount = case
      when coalesce(p_auto_price_increase_enabled, false)
        then p_auto_price_increase_amount
      else null
    end,
    auto_price_increase_max_price = case
      when coalesce(p_auto_price_increase_enabled, false)
        then p_auto_price_increase_max_price
      else null
    end,
    internal_batch_label = nullif(trim(p_internal_batch_label), ''),
    seller_notes = nullif(trim(p_seller_notes), '')
  where listing_batches.id = v_batch.id
  returning * into v_updated_batch;

  perform public.log_inventory_activity_event(
    v_updated_batch.store_id,
    v_updated_batch.id,
    null,
    null,
    'listing_batch_updated',
    null,
    null,
    v_batch.visibility_status,
    v_updated_batch.visibility_status,
    null,
    jsonb_build_object(
      'previous_available_date', v_batch.available_date,
      'new_available_date', v_updated_batch.available_date,
      'previous_base_price', v_batch.base_price,
      'new_base_price', v_updated_batch.base_price
    )
  );

  return v_updated_batch;
end;
$$;


create or replace function public.seller_set_listing_batch_visibility(
  p_listing_batch_id uuid,
  p_visibility_status text,
  p_note text default null
)
returns public.listing_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_updated_batch public.listing_batches%rowtype;
begin
  if p_visibility_status is null
    or p_visibility_status not in ('active', 'hidden', 'sold_out', 'archived') then
    raise exception 'Invalid listing batch visibility status.';
  end if;

  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id
  for update;

  if v_batch.id is null then
    raise exception 'Listing batch not found.';
  end if;

  if not (
    public.owns_store(v_batch.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this listing batch.';
  end if;

  update public.listing_batches
  set visibility_status = p_visibility_status
  where listing_batches.id = v_batch.id
  returning * into v_updated_batch;

  perform public.log_inventory_activity_event(
    v_updated_batch.store_id,
    v_updated_batch.id,
    null,
    null,
    'listing_batch_visibility_changed',
    null,
    null,
    v_batch.visibility_status,
    v_updated_batch.visibility_status,
    p_note,
    '{}'::jsonb
  );

  return v_updated_batch;
end;
$$;


create or replace function public.seller_add_listing_batch_breed(
  p_listing_batch_id uuid,
  p_seller_breed_profile_id uuid,
  p_seller_notes text default null,
  p_sort_order integer default 0,
  p_visibility_status text default 'active'
)
returns public.listing_batch_breeds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_profile public.seller_breed_profiles%rowtype;
  v_batch_breed public.listing_batch_breeds%rowtype;
begin
  if p_visibility_status is null
    or p_visibility_status not in ('active', 'hidden', 'archived') then
    raise exception 'Invalid listing batch breed visibility status.';
  end if;

  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'Sort order must be nonnegative.';
  end if;

  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id;

  if v_batch.id is null then
    raise exception 'Listing batch not found.';
  end if;

  if not (
    public.owns_store(v_batch.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this listing batch.';
  end if;

  select *
  into v_profile
  from public.seller_breed_profiles
  where seller_breed_profiles.id = p_seller_breed_profile_id
    and seller_breed_profiles.store_id = v_batch.store_id
    and seller_breed_profiles.species_id = v_batch.species_id;

  if v_profile.id is null then
    raise exception 'Seller breed profile is not available for this listing batch.';
  end if;

  if v_profile.visibility_status = 'archived'
    or v_profile.moderation_status <> 'normal' then
    raise exception 'Seller breed profile is not available for listing.';
  end if;

  insert into public.listing_batch_breeds (
    store_id,
    listing_batch_id,
    seller_breed_profile_id,
    seller_notes,
    sort_order,
    visibility_status
  )
  values (
    v_batch.store_id,
    v_batch.id,
    v_profile.id,
    nullif(trim(p_seller_notes), ''),
    coalesce(p_sort_order, 0),
    p_visibility_status
  )
  returning * into v_batch_breed;

  perform public.log_inventory_activity_event(
    v_batch_breed.store_id,
    v_batch_breed.listing_batch_id,
    v_batch_breed.id,
    null,
    'listing_batch_breed_created',
    null,
    null,
    null,
    v_batch_breed.visibility_status,
    null,
    jsonb_build_object(
      'seller_breed_profile_id', v_batch_breed.seller_breed_profile_id
    )
  );

  return v_batch_breed;
end;
$$;


create or replace function public.seller_update_listing_batch_breed(
  p_listing_batch_breed_id uuid,
  p_seller_notes text default null,
  p_sort_order integer default 0
)
returns public.listing_batch_breeds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_breed public.listing_batch_breeds%rowtype;
  v_updated_batch_breed public.listing_batch_breeds%rowtype;
begin
  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'Sort order must be nonnegative.';
  end if;

  select *
  into v_batch_breed
  from public.listing_batch_breeds
  where listing_batch_breeds.id = p_listing_batch_breed_id
  for update;

  if v_batch_breed.id is null then
    raise exception 'Listing batch breed not found.';
  end if;

  if not (
    public.owns_store(v_batch_breed.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this listing batch breed.';
  end if;

  update public.listing_batch_breeds
  set
    seller_notes = nullif(trim(p_seller_notes), ''),
    sort_order = coalesce(p_sort_order, 0)
  where listing_batch_breeds.id = v_batch_breed.id
  returning * into v_updated_batch_breed;

  perform public.log_inventory_activity_event(
    v_updated_batch_breed.store_id,
    v_updated_batch_breed.listing_batch_id,
    v_updated_batch_breed.id,
    null,
    'listing_batch_breed_updated',
    null,
    null,
    v_batch_breed.visibility_status,
    v_updated_batch_breed.visibility_status,
    null,
    jsonb_build_object(
      'previous_sort_order', v_batch_breed.sort_order,
      'new_sort_order', v_updated_batch_breed.sort_order
    )
  );

  return v_updated_batch_breed;
end;
$$;


create or replace function public.seller_set_listing_batch_breed_visibility(
  p_listing_batch_breed_id uuid,
  p_visibility_status text,
  p_note text default null
)
returns public.listing_batch_breeds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_breed public.listing_batch_breeds%rowtype;
  v_updated_batch_breed public.listing_batch_breeds%rowtype;
begin
  if p_visibility_status is null
    or p_visibility_status not in ('active', 'hidden', 'archived') then
    raise exception 'Invalid listing batch breed visibility status.';
  end if;

  select *
  into v_batch_breed
  from public.listing_batch_breeds
  where listing_batch_breeds.id = p_listing_batch_breed_id
  for update;

  if v_batch_breed.id is null then
    raise exception 'Listing batch breed not found.';
  end if;

  if not (
    public.owns_store(v_batch_breed.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this listing batch breed.';
  end if;

  update public.listing_batch_breeds
  set visibility_status = p_visibility_status
  where listing_batch_breeds.id = v_batch_breed.id
  returning * into v_updated_batch_breed;

  perform public.log_inventory_activity_event(
    v_updated_batch_breed.store_id,
    v_updated_batch_breed.listing_batch_id,
    v_updated_batch_breed.id,
    null,
    'listing_batch_breed_visibility_changed',
    null,
    null,
    v_batch_breed.visibility_status,
    v_updated_batch_breed.visibility_status,
    p_note,
    '{}'::jsonb
  );

  return v_updated_batch_breed;
end;
$$;


create or replace function public.seller_create_inventory_item(
  p_listing_batch_breed_id uuid,
  p_inventory_type text,
  p_custom_inventory_label text default null,
  p_quantity_available integer default 0,
  p_price_override numeric default null,
  p_sort_order integer default 0,
  p_visibility_status text default 'active',
  p_seller_notes text default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_batch_breed public.listing_batch_breeds%rowtype;
  v_item public.inventory_items%rowtype;
begin
  if p_inventory_type is null
    or p_inventory_type not in (
    'female',
    'male',
    'straight_run',
    'unsexed',
    'pair',
    'trio',
    'hatching_eggs',
    'other'
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

  select *
  into v_batch_breed
  from public.listing_batch_breeds
  where listing_batch_breeds.id = p_listing_batch_breed_id;

  if v_batch_breed.id is null then
    raise exception 'Listing batch breed not found.';
  end if;

  if not (
    public.owns_store(v_batch_breed.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to add inventory to this listing batch breed.';
  end if;

  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = v_batch_breed.listing_batch_id;

  if v_batch.id is null
    or v_batch.store_id <> v_batch_breed.store_id then
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
    store_id,
    listing_batch_id,
    listing_batch_breed_id,
    inventory_type,
    custom_inventory_label,
    quantity_available,
    price_override,
    sort_order,
    visibility_status,
    seller_notes
  )
  values (
    v_batch_breed.store_id,
    v_batch_breed.listing_batch_id,
    v_batch_breed.id,
    p_inventory_type,
    nullif(trim(p_custom_inventory_label), ''),
    coalesce(p_quantity_available, 0),
    p_price_override,
    coalesce(p_sort_order, 0),
    p_visibility_status,
    nullif(trim(p_seller_notes), '')
  )
  returning * into v_item;

  perform public.log_inventory_activity_event(
    v_item.store_id,
    v_item.listing_batch_id,
    v_item.listing_batch_breed_id,
    v_item.id,
    'inventory_item_created',
    null,
    v_item.quantity_available,
    null,
    v_item.visibility_status,
    null,
    jsonb_build_object(
      'inventory_type', v_item.inventory_type
    )
  );

  return v_item;
end;
$$;


create or replace function public.seller_update_inventory_item(
  p_inventory_item_id uuid,
  p_inventory_type text,
  p_custom_inventory_label text default null,
  p_price_override numeric default null,
  p_sort_order integer default 0,
  p_seller_notes text default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_item public.inventory_items%rowtype;
  v_updated_item public.inventory_items%rowtype;
begin
  if p_inventory_type is null
    or p_inventory_type not in (
    'female',
    'male',
    'straight_run',
    'unsexed',
    'pair',
    'trio',
    'hatching_eggs',
    'other'
  ) then
    raise exception 'Invalid inventory type.';
  end if;

  if p_inventory_type = 'other'
    and nullif(trim(p_custom_inventory_label), '') is null then
    raise exception 'Custom inventory label is required for other inventory type.';
  end if;

  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'Sort order must be nonnegative.';
  end if;

  select *
  into v_item
  from public.inventory_items
  where inventory_items.id = p_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Inventory item not found.';
  end if;

  if not (
    public.owns_store(v_item.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this inventory item.';
  end if;

  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = v_item.listing_batch_id;

  if v_batch.id is null
    or v_batch.store_id <> v_item.store_id then
    raise exception 'Inventory hierarchy is invalid.';
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

  update public.inventory_items
  set
    inventory_type = p_inventory_type,
    custom_inventory_label = nullif(trim(p_custom_inventory_label), ''),
    price_override = p_price_override,
    sort_order = coalesce(p_sort_order, 0),
    seller_notes = nullif(trim(p_seller_notes), '')
  where inventory_items.id = v_item.id
  returning * into v_updated_item;

  perform public.log_inventory_activity_event(
    v_updated_item.store_id,
    v_updated_item.listing_batch_id,
    v_updated_item.listing_batch_breed_id,
    v_updated_item.id,
    'inventory_item_updated',
    v_item.quantity_available,
    v_updated_item.quantity_available,
    v_item.visibility_status,
    v_updated_item.visibility_status,
    null,
    jsonb_build_object(
      'previous_inventory_type', v_item.inventory_type,
      'new_inventory_type', v_updated_item.inventory_type,
      'previous_price_override', v_item.price_override,
      'new_price_override', v_updated_item.price_override
    )
  );

  return v_updated_item;
end;
$$;


create or replace function public.seller_adjust_inventory_quantity(
  p_inventory_item_id uuid,
  p_quantity_available integer default null,
  p_quantity_delta integer default null,
  p_note text default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items%rowtype;
  v_updated_item public.inventory_items%rowtype;
  v_new_quantity integer;
begin
  if (p_quantity_available is null and p_quantity_delta is null)
    or (p_quantity_available is not null and p_quantity_delta is not null) then
    raise exception 'Provide either an absolute quantity or a quantity delta, but not both.';
  end if;

  select *
  into v_item
  from public.inventory_items
  where inventory_items.id = p_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Inventory item not found.';
  end if;

  if not (
    public.owns_store(v_item.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to adjust this inventory item.';
  end if;

  if p_quantity_available is not null then
    v_new_quantity := p_quantity_available;
  else
    v_new_quantity := v_item.quantity_available + p_quantity_delta;
  end if;

  if v_new_quantity < 0 then
    raise exception 'Inventory quantity cannot be negative.';
  end if;

  update public.inventory_items
  set quantity_available = v_new_quantity
  where inventory_items.id = v_item.id
  returning * into v_updated_item;

  perform public.log_inventory_activity_event(
    v_updated_item.store_id,
    v_updated_item.listing_batch_id,
    v_updated_item.listing_batch_breed_id,
    v_updated_item.id,
    'inventory_quantity_adjusted',
    v_item.quantity_available,
    v_updated_item.quantity_available,
    v_item.visibility_status,
    v_updated_item.visibility_status,
    p_note,
    jsonb_build_object(
      'quantity_delta', v_updated_item.quantity_available - v_item.quantity_available
    )
  );

  return v_updated_item;
end;
$$;


create or replace function public.seller_set_inventory_visibility(
  p_inventory_item_id uuid,
  p_visibility_status text,
  p_note text default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items%rowtype;
  v_updated_item public.inventory_items%rowtype;
begin
  if p_visibility_status is null
    or p_visibility_status not in ('active', 'hidden', 'archived') then
    raise exception 'Invalid inventory visibility status.';
  end if;

  select *
  into v_item
  from public.inventory_items
  where inventory_items.id = p_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Inventory item not found.';
  end if;

  if not (
    public.owns_store(v_item.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this inventory item.';
  end if;

  update public.inventory_items
  set visibility_status = p_visibility_status
  where inventory_items.id = v_item.id
  returning * into v_updated_item;

  perform public.log_inventory_activity_event(
    v_updated_item.store_id,
    v_updated_item.listing_batch_id,
    v_updated_item.listing_batch_breed_id,
    v_updated_item.id,
    'inventory_visibility_changed',
    v_item.quantity_available,
    v_updated_item.quantity_available,
    v_item.visibility_status,
    v_updated_item.visibility_status,
    p_note,
    '{}'::jsonb
  );

  return v_updated_item;
end;
$$;


comment on function public.seller_create_listing_batch(
  uuid,
  uuid,
  text,
  date,
  date,
  numeric,
  boolean,
  numeric,
  numeric,
  text,
  text,
  text
) is
'Trusted seller/admin RPC to create a listing batch while enforcing store ownership, active species, batch type rules, and V1 visibility values.';

comment on function public.seller_update_listing_batch(
  uuid,
  date,
  date,
  numeric,
  boolean,
  numeric,
  numeric,
  text,
  text
) is
'Trusted seller/admin RPC to update seller-editable listing batch details without exposing platform moderation fields.';

comment on function public.seller_set_listing_batch_visibility(uuid, text, text) is
'Trusted seller/admin RPC to publish, hide, mark sold out, or archive a listing batch using existing visibility_status semantics.';

comment on function public.seller_add_listing_batch_breed(uuid, uuid, text, integer, text) is
'Trusted seller/admin RPC to add a seller breed profile to a listing batch while enforcing store and species consistency.';

comment on function public.seller_update_listing_batch_breed(uuid, text, integer) is
'Trusted seller/admin RPC to update seller-editable batch breed details without exposing platform moderation fields.';

comment on function public.seller_set_listing_batch_breed_visibility(uuid, text, text) is
'Trusted seller/admin RPC to hide, reactivate, or archive a listing batch breed row using existing visibility_status semantics.';

comment on function public.seller_create_inventory_item(uuid, text, text, integer, numeric, integer, text, text) is
'Trusted seller/admin RPC to create an inventory row while enforcing ownership, hierarchy, quantity, and batch type compatibility.';

comment on function public.seller_update_inventory_item(uuid, text, text, numeric, integer, text) is
'Trusted seller/admin RPC to update seller-editable inventory details without changing quantity or platform moderation fields.';

comment on function public.seller_adjust_inventory_quantity(uuid, integer, integer, text) is
'Trusted seller/admin RPC to manually set or adjust available inventory quantity for practical seller operations such as offline sales, miscounts, or holdbacks.';

comment on function public.seller_set_inventory_visibility(uuid, text, text) is
'Trusted seller/admin RPC to pause, reactivate, or archive an inventory item using existing visibility_status semantics. Sold out remains derived from quantity_available = 0.';


revoke all on function public.seller_create_listing_batch(
  uuid,
  uuid,
  text,
  date,
  date,
  numeric,
  boolean,
  numeric,
  numeric,
  text,
  text,
  text
) from public;

revoke all on function public.seller_update_listing_batch(
  uuid,
  date,
  date,
  numeric,
  boolean,
  numeric,
  numeric,
  text,
  text
) from public;

revoke all on function public.seller_set_listing_batch_visibility(uuid, text, text) from public;
revoke all on function public.seller_add_listing_batch_breed(uuid, uuid, text, integer, text) from public;
revoke all on function public.seller_update_listing_batch_breed(uuid, text, integer) from public;
revoke all on function public.seller_set_listing_batch_breed_visibility(uuid, text, text) from public;
revoke all on function public.seller_create_inventory_item(uuid, text, text, integer, numeric, integer, text, text) from public;
revoke all on function public.seller_update_inventory_item(uuid, text, text, numeric, integer, text) from public;
revoke all on function public.seller_adjust_inventory_quantity(uuid, integer, integer, text) from public;
revoke all on function public.seller_set_inventory_visibility(uuid, text, text) from public;


grant execute on function public.seller_create_listing_batch(
  uuid,
  uuid,
  text,
  date,
  date,
  numeric,
  boolean,
  numeric,
  numeric,
  text,
  text,
  text
) to authenticated;

grant execute on function public.seller_update_listing_batch(
  uuid,
  date,
  date,
  numeric,
  boolean,
  numeric,
  numeric,
  text,
  text
) to authenticated;

grant execute on function public.seller_set_listing_batch_visibility(uuid, text, text) to authenticated;
grant execute on function public.seller_add_listing_batch_breed(uuid, uuid, text, integer, text) to authenticated;
grant execute on function public.seller_update_listing_batch_breed(uuid, text, integer) to authenticated;
grant execute on function public.seller_set_listing_batch_breed_visibility(uuid, text, text) to authenticated;
grant execute on function public.seller_create_inventory_item(uuid, text, text, integer, numeric, integer, text, text) to authenticated;
grant execute on function public.seller_update_inventory_item(uuid, text, text, numeric, integer, text) to authenticated;
grant execute on function public.seller_adjust_inventory_quantity(uuid, integer, integer, text) to authenticated;
grant execute on function public.seller_set_inventory_visibility(uuid, text, text) to authenticated;
