begin;

create extension if not exists pgtap with schema extensions;

select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(
  not exists (
    select 1
    from pg_proc as functions
    cross join lateral aclexplode(
      coalesce(functions.proacl, acldefault('f', functions.proowner))
    ) as privileges
    where functions.oid = (
      'public.seller_create_uploaded_hatching_egg_group_media(uuid,uuid,uuid,text,text,text,text,bigint,integer,integer,text,text,integer,boolean)'
    )::regprocedure
      and privileges.grantee = 0
      and privileges.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the deprecated hatching-egg group upload function'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.seller_create_uploaded_hatching_egg_group_media(uuid,uuid,uuid,text,text,text,text,bigint,integer,integer,text,text,integer,boolean)',
    'EXECUTE'
  ),
  'anon cannot execute the deprecated hatching-egg group upload function'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.seller_create_uploaded_hatching_egg_group_media(uuid,uuid,uuid,text,text,text,text,bigint,integer,integer,text,text,integer,boolean)',
    'EXECUTE'
  ),
  'authenticated cannot execute the deprecated hatching-egg group upload function'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.seller_create_uploaded_hatching_egg_group_media(uuid,uuid,uuid,text,text,text,text,bigint,integer,integer,text,text,integer,boolean)',
    'EXECUTE'
  ),
  'service_role cannot execute the deprecated hatching-egg group upload function'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.seller_create_uploaded_media(uuid,uuid,text,uuid,text,text,text,text,bigint,integer,integer,text,text,integer,boolean)',
    'EXECUTE'
  ),
  'the generic uploaded-media primitive remains available to service_role'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.seller_create_uploaded_media(uuid,uuid,text,uuid,text,text,text,text,bigint,integer,integer,text,text,integer,boolean)',
    'EXECUTE'
  ),
  'the generic uploaded-media primitive remains unavailable to authenticated'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.seller_sync_hatching_egg_group_media_from_item(uuid)',
    'EXECUTE'
  ),
  'authenticated retains access to hatching-egg group synchronization'
);

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
    'f1000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'hatching-media-owner@example.test',
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
    'f1000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'hatching-media-foreign@example.test',
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
    'f1000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'hatching-media-admin@example.test',
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
  hatching_eggs_enabled
)
values
  (
    'f1000000-0000-4000-8000-000000000010',
    'f1000000-0000-4000-8000-000000000001',
    'Hatching Media Owner Store',
    'hatching-media-owner-store',
    'draft',
    'hosted',
    false,
    false
  ),
  (
    'f1000000-0000-4000-8000-000000000011',
    'f1000000-0000-4000-8000-000000000002',
    'Hatching Media Foreign Store',
    'hatching-media-foreign-store',
    'draft',
    'hosted',
    false,
    false
  );

insert into public.user_roles (user_id, role, store_id)
values
  (
    'f1000000-0000-4000-8000-000000000001',
    'seller',
    'f1000000-0000-4000-8000-000000000010'
  ),
  (
    'f1000000-0000-4000-8000-000000000002',
    'seller',
    'f1000000-0000-4000-8000-000000000011'
  ),
  (
    'f1000000-0000-4000-8000-000000000003',
    'admin',
    null
  );

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  billing_state_authority
)
values
  (
    'f1000000-0000-4000-8000-000000000010',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  ),
  (
    'f1000000-0000-4000-8000-000000000011',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp(), statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days', 'trial'
  );

update public.stores
set
  store_status = 'live',
  storefront_enabled = true,
  hatching_eggs_enabled = true
where stores.id in (
  'f1000000-0000-4000-8000-000000000010',
  'f1000000-0000-4000-8000-000000000011'
);

with chicken as (
  select species.id
  from public.species
  where species.slug = 'chicken'
)
insert into public.hatching_egg_inventory_items (
  id,
  store_id,
  item_name,
  species_id,
  quantity_available,
  price,
  available_date,
  visibility_status,
  moderation_status
)
select
  fixtures.id,
  fixtures.store_id,
  fixtures.item_name,
  chicken.id,
  12,
  24.00,
  current_date,
  'active',
  'normal'
from chicken
cross join (
  values
    (
      'f1000000-0000-4000-8000-000000000020'::uuid,
      'f1000000-0000-4000-8000-000000000010'::uuid,
      'Shared Hatching Eggs'::text
    ),
    (
      'f1000000-0000-4000-8000-000000000021'::uuid,
      'f1000000-0000-4000-8000-000000000010'::uuid,
      '  shared   hatching eggs  '::text
    ),
    (
      'f1000000-0000-4000-8000-000000000022'::uuid,
      'f1000000-0000-4000-8000-000000000011'::uuid,
      'Shared Hatching Eggs'::text
    )
) as fixtures(id, store_id, item_name);

set local role service_role;

select lives_ok(
  $call$
    select *
    from public.seller_create_uploaded_media(
      'f1000000-0000-4000-8000-000000000001',
      'f1000000-0000-4000-8000-000000000010',
      'hatching_egg_inventory_item',
      'f1000000-0000-4000-8000-000000000020',
      'gallery',
      'stores/f1000000-0000-4000-8000-000000000010/images/2026/07/f1000000-0000-4000-8000-000000000030.webp',
      'owner-upload.webp',
      'image/webp',
      128,
      10,
      10,
      'Owner alt text',
      'Owner caption',
      7,
      true
    )
  $call$,
  'the legitimate service-role upload primitive remains available'
);

reset role;

select is(
  (
    select count(*)
    from public.media_assets
    where store_id = 'f1000000-0000-4000-8000-000000000010'
  ),
  1::bigint,
  'the legitimate upload creates one owner-store media asset'
);

select is(
  (
    select uploaded_by_user_id
    from public.media_assets
    where storage_path = 'stores/f1000000-0000-4000-8000-000000000010/images/2026/07/f1000000-0000-4000-8000-000000000030.webp'
  ),
  'f1000000-0000-4000-8000-000000000001'::uuid,
  'the legitimate upload records the verified owner supplied by the trusted upload boundary'
);

set local role anon;

select throws_ok(
  $call$
    select *
    from public.seller_create_uploaded_hatching_egg_group_media(
      'f1000000-0000-4000-8000-000000000001',
      'f1000000-0000-4000-8000-000000000010',
      'f1000000-0000-4000-8000-000000000020',
      'gallery',
      'stores/f1000000-0000-4000-8000-000000000010/images/2026/07/f1000000-0000-4000-8000-000000000031.webp',
      'anon-forgery.webp',
      'image/webp',
      128,
      10,
      10,
      'Forged alt text',
      'Forged caption',
      99,
      true
    )
  $call$,
  '42501',
  'permission denied for function seller_create_uploaded_hatching_egg_group_media',
  'anon direct invocation is denied'
);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'f1000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;

select throws_ok(
  $call$
    select *
    from public.seller_create_uploaded_hatching_egg_group_media(
      'f1000000-0000-4000-8000-000000000001',
      'f1000000-0000-4000-8000-000000000010',
      'f1000000-0000-4000-8000-000000000020',
      'gallery',
      'stores/f1000000-0000-4000-8000-000000000010/images/2026/07/f1000000-0000-4000-8000-000000000032.webp',
      'owner-forgery.webp',
      'image/webp',
      128,
      10,
      10,
      'Forged alt text',
      'Forged caption',
      99,
      true
    )
  $call$,
  '42501',
  'permission denied for function seller_create_uploaded_hatching_egg_group_media',
  'an authenticated foreign seller cannot forge the victim owner actor UUID'
);

select throws_ok(
  $call$
    select *
    from public.seller_create_uploaded_hatching_egg_group_media(
      'f1000000-0000-4000-8000-000000000003',
      'f1000000-0000-4000-8000-000000000010',
      'f1000000-0000-4000-8000-000000000020',
      'gallery',
      'stores/f1000000-0000-4000-8000-000000000010/images/2026/07/f1000000-0000-4000-8000-000000000033.webp',
      'admin-forgery.webp',
      'image/webp',
      128,
      10,
      10,
      'Forged admin alt text',
      'Forged admin caption',
      100,
      true
    )
  $call$,
  '42501',
  'permission denied for function seller_create_uploaded_hatching_egg_group_media',
  'an authenticated seller cannot forge a platform-admin actor UUID'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select throws_ok(
  $call$
    select *
    from public.seller_create_uploaded_hatching_egg_group_media(
      'f1000000-0000-4000-8000-000000000001',
      'f1000000-0000-4000-8000-000000000010',
      'f1000000-0000-4000-8000-000000000020',
      'gallery',
      'stores/f1000000-0000-4000-8000-000000000010/images/2026/07/f1000000-0000-4000-8000-000000000034.webp',
      'service-role-forgery.webp',
      'image/webp',
      128,
      10,
      10,
      'Forged service alt text',
      'Forged service caption',
      101,
      true
    )
  $call$,
  '42501',
  'permission denied for function seller_create_uploaded_hatching_egg_group_media',
  'service_role direct invocation is denied'
);

reset role;

select is(
  (
    select count(*)
    from public.media_assets
    where store_id = 'f1000000-0000-4000-8000-000000000010'
  ),
  1::bigint,
  'denied invocations create no additional media assets'
);

select is(
  (
    select count(*)
    from public.media_assets
    where storage_path in (
      'stores/f1000000-0000-4000-8000-000000000010/images/2026/07/f1000000-0000-4000-8000-000000000031.webp',
      'stores/f1000000-0000-4000-8000-000000000010/images/2026/07/f1000000-0000-4000-8000-000000000032.webp',
      'stores/f1000000-0000-4000-8000-000000000010/images/2026/07/f1000000-0000-4000-8000-000000000033.webp',
      'stores/f1000000-0000-4000-8000-000000000010/images/2026/07/f1000000-0000-4000-8000-000000000034.webp'
    )
  ),
  0::bigint,
  'denied invocations persist none of their forged storage metadata'
);

select is(
  (
    select count(*)
    from public.media_links
    where store_id = 'f1000000-0000-4000-8000-000000000010'
  ),
  1::bigint,
  'denied invocations create no additional media links'
);

select results_eq(
  $test$
    select
      media_links.entity_id,
      media_links.sort_order,
      media_links.is_featured,
      media_links.caption
    from public.media_links
    where media_links.store_id = 'f1000000-0000-4000-8000-000000000010'
      and media_links.entity_type = 'hatching_egg_inventory_item'
      and media_links.visibility_status = 'active'
  $test$,
  $expected$
    values (
      'f1000000-0000-4000-8000-000000000020'::uuid,
      7,
      true,
      'Owner caption'::text
    )
  $expected$,
  'denied invocations do not change attachment, sort order, featured state, or caption'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'f1000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $call$
    select *
    from public.seller_sync_hatching_egg_group_media_from_item(
      'f1000000-0000-4000-8000-000000000020'
    )
  $call$,
  'the legitimate owner can synchronize their hatching-egg media group'
);

reset role;

select results_eq(
  $test$
    select
      media_links.entity_id,
      media_links.sort_order,
      media_links.is_featured,
      media_links.caption
    from public.media_links
    where media_links.store_id = 'f1000000-0000-4000-8000-000000000010'
      and media_links.entity_type = 'hatching_egg_inventory_item'
      and media_links.visibility_status = 'active'
    order by media_links.entity_id
  $test$,
  $expected$
    values
      (
        'f1000000-0000-4000-8000-000000000020'::uuid,
        7,
        true,
        'Owner caption'::text
      ),
      (
        'f1000000-0000-4000-8000-000000000021'::uuid,
        7,
        true,
        'Owner caption'::text
      )
  $expected$,
  'owner synchronization copies the media set only across the normalized same-store group'
);

select is(
  (
    select count(*)
    from public.media_links
    where store_id = 'f1000000-0000-4000-8000-000000000011'
      and entity_id = 'f1000000-0000-4000-8000-000000000022'
  ),
  0::bigint,
  'same-name hatching-egg groups in a foreign store receive no media'
);

select set_config(
  'request.jwt.claim.sub',
  'f1000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;

select throws_ok(
  $call$
    select *
    from public.seller_sync_hatching_egg_group_media_from_item(
      'f1000000-0000-4000-8000-000000000020'
    )
  $call$,
  'P0001',
  'Hatching egg item not found',
  'a foreign seller cannot synchronize another store hatching-egg media group'
);

reset role;

select is(
  (
    select count(*)
    from public.media_links
    where store_id = 'f1000000-0000-4000-8000-000000000010'
      and entity_type = 'hatching_egg_inventory_item'
      and visibility_status = 'active'
  ),
  2::bigint,
  'the denied foreign synchronization causes no partial media-link mutation'
);

select set_config(
  'request.jwt.claim.sub',
  'f1000000-0000-4000-8000-000000000003',
  true
);
set local role authenticated;

select lives_ok(
  $call$
    select *
    from public.seller_sync_hatching_egg_group_media_from_item(
      'f1000000-0000-4000-8000-000000000020'
    )
  $call$,
  'a real platform administrator can synchronize hatching-egg media'
);

select is(
  current_setting('request.jwt.claim.sub', true),
  'f1000000-0000-4000-8000-000000000003',
  'the administrator operation retains the real authenticated administrator identity'
);

reset role;

select is(
  (
    select count(*)
    from public.media_links
    where store_id = 'f1000000-0000-4000-8000-000000000011'
      and entity_id = 'f1000000-0000-4000-8000-000000000022'
  ),
  0::bigint,
  'administrator synchronization still scopes same-name groups to the target store'
);

select * from finish();

rollback;
