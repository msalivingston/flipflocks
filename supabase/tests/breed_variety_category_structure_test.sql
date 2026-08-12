begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column('public', 'breeds', 'variety', 'default breeds have Variety');
select has_column('public', 'seller_breed_profiles', 'variety', 'seller profiles have independent Variety');
select has_column('public', 'seller_breed_profiles', 'breed_category', 'seller profiles have independent Breed Category');
select hasnt_column('public', 'breeds', 'bird_type', 'default breeds no longer store legacy Bird Type');
select hasnt_column('public', 'seller_breed_profiles', 'bird_type', 'seller profiles no longer store legacy Bird Type');
select has_function(
  'public',
  'admin_delete_default_catalog_breed',
  array['uuid'],
  'hard-delete RPC remains installed after legacy Bird Type removal'
);

select ok(
  strpos(
    lower(pg_get_functiondef('public.admin_delete_default_catalog_breed(uuid)'::regprocedure)),
    'update public.seller_breed_profiles'
  ) > 0
  and strpos(
    lower(pg_get_functiondef('public.admin_delete_default_catalog_breed(uuid)'::regprocedure)),
    'breed_id = null'
  ) > 0,
  'hard delete still explicitly detaches seller profiles before deleting a default breed'
);

select ok(
  strpos(
    pg_get_functiondef('public.admin_delete_default_catalog_breed(uuid)'::regprocedure),
    'bird_type'
  ) = 0,
  'hard-delete RPC has no legacy Bird Type dependency'
);

select is(
  (
    select columns.column_name::text
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.table_name = 'public_storefront_inventory'
      and columns.ordinal_position = 28
  ),
  'breed_category',
  'storefront keeps its ordered metadata slot and exposes seller Breed Category'
);

select ok(
  strpos(
    pg_get_viewdef('public.public_storefront_inventory'::regclass, true),
    'seller_breed_profiles.breed_category'
  ) > 0
  and strpos(
    pg_get_viewdef('public.public_storefront_inventory'::regclass, true),
    'seller_breed_profiles.bird_type'
  ) = 0,
  'storefront Purpose source is seller-owned Breed Category only'
);

select ok(
  strpos(
    pg_get_functiondef('public.get_seller_storefront_preview_data(text)'::regprocedure),
    'seller_breed_profiles.breed_category'
  ) > 0
  and strpos(
    pg_get_functiondef('public.get_seller_storefront_preview_data(text)'::regprocedure),
    'bird_type'
  ) = 0,
  'seller preview uses seller-owned Breed Category without Bird Type'
);

select is(
  (select breed_name from public.breeds where breed_slug = 'ameraucana-black'),
  'Ameraucana',
  'curated combined name is backfilled to Base Breed'
);

select is(
  (select variety from public.breeds where breed_slug = 'ameraucana-black'),
  'Black',
  'curated combined name is backfilled to Variety'
);

select is(
  (select category from public.breeds where breed_slug = 'ameraucana-black'),
  'Layers',
  'Breed Category is preserved during identity backfill'
);

select ok(
  not exists (
    select 1
    from public.breeds
    join public.species on species.id = breeds.species_id
    where species.slug = 'chicken'
      and breeds.is_active = true
      and breeds.breed_name like '% - %'
  ),
  'active chicken base Breed names no longer contain the exact variety separator'
);

select ok(
  not exists (
    select 1 from public.breeds
    join public.species on species.id = breeds.species_id
    where species.slug = 'chicken'
      and breeds.category not in (
        'Layers', 'Bantams', 'Specialty / Project', 'Meat Birds', 'Dual Purpose'
      )
  ),
  'chicken Breed Categories use only the finalized five values'
);

select throws_ok(
  $$update public.breeds set category = 'Gamebird' where breed_slug = 'ameraucana-black'$$,
  'P0001',
  'Chicken Breed Category must use a finalized controlled value.',
  'database validation rejects non-finalized chicken Breed Categories'
);

select ok(
  exists (
    select 1 from public.breeds
    join public.species on species.id = breeds.species_id
    where species.slug <> 'chicken' and breeds.category is not null
  ),
  'existing non-chicken taxonomy remains supported'
);

select has_check(
  'public',
  'seller_breed_profiles',
  'seller profiles enforce controlled Breed Category values'
);

select * from finish();
rollback;
