-- Return one bounded seller order page together with complete database counts.
-- Search includes the same order, buyer, pickup, note, total, quantity, and
-- immutable item snapshot fields used by the Orders screen.

create index if not exists orders_store_archive_pickup_created_idx
on public.orders(store_id, archived_at, pickup_option_id, created_at desc);

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
security invoker
set search_path = public
as $$
declare
  v_archive_view text := lower(trim(coalesce(p_archive_view, 'active')));
  v_status_filter text := lower(trim(coalesce(p_status_filter, 'all')));
  v_sort text := lower(trim(coalesce(p_sort, 'newest')));
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if p_store_id is null then
    raise exception 'store_required' using errcode = '22023';
  end if;

  if not public.owns_store(p_store_id) and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_archive_view not in ('active', 'archived') then
    raise exception 'invalid_archive_view' using errcode = '22023';
  end if;

  if v_status_filter not in ('all', 'ready_for_pickup', 'completed', 'canceled') then
    raise exception 'invalid_status_filter' using errcode = '22023';
  end if;

  if v_sort not in ('newest', 'oldest', 'buyer_name', 'order_total') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;

  return (
    with base_orders as materialized (
      select
        orders.id as order_id,
        orders.order_number,
        orders.order_source,
        orders.order_status,
        orders.payment_method,
        orders.payment_status,
        orders.payment_provider,
        orders.created_at,
        orders.ready_for_pickup_at,
        orders.fulfilled_at,
        orders.canceled_at,
        orders.archived_at,
        orders.archived_by,
        orders.buyer_first_name_snapshot,
        orders.buyer_last_name_snapshot,
        orders.buyer_email_snapshot,
        orders.buyer_phone_snapshot,
        orders.pickup_note,
        orders.buyer_notes,
        orders.total_amount,
        orders.pickup_option_id,
        coalesce(
          store_pickup_options.label,
          orders.pickup_option_label_snapshot
        ) as pickup_option_label_snapshot,
        lower(coalesce(nullif(trim(concat_ws(
          ' ',
          orders.buyer_first_name_snapshot,
          orders.buyer_last_name_snapshot
        )), ''), 'Buyer')) as buyer_sort_name
      from public.orders
      left join public.store_pickup_options
        on store_pickup_options.id = orders.pickup_option_id
       and store_pickup_options.store_id = orders.store_id
      left join lateral (
        select
          coalesce(sum(order_items.quantity), 0) as total_item_quantity,
          string_agg(
            concat_ws(
              ' ',
              order_items.species_name_snapshot,
              order_items.breed_display_name_snapshot,
              replace(order_items.inventory_type_snapshot, '_', ' '),
              replace(order_items.batch_type_snapshot, '_', ' '),
              order_items.custom_inventory_label_snapshot,
              case
                when order_items.age_at_sale_days_snapshot is null then null
                when floor(order_items.age_at_sale_days_snapshot / 7.0) > 26 then
                  floor(
                    floor(order_items.age_at_sale_days_snapshot / 7.0) * 12 / 52
                  )::integer::text || case
                    when floor(
                      floor(order_items.age_at_sale_days_snapshot / 7.0) * 12 / 52
                    ) = 1 then ' month old'
                    else ' months old'
                  end
                when order_items.age_at_sale_days_snapshot < 7 then
                  order_items.age_at_sale_days_snapshot::text || case
                    when order_items.age_at_sale_days_snapshot = 1 then ' day old'
                    else ' days old'
                  end
                else floor(order_items.age_at_sale_days_snapshot / 7.0)::integer::text || case
                  when floor(order_items.age_at_sale_days_snapshot / 7.0) = 1 then ' week old'
                  else ' weeks old'
                end
              end,
              replace(order_items.order_item_source, '_', ' '),
              order_items.custom_item_name_snapshot,
              replace(order_items.product_type_snapshot, '_', ' '),
              order_items.item_name_snapshot,
              replace(order_items.item_category_snapshot, '_', ' '),
              case
                when order_items.order_item_source in ('inventory', 'listing_inventory')
                  and coalesce(order_items.inventory_type_snapshot, '') = 'hatching_eggs'
                  then 'Hatching Eggs'
                when order_items.order_item_source in ('inventory', 'listing_inventory')
                  then 'Live Birds'
                when order_items.order_item_source = 'equipment_inventory'
                  then 'Equipment & Supplies'
                when order_items.order_item_source = 'processed_poultry_inventory'
                  then 'Poultry Products'
                when order_items.order_item_source = 'hatching_egg_inventory'
                  then 'Hatching Eggs'
                else 'Custom Other'
              end
            ),
            ' '
          ) as search_text
        from public.order_items
        where order_items.store_id = p_store_id
          and order_items.order_id = orders.id
      ) as item_search on v_search is not null
      where orders.store_id = p_store_id
        and (
          (v_archive_view = 'active' and orders.archived_at is null)
          or (v_archive_view = 'archived' and orders.archived_at is not null)
        )
        and (
          v_status_filter = 'all'
          or (
            v_status_filter = 'ready_for_pickup'
            and coalesce(orders.order_status, '') not in ('fulfilled', 'canceled')
          )
          or (v_status_filter = 'completed' and orders.order_status = 'fulfilled')
          or (v_status_filter = 'canceled' and orders.order_status = 'canceled')
        )
        and (
          p_pickup_option_id is null
          or orders.pickup_option_id = p_pickup_option_id
        )
        and (
          v_search is null
          or position(v_search in lower(concat_ws(
            ' ',
            orders.order_number,
            orders.buyer_first_name_snapshot,
            orders.buyer_last_name_snapshot,
            orders.buyer_phone_snapshot,
            orders.buyer_email_snapshot,
            orders.pickup_note,
            coalesce(store_pickup_options.label, orders.pickup_option_label_snapshot),
            orders.buyer_notes,
            orders.total_amount::text,
            trim(to_char(coalesce(orders.total_amount, 0), 'FM$999,999,999,990.00')),
            coalesce(item_search.total_item_quantity, 0)::text || case
              when coalesce(item_search.total_item_quantity, 0) = 1 then ' item'
              else ' items'
            end,
            item_search.search_text
          ))) > 0
        )
    ),
    numbered_orders as materialized (
      select
        base_orders.*,
        row_number() over (
          order by
            case when v_sort = 'oldest' then base_orders.created_at end asc,
            case when v_sort = 'newest' then base_orders.created_at end desc,
            case when v_sort = 'buyer_name' then base_orders.buyer_sort_name end asc,
            case when v_sort = 'order_total' then coalesce(base_orders.total_amount, 0) end desc,
            base_orders.order_id asc
        ) as page_position
      from base_orders
    ),
    page_orders as materialized (
      select numbered_orders.*
      from numbered_orders
      where numbered_orders.page_position > v_offset
        and numbered_orders.page_position <= v_offset + v_limit
    ),
    page_rows as (
      select
        page_orders.*,
        coalesce(item_totals.item_count, 0) as item_count,
        coalesce(item_totals.total_item_quantity, 0) as total_item_quantity
      from page_orders
      left join lateral (
        select
          count(*) as item_count,
          coalesce(sum(order_items.quantity), 0) as total_item_quantity
        from public.order_items
        where order_items.store_id = p_store_id
          and order_items.order_id = page_orders.order_id
      ) as item_totals on true
    ),
    lifecycle_counts as (
      select
        count(*) filter (where orders.archived_at is null) as active_count,
        count(*) filter (where orders.archived_at is not null) as archived_count,
        count(*) filter (
          where orders.archived_at is null
            and coalesce(orders.order_status, '') not in ('fulfilled', 'canceled')
        ) as ready_for_pickup_count,
        count(*) filter (
          where orders.archived_at is null
            and orders.order_status = 'fulfilled'
        ) as completed_count,
        count(*) filter (
          where orders.archived_at is null
            and orders.order_status = 'canceled'
        ) as canceled_count
      from public.orders
      where orders.store_id = p_store_id
    ),
    pickup_options as (
      select distinct on (orders.pickup_option_id)
        orders.pickup_option_id as id,
        coalesce(
          store_pickup_options.label,
          orders.pickup_option_label_snapshot
        ) as label
      from public.orders
      left join public.store_pickup_options
        on store_pickup_options.id = orders.pickup_option_id
       and store_pickup_options.store_id = orders.store_id
      where orders.store_id = p_store_id
        and orders.order_status in ('pending', 'open')
        and orders.pickup_option_id is not null
        and coalesce(
          store_pickup_options.label,
          orders.pickup_option_label_snapshot
        ) is not null
      order by
        orders.pickup_option_id,
        orders.created_at desc
    )
    select jsonb_build_object(
      'orders', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'order_id', page_rows.order_id,
            'order_number', page_rows.order_number,
            'order_source', page_rows.order_source,
            'order_status', page_rows.order_status,
            'payment_method', page_rows.payment_method,
            'payment_status', page_rows.payment_status,
            'payment_provider', page_rows.payment_provider,
            'created_at', page_rows.created_at,
            'ready_for_pickup_at', page_rows.ready_for_pickup_at,
            'fulfilled_at', page_rows.fulfilled_at,
            'canceled_at', page_rows.canceled_at,
            'archived_at', page_rows.archived_at,
            'archived_by', page_rows.archived_by,
            'buyer_first_name_snapshot', page_rows.buyer_first_name_snapshot,
            'buyer_last_name_snapshot', page_rows.buyer_last_name_snapshot,
            'buyer_email_snapshot', page_rows.buyer_email_snapshot,
            'buyer_phone_snapshot', page_rows.buyer_phone_snapshot,
            'pickup_note', page_rows.pickup_note,
            'buyer_notes', page_rows.buyer_notes,
            'total_amount', page_rows.total_amount,
            'item_count', page_rows.item_count,
            'total_item_quantity', page_rows.total_item_quantity,
            'pickup_option_id', page_rows.pickup_option_id,
            'pickup_option_label_snapshot', page_rows.pickup_option_label_snapshot
          )
          order by page_rows.page_position
        )
        from page_rows
      ), '[]'::jsonb),
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'order_id', order_items.order_id,
            'order_item_id', order_items.id,
            'inventory_item_id', order_items.inventory_item_id,
            'equipment_inventory_item_id', order_items.equipment_inventory_item_id,
            'processed_poultry_inventory_item_id', order_items.processed_poultry_inventory_item_id,
            'hatching_egg_inventory_item_id', order_items.hatching_egg_inventory_item_id,
            'species_name_snapshot', order_items.species_name_snapshot,
            'breed_display_name_snapshot', order_items.breed_display_name_snapshot,
            'inventory_type_snapshot', order_items.inventory_type_snapshot,
            'batch_type_snapshot', order_items.batch_type_snapshot,
            'custom_inventory_label_snapshot', order_items.custom_inventory_label_snapshot,
            'hatch_date_snapshot', order_items.hatch_date_snapshot,
            'available_date_snapshot', order_items.available_date_snapshot,
            'age_at_sale_days_snapshot', order_items.age_at_sale_days_snapshot,
            'barn_location', inventory_items.barn_location,
            'breeding_history_snapshot', order_items.breeding_history_snapshot,
            'feather_condition_snapshot', order_items.feather_condition_snapshot,
            'order_item_source', order_items.order_item_source,
            'custom_item_name_snapshot', order_items.custom_item_name_snapshot,
            'product_type_snapshot', order_items.product_type_snapshot,
            'item_name_snapshot', order_items.item_name_snapshot,
            'item_category_snapshot', order_items.item_category_snapshot,
            'unit_price_snapshot', order_items.unit_price_snapshot,
            'quantity', order_items.quantity,
            'fulfilled_quantity', order_items.fulfilled_quantity,
            'remaining_unfulfilled_quantity', case
              when page_rows.order_status = 'canceled' then 0
              else greatest(
                order_items.quantity
                  - order_items.fulfilled_quantity
                  - order_items.restored_quantity,
                0
              )
            end,
            'line_subtotal', order_items.line_subtotal
          )
          order by page_rows.page_position, order_items.created_at, order_items.id
        )
        from page_rows
        join public.order_items
          on order_items.store_id = p_store_id
         and order_items.order_id = page_rows.order_id
        left join public.inventory_items
          on inventory_items.store_id = p_store_id
         and inventory_items.id = order_items.inventory_item_id
      ), '[]'::jsonb),
      'total_count', (select count(*) from base_orders),
      'counts', (
        select jsonb_build_object(
          'active', lifecycle_counts.active_count,
          'archived', lifecycle_counts.archived_count,
          'all', lifecycle_counts.active_count,
          'ready_for_pickup', lifecycle_counts.ready_for_pickup_count,
          'completed', lifecycle_counts.completed_count,
          'canceled', lifecycle_counts.canceled_count
        )
        from lifecycle_counts
      ),
      'pickup_options', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', pickup_options.id, 'label', pickup_options.label)
          order by pickup_options.label
        )
        from pickup_options
      ), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.seller_get_order_list_page(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  integer,
  integer
) is
'Returns one bounded, globally searched/filtered/sorted seller order page plus exact lifecycle/archive counts and distinct open-order pickup options. Ownership is checked before reading tenant data.';

revoke all on function public.seller_get_order_list_page(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  integer,
  integer
) from public;

grant execute on function public.seller_get_order_list_page(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  integer,
  integer
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
          || jsonb_build_object('barn_location', inventory_items.barn_location)
        order by
          array_position(p_order_ids, order_item.order_id),
          order_item.created_at,
          order_item.order_item_id
      )
      from public.seller_order_item_detail as order_item
      left join public.inventory_items
        on inventory_items.store_id = order_item.store_id
       and inventory_items.id = order_item.inventory_item_id
      where order_item.store_id = p_store_id
        and order_item.order_id = any(coalesce(p_order_ids, '{}'::uuid[]))
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.seller_get_orders_for_print(uuid, uuid[]) is
'Returns complete print snapshots for an explicit seller-owned order ID set as one JSON value, avoiding PostgREST row truncation.';

revoke all on function public.seller_get_orders_for_print(uuid, uuid[]) from public;
grant execute on function public.seller_get_orders_for_print(uuid, uuid[]) to authenticated;
