begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    'c7000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'delete-owner-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'c7000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'delete-owner-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode
)
values
  (
    'c7000000-0000-4000-8000-000000000010',
    'c7000000-0000-4000-8000-000000000001',
    'Delete Customer Store A', 'delete-customer-store-a', 'live', 'hosted'
  ),
  (
    'c7000000-0000-4000-8000-000000000020',
    'c7000000-0000-4000-8000-000000000002',
    'Delete Customer Store B', 'delete-customer-store-b', 'live', 'hosted'
  );

insert into public.seller_billing_status (
  store_id,
  requested_plan_key,
  requested_billing_cadence,
  plan_key,
  billing_plan,
  subscription_status,
  trial_started_at,
  trial_ends_at,
  current_period_start,
  current_period_end,
  storefront_access_until,
  billing_state_authority
)
values
  (
    'c7000000-0000-4000-8000-000000000010',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  ),
  (
    'c7000000-0000-4000-8000-000000000020',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  );

insert into public.customers (
  id, store_id, first_name, last_name, email, phone,
  delivery_address_line1, delivery_city, delivery_state,
  delivery_postal_code, delivery_country, internal_notes
)
values
  ('c7000000-0000-4000-8000-000000000101', 'c7000000-0000-4000-8000-000000000010', 'Zero', 'Orders', 'zero@example.test', '970-555-0101', '101 Zero Lane', 'Hotchkiss', 'CO', '81419', 'US', 'Delete with customer'),
  ('c7000000-0000-4000-8000-000000000102', 'c7000000-0000-4000-8000-000000000010', 'One', 'Order', 'one@example.test', null, null, null, null, null, null, null),
  ('c7000000-0000-4000-8000-000000000103', 'c7000000-0000-4000-8000-000000000010', 'Multiple', 'Orders', 'multiple@example.test', null, null, null, null, null, null, null),
  ('c7000000-0000-4000-8000-000000000104', 'c7000000-0000-4000-8000-000000000010', 'Canceled', 'Order', 'canceled@example.test', null, null, null, null, null, null, null),
  ('c7000000-0000-4000-8000-000000000105', 'c7000000-0000-4000-8000-000000000010', 'Fulfilled', 'Order', 'fulfilled@example.test', null, null, null, null, null, null, null),
  ('c7000000-0000-4000-8000-000000000106', 'c7000000-0000-4000-8000-000000000010', 'Archived', 'Order', 'archived@example.test', null, null, null, null, null, null, null),
  ('c7000000-0000-4000-8000-000000000107', 'c7000000-0000-4000-8000-000000000010', 'Stale', 'Page', 'stale@example.test', null, null, null, null, null, null, null),
  ('c7000000-0000-4000-8000-000000000201', 'c7000000-0000-4000-8000-000000000020', 'Other', 'Seller', 'other@example.test', null, null, null, null, null, null, null);

insert into public.customer_timeline_notes (
  id, store_id, customer_id, note_date, title, body
)
values (
  'c7000000-0000-4000-8000-000000000301',
  'c7000000-0000-4000-8000-000000000010',
  'c7000000-0000-4000-8000-000000000101',
  current_date, 'Private note', 'Removed with the customer'
);

insert into public.orders (
  id, store_id, customer_id, order_number, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot,
  subtotal_amount, total_amount, canceled_at, fulfilled_at, archived_at
)
values
  ('c7000000-0000-4000-8000-000000001001', 'c7000000-0000-4000-8000-000000000010', 'c7000000-0000-4000-8000-000000000102', 'DEL-ONE', 'pending', 'pay_at_pickup', 'unpaid', 'one@example.test', 'One', 'Order', 12, 12, null, null, null),
  ('c7000000-0000-4000-8000-000000001002', 'c7000000-0000-4000-8000-000000000010', 'c7000000-0000-4000-8000-000000000103', 'DEL-MULTI-1', 'pending', 'pay_at_pickup', 'pay_at_pickup', 'multiple@example.test', 'Multiple', 'Orders', 5, 5, null, null, null),
  ('c7000000-0000-4000-8000-000000001003', 'c7000000-0000-4000-8000-000000000010', 'c7000000-0000-4000-8000-000000000103', 'DEL-MULTI-2', 'open', 'pay_at_pickup', 'paid', 'multiple@example.test', 'Multiple', 'Orders', 6, 6, null, null, null),
  ('c7000000-0000-4000-8000-000000001004', 'c7000000-0000-4000-8000-000000000010', 'c7000000-0000-4000-8000-000000000104', 'DEL-CANCELED', 'canceled', 'pay_at_pickup', 'canceled', 'canceled@example.test', 'Canceled', 'Order', 7, 7, now(), null, null),
  ('c7000000-0000-4000-8000-000000001005', 'c7000000-0000-4000-8000-000000000010', 'c7000000-0000-4000-8000-000000000105', 'DEL-FULFILLED', 'fulfilled', 'pay_at_pickup', 'paid', 'fulfilled@example.test', 'Fulfilled', 'Order', 8, 8, null, now(), null),
  ('c7000000-0000-4000-8000-000000001006', 'c7000000-0000-4000-8000-000000000010', 'c7000000-0000-4000-8000-000000000106', 'DEL-ARCHIVED', 'pending', 'pay_at_pickup', 'pay_at_pickup', 'archived@example.test', 'Archived', 'Order', 9, 9, null, null, now());

insert into public.order_items (
  id, order_id, store_id, species_name_snapshot, species_slug_snapshot,
  breed_display_name_snapshot, inventory_type_snapshot, batch_type_snapshot,
  unit_price_snapshot, quantity, line_subtotal, order_item_source,
  custom_item_name_snapshot, product_type_snapshot, item_name_snapshot,
  item_category_snapshot, inventory_debited_quantity
)
values (
  'c7000000-0000-4000-8000-000000002001',
  'c7000000-0000-4000-8000-000000001001',
  'c7000000-0000-4000-8000-000000000010',
  'Custom', 'custom', 'Custom item', 'other', 'custom', 12, 1, 12,
  'custom', 'Order history fixture', 'custom', 'Order history fixture',
  'Custom', 0
);

insert into public.order_events (
  id, store_id, order_id, actor_user_id, actor_type, event_type, note
)
values (
  'c7000000-0000-4000-8000-000000003001',
  'c7000000-0000-4000-8000-000000000010',
  'c7000000-0000-4000-8000-000000001001',
  'c7000000-0000-4000-8000-000000000001',
  'seller', 'payment_marked_paid', 'History fixture remains intact'
);

select has_function(
  'public', 'seller_delete_customer', array['uuid'],
  'seller delete RPC exists'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'public.seller_delete_customer(uuid)'::regprocedure
  ),
  'seller delete RPC is security definer'
);

select ok(
  has_function_privilege('authenticated', 'public.seller_delete_customer(uuid)', 'execute'),
  'authenticated callers can execute the seller delete RPC'
);

select ok(
  not has_function_privilege('anon', 'public.seller_delete_customer(uuid)', 'execute'),
  'anonymous callers do not have execute permission'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);

select is(
  public.seller_delete_customer('c7000000-0000-4000-8000-000000000101'),
  'c7000000-0000-4000-8000-000000000101'::uuid,
  'owner can delete an owned zero-order customer'
);

select is((select count(*) from public.customers where id = 'c7000000-0000-4000-8000-000000000101'), 0::bigint, 'customer row is gone');
select is((select count(*) from public.customer_timeline_notes where customer_id = 'c7000000-0000-4000-8000-000000000101'), 0::bigint, 'customer timeline notes cascade away');
select is((select count(*) from public.customers where email = 'zero@example.test' and delivery_address_line1 = '101 Zero Lane' and internal_notes = 'Delete with customer'), 0::bigint, 'customer contact, address, and internal-note data disappear with the row');

select throws_ok($$select public.seller_delete_customer('c7000000-0000-4000-8000-000000000102')$$, 'P0001', 'CUSTOMER_HAS_ORDER_HISTORY', 'one unpaid order blocks deletion');
select is((select count(*) from public.customers where id = 'c7000000-0000-4000-8000-000000000102'), 1::bigint, 'blocked customer remains');
select is((select count(*) from public.orders where customer_id = 'c7000000-0000-4000-8000-000000000102'), 1::bigint, 'blocked customer order remains');

select throws_ok($$select public.seller_delete_customer('c7000000-0000-4000-8000-000000000103')$$, 'P0001', 'CUSTOMER_HAS_ORDER_HISTORY', 'multiple orders block deletion');
select is((select count(*) from public.orders where customer_id = 'c7000000-0000-4000-8000-000000000103'), 2::bigint, 'multiple orders remain unchanged');
select throws_ok($$select public.seller_delete_customer('c7000000-0000-4000-8000-000000000104')$$, 'P0001', 'CUSTOMER_HAS_ORDER_HISTORY', 'canceled order blocks deletion');
select throws_ok($$select public.seller_delete_customer('c7000000-0000-4000-8000-000000000105')$$, 'P0001', 'CUSTOMER_HAS_ORDER_HISTORY', 'fulfilled order blocks deletion');
select throws_ok($$select public.seller_delete_customer('c7000000-0000-4000-8000-000000000106')$$, 'P0001', 'CUSTOMER_HAS_ORDER_HISTORY', 'archived order blocks deletion');

select throws_ok($$select public.seller_delete_customer('c7000000-0000-4000-8000-000000000201')$$, '42501', 'CUSTOMER_NOT_FOUND_OR_NOT_AUTHORIZED', 'seller cannot delete another seller customer');
select is((select count(*) from public.customers where id = 'c7000000-0000-4000-8000-000000000201'), 1::bigint, 'other seller customer remains');
select throws_ok($$select public.seller_delete_customer('c7000000-0000-4000-8000-000000009999')$$, '42501', 'CUSTOMER_NOT_FOUND_OR_NOT_AUTHORIZED', 'nonexistent customer fails without a distinct existence disclosure');

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok($$select public.seller_delete_customer('c7000000-0000-4000-8000-000000000107')$$, '42501', 'AUTHENTICATION_REQUIRED', 'anonymous caller is rejected');

select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.orders (
  id, store_id, customer_id, order_number, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot, subtotal_amount, total_amount
)
values (
  'c7000000-0000-4000-8000-000000001007',
  'c7000000-0000-4000-8000-000000000010',
  'c7000000-0000-4000-8000-000000000107',
  'DEL-STALE', 'pending', 'pay_at_pickup', 'pay_at_pickup',
  'stale@example.test', 'Stale', 'Page', 10, 10
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
select throws_ok($$select public.seller_delete_customer('c7000000-0000-4000-8000-000000000107')$$, 'P0001', 'CUSTOMER_HAS_ORDER_HISTORY', 'an order added after initial UI eligibility blocks deletion at execution time');
select is((select count(*) from public.customers where id = 'c7000000-0000-4000-8000-000000000107'), 1::bigint, 'stale-state customer remains');
select is((select count(*) from public.orders where id = 'c7000000-0000-4000-8000-000000001007'), 1::bigint, 'stale-state order remains');
select is((select count(*) from public.order_items where id = 'c7000000-0000-4000-8000-000000002001'), 1::bigint, 'order items remain after blocked deletion');
select is((select count(*) from public.order_events where id = 'c7000000-0000-4000-8000-000000003001'), 1::bigint, 'order event history remains after blocked deletion');

select is(
  (
    select confdeltype::text
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and confrelid = 'public.customers'::regclass
      and contype = 'f'
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.orders'::regclass and attname = 'customer_id')
      ]::smallint[]
  ),
  'a',
  'orders customer foreign key remains NO ACTION and never cascades'
);

select throws_ok(
  $$delete from public.customers where id = 'c7000000-0000-4000-8000-000000000102'$$,
  '23503',
  null,
  'restrictive foreign key independently blocks direct customer deletion with order history'
);

select * from finish();

rollback;
