begin;

select plan(15);

select has_column('public', 'stores', 'pay_at_pickup_enabled', 'stores has Pay at Pickup setting');
select has_column('public', 'stores', 'card_payments_enabled', 'stores has card setting');
select col_not_null('public', 'stores', 'pay_at_pickup_enabled', 'Pay at Pickup setting is required');
select col_not_null('public', 'stores', 'card_payments_enabled', 'card setting is required');
select col_default_is('public', 'stores', 'pay_at_pickup_enabled', 'true', 'existing stores retain Pay at Pickup by default');
select col_default_is('public', 'stores', 'card_payments_enabled', 'false', 'existing stores do not infer card enablement');
select has_function('public', 'seller_get_payment_methods', array['uuid'], 'seller payment settings reader exists');
select has_function('public', 'seller_update_payment_methods', array['uuid','boolean','boolean'], 'seller payment settings writer exists');
select has_function('public', 'get_public_store_payment_methods', array['text'], 'public payment settings reader exists');

select is(
  has_function_privilege('anon', 'public.seller_update_payment_methods(uuid,boolean,boolean)', 'EXECUTE'),
  false,
  'anonymous buyers cannot update seller payment settings'
);

set local "request.jwt.claim.role" = 'service_role';

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  'ea000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'payment-method-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'ea000000-0000-4000-8000-000000000010',
  'ea000000-0000-4000-8000-000000000001',
  'Payment Method Test Store', 'payment-method-test-store', 'live',
  'hosted', true
);

select is(
  (select pay_at_pickup_enabled from public.stores where id = 'ea000000-0000-4000-8000-000000000010'),
  true,
  'a newly created store starts with Pay at Pickup enabled'
);

select is(
  (select card_payments_enabled from public.stores where id = 'ea000000-0000-4000-8000-000000000010'),
  false,
  'a newly created store starts with card payments disabled'
);

select lives_ok(
  $$update public.stores
    set pay_at_pickup_enabled = true, card_payments_enabled = true
    where id = 'ea000000-0000-4000-8000-000000000010'$$,
  'both payment methods can be enabled'
);

select throws_ok(
  $$update public.stores
    set pay_at_pickup_enabled = false, card_payments_enabled = false
    where id = 'ea000000-0000-4000-8000-000000000010'$$,
  '23514',
  'new row for relation "stores" violates check constraint "stores_payment_method_required_check"',
  'the database rejects disabling both payment methods'
);

select set_config(
  'request.jwt.claim.sub',
  'ea000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$select * from public.seller_update_payment_methods(
    'ea000000-0000-4000-8000-000000000010', false, true
  )$$,
  'the seller can save a card-only configuration'
);

select * from finish();
rollback;
