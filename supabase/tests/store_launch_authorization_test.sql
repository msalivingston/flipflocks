begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

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
  storefront_enabled, storefront_visibility
)
values (
  'ed000000-0000-4000-8000-000000000010',
  'ed000000-0000-4000-8000-000000000001',
  'Launch Ownership Store', 'launch-ownership-store', 'draft', 'hosted', false,
  'public'
);

insert into public.seller_billing_status (
  store_id, plan_key, billing_plan, subscription_status,
  storefront_access_until, billing_state_authority, comp_granted_by_user_id,
  comp_grant_reason, comp_granted_at, comp_access_until
) values (
  'ed000000-0000-4000-8000-000000000010',
  'small_flock', 'comped', 'comped',
  statement_timestamp() + interval '30 days', 'admin_comp',
  'ed000000-0000-4000-8000-000000000001',
  'Launch behavior test fixture', statement_timestamp(),
  statement_timestamp() + interval '30 days'
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

create or replace function public.evaluate_store_launch_readiness(
  p_store_id uuid,
  p_actor_user_id uuid
)
returns table (
  item_type text,
  item_key text,
  label text,
  passed boolean,
  message text,
  action text,
  detail_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select null::text, null::text, null::text, true, null::text, null::text, 0::bigint
  where false;
$$;

set local role service_role;

select lives_ok(
  $$select * from public.trusted_launch_store(
    'ed000000-0000-4000-8000-000000000010'::uuid,
    'ed000000-0000-4000-8000-000000000001'::uuid
  )$$,
  'the owning seller can launch a ready draft store'
);

reset role;

select results_eq(
  $$select store_status, storefront_enabled, storefront_visibility::text, storefront_mode
    from public.stores
    where id = 'ed000000-0000-4000-8000-000000000010'::uuid$$,
  $$values ('live'::text, true, 'public'::text, 'hosted'::text)$$,
  'launch atomically enables the storefront without changing visibility mode or storefront mode'
);

update public.stores
set storefront_enabled = false
where id = 'ed000000-0000-4000-8000-000000000010'::uuid;

select is(
  (select storefront_enabled from public.stores
   where id = 'ed000000-0000-4000-8000-000000000010'::uuid),
  false,
  'a seller can hide the live store later without launch re-enabling it'
);

select * from finish();

rollback;
