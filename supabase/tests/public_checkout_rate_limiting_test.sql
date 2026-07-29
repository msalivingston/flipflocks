begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

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
  '90000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'rate-limit-owner@example.test',
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
  storefront_mode
)
values (
  '90000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000001',
  'Rate Limit Test Store',
  'rate-limit-test-store',
  'live',
  'hosted'
);

select is(
  (
    select allowed
    from public.consume_public_checkout_rate_limit(
      '90000000-0000-4000-8000-000000000002',
      'email-key-1',
      'buyer@example.test',
      '203.0.113.10',
      6,
      30,
      120
    )
  ),
  true,
  'first checkout attempt is allowed'
);

select is(
  (
    select allowed
    from public.consume_public_checkout_rate_limit(
      '90000000-0000-4000-8000-000000000002',
      'email-key-2',
      'buyer@example.test',
      '203.0.113.10',
      6,
      30,
      120
    )
  ),
  true,
  'second checkout attempt is allowed'
);

select is(
  (select allowed from public.consume_public_checkout_rate_limit(
    '90000000-0000-4000-8000-000000000002', 'email-key-3',
    'buyer@example.test', '203.0.113.10', 6, 30, 120
  )),
  true,
  'third checkout attempt is allowed'
);
select is(
  (select allowed from public.consume_public_checkout_rate_limit(
    '90000000-0000-4000-8000-000000000002', 'email-key-4',
    'buyer@example.test', '203.0.113.10', 6, 30, 120
  )),
  true,
  'fourth checkout attempt is allowed'
);
select is(
  (select allowed from public.consume_public_checkout_rate_limit(
    '90000000-0000-4000-8000-000000000002', 'email-key-5',
    'buyer@example.test', '203.0.113.10', 6, 30, 120
  )),
  true,
  'fifth checkout attempt is allowed'
);
select is(
  (select allowed from public.consume_public_checkout_rate_limit(
    '90000000-0000-4000-8000-000000000002', 'email-key-6',
    'buyer@example.test', '203.0.113.10', 6, 30, 120
  )),
  true,
  'sixth checkout attempt is allowed'
);

select is(
  (
    select allowed
    from public.consume_public_checkout_rate_limit(
      '90000000-0000-4000-8000-000000000002',
      'email-key-7',
      'buyer@example.test',
      '203.0.113.10',
      6,
      30,
      120
    )
  ),
  false,
  'a different key above the store/email limit is rejected'
);

select is(
  (
    select request_count
    from public.public_checkout_rate_limit_buckets
    where store_id = '90000000-0000-4000-8000-000000000002'
      and scope = 'store_email'
      and identifier_hash = encode(
        extensions.digest(
          '90000000-0000-4000-8000-000000000002:buyer@example.test',
          'sha256'
        ),
        'hex'
      )
  ),
  6,
  'a rejected request does not increment its email bucket'
);

select is(
  (select allowed from public.consume_public_checkout_rate_limit(
    '90000000-0000-4000-8000-000000000002', 'failed-retry-key',
    'retry@example.test', null, 6, 30, 120
  )),
  true,
  'first failed-key attempt is allowed'
);
select is(
  (select allowed from public.consume_public_checkout_rate_limit(
    '90000000-0000-4000-8000-000000000002', 'failed-retry-key',
    'retry@example.test', null, 6, 30, 120
  )),
  true,
  'repeated failed-key attempt is allowed but consumes again'
);

select is(
  (
    select request_count
    from public.public_checkout_rate_limit_buckets
    where store_id = '90000000-0000-4000-8000-000000000002'
      and scope = 'store_email'
      and identifier_hash = encode(
        extensions.digest(
          '90000000-0000-4000-8000-000000000002:retry@example.test',
          'sha256'
        ),
        'hex'
      )
  ),
  2,
  'a repeated key without an authoritative order consumes capacity again'
);

insert into public.customers (
  id,
  store_id,
  email,
  first_name,
  last_name
)
values (
  '90000000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000002',
  'authoritative@example.test',
  'Rate',
  'Tester'
);

insert into public.orders (
  id,
  store_id,
  customer_id,
  order_number,
  order_source,
  order_status,
  payment_method,
  payment_status,
  buyer_email_snapshot,
  buyer_first_name_snapshot,
  buyer_last_name_snapshot
)
values (
  '90000000-0000-4000-8000-000000000004',
  '90000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000003',
  'rate-limit-test-order',
  'storefront',
  'open',
  'pay_at_pickup',
  'pay_at_pickup',
  'authoritative@example.test',
  'Rate',
  'Tester'
);

insert into public.order_idempotency_keys (
  store_id,
  idempotency_key,
  request_hash,
  order_id
)
values (
  '90000000-0000-4000-8000-000000000002',
  'authoritative-key',
  repeat('a', 64),
  '90000000-0000-4000-8000-000000000004'
);

select is(
  (
    select allowed
    from public.consume_public_checkout_rate_limit(
      '90000000-0000-4000-8000-000000000002',
      'authoritative-key',
      'authoritative@example.test',
      '203.0.113.11',
      1,
      1,
      1
    )
  ),
  true,
  'a key linked to an authoritative order remains retryable'
);

select is(
  (
    select authoritative_retry
    from public.consume_public_checkout_rate_limit(
      '90000000-0000-4000-8000-000000000002',
      'authoritative-key',
      'authoritative@example.test',
      '203.0.113.11',
      1,
      1,
      1
    )
  ),
  true,
  'the authoritative retry is identified explicitly'
);

select is(
  (
    select count(*)::integer
    from public.public_checkout_rate_limit_buckets
    where store_id = '90000000-0000-4000-8000-000000000002'
      and scope = 'store_email'
      and identifier_hash = encode(
        extensions.digest(
          '90000000-0000-4000-8000-000000000002:authoritative@example.test',
          'sha256'
        ),
        'hex'
      )
  ),
  0,
  'an authoritative retry does not create or increment a rate bucket'
);

select is(
  (
    select count(*)::integer
    from public.order_idempotency_keys
    where store_id = '90000000-0000-4000-8000-000000000002'
      and idempotency_key = 'email-key-7'
  ),
  0,
  'a rate-limited key creates no authoritative idempotency reservation'
);

select is(
  (
    select count(*)::integer
    from public.orders
    where store_id = '90000000-0000-4000-8000-000000000002'
      and id <> '90000000-0000-4000-8000-000000000004'
  ),
  0,
  'rate limiting itself creates no orders'
);

select * from finish();

rollback;
