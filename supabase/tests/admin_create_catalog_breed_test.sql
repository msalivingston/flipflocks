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
    'ac000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'catalog-admin@example.test',
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
    'ac000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'catalog-non-admin@example.test',
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

insert into public.user_roles (user_id, role, store_id)
values ('ac000000-0000-4000-8000-000000000001', 'admin', null);

insert into public.species (id, common_name, slug, sort_order, is_active)
values
  (
    'ac000000-0000-4000-8000-000000000010',
    'Catalog Test Chicken',
    'catalog-test-chicken',
    990,
    true
  ),
  (
    'ac000000-0000-4000-8000-000000000011',
    'Catalog Test Duck',
    'catalog-test-duck',
    991,
    true
  ),
  (
    'ac000000-0000-4000-8000-000000000012',
    'Inactive Catalog Test Species',
    'inactive-catalog-test-species',
    992,
    false
  );

-- The chicken-only category trigger keys from the canonical chicken slug, so
-- use the production chicken species for chicken-specific validation tests.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'ac000000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  $$select public.admin_create_catalog_breed(
    (select id from public.species where slug = 'chicken'),
    'Codex Admin Test Silkie',
    'White',
    'Bantams',
    null,
    null,
    null
  )$$,
  'P0001',
  'Not authorized to create platform catalog breeds.',
  'an authenticated non-admin cannot create a catalog breed'
);

select set_config(
  'request.jwt.claim.sub',
  'ac000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$select public.admin_create_catalog_breed(
    'ac000000-0000-4000-8000-000000000012',
    'Inactive Species Breed',
    null,
    null,
    null,
    null,
    null
  )$$,
  'P0001',
  'Choose an active species.',
  'inactive species are rejected'
);

select throws_ok(
  $$select public.admin_create_catalog_breed(
    (select id from public.species where slug = 'chicken'),
    'Codex Admin Test Missing Category',
    null,
    null,
    null,
    null,
    null
  )$$,
  'P0001',
  'Choose a Breed Category for this chicken breed.',
  'chicken breeds require a controlled category'
);

select throws_ok(
  $$select public.admin_create_catalog_breed(
    (select id from public.species where slug = 'chicken'),
    'Codex Admin Test Invalid Metadata',
    null,
    'Bantams',
    'purple',
    null,
    null
  )$$,
  'P0001',
  'Choose a supported egg color.',
  'unsupported controlled metadata is rejected'
);

select throws_ok(
  $$select public.admin_create_catalog_breed(
    'ac000000-0000-4000-8000-000000000010',
    'Codex Admin Test Long Variety',
    repeat('v', 121),
    null,
    null,
    null,
    null
  )$$,
  'P0001',
  'Variety must be 120 characters or less.',
  'the database Variety limit is validated'
);

select throws_ok(
  $$select public.admin_create_catalog_breed(
    'ac000000-0000-4000-8000-000000000010',
    'Codex Admin Test Long Description',
    null,
    null,
    null,
    null,
    repeat('d', 1501)
  )$$,
  'P0001',
  'Catalog description must be 1500 characters or less.',
  'the shared catalog description limit is validated'
);

select is(
  (
    select breed_slug
    from public.admin_create_catalog_breed(
      (select id from public.species where slug = 'chicken'),
      '  Codex Admin Test Silkie  ',
      '  White  ',
      'Bantams',
      'light_brown',
      'under_150',
      '  Canonical catalog description.  '
    )
  ),
  'codex-admin-test-silkie-white',
  'the server generates a deterministic Breed plus Variety slug'
);

select results_eq(
  $$
    select
      breed_name,
      variety,
      description,
      category,
      egg_color,
      annual_egg_production,
      is_active,
      is_custom,
      sort_order
    from public.breeds
    where breed_slug = 'codex-admin-test-silkie-white'
  $$,
  $$values (
    'Codex Admin Test Silkie'::text,
    'White'::text,
    'Canonical catalog description.'::text,
    'Bantams'::text,
    'light_brown'::text,
    'under_150'::text,
    true,
    false,
    0
  )$$,
  'creation writes one canonical active non-custom catalog row using defaults'
);

select lives_ok(
  $$select public.admin_create_catalog_breed(
    (select id from public.species where slug = 'chicken'),
    'Codex Admin Test Silkie',
    'Black',
    'Bantams',
    null,
    null,
    null
  )$$,
  'a different Variety is a distinct catalog identity'
);

select throws_ok(
  $$select public.admin_create_catalog_breed(
    (select id from public.species where slug = 'chicken'),
    'codex   admin test silkie',
    ' white ',
    'Bantams',
    null,
    null,
    null
  )$$,
  '23505',
  'A catalog breed with this Breed and Variety already exists for the selected species.',
  'duplicate identity comparison is exact after case and whitespace normalization'
);

select lives_ok(
  $$select public.admin_create_catalog_breed(
    'ac000000-0000-4000-8000-000000000011',
    'Codex Admin Test Runner',
    null,
    'Layers',
    'brown',
    'over_300',
    'A non-chicken catalog breed.'
  )$$,
  'an active non-chicken species can receive a catalog breed'
);

select results_eq(
  $$
    select category, egg_color, annual_egg_production
    from public.breeds
    where breed_slug = 'codex-admin-test-runner'
  $$,
  $$values (null::text, null::text, null::text)$$,
  'chicken-only metadata is cleared for non-chicken breeds'
);

select is(
  (
    select count(*)
    from public.seller_breed_profiles
    where display_name ilike 'Codex Admin Test%'
  ),
  0::bigint,
  'catalog creation creates no seller breed profiles'
);

select is(
  (
    select count(*)
    from public.breed_aliases
    join public.breeds on breeds.id = breed_aliases.breed_id
    where breeds.breed_name ilike 'Codex Admin Test%'
  ),
  0::bigint,
  'catalog creation creates no breed aliases'
);

select * from finish();
rollback;
