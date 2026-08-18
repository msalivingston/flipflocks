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
            jsonb_build_object('client_row_token', 'row-a', 'inventory_type', 'female', 'quantity_available', 5, 'starting_price', 18, 'barn_location', ' Barn A ', 'breeding_history', 'never_bred', 'feather_condition', 'excellent'),
            jsonb_build_object('client_row_token', 'row-b', 'inventory_type', 'female', 'quantity_available', 20, 'starting_price', 8, 'barn_location', 'Barn B', 'breeding_history', 'breeder', 'feather_condition', 'good')
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
  (select breeding_history from public.inventory_items where barn_location = 'Barn A'),
  'never_bred', 'Breeding History persists independently per Batch Add row'
);
select is(
  (select feather_condition from public.inventory_items where barn_location = 'Barn B'),
  'good', 'Feather Condition persists independently per Batch Add row'
);
select is(
  (select breeding_history || ':' || feather_condition
   from public.seller_inventory_management where barn_location = 'Barn A'),
  'never_bred:excellent', 'seller-private inventory projection includes both advanced values'
);
select ok(
  (select bool_or(breeding_history is null and feather_condition is null)
   from public.inventory_items
   where store_id = 'e2000000-0000-4000-8000-000000000010'),
  'both advanced attributes remain optional'
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
select is(
  (select breeding_history || ':' || feather_condition
   from public.inventory_items where barn_location = 'Barn A'),
  'never_bred:excellent', 'idempotent replay preserves the original advanced values'
);

reset role;
select lives_ok(
  $$update public.inventory_items set breeding_history = 'never_bred' where barn_location = 'Barn A'$$,
  'database accepts never_bred'
);
select lives_ok(
  $$update public.inventory_items set breeding_history = 'breeder' where barn_location = 'Barn A'$$,
  'database accepts breeder'
);
select throws_ok(
  $$update public.inventory_items set breeding_history = 'unknown' where barn_location = 'Barn A'$$,
  '23514', null, 'database rejects unknown Breeding History'
);
select lives_ok(
  $$update public.inventory_items set feather_condition = 'excellent' where barn_location = 'Barn A'$$,
  'database accepts excellent feather condition'
);
select lives_ok(
  $$update public.inventory_items set feather_condition = 'good' where barn_location = 'Barn A'$$,
  'database accepts good feather condition'
);
select lives_ok(
  $$update public.inventory_items set feather_condition = 'rough' where barn_location = 'Barn A'$$,
  'database accepts rough feather condition'
);
select lives_ok(
  $$update public.inventory_items set feather_condition = 'very_rough' where barn_location = 'Barn A'$$,
  'database accepts very_rough feather condition'
);
select throws_ok(
  $$update public.inventory_items set feather_condition = 'unknown' where barn_location = 'Barn A'$$,
  '23514', null, 'database rejects unknown Feather Condition'
);
select lives_ok(
  $$update public.inventory_items set breeding_history = null, feather_condition = null where barn_location = 'Barn A'$$,
  'database permits both advanced attributes to be null'
);
update public.inventory_items
set breeding_history = 'never_bred', feather_condition = 'excellent'
where barn_location = 'Barn A';
set local role authenticated;

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

create temporary table invalid_attribute_result on commit drop as
select * from public.seller_create_live_bird_batches(
  'e2000000-0000-4000-8000-000000000010',
  'e2000000-0000-4000-8000-000000000104',
  jsonb_build_array(jsonb_build_object(
    'client_hatch_group_token', 'invalid-attribute',
    'species_id', (select id from public.species where slug = 'chicken'),
    'hatch_date', '2026-09-01', 'available_date', '2026-10-01', 'base_price', 10,
    'automatic_pricing', jsonb_build_object('enabled', false),
    'breed_groups', jsonb_build_array(jsonb_build_object(
      'seller_breed_profile_id', 'e2000000-0000-4000-8000-000000000020',
      'inventory_items', jsonb_build_array(jsonb_build_object(
        'client_row_token', 'invalid-attribute-row', 'inventory_type', 'female',
        'quantity_available', 1, 'starting_price', 10,
        'breeding_history', 'unknown'
      ))
    ))
  ))
);
select is(
  (select error_code from invalid_attribute_result),
  'row_validation_error', 'Batch Add rejects unknown controlled attribute values'
);

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
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public'
     and table_name in (
       'public_storefront_breed_inventory', 'public_storefront_inventory',
       'public_storefront_item_detail'
     )
     and column_name in ('breeding_history', 'feather_condition')),
  6::bigint, 'buyer-safe Live Birds projections expose only the advanced buyer attributes'
);
select is(
  (select breeding_history || ':' || feather_condition
   from public.public_storefront_inventory
   where inventory_item_id = (
     select id from public.inventory_items where barn_location = 'Barn A'
   )),
  'never_bred:excellent', 'public storefront rows carry the buyer-safe values'
);

reset role;
insert into public.customers (
  id, store_id, first_name, last_name, email
) values (
  'e2000000-0000-4000-8000-000000000200',
  'e2000000-0000-4000-8000-000000000010',
  'Snapshot', 'Buyer', 'snapshot-buyer@example.test'
);
insert into public.orders (
  id, store_id, customer_id, order_number, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot,
  subtotal_amount, total_amount
) values (
  'e2000000-0000-4000-8000-000000000201',
  'e2000000-0000-4000-8000-000000000010',
  'e2000000-0000-4000-8000-000000000200',
  'ADV-SNAPSHOT-1', 'pending', 'pay_at_pickup', 'pay_at_pickup',
  'snapshot-buyer@example.test', 'Snapshot', 'Buyer', 18, 18
);
insert into public.order_items (
  id, order_id, store_id, inventory_item_id, listing_batch_id,
  listing_batch_breed_id, seller_breed_profile_id, species_id,
  species_name_snapshot, species_slug_snapshot, breed_display_name_snapshot,
  inventory_type_snapshot, batch_type_snapshot, available_date_snapshot,
  unit_price_snapshot,
  quantity, line_subtotal, order_item_source, inventory_debited_quantity
)
select
  'e2000000-0000-4000-8000-000000000202',
  'e2000000-0000-4000-8000-000000000201', inventory_items.store_id,
  inventory_items.id, inventory_items.listing_batch_id,
  inventory_items.listing_batch_breed_id,
  listing_batch_breeds.seller_breed_profile_id, listing_batches.species_id,
  species.common_name, species.slug, seller_breed_profiles.display_name,
  inventory_items.inventory_type, listing_batches.batch_type,
  listing_batches.available_date, 18,
  1, 18, 'listing_inventory', 0
from public.inventory_items
join public.listing_batches on listing_batches.id = inventory_items.listing_batch_id
join public.listing_batch_breeds on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
join public.seller_breed_profiles on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
join public.species on species.id = listing_batches.species_id
where inventory_items.barn_location = 'Barn A';

select is(
  (select breeding_history_snapshot || ':' || feather_condition_snapshot
   from public.order_items where id = 'e2000000-0000-4000-8000-000000000202'),
  'never_bred:excellent', 'order line snapshots capture the purchased advanced values'
);
update public.inventory_items
set breeding_history = 'breeder', feather_condition = 'very_rough'
where barn_location = 'Barn A';
select is(
  (select breeding_history_snapshot || ':' || feather_condition_snapshot
   from public.order_items where id = 'e2000000-0000-4000-8000-000000000202'),
  'never_bred:excellent', 'later inventory changes do not alter historical order snapshots'
);
set local role authenticated;

select * from finish();
rollback;
