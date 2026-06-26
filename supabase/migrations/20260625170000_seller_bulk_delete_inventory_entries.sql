-- Let sellers permanently remove test inventory rows that have no order history.
-- This intentionally blocks the whole request if any selected row is unsafe.

create or replace function public.seller_delete_inventory_entries(
  p_inventory_item_ids uuid[] default '{}'::uuid[],
  p_equipment_inventory_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  deleted_item_type text,
  deleted_item_id uuid
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
  create temporary table if not exists pg_temp.requested_inventory_item_delete_ids (
    id uuid primary key
  ) on commit drop;

  create temporary table if not exists pg_temp.requested_equipment_inventory_delete_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.requested_inventory_item_delete_ids;
  truncate table pg_temp.requested_equipment_inventory_delete_ids;

  insert into pg_temp.requested_inventory_item_delete_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  insert into pg_temp.requested_equipment_inventory_delete_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_equipment_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select
    (select count(*) from pg_temp.requested_inventory_item_delete_ids)
    + (select count(*) from pg_temp.requested_equipment_inventory_delete_ids)
  into v_requested_count;

  if v_requested_count = 0 then
    raise exception 'Select at least one inventory entry to delete.';
  end if;

  perform 1
  from public.inventory_items as inventory_items
  join pg_temp.requested_inventory_item_delete_ids as requested
    on requested.id = inventory_items.id
  where public.owns_store(inventory_items.store_id)
     or public.is_admin()
  order by inventory_items.id
  for update of inventory_items;

  perform 1
  from public.equipment_inventory_items as equipment_items
  join pg_temp.requested_equipment_inventory_delete_ids as requested
    on requested.id = equipment_items.id
  where public.owns_store(equipment_items.store_id)
     or public.is_admin()
  order by equipment_items.id
  for update of equipment_items;

  create temporary table if not exists pg_temp.deletable_inventory_items
  on commit drop
  as
  select inventory_items.*
  from public.inventory_items as inventory_items
  join pg_temp.requested_inventory_item_delete_ids as requested
    on requested.id = inventory_items.id
  where false;

  create temporary table if not exists pg_temp.deletable_equipment_inventory_items
  on commit drop
  as
  select equipment_items.*
  from public.equipment_inventory_items as equipment_items
  join pg_temp.requested_equipment_inventory_delete_ids as requested
    on requested.id = equipment_items.id
  where false;

  truncate table pg_temp.deletable_inventory_items;
  truncate table pg_temp.deletable_equipment_inventory_items;

  insert into pg_temp.deletable_inventory_items
  select inventory_items.*
  from public.inventory_items as inventory_items
  join pg_temp.requested_inventory_item_delete_ids as requested
    on requested.id = inventory_items.id
  where public.owns_store(inventory_items.store_id)
     or public.is_admin();

  insert into pg_temp.deletable_equipment_inventory_items
  select equipment_items.*
  from public.equipment_inventory_items as equipment_items
  join pg_temp.requested_equipment_inventory_delete_ids as requested
    on requested.id = equipment_items.id
  where public.owns_store(equipment_items.store_id)
     or public.is_admin();

  select
    (select count(*) from pg_temp.deletable_inventory_items)
    + (select count(*) from pg_temp.deletable_equipment_inventory_items)
  into v_authorized_count;

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected inventory entries were not found or do not belong to this store.';
  end if;

  select count(*)
  into v_blocked_count
  from public.order_items as order_items
  where (
    order_items.inventory_item_id in (
      select deletable_items.id
      from pg_temp.deletable_inventory_items as deletable_items
    )
  )
  or (
    order_items.equipment_inventory_item_id in (
      select deletable_equipment.id
      from pg_temp.deletable_equipment_inventory_items as deletable_equipment
    )
  );

  if v_blocked_count > 0 then
    raise exception 'One or more selected inventory entries have order history and cannot be permanently deleted.';
  end if;

  create temporary table if not exists pg_temp.deleted_inventory_entries (
    deleted_item_type text not null,
    deleted_item_id uuid not null
  ) on commit drop;

  truncate table pg_temp.deleted_inventory_entries;

  delete from public.media_links as media_links
  where media_links.entity_type = 'equipment_inventory_item'
    and media_links.entity_id in (
      select deletable_equipment.id
      from pg_temp.deletable_equipment_inventory_items as deletable_equipment
    )
    and media_links.store_id in (
      select deletable_equipment.store_id
      from pg_temp.deletable_equipment_inventory_items as deletable_equipment
      where deletable_equipment.id = media_links.entity_id
    );

  with deleted_equipment as (
    delete from public.equipment_inventory_items as equipment_items
    where equipment_items.id in (
      select deletable_equipment.id
      from pg_temp.deletable_equipment_inventory_items as deletable_equipment
    )
    returning equipment_items.id
  )
  insert into pg_temp.deleted_inventory_entries (deleted_item_type, deleted_item_id)
  select 'equipment_inventory', deleted_equipment.id
  from deleted_equipment;

  delete from public.media_links as media_links
  where media_links.entity_type = 'inventory_item'
    and media_links.entity_id in (
      select deletable_items.id
      from pg_temp.deletable_inventory_items as deletable_items
    )
    and media_links.store_id in (
      select deletable_items.store_id
      from pg_temp.deletable_inventory_items as deletable_items
      where deletable_items.id = media_links.entity_id
    );

  delete from public.inventory_activity_events as activity_events
  where activity_events.inventory_item_id in (
    select deletable_items.id
    from pg_temp.deletable_inventory_items as deletable_items
  )
  and activity_events.store_id in (
    select deletable_items.store_id
    from pg_temp.deletable_inventory_items as deletable_items
    where deletable_items.id = activity_events.inventory_item_id
  );

  with deleted_inventory as (
    delete from public.inventory_items as inventory_items
    where inventory_items.id in (
      select deletable_items.id
      from pg_temp.deletable_inventory_items as deletable_items
    )
    returning inventory_items.id
  )
  insert into pg_temp.deleted_inventory_entries (deleted_item_type, deleted_item_id)
  select 'listing_inventory', deleted_inventory.id
  from deleted_inventory;

  create temporary table if not exists pg_temp.orphan_listing_batch_breed_ids (
    id uuid primary key,
    store_id uuid not null
  ) on commit drop;

  truncate table pg_temp.orphan_listing_batch_breed_ids;

  insert into pg_temp.orphan_listing_batch_breed_ids (id, store_id)
  select distinct listing_batch_breeds.id, listing_batch_breeds.store_id
  from public.listing_batch_breeds as listing_batch_breeds
  join pg_temp.deletable_inventory_items as deleted_items
    on deleted_items.listing_batch_breed_id = listing_batch_breeds.id
  where not exists (
    select 1
    from public.inventory_items as remaining_items
    where remaining_items.listing_batch_breed_id = listing_batch_breeds.id
  )
  and not exists (
    select 1
    from public.order_items as order_items
    where order_items.listing_batch_breed_id = listing_batch_breeds.id
  )
  on conflict do nothing;

  delete from public.media_links as media_links
  where media_links.entity_type = 'listing_batch_breed'
    and media_links.entity_id in (
      select orphan_breeds.id
      from pg_temp.orphan_listing_batch_breed_ids as orphan_breeds
    )
    and media_links.store_id in (
      select orphan_breeds.store_id
      from pg_temp.orphan_listing_batch_breed_ids as orphan_breeds
      where orphan_breeds.id = media_links.entity_id
    );

  delete from public.inventory_activity_events as activity_events
  where activity_events.listing_batch_breed_id in (
    select orphan_breeds.id
    from pg_temp.orphan_listing_batch_breed_ids as orphan_breeds
  )
  and activity_events.store_id in (
    select orphan_breeds.store_id
    from pg_temp.orphan_listing_batch_breed_ids as orphan_breeds
    where orphan_breeds.id = activity_events.listing_batch_breed_id
  );

  delete from public.listing_batch_breeds as listing_batch_breeds
  where listing_batch_breeds.id in (
    select orphan_breeds.id
    from pg_temp.orphan_listing_batch_breed_ids as orphan_breeds
  );

  create temporary table if not exists pg_temp.orphan_listing_batch_ids (
    id uuid primary key,
    store_id uuid not null
  ) on commit drop;

  truncate table pg_temp.orphan_listing_batch_ids;

  insert into pg_temp.orphan_listing_batch_ids (id, store_id)
  select distinct listing_batches.id, listing_batches.store_id
  from public.listing_batches as listing_batches
  join pg_temp.deletable_inventory_items as deleted_items
    on deleted_items.listing_batch_id = listing_batches.id
  where not exists (
    select 1
    from public.inventory_items as remaining_items
    where remaining_items.listing_batch_id = listing_batches.id
  )
  and not exists (
    select 1
    from public.listing_batch_breeds as remaining_breeds
    where remaining_breeds.listing_batch_id = listing_batches.id
  )
  and not exists (
    select 1
    from public.order_items as order_items
    where order_items.listing_batch_id = listing_batches.id
  )
  on conflict do nothing;

  delete from public.media_links as media_links
  where media_links.entity_type = 'listing_batch'
    and media_links.entity_id in (
      select orphan_batches.id
      from pg_temp.orphan_listing_batch_ids as orphan_batches
    )
    and media_links.store_id in (
      select orphan_batches.store_id
      from pg_temp.orphan_listing_batch_ids as orphan_batches
      where orphan_batches.id = media_links.entity_id
    );

  delete from public.inventory_activity_events as activity_events
  where activity_events.listing_batch_id in (
    select orphan_batches.id
    from pg_temp.orphan_listing_batch_ids as orphan_batches
  )
  and activity_events.store_id in (
    select orphan_batches.store_id
    from pg_temp.orphan_listing_batch_ids as orphan_batches
    where orphan_batches.id = activity_events.listing_batch_id
  );

  delete from public.listing_batches as listing_batches
  where listing_batches.id in (
    select orphan_batches.id
    from pg_temp.orphan_listing_batch_ids as orphan_batches
  );

  return query
  select deleted_entries.deleted_item_type, deleted_entries.deleted_item_id
  from pg_temp.deleted_inventory_entries as deleted_entries
  order by deleted_entries.deleted_item_type, deleted_entries.deleted_item_id;
end;
$$;

comment on function public.seller_delete_inventory_entries(uuid[], uuid[]) is
'Trusted seller/admin RPC to permanently delete selected listing or equipment inventory rows that belong to the current seller/store and have no order history.';

revoke all on function public.seller_delete_inventory_entries(uuid[], uuid[]) from public;
grant execute on function public.seller_delete_inventory_entries(uuid[], uuid[]) to authenticated;
