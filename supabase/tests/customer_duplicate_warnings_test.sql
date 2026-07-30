begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

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
    'a7000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'customer-owner-a@example.test',
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
    'a7000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'customer-owner-b@example.test',
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
values
  (
    'a7000000-0000-4000-8000-000000000010',
    'a7000000-0000-4000-8000-000000000001',
    'Customer Warning Store A',
    'customer-warning-store-a',
    'live',
    'hosted'
  ),
  (
    'a7000000-0000-4000-8000-000000000020',
    'a7000000-0000-4000-8000-000000000002',
    'Customer Warning Store B',
    'customer-warning-store-b',
    'live',
    'hosted'
  );

insert into public.customers (
  id,
  store_id,
  first_name,
  last_name,
  email,
  phone,
  created_at
)
select
  (
    'a7000000-0000-4000-8001-'
    || lpad(sequence_number::text, 12, '0')
  )::uuid,
  'a7000000-0000-4000-8000-000000000010'::uuid,
  'Filler',
  sequence_number::text,
  'filler-' || sequence_number || '@example.test',
  null,
  '2026-01-01 00:00:00+00'::timestamptz
    + make_interval(secs => sequence_number)
from generate_series(1, 501) as sequence_number;

insert into public.customers (
  id,
  store_id,
  first_name,
  last_name,
  business_name,
  email,
  phone,
  created_at
)
values
  (
    'a7000000-0000-4000-8000-000000910001',
    'a7000000-0000-4000-8000-000000000010',
    'Email',
    'Match',
    'Email Match Farm',
    'Case.Match@Example.Test',
    '(970) 111-0001',
    '2026-02-01 00:00:01+00'
  ),
  (
    'a7000000-0000-4000-8000-000000910002',
    'a7000000-0000-4000-8000-000000000010',
    'Phone',
    'Match',
    'Phone Match Farm',
    'phone-only@example.test',
    '(970) 555-0100',
    '2026-02-01 00:00:02+00'
  ),
  (
    'a7000000-0000-4000-8000-000000910003',
    'a7000000-0000-4000-8000-000000000010',
    'Both',
    'Match',
    'Both Match Farm',
    'case.match@example.test',
    '+1 970-555-0100',
    '2026-02-01 00:00:03+00'
  ),
  (
    'a7000000-0000-4000-8000-000000910004',
    'a7000000-0000-4000-8000-000000000020',
    'Other Store',
    'Match',
    'Other Store Farm',
    'case.match@example.test',
    '970.555.0100',
    '2026-02-01 00:00:04+00'
  );

select set_config(
  'request.jwt.claim.sub',
  'a7000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  public.normalize_customer_phone_for_matching('(970) 555-0100'),
  '9705550100',
  'phone matching removes formatting'
);

select is(
  public.normalize_customer_phone_for_matching('+1 (970) 555-0100'),
  '9705550100',
  'phone matching removes a leading US country code'
);

select is(
  public.normalize_customer_phone_for_matching(''),
  null,
  'blank phone normalizes to null'
);

select is(
  (
    select count(*)::integer
    from public.customers
    where store_id = 'a7000000-0000-4000-8000-000000000010'
  ),
  504,
  'the fixture contains more than 500 customers in one store'
);

select is(
  (
    select count(*)::integer
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      '  CASE.MATCH@example.test ',
      null,
      null
    )
  ),
  2,
  'email lookup is case-insensitive, whitespace-insensitive, and returns multiple matches'
);

select ok(
  exists (
    select 1
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      'case.match@example.test',
      null,
      null
    )
    where customer_id = 'a7000000-0000-4000-8000-000000910003'
  ),
  'the store-wide lookup finds a matching customer beyond the old 500-row cap'
);

select ok(
  (
    select bool_and(email_matches and not phone_matches)
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      'case.match@example.test',
      null,
      null
    )
  ),
  'email-only lookup labels every result as an email match'
);

select is(
  (
    select count(*)::integer
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      null,
      '1 (970) 555-0100',
      null
    )
  ),
  2,
  'phone lookup normalizes formatting and returns multiple matches'
);

select ok(
  (
    select bool_and(phone_matches and not email_matches)
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      null,
      '970-555-0100',
      null
    )
  ),
  'phone-only lookup labels every result as a phone match'
);

select is(
  (
    select count(*)::integer
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      'case.match@example.test',
      '(970) 555-0100',
      null
    )
  ),
  3,
  'combined lookup returns the union of all email and phone matches'
);

select ok(
  exists (
    select 1
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      'case.match@example.test',
      '9705550100',
      null
    )
    where customer_id = 'a7000000-0000-4000-8000-000000910003'
      and email_matches
      and phone_matches
  ),
  'a customer matching both fields is labeled as matching both'
);

select ok(
  not exists (
    select 1
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      'case.match@example.test',
      null,
      null
    )
    where customer_id = 'a7000000-0000-4000-8000-000000910004'
  ),
  'same email in another store is not returned'
);

select ok(
  not exists (
    select 1
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      null,
      '9705550100',
      null
    )
    where customer_id = 'a7000000-0000-4000-8000-000000910004'
  ),
  'same phone in another store is not returned'
);

select is(
  (
    select count(*)::integer
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      '   ',
      '',
      null
    )
  ),
  0,
  'blank email and phone return no warnings'
);

select is(
  (
    select count(*)::integer
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      'case.match@example.test',
      '9705550100',
      'a7000000-0000-4000-8000-000000910003'
    )
  ),
  2,
  'editing a customer excludes that customer from its own results'
);

select lives_ok(
  $test$
    insert into public.customers (
      id,
      store_id,
      first_name,
      last_name,
      email,
      phone
    )
    values (
      'a7000000-0000-4000-8000-000000910005',
      'a7000000-0000-4000-8000-000000000010',
      'Deliberate',
      'Duplicate',
      'CASE.MATCH@example.test',
      '(970) 555-0100'
    )
  $test$,
  'a seller can intentionally create a duplicate customer'
);

select is(
  (
    select count(*)::integer
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      'case.match@example.test',
      null,
      null
    )
  ),
  3,
  'the deliberately duplicated email remains queryable'
);

select is(
  (
    select count(*)::integer
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      null,
      '9705550100',
      null
    )
  ),
  3,
  'the deliberately duplicated phone remains queryable'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'customers'
      and indexdef ilike 'create unique index%'
      and indexdef ilike '%email%'
  ),
  0,
  'customer email has no unique index'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'customers'
      and indexdef ilike 'create unique index%'
      and indexdef ilike '%phone%'
  ),
  0,
  'customer phone has no unique index'
);

select set_config(
  'request.jwt.claim.sub',
  'a7000000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  $test$
    select *
    from public.seller_find_possible_customer_duplicates(
      'a7000000-0000-4000-8000-000000000010',
      'case.match@example.test',
      null,
      null
    )
  $test$,
  'P0001',
  'You do not have access to this store.',
  'a seller cannot search another store'
);

select * from finish();

rollback;
