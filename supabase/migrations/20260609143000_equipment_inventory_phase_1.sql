-- Equipment & Supplies Phase 1: seller-only inventory CRUD.
--
-- Equipment intentionally does not use listing_batches, listing_batch_breeds,
-- seller_breed_profiles, species, hatch dates, age, or bird inventory types.
-- Storefront display, checkout, orders, and public purchasing are deferred.

create table if not exists public.equipment_inventory_items (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,

  item_name text not null,
  category text not null,
  condition text,
  description text,

  quantity_available integer not null default 0,
  price numeric(10, 2) not null,

  visibility_status text not null default 'hidden',
  moderation_status text not null default 'normal',

  seller_notes text,

  first_published_at timestamptz,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint equipment_inventory_items_item_name_not_empty_check check (
    length(trim(item_name)) > 0
  ),
  constraint equipment_inventory_items_category_check check (
    category in (
      'Feeders & Waterers',
      'Brooders & Heat',
      'Incubators & Hatching',
      'Coops & Housing',
      'Transport & Crates',
      'Fencing & Containment',
      'Miscellaneous'
    )
  ),
  constraint equipment_inventory_items_condition_check check (
    condition is null
    or condition in ('New', 'Like New', 'Good', 'Fair', 'For Parts')
  ),
  constraint equipment_inventory_items_description_not_empty_check check (
    description is null
    or length(trim(description)) > 0
  ),
  constraint equipment_inventory_items_quantity_available_nonnegative_check check (
    quantity_available >= 0
  ),
  constraint equipment_inventory_items_price_nonnegative_check check (
    price >= 0
  ),
  constraint equipment_inventory_items_visibility_status_check check (
    visibility_status in ('hidden', 'active', 'sold_out', 'archived')
  ),
  constraint equipment_inventory_items_moderation_status_check check (
    moderation_status in ('normal', 'flagged')
  ),
  constraint equipment_inventory_items_seller_notes_not_empty_check check (
    seller_notes is null
    or length(trim(seller_notes)) > 0
  )
);

comment on table public.equipment_inventory_items is
'Seller-owned Equipment & Supplies inventory. One row is one simple equipment listing/inventory record. This table is intentionally separate from bird listing batch tables.';

comment on column public.equipment_inventory_items.first_published_at is
'Internal lifecycle guard. Once set, the record is historical and should be archived rather than hard-deleted.';

create index if not exists equipment_inventory_items_store_visibility_idx
on public.equipment_inventory_items(store_id, visibility_status);

create index if not exists equipment_inventory_items_store_category_idx
on public.equipment_inventory_items(store_id, category);

create index if not exists equipment_inventory_items_store_updated_at_idx
on public.equipment_inventory_items(store_id, updated_at desc);

drop trigger if exists equipment_inventory_items_set_updated_at
on public.equipment_inventory_items;

create trigger equipment_inventory_items_set_updated_at
before update on public.equipment_inventory_items
for each row
execute function public.set_updated_at();

alter table public.equipment_inventory_items enable row level security;

drop policy if exists "Store owners can read own equipment inventory"
on public.equipment_inventory_items;

create policy "Store owners can read own equipment inventory"
on public.equipment_inventory_items
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

drop policy if exists "Platform admins can directly mutate equipment inventory"
on public.equipment_inventory_items;

create policy "Platform admins can directly mutate equipment inventory"
on public.equipment_inventory_items
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.equipment_inventory_items from anon, authenticated;
grant select on public.equipment_inventory_items to authenticated;

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
    else 'ready_now'
  end as operational_availability_status,
  equipment_inventory_items.seller_notes,
  equipment_inventory_items.first_published_at,
  equipment_inventory_items.archived_at,
  equipment_inventory_items.created_at,
  equipment_inventory_items.updated_at
from public.equipment_inventory_items
where public.owns_store(equipment_inventory_items.store_id)
   or public.is_admin();

comment on view public.seller_equipment_inventory_management is
'Seller-private Equipment & Supplies management projection. Public storefront and checkout flows are intentionally excluded from Phase 1.';

grant select on public.seller_equipment_inventory_management to authenticated;

create or replace function public.validate_equipment_module_enabled(
  p_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  select stores.equipment_supplies_enabled
  into v_enabled
  from public.stores
  where stores.id = p_store_id;

  if v_enabled is distinct from true then
    raise exception 'Equipment & Supplies is turned off for this store.';
  end if;
end;
$$;

create or replace function public.validate_equipment_inventory_values(
  p_item_name text,
  p_category text,
  p_condition text,
  p_quantity_available integer,
  p_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_item_name), '') is null then
    raise exception 'Item name is required.';
  end if;

  if p_category not in (
    'Feeders & Waterers',
    'Brooders & Heat',
    'Incubators & Hatching',
    'Coops & Housing',
    'Transport & Crates',
    'Fencing & Containment',
    'Miscellaneous'
  ) then
    raise exception 'Choose a supported category.';
  end if;

  if nullif(trim(coalesce(p_condition, '')), '') is not null
    and p_condition not in ('New', 'Like New', 'Good', 'Fair', 'For Parts') then
    raise exception 'Choose a supported condition.';
  end if;

  if coalesce(p_quantity_available, -1) < 0 then
    raise exception 'Quantity available must be zero or more.';
  end if;

  if coalesce(p_price, -1) < 0 then
    raise exception 'Price must be zero or more.';
  end if;
end;
$$;

create or replace function public.seller_create_equipment_inventory_item(
  p_store_id uuid,
  p_item_name text,
  p_category text,
  p_quantity_available integer,
  p_price numeric,
  p_condition text default null,
  p_description text default null,
  p_seller_notes text default null
)
returns public.equipment_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.equipment_inventory_items%rowtype;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to create equipment inventory.';
  end if;

  perform public.validate_equipment_module_enabled(p_store_id);
  perform public.validate_equipment_inventory_values(
    p_item_name,
    p_category,
    nullif(trim(p_condition), ''),
    p_quantity_available,
    p_price
  );

  insert into public.equipment_inventory_items (
    store_id,
    item_name,
    category,
    condition,
    description,
    quantity_available,
    price,
    visibility_status,
    seller_notes
  )
  values (
    p_store_id,
    trim(p_item_name),
    p_category,
    nullif(trim(p_condition), ''),
    nullif(trim(p_description), ''),
    coalesce(p_quantity_available, 0),
    p_price,
    'hidden',
    nullif(trim(p_seller_notes), '')
  )
  returning * into v_item;

  return v_item;
end;
$$;

create or replace function public.seller_update_equipment_inventory_item(
  p_equipment_inventory_item_id uuid,
  p_item_name text,
  p_category text,
  p_quantity_available integer,
  p_price numeric,
  p_condition text default null,
  p_description text default null,
  p_seller_notes text default null
)
returns public.equipment_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.equipment_inventory_items%rowtype;
  v_updated_item public.equipment_inventory_items%rowtype;
begin
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

  if v_item.visibility_status = 'archived' then
    raise exception 'Archived equipment inventory cannot be edited.';
  end if;

  perform public.validate_equipment_inventory_values(
    p_item_name,
    p_category,
    nullif(trim(p_condition), ''),
    p_quantity_available,
    p_price
  );

  update public.equipment_inventory_items
  set
    item_name = trim(p_item_name),
    category = p_category,
    condition = nullif(trim(p_condition), ''),
    description = nullif(trim(p_description), ''),
    quantity_available = coalesce(p_quantity_available, 0),
    price = p_price,
    seller_notes = nullif(trim(p_seller_notes), '')
  where equipment_inventory_items.id = v_item.id
  returning * into v_updated_item;

  return v_updated_item;
end;
$$;

create or replace function public.seller_adjust_equipment_inventory_quantity(
  p_equipment_inventory_item_id uuid,
  p_quantity_available integer default null,
  p_quantity_delta integer default null
)
returns public.equipment_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.equipment_inventory_items%rowtype;
  v_updated_item public.equipment_inventory_items%rowtype;
  v_next_quantity integer;
begin
  if (p_quantity_available is null and p_quantity_delta is null)
    or (p_quantity_available is not null and p_quantity_delta is not null) then
    raise exception 'Provide either an absolute quantity or a quantity change.';
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

  if v_item.visibility_status = 'archived' then
    raise exception 'Archived equipment inventory cannot be edited.';
  end if;

  if p_quantity_available is not null then
    v_next_quantity := p_quantity_available;
  else
    v_next_quantity := v_item.quantity_available + p_quantity_delta;
  end if;

  if v_next_quantity < 0 then
    raise exception 'Quantity available must be zero or more.';
  end if;

  update public.equipment_inventory_items
  set quantity_available = v_next_quantity
  where equipment_inventory_items.id = v_item.id
  returning * into v_updated_item;

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

  if v_item.visibility_status = 'archived'
    and p_visibility_status <> 'archived' then
    raise exception 'Archived equipment inventory cannot be restored yet.';
  end if;

  update public.equipment_inventory_items
  set
    visibility_status = p_visibility_status,
    first_published_at = case
      when p_visibility_status in ('active', 'sold_out')
        then coalesce(equipment_inventory_items.first_published_at, now())
      else equipment_inventory_items.first_published_at
    end,
    archived_at = case
      when p_visibility_status = 'archived'
        then coalesce(equipment_inventory_items.archived_at, now())
      else null
    end
  where equipment_inventory_items.id = v_item.id
  returning * into v_updated_item;

  return v_updated_item;
end;
$$;

create or replace function public.seller_get_equipment_draft_delete_status(
  p_equipment_inventory_item_id uuid
)
returns table (
  is_draft boolean,
  has_order_history boolean,
  has_published_activity boolean,
  can_delete boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.equipment_inventory_items%rowtype;
  v_is_draft boolean;
  v_has_order_history boolean := false;
  v_has_published_activity boolean;
begin
  select *
  into v_item
  from public.equipment_inventory_items
  where equipment_inventory_items.id = p_equipment_inventory_item_id;

  if v_item.id is null then
    raise exception 'Equipment inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to inspect this equipment inventory.';
  end if;

  v_is_draft := v_item.visibility_status = 'hidden';
  v_has_published_activity := v_item.first_published_at is not null;

  return query
  select
    v_is_draft,
    v_has_order_history,
    v_has_published_activity,
    v_is_draft
      and not v_has_order_history
      and not v_has_published_activity;
end;
$$;

create or replace function public.seller_delete_equipment_draft(
  p_equipment_inventory_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.equipment_inventory_items%rowtype;
begin
  select *
  into v_item
  from public.equipment_inventory_items
  where equipment_inventory_items.id = p_equipment_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Equipment inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to delete this equipment draft.';
  end if;

  if v_item.visibility_status <> 'hidden' then
    raise exception 'Only drafts can be deleted.';
  end if;

  if v_item.first_published_at is not null then
    raise exception 'This equipment inventory has been published before and can only be archived.';
  end if;

  delete from public.equipment_inventory_items
  where equipment_inventory_items.id = v_item.id;
end;
$$;

comment on function public.seller_create_equipment_inventory_item(
  uuid, text, text, integer, numeric, text, text, text
) is
'Trusted seller/admin RPC for creating seller-only Equipment & Supplies draft inventory.';

comment on function public.seller_update_equipment_inventory_item(
  uuid, text, text, integer, numeric, text, text, text
) is
'Trusted seller/admin RPC for updating Equipment & Supplies inventory details without exposing moderation fields.';

comment on function public.seller_adjust_equipment_inventory_quantity(
  uuid, integer, integer
) is
'Trusted seller/admin RPC for adjusting Equipment & Supplies quantity.';

comment on function public.seller_set_equipment_inventory_visibility(
  uuid, text
) is
'Trusted seller/admin RPC for publishing, hiding, marking sold out, or archiving Equipment & Supplies inventory.';

comment on function public.seller_get_equipment_draft_delete_status(uuid) is
'Trusted seller/admin RPC that reports whether an equipment row is a never-published draft and can be permanently deleted.';

comment on function public.seller_delete_equipment_draft(uuid) is
'Trusted seller/admin RPC to permanently delete never-published Equipment & Supplies drafts.';

revoke all on function public.validate_equipment_module_enabled(uuid) from public;
revoke all on function public.validate_equipment_inventory_values(
  text, text, text, integer, numeric
) from public;
revoke all on function public.seller_create_equipment_inventory_item(
  uuid, text, text, integer, numeric, text, text, text
) from public;
revoke all on function public.seller_update_equipment_inventory_item(
  uuid, text, text, integer, numeric, text, text, text
) from public;
revoke all on function public.seller_adjust_equipment_inventory_quantity(
  uuid, integer, integer
) from public;
revoke all on function public.seller_set_equipment_inventory_visibility(
  uuid, text
) from public;
revoke all on function public.seller_get_equipment_draft_delete_status(uuid) from public;
revoke all on function public.seller_delete_equipment_draft(uuid) from public;

grant execute on function public.seller_create_equipment_inventory_item(
  uuid, text, text, integer, numeric, text, text, text
) to authenticated;
grant execute on function public.seller_update_equipment_inventory_item(
  uuid, text, text, integer, numeric, text, text, text
) to authenticated;
grant execute on function public.seller_adjust_equipment_inventory_quantity(
  uuid, integer, integer
) to authenticated;
grant execute on function public.seller_set_equipment_inventory_visibility(
  uuid, text
) to authenticated;
grant execute on function public.seller_get_equipment_draft_delete_status(uuid) to authenticated;
grant execute on function public.seller_delete_equipment_draft(uuid) to authenticated;
