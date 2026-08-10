begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select set_config('request.jwt.claim.role', 'service_role', true);

grant select on public.species, public.listing_batches, public.inventory_items
  to authenticated;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  'a1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'publish-cleanup@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled
)
select
  fixture.id,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  fixture.name,
  fixture.slug,
  'live',
  'hosted',
  true
from (values
  ('a1000000-0000-4000-8000-000000000010'::uuid, 'Coop Five', 'cleanup-coop-five'),
  ('a1000000-0000-4000-8000-000000000020'::uuid, 'Coop Six', 'cleanup-coop-six'),
  ('a1000000-0000-4000-8000-000000000030'::uuid, 'Coop Partial', 'cleanup-coop-partial'),
  ('a1000000-0000-4000-8000-000000000040'::uuid, 'Coop Units', 'cleanup-coop-units'),
  ('a1000000-0000-4000-8000-000000000050'::uuid, 'Market Six', 'cleanup-market-six'),
  ('a1000000-0000-4000-8000-000000000060'::uuid, 'Coop Draft', 'cleanup-coop-draft'),
  ('a1000000-0000-4000-8000-000000000070'::uuid, 'Coop Over Draft', 'cleanup-coop-over-draft'),
  ('a1000000-0000-4000-8000-000000000080'::uuid, 'Coop Reshow', 'cleanup-coop-reshow'),
  ('a1000000-0000-4000-8000-000000000090'::uuid, 'Coop Partial Fail', 'cleanup-coop-partial-fail')
) as fixture(id, name, slug);

insert into public.seller_billing_status (
  store_id, plan_key, billing_plan, subscription_status,
  storefront_access_until, billing_state_authority, comp_granted_by_user_id,
  comp_grant_reason, comp_granted_at, comp_access_until
)
select
  stores.id,
  case when stores.id = 'a1000000-0000-4000-8000-000000000050'::uuid
    then 'full_flock' else 'small_flock' end,
  'comped', 'comped', statement_timestamp() + interval '30 days',
  'admin_comp', stores.owner_user_id, 'Publication cleanup test fixture',
  statement_timestamp(), statement_timestamp() + interval '30 days'
from public.stores
where stores.owner_user_id = 'a1000000-0000-4000-8000-000000000001'::uuid;

insert into public.seller_breed_profiles (
  id, store_id, species_id, custom_breed_name, normalized_custom_breed_name,
  display_name, visibility_status, moderation_status
)
select
  ('a1100000-0000-4000-8000-' || right(stores.id::text, 12))::uuid,
  stores.id,
  species.id,
  stores.store_name || ' Chicken',
  lower(stores.store_slug || '-chicken'),
  stores.store_name || ' Chicken',
  'active', 'normal'
from public.stores
cross join public.species
where stores.owner_user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  and species.slug = 'chicken';

-- Existing three-unit inventory for partial-capacity and draft publication.
insert into public.listing_batches (
  id, store_id, species_id, origin_date, available_date, base_price,
  batch_type, visibility_status, moderation_status
)
select
  ('a1200000-0000-4000-8000-' || right(stores.id::text, 12))::uuid,
  stores.id, species.id, current_date - 30, current_date, 10,
  'live_animals', 'active', 'normal'
from public.stores
cross join public.species
where stores.id in (
  'a1000000-0000-4000-8000-000000000030'::uuid,
  'a1000000-0000-4000-8000-000000000060'::uuid,
  'a1000000-0000-4000-8000-000000000080'::uuid,
  'a1000000-0000-4000-8000-000000000090'::uuid
)
and species.slug = 'chicken';

insert into public.listing_batch_breeds (
  id, store_id, listing_batch_id, seller_breed_profile_id,
  visibility_status, moderation_status
)
select
  ('a1300000-0000-4000-8000-' || right(stores.id::text, 12))::uuid,
  stores.id,
  ('a1200000-0000-4000-8000-' || right(stores.id::text, 12))::uuid,
  ('a1100000-0000-4000-8000-' || right(stores.id::text, 12))::uuid,
  'active', 'normal'
from public.stores
where stores.id in (
  'a1000000-0000-4000-8000-000000000030'::uuid,
  'a1000000-0000-4000-8000-000000000060'::uuid,
  'a1000000-0000-4000-8000-000000000080'::uuid,
  'a1000000-0000-4000-8000-000000000090'::uuid
);

insert into public.inventory_items (
  id, store_id, listing_batch_id, listing_batch_breed_id,
  inventory_type, quantity_available, visibility_status
)
select
  ('a1400000-0000-4000-8000-' || right(stores.id::text, 12))::uuid,
  stores.id,
  ('a1200000-0000-4000-8000-' || right(stores.id::text, 12))::uuid,
  ('a1300000-0000-4000-8000-' || right(stores.id::text, 12))::uuid,
  'female',
  case when stores.id = 'a1000000-0000-4000-8000-000000000080'::uuid
    then 5 else 3 end,
  'active'
from public.stores
where stores.id in (
  'a1000000-0000-4000-8000-000000000030'::uuid,
  'a1000000-0000-4000-8000-000000000060'::uuid,
  'a1000000-0000-4000-8000-000000000080'::uuid,
  'a1000000-0000-4000-8000-000000000090'::uuid
);

-- A hidden item under a full Coop batch exercises the existing Show path.
insert into public.inventory_items (
  id, store_id, listing_batch_id, listing_batch_breed_id,
  inventory_type, quantity_available, visibility_status
) values (
  'a1400000-0000-4000-8000-000000000081',
  'a1000000-0000-4000-8000-000000000080',
  'a1200000-0000-4000-8000-000000000080',
  'a1300000-0000-4000-8000-000000000080',
  'male', 1, 'hidden'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select * from public.seller_create_listing_batch_with_inventory(
    'a1000000-0000-4000-8000-000000000010',
    (select id from public.species where slug = 'chicken'),
    'live_animals', current_date - 14, current_date, 12,
    jsonb_build_array(jsonb_build_object(
      'seller_breed_profile_id', 'a1100000-0000-4000-8000-000000000010',
      'visibility_status', 'active',
      'inventory_items', jsonb_build_array(jsonb_build_object(
        'inventory_type', 'female', 'quantity_available', 5,
        'visibility_status', 'active'
      ))
    )), false, null, null, null, null, 'active'
  )$$,
  'Coop with zero active units can publish five birds'
);

select results_eq(
  $$select visibility_status, internal_batch_label is null
    from public.listing_batches
    where store_id = 'a1000000-0000-4000-8000-000000000010'$$,
  $$values ('active'::text, true)$$,
  'brand-new publication is created active without a draft marker'
);

select throws_ok(
  $$select * from public.seller_create_listing_batch_with_inventory(
    'a1000000-0000-4000-8000-000000000020',
    (select id from public.species where slug = 'chicken'),
    'live_animals', current_date - 14, current_date, 12,
    jsonb_build_array(jsonb_build_object(
      'seller_breed_profile_id', 'a1100000-0000-4000-8000-000000000020',
      'visibility_status', 'active',
      'inventory_items', jsonb_build_array(jsonb_build_object(
        'inventory_type', 'female', 'quantity_available', 6,
        'visibility_status', 'active'
      ))
    )), false, null, null, 'should-not-exist', null, 'active'
  )$$,
  'P0001',
  'Coop includes up to 5 active birds for sale at one time. Upgrade to Market for unlimited live bird quantities.',
  'Coop with zero active units cannot publish six birds'
);

select is(
  (select count(*) from public.listing_batches
    where store_id = 'a1000000-0000-4000-8000-000000000020'),
  0::bigint,
  'failed brand-new publication leaves no hidden or active listing'
);

select lives_ok(
  $$select * from public.seller_create_listing_batch_with_inventory(
    'a1000000-0000-4000-8000-000000000090',
    (select id from public.species where slug = 'chicken'),
    'live_animals', current_date - 14, current_date, 12,
    jsonb_build_array(jsonb_build_object(
      'seller_breed_profile_id', 'a1100000-0000-4000-8000-000000000090',
      'inventory_items', jsonb_build_array(jsonb_build_object(
        'inventory_type', 'male', 'quantity_available', 2
      ))
    )), false, null, null, 'partial-two', null, 'active'
  )$$,
  'Coop with three active units can publish two more'
);

select throws_ok(
  $$select * from public.seller_create_listing_batch_with_inventory(
    'a1000000-0000-4000-8000-000000000030',
    (select id from public.species where slug = 'chicken'),
    'live_animals', current_date - 14, current_date, 12,
    jsonb_build_array(jsonb_build_object(
      'seller_breed_profile_id', 'a1100000-0000-4000-8000-000000000030',
      'inventory_items', jsonb_build_array(jsonb_build_object(
        'inventory_type', 'male', 'quantity_available', 3
      ))
    )), false, null, null, 'partial-three-failed', null, 'active'
  )$$,
  'P0001',
  'Coop includes up to 5 active birds for sale at one time. Upgrade to Market for unlimited live bird quantities.',
  'Coop publication exceeding the remaining allowance fails'
);

select is(
  (select count(*) from public.listing_batches
    where store_id = 'a1000000-0000-4000-8000-000000000030'
      and internal_batch_label = 'partial-three-failed'),
  0::bigint,
  'failed partial-capacity publication is fully rolled back'
);

select results_eq(
  $$select requested_bird_units, remaining_bird_units, can_publish
    from public.seller_preflight_live_bird_publication(
      'a1000000-0000-4000-8000-000000000040',
      jsonb_build_array(jsonb_build_object(
        'inventory_items', jsonb_build_array(
          jsonb_build_object('inventory_type', 'pair', 'quantity_available', 1),
          jsonb_build_object('inventory_type', 'trio', 'quantity_available', 1)
        )
      )), null
    )$$,
  $$values (5, 5, true)$$,
  'preflight uses authoritative pair and trio bird-unit math'
);

select lives_ok(
  $$select * from public.seller_create_listing_batch_with_inventory(
    'a1000000-0000-4000-8000-000000000050',
    (select id from public.species where slug = 'chicken'),
    'live_animals', current_date - 14, current_date, 12,
    jsonb_build_array(jsonb_build_object(
      'seller_breed_profile_id', 'a1100000-0000-4000-8000-000000000050',
      'inventory_items', jsonb_build_array(jsonb_build_object(
        'inventory_type', 'female', 'quantity_available', 6
      ))
    )), false, null, null, null, null, 'active'
  )$$,
  'Market publication remains unaffected by the Coop allowance'
);

select lives_ok(
  $$select * from public.seller_create_listing_batch_with_inventory(
    'a1000000-0000-4000-8000-000000000070',
    (select id from public.species where slug = 'chicken'),
    'live_animals', current_date - 14, current_date, 12,
    jsonb_build_array(jsonb_build_object(
      'seller_breed_profile_id', 'a1100000-0000-4000-8000-000000000070',
      'inventory_items', jsonb_build_array(jsonb_build_object(
        'inventory_type', 'female', 'quantity_available', 6
      ))
    )), false, null, null, '__add_inventory_v2_live_birds__', null, 'hidden'
  )$$,
  'an over-limit Coop draft can be saved hidden and marked'
);

select results_eq(
  $$select visibility_status, internal_batch_label
    from public.listing_batches
    where store_id = 'a1000000-0000-4000-8000-000000000070'$$,
  $$values ('hidden'::text, '__add_inventory_v2_live_birds__'::text)$$,
  'saving an over-limit draft preserves its hidden marker state'
);

select lives_ok(
  $$select * from public.seller_create_listing_batch_with_inventory(
    'a1000000-0000-4000-8000-000000000060',
    (select id from public.species where slug = 'chicken'),
    'live_animals', current_date - 14, current_date, 12,
    jsonb_build_array(jsonb_build_object(
      'seller_breed_profile_id', 'a1100000-0000-4000-8000-000000000060',
      'inventory_items', jsonb_build_array(jsonb_build_object(
        'inventory_type', 'female', 'quantity_available', 3
      ))
    )), false, null, null, '__add_inventory_v2_live_birds__', null, 'hidden'
  )$$,
  'a resumable marked draft is created while three units are active'
);

select results_eq(
  $$select published, active_bird_limit, currently_active_bird_units,
      requested_bird_units, remaining_bird_units
    from public.seller_publish_live_bird_draft(
      (select id from public.listing_batches
       where store_id = 'a1000000-0000-4000-8000-000000000060'
         and internal_batch_label = '__add_inventory_v2_live_birds__')
    )$$,
  $$values (false, 5, 3, 3, 2)$$,
  'publishing an over-remaining draft returns exact allowance information'
);

select results_eq(
  $$select visibility_status, internal_batch_label
    from public.listing_batches
    where store_id = 'a1000000-0000-4000-8000-000000000060'
      and internal_batch_label = '__add_inventory_v2_live_birds__'$$,
  $$values ('hidden'::text, '__add_inventory_v2_live_birds__'::text)$$,
  'blocked draft publication leaves the draft hidden and marked'
);

select public.seller_set_listing_batch_visibility(
  'a1200000-0000-4000-8000-000000000060', 'hidden', 'Free test capacity.'
);

select results_eq(
  $$select published
    from public.seller_publish_live_bird_draft(
      (select id from public.listing_batches
       where store_id = 'a1000000-0000-4000-8000-000000000060'
         and internal_batch_label = '__add_inventory_v2_live_birds__')
    )$$,
  $$values (true)$$,
  'the same draft publishes once sufficient Coop capacity exists'
);

select results_eq(
  $$select visibility_status, internal_batch_label is null
    from public.listing_batches
    where store_id = 'a1000000-0000-4000-8000-000000000060'
      and visibility_status = 'active'$$,
  $$values ('active'::text, true)$$,
  'successful draft publication activates it and clears the marker'
);

select public.seller_set_listing_batch_visibility(
  (select id from public.listing_batches
   where store_id = 'a1000000-0000-4000-8000-000000000060'
     and visibility_status = 'active'),
  'hidden', 'Seller intentionally hid published inventory.'
);

select results_eq(
  $$select has_published_activity, is_unfinished_add_v2_draft
    from public.seller_get_live_bird_listing_publication_states(
      'a1000000-0000-4000-8000-000000000060'
    )
    where listing_batch_id <> 'a1200000-0000-4000-8000-000000000060'$$,
  $$values (true, false)$$,
  'intentionally hidden published inventory is Hidden rather than Draft'
);

select results_eq(
  $$select has_published_activity, is_unfinished_add_v2_draft
    from public.seller_get_live_bird_listing_publication_states(
      'a1000000-0000-4000-8000-000000000070'
    )$$,
  $$values (false, true)$$,
  'a genuine unfinished marked listing is classified as Draft'
);

select throws_ok(
  $$select public.seller_set_inventory_visibility(
    'a1400000-0000-4000-8000-000000000081', 'active', 'Show on store.'
  )$$,
  'P0001',
  'Coop includes up to 5 active birds for sale at one time. Upgrade to Market for unlimited live bird quantities.',
  'Show on store continues to enforce the authoritative Coop allowance'
);

select is(
  (select visibility_status from public.inventory_items
   where id = 'a1400000-0000-4000-8000-000000000081'),
  'hidden',
  'failed Show on store leaves the inventory item hidden'
);

reset role;
select * from finish();
rollback;
