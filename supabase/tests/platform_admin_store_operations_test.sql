begin;

create extension if not exists pgtap with schema extensions;

select no_plan();
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
    'a5000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'platform-admin@example.test',
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
  ),
  (
    'a5000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'seller@example.test',
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
  ),
  (
    'a5000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'non-admin@example.test',
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
  ),
  (
    'a5000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'other-owner@example.test',
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
  storefront_enabled,
  hatching_eggs_enabled,
  equipment_supplies_enabled,
  processed_poultry_enabled
)
values
  (
    'a5000000-0000-4000-8000-000000000010',
    'a5000000-0000-4000-8000-000000000002',
    'Admin Operations Store',
    'admin-operations-store',
    'live',
    'hosted',
    false,
    false,
    false,
    false
  ),
  (
    'a5000000-0000-4000-8000-000000000011',
    'a5000000-0000-4000-8000-000000000004',
    'Unrelated Store',
    'unrelated-admin-operations-store',
    'live',
    'hosted',
    true,
    false,
    false,
    false
  );

insert into public.user_roles (user_id, role, store_id)
values
  ('a5000000-0000-4000-8000-000000000001', 'admin', null),
  (
    'a5000000-0000-4000-8000-000000000002',
    'seller',
    'a5000000-0000-4000-8000-000000000010'
  );

insert into public.seller_billing_status (store_id, plan_key)
values (
  'a5000000-0000-4000-8000-000000000010',
  'small_flock'
);

insert into public.customers (
  id,
  store_id,
  email,
  first_name,
  last_name
)
values (
  'a5000000-0000-4000-8000-000000000020',
  'a5000000-0000-4000-8000-000000000010',
  'buyer@example.test',
  'Test',
  'Buyer'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'a5000000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  $$select public.admin_set_storefront_enabled(
    'a5000000-0000-4000-8000-000000000010',
    true
  )$$,
  'P0001',
  'Not authorized to perform admin operations.',
  'an ordinary seller cannot change storefront state'
);

select throws_ok(
  $$select public.admin_set_store_hold(
    'a5000000-0000-4000-8000-000000000010',
    true,
    'seller attempt'
  )$$,
  'P0001',
  'Not authorized to perform admin operations.',
  'an ordinary seller cannot place an admin hold'
);

select throws_ok(
  $$select public.admin_change_store_plan(
    'a5000000-0000-4000-8000-000000000010',
    'full_flock'
  )$$,
  'P0001',
  'Not authorized to perform admin operations.',
  'an ordinary seller cannot change a store plan'
);

select throws_ok(
  $$select public.admin_update_store_internal_note(
    'a5000000-0000-4000-8000-000000000010',
    'seller attempt'
  )$$,
  'P0001',
  'Not authorized to perform admin operations.',
  'an ordinary seller cannot change the platform note'
);

select set_config(
  'request.jwt.claim.sub',
  'a5000000-0000-4000-8000-000000000003',
  true
);

select throws_ok(
  $$select public.admin_set_storefront_enabled(
    'a5000000-0000-4000-8000-000000000011',
    false
  )$$,
  'P0001',
  'Not authorized to perform admin operations.',
  'a non-admin authenticated user cannot change an unrelated store'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id in (
      'a5000000-0000-4000-8000-000000000010',
      'a5000000-0000-4000-8000-000000000011'
    )
  ),
  0::bigint,
  'failed authorization attempts create no activity'
);

select set_config(
  'request.jwt.claim.sub',
  'a5000000-0000-4000-8000-000000000001',
  true
);

create temporary table storefront_before as
select to_jsonb(stores) - 'storefront_enabled' - 'updated_at' as snapshot
from public.stores
where id = 'a5000000-0000-4000-8000-000000000010';

select lives_ok(
  $$select public.admin_set_storefront_enabled(
    'a5000000-0000-4000-8000-000000000010',
    true
  )$$,
  'a platform admin can enable a storefront'
);

select is(
  (
    select storefront_enabled
    from public.stores
    where id = 'a5000000-0000-4000-8000-000000000010'
  ),
  true,
  'the storefront is enabled'
);

select is(
  (
    select to_jsonb(stores) - 'storefront_enabled' - 'updated_at'
    from public.stores
    where id = 'a5000000-0000-4000-8000-000000000010'
  ),
  (select snapshot from storefront_before),
  'the storefront operation changes no unrelated store field'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'storefront_enabled'
  ),
  1::bigint,
  'enabling creates exactly one activity record'
);

select lives_ok(
  $$select public.admin_set_storefront_enabled(
    'a5000000-0000-4000-8000-000000000010',
    false
  )$$,
  'a platform admin can disable a storefront'
);

select is(
  (
    select storefront_enabled
    from public.stores
    where id = 'a5000000-0000-4000-8000-000000000010'
  ),
  false,
  'the storefront is disabled'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'storefront_disabled'
  ),
  1::bigint,
  'disabling creates exactly one activity record'
);

select throws_ok(
  $$select public.admin_set_store_hold(
    'a5000000-0000-4000-8000-000000000010',
    true,
    ' '
  )$$,
  'P0001',
  'A reason is required to place a store on hold.',
  'placing a hold requires a reason'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'store_hold_placed'
  ),
  0::bigint,
  'a rejected hold creates no activity'
);

select lives_ok(
  $$select public.admin_set_store_hold(
    'a5000000-0000-4000-8000-000000000010',
    true,
    'Manual support review'
  )$$,
  'a platform admin can place a hold'
);

select is(
  (
    select admin_hold_reason
    from public.stores
    where id = 'a5000000-0000-4000-8000-000000000010'
  ),
  'Manual support review',
  'the hold reason is stored on the existing hold field'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'store_hold_placed'
      and reason = 'Manual support review'
  ),
  1::bigint,
  'placing a hold creates one activity record with the reason'
);

select lives_ok(
  $$select public.admin_set_store_hold(
    'a5000000-0000-4000-8000-000000000010',
    false,
    null
  )$$,
  'a platform admin can remove a hold'
);

select is(
  (
    select admin_hold_reason
    from public.stores
    where id = 'a5000000-0000-4000-8000-000000000010'
  ),
  null,
  'removing a hold clears the existing hold field'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'store_hold_removed'
  ),
  1::bigint,
  'removing a hold creates exactly one activity record'
);

select lives_ok(
  $$select public.admin_change_store_plan(
    'a5000000-0000-4000-8000-000000000010',
    'full_flock'
  )$$,
  'a platform admin can change Coop to Market'
);

select is(
  public.get_store_plan_key('a5000000-0000-4000-8000-000000000010'),
  'full_flock',
  'Market uses the exact shared full_flock plan key'
);

select lives_ok(
  $$select public.admin_change_store_plan(
    'a5000000-0000-4000-8000-000000000010',
    'small_flock'
  )$$,
  'a platform admin can change Market to Coop'
);

select is(
  public.get_store_plan_key('a5000000-0000-4000-8000-000000000010'),
  'small_flock',
  'Coop uses the exact shared small_flock plan key'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'store_plan_changed'
  ),
  2::bigint,
  'each successful plan change creates exactly one activity record'
);

select throws_ok(
  $$select public.admin_change_store_plan(
    'a5000000-0000-4000-8000-000000000010',
    'enterprise'
  )$$,
  'P0001',
  'Plan must be small_flock or full_flock.',
  'invalid plan values are rejected'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'store_plan_changed'
  ),
  2::bigint,
  'a rejected plan value creates no activity'
);

select public.admin_change_store_plan(
  'a5000000-0000-4000-8000-000000000010',
  'full_flock'
);

update public.stores
set hatching_eggs_enabled = true
where id = 'a5000000-0000-4000-8000-000000000010';

select throws_ok(
  $$select public.admin_change_store_plan(
    'a5000000-0000-4000-8000-000000000010',
    'small_flock'
  )$$,
  'P0001',
  'Coop includes live birds only. Upgrade to Market to enable hatching eggs, equipment, or processed poultry.',
  'a plan downgrade reuses the shared module capability guard'
);

select is(
  public.get_store_plan_key('a5000000-0000-4000-8000-000000000010'),
  'full_flock',
  'a rejected capability downgrade rolls the plan back'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'store_plan_changed'
  ),
  3::bigint,
  'a rejected capability downgrade creates no activity'
);

update public.stores
set hatching_eggs_enabled = false
where id = 'a5000000-0000-4000-8000-000000000010';

update public.seller_billing_status
set stripe_subscription_id = 'sub_platform_admin_test'
where store_id = 'a5000000-0000-4000-8000-000000000010';

select throws_ok(
  $$select public.admin_change_store_plan(
    'a5000000-0000-4000-8000-000000000010',
    'small_flock'
  )$$,
  'P0001',
  'This store has a linked Stripe subscription. Change its plan through the billing integration.',
  'the pre-Stripe override rejects a linked Stripe subscription'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'store_plan_changed'
  ),
  3::bigint,
  'a rejected Stripe-linked plan change creates no activity'
);

update public.seller_billing_status
set stripe_subscription_id = null
where store_id = 'a5000000-0000-4000-8000-000000000010';

select lives_ok(
  $$select public.admin_update_store_internal_note(
    'a5000000-0000-4000-8000-000000000010',
    'Private support context'
  )$$,
  'a platform admin can save the private store note'
);

select is(
  (
    select note
    from public.admin_store_internal_notes
    where store_id = 'a5000000-0000-4000-8000-000000000010'
  ),
  'Private support context',
  'the private note is stored once at store scope'
);

select ok(
  (
    select metadata::text not like '%Private support context%'
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'store_internal_note_updated'
    order by created_at desc
    limit 1
  ),
  'note contents are not copied into admin activity metadata'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'store_internal_note_updated'
  ),
  1::bigint,
  'saving a note creates exactly one activity record'
);

select lives_ok(
  $$select public.admin_update_store_internal_note(
    'a5000000-0000-4000-8000-000000000010',
    'Updated private support context'
  )$$,
  'a platform admin can change the private store note'
);

select is(
  (
    select count(*)
    from public.admin_activity_events
    where target_store_id = 'a5000000-0000-4000-8000-000000000010'
      and action_type = 'store_internal_note_updated'
  ),
  2::bigint,
  'changing a note creates one additional activity record'
);

select set_config(
  'request.jwt.claim.sub',
  'a5000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;

select is(
  (
    select count(*)
    from public.admin_store_internal_notes
    where store_id = 'a5000000-0000-4000-8000-000000000010'
  ),
  0::bigint,
  'the internal note table remains invisible to the seller through RLS'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  'a5000000-0000-4000-8000-000000000001',
  true
);

insert into public.orders (
  id,
  store_id,
  customer_id,
  order_number,
  order_status,
  payment_method,
  payment_status,
  buyer_email_snapshot,
  buyer_first_name_snapshot,
  buyer_last_name_snapshot,
  subtotal_amount,
  total_amount
)
values (
  'a5000000-0000-4000-8000-000000000101',
  'a5000000-0000-4000-8000-000000000010',
  'a5000000-0000-4000-8000-000000000020',
  'TEST-001',
  'pending',
  'pay_at_pickup',
  'pay_at_pickup',
  'buyer@example.test',
  'Test',
  'Buyer',
  100,
  100
);

select is(
  (
    select recorded_gross_sales
    from public.admin_platform_store_operations_summary(
      'a5000000-0000-4000-8000-000000000010'
    )
  ),
  100::numeric,
  'recorded gross sales include an open pay-at-pickup order'
);

insert into public.orders (
  id,
  store_id,
  customer_id,
  order_number,
  order_status,
  payment_method,
  payment_provider,
  payment_status,
  buyer_email_snapshot,
  buyer_first_name_snapshot,
  buyer_last_name_snapshot,
  subtotal_amount,
  total_amount,
  fulfilled_at
)
values (
  'a5000000-0000-4000-8000-000000000102',
  'a5000000-0000-4000-8000-000000000010',
  'a5000000-0000-4000-8000-000000000020',
  'TEST-002',
  'fulfilled',
  'stripe_checkout',
  'stripe',
  'unpaid',
  'buyer@example.test',
  'Test',
  'Buyer',
  200,
  200,
  now()
);

select is(
  (
    select recorded_gross_sales
    from public.admin_platform_store_operations_summary(
      'a5000000-0000-4000-8000-000000000010'
    )
  ),
  300::numeric,
  'recorded gross sales include fulfilled and unpaid orders'
);

insert into public.orders (
  id,
  store_id,
  customer_id,
  order_number,
  order_status,
  payment_method,
  payment_status,
  buyer_email_snapshot,
  buyer_first_name_snapshot,
  buyer_last_name_snapshot,
  subtotal_amount,
  total_amount,
  canceled_at,
  canceled_reason
)
values (
  'a5000000-0000-4000-8000-000000000103',
  'a5000000-0000-4000-8000-000000000010',
  'a5000000-0000-4000-8000-000000000020',
  'TEST-003',
  'canceled',
  'pay_at_pickup',
  'canceled',
  'buyer@example.test',
  'Test',
  'Buyer',
  400,
  400,
  now(),
  'Test cancellation'
);

select is(
  (
    select recorded_gross_sales
    from public.admin_platform_store_operations_summary(
      'a5000000-0000-4000-8000-000000000010'
    )
  ),
  300::numeric,
  'recorded gross sales exclude canceled orders'
);

insert into public.orders (
  id,
  store_id,
  customer_id,
  order_number,
  order_status,
  payment_method,
  payment_provider,
  payment_status,
  buyer_email_snapshot,
  buyer_first_name_snapshot,
  buyer_last_name_snapshot,
  subtotal_amount,
  total_amount,
  fulfilled_at
)
values (
  'a5000000-0000-4000-8000-000000000104',
  'a5000000-0000-4000-8000-000000000010',
  'a5000000-0000-4000-8000-000000000020',
  'TEST-004',
  'fulfilled',
  'stripe_checkout',
  'stripe',
  'refunded',
  'buyer@example.test',
  'Test',
  'Buyer',
  500,
  500,
  now()
);

select is(
  (
    select recorded_gross_sales
    from public.admin_platform_store_operations_summary(
      'a5000000-0000-4000-8000-000000000010'
    )
  ),
  800::numeric,
  'recorded gross sales match seller Reports by not subtracting refunded orders'
);

insert into public.orders (
  id,
  store_id,
  customer_id,
  order_number,
  order_status,
  payment_method,
  payment_provider,
  payment_status,
  buyer_email_snapshot,
  buyer_first_name_snapshot,
  buyer_last_name_snapshot,
  subtotal_amount,
  total_amount
)
values (
  'a5000000-0000-4000-8000-000000000105',
  'a5000000-0000-4000-8000-000000000010',
  'a5000000-0000-4000-8000-000000000020',
  'TEST-005',
  'open',
  'stripe_checkout',
  'stripe',
  'unpaid',
  'buyer@example.test',
  'Test',
  'Buyer',
  300,
  300
);

select is(
  (
    select recorded_gross_sales
    from public.admin_platform_store_operations_summary(
      'a5000000-0000-4000-8000-000000000010'
    )
  ),
  1100::numeric,
  'recorded gross sales include open unpaid orders'
);

select results_eq(
  $$
    select
      total_order_count,
      open_order_count,
      fulfilled_order_count,
      canceled_order_count,
      refunded_order_count
    from public.admin_platform_store_operations_summary(
      'a5000000-0000-4000-8000-000000000010'
    )
  $$,
  $$values (5::bigint, 2::bigint, 2::bigint, 1::bigint, 1::bigint)$$,
  'order summary uses pending/open as open and preserves canonical fulfilled, canceled, and refunded classifications'
);

select * from finish();

rollback;
