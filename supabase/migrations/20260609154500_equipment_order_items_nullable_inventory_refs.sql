begin;

alter table public.order_items
  alter column inventory_item_id drop not null,
  alter column listing_batch_id drop not null,
  alter column listing_batch_breed_id drop not null,
  alter column seller_breed_profile_id drop not null,
  alter column species_id drop not null,
  alter column available_date_snapshot drop not null;

alter table public.order_items
  drop constraint if exists order_items_order_item_source_check,
  drop constraint if exists order_items_inventory_source_requires_inventory_check,
  drop constraint if exists order_items_custom_source_requires_custom_name_check,
  drop constraint if exists order_items_listing_source_requires_inventory_check,
  drop constraint if exists order_items_equipment_source_requires_equipment_check;

update public.order_items
set order_item_source = 'listing_inventory'
where order_item_source = 'inventory';

alter table public.order_items
  add constraint order_items_order_item_source_check check (
    order_item_source in ('listing_inventory', 'equipment_inventory', 'custom')
  ),
  add constraint order_items_listing_source_requires_inventory_check check (
    order_item_source <> 'listing_inventory'
    or (
      inventory_item_id is not null
      and equipment_inventory_item_id is null
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
  add constraint order_items_custom_source_requires_custom_name_check check (
    order_item_source <> 'custom'
    or (
      inventory_item_id is null
      and equipment_inventory_item_id is null
      and listing_batch_id is null
      and listing_batch_breed_id is null
      and seller_breed_profile_id is null
      and species_id is null
      and custom_item_name_snapshot is not null
    )
  );

commit;
