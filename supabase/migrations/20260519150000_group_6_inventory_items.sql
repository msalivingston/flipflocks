-- Group 6: Inventory Items
-- Tables:
-- - listing_batches patch
-- - inventory_items
--
-- Scope:
-- - Adds batch_type to listing_batches for the unified Live Animals & Eggs flow.
-- - Creates inventory_items as the actual sellable inventory row layer.
-- - Does not create photos, orders, carts, public storefront views/RPCs,
--   standard product tables, or app code.
--
-- Hierarchy:
-- stores -> listing_batches -> listing_batch_breeds -> inventory_items
--
-- Hatching eggs:
-- - Hatching eggs remain inside the Live Animals & Eggs workflow.
-- - Hatching egg batches use batch_type = 'hatching_eggs'.
-- - Hatching egg batches must have origin_date = available_date.
-- - Future UI/public views should suppress age display for hatching egg batches.
--
-- Server/API validation required:
-- - inventory_items.store_id = listing_batches.store_id
-- - inventory_items.store_id = listing_batch_breeds.store_id
-- - inventory_items.listing_batch_id = listing_batch_breeds.listing_batch_id
-- - listing_batches.store_id = listing_batch_breeds.store_id
-- - seller_breed_profiles.store_id = listing_batch_breeds.store_id
-- - listing_batches.species_id = seller_breed_profiles.species_id
-- - batch_type = 'hatching_eggs' only allows inventory_type = 'hatching_eggs'
-- - batch_type = 'live_animals' does not allow inventory_type = 'hatching_eggs'
--
-- Inventory quantity and pricing:
-- - quantity_available is the V1 quantity source of truth.
-- - No reserved/sold/on-hand quantity fields are created in Group 6.
-- - price_override is optional.
-- - Effective price is calculated later by trusted server code from item override,
--   batch base price, and batch auto-pricing rules.
-- - No computed current price is stored here.

alter table public.listing_batches
add column batch_type text not null default 'live_animals';

alter table public.listing_batches
add constraint listing_batches_batch_type_check check (
  batch_type in ('live_animals', 'hatching_eggs')
);

alter table public.listing_batches
add constraint listing_batches_hatching_eggs_origin_available_same_check check (
  batch_type <> 'hatching_eggs'
  or origin_date = available_date
);

comment on column public.listing_batches.batch_type is
'Batch type for the unified Live Animals & Eggs workflow. live_animals uses origin_date plus available_date and may display age. hatching_eggs uses available_date only, with origin_date set equal to available_date and age hidden in public display.';


create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  listing_batch_id uuid not null references public.listing_batches(id) on delete cascade,
  listing_batch_breed_id uuid not null references public.listing_batch_breeds(id) on delete cascade,

  inventory_type text not null,
  custom_inventory_label text,

  quantity_available integer not null default 0,

  price_override numeric(10, 2),

  sort_order integer not null default 0,

  visibility_status text not null default 'active',
  moderation_status text not null default 'normal',

  seller_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inventory_items_inventory_type_check check (
    inventory_type in (
      'female',
      'male',
      'straight_run',
      'unsexed',
      'pair',
      'trio',
      'hatching_eggs',
      'other'
    )
  ),

  constraint inventory_items_other_requires_custom_label_check check (
    inventory_type <> 'other'
    or custom_inventory_label is not null
  ),

  constraint inventory_items_custom_inventory_label_not_empty_check check (
    custom_inventory_label is null
    or length(trim(custom_inventory_label)) > 0
  ),

  constraint inventory_items_quantity_available_nonnegative_check check (
    quantity_available >= 0
  ),

  constraint inventory_items_price_override_nonnegative_check check (
    price_override is null
    or price_override >= 0
  ),

  constraint inventory_items_sort_order_nonnegative_check check (
    sort_order >= 0
  ),

  constraint inventory_items_visibility_status_check check (
    visibility_status in ('active', 'hidden', 'archived')
  ),

  constraint inventory_items_moderation_status_check check (
    moderation_status in ('normal', 'flagged')
  ),

  constraint inventory_items_seller_notes_not_empty_check check (
    seller_notes is null
    or length(trim(seller_notes)) > 0
  ),

  constraint inventory_items_batch_breed_type_unique unique (
    listing_batch_breed_id,
    inventory_type
  )
);

comment on column public.inventory_items.store_id is
'Tenant ownership field used for RLS and seller/admin access checks. Trusted server/API validation must ensure this matches parent batch and batch breed rows.';

comment on column public.inventory_items.listing_batch_id is
'Parent listing batch. Duplicated for RLS, indexing, future order snapshots, and trusted server/API validation.';

comment on column public.inventory_items.listing_batch_breed_id is
'Parent breed grouping within a listing batch.';

comment on column public.inventory_items.inventory_type is
'Filterable sellable inventory type for buyer and seller workflows. Hatching egg compatibility with batch_type is enforced by trusted server/API validation.';

comment on column public.inventory_items.custom_inventory_label is
'Optional custom label for seller/buyer display. Required when inventory_type = other.';

comment on column public.inventory_items.quantity_available is
'Current sellable quantity. Inventory decreases only when an official order is created through trusted server-side logic.';

comment on column public.inventory_items.price_override is
'Optional item-level starting price override. Effective price is calculated later from this value or batch base price plus batch auto-pricing rules.';

comment on column public.inventory_items.visibility_status is
'Visibility meanings: active = seller intends item to be visible/sellable; hidden = seller hidden; archived = retired record. Sold out is derived from quantity_available = 0.';

comment on column public.inventory_items.moderation_status is
'Platform-owned moderation status. Sellers should not edit this through seller-facing forms or APIs.';

comment on column public.inventory_items.seller_notes is
'Private seller notes. Do not expose through public storefront views, public APIs, or public table selects.';

comment on constraint inventory_items_batch_breed_type_unique
on public.inventory_items is
'Prevents duplicate inventory_type rows within the same listing_batch_breed for V1.';

comment on constraint inventory_items_other_requires_custom_label_check
on public.inventory_items is
'Inventory type other must include a custom_inventory_label.';

comment on table public.inventory_items is
'Actual sellable inventory row layer under listing_batch_breeds. Public reads must use a future safe view/RPC. Store, batch, breed, species, and batch_type compatibility are intentionally enforced by trusted server/API validation rather than triggers in Group 6.';


-- Seller dashboard and inventory editing indexes

create index inventory_items_store_batch_sort_order_idx
on public.inventory_items(store_id, listing_batch_id, sort_order);

create index inventory_items_store_batch_breed_sort_order_idx
on public.inventory_items(store_id, listing_batch_breed_id, sort_order);

create index inventory_items_store_visibility_idx
on public.inventory_items(store_id, visibility_status);


-- Future storefront-safe projection and filtering indexes

create index inventory_items_batch_visibility_sort_order_idx
on public.inventory_items(listing_batch_id, visibility_status, sort_order);

create index inventory_items_batch_breed_visibility_sort_order_idx
on public.inventory_items(listing_batch_breed_id, visibility_status, sort_order);

create index inventory_items_inventory_type_idx
on public.inventory_items(inventory_type);

create index inventory_items_store_inventory_type_idx
on public.inventory_items(store_id, inventory_type);


-- Join helper indexes

create index inventory_items_listing_batch_id_idx
on public.inventory_items(listing_batch_id);

create index inventory_items_listing_batch_breed_id_idx
on public.inventory_items(listing_batch_breed_id);


-- Moderation

create index inventory_items_moderation_updated_at_idx
on public.inventory_items(moderation_status, updated_at desc);


-- updated_at trigger

create trigger inventory_items_set_updated_at
before update on public.inventory_items
for each row
execute function public.set_updated_at();


-- RLS

alter table public.inventory_items enable row level security;


create policy "Store owners can read own inventory items"
on public.inventory_items
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can insert own inventory items"
on public.inventory_items
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can update own inventory items"
on public.inventory_items
for update
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
)
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Platform admins can delete inventory items"
on public.inventory_items
for delete
to authenticated
using (
  public.is_admin()
);

-- Public read policy intentionally omitted.
-- Reason: this base table contains private seller_notes.
--
-- Future public storefront reads should use a public-safe view/RPC that omits
-- private columns and applies storefront eligibility checks across:
-- - stores
-- - listing_batches
-- - listing_batch_breeds
-- - seller_breed_profiles
-- - inventory_items
