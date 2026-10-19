-- Orders created before barn locations were snapshotted have a null value on
-- their reservation lines. Keep the snapshot authoritative whenever it exists,
-- but let operational reports receive the current inventory location for those
-- legacy active lines.
create or replace function public.seller_get_order_list_page(
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
    p_store_id, p_archive_view, p_status_filter, p_pickup_option_id,
    p_search, p_sort, p_offset, p_limit
  );

  select coalesce(
    jsonb_agg(
      page_item.value || jsonb_build_object(
        'barn_location', case
          when order_items.barn_location is null
            and orders.order_status in ('pending', 'open')
            and order_items.quantity > order_items.fulfilled_quantity + order_items.canceled_quantity
            then inventory_items.barn_location
          else order_items.barn_location
        end,
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
   and orders.store_id = order_items.store_id
  left join public.inventory_items
    on inventory_items.id = order_items.inventory_item_id
   and inventory_items.store_id = order_items.store_id;

  return jsonb_set(v_page, '{items}', v_items, true);
end;
$$;

comment on function public.seller_get_order_list_page(
  uuid, text, text, uuid, text, text, integer, integer
) is
'Returns the bounded seller order page with reservation-level barn locations. Historical snapshots remain authoritative; legacy blank snapshots fall back to the linked live-inventory location for operational pull sheets.';
