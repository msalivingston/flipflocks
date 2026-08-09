begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    'ec000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'terms-owner-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'ec000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'terms-owner-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled
)
values
  (
    'ec000000-0000-4000-8000-000000000010',
    'ec000000-0000-4000-8000-000000000001',
    'Terms Store A', 'terms-store-a', 'draft', 'hosted', false
  ),
  (
    'ec000000-0000-4000-8000-000000000020',
    'ec000000-0000-4000-8000-000000000002',
    'Terms Store B', 'terms-store-b', 'draft', 'hosted', false
  );

insert into public.seller_onboarding_state (
  store_id, profile_complete, billing_complete, storefront_details_complete,
  categories_complete, pickup_complete
)
values
  ('ec000000-0000-4000-8000-000000000010', true, true, true, true, true),
  ('ec000000-0000-4000-8000-000000000020', true, true, true, true, true);

insert into public.seller_terms_acceptances (
  store_id, terms_version, accepted_by_user_id, accepted_at
)
values (
  'ec000000-0000-4000-8000-000000000010',
  'historical-terms-v1',
  'ec000000-0000-4000-8000-000000000001',
  '2025-01-01 00:00:00+00'
);

create temporary table terms_test_clock as select now() as started_at;

select is(
  public.current_seller_terms_version(),
  '2026-08-08',
  'the server controls the current Seller Terms version'
);

select isnt(
  has_table_privilege('authenticated', 'public.seller_terms_acceptances', 'INSERT'),
  true,
  'authenticated clients cannot bypass the trusted acceptance RPC'
);

select isnt(
  has_table_privilege('authenticated', 'public.seller_terms_acceptances', 'UPDATE'),
  true,
  'authoritative acceptance history cannot be updated by clients'
);

select isnt(
  has_table_privilege('authenticated', 'public.seller_terms_acceptances', 'DELETE'),
  true,
  'authoritative acceptance history cannot be deleted by clients'
);

select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok(
  $$select * from public.seller_accept_current_terms('ec000000-0000-4000-8000-000000000020')$$,
  '42501',
  'permission denied for function seller_accept_current_terms',
  'anonymous callers cannot invoke Seller Terms acceptance'
);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'ec000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select throws_ok(
  $$select * from public.seller_accept_current_terms(null)$$,
  '22023',
  'STORE_ID_REQUIRED',
  'a missing store id fails safely'
);

select throws_ok(
  $$select * from public.seller_accept_current_terms('ec000000-0000-4000-8000-000000000020')$$,
  '42501',
  'STORE_NOT_FOUND_OR_NOT_OWNER',
  'seller A cannot accept for seller B store'
);

select throws_ok(
  $$select * from public.seller_accept_current_terms('ec000000-0000-4000-8000-000000000099')$$,
  '42501',
  'STORE_NOT_FOUND_OR_NOT_OWNER',
  'an unknown store fails without disclosure'
);

select lives_ok(
  $$select * from public.seller_accept_current_terms('ec000000-0000-4000-8000-000000000010')$$,
  'an authenticated owner can accept current Seller Terms'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.seller_terms_acceptances
    where store_id = 'ec000000-0000-4000-8000-000000000010'
      and terms_version = '2026-08-08'
  ),
  1,
  'acceptance creates one current-version record'
);

select is(
  (
    select store_id
    from public.seller_terms_acceptances
    where store_id = 'ec000000-0000-4000-8000-000000000010'
      and terms_version = '2026-08-08'
  ),
  'ec000000-0000-4000-8000-000000000010'::uuid,
  'acceptance records the owned store id'
);

select is(
  (
    select accepted_by_user_id
    from public.seller_terms_acceptances
    where store_id = 'ec000000-0000-4000-8000-000000000010'
      and terms_version = '2026-08-08'
  ),
  'ec000000-0000-4000-8000-000000000001'::uuid,
  'accepted_by_user_id is derived from auth'
);

select is(
  (
    select terms_version
    from public.seller_terms_acceptances
    where store_id = 'ec000000-0000-4000-8000-000000000010'
      and terms_version = '2026-08-08'
  ),
  '2026-08-08',
  'the recorded version is the server-controlled current version'
);

select ok(
  (
    select accepted_at >= terms_test_clock.started_at
    from public.seller_terms_acceptances
    cross join terms_test_clock
    where store_id = 'ec000000-0000-4000-8000-000000000010'
      and terms_version = '2026-08-08'
  ),
  'accepted_at is generated by the database during acceptance'
);

set local role authenticated;

select lives_ok(
  $$select * from public.seller_accept_current_terms('ec000000-0000-4000-8000-000000000010')$$,
  'duplicate acceptance retries are idempotent'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.seller_terms_acceptances
    where store_id = 'ec000000-0000-4000-8000-000000000010'
      and terms_version = '2026-08-08'
  ),
  1,
  'idempotent retries do not create duplicate rows'
);

select is(
  (
    select count(*)::integer
    from public.seller_terms_acceptances
    where store_id = 'ec000000-0000-4000-8000-000000000010'
      and terms_version = 'historical-terms-v1'
      and accepted_at = '2025-01-01 00:00:00+00'
  ),
  1,
  'existing historical acceptance remains intact'
);

select ok(
  (
    select passed
    from public.seller_get_store_launch_readiness(
      'ec000000-0000-4000-8000-000000000010'
    )
    where item_key = 'terms_accepted'
  ),
  'launch readiness becomes terms-complete after acceptance'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  'ec000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;

select throws_ok(
  $$select * from public.seller_complete_onboarding()$$,
  'P0001',
  'SELLER_TERMS_ACCEPTANCE_REQUIRED',
  'onboarding cannot finish without authoritative acceptance'
);

select lives_ok(
  $$select * from public.seller_accept_current_terms('ec000000-0000-4000-8000-000000000020')$$,
  'seller B can accept for the owned store'
);

select lives_ok(
  $$select * from public.seller_complete_onboarding()$$,
  'successful authoritative acceptance allows onboarding completion'
);

select * from finish();

rollback;
