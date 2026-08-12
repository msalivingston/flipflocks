-- Platform-admin-only permanent deletion for one default Breed Library record.
--
-- Seller profiles remain independent snapshots. The default-source links are
-- detached without deleting listings, inventory, seller media, or order data.

begin;

create or replace function public.admin_delete_default_catalog_breed(
  p_breed_id uuid
)
returns table (
  deleted_breed_id uuid,
  deleted_breed_name text,
  deleted_breed_slug text,
  approved_image_url text,
  candidate_storage_path text,
  seller_profiles_detached integer,
  media_assets_detached integer,
  legacy_inventory_detached integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_breed public.breeds%rowtype;
  v_candidate_storage_path text;
  v_seller_profiles_detached integer := 0;
  v_media_assets_detached integer := 0;
  v_legacy_inventory_detached integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to delete default Breed Library records.';
  end if;

  if p_breed_id is null then
    raise exception 'Breed is required.';
  end if;

  select breeds.*
  into v_breed
  from public.breeds as breeds
  where breeds.id = p_breed_id
  for update;

  if not found then
    raise exception 'Breed not found.';
  end if;

  if v_breed.is_custom then
    raise exception 'Only default Breed Library records can be deleted here.';
  end if;

  select reviews.candidate_storage_path
  into v_candidate_storage_path
  from public.admin_breed_image_reviews as reviews
  where reviews.breed_id = v_breed.id;

  delete from public.admin_breed_image_reviews as reviews
  where reviews.breed_id = v_breed.id;

  -- Preserve every seller-owned field while converting the source identity
  -- into a collision-safe custom source required by the existing constraint.
  update public.seller_breed_profiles as seller_profiles
  set
    breed_id = null,
    custom_breed_name = concat(
      seller_profiles.display_name,
      ' (Deleted catalog ',
      left(seller_profiles.id::text, 8),
      ')'
    ),
    normalized_custom_breed_name = public.normalize_seller_custom_breed_name(
      concat(
        seller_profiles.display_name,
        ' (Deleted catalog ',
        left(seller_profiles.id::text, 8),
        ')'
      )
    ),
    updated_at = now()
  where seller_profiles.breed_id = v_breed.id;

  get diagnostics v_seller_profiles_detached = row_count;

  -- Seller media remains intact; only default-catalog provenance is removed.
  update public.media_assets as media_assets
  set
    source_breed_id = null,
    updated_at = now()
  where media_assets.source_breed_id = v_breed.id;

  get diagnostics v_media_assets_detached = row_count;

  -- Production retains this historical table only for data preservation.
  -- Snapshot the retired catalog identity before detaching its nullable FK.
  if to_regclass('public.legacy_inventory_items_before_group6') is not null then
    execute $legacy$
      update public.legacy_inventory_items_before_group6 as legacy_inventory
      set
        retired_catalog_breed_id = coalesce(
          legacy_inventory.retired_catalog_breed_id,
          $1
        ),
        retired_catalog_breed_name = coalesce(
          legacy_inventory.retired_catalog_breed_name,
          $2
        ),
        retired_catalog_breed_slug = coalesce(
          legacy_inventory.retired_catalog_breed_slug,
          $3
        ),
        breed_id = null
      where legacy_inventory.breed_id = $1
    $legacy$ using v_breed.id, v_breed.breed_name, v_breed.breed_slug;

    get diagnostics v_legacy_inventory_detached = row_count;
  end if;

  delete from public.breeds as breeds
  where breeds.id = v_breed.id;

  if not found then
    raise exception 'Breed could not be deleted.';
  end if;

  return query
  select
    v_breed.id,
    v_breed.breed_name,
    v_breed.breed_slug,
    v_breed.image_url,
    v_candidate_storage_path,
    v_seller_profiles_detached,
    v_media_assets_detached,
    v_legacy_inventory_detached;
end;
$$;

comment on function public.admin_delete_default_catalog_breed(uuid) is
'Permanently deletes one default Breed Library row after safely detaching seller snapshot provenance, seller media provenance, historical legacy inventory, and temporary image-workbench state. Does not delete seller profiles, listings, current inventory, or orders.';

revoke all on function public.admin_delete_default_catalog_breed(uuid) from public;
revoke all on function public.admin_delete_default_catalog_breed(uuid) from anon;
grant execute on function public.admin_delete_default_catalog_breed(uuid) to authenticated;

commit;
