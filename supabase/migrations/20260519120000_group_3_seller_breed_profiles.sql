-- Group 3: Seller Breed Profiles
-- Table:
-- - seller_breed_profiles
--
-- Purpose:
-- Seller-owned breed profile layer connecting stores to platform-managed breeds
-- while allowing seller-specific descriptions, private notes, and custom breed names.
--
-- Ownership path:
-- seller_breed_profiles.store_id -> stores.id -> stores.owner_user_id -> auth.uid()
--
-- Requires Group 1:
-- - public.stores
-- - public.owns_store(uuid)
-- - public.is_admin()
-- - public.set_updated_at()
--
-- Requires Group 2:
-- - public.species
-- - public.breeds
--
-- V1 deletion rule:
-- Sellers do not receive a delete policy. They should archive with visibility_status = 'archived'.
--
-- Application/server validation note:
-- When breed_id is supplied, public.breeds.species_id must equal
-- seller_breed_profiles.species_id. Group 3 intentionally does not add a
-- composite foreign key for this.
--
-- Application/API control note:
-- Sellers must not be allowed to edit moderation_status through application UI
-- or API handlers.

create table public.seller_breed_profiles (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  species_id uuid not null references public.species(id),
  breed_id uuid references public.breeds(id),

  custom_breed_name text,
  normalized_custom_breed_name text,

  display_name text not null,
  seller_description text,
  seller_notes text,

  visibility_status text not null default 'active',
  moderation_status text not null default 'normal',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint seller_breed_profiles_display_name_not_empty_check check (
    length(trim(display_name)) > 0
  ),

  constraint seller_breed_profiles_visibility_status_check check (
    visibility_status in ('active', 'hidden', 'archived')
  ),

  constraint seller_breed_profiles_moderation_status_check check (
    moderation_status in ('normal', 'flagged')
  ),

  constraint seller_breed_profiles_exactly_one_breed_source_check check (
    (
      breed_id is not null
      and custom_breed_name is null
      and normalized_custom_breed_name is null
    )
    or
    (
      breed_id is null
      and custom_breed_name is not null
      and length(trim(custom_breed_name)) > 0
      and normalized_custom_breed_name is not null
      and length(trim(normalized_custom_breed_name)) > 0
    )
  )
);

comment on table public.seller_breed_profiles is
'Seller-owned breed profiles. Bridges stores to platform-managed breeds or store-owned custom breed names. Seller-created custom breeds are not automatically promoted into breeds.';

comment on column public.seller_breed_profiles.breed_id is
'Transitional reference to public.breeds, which currently represents platform-managed global breed templates.';

comment on column public.seller_breed_profiles.seller_notes is
'Private seller-only notes. Do not expose through public storefront views.';

comment on column public.seller_breed_profiles.display_name is
'Public/seller-facing breed display name. Future order snapshots should preserve historical naming.';

create index seller_breed_profiles_store_id_idx
on public.seller_breed_profiles(store_id);

create index seller_breed_profiles_species_id_idx
on public.seller_breed_profiles(species_id);

create index seller_breed_profiles_breed_id_idx
on public.seller_breed_profiles(breed_id);

create index seller_breed_profiles_store_species_idx
on public.seller_breed_profiles(store_id, species_id);

create index seller_breed_profiles_store_visibility_idx
on public.seller_breed_profiles(store_id, visibility_status);

create index seller_breed_profiles_moderation_status_idx
on public.seller_breed_profiles(moderation_status);

create unique index seller_breed_profiles_store_species_breed_unique_idx
on public.seller_breed_profiles(store_id, species_id, breed_id)
where breed_id is not null;

create unique index seller_breed_profiles_store_species_custom_name_unique_idx
on public.seller_breed_profiles(store_id, species_id, normalized_custom_breed_name)
where normalized_custom_breed_name is not null;

create trigger seller_breed_profiles_set_updated_at
before update on public.seller_breed_profiles
for each row
execute function public.set_updated_at();


-- RLS

alter table public.seller_breed_profiles enable row level security;

create policy "Store owners can read own seller breed profiles"
on public.seller_breed_profiles
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can insert own seller breed profiles"
on public.seller_breed_profiles
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can update own seller breed profiles"
on public.seller_breed_profiles
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

create policy "Platform admins can delete seller breed profiles"
on public.seller_breed_profiles
for delete
to authenticated
using (
  public.is_admin()
);
