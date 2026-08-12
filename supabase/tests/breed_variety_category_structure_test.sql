begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column('public', 'breeds', 'variety', 'default breeds have Variety');
select has_column('public', 'seller_breed_profiles', 'variety', 'seller profiles have independent Variety');
select has_column('public', 'seller_breed_profiles', 'breed_category', 'seller profiles have independent Breed Category');

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

select ok(
  not exists (
    select 1 from public.breeds
    join public.species on species.id = breeds.species_id
    where species.slug = 'chicken' and breeds.bird_type = 'bantam'
  ),
  'Bantams are never stored as Bird Type'
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
