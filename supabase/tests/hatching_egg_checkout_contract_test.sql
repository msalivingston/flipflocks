begin;

create extension if not exists pgtap with schema extensions;

select plan(20);
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
values (
  'd2000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'hatching-contract-owner@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

insert into public.stores (
  id,
  owner_user_id,
  store_name,
  store_slug,
  store_status,
  storefront_mode,
  storefront_enabled
)
values (
  'd2000000-0000-4000-8000-000000000010',
  'd2000000-0000-4000-8000-000000000001',
  'Hatching Contract Store',
  'hatching-contract-store',
  'live',
  'hosted',
  true
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
values (
  'd2000000-0000-4000-8000-000000000010',
  'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
  statement_timestamp(), statement_timestamp() + interval '7 days',
  statement_timestamp(), statement_timestamp() + interval '7 days',
  statement_timestamp() + interval '7 days', 'trial'
);

update public.stores
set hatching_eggs_enabled = true
where id = 'd2000000-0000-4000-8000-000000000010';

insert into public.species (
  id,
  common_name,
  slug,
  is_active
)
values (
  'd2000000-0000-4000-8000-000000000020',
  'Inactive Test Bird',
  'inactive-test-bird',
  false
);

with chicken as (
  select species.id
  from public.species
  where species.slug = 'chicken'
)
insert into public.hatching_egg_inventory_items (
  id,
  store_id,
  item_name,
  species_id,
  quantity_available,
  price,
  available_date,
  minimum_order_quantity,
  visibility_status,
  moderation_status,
  archived_at
)
select
  fixtures.id,
  'd2000000-0000-4000-8000-000000000010',
  fixtures.item_name,
  chicken.id,
  fixtures.quantity_available,
  5.00,
  fixtures.available_date,
  fixtures.minimum_order_quantity,
  fixtures.visibility_status,
  fixtures.moderation_status,
  fixtures.archived_at
from chicken
cross join (
  values
    ('d2000000-0000-4000-8000-000000000101'::uuid, 'Below Minimum Eggs', 5, 6, 'active', 'normal', current_date, null::timestamptz),
    ('d2000000-0000-4000-8000-000000000102'::uuid, 'Exact Minimum Eggs', 6, 6, 'active', 'normal', current_date, null::timestamptz),
    ('d2000000-0000-4000-8000-000000000103'::uuid, 'Above Minimum Eggs', 7, 6, 'active', 'normal', current_date, null::timestamptz),
    ('d2000000-0000-4000-8000-000000000104'::uuid, 'Zero Quantity Eggs', 0, 6, 'active', 'normal', current_date, null::timestamptz),
    ('d2000000-0000-4000-8000-000000000105'::uuid, 'Sold Out Eggs', 6, 6, 'sold_out', 'normal', current_date, null::timestamptz),
    ('d2000000-0000-4000-8000-000000000106'::uuid, 'Hidden Eggs', 6, 6, 'hidden', 'normal', current_date, null::timestamptz),
    ('d2000000-0000-4000-8000-000000000107'::uuid, 'Archived Eggs', 6, 6, 'archived', 'normal', current_date, now()),
    ('d2000000-0000-4000-8000-000000000108'::uuid, 'Archived Timestamp Eggs', 6, 6, 'active', 'normal', current_date, now()),
    ('d2000000-0000-4000-8000-000000000109'::uuid, 'Future Reservable Eggs', 6, 6, 'active', 'normal', current_date + 30, null::timestamptz),
    ('d2000000-0000-4000-8000-000000000110'::uuid, 'Future Below Minimum Eggs', 5, 6, 'active', 'normal', current_date + 30, null::timestamptz),
    ('d2000000-0000-4000-8000-000000000111'::uuid, 'Flagged Eggs', 6, 6, 'active', 'flagged', current_date, null::timestamptz)
) as fixtures(
  id,
  item_name,
  quantity_available,
  minimum_order_quantity,
  visibility_status,
  moderation_status,
  available_date,
  archived_at
);

insert into public.hatching_egg_inventory_items (
  id,
  store_id,
  item_name,
  species_id,
  quantity_available,
  price,
  available_date,
  minimum_order_quantity,
  visibility_status,
  moderation_status
)
values (
  'd2000000-0000-4000-8000-000000000112',
  'd2000000-0000-4000-8000-000000000010',
  'Inactive Species Eggs',
  'd2000000-0000-4000-8000-000000000020',
  6,
  5.00,
  current_date,
  6,
  'active',
  'normal'
);

create function pg_temp.test_hatching_checkout(
  p_key text,
  p_item_id uuid,
  p_quantity integer
)
returns uuid
language plpgsql
as $function$
declare
  v_order_id uuid;
begin
  select checkout.order_id
  into v_order_id
  from public.create_pay_at_pickup_order_v2(
    p_store_id => 'd2000000-0000-4000-8000-000000000010',
    p_idempotency_key => p_key,
    p_buyer_email => p_key || '@example.test',
    p_buyer_first_name => 'Hatching',
    p_buyer_last_name => 'Buyer',
    p_items => jsonb_build_array(
      jsonb_build_object(
        'item_type', 'hatching_egg_inventory',
        'item_id', p_item_id,
        'quantity', p_quantity
      )
    ),
    p_buyer_phone => '555-0110',
    p_delivery_address_line1 => '10 Test Lane',
    p_delivery_city => 'Testville',
    p_delivery_state => 'CO',
    p_delivery_postal_code => '80000'
  ) as checkout;

  drop table if exists pg_temp.requested_order_items;
  drop table if exists pg_temp.locked_order_items;
  return v_order_id;
exception
  when others then
    drop table if exists pg_temp.requested_order_items;
    drop table if exists pg_temp.locked_order_items;
    raise;
end;
$function$;

select set_config(
  'request.jwt.claim.sub',
  'd2000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select can_checkout from public.public_storefront_hatching_egg_inventory where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000101'),
  false,
  'positive stock below the minimum order is not row-level purchasable'
);

select is(
  (select can_checkout from public.public_storefront_hatching_egg_inventory where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000102'),
  true,
  'stock exactly equal to the minimum order is row-level purchasable'
);

select is(
  (select can_checkout from public.public_storefront_hatching_egg_inventory where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000103'),
  true,
  'stock above the minimum order is row-level purchasable'
);

select is(
  coalesce((select can_checkout from public.public_storefront_hatching_egg_inventory where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000104'), false),
  false,
  'zero-quantity inventory is excluded and therefore not purchasable'
);

select is(
  coalesce((select can_checkout from public.public_storefront_hatching_egg_inventory where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000105'), false),
  false,
  'sold-out inventory is excluded and therefore not purchasable'
);

select is(
  coalesce((select can_checkout from public.public_storefront_hatching_egg_inventory where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000106'), false),
  false,
  'hidden inventory is excluded and therefore not purchasable'
);

select is(
  coalesce((select can_checkout from public.public_storefront_hatching_egg_inventory where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000107'), false),
  false,
  'archived inventory is excluded and therefore not purchasable'
);

select is(
  coalesce((select can_checkout from public.public_storefront_hatching_egg_inventory where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000108'), false),
  false,
  'an archived timestamp prevents an inconsistent active row from being purchasable'
);

select is(
  coalesce((select can_checkout from public.public_storefront_hatching_egg_inventory where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000112'), false),
  false,
  'inventory for an inactive species is not purchasable'
);

select is(
  coalesce((select can_checkout from public.public_storefront_hatching_egg_inventory where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000111'), false),
  false,
  'flagged inventory is excluded and therefore not purchasable'
);

select results_eq(
  $test$
    select can_checkout, buyer_availability_code, is_available_now
    from public.public_storefront_hatching_egg_inventory
    where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000109'
  $test$,
  $expected$
    values (true, 'reserve_now'::text, false)
  $expected$,
  'future inventory with minimum stock remains reservable'
);

select results_eq(
  $test$
    select can_checkout, buyer_availability_code, is_available_now
    from public.public_storefront_hatching_egg_inventory
    where hatching_egg_inventory_item_id = 'd2000000-0000-4000-8000-000000000110'
  $test$,
  $expected$
    values (false, 'reserve_now'::text, false)
  $expected$,
  'future inventory below minimum stock is visible but not reservable'
);

select is(
  (
    select is_checkout_available
    from public.get_public_checkout_summary(
      'hatching-contract-store',
      '[{"item_type":"hatching_egg_inventory","item_id":"d2000000-0000-4000-8000-000000000102","quantity":5}]'::jsonb
    )
  ),
  false,
  'checkout summary still rejects requested quantity below minimum'
);

select is(
  (
    select is_checkout_available
    from public.get_public_checkout_summary(
      'hatching-contract-store',
      '[{"item_type":"hatching_egg_inventory","item_id":"d2000000-0000-4000-8000-000000000102","quantity":7}]'::jsonb
    )
  ),
  false,
  'checkout summary still rejects requested quantity above stock'
);

select is(
  (
    select is_checkout_available
    from public.get_public_checkout_summary(
      'hatching-contract-store',
      '[{"item_type":"hatching_egg_inventory","item_id":"d2000000-0000-4000-8000-000000000102","quantity":6}]'::jsonb
    )
  ),
  true,
  'checkout summary accepts a qualifying requested quantity'
);

select throws_ok(
  $test$
    select pg_temp.test_hatching_checkout(
      'below-minimum-checkout',
      'd2000000-0000-4000-8000-000000000102',
      5
    )
  $test$,
  'P0001',
  'One or more inventory items are not available for checkout.',
  'transactional checkout still rejects requested quantity below minimum'
);

select throws_ok(
  $test$
    select pg_temp.test_hatching_checkout(
      'above-stock-checkout',
      'd2000000-0000-4000-8000-000000000102',
      7
    )
  $test$,
  'P0001',
  'One or more inventory items are not available for checkout.',
  'transactional checkout still rejects requested quantity above stock'
);

select lives_ok(
  $test$
    select pg_temp.test_hatching_checkout(
      'valid-hatching-checkout',
      'd2000000-0000-4000-8000-000000000102',
      6
    )
  $test$,
  'transactional checkout accepts a qualifying requested quantity'
);

select is(
  (select quantity_available from public.hatching_egg_inventory_items where id = 'd2000000-0000-4000-8000-000000000102'),
  0,
  'qualifying transactional checkout deducts Hatching Egg stock'
);

select is(
  (
    select count(*)::integer
    from public.order_items
    where order_id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'd2000000-0000-4000-8000-000000000010'
        and idempotency_key = 'valid-hatching-checkout'
    )
      and order_item_source = 'hatching_egg_inventory'
      and quantity = 6
  ),
  1,
  'qualifying transactional checkout creates the standalone Hatching Egg order line'
);

select * from finish();

rollback;
