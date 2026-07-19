-- Allow checkout summary validation for standalone Hatching Eggs cart items.

create or replace function public.get_public_checkout_summary(
  p_store_slug text,
  p_items jsonb
)
returns table (
  store_id uuid,
  store_slug text,
  is_checkout_available boolean,
  message text,
  item_count integer,
  total_quantity integer,
  subtotal_amount numeric(10, 2),
  items jsonb
)
language sql
stable
set search_path = public
as $$
  with normalized_input as (
    select
      lower(trim(p_store_slug)) as normalized_store_slug,
      case when p_items is not null and jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end as normalized_items,
      (p_items is not null and jsonb_typeof(p_items) = 'array') as items_are_array
  ),
  storefront as (
    select public_storefront_home.store_id, public_storefront_home.store_slug
    from public.public_storefront_home
    join normalized_input
      on normalized_input.normalized_store_slug = public_storefront_home.store_slug
  ),
  raw_items as (
    select raw_item.value as item
    from normalized_input
    cross join lateral jsonb_array_elements(normalized_input.normalized_items) as raw_item(value)
  ),
  normalized_items as (
    select
      case when raw_items.item ? 'inventory_item_id' then 'listing_inventory' else raw_items.item ->> 'item_type' end as item_type,
      case when raw_items.item ? 'inventory_item_id' then raw_items.item ->> 'inventory_item_id' else raw_items.item ->> 'item_id' end as item_id_text,
      raw_items.item ->> 'quantity' as quantity_text,
      raw_items.item
    from raw_items
  ),
  item_validation as (
    select
      count(*) as raw_item_count,
      count(*) filter (
        where jsonb_typeof(normalized_items.item) <> 'object'
           or normalized_items.item_type not in ('listing_inventory', 'equipment_inventory', 'processed_poultry_inventory', 'hatching_egg_inventory')
           or normalized_items.item_id_text is null
           or normalized_items.item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           or normalized_items.quantity_text !~ '^[0-9]+$'
           or (normalized_items.quantity_text)::integer <= 0
      ) as invalid_item_count
    from normalized_items
  ),
  requested_items as (
    select
      normalized_items.item_type,
      normalized_items.item_id_text::uuid as item_id,
      sum(normalized_items.quantity_text::integer)::integer as requested_quantity
    from normalized_items
    where normalized_items.item_type in ('listing_inventory', 'equipment_inventory', 'processed_poultry_inventory', 'hatching_egg_inventory')
      and normalized_items.item_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and normalized_items.quantity_text ~ '^[0-9]+$'
      and (normalized_items.quantity_text)::integer > 0
    group by normalized_items.item_type, normalized_items.item_id_text::uuid
  ),
  requested_summary as (
    select
      count(*)::integer as item_count,
      coalesce(sum(requested_items.requested_quantity), 0)::integer as total_quantity
    from requested_items
  ),
  matched_listing_items as (
    select
      requested_items.item_type,
      requested_items.item_id as requested_item_id,
      requested_items.requested_quantity,
      public_storefront_inventory.store_id,
      public_storefront_inventory.store_slug,
      public_storefront_inventory.inventory_item_id as item_id,
      public_storefront_inventory.breed_display_name as item_name,
      public_storefront_inventory.species_name as item_category,
      public_storefront_inventory.inventory_type,
      public_storefront_inventory.custom_inventory_label,
      public_storefront_inventory.quantity_available,
      public_storefront_inventory.buyer_availability_code,
      public_storefront_inventory.buyer_availability_label,
      public_storefront_inventory.available_date,
      public_storefront_inventory.can_checkout,
      public_storefront_inventory.unit_price,
      (public_storefront_inventory.unit_price * requested_items.requested_quantity)::numeric(10, 2) as line_subtotal,
      null::uuid as hatching_egg_inventory_item_id,
      null::text as description,
      null::text as image_url,
      null::integer as minimum_order_quantity,
      null::uuid as species_id,
      null::text as species_slug
    from requested_items
    left join public.public_storefront_inventory
      on requested_items.item_type = 'listing_inventory'
     and public_storefront_inventory.inventory_item_id = requested_items.item_id
     and public_storefront_inventory.store_slug = (select storefront.store_slug from storefront limit 1)
    where requested_items.item_type = 'listing_inventory'
  ),
  matched_equipment_items as (
    select
      requested_items.item_type,
      requested_items.item_id as requested_item_id,
      requested_items.requested_quantity,
      public_storefront_equipment_inventory.store_id,
      public_storefront_equipment_inventory.store_slug,
      public_storefront_equipment_inventory.equipment_inventory_item_id as item_id,
      public_storefront_equipment_inventory.item_name,
      public_storefront_equipment_inventory.category as item_category,
      'equipment_supplies'::text as inventory_type,
      public_storefront_equipment_inventory.condition as custom_inventory_label,
      public_storefront_equipment_inventory.quantity_available,
      public_storefront_equipment_inventory.buyer_availability_code,
      public_storefront_equipment_inventory.buyer_availability_label,
      public_storefront_equipment_inventory.available_date,
      public_storefront_equipment_inventory.can_checkout,
      public_storefront_equipment_inventory.unit_price,
      (public_storefront_equipment_inventory.unit_price * requested_items.requested_quantity)::numeric(10, 2) as line_subtotal,
      null::uuid as hatching_egg_inventory_item_id,
      null::text as description,
      null::text as image_url,
      null::integer as minimum_order_quantity,
      null::uuid as species_id,
      null::text as species_slug
    from requested_items
    left join public.public_storefront_equipment_inventory
      on requested_items.item_type = 'equipment_inventory'
     and public_storefront_equipment_inventory.equipment_inventory_item_id = requested_items.item_id
     and public_storefront_equipment_inventory.store_slug = (select storefront.store_slug from storefront limit 1)
    where requested_items.item_type = 'equipment_inventory'
  ),
  matched_processed_items as (
    select
      requested_items.item_type,
      requested_items.item_id as requested_item_id,
      requested_items.requested_quantity,
      public_storefront_processed_poultry_inventory.store_id,
      public_storefront_processed_poultry_inventory.store_slug,
      public_storefront_processed_poultry_inventory.processed_poultry_inventory_item_id as item_id,
      public_storefront_processed_poultry_inventory.product_name as item_name,
      public_storefront_processed_poultry_inventory.species_name as item_category,
      'processed_poultry'::text as inventory_type,
      concat_ws(' - ', public_storefront_processed_poultry_inventory.product_type, public_storefront_processed_poultry_inventory.package_size) as custom_inventory_label,
      public_storefront_processed_poultry_inventory.quantity_available,
      public_storefront_processed_poultry_inventory.buyer_availability_code,
      public_storefront_processed_poultry_inventory.buyer_availability_label,
      public_storefront_processed_poultry_inventory.available_date,
      public_storefront_processed_poultry_inventory.can_checkout,
      public_storefront_processed_poultry_inventory.unit_price,
      (public_storefront_processed_poultry_inventory.unit_price * requested_items.requested_quantity)::numeric(10, 2) as line_subtotal,
      null::uuid as hatching_egg_inventory_item_id,
      null::text as description,
      null::text as image_url,
      null::integer as minimum_order_quantity,
      null::uuid as species_id,
      null::text as species_slug
    from requested_items
    left join public.public_storefront_processed_poultry_inventory
      on requested_items.item_type = 'processed_poultry_inventory'
     and public_storefront_processed_poultry_inventory.processed_poultry_inventory_item_id = requested_items.item_id
     and public_storefront_processed_poultry_inventory.store_slug = (select storefront.store_slug from storefront limit 1)
    where requested_items.item_type = 'processed_poultry_inventory'
  ),
  matched_hatching_egg_items as (
    select
      requested_items.item_type,
      requested_items.item_id as requested_item_id,
      requested_items.requested_quantity,
      public_storefront_hatching_egg_inventory.store_id,
      public_storefront_hatching_egg_inventory.store_slug,
      public_storefront_hatching_egg_inventory.hatching_egg_inventory_item_id as item_id,
      public_storefront_hatching_egg_inventory.item_name,
      public_storefront_hatching_egg_inventory.species_name as item_category,
      'hatching_eggs'::text as inventory_type,
      null::text as custom_inventory_label,
      public_storefront_hatching_egg_inventory.quantity_available,
      public_storefront_hatching_egg_inventory.buyer_availability_code,
      public_storefront_hatching_egg_inventory.buyer_availability_label,
      public_storefront_hatching_egg_inventory.available_date,
      (
        public_storefront_hatching_egg_inventory.hatching_egg_inventory_item_id is not null
        and requested_items.requested_quantity > 0
        and requested_items.requested_quantity <= public_storefront_hatching_egg_inventory.quantity_available
        and requested_items.requested_quantity >= coalesce(public_storefront_hatching_egg_inventory.minimum_order_quantity, 1)
      ) as can_checkout,
      public_storefront_hatching_egg_inventory.unit_price,
      (public_storefront_hatching_egg_inventory.unit_price * requested_items.requested_quantity)::numeric(10, 2) as line_subtotal,
      public_storefront_hatching_egg_inventory.hatching_egg_inventory_item_id,
      public_storefront_hatching_egg_inventory.description,
      public_storefront_hatching_egg_inventory.featured_image_url as image_url,
      public_storefront_hatching_egg_inventory.minimum_order_quantity,
      public_storefront_hatching_egg_inventory.species_id,
      public_storefront_hatching_egg_inventory.species_slug
    from requested_items
    left join public.public_storefront_hatching_egg_inventory
      on requested_items.item_type = 'hatching_egg_inventory'
     and public_storefront_hatching_egg_inventory.hatching_egg_inventory_item_id = requested_items.item_id
     and public_storefront_hatching_egg_inventory.store_slug = (select storefront.store_slug from storefront limit 1)
    where requested_items.item_type = 'hatching_egg_inventory'
  ),
  matched_items as (
    select * from matched_listing_items
    union all
    select * from matched_equipment_items
    union all
    select * from matched_processed_items
    union all
    select * from matched_hatching_egg_items
  ),
  matched_summary as (
    select
      count(*) filter (where matched_items.item_id is null)::integer as missing_item_count,
      count(*) filter (
        where matched_items.item_id is not null
          and (matched_items.can_checkout = false or matched_items.quantity_available < matched_items.requested_quantity)
      )::integer as unavailable_item_count,
      coalesce(sum(matched_items.line_subtotal) filter (where matched_items.item_id is not null), 0)::numeric(10, 2) as subtotal_amount,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'store_id', matched_items.store_id,
            'store_slug', matched_items.store_slug,
            'item_type', matched_items.item_type,
            'item_id', matched_items.item_id,
            'inventory_item_id', case when matched_items.item_type = 'listing_inventory' then matched_items.item_id else null end,
            'equipment_inventory_item_id', case when matched_items.item_type = 'equipment_inventory' then matched_items.item_id else null end,
            'processed_poultry_inventory_item_id', case when matched_items.item_type = 'processed_poultry_inventory' then matched_items.item_id else null end,
            'hatching_egg_inventory_item_id', case when matched_items.item_type = 'hatching_egg_inventory' then matched_items.hatching_egg_inventory_item_id else null end,
            'item_name', matched_items.item_name,
            'item_category', matched_items.item_category,
            'inventory_type', matched_items.inventory_type,
            'custom_inventory_label', matched_items.custom_inventory_label,
            'requested_quantity', matched_items.requested_quantity,
            'quantity_available', matched_items.quantity_available,
            'buyer_availability_code', matched_items.buyer_availability_code,
            'buyer_availability_label', matched_items.buyer_availability_label,
            'available_date', matched_items.available_date,
            'unit_price', matched_items.unit_price,
            'line_subtotal', matched_items.line_subtotal,
            'description', case when matched_items.item_type = 'hatching_egg_inventory' then matched_items.description else null end,
            'image_url', case when matched_items.item_type = 'hatching_egg_inventory' then matched_items.image_url else null end,
            'minimum_order_quantity', case when matched_items.item_type = 'hatching_egg_inventory' then matched_items.minimum_order_quantity else null end,
            'species_id', case when matched_items.item_type = 'hatching_egg_inventory' then matched_items.species_id else null end,
            'species_slug', case when matched_items.item_type = 'hatching_egg_inventory' then matched_items.species_slug else null end
          )
          order by matched_items.item_type, matched_items.item_name, matched_items.item_id
        ) filter (where matched_items.item_id is not null),
        '[]'::jsonb
      ) as items
    from matched_items
  )
  select
    storefront.store_id,
    normalized_input.normalized_store_slug as store_slug,
    (
      storefront.store_id is not null
      and normalized_input.items_are_array = true
      and item_validation.raw_item_count > 0
      and item_validation.invalid_item_count = 0
      and requested_summary.item_count > 0
      and matched_summary.missing_item_count = 0
      and matched_summary.unavailable_item_count = 0
    ) as is_checkout_available,
    case
      when storefront.store_id is null then 'This store is currently unavailable.'
      when normalized_input.items_are_array = false then 'Checkout items are invalid.'
      when item_validation.raw_item_count = 0 or requested_summary.item_count = 0 then 'At least one checkout item is required.'
      when item_validation.invalid_item_count > 0 then 'Checkout items are invalid.'
      when matched_summary.missing_item_count > 0 then 'One or more items are no longer available.'
      when matched_summary.unavailable_item_count > 0 then 'Insufficient inventory quantity available.'
      else null::text
    end as message,
    requested_summary.item_count,
    requested_summary.total_quantity,
    matched_summary.subtotal_amount,
    matched_summary.items
  from normalized_input
  left join storefront on true
  cross join requested_summary
  cross join item_validation
  cross join matched_summary;
$$;
