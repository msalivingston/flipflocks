-- Add standalone Hatching Eggs as a first-class order item source.
--
-- This migration only adds the order_items source reference and source
-- integrity constraints. Checkout/order RPCs are intentionally unchanged.

begin;

alter table public.order_items
  add column if not exists hatching_egg_inventory_item_id uuid
    references public.hatching_egg_inventory_items(id);

create index if not exists order_items_hatching_egg_inventory_item_id_idx
on public.order_items(hatching_egg_inventory_item_id);

comment on column public.order_items.hatching_egg_inventory_item_id is
'Standalone Hatching Eggs inventory item referenced by order lines whose source is hatching_egg_inventory.';

alter table public.order_items
  drop constraint if exists order_items_order_item_source_check,
  drop constraint if exists order_items_listing_source_requires_inventory_check,
  drop constraint if exists order_items_equipment_source_requires_equipment_check,
  drop constraint if exists order_items_processed_poultry_source_requires_processed_check,
  drop constraint if exists order_items_hatching_egg_source_requires_hatching_check,
  drop constraint if exists order_items_custom_source_requires_custom_name_check;

alter table public.order_items
  add constraint order_items_order_item_source_check check (
    order_item_source in (
      'listing_inventory',
      'equipment_inventory',
      'processed_poultry_inventory',
      'hatching_egg_inventory',
      'custom'
    )
  ),
  add constraint order_items_listing_source_requires_inventory_check check (
    order_item_source <> 'listing_inventory'
    or (
      inventory_item_id is not null
      and equipment_inventory_item_id is null
      and processed_poultry_inventory_item_id is null
      and hatching_egg_inventory_item_id is null
      and listing_batch_id is not null
      and listing_batch_breed_id is not null
      and seller_breed_profile_id is not null
      and species_id is not null
      and available_date_snapshot is not null
    )
  ),
  add constraint order_items_equipment_source_requires_equipment_check check (
    order_item_source <> 'equipment_inventory'
    or (
      equipment_inventory_item_id is not null
      and inventory_item_id is null
      and processed_poultry_inventory_item_id is null
      and hatching_egg_inventory_item_id is null
      and listing_batch_id is null
      and listing_batch_breed_id is null
      and seller_breed_profile_id is null
      and species_id is null
      and available_date_snapshot is null
      and product_type_snapshot = 'equipment_supplies'
      and item_name_snapshot is not null
      and item_category_snapshot is not null
    )
  ),
  add constraint order_items_processed_poultry_source_requires_processed_check check (
    order_item_source <> 'processed_poultry_inventory'
    or (
      processed_poultry_inventory_item_id is not null
      and inventory_item_id is null
      and equipment_inventory_item_id is null
      and hatching_egg_inventory_item_id is null
      and listing_batch_id is null
      and listing_batch_breed_id is null
      and seller_breed_profile_id is null
      and species_id is null
      and available_date_snapshot is null
      and product_type_snapshot = 'processed_poultry'
      and item_name_snapshot is not null
      and item_category_snapshot is not null
    )
  ),
  add constraint order_items_hatching_egg_source_requires_hatching_check check (
    order_item_source <> 'hatching_egg_inventory'
    or (
      hatching_egg_inventory_item_id is not null
      and inventory_item_id is null
      and equipment_inventory_item_id is null
      and processed_poultry_inventory_item_id is null
    )
  ),
  add constraint order_items_custom_source_requires_custom_name_check check (
    order_item_source <> 'custom'
    or (
      inventory_item_id is null
      and equipment_inventory_item_id is null
      and processed_poultry_inventory_item_id is null
      and hatching_egg_inventory_item_id is null
      and listing_batch_id is null
      and listing_batch_breed_id is null
      and seller_breed_profile_id is null
      and species_id is null
      and custom_item_name_snapshot is not null
    )
  );

commit;
