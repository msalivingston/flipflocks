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
    'ec000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'inventory-owner-a@example.test', '',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  ),
  (
    'ec000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'inventory-owner-b@example.test', '',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
)
values
  (
    'ec000000-0000-4000-8000-000000000010',
    'ec000000-0000-4000-8000-000000000001',
    'Inventory Scale Store', 'inventory-scale-store', 'draft', 'hosted', false
  ),
  (
    'ec000000-0000-4000-8000-000000000020',
    'ec000000-0000-4000-8000-000000000002',
    'Private Inventory Store', 'private-inventory-store', 'draft', 'hosted', false
  );

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  billing_state_authority
)
values
  (
    'ec000000-0000-4000-8000-000000000010',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  ),
  (
    'ec000000-0000-4000-8000-000000000020',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  );

create temporary table inventory_test_equipment as
select series, gen_random_uuid() as id
from generate_series(1, 1105) series;

insert into public.equipment_inventory_items (
  id, store_id, item_name, category, condition, description,
  quantity_available, price, visibility_status, moderation_status,
  available_date, created_at, updated_at
)
select
  id,
  'ec000000-0000-4000-8000-000000000010',
  'Equipment ' || lpad(series::text, 4, '0'),
  case when series > 1000 then 'Transport & Crates' else 'Feeders & Waterers' end,
  case when series > 1000 then 'Fair' else 'Good' end,
  'Inventory pagination fixture ' || series,
  series,
  2,
  case when series > 1100 then 'archived' when series <= 60 then 'hidden' else 'active' end,
  'normal',
  current_date,
  timestamptz '2026-01-01 00:00:00+00' + series * interval '1 minute',
  timestamptz '2026-01-01 00:00:00+00' + series * interval '1 minute'
from inventory_test_equipment;

insert into public.equipment_inventory_items (
  store_id, item_name, category, condition, quantity_available, price,
  visibility_status, moderation_status, available_date
)
values (
  'ec000000-0000-4000-8000-000000000020', 'Private equipment',
  'Miscellaneous', 'New', 3, 5, 'active', 'normal', current_date
);

insert into public.customers (id, store_id, email, first_name, last_name)
values (
  'ec000000-0000-4000-8000-000000000011',
  'ec000000-0000-4000-8000-000000000010',
  'inventory-customer@example.test', 'Inventory', 'Customer'
);

insert into public.orders (
  id, store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot,
  subtotal_amount, total_amount
)
values (
  'ec000000-0000-4000-8000-000000000012',
  'ec000000-0000-4000-8000-000000000010',
  'ec000000-0000-4000-8000-000000000011',
  'INVENTORY-RESERVATIONS', 'seller_created', 'pending',
  'pay_at_pickup', 'pay_at_pickup', 'inventory-customer@example.test',
  'Inventory', 'Customer', 2005, 2005
);

insert into public.order_items (
  order_id, store_id, equipment_inventory_item_id,
  species_name_snapshot, species_slug_snapshot, breed_display_name_snapshot,
  inventory_type_snapshot, batch_type_snapshot, product_type_snapshot,
  item_name_snapshot, item_category_snapshot, unit_price_snapshot,
  quantity, line_subtotal, order_item_source
)
select
  'ec000000-0000-4000-8000-000000000012',
  'ec000000-0000-4000-8000-000000000010',
  (select id from inventory_test_equipment where series = 1100),
  'Equipment', 'equipment', 'Equipment 1100',
  'equipment_supplies', 'equipment_supplies', 'equipment_supplies',
  'Equipment 1100', 'Transport & Crates', 1,
  1, 1, 'equipment_inventory'
from generate_series(1, 2005);

select set_config(
  'request.jwt.claim.sub',
  'ec000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  jsonb_array_length(public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000010', 'equipment',
    'current_inventory', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    null, 'item_name', 1000, 50
  ) -> 'rows'),
  50,
  'inventory beyond the PostgREST 1,000-row cap is reachable by pagination'
);

select is(
  public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000010', 'equipment',
    'current_inventory', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    'Equipment 1100', 'item_name', 0, 50
  ) #>> '{rows,0,row,item_name}',
  'Equipment 1100',
  'search finds inventory outside the first browser page'
);

select is(
  (public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000010', 'equipment',
    'current_inventory', 'all', 'all', 'all', 'all', 'all',
    'Transport & Crates', 'Fair', null, 'item_name', 0, 50
  ) ->> 'total_count')::integer,
  100,
  'category and condition filters apply before pagination across the full dataset'
);

select ok(
  (public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000010', 'equipment',
    'current_inventory', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    null, 'available', 0, 50
  ) #>> '{rows,49,row,quantity_available}')::integer
  >
  (public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000010', 'equipment',
    'current_inventory', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    null, 'available', 50, 50
  ) #>> '{rows,0,row,quantity_available}')::integer,
  'sorting is globally correct across page boundaries'
);

select is(
  (public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000010', 'equipment',
    'current_inventory', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    null, 'item_name', 0, 50
  ) #>> '{summary,available_quantity}')::bigint,
  605550::bigint,
  'available quantity summarizes all 1,100 current inventory rows'
);

select is(
  (public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000010', 'equipment',
    'current_inventory', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    null, 'item_name', 0, 50
  ) #>> '{summary,reserved_quantity}')::bigint,
  2005::bigint,
  'reservation totals include more order items than an unpaginated API request can return'
);

select is(
  (public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000010', 'equipment',
    'current_inventory', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    null, 'item_name', 0, 50
  ) #>> '{summary,inventory_value}')::numeric,
  1211100::numeric,
  'inventory value summarizes every current inventory row'
);

select is(
  (public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000010', 'equipment',
    'hidden', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    null, 'item_name', 0, 50
  ) ->> 'total_count')::integer,
  60,
  'visibility filtering includes all matching hidden inventory'
);

select is(
  (public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000010', 'equipment',
    'archived', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    null, 'item_name', 0, 50
  ) ->> 'total_count')::integer,
  5,
  'archived inventory remains separately reachable'
);

select throws_ok(
  $$select public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000020', 'equipment',
    'current_inventory', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    null, 'item_name', 0, 50
  )$$,
  '42501',
  'forbidden',
  'Seller A cannot retrieve Seller B inventory'
);

select set_config(
  'request.jwt.claim.sub',
  'ec000000-0000-4000-8000-000000000002',
  true
);

select is(
  (public.seller_get_inventory_management_page(
    'ec000000-0000-4000-8000-000000000020', 'equipment',
    'current_inventory', 'all', 'all', 'all', 'all', 'all', 'all', 'all',
    null, 'item_name', 0, 50
  ) ->> 'total_count')::integer,
  1,
  'normal small inventory remains complete'
);

select * from finish();
rollback;
