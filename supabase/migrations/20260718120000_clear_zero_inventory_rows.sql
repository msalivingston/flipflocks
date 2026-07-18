alter table public.inventory_items
add column if not exists cleared_at timestamptz;

comment on column public.inventory_items.cleared_at is
'Timestamp when a seller cleared a zero-quantity inventory row from the normal Inventory view. This preserves visibility status, listing/batch relationships, order history, and breed profile references. Rows automatically return to current inventory when quantity_available becomes greater than zero.';

create index if not exists inventory_items_store_cleared_updated_idx
on public.inventory_items(store_id, cleared_at, updated_at desc);

create or replace function public.clear_inventory_item_when_quantity_returns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.quantity_available, 0) = 0
    and coalesce(new.quantity_available, 0) > 0 then
    new.cleared_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_items_clear_when_quantity_returns on public.inventory_items;
create trigger inventory_items_clear_when_quantity_returns
before update of quantity_available on public.inventory_items
for each row
execute function public.clear_inventory_item_when_quantity_returns();

revoke all on function public.clear_inventory_item_when_quantity_returns() from public;

create or replace function public.seller_clear_inventory_items(
  p_inventory_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  cleared_inventory_item_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_authorized_count integer;
  v_blocked_count integer;
begin
  create temporary table if not exists pg_temp.requested_inventory_item_clear_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.requested_inventory_item_clear_ids;

  insert into pg_temp.requested_inventory_item_clear_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select count(*)
  into v_requested_count
  from pg_temp.requested_inventory_item_clear_ids;

  if v_requested_count = 0 then
    raise exception 'Select at least one inventory row to clear.';
  end if;

  perform 1
  from public.inventory_items as inventory_items
  join pg_temp.requested_inventory_item_clear_ids as requested
    on requested.id = inventory_items.id
  where public.owns_store(inventory_items.store_id)
     or public.is_admin()
  order by inventory_items.id
  for update of inventory_items;

  create temporary table if not exists pg_temp.clearable_inventory_items
  on commit drop
  as
  select inventory_items.*
  from public.inventory_items as inventory_items
  join pg_temp.requested_inventory_item_clear_ids as requested
    on requested.id = inventory_items.id
  where false;

  truncate table pg_temp.clearable_inventory_items;

  insert into pg_temp.clearable_inventory_items
  select inventory_items.*
  from public.inventory_items as inventory_items
  join pg_temp.requested_inventory_item_clear_ids as requested
    on requested.id = inventory_items.id
  where public.owns_store(inventory_items.store_id)
     or public.is_admin();

  select count(*)
  into v_authorized_count
  from pg_temp.clearable_inventory_items;

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected inventory rows were not found or do not belong to this store.';
  end if;

  select count(*)
  into v_blocked_count
  from pg_temp.clearable_inventory_items as clearable_items
  where coalesce(clearable_items.quantity_available, 0) <> 0;

  if v_blocked_count > 0 then
    raise exception 'Only sold-out inventory rows can be cleared.';
  end if;

  update public.inventory_items as inventory_items
  set
    cleared_at = coalesce(inventory_items.cleared_at, now()),
    updated_at = now()
  from pg_temp.clearable_inventory_items as clearable_items
  where inventory_items.id = clearable_items.id
    and inventory_items.store_id = clearable_items.store_id
    and inventory_items.cleared_at is null;

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
  select
    clearable_items.store_id,
    clearable_items.listing_batch_id,
    clearable_items.listing_batch_breed_id,
    clearable_items.id,
    auth.uid(),
    case when public.is_admin() then 'admin' else 'seller' end,
    'inventory_item_updated',
    clearable_items.quantity_available,
    clearable_items.quantity_available,
    clearable_items.visibility_status,
    clearable_items.visibility_status,
    'Cleared from seller Inventory view.',
    jsonb_build_object('cleared_at', now())
  from pg_temp.clearable_inventory_items as clearable_items
  where clearable_items.cleared_at is null;

  return query
  select clearable_items.id
  from pg_temp.clearable_inventory_items as clearable_items
  order by clearable_items.id;
end;
$$;

comment on function public.seller_clear_inventory_items(uuid[]) is
'Trusted seller/admin RPC to clear selected zero-quantity listing inventory rows from the default seller Inventory view without changing visibility, parent listing/batch records, breed profiles, or order history.';

revoke all on function public.seller_clear_inventory_items(uuid[]) from public;
grant execute on function public.seller_clear_inventory_items(uuid[]) to authenticated;

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
  listing_batches.price_adjustment_min_price,
  inventory_items.cleared_at
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
'Seller-private inventory/listing management projection for dashboard screens. It exposes seller-operational fields, including cleared_at for the seller Inventory view, without changing storefront or order behavior.';

grant select on public.seller_inventory_management to authenticated;
