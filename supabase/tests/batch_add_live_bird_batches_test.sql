begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

grant select on public.species, public.inventory_items, public.listing_batches
to authenticated;

select ok(
  has_function_privilege(
    'authenticated',
    'public.seller_create_live_bird_batches(uuid,uuid,jsonb)',
    'execute'
  ),
  'authenticated sellers can execute the Batch Add RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.seller_create_live_bird_batches(uuid,uuid,jsonb)',
    'execute'
  ),
  'anonymous buyers cannot execute the Batch Add RPC'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.live_bird_batch_requests', 'select'
  ),
  'the idempotency ledger is not directly readable by sellers'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('e2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'batch-owner@example.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(), '', '', '', ''),
  ('e2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'other-owner@example.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(), '', '', '', '');

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled
) values
  ('e2000000-0000-4000-8000-000000000010', 'e2000000-0000-4000-8000-000000000001',
   'Atomic Batch Farm', 'atomic-batch-farm', 'live', 'hosted', true),
  ('e2000000-0000-4000-8000-000000000011', 'e2000000-0000-4000-8000-000000000002',
   'Other Batch Farm', 'other-batch-farm', 'live', 'hosted', true),
  ('e2000000-0000-4000-8000-000000000012', 'e2000000-0000-4000-8000-000000000001',
   'Coop Limit Farm', 'coop-limit-farm', 'live', 'hosted', true);

insert into public.seller_billing_status (
  store_id, plan_key, billing_plan, subscription_status,
  storefront_access_until, billing_state_authority,
  comp_granted_by_user_id, comp_grant_reason, comp_granted_at, comp_access_until
) values
  ('e2000000-0000-4000-8000-000000000010', 'full_flock', 'comped', 'comped',
   statement_timestamp() + interval '30 days', 'admin_comp',
   'e2000000-0000-4000-8000-000000000001', 'Batch Add test', now(),
   statement_timestamp() + interval '30 days'),
  ('e2000000-0000-4000-8000-000000000012', 'small_flock', 'comped', 'comped',
   statement_timestamp() + interval '30 days', 'admin_comp',
   'e2000000-0000-4000-8000-000000000001', 'Batch Add limit test', now(),
   statement_timestamp() + interval '30 days');

insert into public.seller_breed_profiles (
  id, store_id, species_id, custom_breed_name, normalized_custom_breed_name,
  display_name, seller_description, visibility_status, moderation_status
)
select fixture.id, fixture.store_id, species.id, fixture.name, lower(fixture.name),
  fixture.name, fixture.description, 'active', 'normal'
from public.species
cross join (values
  ('e2000000-0000-4000-8000-000000000020'::uuid, 'e2000000-0000-4000-8000-000000000010'::uuid, 'Barred Rock Batch', 'Buyer-ready Barred Rock description.'),
  ('e2000000-0000-4000-8000-000000000021'::uuid, 'e2000000-0000-4000-8000-000000000010'::uuid, 'Rhode Island Batch', 'Buyer-ready Rhode Island description.'),
  ('e2000000-0000-4000-8000-000000000022'::uuid, 'e2000000-0000-4000-8000-000000000011'::uuid, 'Other Store Breed', 'Buyer-ready other-store description.'),
  ('e2000000-0000-4000-8000-000000000023'::uuid, 'e2000000-0000-4000-8000-000000000012'::uuid, 'Coop Limit Breed', 'Buyer-ready Coop description.')
) as fixture(id, store_id, name, description)
where species.slug = 'chicken';

insert into public.media_assets (
  id, store_id, uploaded_by_user_id, bucket_name, storage_path,
  original_filename, content_type, file_size_bytes, moderation_status
) values
  ('e2000000-0000-4000-8000-000000000030', 'e2000000-0000-4000-8000-000000000010', 'e2000000-0000-4000-8000-000000000001', 'seller-media', 'batch/a.jpg', 'a.jpg', 'image/jpeg', 100, 'approved'),
  ('e2000000-0000-4000-8000-000000000031', 'e2000000-0000-4000-8000-000000000010', 'e2000000-0000-4000-8000-000000000001', 'seller-media', 'batch/b.jpg', 'b.jpg', 'image/jpeg', 100, 'approved'),
  ('e2000000-0000-4000-8000-000000000032', 'e2000000-0000-4000-8000-000000000011', 'e2000000-0000-4000-8000-000000000002', 'seller-media', 'batch/c.jpg', 'c.jpg', 'image/jpeg', 100, 'approved'),
  ('e2000000-0000-4000-8000-000000000033', 'e2000000-0000-4000-8000-000000000012', 'e2000000-0000-4000-8000-000000000001', 'seller-media', 'batch/d.jpg', 'd.jpg', 'image/jpeg', 100, 'approved');

insert into public.media_links (
  store_id, media_asset_id, entity_type, entity_id, visibility_status
) values
  ('e2000000-0000-4000-8000-000000000010', 'e2000000-0000-4000-8000-000000000030', 'seller_breed_profile', 'e2000000-0000-4000-8000-000000000020', 'active'),
  ('e2000000-0000-4000-8000-000000000010', 'e2000000-0000-4000-8000-000000000031', 'seller_breed_profile', 'e2000000-0000-4000-8000-000000000021', 'active'),
  ('e2000000-0000-4000-8000-000000000011', 'e2000000-0000-4000-8000-000000000032', 'seller_breed_profile', 'e2000000-0000-4000-8000-000000000022', 'active'),
  ('e2000000-0000-4000-8000-000000000012', 'e2000000-0000-4000-8000-000000000033', 'seller_breed_profile', 'e2000000-0000-4000-8000-000000000023', 'active');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
set local role authenticated;

create temporary table batch_input on commit drop as
select jsonb_build_array(
    jsonb_build_object(
      'client_hatch_group_token', 'hatch-a',
      'species_id', (select id from public.species where slug = 'chicken'),
      'hatch_date', '2026-05-15', 'available_date', '2026-06-15',
      'base_price', 8,
      'automatic_pricing', jsonb_build_object(
        'enabled', true, 'direction', 'increase', 'amount', 1,
        'interval_weeks', 1, 'maximum_price', 25, 'minimum_price', null
      ),
      'breed_groups', jsonb_build_array(
        jsonb_build_object(
          'seller_breed_profile_id', 'e2000000-0000-4000-8000-000000000020',
          'inventory_items', jsonb_build_array(
            jsonb_build_object('client_row_token', 'row-a', 'inventory_type', 'female', 'quantity_available', 5, 'starting_price', 18, 'barn_location', ' Barn A '),
            jsonb_build_object('client_row_token', 'row-b', 'inventory_type', 'female', 'quantity_available', 20, 'starting_price', 8, 'barn_location', 'Barn B')
          )
        )
      )
    ),
    jsonb_build_object(
      'client_hatch_group_token', 'hatch-b',
      'species_id', (select id from public.species where slug = 'chicken'),
      'hatch_date', '2026-05-20', 'available_date', '2026-06-20',
      'base_price', 17,
      'automatic_pricing', jsonb_build_object('enabled', false),
      'breed_groups', jsonb_build_array(
        jsonb_build_object(
          'seller_breed_profile_id', 'e2000000-0000-4000-8000-000000000021',
          'inventory_items', jsonb_build_array(
            jsonb_build_object('client_row_token', 'row-c', 'inventory_type', 'male', 'quantity_available', 10, 'starting_price', 17, 'barn_location', null)
          )
        )
      )
    )
  ) as payload;

create temporary table batch_result on commit drop as
select * from public.seller_create_live_bird_batches(
  'e2000000-0000-4000-8000-000000000010',
  'e2000000-0000-4000-8000-000000000100',
  (select payload from batch_input)
);

select ok((select ok from batch_result), 'one request creates multiple hatch groups atomically');
select is((select result ->> 'hatch_groups_created' from batch_result), '2', 'two hatch dates create two listing batches');
select is((select result ->> 'entries_created' from batch_result), '3', 'all inventory rows are returned');
select is((select result ->> 'total_birds_added' from batch_result), '35', 'success result reports total birds');

select is(
  (select count(*) from public.inventory_items where store_id = 'e2000000-0000-4000-8000-000000000010'),
  3::bigint, 'multiple breeds and duplicate semantic rows remain distinct'
);
select is(
  (select count(distinct id) from public.inventory_items where store_id = 'e2000000-0000-4000-8000-000000000010'),
  3::bigint, 'every Batch Add row receives a different UUID'
);
select is(
  (select count(*) from public.inventory_items where store_id = 'e2000000-0000-4000-8000-000000000010' and barn_location in ('Barn A', 'Barn B')),
  2::bigint, 'Barn Location values are trimmed and persist independently'
);
select is(
  (select min(base_price) from public.listing_batches where store_id = 'e2000000-0000-4000-8000-000000000010'),
  8.00::numeric, 'lowest Starting Price becomes the deterministic base price'
);
select is(
  (select price_override from public.inventory_items where barn_location = 'Barn A'),
  18.00::numeric, 'higher effective Starting Price persists as an override'
);
select is(
  (select price_override from public.inventory_items where barn_location = 'Barn B'),
  null::numeric, 'a row at the group base price stores no override'
);
select ok(
  (select bool_or(auto_price_adjustment_enabled and price_adjustment_direction = 'increase') from public.listing_batches where store_id = 'e2000000-0000-4000-8000-000000000010'),
  'automatic pricing persists inside the same operation'
);
select is(
  (select jsonb_array_length(result -> 'inventory_items') from batch_result),
  3, 'result returns a mapping for every client row token'
);
select is(
  (select count(distinct mapping ->> 'inventory_item_id') from batch_result cross join lateral jsonb_array_elements(result -> 'inventory_items') mapping),
  3::bigint, 'returned row mappings point to distinct created UUIDs'
);

create temporary table replay_result on commit drop as
select * from public.seller_create_live_bird_batches(
  'e2000000-0000-4000-8000-000000000010',
  'e2000000-0000-4000-8000-000000000100',
  (select payload from batch_input)
);
select ok((select ok and replayed from replay_result), 'an identical request key replays the original successful result');
select is((select result from replay_result), (select result from batch_result), 'idempotent replay returns the original token-to-ID mappings');
select is(
  (select count(*) from public.inventory_items where store_id = 'e2000000-0000-4000-8000-000000000010'),
  3::bigint, 'idempotent replay creates no duplicate inventory'
);

create temporary table invalid_result on commit drop as
select * from public.seller_create_live_bird_batches(
  'e2000000-0000-4000-8000-000000000010',
  'e2000000-0000-4000-8000-000000000101',
  jsonb_build_array(
    jsonb_build_object(
      'client_hatch_group_token', 'valid-first',
      'species_id', (select id from public.species where slug = 'chicken'),
      'hatch_date', '2026-07-01', 'available_date', '2026-08-01', 'base_price', 10,
      'automatic_pricing', jsonb_build_object('enabled', false),
      'breed_groups', jsonb_build_array(jsonb_build_object(
        'seller_breed_profile_id', 'e2000000-0000-4000-8000-000000000020',
        'inventory_items', jsonb_build_array(jsonb_build_object('client_row_token', 'valid-row', 'inventory_type', 'female', 'quantity_available', 1, 'starting_price', 10))
      ))
    ),
    jsonb_build_object(
      'client_hatch_group_token', 'invalid-second',
      'species_id', (select id from public.species where slug = 'chicken'),
      'hatch_date', '2026-07-02', 'available_date', '2026-08-02', 'base_price', 10,
      'automatic_pricing', jsonb_build_object('enabled', false),
      'breed_groups', jsonb_build_array(jsonb_build_object(
        'seller_breed_profile_id', 'e2000000-0000-4000-8000-000000000020',
        'inventory_items', jsonb_build_array(jsonb_build_object('client_row_token', 'invalid-row', 'inventory_type', 'female', 'quantity_available', 0, 'starting_price', 10))
      ))
    )
  )
);
select is((select error_code from invalid_result), 'row_validation_error', 'failure identifies the invalid row category');
select is(
  (select count(*) from public.listing_batches where store_id = 'e2000000-0000-4000-8000-000000000010'),
  2::bigint, 'a failure in any row or hatch group leaves no partial batches'
);

create temporary table cross_store_result on commit drop as
select * from public.seller_create_live_bird_batches(
  'e2000000-0000-4000-8000-000000000010',
  'e2000000-0000-4000-8000-000000000102',
  jsonb_build_array(jsonb_build_object(
    'client_hatch_group_token', 'cross-store',
    'species_id', (select id from public.species where slug = 'chicken'),
    'hatch_date', '2026-09-01', 'available_date', '2026-10-01', 'base_price', 10,
    'automatic_pricing', jsonb_build_object('enabled', false),
    'breed_groups', jsonb_build_array(jsonb_build_object(
      'seller_breed_profile_id', 'e2000000-0000-4000-8000-000000000022',
      'inventory_items', jsonb_build_array(jsonb_build_object('client_row_token', 'cross-row', 'inventory_type', 'female', 'quantity_available', 1, 'starting_price', 10))
    ))
  ))
);
select is((select error_code from cross_store_result), 'breed_profile_error', 'cross-store Breed Library IDs are rejected');

create temporary table limit_result on commit drop as
select * from public.seller_create_live_bird_batches(
  'e2000000-0000-4000-8000-000000000012',
  'e2000000-0000-4000-8000-000000000103',
  jsonb_build_array(
    jsonb_build_object(
      'client_hatch_group_token', 'limit-a', 'species_id', (select id from public.species where slug = 'chicken'),
      'hatch_date', '2026-05-01', 'available_date', '2026-06-01', 'base_price', 10,
      'automatic_pricing', jsonb_build_object('enabled', false),
      'breed_groups', jsonb_build_array(jsonb_build_object('seller_breed_profile_id', 'e2000000-0000-4000-8000-000000000023', 'inventory_items', jsonb_build_array(jsonb_build_object('client_row_token', 'limit-row-a', 'inventory_type', 'female', 'quantity_available', 3, 'starting_price', 10))))
    ),
    jsonb_build_object(
      'client_hatch_group_token', 'limit-b', 'species_id', (select id from public.species where slug = 'chicken'),
      'hatch_date', '2026-05-02', 'available_date', '2026-06-02', 'base_price', 10,
      'automatic_pricing', jsonb_build_object('enabled', false),
      'breed_groups', jsonb_build_array(jsonb_build_object('seller_breed_profile_id', 'e2000000-0000-4000-8000-000000000023', 'inventory_items', jsonb_build_array(jsonb_build_object('client_row_token', 'limit-row-b', 'inventory_type', 'female', 'quantity_available', 3, 'starting_price', 10))))
    )
  )
);
select is((select error_code from limit_result), 'plan_limit_exceeded', 'aggregate plan limits evaluate the whole submission');
select is((select count(*) from public.inventory_items where store_id = 'e2000000-0000-4000-8000-000000000012'), 0::bigint, 'plan failure rolls back every group');

select is(
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name in (
    'public_inventory_items', 'public_storefront_breed_inventory', 'public_storefront_inventory',
    'public_storefront_item_detail', 'public_discoverable_inventory', 'public_breed_availability'
  ) and column_name = 'barn_location'),
  0::bigint, 'public buyer projections continue to omit Barn Location'
);

select * from finish();
rollback;
