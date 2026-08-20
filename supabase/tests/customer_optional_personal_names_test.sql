begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  'a9000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'optional-names-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', ''
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode
)
values (
  'a9000000-0000-4000-8000-000000000010',
  'a9000000-0000-4000-8000-000000000001',
  'Optional Names Store', 'optional-names-store', 'live', 'hosted'
);

insert into public.customers (id, store_id, email)
values (
  'a9000000-0000-4000-8000-000000000101',
  'a9000000-0000-4000-8000-000000000010', 'email-only@example.test'
);
select ok(true, 'email-only customer can be created');

insert into public.customers (id, store_id, phone)
values (
  'a9000000-0000-4000-8000-000000000102',
  'a9000000-0000-4000-8000-000000000010', '+1 (970) 555-0102'
);
select ok(true, 'phone-only customer can be created');

insert into public.customers (id, store_id, business_name)
values (
  'a9000000-0000-4000-8000-000000000103',
  'a9000000-0000-4000-8000-000000000010', 'Business Only Farm'
);
select ok(true, 'business-name-only customer can be created');

insert into public.customers (id, store_id, last_name)
values (
  'a9000000-0000-4000-8000-000000000104',
  'a9000000-0000-4000-8000-000000000010', 'Solo'
);
select ok(true, 'last-name-only customer can be created');

insert into public.customers (id, store_id, first_name, last_name)
values (
  'a9000000-0000-4000-8000-000000000105',
  'a9000000-0000-4000-8000-000000000010', 'Ada', 'Lovelace'
);
select ok(true, 'named customer can still be created');

select throws_ok(
  $$insert into public.customers (store_id) values ('a9000000-0000-4000-8000-000000000010')$$,
  '23514',
  'new row for relation "customers" violates check constraint "customers_meaningful_identifier_check"',
  'completely blank customer is rejected'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);

select is(
  (public.seller_update_customer(
    'a9000000-0000-4000-8000-000000000101',
    '{"first_name": null}'::jsonb
  )).email,
  'email-only@example.test',
  'customer update RPC permits a missing first name when email remains'
);

select throws_ok(
  $$select public.seller_update_customer('a9000000-0000-4000-8000-000000000101', '{"email": null}'::jsonb)$$,
  '23514',
  'new row for relation "customers" violates check constraint "customers_meaningful_identifier_check"',
  'customer update RPC rejects removing the final identifier'
);

select is(
  (select count(*)::integer from public.seller_find_possible_customer_duplicates(
    'a9000000-0000-4000-8000-000000000010', 'EMAIL-ONLY@example.test', null, null
  )),
  1,
  'email-only customer remains discoverable by normalized email'
);

select is(
  (select count(*)::integer from public.seller_find_possible_customer_duplicates(
    'a9000000-0000-4000-8000-000000000010', null, '970.555.0102', null
  )),
  1,
  'phone-only customer remains discoverable by normalized phone'
);

select * from finish();

rollback;
