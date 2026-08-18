begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select set_config('request.jwt.claim.role', 'service_role', true);

grant select on public.species, public.inventory_items, public.order_items
to authenticated;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  'd1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'duplicate-lots@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled
)
values (
  'd1000000-0000-4000-8000-000000000010',
  'd1000000-0000-4000-8000-000000000001',
  'Duplicate Lots Farm', 'duplicate-lots-farm', 'live', 'hosted', true
);

insert into public.seller_billing_status (
  store_id, plan_key, billing_plan, subscription_status,
  storefront_access_until, billing_state_authority,
  comp_granted_by_user_id, comp_grant_reason, comp_granted_at,
  comp_access_until
)
values (
  'd1000000-0000-4000-8000-000000000010',
  'full_flock', 'comped', 'comped', statement_timestamp() + interval '30 days',
  'admin_comp', 'd1000000-0000-4000-8000-000000000001',
  'Duplicate inventory identity regression fixture', statement_timestamp(),
  statement_timestamp() + interval '30 days'
);

insert into public.seller_breed_profiles (
  id, store_id, species_id, custom_breed_name, normalized_custom_breed_name,
  display_name, visibility_status, moderation_status
)
select
  'd1000000-0000-4000-8000-000000000020',
  'd1000000-0000-4000-8000-000000000010',
  species.id, 'Barred Rock Test', 'barred rock test', 'Barred Rock Test',
  'active', 'normal'
from public.species
where species.slug = 'chicken';

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

create temporary table duplicate_creation on commit drop as
select *
from public.seller_create_listing_batch_with_inventory(
  'd1000000-0000-4000-8000-000000000010',
  (select id from public.species where slug = 'chicken'),
  'live_animals', current_date - 30, current_date, 18,
  jsonb_build_array(jsonb_build_object(
    'seller_breed_profile_id', 'd1000000-0000-4000-8000-000000000020',
    'inventory_items', jsonb_build_array(
      jsonb_build_object(
        'client_row_token', 'offering-a',
        'inventory_type', 'female',
        'quantity_available', 5,
        'price_override', 18,
        'barn_location', ' Barn A '
      ),
      jsonb_build_object(
        'client_row_token', 'offering-b',
        'inventory_type', 'female',
        'quantity_available', 20,
        'price_override', 16,
        'barn_location', '  Barn B  '
      )
    )
  )),
  false, null, null, null, null, 'active'
);

select is(
  (
    select count(*)
    from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
      and inventory_type = 'female'
  ),
  2::bigint,
  'same breed and inventory type rows coexist in one breed group'
);

select is(
  (
    select count(distinct id)
    from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
  ),
  2::bigint,
  'semantic duplicate rows receive distinct inventory UUIDs'
);

select is(
  (
    select count(*)
    from pg_constraint
    where conrelid = 'public.inventory_items'::regclass
      and conname = 'inventory_items_batch_breed_type_unique'
  ),
  0::bigint,
  'the former breed and inventory-type uniqueness constraint is absent'
);

select results_eq(
  $$select quantity_available, barn_location
    from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
    order by quantity_available$$,
  $$values (5, 'Barn A'::text), (20, 'Barn B'::text)$$,
  'different private barn locations are trimmed and persist independently'
);

select results_eq(
  $$select
      item ->> 'client_row_token',
      (item ->> 'quantity_available')::integer,
      item ->> 'barn_location'
    from duplicate_creation
    cross join lateral jsonb_array_elements(breed_groups) as breed_group(value)
    cross join lateral jsonb_array_elements(breed_group.value -> 'inventory_items')
      as inventory_item(item)
    order by item ->> 'client_row_token'$$,
  $$values
      ('offering-a'::text, 5, 'Barn A'::text),
      ('offering-b'::text, 20, 'Barn B'::text)$$,
  'creation result correlates each client row token with its own returned row'
);

select is(
  (
    select count(distinct item ->> 'id')
    from duplicate_creation
    cross join lateral jsonb_array_elements(breed_groups) as breed_group(value)
    cross join lateral jsonb_array_elements(breed_group.value -> 'inventory_items')
      as inventory_item(item)
  ),
  2::bigint,
  'client-row mappings contain two different inventory UUIDs'
);

select results_eq(
  $$select requested_bird_units
    from public.seller_preflight_live_bird_publication(
      'd1000000-0000-4000-8000-000000000010',
      jsonb_build_array(jsonb_build_object(
        'inventory_items', jsonb_build_array(
          jsonb_build_object('inventory_type', 'female', 'quantity_available', 5),
          jsonb_build_object('inventory_type', 'female', 'quantity_available', 20)
        )
      )),
      (select listing_batch_id from duplicate_creation)
    )$$,
  $$values (25)$$,
  'publication preflight counts both semantic duplicate quantities'
);

select results_eq(
  $$select quantity_available, barn_location
    from public.seller_inventory_management
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
    order by quantity_available$$,
  $$values (5, 'Barn A'::text), (20, 'Barn B'::text)$$,
  'seller-private inventory management exposes each barn location'
);

reset role;
update public.inventory_items
set breeding_history = 'breeder', feather_condition = 'rough'
where listing_batch_id = (select listing_batch_id from duplicate_creation)
  and barn_location = 'Barn A';
set local role authenticated;

select public.seller_update_inventory_item(
  (
    select id from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
      and barn_location = 'Barn A'
  ),
  'male', null, 19, 0, null
);

select results_eq(
  $$select quantity_available, price_override, inventory_type, barn_location,
      breeding_history, feather_condition
    from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
    order by quantity_available$$,
  $$values
      (5, 19.00::numeric, 'male'::text, 'Barn A'::text, 'breeder'::text, 'rough'::text),
      (20, 16.00::numeric, 'female'::text, 'Barn B'::text, null::text, null::text)$$,
  'standard edits change only the UUID and preserve hidden barn and buyer attribute data'
);

select public.seller_update_inventory_item(
  (
    select id from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
      and barn_location = 'Barn A'
  ),
  'female', null, 19, 0, null
);

select public.seller_adjust_inventory_quantity(
  (
    select id from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
      and barn_location = 'Barn A'
  ),
  7, null, 'Duplicate identity regression test.'
);

select results_eq(
  $$select barn_location, quantity_available
    from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
    order by barn_location$$,
  $$values ('Barn A'::text, 7), ('Barn B'::text, 20)$$,
  'quantity updates remain isolated by inventory UUID'
);

select public.seller_set_inventory_visibility(
  (
    select id from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
      and barn_location = 'Barn A'
  ),
  'hidden',
  'Duplicate identity regression test.'
);

select results_eq(
  $$select barn_location, visibility_status
    from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
    order by barn_location$$,
  $$values ('Barn A'::text, 'hidden'::text), ('Barn B'::text, 'active'::text)$$,
  'visibility changes remain isolated by inventory UUID'
);

select public.seller_set_inventory_visibility(
  (
    select id from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
      and barn_location = 'Barn A'
  ),
  'active',
  'Duplicate identity regression restore.'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'public_inventory_items',
        'public_storefront_breed_inventory',
        'public_storefront_inventory',
        'public_storefront_item_detail',
        'public_discoverable_inventory',
        'public_breed_availability'
      )
      and column_name = 'barn_location'
  ),
  0::bigint,
  'buyer/public inventory projections do not expose barn_location'
);

select ok(
  not has_table_privilege('anon', 'public.inventory_items', 'select'),
  'anonymous buyers cannot select seller-private inventory rows directly'
);

select ok(
  not exists (
    select 1
    from public.public_storefront_inventory
    where store_id = 'd1000000-0000-4000-8000-000000000010'
      and to_jsonb(public_storefront_inventory) ? 'barn_location'
  ),
  'public storefront whole-row JSON contains no barn_location key'
);

select ok(
  (
    select items::text not like '%barn_location%'
    from public.get_public_checkout_summary(
      'duplicate-lots-farm',
      jsonb_build_array(jsonb_build_object(
        'inventory_item_id', (
          select id from public.inventory_items
          where listing_batch_id = (select listing_batch_id from duplicate_creation)
            and barn_location = 'Barn A'
        ),
        'quantity', 1
      ))
    )
  ),
  'buyer checkout-summary JSON omits barn_location'
);

select ok(
  (
    select inventory::text not like '%barn_location%'
    from public.get_seller_storefront_preview_data('duplicate-lots-farm')
  ),
  'buyer-safe seller storefront preview omits barn_location'
);

select public.seller_delete_inventory_entries(
  array[(
    select id from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
      and barn_location = 'Barn A'
  )],
  array[]::uuid[]
);

select results_eq(
  $$select barn_location, quantity_available
    from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)$$,
  $$values ('Barn B'::text, 20)$$,
  'removing one semantic duplicate leaves the other inventory UUID intact'
);

create temporary table recreated_duplicate on commit drop as
select *
from public.seller_create_inventory_item(
  p_listing_batch_breed_id => (
    select listing_batch_breed_id
    from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
    limit 1
  ),
  p_inventory_type => 'female',
  p_quantity_available => 3,
  p_price_override => 18,
  p_barn_location => 'Barn A'
);

create temporary table duplicate_order on commit drop as
select null::uuid as order_id
where false;

reset role;

insert into duplicate_order
select order_id
from public.create_pay_at_pickup_order_v2(
  p_store_id => 'd1000000-0000-4000-8000-000000000010',
  p_idempotency_key => 'duplicate-live-bird-inventory-identity',
  p_buyer_email => 'duplicate-buyer@example.test',
  p_buyer_first_name => 'Duplicate',
  p_buyer_last_name => 'Buyer',
  p_items => jsonb_build_array(
    jsonb_build_object(
      'inventory_item_id', (select id from recreated_duplicate),
      'quantity', 1
    ),
    jsonb_build_object(
      'inventory_item_id', (
        select id
        from public.inventory_items
        where listing_batch_id = (select listing_batch_id from duplicate_creation)
          and barn_location = 'Barn B'
      ),
      'quantity', 2
    )
  ),
  p_buyer_phone => '555-0110',
  p_delivery_address_line1 => '10 Test Lane',
  p_delivery_city => 'Testville',
  p_delivery_state => 'CO',
  p_delivery_postal_code => '80000'
);

set local role authenticated;

select is(
  (
    select count(distinct inventory_item_id)
    from public.order_items
    where order_id = (select order_id from duplicate_order)
  ),
  2::bigint,
  'one checkout preserves two semantic duplicate rows as distinct inventory UUIDs'
);

select results_eq(
  $$select barn_location, quantity_available
    from public.inventory_items
    where id in (
      select inventory_item_id
      from public.order_items
      where order_id = (select order_id from duplicate_order)
    )
    order by barn_location$$,
  $$values ('Barn A'::text, 2), ('Barn B'::text, 18)$$,
  'checkout reserves and decrements each duplicate inventory UUID independently'
);

create temporary table blank_barn_location on commit drop as
select *
from public.seller_create_inventory_item(
  p_listing_batch_breed_id => (
    select listing_batch_breed_id
    from public.inventory_items
    where listing_batch_id = (select listing_batch_id from duplicate_creation)
    limit 1
  ),
  p_inventory_type => 'male',
  p_quantity_available => 1,
  p_price_override => 8,
  p_barn_location => '   '
);

select is(
  (select barn_location from blank_barn_location),
  null::text,
  'whitespace-only barn location is normalized to null'
);

select throws_ok(
  $$select public.seller_create_inventory_item(
      p_listing_batch_breed_id => (
        select listing_batch_breed_id
        from public.inventory_items
        where listing_batch_id = (select listing_batch_id from duplicate_creation)
        limit 1
      ),
      p_inventory_type => 'male',
      p_quantity_available => 1,
      p_price_override => 8,
      p_barn_location => repeat('x', 201)
    )$$,
  'P0001',
  'Barn location must be 200 characters or fewer.',
  'barn location rejects values longer than 200 characters'
);

select * from finish();
rollback;
