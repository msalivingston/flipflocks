begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

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
    'b7000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'identity-owner-a@example.test',
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
    'b7000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'identity-owner-b@example.test',
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
values
  (
    'b7000000-0000-4000-8000-000000000010',
    'b7000000-0000-4000-8000-000000000001',
    'Customer Identity Store A',
    'customer-identity-store-a',
    'live',
    'hosted',
    true
  ),
  (
    'b7000000-0000-4000-8000-000000000020',
    'b7000000-0000-4000-8000-000000000002',
    'Customer Identity Store B',
    'customer-identity-store-b',
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
values
  (
    'b7000000-0000-4000-8000-000000000010',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  ),
  (
    'b7000000-0000-4000-8000-000000000020',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  );

insert into public.equipment_inventory_items (
  id,
  store_id,
  item_name,
  category,
  condition,
  quantity_available,
  price,
  visibility_status,
  moderation_status,
  available_date
)
values (
  'b7000000-0000-4000-8000-000000000050',
  'b7000000-0000-4000-8000-000000000010',
  'Customer Identity Test Feeder',
  'Feeders & Waterers',
  'Good',
  100,
  25.00,
  'active',
  'normal',
  current_date
);

insert into public.customers (
  id,
  store_id,
  first_name,
  last_name,
  email,
  phone,
  delivery_address_line1,
  created_at
)
values
  (
    'b7000000-0000-4000-8000-000000000101',
    'b7000000-0000-4000-8000-000000000010',
    'Jane',
    'Smith',
    'jane@example.test',
    '(970) 111-1111',
    '101 Original Lane',
    '2026-01-01 00:00:01+00'
  ),
  (
    'b7000000-0000-4000-8000-000000000102',
    'b7000000-0000-4000-8000-000000000010',
    'Amy',
    'Neighbor',
    'jane@example.test',
    '(970) 222-2222',
    '102 Amy Lane',
    '2026-01-01 00:00:02+00'
  ),
  (
    'b7000000-0000-4000-8000-000000000103',
    'b7000000-0000-4000-8000-000000000010',
    'Phone',
    'Jane',
    'phone-jane-old@example.test',
    '(970) 555-0100',
    '103 Phone Lane',
    '2026-01-01 00:00:03+00'
  ),
  (
    'b7000000-0000-4000-8000-000000000104',
    'b7000000-0000-4000-8000-000000000010',
    'Jane',
    'Smith',
    'JANE@example.test',
    '(970) 333-3333',
    '104 Later Jane Lane',
    '2026-01-01 00:00:04+00'
  ),
  (
    'b7000000-0000-4000-8000-000000000105',
    'b7000000-0000-4000-8000-000000000010',
    'Selected',
    'Customer',
    'selected@example.test',
    '(970) 444-4444',
    '105 Selected Lane',
    '2026-01-01 00:00:05+00'
  ),
  (
    'b7000000-0000-4000-8000-000000000106',
    'b7000000-0000-4000-8000-000000000010',
    'Manual',
    'Jane',
    'manual-shared@example.test',
    '(970) 700-0100',
    '106 Manual Lane',
    '2026-01-01 00:00:06+00'
  ),
  (
    'b7000000-0000-4000-8000-000000000201',
    'b7000000-0000-4000-8000-000000000020',
    'Cross',
    'Store',
    'cross@example.test',
    '(970) 800-0100',
    '201 Other Store Lane',
    '2026-01-01 00:00:01+00'
  );

create temporary table identity_order_results (
  flow text not null,
  idempotency_key text not null,
  order_id uuid not null,
  customer_id uuid not null,
  primary key (flow, idempotency_key)
) on commit drop;

create or replace function pg_temp.run_public_identity_checkout(
  p_key text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text
)
returns void
language plpgsql
as $function$
begin
  drop table if exists pg_temp.requested_order_items;
  drop table if exists pg_temp.locked_order_items;

  insert into identity_order_results (
    flow,
    idempotency_key,
    order_id,
    customer_id
  )
  select
    'public',
    p_key,
    checkout.order_id,
    checkout.customer_id
  from public.create_pay_at_pickup_order_v2(
    p_store_id => 'b7000000-0000-4000-8000-000000000010',
    p_idempotency_key => p_key,
    p_buyer_email => p_email,
    p_buyer_first_name => p_first_name,
    p_buyer_last_name => p_last_name,
    p_items => jsonb_build_array(
      jsonb_build_object(
        'item_type', 'equipment_inventory',
        'item_id', 'b7000000-0000-4000-8000-000000000050',
        'quantity', 1
      )
    ),
    p_buyer_phone => p_phone,
    p_delivery_address_line1 => '1 Submitted Address',
    p_delivery_city => 'Denver',
    p_delivery_state => 'CO',
    p_delivery_postal_code => '80202'
  ) as checkout;
end;
$function$;

create or replace function pg_temp.run_manual_identity_order(
  p_key text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_customer_id uuid default null
)
returns void
language plpgsql
as $function$
begin
  drop table if exists pg_temp.requested_manual_order_items;
  drop table if exists pg_temp.locked_manual_order_items;
  drop table if exists pg_temp.locked_manual_equipment_items;
  drop table if exists pg_temp.locked_manual_processed_poultry_items;
  drop table if exists pg_temp.locked_manual_hatching_egg_items;

  insert into identity_order_results (
    flow,
    idempotency_key,
    order_id,
    customer_id
  )
  select
    'manual',
    p_key,
    manual_order.order_id,
    manual_order.customer_id
  from public.seller_create_manual_order(
    p_store_id => 'b7000000-0000-4000-8000-000000000010',
    p_idempotency_key => p_key,
    p_items => jsonb_build_array(
      jsonb_build_object(
        'item_type', 'custom',
        'custom_item_name', 'Identity test item',
        'quantity', 1,
        'unit_price', 5
      )
    ),
    p_customer_id => p_customer_id,
    p_customer_email => p_email,
    p_customer_first_name => p_first_name,
    p_customer_last_name => p_last_name,
    p_customer_phone => p_phone
  ) as manual_order;
end;
$function$;

select set_config(
  'request.jwt.claim.sub',
  'b7000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  public.normalize_customer_name_for_matching('  JANE ', ' Van   Smith '),
  'jane van smith',
  'full-name matching trims, lowercases, and collapses whitespace'
);

select lives_ok(
  $test$
    select pg_temp.run_public_identity_checkout(
      'public-shared-email-different-name',
      'John',
      'Smith',
      'JANE@example.test',
      '970-900-0001'
    )
  $test$,
  'public checkout accepts a shared email with a different name'
);

select isnt(
  (
    select customer_id
    from identity_order_results
    where flow = 'public'
      and idempotency_key = 'public-shared-email-different-name'
  ),
  'b7000000-0000-4000-8000-000000000101'::uuid,
  'same email with a different name creates a separate customer'
);

select is(
  (
    select first_name || '|' || phone || '|' || delivery_address_line1
    from public.customers
    where id = 'b7000000-0000-4000-8000-000000000101'
  ),
  'Jane|(970) 111-1111|101 Original Lane',
  'a weak email match does not overwrite the existing customer'
);

select lives_ok(
  $test$
    select pg_temp.run_public_identity_checkout(
      'public-normalized-name-email',
      '  jane ',
      'SMITH',
      ' jane@example.test ',
      '970-111-1111'
    )
  $test$,
  'public checkout accepts a normalized full-name and email match'
);

select is(
  (
    select customer_id
    from identity_order_results
    where flow = 'public'
      and idempotency_key = 'public-normalized-name-email'
  ),
  'b7000000-0000-4000-8000-000000000101'::uuid,
  'same normalized full name and email reuses the deterministic oldest match'
);

select lives_ok(
  $test$
    select pg_temp.run_public_identity_checkout(
      'public-normalized-name-phone',
      'phone',
      'JANE',
      'phone-jane-new@example.test',
      '+1 (970) 555-0100'
    )
  $test$,
  'public checkout accepts a normalized full-name and phone match'
);

select is(
  (
    select customer_id
    from identity_order_results
    where flow = 'public'
      and idempotency_key = 'public-normalized-name-phone'
  ),
  'b7000000-0000-4000-8000-000000000103'::uuid,
  'same normalized full name and phone reuses the customer'
);

select lives_ok(
  $test$
    select pg_temp.run_public_identity_checkout(
      'public-shared-phone-different-name',
      'Other',
      'Person',
      'other-person@example.test',
      '970.555.0100'
    )
  $test$,
  'public checkout accepts a shared phone with a different name'
);

select isnt(
  (
    select customer_id
    from identity_order_results
    where flow = 'public'
      and idempotency_key = 'public-shared-phone-different-name'
  ),
  'b7000000-0000-4000-8000-000000000103'::uuid,
  'same phone with a different name creates a separate customer'
);

select lives_ok(
  $test$
    select pg_temp.run_public_identity_checkout(
      'public-same-name-new-contact',
      'Jane',
      'Smith',
      'new-jane@example.test',
      '970-999-9999'
    )
  $test$,
  'public checkout accepts the same name with different contact information'
);

select ok(
  (
    select customer_id not in (
      'b7000000-0000-4000-8000-000000000101'::uuid,
      'b7000000-0000-4000-8000-000000000104'::uuid
    )
    from identity_order_results
    where flow = 'public'
      and idempotency_key = 'public-same-name-new-contact'
  ),
  'same name with different email and phone creates a separate customer'
);

select is(
  (
    select recipient_email
    from public.email_notifications
    where order_id = (
      select order_id
      from identity_order_results
      where flow = 'public'
        and idempotency_key = 'public-shared-email-different-name'
    )
      and notification_type = 'buyer_order_confirmation'
  ),
  'jane@example.test',
  'public checkout confirmation uses the submitted email'
);

select lives_ok(
  $test$
    select pg_temp.run_public_identity_checkout(
      'public-cross-store',
      'Cross',
      'Store',
      'cross@example.test',
      '9708000100'
    )
  $test$,
  'public checkout accepts details matching a customer in another store'
);

select isnt(
  (
    select customer_id
    from identity_order_results
    where flow = 'public'
      and idempotency_key = 'public-cross-store'
  ),
  'b7000000-0000-4000-8000-000000000201'::uuid,
  'cross-store customer matches are never reused'
);

select lives_ok(
  $test$
    select pg_temp.run_manual_identity_order(
      'manual-shared-email-different-name',
      'Manual',
      'John',
      'manual-shared@example.test',
      '970-700-0200'
    )
  $test$,
  'manual direct creation accepts a shared email with a different name'
);

select isnt(
  (
    select customer_id
    from identity_order_results
    where flow = 'manual'
      and idempotency_key = 'manual-shared-email-different-name'
  ),
  'b7000000-0000-4000-8000-000000000106'::uuid,
  'manual direct creation does not reuse an email-only match'
);

select lives_ok(
  $test$
    select pg_temp.run_manual_identity_order(
      'manual-normalized-name-email',
      ' manual ',
      'JANE',
      ' MANUAL-SHARED@example.test ',
      '9707000100'
    )
  $test$,
  'manual direct creation accepts a normalized name and email match'
);

select is(
  (
    select customer_id
    from identity_order_results
    where flow = 'manual'
      and idempotency_key = 'manual-normalized-name-email'
  ),
  'b7000000-0000-4000-8000-000000000106'::uuid,
  'manual direct creation reuses a full-name and email match'
);

select lives_ok(
  $test$
    select pg_temp.run_manual_identity_order(
      'manual-normalized-name-phone',
      'Manual',
      'Jane',
      'manual-jane-new@example.test',
      '+1 (970) 700-0100'
    )
  $test$,
  'manual direct creation accepts a normalized name and phone match'
);

select is(
  (
    select customer_id
    from identity_order_results
    where flow = 'manual'
      and idempotency_key = 'manual-normalized-name-phone'
  ),
  'b7000000-0000-4000-8000-000000000106'::uuid,
  'manual direct creation reuses a full-name and phone match'
);

select lives_ok(
  $test$
    select pg_temp.run_manual_identity_order(
      'manual-explicit-customer',
      'Submitted',
      'Recipient',
      'submitted-recipient@example.test',
      '970-444-0000',
      'b7000000-0000-4000-8000-000000000105'
    )
  $test$,
  'manual order accepts an explicitly selected same-store customer'
);

select is(
  (
    select customer_id
    from identity_order_results
    where flow = 'manual'
      and idempotency_key = 'manual-explicit-customer'
  ),
  'b7000000-0000-4000-8000-000000000105'::uuid,
  'manual order uses the explicitly selected customer exactly'
);

select ok(
  (
    select count(*) >= 3
    from public.customers
    where store_id = 'b7000000-0000-4000-8000-000000000010'
      and lower(trim(email)) = 'jane@example.test'
  ),
  'deliberate shared-email customer records remain valid'
);

select ok(
  (
    select count(*) >= 2
    from public.customers
    where store_id = 'b7000000-0000-4000-8000-000000000010'
      and public.normalize_customer_phone_for_matching(phone) = '9705550100'
  ),
  'deliberate shared-phone customer records remain valid'
);

select * from finish();

rollback;
