-- Permanently remove the 28 reviewed chicken records retired by the catalog
-- curation migration. Seller-owned profiles remain intact as independent
-- custom snapshots; listings and historical records are not deleted.

begin;

create temporary table _reviewed_chicken_catalog_deletions (
  breed_slug text primary key,
  required_in_replay boolean not null
) on commit drop;

insert into _reviewed_chicken_catalog_deletions (
  breed_slug,
  required_in_replay
) values
  ('barred-rock', false),
  ('black-australorp', false),
  ('buff-orpington', false),
  ('leghorn', false),
  ('marans', false),
  ('wyandotte', false),
  ('ameraucana', true),
  ('araucana', true),
  ('bantam-frizzle', true),
  ('bantam-frizzle-salmon', true),
  ('bantam-modern-brown', true),
  ('bantam-modern-white', true),
  ('bantam-silkie', true),
  ('brahma', true),
  ('cornish-cross-broiler', true),
  ('english-orpington-buff', true),
  ('farmers-choice-all-available', true),
  ('farmers-choice-blue-egg-layers', true),
  ('farmers-choice-brown-egg-layers', true),
  ('farmers-choice-cream-egg-layers', true),
  ('farmers-choice-rare-breeds', true),
  ('farmers-choice-white-egg-layers', true),
  ('houdan', true),
  ('marans-golden', true),
  ('naked-neck-buff', true),
  ('naked-neck-mixed', true),
  ('pekin-chicken', true),
  ('prairie-bluebell-egger', true);

do $$
declare
  v_species_id uuid;
  v_existing_count integer;
  v_row_count integer;
begin
  select species.id
  into strict v_species_id
  from public.species
  where species.slug = 'chicken';

  select count(*)
  into v_row_count
  from _reviewed_chicken_catalog_deletions;

  if v_row_count <> 28 then
    raise exception 'Reviewed deletion plan must contain 28 slugs; found %.', v_row_count;
  end if;

  if exists (
    select 1
    from _reviewed_chicken_catalog_deletions as targets
    left join public.breeds as breeds
      on breeds.species_id = v_species_id
     and breeds.breed_slug = targets.breed_slug
     and breeds.is_custom = false
    where targets.required_in_replay
      and breeds.id is null
  ) then
    raise exception 'One or more required reviewed chicken records are missing.';
  end if;

  if exists (
    select 1
    from public.breeds as breeds
    join _reviewed_chicken_catalog_deletions as targets
      on targets.breed_slug = breeds.breed_slug
    where breeds.species_id = v_species_id
      and breeds.is_custom = false
      and breeds.is_active
  ) then
    raise exception 'A reviewed deletion target is still active; refusing permanent deletion.';
  end if;

  select count(*)
  into v_existing_count
  from public.breeds as breeds
  join _reviewed_chicken_catalog_deletions as targets
    on targets.breed_slug = breeds.breed_slug
  where breeds.species_id = v_species_id
    and breeds.is_custom = false;

  if v_existing_count not in (22, 28) then
    raise exception 'Expected 22 replayable or 28 production deletion targets; found %.', v_existing_count;
  end if;

  -- Seller profiles are already independent metadata snapshots. Convert any
  -- remaining catalog links into unique custom sources while preserving the
  -- seller-facing display name, description, notes, visibility, and history.
  update public.seller_breed_profiles as seller_profiles
  set
    breed_id = null,
    custom_breed_name = concat(
      seller_profiles.display_name,
      ' (Retired catalog ',
      left(seller_profiles.id::text, 8),
      ')'
    ),
    normalized_custom_breed_name = public.normalize_seller_custom_breed_name(
      concat(
        seller_profiles.display_name,
        ' (Retired catalog ',
        left(seller_profiles.id::text, 8),
        ')'
      )
    ),
    updated_at = now()
  from public.breeds as breeds
  join _reviewed_chicken_catalog_deletions as targets
    on targets.breed_slug = breeds.breed_slug
  where seller_profiles.breed_id = breeds.id
    and breeds.species_id = v_species_id
    and breeds.is_custom = false;

  -- A copied catalog image remains a valid seller media asset. Only remove the
  -- foreign-key provenance; retain its source URL and all media/link records.
  update public.media_assets as media_assets
  set
    source_breed_id = null,
    updated_at = now()
  from public.breeds as breeds
  join _reviewed_chicken_catalog_deletions as targets
    on targets.breed_slug = breeds.breed_slug
  where media_assets.source_breed_id = breeds.id
    and breeds.species_id = v_species_id
    and breeds.is_custom = false;

  -- Production retains a pre-Group-6 inventory table solely for historical
  -- data preservation. It does not exist in clean replays and is not used by
  -- current code. Preserve the retired catalog identity on that archived row,
  -- then detach its required live foreign key.
  if to_regclass('public.legacy_inventory_items_before_group6') is not null then
    execute $legacy$
      alter table public.legacy_inventory_items_before_group6
      add column if not exists retired_catalog_breed_id uuid
    $legacy$;

    execute $legacy$
      alter table public.legacy_inventory_items_before_group6
      add column if not exists retired_catalog_breed_name text
    $legacy$;

    execute $legacy$
      alter table public.legacy_inventory_items_before_group6
      add column if not exists retired_catalog_breed_slug text
    $legacy$;

    execute $legacy$
      alter table public.legacy_inventory_items_before_group6
      alter column breed_id drop not null
    $legacy$;

    execute $legacy$
      update public.legacy_inventory_items_before_group6 as legacy_inventory
      set
        retired_catalog_breed_id = coalesce(
          legacy_inventory.retired_catalog_breed_id,
          breeds.id
        ),
        retired_catalog_breed_name = coalesce(
          legacy_inventory.retired_catalog_breed_name,
          breeds.breed_name
        ),
        retired_catalog_breed_slug = coalesce(
          legacy_inventory.retired_catalog_breed_slug,
          breeds.breed_slug
        ),
        breed_id = null
      from public.breeds as breeds
      join _reviewed_chicken_catalog_deletions as targets
        on targets.breed_slug = breeds.breed_slug
      where legacy_inventory.breed_id = breeds.id
        and breeds.species_id = $1
        and breeds.is_custom = false
    $legacy$ using v_species_id;

    execute $legacy$
      alter table public.legacy_inventory_items_before_group6
      drop constraint if exists inventory_items_breed_id_fkey
    $legacy$;

    execute $legacy$
      alter table public.legacy_inventory_items_before_group6
      add constraint inventory_items_breed_id_fkey
      foreign key (breed_id)
      references public.breeds(id)
      on delete set null
    $legacy$;

    execute $legacy$
      comment on column public.legacy_inventory_items_before_group6.retired_catalog_breed_id is
      'Original platform catalog breed ID retained when an obsolete catalog record is permanently removed.'
    $legacy$;

    execute $legacy$
      comment on column public.legacy_inventory_items_before_group6.retired_catalog_breed_name is
      'Original platform catalog breed name retained when an obsolete catalog record is permanently removed.'
    $legacy$;

    execute $legacy$
      comment on column public.legacy_inventory_items_before_group6.retired_catalog_breed_slug is
      'Original platform catalog breed slug retained when an obsolete catalog record is permanently removed.'
    $legacy$;
  end if;

  delete from public.breeds as breeds
  using _reviewed_chicken_catalog_deletions as targets
  where breeds.species_id = v_species_id
    and breeds.breed_slug = targets.breed_slug
    and breeds.is_custom = false;

  get diagnostics v_row_count = row_count;
  if v_row_count <> v_existing_count then
    raise exception 'Expected to delete % reviewed chicken records; deleted %.', v_existing_count, v_row_count;
  end if;

  if exists (
    select 1
    from public.breeds as breeds
    join _reviewed_chicken_catalog_deletions as targets
      on targets.breed_slug = breeds.breed_slug
    where breeds.species_id = v_species_id
      and breeds.is_custom = false
  ) then
    raise exception 'One or more reviewed chicken catalog records remain after deletion.';
  end if;

  select count(*)
  into v_row_count
  from public.breeds as breeds
  where breeds.species_id = v_species_id
    and breeds.is_custom = false;

  if v_row_count <> 217 then
    raise exception 'Default chicken catalog should contain 217 records after deletion; found %.', v_row_count;
  end if;
end;
$$;

commit;
