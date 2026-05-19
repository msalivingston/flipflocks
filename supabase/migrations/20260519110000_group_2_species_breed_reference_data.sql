-- Group 2: Species and Breed Reference Data
-- Tables:
-- - species
-- - breeds
-- - breed_aliases
--
-- Direction:
-- - species remains the physical species reference table.
-- - breeds remains the physical table for now.
-- - breeds is transitional and represents platform-managed global breed templates for now.
-- - Seller-created custom breeds must not be inserted into breeds automatically.
-- - Seller-created custom breeds belong in seller_breed_profiles in Group 3.
--
-- Requires Group 1:
-- - public.set_updated_at()
-- - public.is_admin()
-- - public.user_roles with platform admin defined as role = 'admin' and store_id is null

-- ---------------------------------------------------------------------------
-- species: additive columns first
-- ---------------------------------------------------------------------------

alter table public.species
add column if not exists slug text;

alter table public.species
add column if not exists sort_order integer;

alter table public.species
add column if not exists updated_at timestamptz;

-- Backfill slugs from common_name.
update public.species
set slug = regexp_replace(
  regexp_replace(
    lower(trim(common_name)),
    '[^a-z0-9]+',
    '-',
    'g'
  ),
  '(^-|-$)',
  '',
  'g'
)
where slug is null;

-- Poultry-first deterministic sort order for existing known species.
update public.species
set sort_order = case lower(common_name)
  when 'chicken' then 10
  when 'duck' then 20
  when 'goose' then 30
  when 'turkey' then 40
  when 'quail' then 50
  when 'guinea fowl' then 60
  when 'pheasant' then 70
  when 'peafowl' then 80
  when 'rabbit' then 100
  else 1000
end
where sort_order is null;

update public.species
set updated_at = coalesce(created_at, now())
where updated_at is null;

-- Apply species constraints after backfill.
alter table public.species
alter column slug set not null;

alter table public.species
alter column sort_order set not null;

alter table public.species
alter column sort_order set default 0;

alter table public.species
alter column updated_at set not null;

alter table public.species
alter column updated_at set default now();

alter table public.species
alter column is_active set default true;

alter table public.species
add constraint species_slug_unique unique (slug);

alter table public.species
add constraint species_slug_format_check check (
  slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
);

alter table public.species
add constraint species_common_name_not_empty_check check (
  length(trim(common_name)) > 0
);

alter table public.species
add constraint species_sort_order_nonnegative_check check (
  sort_order >= 0
);

create index if not exists species_is_active_idx
on public.species(is_active);

create index if not exists species_sort_order_idx
on public.species(sort_order);

drop trigger if exists species_set_updated_at on public.species;

create trigger species_set_updated_at
before update on public.species
for each row
execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- breeds: transitional platform-managed global breed templates
-- ---------------------------------------------------------------------------

comment on table public.breeds is
'Transitional physical table for platform-managed global breed templates. Seller-created custom breeds belong in seller_breed_profiles and must not be automatically inserted here.';

alter table public.breeds
add column if not exists egg_color text;

alter table public.breeds
add column if not exists temperament text;

alter table public.breeds
add column if not exists production_traits text;

alter table public.breeds
add column if not exists is_custom boolean;

alter table public.breeds
add column if not exists sort_order integer;

alter table public.breeds
add column if not exists updated_at timestamptz;

update public.breeds
set is_custom = false
where is_custom is null;

update public.breeds
set sort_order = 0
where sort_order is null;

update public.breeds
set updated_at = coalesce(created_at, now())
where updated_at is null;

-- Apply breeds constraints after backfill.
alter table public.breeds
alter column is_custom set not null;

alter table public.breeds
alter column is_custom set default false;

alter table public.breeds
alter column sort_order set not null;

alter table public.breeds
alter column sort_order set default 0;

alter table public.breeds
alter column updated_at set not null;

alter table public.breeds
alter column updated_at set default now();

alter table public.breeds
alter column is_active set default true;

alter table public.breeds
add constraint breeds_breed_slug_format_check check (
  breed_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
);

alter table public.breeds
add constraint breeds_breed_name_not_empty_check check (
  length(trim(breed_name)) > 0
);

alter table public.breeds
add constraint breeds_sort_order_nonnegative_check check (
  sort_order >= 0
);

alter table public.breeds
add constraint breeds_species_breed_slug_unique unique (species_id, breed_slug);

create index if not exists breeds_species_id_idx
on public.breeds(species_id);

create index if not exists breeds_species_active_idx
on public.breeds(species_id, is_active);

create index if not exists breeds_species_sort_order_idx
on public.breeds(species_id, sort_order);

drop trigger if exists breeds_set_updated_at on public.breeds;

create trigger breeds_set_updated_at
before update on public.breeds
for each row
execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- breed_aliases
-- ---------------------------------------------------------------------------

create table if not exists public.breed_aliases (
  id uuid primary key default gen_random_uuid(),

  breed_id uuid not null references public.breeds(id) on delete cascade,

  alias text not null,
  normalized_alias text not null,

  created_at timestamptz not null default now(),

  constraint breed_aliases_alias_not_empty_check check (
    length(trim(alias)) > 0
  ),

  constraint breed_aliases_normalized_alias_not_empty_check check (
    length(trim(normalized_alias)) > 0
  ),

  constraint breed_aliases_normalized_alias_unique unique (normalized_alias)
);

comment on table public.breed_aliases is
'Platform-managed aliases for breeds. Used for search and breed selection. Seller-created custom breed names should not be automatically promoted into aliases.';

create index if not exists breed_aliases_breed_id_idx
on public.breed_aliases(breed_id);


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.species enable row level security;
alter table public.breeds enable row level security;
alter table public.breed_aliases enable row level security;

-- Remove older policies with these names if rerunning in development.
drop policy if exists "Public can read active species" on public.species;
drop policy if exists "Platform admins can read all species" on public.species;
drop policy if exists "Platform admins can insert species" on public.species;
drop policy if exists "Platform admins can update species" on public.species;
drop policy if exists "Platform admins can delete species" on public.species;

drop policy if exists "Public can read active breeds" on public.breeds;
drop policy if exists "Platform admins can read all breeds" on public.breeds;
drop policy if exists "Platform admins can insert breeds" on public.breeds;
drop policy if exists "Platform admins can update breeds" on public.breeds;
drop policy if exists "Platform admins can delete breeds" on public.breeds;

drop policy if exists "Public can read aliases for active breeds" on public.breed_aliases;
drop policy if exists "Platform admins can read all breed aliases" on public.breed_aliases;
drop policy if exists "Platform admins can insert breed aliases" on public.breed_aliases;
drop policy if exists "Platform admins can update breed aliases" on public.breed_aliases;
drop policy if exists "Platform admins can delete breed aliases" on public.breed_aliases;


-- species policies

create policy "Public can read active species"
on public.species
for select
to anon, authenticated
using (
  is_active = true
);

create policy "Platform admins can read all species"
on public.species
for select
to authenticated
using (
  public.is_admin()
);

create policy "Platform admins can insert species"
on public.species
for insert
to authenticated
with check (
  public.is_admin()
);

create policy "Platform admins can update species"
on public.species
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

create policy "Platform admins can delete species"
on public.species
for delete
to authenticated
using (
  public.is_admin()
);


-- breeds policies

create policy "Public can read active breeds"
on public.breeds
for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.species
    where species.id = breeds.species_id
      and species.is_active = true
  )
);

create policy "Platform admins can read all breeds"
on public.breeds
for select
to authenticated
using (
  public.is_admin()
);

create policy "Platform admins can insert breeds"
on public.breeds
for insert
to authenticated
with check (
  public.is_admin()
);

create policy "Platform admins can update breeds"
on public.breeds
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

create policy "Platform admins can delete breeds"
on public.breeds
for delete
to authenticated
using (
  public.is_admin()
);


-- breed_aliases policies

create policy "Public can read aliases for active breeds"
on public.breed_aliases
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.breeds
    join public.species on species.id = breeds.species_id
    where breeds.id = breed_aliases.breed_id
      and breeds.is_active = true
      and species.is_active = true
  )
);

create policy "Platform admins can read all breed aliases"
on public.breed_aliases
for select
to authenticated
using (
  public.is_admin()
);

create policy "Platform admins can insert breed aliases"
on public.breed_aliases
for insert
to authenticated
with check (
  public.is_admin()
);

create policy "Platform admins can update breed aliases"
on public.breed_aliases
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

create policy "Platform admins can delete breed aliases"
on public.breed_aliases
for delete
to authenticated
using (
  public.is_admin()
);
