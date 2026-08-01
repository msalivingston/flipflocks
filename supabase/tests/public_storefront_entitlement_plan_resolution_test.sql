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
values (
  'e4000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'public-plan-resolution@example.test',
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
    'e4000000-0000-4000-8000-000000000010',
    'e4000000-0000-4000-8000-000000000001',
    'Green Acres',
    'green-acres',
    'live',
    'hosted',
    true,
    false,
    false,
    false
  ),
  (
    'e4000000-0000-4000-8000-000000000011',
    'e4000000-0000-4000-8000-000000000001',
    'Inactive Acres',
    'inactive-acres',
    'live',
    'hosted',
    true,
    false,
    false,
    false
  ),
  (
    'e4000000-0000-4000-8000-000000000012',
    'e4000000-0000-4000-8000-000000000001',
    'Private Market Acres',
    'private-market-acres',
    'live',
    'hosted',
    false,
    false,
    false,
    false
  ),
  (
    'e4000000-0000-4000-8000-000000000013',
    'e4000000-0000-4000-8000-000000000001',
    'Public Coop Acres',
    'public-coop-acres',
    'live',
    'hosted',
    true,
    false,
    false,
    false
  );

insert into public.seller_billing_status (
  store_id,
  requested_plan_key,
  requested_billing_cadence,
  plan_key,
  billing_plan,
  subscription_status,
  storefront_access_until,
  billing_state_authority,
  comp_granted_by_user_id,
  comp_grant_reason,
  comp_granted_at,
  comp_access_until
)
values
  (
    'e4000000-0000-4000-8000-000000000010',
    'full_flock',
    'monthly',
    'full_flock',
    'comped',
    'comped',
    statement_timestamp() + interval '30 days',
    'admin_comp',
    'e4000000-0000-4000-8000-000000000001',
    'Public plan-resolution regression fixture',
    statement_timestamp(),
    statement_timestamp() + interval '30 days'
  ),
  (
    'e4000000-0000-4000-8000-000000000012',
    'full_flock',
    'monthly',
    'full_flock',
    'comped',
    'comped',
    statement_timestamp() + interval '30 days',
    'admin_comp',
    'e4000000-0000-4000-8000-000000000001',
    'Private plan-resolution regression fixture',
    statement_timestamp(),
    statement_timestamp() + interval '30 days'
  ),
  (
    'e4000000-0000-4000-8000-000000000013',
    'small_flock',
    'monthly',
    'small_flock',
    'comped',
    'comped',
    statement_timestamp() + interval '30 days',
    'admin_comp',
    'e4000000-0000-4000-8000-000000000001',
    'Public Coop plan-resolution regression fixture',
    statement_timestamp(),
    statement_timestamp() + interval '30 days'
  );

update public.stores
set
  hatching_eggs_enabled = true,
  equipment_supplies_enabled = true,
  processed_poultry_enabled = true
where id = 'e4000000-0000-4000-8000-000000000010';

select ok(
  not has_function_privilege(
    'anon',
    'public.get_store_plan_key(uuid)',
    'execute'
  ),
  'anon still cannot execute the private plan helper'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_store_plan_key(uuid)',
    'execute'
  ),
  'authenticated still cannot execute the private plan helper'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.get_store_plan_key(uuid)',
    'execute'
  ),
  'service role is not re-granted the deprecated direct plan surface'
);

select ok(
  has_function_privilege(
    'anon',
    'public.store_has_public_market_entitlement(uuid)',
    'execute'
  ),
  'anon may execute only the public-safe boolean Market capability helper'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class as views
    join pg_catalog.pg_namespace as view_schemas
      on view_schemas.oid = views.relnamespace
    join pg_catalog.pg_rewrite as rules
      on rules.ev_class = views.oid
    join pg_catalog.pg_depend as dependencies
      on dependencies.classid = 'pg_rewrite'::regclass
     and dependencies.objid = rules.oid
    join pg_catalog.pg_proc as functions
      on dependencies.refclassid = 'pg_proc'::regclass
     and dependencies.refobjid = functions.oid
    join pg_catalog.pg_namespace as function_schemas
      on function_schemas.oid = functions.pronamespace
    where view_schemas.nspname = 'public'
      and views.relname in (
        'public_storefront_equipment_inventory',
        'public_storefront_hatching_egg_inventory',
        'public_storefront_home',
        'public_storefront_inventory',
        'public_storefront_item_detail',
        'public_storefront_media_gallery',
        'public_storefront_processed_poultry_inventory'
      )
      and function_schemas.nspname = 'public'
      and functions.proname = 'get_store_plan_key'
  ),
  0,
  'no affected public view depends directly on get_store_plan_key'
);

select is(
  (
    select count(distinct views.relname)::integer
    from pg_catalog.pg_class as views
    join pg_catalog.pg_namespace as view_schemas
      on view_schemas.oid = views.relnamespace
    join pg_catalog.pg_rewrite as rules
      on rules.ev_class = views.oid
    join pg_catalog.pg_depend as dependencies
      on dependencies.classid = 'pg_rewrite'::regclass
     and dependencies.objid = rules.oid
    join pg_catalog.pg_proc as functions
      on dependencies.refclassid = 'pg_proc'::regclass
     and dependencies.refobjid = functions.oid
    join pg_catalog.pg_namespace as function_schemas
      on function_schemas.oid = functions.pronamespace
    where view_schemas.nspname = 'public'
      and views.relname in (
        'public_storefront_inventory',
        'public_storefront_equipment_inventory',
        'public_storefront_processed_poultry_inventory',
        'public_storefront_hatching_egg_inventory',
        'public_storefront_media_gallery'
      )
      and function_schemas.nspname = 'public'
      and functions.proname = 'store_has_public_market_entitlement'
  ),
  5,
  'all five direct public views depend on the public-safe Market capability helper'
);

select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

select lives_ok(
  format('select count(*) from public.%I', view_name),
  format('anon can query public.%s', view_name)
)
from unnest(array[
  'public_storefront_breed_inventory',
  'public_discoverable_storefronts',
  'public_discoverable_inventory',
  'public_storefront_home',
  'public_storefront_item_detail',
  'public_storefront_pickup_options',
  'public_storefront_inventory',
  'public_storefront_equipment_inventory',
  'public_storefront_processed_poultry_inventory',
  'public_storefront_hatching_egg_inventory',
  'public_storefront_media_gallery',
  'public_storefront_processed_poultry_media_gallery'
]) as public_views(view_name);

select throws_ok(
  format('select count(*) from public.%I', view_name),
  '42501',
  format('permission denied for view %s', view_name),
  format('anon remains denied from internal projection public.%s', view_name)
)
from unnest(array[
  'public_storefronts',
  'public_listing_batches',
  'public_inventory_items'
]) as internal_views(view_name);

select lives_ok(
  format(
    'select count(*) from public.%I where store_id = %L::uuid',
    view_name,
    'e4000000-0000-4000-8000-000000000010'
  ),
  format('Green Acres query succeeds through public.%s', view_name)
)
from unnest(array[
  'public_storefront_equipment_inventory',
  'public_storefront_hatching_egg_inventory',
  'public_storefront_home',
  'public_storefront_inventory',
  'public_storefront_item_detail',
  'public_storefront_media_gallery',
  'public_storefront_processed_poultry_inventory'
]) as affected_views(view_name);

select results_eq(
  format(
    'select count(*)::bigint from public.%I where store_id = %L::uuid',
    view_name,
    'e4000000-0000-4000-8000-000000000011'
  ),
  array[0::bigint],
  format('inactive store remains absent from public.%s', view_name)
)
from unnest(array[
  'public_storefront_breed_inventory',
  'public_discoverable_storefronts',
  'public_discoverable_inventory',
  'public_storefront_home',
  'public_storefront_item_detail',
  'public_storefront_pickup_options',
  'public_storefront_inventory',
  'public_storefront_equipment_inventory',
  'public_storefront_processed_poultry_inventory',
  'public_storefront_hatching_egg_inventory',
  'public_storefront_media_gallery',
  'public_storefront_processed_poultry_media_gallery'
]) as public_views(view_name);

select is(
  public.store_has_public_market_entitlement(
    'e4000000-0000-4000-8000-000000000010'
  ),
  true,
  'public active Market comp resolves to the public Market capability'
);

select is(
  public.store_has_public_market_entitlement(
    'e4000000-0000-4000-8000-000000000011'
  ),
  false,
  'inactive store does not resolve to a public Market capability'
);

select is(
  public.store_has_public_market_entitlement(
    'e4000000-0000-4000-8000-000000000012'
  ),
  false,
  'private active Market store does not disclose a public Market capability'
);

select is(
  public.store_has_public_market_entitlement(
    'e4000000-0000-4000-8000-000000000013'
  ),
  false,
  'public active Coop store remains excluded from Market-only capabilities'
);

select throws_ok(
  $$select public.get_store_plan_key(
    'e4000000-0000-4000-8000-000000000010'
  )$$,
  '42501',
  'permission denied for function get_store_plan_key',
  'anon cannot query Green Acres plan metadata directly'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (
    select count(*)
    from public.public_storefronts
    where store_id = 'e4000000-0000-4000-8000-000000000010'
  ),
  1::bigint,
  'Green Acres remains an approved public storefront'
);

select * from finish();
rollback;
