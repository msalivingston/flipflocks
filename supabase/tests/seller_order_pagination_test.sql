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
    'ea000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'order-page-owner-a@example.test', '',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  ),
  (
    'ea000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'order-page-owner-b@example.test', '',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
)
values
  (
    'ea000000-0000-4000-8000-000000000010',
    'ea000000-0000-4000-8000-000000000001',
    'Order Page Store A', 'order-page-store-a', 'live', 'hosted', true
  ),
  (
    'ea000000-0000-4000-8000-000000000020',
    'ea000000-0000-4000-8000-000000000002',
    'Order Page Store B', 'order-page-store-b', 'live', 'hosted', true
  );

insert into public.customers (
  id, store_id, email, first_name, last_name
)
values
  (
    'ea000000-0000-4000-8000-000000000011',
    'ea000000-0000-4000-8000-000000000010',
    'orders-a@example.test', 'Seller', 'A Customer'
  ),
  (
    'ea000000-0000-4000-8000-000000000021',
    'ea000000-0000-4000-8000-000000000020',
    'orders-b@example.test', 'Seller', 'B Customer'
  );

insert into public.store_pickup_options (id, store_id, label)
values (
  'ea000000-0000-4000-8000-000000000012',
  'ea000000-0000-4000-8000-000000000010',
  'Saturday pickup'
);

insert into public.orders (
  store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot, subtotal_amount,
  total_amount, fulfilled_at, canceled_at, pickup_option_id,
  pickup_option_label_snapshot, created_at
)
select
  'ea000000-0000-4000-8000-000000000010'::uuid,
  'ea000000-0000-4000-8000-000000000011'::uuid,
  'ORD-' || lpad(series::text, 4, '0'),
  'seller_created',
  case
    when series between 71 and 110 then 'fulfilled'
    when series between 111 and 120 then 'canceled'
    else 'pending'
  end,
  'pay_at_pickup',
  'pay_at_pickup',
  'orders-a@example.test',
  case when series = 1 then 'Oldest Searchable' else 'Seller' end,
  'A Customer',
  series::numeric,
  series::numeric,
  case when series between 71 and 110 then timestamptz '2026-01-01 00:00:00+00' + series * interval '1 minute' end,
  case when series between 111 and 120 then timestamptz '2026-01-01 00:00:00+00' + series * interval '1 minute' end,
  case when series % 3 = 0 then 'ea000000-0000-4000-8000-000000000012'::uuid end,
  case when series % 3 = 0 then 'Saturday pickup' end,
  timestamptz '2026-01-01 00:00:00+00' + series * interval '1 minute'
from generate_series(1, 130) as series;

update public.orders
set archived_at = now()
where store_id = 'ea000000-0000-4000-8000-000000000010'
  and order_number in ('ORD-0126', 'ORD-0127', 'ORD-0128', 'ORD-0129', 'ORD-0130');

insert into public.orders (
  store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot
)
values (
  'ea000000-0000-4000-8000-000000000020',
  'ea000000-0000-4000-8000-000000000021',
  'PRIVATE-B-ORDER', 'seller_created', 'pending', 'pay_at_pickup',
  'pay_at_pickup', 'orders-b@example.test', 'Seller', 'B Customer'
);

select set_config(
  'request.jwt.claim.sub',
  'ea000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  jsonb_array_length(public.seller_get_order_list_page(
    'ea000000-0000-4000-8000-000000000010', 'active', 'all', null,
    null, 'newest', 100, 50
  ) -> 'orders'),
  25,
  'the third page reaches active orders beyond the former 100-order cap'
);

select is(
  public.seller_get_order_list_page(
    'ea000000-0000-4000-8000-000000000010', 'active', 'all', null,
    'ORD-0001', 'newest', 0, 50
  ) #>> '{orders,0,order_number}',
  'ORD-0001',
  'global search finds the oldest order outside the first page'
);

select is(
  (public.seller_get_order_list_page(
    'ea000000-0000-4000-8000-000000000010', 'active', 'all',
    'ea000000-0000-4000-8000-000000000012', null, 'newest', 0, 50
  ) ->> 'total_count')::integer,
  41,
  'pickup filtering counts all matching active orders before pagination'
);

select is(
  (public.seller_get_order_list_page(
    'ea000000-0000-4000-8000-000000000010', 'active',
    'ready_for_pickup', null, null, 'newest', 0, 50
  ) ->> 'total_count')::integer,
  75,
  'status filtering includes matches beyond the first page'
);

select ok(
  (
    public.seller_get_order_list_page(
      'ea000000-0000-4000-8000-000000000010', 'active', 'all', null,
      null, 'oldest', 0, 50
    ) #>> '{orders,49,created_at}'
  )::timestamptz < (
    public.seller_get_order_list_page(
      'ea000000-0000-4000-8000-000000000010', 'active', 'all', null,
      null, 'oldest', 50, 50
    ) #>> '{orders,0,created_at}'
  )::timestamptz,
  'global sorting remains ordered across page boundaries'
);

select is(
  (public.seller_get_order_list_page(
    'ea000000-0000-4000-8000-000000000010', 'active', 'all', null,
    null, 'newest', 0, 50
  ) #>> '{counts,active}')::integer,
  125,
  'display counts come from the complete store dataset'
);

select is(
  (public.seller_get_order_list_page(
    'ea000000-0000-4000-8000-000000000010', 'archived', 'all', null,
    null, 'newest', 0, 50
  ) ->> 'total_count')::integer,
  5,
  'archived orders remain separately reachable'
);

select is(
  jsonb_array_length(public.seller_get_orders_for_print(
    'ea000000-0000-4000-8000-000000000010',
    array(
      select orders.id
      from public.orders
      where orders.store_id = 'ea000000-0000-4000-8000-000000000010'
        and orders.archived_at is null
      order by orders.created_at
    )
  ) -> 'orders'),
  125,
  'an explicit multi-page print set is not truncated at 100 orders'
);

select throws_ok(
  $$select public.seller_get_order_list_page(
    'ea000000-0000-4000-8000-000000000020', 'active', 'all', null,
    null, 'newest', 0, 50
  )$$,
  '42501',
  'forbidden',
  'Seller A cannot retrieve Seller B orders'
);

select throws_ok(
  $$select public.seller_get_orders_for_print(
    'ea000000-0000-4000-8000-000000000020',
    array(select id from public.orders where store_id = 'ea000000-0000-4000-8000-000000000020')
  )$$,
  '42501',
  'forbidden',
  'Seller A cannot print Seller B orders'
);

select * from finish();
rollback;
