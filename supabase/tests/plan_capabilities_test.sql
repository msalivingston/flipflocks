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
  'e3000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'plan-capability-owner@example.test',
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
  storefront_enabled
)
values
  (
    'e3000000-0000-4000-8000-000000000010',
    'e3000000-0000-4000-8000-000000000001',
    'Missing Plan Store',
    'missing-plan-store',
    'live',
    'hosted',
    true
  ),
  (
    'e3000000-0000-4000-8000-000000000011',
    'e3000000-0000-4000-8000-000000000001',
    'Coop Plan Store',
    'coop-plan-store',
    'live',
    'hosted',
    true
  ),
  (
    'e3000000-0000-4000-8000-000000000012',
    'e3000000-0000-4000-8000-000000000001',
    'Market Plan Store',
    'market-plan-store',
    'live',
    'hosted',
    true
  ),
  (
    'e3000000-0000-4000-8000-000000000013',
    'e3000000-0000-4000-8000-000000000001',
    'Null Plan Store',
    'null-plan-store',
    'live',
    'hosted',
    true
  ),
  (
    'e3000000-0000-4000-8000-000000000014',
    'e3000000-0000-4000-8000-000000000001',
    'Malformed Plan Store',
    'malformed-plan-store',
    'live',
    'hosted',
    true
  ),
  (
    'e3000000-0000-4000-8000-000000000015',
    'e3000000-0000-4000-8000-000000000001',
    'Future Plan Store',
    'future-plan-store',
    'live',
    'hosted',
    true
  );

-- Production constraints prevent invalid persisted keys. Relax them only
-- inside this rolled-back test transaction to exercise defensive resolution.
alter table public.seller_billing_status
  drop constraint seller_billing_status_plan_key_check;
alter table public.seller_billing_status
  alter column plan_key drop not null;

insert into public.seller_billing_status (
  store_id,
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
    'e3000000-0000-4000-8000-000000000011',
    'small_flock',
    'comped',
    'comped',
    statement_timestamp() + interval '30 days',
    'admin_comp',
    'e3000000-0000-4000-8000-000000000001',
    'Plan capability test fixture',
    statement_timestamp(),
    statement_timestamp() + interval '30 days'
  ),
  (
    'e3000000-0000-4000-8000-000000000012',
    'full_flock',
    'comped',
    'comped',
    statement_timestamp() + interval '30 days',
    'admin_comp',
    'e3000000-0000-4000-8000-000000000001',
    'Plan capability test fixture',
    statement_timestamp(),
    statement_timestamp() + interval '30 days'
  );

insert into public.seller_billing_status (store_id, plan_key)
values
  ('e3000000-0000-4000-8000-000000000013', null),
  ('e3000000-0000-4000-8000-000000000014', ' FULL_FLOCK '),
  ('e3000000-0000-4000-8000-000000000015', 'future_market_plan');

select is(
  public.get_store_plan_key('e3000000-0000-4000-8000-000000000010'),
  'small_flock',
  'a missing billing row resolves to Coop'
);
select is(
  public.get_store_plan_key('e3000000-0000-4000-8000-000000000013'),
  'small_flock',
  'a null plan key resolves to Coop'
);
select is(
  public.get_store_plan_key('e3000000-0000-4000-8000-000000000014'),
  'small_flock',
  'a malformed plan key resolves to Coop'
);
select is(
  public.get_store_plan_key('e3000000-0000-4000-8000-000000000015'),
  'small_flock',
  'an unknown future plan key resolves to Coop'
);
select is(
  public.get_store_plan_key('e3000000-0000-4000-8000-000000000012'),
  'full_flock',
  'a configured Market plan retains Market capabilities'
);
select is(
  public.get_store_plan_key('e3000000-0000-4000-8000-000000000011'),
  'small_flock',
  'a configured Coop plan retains Coop restrictions'
);
select is(
  (
    select column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'seller_billing_status'
      and column_name = 'plan_key'
  ),
  '''small_flock''::text',
  'an omitted plan key defaults to Coop at the table boundary'
);

select set_config(
  'request.jwt.claim.sub',
  'e3000000-0000-4000-8000-000000000001',
  true
);
select is(
  (
    select plan_key
    from public.get_seller_context()
    where store_id = 'e3000000-0000-4000-8000-000000000010'
  ),
  null::text,
  'seller context exposes no effective plan for a store without entitlement'
);
select is(
  (
    select plan_key
    from public.get_seller_context()
    where store_id = 'e3000000-0000-4000-8000-000000000011'
  ),
  'small_flock',
  'seller context exposes Coop for an active entitled Coop store'
);

select throws_ok(
  $$select public.assert_store_plan_allows_store_modules(
    'e3000000-0000-4000-8000-000000000011', true, false, false
  )$$,
  'P0001',
  'Coop includes live birds only. Upgrade to Market to enable hatching eggs, equipment, or processed poultry.',
  'Coop rejects the Hatching Eggs module'
);
select throws_ok(
  $$select public.assert_store_plan_allows_store_modules(
    'e3000000-0000-4000-8000-000000000011', false, true, false
  )$$,
  'P0001',
  'Coop includes live birds only. Upgrade to Market to enable hatching eggs, equipment, or processed poultry.',
  'Coop rejects the Equipment module'
);
select throws_ok(
  $$select public.assert_store_plan_allows_store_modules(
    'e3000000-0000-4000-8000-000000000011', false, false, true
  )$$,
  'P0001',
  'Coop includes live birds only. Upgrade to Market to enable hatching eggs, equipment, or processed poultry.',
  'Coop rejects the Poultry Products module'
);
select lives_ok(
  $$select public.assert_store_plan_allows_store_modules(
    'e3000000-0000-4000-8000-000000000012', true, true, true
  )$$,
  'Market permits all optional store modules'
);

select lives_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000011', null, 'live_animals',
    'female', null, 1, 'hidden', null
  )$$,
  'Coop supports female offerings'
);
select lives_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000011', null, 'live_animals',
    'male', null, 1, 'hidden', null
  )$$,
  'Coop supports male offerings'
);
select lives_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000011', null, 'live_animals',
    'straight_run', null, 1, 'hidden', null
  )$$,
  'Coop supports straight-run offerings'
);
select lives_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000011', null, 'live_animals',
    'unsexed', null, 1, 'hidden', null
  )$$,
  'Coop supports unsexed offerings'
);
select lives_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000011', null, 'live_animals',
    'pair', null, 1, 'hidden', null
  )$$,
  'Coop supports pair offerings'
);
select lives_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000011', null, 'live_animals',
    'trio', null, 1, 'hidden', null
  )$$,
  'Coop supports trio offerings'
);
select throws_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000011', null, 'live_animals',
    'flock', null, 1, 'hidden', null
  )$$,
  'P0001',
  'This live bird offering is included with Market.',
  'Coop rejects flock offerings'
);
select throws_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000011', null, 'live_animals',
    'other', 'Custom group', 1, 'hidden', null
  )$$,
  'P0001',
  'Flock and group listings are included with Market. Coop supports single birds, pairs, and trios.',
  'Coop rejects custom group offerings'
);
select throws_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000011', null, 'hatching_eggs',
    'hatching_eggs', null, 6, 'hidden', null
  )$$,
  'P0001',
  'Hatching egg listings are included with Market.',
  'Coop rejects Hatching Egg inventory'
);
select lives_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000012', null, 'hatching_eggs',
    'hatching_eggs', null, 6, 'active', null
  )$$,
  'Market permits Hatching Egg inventory'
);

select is(public.live_bird_plan_units('pair', 2), 4, 'two pairs count as four birds');
select is(public.live_bird_plan_units('trio', 1), 3, 'one trio counts as three birds');
select is(public.live_bird_plan_units('female', 4), 4, 'four singles count as four birds');
select is(public.live_bird_plan_units('female', 5), 5, 'five singles count as five birds');

insert into public.seller_breed_profiles (
  id,
  store_id,
  species_id,
  custom_breed_name,
  normalized_custom_breed_name,
  display_name,
  visibility_status,
  moderation_status
)
select
  'e3000000-0000-4000-8000-000000000020',
  'e3000000-0000-4000-8000-000000000011',
  species.id,
  'Plan Test Chicken',
  'plan test chicken',
  'Plan Test Chicken',
  'active',
  'normal'
from public.species
where species.slug = 'chicken';

insert into public.listing_batches (
  id,
  store_id,
  species_id,
  origin_date,
  available_date,
  base_price,
  batch_type,
  visibility_status,
  moderation_status
)
select
  batches.id,
  'e3000000-0000-4000-8000-000000000011',
  species.id,
  current_date - 30,
  current_date,
  10,
  'live_animals',
  batches.visibility_status,
  'normal'
from public.species
cross join (
  values
    ('e3000000-0000-4000-8000-000000000030'::uuid, 'active'::text),
    ('e3000000-0000-4000-8000-000000000032'::uuid, 'hidden'::text)
) as batches(id, visibility_status)
where species.slug = 'chicken';

insert into public.listing_batch_breeds (
  id,
  store_id,
  listing_batch_id,
  seller_breed_profile_id,
  visibility_status,
  moderation_status
)
values
  (
    'e3000000-0000-4000-8000-000000000031',
    'e3000000-0000-4000-8000-000000000011',
    'e3000000-0000-4000-8000-000000000030',
    'e3000000-0000-4000-8000-000000000020',
    'active',
    'normal'
  ),
  (
    'e3000000-0000-4000-8000-000000000033',
    'e3000000-0000-4000-8000-000000000011',
    'e3000000-0000-4000-8000-000000000032',
    'e3000000-0000-4000-8000-000000000020',
    'active',
    'normal'
  );

select lives_ok(
  $$insert into public.inventory_items (
    id, store_id, listing_batch_id, listing_batch_breed_id,
    inventory_type, quantity_available, visibility_status
  ) values (
    'e3000000-0000-4000-8000-000000000040',
    'e3000000-0000-4000-8000-000000000011',
    'e3000000-0000-4000-8000-000000000030',
    'e3000000-0000-4000-8000-000000000031',
    'female', 4, 'active'
  )$$,
  'Coop permits four active units'
);
select lives_ok(
  $$insert into public.inventory_items (
    id, store_id, listing_batch_id, listing_batch_breed_id,
    inventory_type, quantity_available, visibility_status
  ) values (
    'e3000000-0000-4000-8000-000000000041',
    'e3000000-0000-4000-8000-000000000011',
    'e3000000-0000-4000-8000-000000000030',
    'e3000000-0000-4000-8000-000000000031',
    'male', 1, 'active'
  )$$,
  'Coop permits exactly five active units'
);
select is(
  public.small_flock_active_live_bird_units(
    'e3000000-0000-4000-8000-000000000011'
  ),
  5,
  'the active Coop unit counter reports the five-unit boundary'
);
select throws_ok(
  $$insert into public.inventory_items (
    id, store_id, listing_batch_id, listing_batch_breed_id,
    inventory_type, quantity_available, visibility_status
  ) values (
    'e3000000-0000-4000-8000-000000000042',
    'e3000000-0000-4000-8000-000000000011',
    'e3000000-0000-4000-8000-000000000030',
    'e3000000-0000-4000-8000-000000000031',
    'female', 1, 'active'
  )$$,
  'P0001',
  'Coop includes up to 5 active birds for sale at one time. Upgrade to Market for unlimited live bird quantities.',
  'Coop rejects an attempt to exceed five active units'
);
select lives_ok(
  $$insert into public.inventory_items (
    id, store_id, listing_batch_id, listing_batch_breed_id,
    inventory_type, quantity_available, visibility_status
  ) values (
    'e3000000-0000-4000-8000-000000000043',
    'e3000000-0000-4000-8000-000000000011',
    'e3000000-0000-4000-8000-000000000032',
    'e3000000-0000-4000-8000-000000000033',
    'trio', 2, 'active'
  )$$,
  'a hidden listing may retain more than five draft units'
);
select throws_ok(
  $$update public.listing_batches
    set visibility_status = 'active'
    where id = 'e3000000-0000-4000-8000-000000000032'$$,
  'P0001',
  'Coop includes up to 5 active birds for sale at one time. Upgrade to Market for unlimited live bird quantities.',
  'activating a hidden listing rechecks the Coop unit limit'
);
select lives_ok(
  $$insert into public.inventory_items (
    id, store_id, listing_batch_id, listing_batch_breed_id,
    inventory_type, quantity_available, visibility_status
  ) values (
    'e3000000-0000-4000-8000-000000000044',
    'e3000000-0000-4000-8000-000000000011',
    'e3000000-0000-4000-8000-000000000030',
    'e3000000-0000-4000-8000-000000000031',
    'unsexed', 100, 'hidden'
  )$$,
  'a hidden inventory row may retain draft quantity'
);
select throws_ok(
  $$update public.inventory_items
    set visibility_status = 'active'
    where id = 'e3000000-0000-4000-8000-000000000044'$$,
  'P0001',
  'Coop includes up to 5 active birds for sale at one time. Upgrade to Market for unlimited live bird quantities.',
  'activating hidden inventory rechecks the Coop unit limit'
);
select lives_ok(
  $$select public.assert_store_plan_allows_inventory_item(
    'e3000000-0000-4000-8000-000000000012', null, 'live_animals',
    'female', null, 100, 'active', null
  )$$,
  'Market retains unlimited active Live Birds units'
);

update public.stores
set
  equipment_supplies_enabled = true,
  hatching_eggs_enabled = true
where id = 'e3000000-0000-4000-8000-000000000012';

insert into public.equipment_inventory_items (
  id,
  store_id,
  item_name,
  category,
  quantity_available,
  price,
  visibility_status,
  moderation_status,
  available_date
)
values (
  'e3000000-0000-4000-8000-000000000050',
  'e3000000-0000-4000-8000-000000000012',
  'Plan Test Feeder',
  'Feeders & Waterers',
  1,
  20,
  'active',
  'normal',
  current_date
);

select ok(
  exists (
    select 1
    from public.public_storefront_equipment_inventory
    where equipment_inventory_item_id = 'e3000000-0000-4000-8000-000000000050'
  ),
  'a configured Market item remains visible in its public module'
);

delete from public.seller_billing_status
where store_id = 'e3000000-0000-4000-8000-000000000012';

select lives_ok(
  $$update public.equipment_inventory_items
    set quantity_available = 0, visibility_status = 'hidden'
    where id = 'e3000000-0000-4000-8000-000000000050'$$,
  'an inactive seller may reduce and hide existing inventory'
);
select throws_ok(
  $$update public.equipment_inventory_items
    set quantity_available = 1
    where id = 'e3000000-0000-4000-8000-000000000050'$$,
  'P0001',
  'Active selling access is required.',
  'an inactive seller cannot increase inventory'
);

select throws_ok(
  $$select public.validate_hatching_eggs_module_enabled(
    'e3000000-0000-4000-8000-000000000012'
  )$$,
  'P0001',
  'Active selling access is required.',
  'standalone Hatching Egg writes reject missing active entitlement'
);

select ok(
  not exists (
    select 1
    from public.public_storefront_equipment_inventory
    where equipment_inventory_item_id = 'e3000000-0000-4000-8000-000000000050'
  ),
  'a missing plan row fails closed in public module inventory'
);

select ok(
  position(
    'get_store_plan_key' in
    pg_get_viewdef('public.public_storefront_hatching_egg_inventory'::regclass, true)
  ) > 0,
  'the Hatching Eggs public view uses the database plan authority'
);
select ok(
  position(
    'get_store_plan_key' in
    pg_get_viewdef('public.public_storefront_media_gallery'::regclass, true)
  ) > 0,
  'the public media gallery uses the database plan authority for gated media'
);
select ok(
  position(
    'get_store_plan_key' in
    pg_get_functiondef(
      'public.seller_save_onboarding_categories(jsonb)'::regprocedure
    )
  ) > 0,
  'onboarding category enforcement uses the database plan authority'
);

select * from finish();
rollback;
