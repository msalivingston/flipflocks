-- Active orders show the linked customer's current contact data. Terminal orders
-- retain the contact that existed when they were fulfilled or canceled.

create or replace function public.capture_terminal_order_customer_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
begin
  if new.order_status not in ('fulfilled', 'canceled')
     or old.order_status is not distinct from new.order_status then
    return new;
  end if;

  -- Legacy/unlinked orders deliberately retain their existing checkout snapshot.
  if new.customer_id is null then
    return new;
  end if;

  select customers.*
  into v_customer
  from public.customers
  where customers.id = new.customer_id
    and customers.store_id = new.store_id
  for key share;

  if not found then
    return new;
  end if;

  new.buyer_first_name_snapshot := v_customer.first_name;
  new.buyer_last_name_snapshot := v_customer.last_name;
  new.buyer_email_snapshot := v_customer.email;
  new.buyer_phone_snapshot := v_customer.phone;
  new.buyer_address_line1_snapshot := v_customer.delivery_address_line1;
  new.buyer_address_line2_snapshot := v_customer.delivery_address_line2;
  new.buyer_city_snapshot := v_customer.delivery_city;
  new.buyer_state_snapshot := v_customer.delivery_state;
  new.buyer_postal_code_snapshot := v_customer.delivery_postal_code;
  new.buyer_country_snapshot := v_customer.delivery_country;

  return new;
end;
$$;

comment on function public.capture_terminal_order_customer_snapshot() is
'Freezes the linked customer contact onto an order only when it enters a terminal fulfilled or canceled status. Active orders continue to use the linked customer record in seller projections.';

drop trigger if exists orders_capture_terminal_customer_snapshot on public.orders;
create trigger orders_capture_terminal_customer_snapshot
before update of order_status on public.orders
for each row
when (
  old.order_status is distinct from new.order_status
  and new.order_status in ('fulfilled', 'canceled')
)
execute function public.capture_terminal_order_customer_snapshot();

create or replace view public.seller_order_management
with (security_barrier = true)
as
with item_summary as (
  select
    order_items.store_id,
    order_items.order_id,
    count(*) as item_count,
    coalesce(sum(order_items.quantity), 0) as total_item_quantity,
    coalesce(sum(order_items.fulfilled_quantity), 0) as fulfilled_item_quantity,
    coalesce(sum(order_items.restored_quantity), 0) as restored_item_quantity,
    coalesce(sum(order_items.canceled_quantity), 0) as canceled_item_quantity
  from public.order_items
  group by order_items.store_id, order_items.order_id
),
refund_summary as (
  select
    order_refunds.store_id,
    order_refunds.order_id,
    count(*) as refund_count,
    coalesce(sum(order_refunds.refund_amount) filter (
      where order_refunds.refund_status in ('pending', 'succeeded')
    ), 0)::numeric(10, 2) as reserved_refund_amount,
    coalesce(sum(order_refunds.refund_amount) filter (
      where order_refunds.refund_status = 'succeeded'
    ), 0)::numeric(10, 2) as succeeded_refund_amount,
    max(order_refunds.created_at) as latest_refund_created_at
  from public.order_refunds
  group by order_refunds.store_id, order_refunds.order_id
),
notification_summary as (
  select
    email_notifications.store_id,
    email_notifications.order_id,
    count(*) filter (where email_notifications.notification_status = 'failed') as failed_notification_count,
    count(*) filter (where email_notifications.notification_status = 'pending') as pending_notification_count,
    max(email_notifications.updated_at) as latest_notification_updated_at
  from public.email_notifications
  group by email_notifications.store_id, email_notifications.order_id
)
select
  orders.store_id,
  orders.id as order_id,
  orders.order_number,
  orders.order_source,
  orders.order_status,
  orders.payment_method,
  orders.payment_status,
  orders.payment_provider,
  orders.provider_payment_status,
  orders.ready_for_pickup_at,
  orders.paid_at,
  orders.fulfilled_at,
  orders.canceled_at,
  orders.created_at,
  orders.updated_at,
  orders.customer_id,
  case when orders.order_status in ('fulfilled', 'canceled') or customers.id is null
    then orders.buyer_first_name_snapshot else customers.first_name end as buyer_first_name_snapshot,
  case when orders.order_status in ('fulfilled', 'canceled') or customers.id is null
    then orders.buyer_last_name_snapshot else customers.last_name end as buyer_last_name_snapshot,
  case when orders.order_status in ('fulfilled', 'canceled') or customers.id is null
    then orders.buyer_email_snapshot else customers.email end as buyer_email_snapshot,
  case when orders.order_status in ('fulfilled', 'canceled') or customers.id is null
    then orders.buyer_phone_snapshot else customers.phone end as buyer_phone_snapshot,
  case when orders.order_status in ('fulfilled', 'canceled') or customers.id is null
    then orders.buyer_address_line1_snapshot else customers.delivery_address_line1 end as buyer_address_line1_snapshot,
  case when orders.order_status in ('fulfilled', 'canceled') or customers.id is null
    then orders.buyer_address_line2_snapshot else customers.delivery_address_line2 end as buyer_address_line2_snapshot,
  case when orders.order_status in ('fulfilled', 'canceled') or customers.id is null
    then orders.buyer_city_snapshot else customers.delivery_city end as buyer_city_snapshot,
  case when orders.order_status in ('fulfilled', 'canceled') or customers.id is null
    then orders.buyer_state_snapshot else customers.delivery_state end as buyer_state_snapshot,
  case when orders.order_status in ('fulfilled', 'canceled') or customers.id is null
    then orders.buyer_postal_code_snapshot else customers.delivery_postal_code end as buyer_postal_code_snapshot,
  case when orders.order_status in ('fulfilled', 'canceled') or customers.id is null
    then orders.buyer_country_snapshot else customers.delivery_country end as buyer_country_snapshot,
  orders.pickup_note,
  orders.buyer_notes,
  orders.subtotal_amount,
  orders.tax_fee_label_snapshot,
  orders.tax_fee_amount,
  orders.total_amount,
  coalesce(item_summary.item_count, 0) as item_count,
  coalesce(item_summary.total_item_quantity, 0) as total_item_quantity,
  coalesce(item_summary.fulfilled_item_quantity, 0) as fulfilled_item_quantity,
  coalesce(item_summary.restored_item_quantity, 0) as restored_item_quantity,
  coalesce(refund_summary.refund_count, 0) as refund_count,
  coalesce(refund_summary.reserved_refund_amount, 0)::numeric(10, 2) as reserved_refund_amount,
  coalesce(refund_summary.succeeded_refund_amount, 0)::numeric(10, 2) as succeeded_refund_amount,
  greatest(orders.total_amount - coalesce(refund_summary.reserved_refund_amount, 0), 0)::numeric(10, 2) as refundable_amount_remaining,
  refund_summary.latest_refund_created_at,
  coalesce(notification_summary.failed_notification_count, 0) as failed_notification_count,
  coalesce(notification_summary.pending_notification_count, 0) as pending_notification_count,
  notification_summary.latest_notification_updated_at,
  orders.pickup_option_id,
  coalesce(store_pickup_options.label, orders.pickup_option_label_snapshot) as pickup_option_label_snapshot,
  orders.archived_at,
  orders.archived_by,
  coalesce(item_summary.canceled_item_quantity, 0) as canceled_item_quantity
from public.orders
left join public.customers
  on customers.id = orders.customer_id
 and customers.store_id = orders.store_id
left join item_summary
  on item_summary.store_id = orders.store_id
 and item_summary.order_id = orders.id
left join refund_summary
  on refund_summary.store_id = orders.store_id
 and refund_summary.order_id = orders.id
left join notification_summary
  on notification_summary.store_id = orders.store_id
 and notification_summary.order_id = orders.id
left join public.store_pickup_options
  on store_pickup_options.id = orders.pickup_option_id
 and store_pickup_options.store_id = orders.store_id
where public.owns_store(orders.store_id)
   or public.is_admin();

comment on view public.seller_order_management is
'Seller-private order projection. Active orders resolve customer contact from the linked customer record; fulfilled and canceled orders use their immutable terminal contact snapshot.';

grant select on public.seller_order_management to authenticated;

-- The first Orders pagination function is the only path that bypasses the
-- seller projection. Rebuild its bounded query against that projection so
-- its displayed values, buyer sorting, and search use the same live contact.
create or replace function public.seller_get_order_list_page_before_canceled_quantity(
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
  if p_store_id is null then raise exception 'store_required' using errcode = '22023'; end if;
  if not public.owns_store(p_store_id) and not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_archive_view not in ('active', 'archived') then raise exception 'invalid_archive_view' using errcode = '22023'; end if;
  if v_status_filter not in ('all', 'ready_for_pickup', 'completed', 'canceled') then raise exception 'invalid_status_filter' using errcode = '22023'; end if;
  if v_sort not in ('newest', 'oldest', 'buyer_name', 'order_total') then raise exception 'invalid_sort' using errcode = '22023'; end if;

  return (
    with base_orders as materialized (
      select
        order_management.order_id,
        order_management.order_number,
        order_management.order_source,
        order_management.order_status,
        order_management.payment_method,
        order_management.payment_status,
        order_management.payment_provider,
        order_management.created_at,
        order_management.ready_for_pickup_at,
        order_management.fulfilled_at,
        order_management.canceled_at,
        order_management.archived_at,
        order_management.archived_by,
        order_management.buyer_first_name_snapshot,
        order_management.buyer_last_name_snapshot,
        order_management.buyer_email_snapshot,
        order_management.buyer_phone_snapshot,
        order_management.pickup_note,
        order_management.buyer_notes,
        order_management.total_amount,
        order_management.pickup_option_id,
        order_management.pickup_option_label_snapshot,
        lower(coalesce(nullif(trim(concat_ws(' ', order_management.buyer_first_name_snapshot, order_management.buyer_last_name_snapshot)), ''), 'buyer')) as buyer_sort_name
      from public.seller_order_management as order_management
      left join lateral (
        select
          coalesce(sum(order_items.quantity), 0) as total_item_quantity,
          string_agg(concat_ws(' ', order_items.species_name_snapshot, order_items.breed_display_name_snapshot, replace(order_items.inventory_type_snapshot, '_', ' '), replace(order_items.batch_type_snapshot, '_', ' '), order_items.custom_inventory_label_snapshot, replace(order_items.order_item_source, '_', ' '), order_items.custom_item_name_snapshot, replace(order_items.product_type_snapshot, '_', ' '), order_items.item_name_snapshot, replace(order_items.item_category_snapshot, '_', ' ')), ' ') as search_text
        from public.order_items
        where order_items.store_id = p_store_id and order_items.order_id = order_management.order_id
      ) as item_search on v_search is not null
      where order_management.store_id = p_store_id
        and ((v_archive_view = 'active' and order_management.archived_at is null) or (v_archive_view = 'archived' and order_management.archived_at is not null))
        and (v_status_filter = 'all' or (v_status_filter = 'ready_for_pickup' and coalesce(order_management.order_status, '') not in ('fulfilled', 'canceled')) or (v_status_filter = 'completed' and order_management.order_status = 'fulfilled') or (v_status_filter = 'canceled' and order_management.order_status = 'canceled'))
        and (p_pickup_option_id is null or order_management.pickup_option_id = p_pickup_option_id)
        and (v_search is null or position(v_search in lower(concat_ws(' ', order_management.order_number, order_management.buyer_first_name_snapshot, order_management.buyer_last_name_snapshot, order_management.buyer_phone_snapshot, order_management.buyer_email_snapshot, order_management.pickup_note, order_management.pickup_option_label_snapshot, order_management.buyer_notes, order_management.total_amount::text, trim(to_char(coalesce(order_management.total_amount, 0), 'FM$999,999,999,990.00')), coalesce(item_search.total_item_quantity, 0)::text || case when coalesce(item_search.total_item_quantity, 0) = 1 then ' item' else ' items' end, item_search.search_text))) > 0)
    ),
    numbered_orders as materialized (
      select base_orders.*, row_number() over (order by case when v_sort = 'oldest' then base_orders.created_at end asc, case when v_sort = 'newest' then base_orders.created_at end desc, case when v_sort = 'buyer_name' then base_orders.buyer_sort_name end asc, case when v_sort = 'order_total' then coalesce(base_orders.total_amount, 0) end desc, base_orders.order_id asc) as page_position from base_orders
    ),
    page_orders as materialized (
      select numbered_orders.* from numbered_orders where numbered_orders.page_position > v_offset and numbered_orders.page_position <= v_offset + v_limit
    ),
    page_rows as (
      select page_orders.*, coalesce(item_totals.item_count, 0) as item_count, coalesce(item_totals.total_item_quantity, 0) as total_item_quantity
      from page_orders
      left join lateral (select count(*) as item_count, coalesce(sum(order_items.quantity), 0) as total_item_quantity from public.order_items where order_items.store_id = p_store_id and order_items.order_id = page_orders.order_id) as item_totals on true
    ),
    lifecycle_counts as (
      select count(*) filter (where orders.archived_at is null) as active_count, count(*) filter (where orders.archived_at is not null) as archived_count, count(*) filter (where orders.archived_at is null and coalesce(orders.order_status, '') not in ('fulfilled', 'canceled')) as ready_for_pickup_count, count(*) filter (where orders.archived_at is null and orders.order_status = 'fulfilled') as completed_count, count(*) filter (where orders.archived_at is null and orders.order_status = 'canceled') as canceled_count from public.orders where orders.store_id = p_store_id
    ),
    pickup_options as (
      select distinct on (orders.pickup_option_id) orders.pickup_option_id as id, coalesce(store_pickup_options.label, orders.pickup_option_label_snapshot) as label
      from public.orders left join public.store_pickup_options on store_pickup_options.id = orders.pickup_option_id and store_pickup_options.store_id = orders.store_id
      where orders.store_id = p_store_id and orders.order_status in ('pending', 'open') and orders.pickup_option_id is not null and coalesce(store_pickup_options.label, orders.pickup_option_label_snapshot) is not null
      order by orders.pickup_option_id, orders.created_at desc
    )
    select jsonb_build_object(
      'orders', coalesce((select jsonb_agg(jsonb_build_object('order_id', page_rows.order_id, 'order_number', page_rows.order_number, 'order_source', page_rows.order_source, 'order_status', page_rows.order_status, 'payment_method', page_rows.payment_method, 'payment_status', page_rows.payment_status, 'payment_provider', page_rows.payment_provider, 'created_at', page_rows.created_at, 'ready_for_pickup_at', page_rows.ready_for_pickup_at, 'fulfilled_at', page_rows.fulfilled_at, 'canceled_at', page_rows.canceled_at, 'archived_at', page_rows.archived_at, 'archived_by', page_rows.archived_by, 'buyer_first_name_snapshot', page_rows.buyer_first_name_snapshot, 'buyer_last_name_snapshot', page_rows.buyer_last_name_snapshot, 'buyer_email_snapshot', page_rows.buyer_email_snapshot, 'buyer_phone_snapshot', page_rows.buyer_phone_snapshot, 'pickup_note', page_rows.pickup_note, 'buyer_notes', page_rows.buyer_notes, 'total_amount', page_rows.total_amount, 'item_count', page_rows.item_count, 'total_item_quantity', page_rows.total_item_quantity, 'pickup_option_id', page_rows.pickup_option_id, 'pickup_option_label_snapshot', page_rows.pickup_option_label_snapshot) order by page_rows.page_position) from page_rows), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(to_jsonb(order_items) || jsonb_build_object('order_id', order_items.order_id, 'order_item_id', order_items.id, 'remaining_unfulfilled_quantity', case when page_rows.order_status = 'canceled' then 0 else greatest(order_items.quantity - order_items.fulfilled_quantity - order_items.restored_quantity, 0) end, 'line_subtotal', order_items.line_subtotal) order by page_rows.page_position, order_items.created_at, order_items.id) from page_rows join public.order_items on order_items.store_id = p_store_id and order_items.order_id = page_rows.order_id left join public.inventory_items on inventory_items.store_id = p_store_id and inventory_items.id = order_items.inventory_item_id), '[]'::jsonb),
      'total_count', (select count(*) from base_orders),
      'counts', (select jsonb_build_object('active', lifecycle_counts.active_count, 'archived', lifecycle_counts.archived_count, 'all', lifecycle_counts.active_count, 'ready_for_pickup', lifecycle_counts.ready_for_pickup_count, 'completed', lifecycle_counts.completed_count, 'canceled', lifecycle_counts.canceled_count) from lifecycle_counts),
      'pickup_options', coalesce((select jsonb_agg(jsonb_build_object('id', pickup_options.id, 'label', pickup_options.label) order by pickup_options.label) from pickup_options), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.seller_get_order_list_page_before_canceled_quantity(uuid, text, text, uuid, text, text, integer, integer) is
'Base bounded seller order page. Active-order buyer display, search, and buyer-name sorting use the linked customer record; terminal orders use their frozen contact snapshot.';

-- Sales reports also expose seller-facing customer contact data. Keep their
-- existing item/customer report implementations intact and replace only the
-- sales branch with the same resolved contact projection.
alter function public.seller_get_report_page(
  uuid, text, timestamptz, timestamptz, numeric, text, text, text, text,
  boolean, integer, integer
) rename to seller_get_report_page_before_customer_contact;

create function public.seller_get_report_page(
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
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_has_any_data boolean;
begin
  if v_report <> 'sales' then
    return public.seller_get_report_page_before_customer_contact(
      p_store_id, p_report, p_start_at, p_end_at, p_amount_over, p_item_type,
      p_species, p_breed, p_search, p_include_imported, p_offset, p_limit
    );
  end if;

  if p_store_id is null then raise exception 'store_required' using errcode = '22023'; end if;
  if not public.owns_store(p_store_id) and not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  select exists (
    select 1 from public.orders where store_id = p_store_id and order_status <> 'canceled'
  ) or exists (
    select 1 from public.customers where store_id = p_store_id
      and (imported_order_count > 0 or imported_order_total_cents > 0)
  ) into v_has_any_data;

  return (
    with date_orders as materialized (
      select order_management.*
      from public.seller_order_management as order_management
      where order_management.store_id = p_store_id
        and order_management.order_status <> 'canceled'
        and (p_start_at is null or order_management.created_at >= p_start_at)
        and (p_end_at is null or order_management.created_at <= p_end_at)
    ),
    filtered as materialized (
      select * from date_orders where p_amount_over is null or total_amount > p_amount_over
    ),
    page as (
      select * from filtered order by created_at desc, order_id desc offset v_offset limit v_limit
    ),
    page_rows as (
      select jsonb_build_object(
        'order_id', p.order_id,
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
      p.order_id
      from page p
      left join lateral (
        select count(*) as item_count,
          coalesce(sum(f.quantity), 0) as total_item_quantity,
          string_agg(case when coalesce(f.quantity, 0) > 0 then f.quantity::text || ' ' || f.item_name else f.item_name end, '; ' order by f.created_at, f.order_item_id) as item_summary
        from public.seller_report_order_item_facts f
        where f.store_id = p_store_id and f.order_id = p.order_id
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
      'rows', coalesce((select jsonb_agg(row_data order by created_at desc, order_id desc) from page_rows), '[]'::jsonb),
      'options', '{}'::jsonb
    )
  );
end;
$$;

comment on function public.seller_get_report_page(uuid, text, timestamptz, timestamptz, numeric, text, text, text, text, boolean, integer, integer) is
'Returns seller reports. Sales rows resolve active-order contact information through the current linked customer, while terminal orders retain their frozen contact snapshot.';

revoke all on function public.seller_get_report_page(uuid, text, timestamptz, timestamptz, numeric, text, text, text, text, boolean, integer, integer) from public;
grant execute on function public.seller_get_report_page(uuid, text, timestamptz, timestamptz, numeric, text, text, text, text, boolean, integer, integer) to authenticated;
