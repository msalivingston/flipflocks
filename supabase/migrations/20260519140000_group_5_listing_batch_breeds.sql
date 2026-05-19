-- Group 5: Listing Batch Breeds
-- Table:
-- - listing_batch_breeds
--
-- Purpose:
-- Breed grouping layer inside a live-animal listing batch.
--
-- Scope:
-- - Group 5 creates listing_batch_breeds only.
-- - Group 5 intentionally does not create inventory_items, photos, orders,
--   carts, public storefront views/RPCs, standard product tables, or app code.
--
-- Hierarchy:
-- stores -> listing_batches -> listing_batch_breeds -> inventory_items
--
-- Ownership path:
-- listing_batch_breeds.store_id -> stores.id -> stores.owner_user_id -> auth.uid()
--
-- Requires Group 1:
-- - public.stores
-- - public.owns_store(uuid)
-- - public.is_admin()
-- - public.set_updated_at()
--
-- Requires Group 3:
-- - public.seller_breed_profiles
--
-- Requires Group 4:
-- - public.listing_batches
--
-- Breed display data:
-- - seller_breed_profiles remains the source of truth for breed display name,
--   breed description, and default breed photo.
-- - This table intentionally does not snapshot display_breed_name or
--   breed_description.
-- - Future listings should reflect updates made to seller_breed_profiles.
--
-- Privacy and control notes:
-- - seller_notes is private and must not be exposed publicly.
-- - moderation_status is platform-owned and should not be editable through
--   seller-facing forms or APIs.
-- - Sellers should archive rows with visibility_status = 'archived'.
--   Sellers do not receive a hard-delete policy.
--
-- Consistency note:
-- - Store/species consistency is intentionally enforced by trusted server/API
--   validation, not by species_id or composite foreign keys in this table.
-- - Server/API validation must enforce:
--   - listing_batches.store_id = listing_batch_breeds.store_id
--   - seller_breed_profiles.store_id = listing_batch_breeds.store_id
--   - listing_batches.species_id = seller_breed_profiles.species_id

create table public.listing_batch_breeds (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  listing_batch_id uuid not null references public.listing_batches(id) on delete cascade,
  seller_breed_profile_id uuid not null references public.seller_breed_profiles(id),

  seller_notes text,

  sort_order integer not null default 0,

  visibility_status text not null default 'active',
  moderation_status text not null default 'normal',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint listing_batch_breeds_seller_notes_not_empty_check check (
    seller_notes is null
    or length(trim(seller_notes)) > 0
  ),

  constraint listing_batch_breeds_sort_order_nonnegative_check check (
    sort_order >= 0
  ),

  constraint listing_batch_breeds_visibility_status_check check (
    visibility_status in ('active', 'hidden', 'archived')
  ),

  constraint listing_batch_breeds_moderation_status_check check (
    moderation_status in ('normal', 'flagged')
  ),

  constraint listing_batch_breeds_batch_profile_unique unique (
    listing_batch_id,
    seller_breed_profile_id
  )
);

comment on table public.listing_batch_breeds is
'Breed grouping layer inside a live-animal listing batch. Inventory quantities and item-level prices belong in future inventory_items.';

comment on column public.listing_batch_breeds.store_id is
'Tenant ownership field used for RLS and seller/admin access checks. Server/API validation must ensure this matches the parent listing batch and seller breed profile.';

comment on column public.listing_batch_breeds.listing_batch_id is
'Parent live-animal listing batch. Group 5 does not create inventory items.';

comment on column public.listing_batch_breeds.seller_breed_profile_id is
'Seller breed profile used as the source of truth for breed display name, description, and default breed photo.';

comment on column public.listing_batch_breeds.seller_notes is
'Private seller notes for this breed within this batch. Do not expose through public storefront views, public APIs, or public table selects.';

comment on column public.listing_batch_breeds.sort_order is
'Seller-facing ordering value for arranging breed groups within a batch.';

comment on column public.listing_batch_breeds.visibility_status is
'Visibility meanings: active = visible to seller workflows and future eligible storefront projections; hidden = seller hidden; archived = retired record.';

comment on column public.listing_batch_breeds.moderation_status is
'Platform-owned moderation status. Sellers should not edit this through seller-facing forms or APIs.';

comment on constraint listing_batch_breeds_batch_profile_unique
on public.listing_batch_breeds is
'Prevents adding the same seller breed profile to the same listing batch more than once.';

comment on constraint listing_batch_breeds_seller_notes_not_empty_check
on public.listing_batch_breeds is
'Private seller notes may be null but must not be empty or whitespace-only when present.';

comment on table public.listing_batch_breeds is
'Breed grouping layer inside a live-animal listing batch. seller_breed_profiles remains the source of truth for breed display data. Public reads must use a future safe view/RPC. Store/species consistency is intentionally enforced by trusted server/API validation, not by species_id or composite FKs in this table.';


-- Seller dashboard and batch editing indexes

create index listing_batch_breeds_store_batch_sort_order_idx
on public.listing_batch_breeds(store_id, listing_batch_id, sort_order);

create index listing_batch_breeds_store_visibility_idx
on public.listing_batch_breeds(store_id, visibility_status);

create index listing_batch_breeds_store_profile_idx
on public.listing_batch_breeds(store_id, seller_breed_profile_id);


-- Future storefront-safe projection indexes

create index listing_batch_breeds_batch_visibility_sort_order_idx
on public.listing_batch_breeds(listing_batch_id, visibility_status, sort_order);


-- Join helper indexes

create index listing_batch_breeds_listing_batch_id_idx
on public.listing_batch_breeds(listing_batch_id);

create index listing_batch_breeds_seller_breed_profile_id_idx
on public.listing_batch_breeds(seller_breed_profile_id);


-- Moderation

create index listing_batch_breeds_moderation_updated_at_idx
on public.listing_batch_breeds(moderation_status, updated_at desc);


-- updated_at trigger

create trigger listing_batch_breeds_set_updated_at
before update on public.listing_batch_breeds
for each row
execute function public.set_updated_at();


-- RLS

alter table public.listing_batch_breeds enable row level security;


create policy "Store owners can read own listing batch breeds"
on public.listing_batch_breeds
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can insert own listing batch breeds"
on public.listing_batch_breeds
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can update own listing batch breeds"
on public.listing_batch_breeds
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


create policy "Platform admins can delete listing batch breeds"
on public.listing_batch_breeds
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
-- - future inventory_items
