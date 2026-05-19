-- Group 4: Listing Batches
-- Table:
-- - listing_batches
--
-- Purpose:
-- Live-animal batch/date/pricing parent table.
--
-- Scope:
-- - This table is live-animal only.
-- - Standard Products will use a separate future flow and should not be
--   represented in listing_batches.
-- - Group 4 intentionally does not create listing_batch_breeds,
--   inventory_items, photos, orders, carts, or standard product tables.
--
-- Ownership path:
-- listing_batches.store_id -> stores.id -> stores.owner_user_id -> auth.uid()
--
-- Requires Group 1:
-- - public.stores
-- - public.owns_store(uuid)
-- - public.is_admin()
-- - public.set_updated_at()
--
-- Requires Group 2:
-- - public.species
--
-- Verified existing columns:
-- - public.stores.id
-- - public.stores.owner_user_id
-- - public.species.id
--
-- Privacy and control notes:
-- - internal_batch_label is private/seller-facing, nullable, and not unique.
-- - seller_notes is private and must not be exposed publicly.
-- - moderation_status is platform-owned and should not be editable through
--   seller-facing forms or APIs.
-- - Sellers should archive batches with visibility_status = 'archived'.
--   Sellers do not receive a hard-delete policy.
--
-- Pricing note:
-- - When auto_price_increase_enabled is true, app/business logic applies
--   weekly price increases starting on available_date.
-- - No interval/start columns are stored in V1.

create table public.listing_batches (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  species_id uuid not null references public.species(id),

  origin_date date not null,
  available_date date not null,

  age_at_availability_days integer generated always as (
    available_date - origin_date
  ) stored,

  base_price numeric(10, 2) not null,

  auto_price_increase_enabled boolean not null default false,
  auto_price_increase_amount numeric(10, 2),
  auto_price_increase_max_price numeric(10, 2),

  internal_batch_label text,
  seller_notes text,

  visibility_status text not null default 'active',
  moderation_status text not null default 'normal',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint listing_batches_available_date_after_origin_date_check check (
    available_date >= origin_date
  ),

  constraint listing_batches_base_price_nonnegative_check check (
    base_price >= 0
  ),

  constraint listing_batches_auto_price_amount_positive_when_present_check check (
    auto_price_increase_amount is null
    or auto_price_increase_amount > 0
  ),

  constraint listing_batches_auto_price_max_price_check check (
    auto_price_increase_max_price is null
    or auto_price_increase_max_price >= base_price
  ),

  constraint listing_batches_auto_price_disabled_fields_null_check check (
    (
      auto_price_increase_enabled = false
      and auto_price_increase_amount is null
      and auto_price_increase_max_price is null
    )
    or auto_price_increase_enabled = true
  ),

  constraint listing_batches_auto_price_enabled_amount_required_check check (
    auto_price_increase_enabled = false
    or auto_price_increase_amount is not null
  ),

  constraint listing_batches_internal_batch_label_not_empty_check check (
    internal_batch_label is null
    or length(trim(internal_batch_label)) > 0
  ),

  constraint listing_batches_seller_notes_not_empty_check check (
    seller_notes is null
    or length(trim(seller_notes)) > 0
  ),

  constraint listing_batches_visibility_status_check check (
    visibility_status in ('active', 'hidden', 'sold_out', 'archived')
  ),

  constraint listing_batches_moderation_status_check check (
    moderation_status in ('normal', 'flagged')
  )
);

comment on table public.listing_batches is
'Live-animal batch/date/pricing parent table. Standard Products are a separate future flow and should not be represented here.';

comment on column public.listing_batches.origin_date is
'Birth, hatch, or acquisition date for this live-animal batch.';

comment on column public.listing_batches.available_date is
'Date this live-animal batch becomes available to buyers.';

comment on column public.listing_batches.age_at_availability_days is
'Generated age in days at availability, derived from available_date minus origin_date.';

comment on column public.listing_batches.base_price is
'Default base price for inventory items in this batch unless item-level pricing overrides are added later.';

comment on column public.listing_batches.auto_price_increase_enabled is
'When enabled, app/business logic increases effective price weekly starting on available_date.';

comment on column public.listing_batches.auto_price_increase_amount is
'Required and greater than zero when auto_price_increase_enabled is true.';

comment on column public.listing_batches.auto_price_increase_max_price is
'Optional cap for auto price increases. When present, it must be greater than or equal to base_price.';

comment on column public.listing_batches.internal_batch_label is
'Private seller-facing label for distinguishing batches. Nullable and not unique. Do not expose publicly.';

comment on column public.listing_batches.seller_notes is
'Private seller notes. Do not expose through public storefront views, public APIs, or public table selects.';

comment on column public.listing_batches.visibility_status is
'Visibility meanings: active = publicly visible; hidden = seller hidden; sold_out = visible but unavailable; archived = retired record.';

comment on column public.listing_batches.moderation_status is
'Platform-owned moderation status. Sellers should not edit this through seller-facing forms or APIs.';


-- Seller dashboard indexes

create index listing_batches_store_created_at_idx
on public.listing_batches(store_id, created_at desc);

create index listing_batches_store_visibility_idx
on public.listing_batches(store_id, visibility_status);

create index listing_batches_store_species_idx
on public.listing_batches(store_id, species_id);

create index listing_batches_store_available_date_idx
on public.listing_batches(store_id, available_date);


-- Storefront/public browsing indexes for future safe view/RPC queries

create index listing_batches_store_visibility_available_date_idx
on public.listing_batches(store_id, visibility_status, available_date);

create index listing_batches_store_species_visibility_available_date_idx
on public.listing_batches(store_id, species_id, visibility_status, available_date);


-- Moderation

create index listing_batches_moderation_updated_at_idx
on public.listing_batches(moderation_status, updated_at desc);


-- Partial index for future public-safe storefront projection

create index listing_batches_public_store_available_date_idx
on public.listing_batches(store_id, available_date)
where visibility_status in ('active', 'sold_out')
  and moderation_status = 'normal';


-- updated_at trigger

create trigger listing_batches_set_updated_at
before update on public.listing_batches
for each row
execute function public.set_updated_at();


-- RLS

alter table public.listing_batches enable row level security;


create policy "Store owners can read own listing batches"
on public.listing_batches
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can insert own listing batches"
on public.listing_batches
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can update own listing batches"
on public.listing_batches
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


create policy "Platform admins can delete listing batches"
on public.listing_batches
for delete
to authenticated
using (
  public.is_admin()
);

-- Public read policy intentionally omitted.
-- Reason: this base table contains private seller fields:
-- - internal_batch_label
-- - seller_notes
--
-- Future public storefront reads should use a public-safe view/RPC that omits
-- private columns and applies storefront eligibility checks against:
-- - stores.store_status
-- - stores.storefront_mode
-- - stores.admin_hold_reason
-- - species.is_active
