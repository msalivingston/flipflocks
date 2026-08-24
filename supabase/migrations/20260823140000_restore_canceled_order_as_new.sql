begin;

create function public.seller_get_order_restore_draft(p_source_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_order public.orders%rowtype;
  v_reasons jsonb := '[]'::jsonb;
  v_inventory_reasons jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_customer jsonb;
  v_pickup_option_id uuid;
begin
  select source_order.*
  into v_source_order
  from public.orders as source_order
  where source_order.id = p_source_order_id;

  if v_source_order.id is null
     or not (public.owns_store(v_source_order.store_id) or public.is_admin()) then
    raise exception 'Order is not available.';
  end if;

  if v_source_order.order_status <> 'canceled'
     or v_source_order.canceled_at is null then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'code', 'not_canceled',
      'message', 'Only canceled orders can be restored.'
    ));
  end if;

  if not exists (
    select 1
    from public.order_items as order_item
    where order_item.order_id = v_source_order.id
      and order_item.store_id = v_source_order.store_id
  ) then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'code', 'no_items',
      'message', 'This order has no items to restore.'
    ));
  end if;

  if exists (
    select 1
    from public.order_items as order_item
    where order_item.order_id = v_source_order.id
      and order_item.store_id = v_source_order.store_id
      and (
        coalesce(order_item.order_item_source, 'listing_inventory') not in (
          'inventory',
          'listing_inventory',
          'equipment_inventory',
          'processed_poultry_inventory',
          'hatching_egg_inventory',
          'custom'
        )
        or (
          order_item.order_item_source = 'custom'
          and nullif(trim(order_item.custom_item_name_snapshot), '') is null
        )
      )
  ) then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_item',
      'message', 'One or more original order items cannot be prefilled.'
    ));
  end if;

  with required_sources as (
    select
      'listing_inventory'::text as item_type,
      order_item.inventory_item_id as source_id,
      sum(order_item.quantity)::integer as required_quantity,
      min(coalesce(
        nullif(order_item.breed_display_name_snapshot, ''),
        nullif(order_item.item_name_snapshot, ''),
        'Live Bird'
      )) as item_name
    from public.order_items as order_item
    where order_item.order_id = v_source_order.id
      and order_item.store_id = v_source_order.store_id
      and coalesce(order_item.order_item_source, 'listing_inventory') in (
        'inventory',
        'listing_inventory'
      )
    group by order_item.inventory_item_id

    union all

    select
      'equipment_inventory',
      order_item.equipment_inventory_item_id,
      sum(order_item.quantity)::integer,
      min(coalesce(
        nullif(order_item.item_name_snapshot, ''),
        nullif(order_item.breed_display_name_snapshot, ''),
        'Equipment'
      ))
    from public.order_items as order_item
    where order_item.order_id = v_source_order.id
      and order_item.store_id = v_source_order.store_id
      and order_item.order_item_source = 'equipment_inventory'
    group by order_item.equipment_inventory_item_id

    union all

    select
      'processed_poultry_inventory',
      order_item.processed_poultry_inventory_item_id,
      sum(order_item.quantity)::integer,
      min(coalesce(
        nullif(order_item.item_name_snapshot, ''),
        nullif(order_item.breed_display_name_snapshot, ''),
        'Poultry Product'
      ))
    from public.order_items as order_item
    where order_item.order_id = v_source_order.id
      and order_item.store_id = v_source_order.store_id
      and order_item.order_item_source = 'processed_poultry_inventory'
    group by order_item.processed_poultry_inventory_item_id

    union all

    select
      'hatching_egg_inventory',
      order_item.hatching_egg_inventory_item_id,
      sum(order_item.quantity)::integer,
      min(coalesce(
        nullif(order_item.item_name_snapshot, ''),
        nullif(order_item.breed_display_name_snapshot, ''),
        'Hatching Eggs'
      ))
    from public.order_items as order_item
    where order_item.order_id = v_source_order.id
      and order_item.store_id = v_source_order.store_id
      and order_item.order_item_source = 'hatching_egg_inventory'
    group by order_item.hatching_egg_inventory_item_id
  ), source_status as (
    select
      required.item_type,
      required.source_id,
      required.required_quantity,
      required.item_name,
      inventory.quantity_available,
      inventory.id is not null
        and inventory.store_id = v_source_order.store_id as source_valid
    from required_sources as required
    left join public.inventory_items as inventory
      on required.item_type = 'listing_inventory'
     and inventory.id = required.source_id
    where required.item_type = 'listing_inventory'

    union all

    select
      required.item_type,
      required.source_id,
      required.required_quantity,
      required.item_name,
      equipment.quantity_available,
      equipment.id is not null
        and equipment.store_id = v_source_order.store_id
    from required_sources as required
    left join public.equipment_inventory_items as equipment
      on required.item_type = 'equipment_inventory'
     and equipment.id = required.source_id
    where required.item_type = 'equipment_inventory'

    union all

    select
      required.item_type,
      required.source_id,
      required.required_quantity,
      required.item_name,
      product.quantity_available,
      product.id is not null
        and product.store_id = v_source_order.store_id
    from required_sources as required
    left join public.processed_poultry_inventory_items as product
      on required.item_type = 'processed_poultry_inventory'
     and product.id = required.source_id
    where required.item_type = 'processed_poultry_inventory'

    union all

    select
      required.item_type,
      required.source_id,
      required.required_quantity,
      required.item_name,
      eggs.quantity_available,
      eggs.id is not null
        and eggs.store_id = v_source_order.store_id
    from required_sources as required
    left join public.hatching_egg_inventory_items as eggs
      on required.item_type = 'hatching_egg_inventory'
     and eggs.id = required.source_id
    where required.item_type = 'hatching_egg_inventory'
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', case
          when not status.source_valid then 'source_unavailable'
          else 'insufficient_inventory'
        end,
        'item_type', status.item_type,
        'source_id', status.source_id,
        'item_name', status.item_name,
        'required_quantity', status.required_quantity,
        'available_quantity', coalesce(status.quantity_available, 0),
        'message', case
          when not status.source_valid then
            status.item_name || ' is no longer available from its original inventory source.'
          else
            status.item_name || ' requires ' || status.required_quantity::text
              || ', but only ' || coalesce(status.quantity_available, 0)::text
              || ' are currently available.'
        end
      )
      order by status.item_type, status.source_id
    ),
    '[]'::jsonb
  )
  into v_inventory_reasons
  from source_status as status
  where not status.source_valid
     or coalesce(status.quantity_available, 0) < status.required_quantity;

  v_reasons := v_reasons || v_inventory_reasons;

  select jsonb_build_object(
    'customer_id', customer.id,
    'email', customer.email,
    'first_name', customer.first_name,
    'last_name', customer.last_name,
    'phone', customer.phone,
    'business_name', customer.business_name
  )
  into v_customer
  from public.customers as customer
  where customer.id = v_source_order.customer_id
    and customer.store_id = v_source_order.store_id;

  select pickup.id
  into v_pickup_option_id
  from public.store_pickup_options as pickup
  where pickup.id = v_source_order.pickup_option_id
    and pickup.store_id = v_source_order.store_id
    and pickup.is_active = true;

  with inventory_lines as (
    select
      (array_agg(order_item.id order by order_item.id))[1] as sort_id,
      case
        when coalesce(order_item.order_item_source, 'listing_inventory') in (
          'inventory',
          'listing_inventory'
        ) then 'listing_inventory'
        else order_item.order_item_source
      end as item_type,
      case
        when coalesce(order_item.order_item_source, 'listing_inventory') in (
          'inventory',
          'listing_inventory'
        ) then order_item.inventory_item_id
        when order_item.order_item_source = 'equipment_inventory'
          then order_item.equipment_inventory_item_id
        when order_item.order_item_source = 'processed_poultry_inventory'
          then order_item.processed_poultry_inventory_item_id
        when order_item.order_item_source = 'hatching_egg_inventory'
          then order_item.hatching_egg_inventory_item_id
      end as source_id,
      sum(order_item.quantity)::integer as quantity,
      order_item.unit_price_snapshot as unit_price,
      min(coalesce(
        nullif(order_item.item_name_snapshot, ''),
        nullif(order_item.breed_display_name_snapshot, ''),
        'Inventory item'
      )) as item_name
    from public.order_items as order_item
    where order_item.order_id = v_source_order.id
      and order_item.store_id = v_source_order.store_id
      and coalesce(order_item.order_item_source, 'listing_inventory') <> 'custom'
      and coalesce(order_item.order_item_source, 'listing_inventory') in (
        'inventory',
        'listing_inventory',
        'equipment_inventory',
        'processed_poultry_inventory',
        'hatching_egg_inventory'
      )
    group by
      case
        when coalesce(order_item.order_item_source, 'listing_inventory') in (
          'inventory',
          'listing_inventory'
        ) then 'listing_inventory'
        else order_item.order_item_source
      end,
      case
        when coalesce(order_item.order_item_source, 'listing_inventory') in (
          'inventory',
          'listing_inventory'
        ) then order_item.inventory_item_id
        when order_item.order_item_source = 'equipment_inventory'
          then order_item.equipment_inventory_item_id
        when order_item.order_item_source = 'processed_poultry_inventory'
          then order_item.processed_poultry_inventory_item_id
        when order_item.order_item_source = 'hatching_egg_inventory'
          then order_item.hatching_egg_inventory_item_id
      end,
      order_item.unit_price_snapshot
  ), draft_lines as (
    select
      inventory.sort_id,
      jsonb_build_object(
        'line_key', inventory.sort_id,
        'item_type', inventory.item_type,
        'source_id', inventory.source_id,
        'quantity', inventory.quantity,
        'unit_price', inventory.unit_price,
        'item_name', inventory.item_name
      ) as draft_line
    from inventory_lines as inventory

    union all

    select
      custom.id,
      jsonb_build_object(
        'line_key', custom.id,
        'item_type', 'custom',
        'source_id', null,
        'quantity', custom.quantity,
        'unit_price', custom.unit_price_snapshot,
        'item_name', custom.custom_item_name_snapshot
      )
    from public.order_items as custom
    where custom.order_id = v_source_order.id
      and custom.store_id = v_source_order.store_id
      and custom.order_item_source = 'custom'
  )
  select coalesce(
    jsonb_agg(draft.draft_line order by draft.sort_id),
    '[]'::jsonb
  )
  into v_items
  from draft_lines as draft;

  return jsonb_build_object(
    'can_restore', jsonb_array_length(v_reasons) = 0,
    'reasons', v_reasons,
    'source_order_id', v_source_order.id,
    'source_order_number', v_source_order.order_number,
    'customer', v_customer,
    'items', v_items,
    'buyer_notes', v_source_order.buyer_notes,
    'pickup_note', v_source_order.pickup_note,
    'pickup_option_id', v_pickup_option_id,
    'fulfillment_method', v_source_order.fulfillment_method,
    'delivery_address', jsonb_build_object(
      'line1', v_source_order.buyer_address_line1_snapshot,
      'line2', v_source_order.buyer_address_line2_snapshot,
      'city', v_source_order.buyer_city_snapshot,
      'state', v_source_order.buyer_state_snapshot,
      'postal_code', v_source_order.buyer_postal_code_snapshot,
      'country', v_source_order.buyer_country_snapshot
    )
  );
end;
$$;

revoke all on function public.seller_get_order_restore_draft(uuid)
from public, anon, service_role;
grant execute on function public.seller_get_order_restore_draft(uuid)
to authenticated;

commit;
