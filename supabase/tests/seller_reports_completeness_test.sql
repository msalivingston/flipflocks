begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'eb000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'report-owner-a@example.test', '',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  ),
  (
    'eb000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'report-owner-b@example.test', '',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
)
values
  (
    'eb000000-0000-4000-8000-000000000010',
    'eb000000-0000-4000-8000-000000000001',
    'Complete Report Store', 'complete-report-store', 'live', 'hosted', true
  ),
  (
    'eb000000-0000-4000-8000-000000000020',
    'eb000000-0000-4000-8000-000000000002',
    'Private Report Store', 'private-report-store', 'live', 'hosted', true
  ),
  (
    'eb000000-0000-4000-8000-000000000030',
    'eb000000-0000-4000-8000-000000000001',
    'Empty Report Store', 'empty-report-store', 'live', 'hosted', true
  );

create temporary table report_test_customers as
select series, gen_random_uuid() as id
from generate_series(1, 1005) series;

insert into public.customers (id, store_id, email, first_name, last_name)
select
  id,
  'eb000000-0000-4000-8000-000000000010',
  'report-customer-' || series || '@example.test',
  'Report',
  'Customer ' || series
from report_test_customers;

insert into public.customers (
  id, store_id, email, first_name, last_name,
  imported_order_count, imported_order_total_cents, imported_source
)
values (
  'eb000000-0000-4000-8000-000000000011',
  'eb000000-0000-4000-8000-000000000010',
  'imported-only@example.test', 'Imported', 'Only', 7, 12345, 'legacy_test'
);

create temporary table report_test_orders as
select customers.series, customers.id as customer_id, gen_random_uuid() as id
from report_test_customers customers;

insert into public.orders (
  id, store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot, subtotal_amount,
  total_amount, fulfilled_at, created_at
)
select
  id,
  'eb000000-0000-4000-8000-000000000010',
  customer_id,
  'REPORT-' || lpad(series::text, 5, '0'),
  'seller_created', 'fulfilled', 'pay_at_pickup', 'pay_at_pickup',
  'report-customer-' || series || '@example.test',
  'Report', 'Customer ' || series, 20, 20,
  case when series <= 5
    then timestamptz '2024-06-01 12:00:00+00' + series * interval '1 minute'
    else timestamptz '2026-06-01 12:00:00+00' + series * interval '1 minute'
  end,
  case when series <= 5
    then timestamptz '2024-06-01 12:00:00+00' + series * interval '1 minute'
    else timestamptz '2026-06-01 12:00:00+00' + series * interval '1 minute'
  end
from report_test_orders;

insert into public.order_items (
  order_id, store_id, species_name_snapshot, species_slug_snapshot,
  breed_display_name_snapshot, inventory_type_snapshot, batch_type_snapshot,
  unit_price_snapshot, quantity, line_subtotal, order_item_source,
  custom_item_name_snapshot, item_name_snapshot
)
select
  orders.id,
  'eb000000-0000-4000-8000-000000000010',
  'Chicken', 'chicken', 'Report Breed', 'other', 'live_animals',
  5, 2, 10, 'custom',
  case when item_number = 1 then 'Report Item A' else 'Report Item B' end,
  case when item_number = 1 then 'Report Item A' else 'Report Item B' end
from report_test_orders orders
cross join generate_series(1, 2) item_number;

insert into public.customers (id, store_id, email, first_name, last_name)
values (
  'eb000000-0000-4000-8000-000000000021',
  'eb000000-0000-4000-8000-000000000020',
  'private-report-customer@example.test', 'Private', 'Customer'
);

insert into public.orders (
  store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot, subtotal_amount,
  total_amount, fulfilled_at
)
values (
  'eb000000-0000-4000-8000-000000000020',
  'eb000000-0000-4000-8000-000000000021',
  'PRIVATE-REPORT', 'seller_created', 'fulfilled', 'pay_at_pickup',
  'pay_at_pickup', 'private-report-customer@example.test', 'Private',
  'Customer', 9, 9, now()
);

select set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'sales',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  ) #>> '{summary,order_count}')::integer,
  1005,
  'sales count includes more than the former 1,000-order cap'
);

select is(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'sales',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  ) #>> '{summary,total_sales}')::numeric,
  20100::numeric,
  'sales total uses every matching order'
);

select is(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'sales',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  ) #>> '{summary,average_order_value}')::numeric,
  20::numeric,
  'average order value uses the complete matching population'
);

select is(
  jsonb_array_length(public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'sales',
    null, null, null, 'all', 'all', 'all', null, false, 1000, 500
  ) -> 'rows'),
  5,
  'bounded export pagination reaches records after row 1,000'
);

select ok(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'sales',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  ) #>> '{rows,0,order_number}') is not null,
  'sales rows expose the snake-case order_number field mapped by the client'
);

select is(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'sales',
    '2024-01-01 00:00:00+00', '2024-12-31 23:59:59+00',
    null, 'all', 'all', 'all', null, false, 0, 50
  ) #>> '{summary,order_count}')::integer,
  5,
  'date filtering finds older records beyond the former snapshot'
);

select is(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'items',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  ) #>> '{summary,quantity_sold}')::integer,
  4020,
  'item quantity includes more than the former 2,000-item cap'
);

select is(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'items',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  ) #>> '{summary,item_revenue}')::numeric,
  20100::numeric,
  'item revenue includes every matching line item'
);

select is(
  public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'items',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  ) #>> '{rows,0,item_type}',
  'Custom / Other',
  'item report rows expose the snake-case item_type field mapped by the client'
);

select ok(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'items',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  ) #>> '{rows,0,item}') is not null,
  'item report rows always expose a non-null item identity field'
);

select is(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'customers',
    null, null, null, 'all', 'all', 'all', null, true, 0, 50
  ) ->> 'total_count')::integer,
  1006,
  'all-time customer reporting represents more than 1,000 customers'
);

select is(
  public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'customers',
    null, null, null, 'all', 'all', 'all', 'imported-only@example.test', true, 0, 50
  ) #>> '{rows,0,orders}',
  '7',
  'an imported-only customer appears with clearly separate all-time history'
);

select ok(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'customers',
    null, null, null, 'all', 'all', 'all', null, true, 0, 50
  ) #>> '{rows,0,customer_id}') is not null,
  'customer rows expose the snake-case customer_id field mapped by the client'
);

select is(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000010', 'customers',
    '2026-01-01 00:00:00+00', '2026-12-31 23:59:59+00',
    null, 'all', 'all', 'all', 'imported-only@example.test', false, 0, 50
  ) ->> 'total_count')::integer,
  0,
  'imported lifetime history is not injected into a dated report'
);

select throws_ok(
  $$select public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000020', 'sales',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  )$$,
  '42501',
  'forbidden',
  'Seller A cannot retrieve Seller B report data'
);

select set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000002', true);

select is(
  (public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000020', 'sales',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  ) #>> '{summary,order_count}')::integer,
  1,
  'a normal-size seller report still returns its complete result'
);

select set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000001', true);

select is(
  public.seller_get_report_page(
    'eb000000-0000-4000-8000-000000000030', 'sales',
    null, null, null, 'all', 'all', 'all', null, false, 0, 50
  ) ->> 'has_any_data',
  'false',
  'empty report stores retain the empty state'
);

select * from finish();
rollback;
