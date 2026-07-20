begin;

alter table public.inventory_items
  add column if not exists archived_at timestamptz;

comment on column public.inventory_items.archived_at is
'Timestamp when a seller archived this inventory item. visibility_status = archived is the source of truth.';

comment on column public.inventory_items.cleared_at is
'Deprecated legacy Clear state. Retained temporarily for compatibility; Inventory Archive uses visibility_status = archived and archived_at.';

create index if not exists inventory_items_store_archive_updated_idx
on public.inventory_items(store_id, visibility_status, archived_at, updated_at desc);

update public.inventory_items
set
  visibility_status = 'archived',
  archived_at = coalesce(archived_at, cleared_at, updated_at, now()),
  updated_at = now()
where cleared_at is not null;

update public.inventory_items
set archived_at = coalesce(archived_at, updated_at, created_at, now())
where visibility_status = 'archived'
  and archived_at is null;

update public.hatching_egg_inventory_items
set archived_at = coalesce(archived_at, updated_at, created_at, now())
where visibility_status = 'archived'
  and archived_at is null;

update public.processed_poultry_inventory_items
set archived_at = coalesce(archived_at, updated_at, created_at, now())
where visibility_status = 'archived'
  and archived_at is null;

update public.equipment_inventory_items
set archived_at = coalesce(archived_at, updated_at, created_at, now())
where visibility_status = 'archived'
  and archived_at is null;

drop trigger if exists inventory_items_clear_when_quantity_returns on public.inventory_items;
drop function if exists public.clear_inventory_item_when_quantity_returns();

create or replace function public.seller_archive_inventory_items(
  p_inventory_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  archived_inventory_item_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_authorized_count integer;
begin
  create temporary table if not exists pg_temp.archive_inventory_item_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.archive_inventory_item_ids;

  insert into pg_temp.archive_inventory_item_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select count(*) into v_requested_count
  from pg_temp.archive_inventory_item_ids;

  if v_requested_count = 0 then
    raise exception 'Select at least one inventory row to archive.';
  end if;

  perform 1
  from public.inventory_items as inventory_items
  join pg_temp.archive_inventory_item_ids as requested
    on requested.id = inventory_items.id
  where public.owns_store(inventory_items.store_id)
     or public.is_admin()
  order by inventory_items.id
  for update of inventory_items;

  select count(*) into v_authorized_count
  from public.inventory_items as inventory_items
  join pg_temp.archive_inventory_item_ids as requested
    on requested.id = inventory_items.id
  where public.owns_store(inventory_items.store_id)
     or public.is_admin();

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected inventory rows were not found or do not belong to this store.';
  end if;

  return query
  update public.inventory_items as inventory_items
  set
    visibility_status = 'archived',
    archived_at = now(),
    updated_at = now()
  from pg_temp.archive_inventory_item_ids as requested
  where inventory_items.id = requested.id
    and inventory_items.visibility_status <> 'archived'
  returning inventory_items.id;
end;
$$;

create or replace function public.seller_restore_inventory_items(
  p_inventory_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  restored_inventory_item_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_authorized_count integer;
begin
  create temporary table if not exists pg_temp.restore_inventory_item_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.restore_inventory_item_ids;

  insert into pg_temp.restore_inventory_item_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select count(*) into v_requested_count
  from pg_temp.restore_inventory_item_ids;

  if v_requested_count = 0 then
    raise exception 'Select at least one inventory row to restore.';
  end if;

  perform 1
  from public.inventory_items as inventory_items
  join pg_temp.restore_inventory_item_ids as requested
    on requested.id = inventory_items.id
  where public.owns_store(inventory_items.store_id)
     or public.is_admin()
  order by inventory_items.id
  for update of inventory_items;

  select count(*) into v_authorized_count
  from public.inventory_items as inventory_items
  join pg_temp.restore_inventory_item_ids as requested
    on requested.id = inventory_items.id
  where public.owns_store(inventory_items.store_id)
     or public.is_admin();

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected inventory rows were not found or do not belong to this store.';
  end if;

  return query
  update public.inventory_items as inventory_items
  set
    visibility_status = 'hidden',
    archived_at = null,
    updated_at = now()
  from pg_temp.restore_inventory_item_ids as requested
  where inventory_items.id = requested.id
    and inventory_items.visibility_status = 'archived'
  returning inventory_items.id;
end;
$$;

create or replace function public.seller_archive_hatching_egg_inventory_items(
  p_hatching_egg_inventory_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  archived_hatching_egg_inventory_item_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_authorized_count integer;
begin
  create temporary table if not exists pg_temp.archive_hatching_egg_item_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.archive_hatching_egg_item_ids;

  insert into pg_temp.archive_hatching_egg_item_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_hatching_egg_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select count(*) into v_requested_count
  from pg_temp.archive_hatching_egg_item_ids;

  if v_requested_count = 0 then
    raise exception 'Select at least one hatching egg inventory row to archive.';
  end if;

  perform 1
  from public.hatching_egg_inventory_items as hatching_items
  join pg_temp.archive_hatching_egg_item_ids as requested
    on requested.id = hatching_items.id
  where public.owns_store(hatching_items.store_id)
     or public.is_admin()
  order by hatching_items.id
  for update of hatching_items;

  select count(*) into v_authorized_count
  from public.hatching_egg_inventory_items as hatching_items
  join pg_temp.archive_hatching_egg_item_ids as requested
    on requested.id = hatching_items.id
  where public.owns_store(hatching_items.store_id)
     or public.is_admin();

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected hatching egg inventory rows were not found or do not belong to this store.';
  end if;

  return query
  update public.hatching_egg_inventory_items as hatching_items
  set
    visibility_status = 'archived',
    archived_at = now(),
    updated_at = now()
  from pg_temp.archive_hatching_egg_item_ids as requested
  where hatching_items.id = requested.id
    and hatching_items.visibility_status <> 'archived'
  returning hatching_items.id;
end;
$$;

create or replace function public.seller_restore_hatching_egg_inventory_items(
  p_hatching_egg_inventory_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  restored_hatching_egg_inventory_item_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_authorized_count integer;
begin
  create temporary table if not exists pg_temp.restore_hatching_egg_item_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.restore_hatching_egg_item_ids;

  insert into pg_temp.restore_hatching_egg_item_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_hatching_egg_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select count(*) into v_requested_count
  from pg_temp.restore_hatching_egg_item_ids;

  if v_requested_count = 0 then
    raise exception 'Select at least one hatching egg inventory row to restore.';
  end if;

  perform 1
  from public.hatching_egg_inventory_items as hatching_items
  join pg_temp.restore_hatching_egg_item_ids as requested
    on requested.id = hatching_items.id
  where public.owns_store(hatching_items.store_id)
     or public.is_admin()
  order by hatching_items.id
  for update of hatching_items;

  select count(*) into v_authorized_count
  from public.hatching_egg_inventory_items as hatching_items
  join pg_temp.restore_hatching_egg_item_ids as requested
    on requested.id = hatching_items.id
  where public.owns_store(hatching_items.store_id)
     or public.is_admin();

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected hatching egg inventory rows were not found or do not belong to this store.';
  end if;

  return query
  update public.hatching_egg_inventory_items as hatching_items
  set
    visibility_status = 'hidden',
    archived_at = null,
    updated_at = now()
  from pg_temp.restore_hatching_egg_item_ids as requested
  where hatching_items.id = requested.id
    and hatching_items.visibility_status = 'archived'
  returning hatching_items.id;
end;
$$;

create or replace function public.seller_archive_processed_poultry_inventory_items(
  p_processed_poultry_inventory_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  archived_processed_poultry_inventory_item_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_authorized_count integer;
begin
  create temporary table if not exists pg_temp.archive_processed_poultry_item_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.archive_processed_poultry_item_ids;

  insert into pg_temp.archive_processed_poultry_item_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_processed_poultry_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select count(*) into v_requested_count
  from pg_temp.archive_processed_poultry_item_ids;

  if v_requested_count = 0 then
    raise exception 'Select at least one poultry product inventory row to archive.';
  end if;

  perform 1
  from public.processed_poultry_inventory_items as processed_items
  join pg_temp.archive_processed_poultry_item_ids as requested
    on requested.id = processed_items.id
  where public.owns_store(processed_items.store_id)
     or public.is_admin()
  order by processed_items.id
  for update of processed_items;

  select count(*) into v_authorized_count
  from public.processed_poultry_inventory_items as processed_items
  join pg_temp.archive_processed_poultry_item_ids as requested
    on requested.id = processed_items.id
  where public.owns_store(processed_items.store_id)
     or public.is_admin();

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected poultry product inventory rows were not found or do not belong to this store.';
  end if;

  return query
  update public.processed_poultry_inventory_items as processed_items
  set
    visibility_status = 'archived',
    archived_at = now(),
    updated_at = now()
  from pg_temp.archive_processed_poultry_item_ids as requested
  where processed_items.id = requested.id
    and processed_items.visibility_status <> 'archived'
  returning processed_items.id;
end;
$$;

create or replace function public.seller_restore_processed_poultry_inventory_items(
  p_processed_poultry_inventory_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  restored_processed_poultry_inventory_item_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_authorized_count integer;
begin
  create temporary table if not exists pg_temp.restore_processed_poultry_item_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.restore_processed_poultry_item_ids;

  insert into pg_temp.restore_processed_poultry_item_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_processed_poultry_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select count(*) into v_requested_count
  from pg_temp.restore_processed_poultry_item_ids;

  if v_requested_count = 0 then
    raise exception 'Select at least one poultry product inventory row to restore.';
  end if;

  perform 1
  from public.processed_poultry_inventory_items as processed_items
  join pg_temp.restore_processed_poultry_item_ids as requested
    on requested.id = processed_items.id
  where public.owns_store(processed_items.store_id)
     or public.is_admin()
  order by processed_items.id
  for update of processed_items;

  select count(*) into v_authorized_count
  from public.processed_poultry_inventory_items as processed_items
  join pg_temp.restore_processed_poultry_item_ids as requested
    on requested.id = processed_items.id
  where public.owns_store(processed_items.store_id)
     or public.is_admin();

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected poultry product inventory rows were not found or do not belong to this store.';
  end if;

  return query
  update public.processed_poultry_inventory_items as processed_items
  set
    visibility_status = 'hidden',
    archived_at = null,
    updated_at = now()
  from pg_temp.restore_processed_poultry_item_ids as requested
  where processed_items.id = requested.id
    and processed_items.visibility_status = 'archived'
  returning processed_items.id;
end;
$$;

create or replace function public.seller_archive_equipment_inventory_items(
  p_equipment_inventory_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  archived_equipment_inventory_item_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_authorized_count integer;
begin
  create temporary table if not exists pg_temp.archive_equipment_item_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.archive_equipment_item_ids;

  insert into pg_temp.archive_equipment_item_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_equipment_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select count(*) into v_requested_count
  from pg_temp.archive_equipment_item_ids;

  if v_requested_count = 0 then
    raise exception 'Select at least one equipment inventory row to archive.';
  end if;

  perform 1
  from public.equipment_inventory_items as equipment_items
  join pg_temp.archive_equipment_item_ids as requested
    on requested.id = equipment_items.id
  where public.owns_store(equipment_items.store_id)
     or public.is_admin()
  order by equipment_items.id
  for update of equipment_items;

  select count(*) into v_authorized_count
  from public.equipment_inventory_items as equipment_items
  join pg_temp.archive_equipment_item_ids as requested
    on requested.id = equipment_items.id
  where public.owns_store(equipment_items.store_id)
     or public.is_admin();

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected equipment inventory rows were not found or do not belong to this store.';
  end if;

  return query
  update public.equipment_inventory_items as equipment_items
  set
    visibility_status = 'archived',
    archived_at = now(),
    updated_at = now()
  from pg_temp.archive_equipment_item_ids as requested
  where equipment_items.id = requested.id
    and equipment_items.visibility_status <> 'archived'
  returning equipment_items.id;
end;
$$;

create or replace function public.seller_restore_equipment_inventory_items(
  p_equipment_inventory_item_ids uuid[] default '{}'::uuid[]
)
returns table (
  restored_equipment_inventory_item_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_authorized_count integer;
begin
  create temporary table if not exists pg_temp.restore_equipment_item_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.restore_equipment_item_ids;

  insert into pg_temp.restore_equipment_item_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_equipment_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select count(*) into v_requested_count
  from pg_temp.restore_equipment_item_ids;

  if v_requested_count = 0 then
    raise exception 'Select at least one equipment inventory row to restore.';
  end if;

  perform 1
  from public.equipment_inventory_items as equipment_items
  join pg_temp.restore_equipment_item_ids as requested
    on requested.id = equipment_items.id
  where public.owns_store(equipment_items.store_id)
     or public.is_admin()
  order by equipment_items.id
  for update of equipment_items;

  select count(*) into v_authorized_count
  from public.equipment_inventory_items as equipment_items
  join pg_temp.restore_equipment_item_ids as requested
    on requested.id = equipment_items.id
  where public.owns_store(equipment_items.store_id)
     or public.is_admin();

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected equipment inventory rows were not found or do not belong to this store.';
  end if;

  return query
  update public.equipment_inventory_items as equipment_items
  set
    visibility_status = 'hidden',
    archived_at = null,
    updated_at = now()
  from pg_temp.restore_equipment_item_ids as requested
  where equipment_items.id = requested.id
    and equipment_items.visibility_status = 'archived'
  returning equipment_items.id;
end;
$$;

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
  create temporary table if not exists pg_temp.deprecated_clear_inventory_item_ids (
    id uuid primary key
  ) on commit drop;

  truncate table pg_temp.deprecated_clear_inventory_item_ids;

  insert into pg_temp.deprecated_clear_inventory_item_ids (id)
  select distinct requested_id
  from unnest(coalesce(p_inventory_item_ids, '{}'::uuid[])) as requested_id
  where requested_id is not null
  on conflict do nothing;

  select count(*) into v_requested_count
  from pg_temp.deprecated_clear_inventory_item_ids;

  if v_requested_count = 0 then
    raise exception 'Select at least one inventory row to clear.';
  end if;

  perform 1
  from public.inventory_items as inventory_items
  join pg_temp.deprecated_clear_inventory_item_ids as requested
    on requested.id = inventory_items.id
  where public.owns_store(inventory_items.store_id)
     or public.is_admin()
  order by inventory_items.id
  for update of inventory_items;

  select count(*) into v_authorized_count
  from public.inventory_items as inventory_items
  join pg_temp.deprecated_clear_inventory_item_ids as requested
    on requested.id = inventory_items.id
  where public.owns_store(inventory_items.store_id)
     or public.is_admin();

  if v_authorized_count <> v_requested_count then
    raise exception 'Some selected inventory rows were not found or do not belong to this store.';
  end if;

  select count(*) into v_blocked_count
  from public.inventory_items as inventory_items
  join pg_temp.deprecated_clear_inventory_item_ids as requested
    on requested.id = inventory_items.id
  where coalesce(inventory_items.quantity_available, 0) <> 0;

  if v_blocked_count > 0 then
    raise exception 'Only sold-out inventory rows can be cleared.';
  end if;

  return query
  update public.inventory_items as inventory_items
  set
    visibility_status = 'archived',
    archived_at = now(),
    updated_at = now()
  from pg_temp.deprecated_clear_inventory_item_ids as requested
  where inventory_items.id = requested.id
    and inventory_items.visibility_status <> 'archived'
  returning inventory_items.id;
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
  v_effective_visibility_status text;
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

  v_effective_visibility_status := p_visibility_status;

  if v_item.visibility_status = 'archived'
    and p_visibility_status <> 'archived' then
    v_effective_visibility_status := 'hidden';
  end if;

  update public.inventory_items
  set
    visibility_status = v_effective_visibility_status,
    archived_at = case
      when v_effective_visibility_status = 'archived'
        then now()
      else null
    end,
    updated_at = now()
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

create or replace function public.seller_set_hatching_egg_inventory_visibility(
  p_hatching_egg_inventory_item_id uuid,
  p_visibility_status text
)
returns public.hatching_egg_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.hatching_egg_inventory_items%rowtype;
  v_updated_item public.hatching_egg_inventory_items%rowtype;
  v_effective_visibility_status text;
begin
  if p_visibility_status not in ('hidden', 'active', 'sold_out', 'archived') then
    raise exception 'Unsupported visibility status.';
  end if;

  select *
  into v_item
  from public.hatching_egg_inventory_items
  where hatching_egg_inventory_items.id = p_hatching_egg_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Hatching egg inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this hatching egg inventory.';
  end if;

  v_effective_visibility_status := p_visibility_status;

  if v_item.visibility_status = 'archived'
    and p_visibility_status <> 'archived' then
    v_effective_visibility_status := 'hidden';
  end if;

  update public.hatching_egg_inventory_items
  set
    visibility_status = v_effective_visibility_status,
    first_published_at = case
      when v_effective_visibility_status = 'active'
        then coalesce(first_published_at, now())
      else first_published_at
    end,
    archived_at = case
      when v_effective_visibility_status = 'archived'
        then now()
      else null
    end,
    updated_at = now()
  where hatching_egg_inventory_items.id = v_item.id
  returning * into v_updated_item;

  return v_updated_item;
end;
$$;

create or replace function public.seller_set_processed_poultry_inventory_visibility(
  p_processed_poultry_inventory_item_id uuid,
  p_visibility_status text
)
returns public.processed_poultry_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
  v_updated_item public.processed_poultry_inventory_items%rowtype;
  v_effective_visibility_status text;
begin
  if p_visibility_status not in ('active', 'hidden', 'sold_out', 'archived') then
    raise exception 'Choose a supported visibility status.';
  end if;

  select processed_items.*
  into v_item
  from public.processed_poultry_inventory_items as processed_items
  where processed_items.id = p_processed_poultry_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Processed poultry inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this processed poultry inventory.';
  end if;

  v_effective_visibility_status := p_visibility_status;

  if v_item.visibility_status = 'archived'
    and p_visibility_status <> 'archived' then
    v_effective_visibility_status := 'hidden';
  end if;

  update public.processed_poultry_inventory_items as processed_items
  set
    visibility_status = v_effective_visibility_status,
    first_published_at = case
      when v_effective_visibility_status in ('active', 'sold_out')
        then coalesce(processed_items.first_published_at, now())
      else processed_items.first_published_at
    end,
    archived_at = case
      when v_effective_visibility_status = 'archived'
        then now()
      else null
    end,
    updated_at = now()
  where processed_items.id = v_item.id
  returning processed_items.* into v_updated_item;

  return v_updated_item;
end;
$$;

create or replace function public.seller_set_equipment_inventory_visibility(
  p_equipment_inventory_item_id uuid,
  p_visibility_status text
)
returns public.equipment_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.equipment_inventory_items%rowtype;
  v_updated_item public.equipment_inventory_items%rowtype;
  v_effective_visibility_status text;
begin
  if p_visibility_status not in ('active', 'hidden', 'sold_out', 'archived') then
    raise exception 'Choose a supported visibility status.';
  end if;

  select *
  into v_item
  from public.equipment_inventory_items
  where equipment_inventory_items.id = p_equipment_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Equipment inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this equipment inventory.';
  end if;

  v_effective_visibility_status := p_visibility_status;

  if v_item.visibility_status = 'archived'
    and p_visibility_status <> 'archived' then
    v_effective_visibility_status := 'hidden';
  end if;

  update public.equipment_inventory_items
  set
    visibility_status = v_effective_visibility_status,
    first_published_at = case
      when v_effective_visibility_status in ('active', 'sold_out')
        then coalesce(equipment_inventory_items.first_published_at, now())
      else equipment_inventory_items.first_published_at
    end,
    archived_at = case
      when v_effective_visibility_status = 'archived'
        then now()
      else null
    end,
    updated_at = now()
  where equipment_inventory_items.id = v_item.id
  returning * into v_updated_item;

  return v_updated_item;
end;
$$;

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
  inventory_items.cleared_at,
  inventory_items.archived_at
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
'Seller-private inventory/listing management projection for dashboard screens. Exposes archive metadata; cleared_at is deprecated compatibility data.';

grant select on public.seller_inventory_management to authenticated;

create or replace view public.seller_hatching_egg_inventory_management
with (security_barrier = true)
as
select
  hatching_items.id as hatching_egg_inventory_item_id,
  hatching_items.store_id,
  hatching_items.item_name,
  hatching_items.species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  hatching_items.description,
  hatching_items.quantity_available,
  hatching_items.price,
  hatching_items.available_date,
  hatching_items.minimum_order_quantity,
  hatching_items.visibility_status,
  hatching_items.moderation_status,
  case
    when hatching_items.visibility_status = 'archived' then 'archived'
    when hatching_items.moderation_status <> 'normal' then 'unavailable'
    when hatching_items.visibility_status = 'sold_out'
      or hatching_items.quantity_available <= 0 then 'sold_out'
    when hatching_items.visibility_status <> 'active' then 'hidden'
    when hatching_items.available_date > current_date then 'coming_soon'
    else 'ready_now'
  end as operational_availability_status,
  hatching_items.seller_notes,
  hatching_items.first_published_at,
  hatching_items.archived_at,
  hatching_items.created_at,
  hatching_items.updated_at,
  (
    'he-' ||
    md5(
      hatching_items.store_id::text ||
      ':' ||
      lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g'))
    )
  ) as hatching_egg_product_id
from public.hatching_egg_inventory_items as hatching_items
join public.species
  on species.id = hatching_items.species_id
where public.owns_store(hatching_items.store_id)
   or public.is_admin();

comment on view public.seller_hatching_egg_inventory_management is
'Seller-private standalone Hatching Eggs management projection, including archive metadata and the public product ID used by storefront product routes.';

grant select on public.seller_hatching_egg_inventory_management to authenticated;

create or replace view public.seller_processed_poultry_inventory_management
with (security_barrier = true)
as
select
  processed_items.id as processed_poultry_inventory_item_id,
  processed_items.store_id,
  processed_items.product_name,
  processed_items.poultry_type,
  processed_items.product_type,
  processed_items.package_size,
  processed_items.description,
  processed_items.quantity_available,
  processed_items.price,
  processed_items.visibility_status,
  processed_items.moderation_status,
  case
    when processed_items.visibility_status = 'archived' then 'archived'
    when processed_items.moderation_status <> 'normal' then 'unavailable'
    when processed_items.visibility_status = 'sold_out'
      or processed_items.quantity_available <= 0 then 'sold_out'
    when processed_items.visibility_status <> 'active' then 'hidden'
    when processed_items.available_date > current_date then 'coming_soon'
    else 'ready_now'
  end as operational_availability_status,
  processed_items.seller_notes,
  processed_items.first_published_at,
  processed_items.archived_at,
  processed_items.created_at,
  processed_items.updated_at,
  processed_items.species_id,
  coalesce(species.common_name, processed_items.poultry_type) as species_name,
  species.slug as species_slug,
  processed_items.available_date
from public.processed_poultry_inventory_items as processed_items
left join public.species as species
  on species.id = processed_items.species_id
where public.owns_store(processed_items.store_id)
   or public.is_admin();

grant select on public.seller_processed_poultry_inventory_management to authenticated;

create or replace view public.seller_equipment_inventory_management
with (security_barrier = true)
as
select
  equipment_inventory_items.id as equipment_inventory_item_id,
  equipment_inventory_items.store_id,
  equipment_inventory_items.item_name,
  equipment_inventory_items.category,
  equipment_inventory_items.condition,
  equipment_inventory_items.description,
  equipment_inventory_items.quantity_available,
  equipment_inventory_items.price,
  equipment_inventory_items.visibility_status,
  equipment_inventory_items.moderation_status,
  case
    when equipment_inventory_items.visibility_status = 'archived'
      then 'archived'
    when equipment_inventory_items.moderation_status <> 'normal'
      then 'unavailable'
    when equipment_inventory_items.visibility_status = 'sold_out'
      or equipment_inventory_items.quantity_available <= 0
      then 'sold_out'
    when equipment_inventory_items.visibility_status <> 'active'
      then 'hidden'
    when equipment_inventory_items.available_date > current_date
      then 'coming_soon'
    else 'ready_now'
  end as operational_availability_status,
  equipment_inventory_items.seller_notes,
  equipment_inventory_items.first_published_at,
  equipment_inventory_items.archived_at,
  equipment_inventory_items.created_at,
  equipment_inventory_items.updated_at,
  equipment_inventory_items.available_date
from public.equipment_inventory_items
where public.owns_store(equipment_inventory_items.store_id)
   or public.is_admin();

comment on view public.seller_equipment_inventory_management is
'Seller-private Equipment & Supplies management projection. Includes available_date and archive metadata for seller inventory flows.';

grant select on public.seller_equipment_inventory_management to authenticated;

comment on function public.seller_archive_inventory_items(uuid[]) is
'Trusted seller/admin RPC to archive selected Live Birds inventory rows without changing quantity, pricing, dates, media, listing relationships, or order history.';
comment on function public.seller_restore_inventory_items(uuid[]) is
'Trusted seller/admin RPC to restore selected archived Live Birds inventory rows to hidden Current Inventory without publishing them.';
comment on function public.seller_archive_hatching_egg_inventory_items(uuid[]) is
'Trusted seller/admin RPC to archive selected Hatching Eggs inventory rows without changing quantity, pricing, dates, media, or order history.';
comment on function public.seller_restore_hatching_egg_inventory_items(uuid[]) is
'Trusted seller/admin RPC to restore selected archived Hatching Eggs inventory rows to hidden Current Inventory without publishing them.';
comment on function public.seller_archive_processed_poultry_inventory_items(uuid[]) is
'Trusted seller/admin RPC to archive selected Poultry Products inventory rows without changing quantity, pricing, dates, media, or order history.';
comment on function public.seller_restore_processed_poultry_inventory_items(uuid[]) is
'Trusted seller/admin RPC to restore selected archived Poultry Products inventory rows to hidden Current Inventory without publishing them.';
comment on function public.seller_archive_equipment_inventory_items(uuid[]) is
'Trusted seller/admin RPC to archive selected Equipment & Supplies inventory rows without changing quantity, pricing, dates, media, or order history.';
comment on function public.seller_restore_equipment_inventory_items(uuid[]) is
'Trusted seller/admin RPC to restore selected archived Equipment & Supplies inventory rows to hidden Current Inventory without publishing them.';
comment on function public.seller_clear_inventory_items(uuid[]) is
'Deprecated compatibility RPC. Clear has been replaced by Inventory Archive; this wrapper archives selected zero-quantity Live Birds rows and no longer writes cleared_at.';
comment on function public.seller_set_inventory_visibility(uuid, text, text) is
'Trusted seller/admin RPC to update Live Birds inventory visibility. Requests to show archived inventory are normalized to hidden so restore never publishes inventory.';
comment on function public.seller_set_hatching_egg_inventory_visibility(uuid, text) is
'Trusted seller/admin RPC to update Hatching Eggs inventory visibility. Requests to show archived inventory are normalized to hidden so restore never publishes inventory.';
comment on function public.seller_set_processed_poultry_inventory_visibility(uuid, text) is
'Trusted seller/admin RPC to update Poultry Products inventory visibility. Requests to show archived inventory are normalized to hidden so restore never publishes inventory.';
comment on function public.seller_set_equipment_inventory_visibility(uuid, text) is
'Trusted seller/admin RPC to update Equipment & Supplies inventory visibility. Requests to show archived inventory are normalized to hidden so restore never publishes inventory.';

revoke all on function public.seller_archive_inventory_items(uuid[]) from public;
revoke all on function public.seller_restore_inventory_items(uuid[]) from public;
revoke all on function public.seller_archive_hatching_egg_inventory_items(uuid[]) from public;
revoke all on function public.seller_restore_hatching_egg_inventory_items(uuid[]) from public;
revoke all on function public.seller_archive_processed_poultry_inventory_items(uuid[]) from public;
revoke all on function public.seller_restore_processed_poultry_inventory_items(uuid[]) from public;
revoke all on function public.seller_archive_equipment_inventory_items(uuid[]) from public;
revoke all on function public.seller_restore_equipment_inventory_items(uuid[]) from public;
revoke all on function public.seller_clear_inventory_items(uuid[]) from public;
revoke all on function public.seller_set_inventory_visibility(uuid, text, text) from public;
revoke all on function public.seller_set_hatching_egg_inventory_visibility(uuid, text) from public;
revoke all on function public.seller_set_processed_poultry_inventory_visibility(uuid, text) from public;
revoke all on function public.seller_set_equipment_inventory_visibility(uuid, text) from public;

grant execute on function public.seller_archive_inventory_items(uuid[]) to authenticated;
grant execute on function public.seller_restore_inventory_items(uuid[]) to authenticated;
grant execute on function public.seller_archive_hatching_egg_inventory_items(uuid[]) to authenticated;
grant execute on function public.seller_restore_hatching_egg_inventory_items(uuid[]) to authenticated;
grant execute on function public.seller_archive_processed_poultry_inventory_items(uuid[]) to authenticated;
grant execute on function public.seller_restore_processed_poultry_inventory_items(uuid[]) to authenticated;
grant execute on function public.seller_archive_equipment_inventory_items(uuid[]) to authenticated;
grant execute on function public.seller_restore_equipment_inventory_items(uuid[]) to authenticated;
grant execute on function public.seller_clear_inventory_items(uuid[]) to authenticated;
grant execute on function public.seller_set_inventory_visibility(uuid, text, text) to authenticated;
grant execute on function public.seller_set_hatching_egg_inventory_visibility(uuid, text) to authenticated;
grant execute on function public.seller_set_processed_poultry_inventory_visibility(uuid, text) to authenticated;
grant execute on function public.seller_set_equipment_inventory_visibility(uuid, text) to authenticated;

commit;
