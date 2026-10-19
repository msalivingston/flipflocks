begin;

-- Barn location is operational data for live birds.  It is retained on the
-- reservation line so a completed order does not start showing a later move.
-- No backfill is performed: older completed orders never captured this value.
alter table public.order_items
  add column barn_location text;

alter table public.order_items
  add constraint order_items_barn_location_length_check check (
    barn_location is null
    or char_length(barn_location) between 1 and 200
  );

comment on column public.order_items.barn_location is
'Operational barn location for this reservation line. New lines capture the selected inventory location; location moves update only lines with birds still awaiting pickup.';

create or replace function public.snapshot_live_bird_advanced_attributes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if new.inventory_item_id is not null then
    select
      inventory_items.breeding_history,
      inventory_items.feather_condition,
      inventory_items.barn_location
    into
      new.breeding_history_snapshot,
      new.feather_condition_snapshot,
      new.barn_location
    from public.inventory_items
    where inventory_items.id = new.inventory_item_id
      and inventory_items.store_id = new.store_id;
  else
    new.breeding_history_snapshot := null;
    new.feather_condition_snapshot := null;
    new.barn_location := null;
  end if;

  return new;
end;
$function$;

create or replace view public.seller_order_item_detail
with (security_barrier = true)
as
select
  oi.store_id, oi.order_id, oi.id as order_item_id, o.order_number,
  oi.inventory_item_id, oi.equipment_inventory_item_id,
  oi.processed_poultry_inventory_item_id, oi.listing_batch_id,
  oi.listing_batch_breed_id, oi.seller_breed_profile_id, oi.species_id,
  oi.species_name_snapshot, oi.species_slug_snapshot,
  oi.breed_display_name_snapshot, oi.breed_description_snapshot,
  oi.inventory_type_snapshot, oi.custom_inventory_label_snapshot,
  oi.batch_type_snapshot, oi.product_type_snapshot, oi.item_name_snapshot,
  oi.item_category_snapshot, oi.available_date_snapshot,
  oi.age_at_availability_days_snapshot, oi.unit_price_snapshot, oi.quantity,
  oi.fulfilled_quantity, oi.restored_quantity,
  case when o.order_status = 'canceled' then 0
       else greatest(oi.quantity - oi.fulfilled_quantity - oi.canceled_quantity, 0)
  end as remaining_unfulfilled_quantity,
  oi.line_subtotal, oi.created_at, oi.hatch_date_snapshot,
  oi.age_at_sale_days_snapshot, oi.order_item_source,
  oi.custom_item_name_snapshot, oi.hatching_egg_inventory_item_id,
  oi.breeding_history_snapshot, oi.feather_condition_snapshot,
  oi.canceled_quantity, oi.barn_location
from public.order_items as oi
join public.orders as o on o.id = oi.order_id and o.store_id = oi.store_id
where public.owns_store(oi.store_id) or public.is_admin();

comment on view public.seller_order_item_detail is
'Seller-private order item projection. Barn location follows active, unpicked reservation lines and remains fixed once no birds remain to be picked up.';

grant select on public.seller_order_item_detail to authenticated;

alter function public.seller_get_order_list_page(
  uuid, text, text, uuid, text, text, integer, integer
)
rename to seller_get_order_list_page_before_barn_location_operations;

revoke all on function public.seller_get_order_list_page_before_barn_location_operations(
  uuid, text, text, uuid, text, text, integer, integer
) from public, anon, authenticated, service_role;

create function public.seller_get_order_list_page(
  p_store_id uuid,
  p_archive_view text,
  p_status_filter text,
  p_pickup_option_id uuid,
  p_search text,
  p_sort text,
  p_offset integer,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page jsonb;
  v_items jsonb;
begin
  v_page := public.seller_get_order_list_page_before_barn_location_operations(
    p_store_id,
    p_archive_view,
    p_status_filter,
    p_pickup_option_id,
    p_search,
    p_sort,
    p_offset,
    p_limit
  );

  select coalesce(
    jsonb_agg(
      page_item.value || jsonb_build_object(
        'barn_location', order_items.barn_location,
        'canceled_quantity', order_items.canceled_quantity,
        'remaining_unfulfilled_quantity', case
          when orders.order_status = 'canceled' then 0
          else greatest(
            order_items.quantity
              - order_items.fulfilled_quantity
              - order_items.canceled_quantity,
            0
          )
        end
      )
      order by page_item.ordinality
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(coalesce(v_page -> 'items', '[]'::jsonb))
    with ordinality as page_item(value, ordinality)
  join public.order_items
    on order_items.id = (page_item.value ->> 'order_item_id')::uuid
   and order_items.store_id = p_store_id
  join public.orders
    on orders.id = order_items.order_id
   and orders.store_id = order_items.store_id;

  return jsonb_set(v_page, '{items}', v_items, true);
end;
$$;

comment on function public.seller_get_order_list_page(
  uuid, text, text, uuid, text, text, integer, integer
) is
'Returns the bounded seller order page with reservation-level barn locations, canceled quantity, and remaining active quantity on each order item.';

revoke all on function public.seller_get_order_list_page(
  uuid, text, text, uuid, text, text, integer, integer
) from public, anon, service_role;
grant execute on function public.seller_get_order_list_page(
  uuid, text, text, uuid, text, text, integer, integer
) to authenticated;

create or replace function public.seller_get_orders_for_print(
  p_store_id uuid,
  p_order_ids uuid[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_store_id is null then
    raise exception 'store_required' using errcode = '22023';
  end if;

  if not public.owns_store(p_store_id) and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(
        to_jsonb(order_management)
          || jsonb_build_object(
            'fulfillment_method', orders.fulfillment_method,
            'delivery_option_name_snapshot', orders.delivery_option_name_snapshot,
            'delivery_fee_amount', orders.delivery_fee_amount
          )
        order by array_position(p_order_ids, order_management.order_id)
      )
      from public.seller_order_management as order_management
      join public.orders
        on orders.store_id = order_management.store_id
       and orders.id = order_management.order_id
      where order_management.store_id = p_store_id
        and order_management.order_id = any(coalesce(p_order_ids, '{}'::uuid[]))
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(
        to_jsonb(order_item)
        order by
          array_position(p_order_ids, order_item.order_id),
          order_item.created_at,
          order_item.order_item_id
      )
      from public.seller_order_item_detail as order_item
      where order_item.store_id = p_store_id
        and order_item.order_id = any(coalesce(p_order_ids, '{}'::uuid[]))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.seller_update_inventory_item(
  p_inventory_item_id uuid,
  p_inventory_type text,
  p_custom_inventory_label text default null,
  p_price_override numeric default null,
  p_sort_order integer default 0,
  p_seller_notes text default null,
  p_barn_location text default null,
  p_breeding_history text default null,
  p_feather_condition text default null,
  p_update_advanced_attributes boolean default false
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_item public.inventory_items%rowtype;
  v_updated_item public.inventory_items%rowtype;
begin
  if p_inventory_type is null
    or p_inventory_type not in (
      'female', 'male', 'straight_run', 'unsexed', 'pair', 'trio',
      'hatching_eggs', 'other'
    ) then
    raise exception 'Invalid inventory type.';
  end if;

  if p_inventory_type = 'other'
    and nullif(trim(p_custom_inventory_label), '') is null then
    raise exception 'Custom inventory label is required for other inventory type.';
  end if;

  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'Sort order must be nonnegative.';
  end if;

  if p_update_advanced_attributes then
    if char_length(btrim(p_barn_location)) > 200 then
      raise exception 'Barn location must be 200 characters or fewer.';
    end if;
    if p_breeding_history is not null
      and p_breeding_history not in ('never_bred', 'breeder') then
      raise exception 'Invalid breeding history.';
    end if;
    if p_feather_condition is not null
      and p_feather_condition not in ('excellent', 'good', 'rough', 'very_rough') then
      raise exception 'Invalid feather condition.';
    end if;
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Inventory item not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this inventory item.';
  end if;

  select * into v_batch
  from public.listing_batches
  where id = v_item.listing_batch_id;

  if v_batch.id is null or v_batch.store_id <> v_item.store_id then
    raise exception 'Inventory hierarchy is invalid.';
  end if;

  if (v_batch.batch_type = 'hatching_eggs' and p_inventory_type <> 'hatching_eggs')
    or (v_batch.batch_type = 'live_animals' and p_inventory_type = 'hatching_eggs') then
    raise exception 'Inventory type is not compatible with listing batch type.';
  end if;

  update public.inventory_items
  set
    inventory_type = p_inventory_type,
    custom_inventory_label = nullif(trim(p_custom_inventory_label), ''),
    price_override = p_price_override,
    sort_order = coalesce(p_sort_order, 0),
    seller_notes = nullif(trim(p_seller_notes), ''),
    barn_location = case
      when p_update_advanced_attributes then nullif(btrim(p_barn_location), '')
      else v_item.barn_location
    end,
    breeding_history = case
      when p_update_advanced_attributes then p_breeding_history
      else v_item.breeding_history
    end,
    feather_condition = case
      when p_update_advanced_attributes then p_feather_condition
      else v_item.feather_condition
    end
  where id = v_item.id
  returning * into v_updated_item;

  if p_update_advanced_attributes
    and v_item.barn_location is distinct from v_updated_item.barn_location then
    update public.order_items as order_items
    set barn_location = v_updated_item.barn_location
    from public.orders as orders
    where order_items.inventory_item_id = v_item.id
      and order_items.store_id = v_item.store_id
      and orders.id = order_items.order_id
      and orders.store_id = order_items.store_id
      and orders.order_status in ('pending', 'open')
      and order_items.quantity > order_items.fulfilled_quantity + order_items.canceled_quantity;
  end if;

  perform public.log_inventory_activity_event(
    v_updated_item.store_id, v_updated_item.listing_batch_id,
    v_updated_item.listing_batch_breed_id, v_updated_item.id,
    'inventory_item_updated', v_item.quantity_available,
    v_updated_item.quantity_available, v_item.visibility_status,
    v_updated_item.visibility_status, null,
    jsonb_build_object(
      'previous_inventory_type', v_item.inventory_type,
      'new_inventory_type', v_updated_item.inventory_type,
      'previous_price_override', v_item.price_override,
      'new_price_override', v_updated_item.price_override
    )
  );

  return v_updated_item;
end;
$$;

commit;
