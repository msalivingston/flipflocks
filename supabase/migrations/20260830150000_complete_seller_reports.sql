-- Complete, bounded seller reports. Detail rows are paginated while summaries
-- are calculated over the full matching population inside Postgres.

create or replace view public.seller_report_order_item_facts
with (security_barrier = true)
as
with normalized as (
  select
    oi.*,
    trim(both '_' from regexp_replace(replace(lower(trim(coalesce(oi.inventory_type_snapshot, ''))), '&', 'and'), '[^a-z0-9]+', '_', 'g')) as normalized_inventory_type,
    trim(both '_' from regexp_replace(replace(lower(trim(coalesce(oi.batch_type_snapshot, ''))), '&', 'and'), '[^a-z0-9]+', '_', 'g')) as normalized_batch_type,
    trim(both '_' from regexp_replace(replace(lower(trim(coalesce(oi.product_type_snapshot, ''))), '&', 'and'), '[^a-z0-9]+', '_', 'g')) as normalized_product_type,
    trim(both '_' from regexp_replace(replace(lower(trim(coalesce(oi.item_category_snapshot, ''))), '&', 'and'), '[^a-z0-9]+', '_', 'g')) as normalized_item_category
  from public.order_items oi
  where public.owns_store(oi.store_id) or public.is_admin()
),
classified as (
  select
    oi.store_id,
    oi.order_id,
    oi.id as order_item_id,
    oi.created_at,
    oi.quantity,
    oi.line_subtotal,
    oi.custom_item_name_snapshot,
    oi.item_name_snapshot,
    oi.custom_inventory_label_snapshot,
    oi.inventory_type_snapshot,
    oi.species_name_snapshot,
    oi.breed_display_name_snapshot,
    case
      when oi.order_item_source = 'custom' then 'Custom / Other'
      when oi.order_item_source = 'equipment_inventory' then 'Equipment & Supplies'
      when oi.order_item_source = 'processed_poultry_inventory' then 'Poultry Products'
      when oi.order_item_source = 'hatching_egg_inventory' then 'Hatching Eggs'
      when oi.order_item_source in ('listing_inventory', 'inventory') then
        case when
          oi.normalized_inventory_type in ('hatching_eggs', 'hatching_egg')
          or oi.normalized_batch_type in ('hatching_eggs', 'hatching_egg')
          or oi.normalized_item_category in ('hatching_eggs', 'hatching_egg')
        then 'Hatching Eggs' else 'Live Birds' end
      when oi.hatching_egg_inventory_item_id is not null then 'Hatching Eggs'
      when oi.equipment_inventory_item_id is not null then 'Equipment & Supplies'
      when oi.processed_poultry_inventory_item_id is not null then 'Poultry Products'
      when oi.inventory_item_id is not null then
        case when
          oi.normalized_inventory_type in ('hatching_eggs', 'hatching_egg')
          or oi.normalized_batch_type in ('hatching_eggs', 'hatching_egg')
          or oi.normalized_item_category in ('hatching_eggs', 'hatching_egg')
        then 'Hatching Eggs' else 'Live Birds' end
      when oi.normalized_inventory_type in ('hatching_eggs', 'hatching_egg')
        or oi.normalized_batch_type in ('hatching_eggs', 'hatching_egg')
        or oi.normalized_item_category in ('hatching_eggs', 'hatching_egg')
        then 'Hatching Eggs'
      when oi.normalized_product_type in ('processed_poultry', 'poultry_products', 'poultry_product')
        or oi.normalized_item_category in ('processed_poultry', 'poultry_products', 'poultry_product')
        then 'Poultry Products'
      when oi.normalized_product_type in ('equipment', 'equipment_supplies', 'equipment_and_supplies')
        or oi.normalized_item_category in ('equipment', 'equipment_supplies', 'equipment_and_supplies')
        then 'Equipment & Supplies'
      when oi.normalized_batch_type in ('live_birds', 'live_bird', 'live_poultry', 'live_animals')
        or oi.normalized_item_category in ('live_birds', 'live_bird', 'live_poultry', 'live_animals')
        or oi.normalized_inventory_type in ('female', 'male', 'straight_run', 'unsexed', 'pair', 'trio')
        or (
          oi.species_name_snapshot is not null
          and oi.breed_display_name_snapshot is not null
          and coalesce(oi.inventory_type_snapshot, '') <> ''
        ) then 'Live Birds'
      else 'Custom / Other'
    end as item_type
  from normalized oi
)
select
  classified.store_id,
  classified.order_id,
  classified.order_item_id,
  classified.created_at,
  classified.quantity,
  classified.line_subtotal,
  classified.item_type,
  coalesce(
    nullif(classified.custom_item_name_snapshot, ''),
    nullif(classified.item_name_snapshot, ''),
    case
      when classified.item_type = 'Equipment & Supplies' then
        coalesce(nullif(classified.custom_inventory_label_snapshot, ''), 'Equipment & Supplies')
      else
        case
          when coalesce(nullif(classified.custom_inventory_label_snapshot, ''), nullif(replace(classified.inventory_type_snapshot, '_', ' '), ''), 'Not set') = 'Not set'
            then coalesce(nullif(classified.breed_display_name_snapshot, ''), 'Item')
          else concat(
            coalesce(nullif(classified.breed_display_name_snapshot, ''), 'Item'),
            ' ',
            coalesce(nullif(classified.custom_inventory_label_snapshot, ''), replace(classified.inventory_type_snapshot, '_', ' '))
          )
        end
    end
  ) as item_name,
  case
    when classified.item_type in ('Equipment & Supplies', 'Custom / Other') then '—'
    else coalesce(nullif(classified.species_name_snapshot, ''), '—')
  end as species,
  case
    when classified.item_type in ('Live Birds', 'Hatching Eggs') then coalesce(nullif(classified.breed_display_name_snapshot, ''), '—')
    else '—'
  end as breed
from classified;

comment on view public.seller_report_order_item_facts is
'Seller-private, row-level order item facts used by bounded report aggregation. Imported history is intentionally absent because it has no dated item records.';

revoke all on public.seller_report_order_item_facts from public;
grant select on public.seller_report_order_item_facts to authenticated;

create or replace function public.seller_get_report_page(
  p_store_id uuid,
  p_report text,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_amount_over numeric default null,
  p_item_type text default 'all',
  p_species text default 'all',
  p_breed text default 'all',
  p_search text default null,
  p_include_imported boolean default false,
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_report text := lower(trim(coalesce(p_report, '')));
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_has_any_data boolean;
begin
  if p_store_id is null then
    raise exception 'store_required' using errcode = '22023';
  end if;

  if not public.owns_store(p_store_id) and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_report not in ('sales', 'items', 'customers') then
    raise exception 'invalid_report' using errcode = '22023';
  end if;

  select
    exists (
      select 1 from public.orders
      where store_id = p_store_id and order_status <> 'canceled'
    ) or exists (
      select 1 from public.customers
      where store_id = p_store_id
        and (imported_order_count > 0 or imported_order_total_cents > 0)
    )
  into v_has_any_data;

  if v_report = 'sales' then
    return (
      with date_orders as materialized (
        select o.*
        from public.orders o
        where o.store_id = p_store_id
          and o.order_status <> 'canceled'
          and (p_start_at is null or o.created_at >= p_start_at)
          and (p_end_at is null or o.created_at <= p_end_at)
      ),
      filtered as materialized (
        select * from date_orders
        where p_amount_over is null or total_amount > p_amount_over
      ),
      page as (
        select * from filtered
        order by created_at desc, id desc
        offset v_offset limit v_limit
      ),
      page_rows as (
        select jsonb_build_object(
          'order_id', p.id,
          'order_number', p.order_number,
          'order_status', p.order_status,
          'payment_method', p.payment_method,
          'ready_for_pickup_at', p.ready_for_pickup_at,
          'created_at', p.created_at,
          'customer_id', p.customer_id,
          'buyer_first_name_snapshot', p.buyer_first_name_snapshot,
          'buyer_last_name_snapshot', p.buyer_last_name_snapshot,
          'buyer_email_snapshot', p.buyer_email_snapshot,
          'buyer_phone_snapshot', p.buyer_phone_snapshot,
          'buyer_notes', p.buyer_notes,
          'pickup_note', p.pickup_note,
          'total_amount', p.total_amount,
          'item_count', coalesce(items.item_count, 0),
          'total_item_quantity', coalesce(items.total_item_quantity, 0),
          'item_summary', coalesce(items.item_summary, '')
        ) as row_data,
        p.created_at,
        p.id
        from page p
        left join lateral (
          select
            count(*) as item_count,
            coalesce(sum(f.quantity), 0) as total_item_quantity,
            string_agg(
              case when coalesce(f.quantity, 0) > 0
                then f.quantity::text || ' ' || f.item_name
                else f.item_name
              end,
              '; ' order by f.created_at, f.order_item_id
            ) as item_summary
          from public.seller_report_order_item_facts f
          where f.store_id = p_store_id and f.order_id = p.id
        ) items on true
      )
      select jsonb_build_object(
        'has_any_data', v_has_any_data,
        'total_count', (select count(*) from filtered),
        'summary', jsonb_build_object(
          'total_sales', coalesce((select sum(total_amount) from date_orders), 0),
          'order_count', (select count(*) from date_orders),
          'average_order_value', coalesce((select avg(total_amount) from date_orders), 0),
          'sales_over_amount', (select count(*) from filtered)
        ),
        'rows', coalesce((select jsonb_agg(row_data order by created_at desc, id desc) from page_rows), '[]'::jsonb),
        'options', '{}'::jsonb
      )
    );
  end if;

  if v_report = 'items' then
    return (
      with grouped as materialized (
        select
          f.item_name as item,
          f.item_type,
          f.species,
          f.breed,
          coalesce(sum(f.quantity), 0)::bigint as quantity,
          count(distinct f.order_id)::bigint as orders,
          coalesce(sum(f.line_subtotal), 0)::numeric as revenue
        from public.seller_report_order_item_facts f
        join public.orders o on o.id = f.order_id and o.store_id = f.store_id
        where f.store_id = p_store_id
          and o.order_status <> 'canceled'
          and (p_start_at is null or o.created_at >= p_start_at)
          and (p_end_at is null or o.created_at <= p_end_at)
        group by f.item_name, f.item_type, f.species, f.breed
      ),
      type_search as materialized (
        select * from grouped g
        where (coalesce(p_item_type, 'all') = 'all' or g.item_type = p_item_type)
          and (
            v_search is null
            or position(v_search in lower(concat_ws(' ', g.item, g.item_type, g.species, g.breed))) > 0
          )
      ),
      species_filtered as materialized (
        select * from type_search
        where coalesce(p_species, 'all') = 'all' or species = p_species
      ),
      filtered as materialized (
        select * from species_filtered
        where coalesce(p_breed, 'all') = 'all' or breed = p_breed
      ),
      page as (
        select * from filtered
        order by revenue desc, quantity desc, item, item_type, species, breed
        offset v_offset limit v_limit
      )
      select jsonb_build_object(
        'has_any_data', v_has_any_data,
        'total_count', (select count(*) from filtered),
        'summary', jsonb_build_object(
          'item_revenue', coalesce((select sum(revenue) from filtered), 0),
          'quantity_sold', coalesce((select sum(quantity) from filtered), 0),
          'unique_items', (select count(*) from filtered),
          'top_item', coalesce((select item from filtered order by revenue desc, quantity desc, item limit 1), '—')
        ),
        'rows', coalesce((select jsonb_agg(to_jsonb(page) order by revenue desc, quantity desc, item, item_type, species, breed) from page), '[]'::jsonb),
        'options', jsonb_build_object(
          'species', coalesce((select jsonb_agg(species order by species) from (select distinct species from type_search where species <> '—') values_for_species), '[]'::jsonb),
          'breeds', coalesce((select jsonb_agg(breed order by breed) from (select distinct breed from species_filtered where breed <> '—') values_for_breed), '[]'::jsonb)
        )
      )
    );
  end if;

  return (
    with order_quantities as materialized (
      select oi.store_id, oi.order_id, coalesce(sum(oi.quantity), 0)::bigint as item_quantity
      from public.order_items oi
      where oi.store_id = p_store_id
      group by oi.store_id, oi.order_id
    ),
    period_orders as materialized (
      select o.*, coalesce(oq.item_quantity, 0) as item_quantity
      from public.orders o
      left join order_quantities oq on oq.store_id = o.store_id and oq.order_id = o.id
      where o.store_id = p_store_id
        and o.order_status <> 'canceled'
        and (p_start_at is null or o.created_at >= p_start_at)
        and (p_end_at is null or o.created_at <= p_end_at)
    ),
    period_by_customer as materialized (
      select
        customer_id,
        count(*)::bigint as native_orders,
        coalesce(sum(item_quantity), 0)::bigint as items_bought,
        coalesce(sum(total_amount), 0)::numeric as native_spent,
        max(created_at) as last_order
      from period_orders
      where customer_id is not null
      group by customer_id
    ),
    lifetime_by_customer as materialized (
      select
        customer_id,
        count(*)::bigint as total_native_orders,
        count(*) filter (where order_status in ('pending', 'open'))::bigint as open_orders,
        coalesce(sum(total_amount), 0)::numeric as native_lifetime_total,
        max(created_at) as latest_order_at
      from public.orders
      where store_id = p_store_id and customer_id is not null
      group by customer_id
    ),
    latest_by_customer as materialized (
      select distinct on (o.customer_id)
        o.customer_id,
        o.total_amount
      from public.orders o
      where o.store_id = p_store_id
        and o.customer_id is not null
        and o.order_status <> 'canceled'
      order by o.customer_id, o.created_at desc, o.id desc
    ),
    registered as materialized (
      select
        c.id::text as customer_id,
        coalesce(nullif(c.business_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Customer') as customer_name,
        coalesce(c.first_name, '') as customer_first_name,
        coalesce(c.last_name, '') as customer_last_name,
        coalesce(c.business_name, '') as business_name,
        coalesce(c.email, '') as customer_email,
        coalesce(c.phone, '') as customer_phone,
        coalesce(c.delivery_address_line1, '') as mailing_address_line1,
        coalesce(c.delivery_address_line2, '') as mailing_address_line2,
        coalesce(c.delivery_city, '') as mailing_city,
        coalesce(c.delivery_state, '') as mailing_state,
        coalesce(c.delivery_postal_code, '') as mailing_postal_code,
        coalesce(c.delivery_country, '') as mailing_country,
        coalesce(c.internal_notes, '') as internal_notes,
        c.created_at,
        c.updated_at,
        coalesce(pbc.items_bought, 0)::bigint as items_bought,
        pbc.last_order,
        coalesce(lbc.latest_order_at, pbc.last_order) as latest_order_at,
        coalesce(latest.total_amount, 0)::numeric as last_order_total,
        coalesce(lbc.total_native_orders, 0)::bigint + c.imported_order_count::bigint as total_orders,
        coalesce(lbc.open_orders, 0)::bigint as open_orders,
        coalesce(lbc.native_lifetime_total, 0)::numeric + c.imported_order_total_cents / 100.0 as lifetime_order_total,
        coalesce(pbc.native_orders, 0)::bigint as native_orders,
        coalesce(pbc.native_spent, 0)::numeric as native_spent,
        c.imported_order_count::bigint as imported_order_count,
        c.imported_order_total_cents / 100.0 as imported_order_total,
        coalesce(c.imported_source, '') as imported_source
      from public.customers c
      left join period_by_customer pbc on pbc.customer_id = c.id
      left join lifetime_by_customer lbc on lbc.customer_id = c.id
      left join latest_by_customer latest on latest.customer_id = c.id
      where c.store_id = p_store_id
        and (
          coalesce(pbc.native_orders, 0) > 0
          or (p_include_imported and (c.imported_order_count > 0 or c.imported_order_total_cents > 0))
        )
    ),
    guests as materialized (
      select
        ('order-' || po.id::text) as customer_id,
        coalesce(nullif(trim(concat_ws(' ', po.buyer_first_name_snapshot, po.buyer_last_name_snapshot)), ''), 'Customer') as customer_name,
        coalesce(po.buyer_first_name_snapshot, '') as customer_first_name,
        coalesce(po.buyer_last_name_snapshot, '') as customer_last_name,
        ''::text as business_name,
        coalesce(po.buyer_email_snapshot, '') as customer_email,
        coalesce(po.buyer_phone_snapshot, '') as customer_phone,
        ''::text as mailing_address_line1,
        ''::text as mailing_address_line2,
        ''::text as mailing_city,
        ''::text as mailing_state,
        ''::text as mailing_postal_code,
        ''::text as mailing_country,
        ''::text as internal_notes,
        po.created_at,
        po.created_at as updated_at,
        po.item_quantity::bigint as items_bought,
        po.created_at as last_order,
        po.created_at as latest_order_at,
        po.total_amount::numeric as last_order_total,
        1::bigint as total_orders,
        case when po.order_status in ('pending', 'open') then 1 else 0 end::bigint as open_orders,
        po.total_amount::numeric as lifetime_order_total,
        1::bigint as native_orders,
        po.total_amount::numeric as native_spent,
        0::bigint as imported_order_count,
        0::numeric as imported_order_total,
        ''::text as imported_source
      from period_orders po
      where po.customer_id is null
    ),
    customer_rows as materialized (
      select * from registered
      union all
      select * from guests
    ),
    report_rows as materialized (
      select
        cr.*,
        case when p_include_imported then cr.native_orders + cr.imported_order_count else cr.native_orders end as orders,
        case when p_include_imported then cr.native_spent + cr.imported_order_total else cr.native_spent end as total_spent
      from customer_rows cr
    ),
    filtered as materialized (
      select * from report_rows rr
      where (p_amount_over is null or rr.total_spent > p_amount_over)
        and (
          v_search is null
          or position(v_search in lower(concat_ws(' ', rr.customer_name, rr.customer_email, rr.customer_phone))) > 0
        )
    ),
    page as (
      select * from filtered
      order by total_spent desc, orders desc, customer_name, customer_id
      offset v_offset limit v_limit
    )
    select jsonb_build_object(
      'has_any_data', v_has_any_data,
      'total_count', (select count(*) from filtered),
      'summary', jsonb_build_object(
        'total_customers', (select count(*) from filtered),
        'repeat_customers', (select count(*) from filtered where orders > 1),
        'total_spent', coalesce((select sum(total_spent) from filtered), 0),
        'average_spend', coalesce((select avg(total_spent) from filtered), 0),
        'top_customer_name', coalesce((select customer_name from filtered order by total_spent desc, orders desc, customer_name limit 1), '—'),
        'top_customer_spent', coalesce((select total_spent from filtered order by total_spent desc, orders desc, customer_name limit 1), 0),
        'includes_imported', p_include_imported
      ),
      'rows', coalesce((select jsonb_agg(to_jsonb(page) order by total_spent desc, orders desc, customer_name, customer_id) from page), '[]'::jsonb),
      'options', '{}'::jsonb
    )
  );
end;
$$;

comment on function public.seller_get_report_page(uuid, text, timestamptz, timestamptz, numeric, text, text, text, text, boolean, integer, integer) is
'Returns a bounded report detail page and full matching aggregates. Imported customer history is included only when explicitly requested for all-time customer reporting.';

revoke all on function public.seller_get_report_page(uuid, text, timestamptz, timestamptz, numeric, text, text, text, text, boolean, integer, integer) from public;
grant execute on function public.seller_get_report_page(uuid, text, timestamptz, timestamptz, numeric, text, text, text, text, boolean, integer, integer) to authenticated;
