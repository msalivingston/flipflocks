begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  'd4000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'restore-owner@example.test', '',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
)
values
  (
    'd4000000-0000-4000-8000-000000000010',
    'd4000000-0000-4000-8000-000000000001',
    'Restore Test Store', 'restore-test-store', 'live', 'hosted', true
  ),
  (
    'd4000000-0000-4000-8000-000000000011',
    'd4000000-0000-4000-8000-000000000001',
    'Other Restore Store', 'other-restore-test-store', 'live', 'hosted', true
  );

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  billing_state_authority
)
values
  (
    'd4000000-0000-4000-8000-000000000010',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  ),
  (
    'd4000000-0000-4000-8000-000000000011',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  );

insert into public.equipment_inventory_items (
  id, store_id, item_name, category, condition, quantity_available, price,
  visibility_status, moderation_status, available_date
)
values
  (
    'd4000000-0000-4000-8000-000000000050',
    'd4000000-0000-4000-8000-000000000010',
    'Restore Feeder', 'Feeders & Waterers', 'Good', 10, 25.00,
    'active', 'normal', current_date
  ),
  (
    'd4000000-0000-4000-8000-000000000051',
    'd4000000-0000-4000-8000-000000000011',
    'Other Store Feeder', 'Feeders & Waterers', 'Good', 10, 25.00,
    'active', 'normal', current_date
  );

select set_config(
  'request.jwt.claim.sub',
  'd4000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table restore_test_state (
  source_order_id uuid not null
) on commit drop;

insert into restore_test_state (source_order_id)
select created.order_id
from public.seller_create_manual_order(
  p_store_id => 'd4000000-0000-4000-8000-000000000010',
  p_idempotency_key => 'restore-helper-source',
  p_items => jsonb_build_array(
    jsonb_build_object(
      'item_type', 'equipment_inventory',
      'item_id', 'd4000000-0000-4000-8000-000000000050',
      'quantity', 2,
      'unit_price', 25.00
    ),
    jsonb_build_object(
      'item_type', 'equipment_inventory',
      'item_id', 'd4000000-0000-4000-8000-000000000050',
      'quantity', 3,
      'unit_price', 25.00
    ),
    jsonb_build_object(
      'item_type', 'custom',
      'custom_item_name', 'Custom handling',
      'quantity', 1,
      'unit_price', 7.50
    )
  ),
  p_customer_email => 'restore-customer@example.test',
  p_customer_first_name => 'Restore',
  p_customer_last_name => 'Customer',
  p_customer_phone => '555-0140',
  p_order_source => 'manual',
  p_payment_status => 'pay_at_pickup',
  p_buyer_notes => 'Keep the original buyer note',
  p_pickup_note => 'Use the side gate'
) as created;

update public.orders as source_order
set order_status = 'canceled', canceled_at = statement_timestamp()
from restore_test_state as state
where source_order.id = state.source_order_id;

update public.equipment_inventory_items
set quantity_available = 5
where id = 'd4000000-0000-4000-8000-000000000050';

update public.customers as customer
set phone = '555-0199'
from restore_test_state as state
join public.orders as source_order on source_order.id = state.source_order_id
where customer.id = source_order.customer_id
  and customer.store_id = source_order.store_id;

select ok(
  (public.seller_get_order_restore_draft(state.source_order_id) ->> 'can_restore')::boolean,
  'a canceled order with enough exact inventory is eligible'
)
from restore_test_state as state;

select is(
  (
    select (item ->> 'quantity')::integer
    from jsonb_array_elements(
      public.seller_get_order_restore_draft(state.source_order_id) -> 'items'
    ) as item
    where item ->> 'item_type' = 'equipment_inventory'
  ),
  5,
  'duplicate exact source UUID lines are grouped for their combined quantity'
)
from restore_test_state as state;

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.seller_get_order_restore_draft(state.source_order_id) -> 'items'
    ) as item
    where item ->> 'item_type' = 'custom'
      and item ->> 'item_name' = 'Custom handling'
  ),
  'a custom line is returned without requiring inventory'
)
from restore_test_state as state;

select is(
  public.seller_get_order_restore_draft(state.source_order_id)
    #>> '{customer,phone}',
  '555-0199',
  'prefill uses the current customer record'
)
from restore_test_state as state;

select is(
  public.seller_get_order_restore_draft(state.source_order_id)
    ->> 'buyer_notes',
  'Keep the original buyer note',
  'prefill returns the original buyer note'
)
from restore_test_state as state;

update public.equipment_inventory_items
set quantity_available = 4
where id = 'd4000000-0000-4000-8000-000000000050';

select isnt(
  (public.seller_get_order_restore_draft(state.source_order_id) ->> 'can_restore')::boolean,
  true,
  'combined exact-source demand above current inventory is unavailable'
)
from restore_test_state as state;

select like(
  public.seller_get_order_restore_draft(state.source_order_id)
    #>> '{reasons,0,message}',
  '%requires 5, but only 4%',
  'short inventory returns a useful reason'
)
from restore_test_state as state;

update public.equipment_inventory_items
set quantity_available = 5
where id = 'd4000000-0000-4000-8000-000000000050';

update public.order_items as source_item
set equipment_inventory_item_id = null
from restore_test_state as state
where source_item.order_id = state.source_order_id
  and source_item.order_item_source = 'equipment_inventory';

select isnt(
  (public.seller_get_order_restore_draft(state.source_order_id) ->> 'can_restore')::boolean,
  true,
  'a missing exact source UUID is unavailable'
)
from restore_test_state as state;

update public.order_items as source_item
set equipment_inventory_item_id = 'd4000000-0000-4000-8000-000000000050'
from restore_test_state as state
where source_item.order_id = state.source_order_id
  and source_item.order_item_source = 'equipment_inventory';

update public.order_items as source_item
set equipment_inventory_item_id = 'd4000000-0000-4000-8000-000000000051'
from restore_test_state as state
where source_item.order_id = state.source_order_id
  and source_item.order_item_source = 'equipment_inventory';

select isnt(
  (public.seller_get_order_restore_draft(state.source_order_id) ->> 'can_restore')::boolean,
  true,
  'an exact source that belongs to another store is unavailable'
)
from restore_test_state as state;

select * from finish();
rollback;
