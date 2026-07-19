begin;

create table if not exists public.hatching_egg_inventory_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  item_name text not null,
  species_id uuid not null references public.species(id),
  description text,
  quantity_available integer not null default 0,
  price numeric(10, 2) not null default 0,
  available_date date not null,
  minimum_order_quantity integer,
  visibility_status text not null default 'hidden',
  moderation_status text not null default 'normal',
  seller_notes text,
  first_published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hatching_egg_inventory_item_name_not_empty_check check (
    length(trim(item_name)) > 0
  ),
  constraint hatching_egg_inventory_description_not_empty_check check (
    description is null or length(trim(description)) > 0
  ),
  constraint hatching_egg_inventory_quantity_nonnegative_check check (
    quantity_available >= 0
  ),
  constraint hatching_egg_inventory_price_nonnegative_check check (
    price >= 0
  ),
  constraint hatching_egg_inventory_minimum_order_positive_check check (
    minimum_order_quantity is null or minimum_order_quantity >= 1
  ),
  constraint hatching_egg_inventory_visibility_status_check check (
    visibility_status in ('hidden', 'active', 'sold_out', 'archived')
  ),
  constraint hatching_egg_inventory_moderation_status_check check (
    moderation_status in ('normal', 'flagged')
  ),
  constraint hatching_egg_inventory_seller_notes_not_empty_check check (
    seller_notes is null or length(trim(seller_notes)) > 0
  )
);

comment on table public.hatching_egg_inventory_items is
'Seller-owned standalone Hatching Eggs inventory. One row is one hatching egg item and is intentionally separate from listing batches, listing batch breeds, seller breed profiles, and the breed library.';

create index if not exists hatching_egg_inventory_store_visibility_idx
on public.hatching_egg_inventory_items(store_id, visibility_status);

create index if not exists hatching_egg_inventory_store_species_idx
on public.hatching_egg_inventory_items(store_id, species_id);

create index if not exists hatching_egg_inventory_store_updated_at_idx
on public.hatching_egg_inventory_items(store_id, updated_at desc);

drop trigger if exists hatching_egg_inventory_items_set_updated_at
on public.hatching_egg_inventory_items;

create trigger hatching_egg_inventory_items_set_updated_at
before update on public.hatching_egg_inventory_items
for each row
execute function public.set_updated_at();

alter table public.hatching_egg_inventory_items enable row level security;

drop policy if exists "Store owners can read own hatching egg inventory"
on public.hatching_egg_inventory_items;

create policy "Store owners can read own hatching egg inventory"
on public.hatching_egg_inventory_items
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

drop policy if exists "Platform admins can directly mutate hatching egg inventory"
on public.hatching_egg_inventory_items;

create policy "Platform admins can directly mutate hatching egg inventory"
on public.hatching_egg_inventory_items
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.hatching_egg_inventory_items from anon, authenticated;
grant select on public.hatching_egg_inventory_items to authenticated;

create or replace function public.validate_hatching_eggs_module_enabled(
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
  select stores.hatching_eggs_enabled
  into v_enabled
  from public.stores
  where stores.id = p_store_id;

  if v_enabled is distinct from true then
    raise exception 'Hatching Eggs is not enabled for this store.';
  end if;
end;
$$;

create or replace function public.validate_hatching_egg_inventory_values(
  p_item_name text,
  p_species_id uuid,
  p_available_date date,
  p_quantity_available integer,
  p_price numeric,
  p_minimum_order_quantity integer default null
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_item_name), '') is null then
    raise exception 'Item name is required.';
  end if;

  if p_species_id is null or not exists (
    select 1
    from public.species
    where species.id = p_species_id
      and species.is_active = true
  ) then
    raise exception 'Choose an active species.';
  end if;

  if p_available_date is null then
    raise exception 'Available date is required.';
  end if;

  if coalesce(p_quantity_available, -1) < 0 then
    raise exception 'Quantity available must be zero or more.';
  end if;

  if p_price is null or p_price < 0 then
    raise exception 'Price must be zero or more.';
  end if;

  if p_minimum_order_quantity is not null and p_minimum_order_quantity < 1 then
    raise exception 'Minimum order quantity must be one or more.';
  end if;
end;
$$;

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
  hatching_items.updated_at
from public.hatching_egg_inventory_items as hatching_items
join public.species
  on species.id = hatching_items.species_id
where public.owns_store(hatching_items.store_id)
   or public.is_admin();

comment on view public.seller_hatching_egg_inventory_management is
'Seller-private standalone Hatching Eggs management projection for Add-only support.';

grant select on public.seller_hatching_egg_inventory_management to authenticated;

create or replace function public.seller_create_hatching_egg_inventory_item(
  p_store_id uuid,
  p_item_name text,
  p_species_id uuid,
  p_available_date date,
  p_quantity_available integer,
  p_price numeric,
  p_minimum_order_quantity integer default null,
  p_description text default null,
  p_seller_notes text default null
)
returns table (
  hatching_egg_inventory_item_id uuid,
  id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.hatching_egg_inventory_items%rowtype;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to create hatching egg inventory.';
  end if;

  perform public.validate_hatching_eggs_module_enabled(p_store_id);
  perform public.validate_hatching_egg_inventory_values(
    p_item_name,
    p_species_id,
    p_available_date,
    p_quantity_available,
    p_price,
    p_minimum_order_quantity
  );

  insert into public.hatching_egg_inventory_items (
    store_id,
    item_name,
    species_id,
    available_date,
    description,
    quantity_available,
    price,
    minimum_order_quantity,
    visibility_status,
    seller_notes
  )
  values (
    p_store_id,
    trim(p_item_name),
    p_species_id,
    p_available_date,
    nullif(trim(p_description), ''),
    coalesce(p_quantity_available, 0),
    p_price,
    p_minimum_order_quantity,
    'hidden',
    nullif(trim(p_seller_notes), '')
  )
  returning * into v_item;

  return query
  select v_item.id, v_item.id;
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

  update public.hatching_egg_inventory_items
  set
    visibility_status = p_visibility_status,
    first_published_at = case
      when p_visibility_status = 'active'
        then coalesce(first_published_at, now())
      else first_published_at
    end,
    archived_at = case
      when p_visibility_status = 'archived'
        then coalesce(archived_at, now())
      else archived_at
    end
  where hatching_egg_inventory_items.id = v_item.id
  returning * into v_updated_item;

  return v_updated_item;
end;
$$;

alter table public.media_links
  drop constraint if exists media_links_entity_type_check;

alter table public.media_links
  add constraint media_links_entity_type_check check (
    entity_type in (
      'store',
      'seller_breed_profile',
      'listing_batch',
      'listing_batch_breed',
      'inventory_item',
      'equipment_inventory_item',
      'processed_poultry_inventory_item',
      'hatching_egg_inventory_item'
    )
  );

create or replace function public.validate_seller_media_entity(
  p_store_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_store_id is null or p_entity_type is null or p_entity_id is null then
    return false;
  end if;

  case p_entity_type
    when 'store' then
      return p_entity_id = p_store_id and exists (
        select 1 from public.stores as stores where stores.id = p_store_id
      );
    when 'listing_batch' then
      return exists (
        select 1 from public.listing_batches as listing_batches
        where listing_batches.id = p_entity_id and listing_batches.store_id = p_store_id
      );
    when 'listing_batch_breed' then
      return exists (
        select 1 from public.listing_batch_breeds as listing_batch_breeds
        where listing_batch_breeds.id = p_entity_id and listing_batch_breeds.store_id = p_store_id
      );
    when 'inventory_item' then
      return exists (
        select 1 from public.inventory_items as inventory_items
        where inventory_items.id = p_entity_id and inventory_items.store_id = p_store_id
      );
    when 'seller_breed_profile' then
      return exists (
        select 1 from public.seller_breed_profiles as seller_breed_profiles
        where seller_breed_profiles.id = p_entity_id and seller_breed_profiles.store_id = p_store_id
      );
    when 'equipment_inventory_item' then
      return exists (
        select 1 from public.equipment_inventory_items as equipment_items
        where equipment_items.id = p_entity_id and equipment_items.store_id = p_store_id
      );
    when 'processed_poultry_inventory_item' then
      return exists (
        select 1 from public.processed_poultry_inventory_items as processed_items
        where processed_items.id = p_entity_id and processed_items.store_id = p_store_id
      );
    when 'hatching_egg_inventory_item' then
      return exists (
        select 1 from public.hatching_egg_inventory_items as hatching_items
        where hatching_items.id = p_entity_id and hatching_items.store_id = p_store_id
      );
    else
      return false;
  end case;
end;
$$;

create or replace function public.validate_seller_media_context(
  p_entity_type text,
  p_display_context text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_entity_type
    when 'store' then p_display_context in ('logo', 'hero', 'gallery')
    when 'listing_batch' then p_display_context in ('primary', 'gallery')
    when 'listing_batch_breed' then p_display_context in ('primary', 'gallery')
    when 'inventory_item' then p_display_context in ('primary', 'gallery')
    when 'seller_breed_profile' then p_display_context in ('primary', 'gallery')
    when 'equipment_inventory_item' then p_display_context in ('primary', 'gallery')
    when 'processed_poultry_inventory_item' then p_display_context in ('primary', 'gallery')
    when 'hatching_egg_inventory_item' then p_display_context in ('primary', 'gallery')
    else false
  end;
$$;

create or replace function public.enforce_hatching_egg_media_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_active_count integer;
begin
  if new.entity_type <> 'hatching_egg_inventory_item'
    or new.display_context <> 'gallery'
    or new.visibility_status <> 'active' then
    return new;
  end if;

  select count(*)
  into v_active_count
  from public.media_links as media_links
  join public.media_assets as media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.entity_type = new.entity_type
    and media_links.entity_id = new.entity_id
    and media_links.display_context = new.display_context
    and media_links.visibility_status = 'active'
    and media_links.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and media_assets.asset_status = 'active';

  if v_active_count >= 4 then
    raise exception 'Hatching Eggs can have up to 4 photos.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_hatching_egg_media_limit_trigger on public.media_links;

create trigger enforce_hatching_egg_media_limit_trigger
before insert or update of entity_type, entity_id, display_context, visibility_status
on public.media_links
for each row
execute function public.enforce_hatching_egg_media_limit();

comment on function public.validate_hatching_egg_inventory_values(text, uuid, date, integer, numeric, integer) is
'Validates standalone Hatching Eggs inventory fields for seller-facing Add flow.';

comment on function public.seller_create_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) is
'Trusted seller/admin RPC for creating standalone Hatching Eggs draft inventory.';

comment on function public.seller_set_hatching_egg_inventory_visibility(uuid, text) is
'Trusted seller/admin RPC for publishing or changing standalone Hatching Eggs inventory visibility.';

comment on function public.enforce_hatching_egg_media_limit() is
'Keeps standalone Hatching Eggs inventory items limited to four active gallery photos.';

revoke all on function public.validate_hatching_eggs_module_enabled(uuid) from public;
revoke all on function public.validate_hatching_egg_inventory_values(text, uuid, date, integer, numeric, integer) from public;
revoke all on function public.seller_create_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) from public;
revoke all on function public.seller_set_hatching_egg_inventory_visibility(uuid, text) from public;
revoke all on function public.enforce_hatching_egg_media_limit() from public;

grant execute on function public.seller_create_hatching_egg_inventory_item(uuid, text, uuid, date, integer, numeric, integer, text, text) to authenticated;
grant execute on function public.seller_set_hatching_egg_inventory_visibility(uuid, text) to authenticated;

commit;
