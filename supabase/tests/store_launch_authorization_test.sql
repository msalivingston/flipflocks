begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    'ed000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'launch-owner-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'ed000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'launch-owner-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled
)
values (
  'ed000000-0000-4000-8000-000000000010',
  'ed000000-0000-4000-8000-000000000001',
  'Launch Ownership Store', 'launch-ownership-store', 'draft', 'hosted', true
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.trusted_launch_store(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated browser roles cannot invoke the trusted launch mutation directly'
);

set local role service_role;

select throws_ok(
  $$
    select *
    from public.trusted_launch_store(
      'ed000000-0000-4000-8000-000000000010'::uuid,
      'ed000000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  'P0001',
  'The signed-in seller does not own this store.',
  'seller B cannot launch seller A store through the trusted workflow'
);

reset role;

select is(
  (
    select store_status
    from public.stores
    where id = 'ed000000-0000-4000-8000-000000000010'::uuid
  ),
  'draft',
  'a rejected foreign-owner launch leaves publication state unchanged'
);

select * from finish();

rollback;
