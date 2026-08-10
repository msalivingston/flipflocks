begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    'b1200000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'breed-snapshot-owner@example.test', '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'b1200000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'breed-snapshot-other@example.test', '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled
)
values (
  'b1200000-0000-4000-8000-000000000010',
  'b1200000-0000-4000-8000-000000000001',
  'Breed Snapshot Farm', 'breed-snapshot-farm', 'live', 'hosted', true
);

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  billing_state_authority
)
values (
  'b1200000-0000-4000-8000-000000000010',
  'small_flock', 'monthly', 'small_flock', 'monthly', 'trialing',
  statement_timestamp(), statement_timestamp() + interval '7 days',
  statement_timestamp(), statement_timestamp() + interval '7 days',
  statement_timestamp() + interval '7 days', 'trial'
);

create temporary table breed_snapshot_catalog_source on commit drop as
select
  breeds.id as breed_id,
  breeds.species_id,
  breeds.breed_name,
  breeds.description,
  breeds.bird_type,
  breeds.egg_color,
  breeds.annual_egg_production
from public.breeds as breeds
where breeds.breed_slug = 'orpington-buff';

select set_config(
  'request.jwt.claim.sub',
  'b1200000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select *
from public.seller_upsert_breed_profile(
  'b1200000-0000-4000-8000-000000000010',
  (select species_id from breed_snapshot_catalog_source),
  (select breed_id from breed_snapshot_catalog_source),
  null,
  'Caller supplied name must not replace initial platform snapshot',
  'Caller supplied description must not replace initial platform snapshot',
  null,
  'active',
  null,
  'meat',
  'white',
  'over_300'
);

select is(
  (
    select count(*)::integer
    from public.seller_breed_profiles
    where store_id = 'b1200000-0000-4000-8000-000000000010'
      and breed_id = (select breed_id from breed_snapshot_catalog_source)
  ),
  1,
  'initial platform add creates exactly one seller profile'
);

select is(
  (
    select display_name
    from public.seller_breed_profiles
    where store_id = 'b1200000-0000-4000-8000-000000000010'
      and breed_id = (select breed_id from breed_snapshot_catalog_source)
  ),
  (select breed_name from breed_snapshot_catalog_source),
  'initial platform add snapshots the catalog display name'
);

select is(
  (
    select seller_description
    from public.seller_breed_profiles
    where store_id = 'b1200000-0000-4000-8000-000000000010'
      and breed_id = (select breed_id from breed_snapshot_catalog_source)
  ),
  (select description from breed_snapshot_catalog_source),
  'initial platform add snapshots the catalog description'
);

select is(
  (
    select concat_ws('|', bird_type, egg_color, annual_egg_production)
    from public.seller_breed_profiles
    where store_id = 'b1200000-0000-4000-8000-000000000010'
      and breed_id = (select breed_id from breed_snapshot_catalog_source)
  ),
  (
    select concat_ws('|', bird_type, egg_color, annual_egg_production)
    from breed_snapshot_catalog_source
  ),
  'initial platform add snapshots all supported chicken facts'
);

insert into public.listing_batches (
  id, store_id, species_id, origin_date, available_date, base_price,
  batch_type, visibility_status, moderation_status
)
select
  'b1200000-0000-4000-8000-000000000030',
  'b1200000-0000-4000-8000-000000000010',
  species_id, current_date - 14, current_date, 12.00,
  'live_animals', 'active', 'normal'
from breed_snapshot_catalog_source;

insert into public.listing_batch_breeds (
  id, store_id, listing_batch_id, seller_breed_profile_id,
  visibility_status, moderation_status
)
select
  'b1200000-0000-4000-8000-000000000040',
  'b1200000-0000-4000-8000-000000000010',
  'b1200000-0000-4000-8000-000000000030',
  seller_profiles.id, 'active', 'normal'
from public.seller_breed_profiles as seller_profiles
where seller_profiles.store_id = 'b1200000-0000-4000-8000-000000000010'
  and seller_profiles.breed_id =
    (select breed_id from breed_snapshot_catalog_source);

insert into public.inventory_items (
  id, store_id, listing_batch_id, listing_batch_breed_id, inventory_type,
  quantity_available, visibility_status, moderation_status
)
values (
  'b1200000-0000-4000-8000-000000000050',
  'b1200000-0000-4000-8000-000000000010',
  'b1200000-0000-4000-8000-000000000030',
  'b1200000-0000-4000-8000-000000000040',
  'female', 4, 'active', 'normal'
);

update public.breeds
set
  description = 'Changed platform description',
  bird_type = 'layer',
  egg_color = 'blue',
  annual_egg_production = 'over_300'
where id = (select breed_id from breed_snapshot_catalog_source);

select is(
  (
    select concat_ws(
      '|', breed_description, breed_bird_type, breed_egg_color,
      breed_annual_egg_production
    )
    from public.public_storefront_inventory
    where inventory_item_id = 'b1200000-0000-4000-8000-000000000050'
  ),
  (
    select concat_ws(
      '|', description, bird_type, egg_color, annual_egg_production
    )
    from breed_snapshot_catalog_source
  ),
  'changing the platform breed does not change seller-facing storefront facts'
);

select is(
  (
    select concat_ws(
      '|',
      inventory -> 0 ->> 'breed_bird_type',
      inventory -> 0 ->> 'breed_egg_color',
      inventory -> 0 ->> 'breed_annual_egg_production'
    )
    from public.get_seller_storefront_preview_data('breed-snapshot-farm')
  ),
  (
    select concat_ws('|', bird_type, egg_color, annual_egg_production)
    from breed_snapshot_catalog_source
  ),
  'seller storefront preview uses the seller snapshot after the catalog changes'
);

select *
from public.seller_upsert_breed_profile(
  'b1200000-0000-4000-8000-000000000010',
  (select species_id from breed_snapshot_catalog_source),
  (select breed_id from breed_snapshot_catalog_source)
);

select is(
  (
    select seller_description
    from public.seller_breed_profiles
    where store_id = 'b1200000-0000-4000-8000-000000000010'
      and breed_id = (select breed_id from breed_snapshot_catalog_source)
  ),
  (select description from breed_snapshot_catalog_source),
  'resolving an active platform copy does not refresh it from the catalog'
);

update public.seller_breed_profiles
set
  display_name = 'Seller Custom Orpington',
  seller_description = 'Seller custom description',
  bird_type = 'meat',
  egg_color = 'white',
  annual_egg_production = 'under_150',
  visibility_status = 'archived'
where store_id = 'b1200000-0000-4000-8000-000000000010'
  and breed_id = (select breed_id from breed_snapshot_catalog_source);

select *
from public.seller_upsert_breed_profile(
  'b1200000-0000-4000-8000-000000000010',
  (select species_id from breed_snapshot_catalog_source),
  (select breed_id from breed_snapshot_catalog_source)
);

select is(
  (
    select concat_ws(
      '|', display_name, seller_description, bird_type, egg_color,
      annual_egg_production, visibility_status
    )
    from public.seller_breed_profiles
    where store_id = 'b1200000-0000-4000-8000-000000000010'
      and breed_id = (select breed_id from breed_snapshot_catalog_source)
  ),
  'Seller Custom Orpington|Seller custom description|meat|white|under_150|active',
  're-adding an archived platform copy preserves customization and reactivates it'
);

select *
from public.seller_upsert_breed_profile(
  'b1200000-0000-4000-8000-000000000010',
  (select species_id from breed_snapshot_catalog_source),
  (select breed_id from breed_snapshot_catalog_source),
  null,
  'Seller Custom Orpington',
  'Changed platform description',
  null,
  'active',
  (
    select id
    from public.seller_breed_profiles
    where store_id = 'b1200000-0000-4000-8000-000000000010'
      and breed_id = (select breed_id from breed_snapshot_catalog_source)
  ),
  'layer',
  'blue',
  'over_300'
);

select is(
  (
    select concat_ws(
      '|', seller_description, bird_type, egg_color, annual_egg_production
    )
    from public.seller_breed_profiles
    where store_id = 'b1200000-0000-4000-8000-000000000010'
      and breed_id = (select breed_id from breed_snapshot_catalog_source)
  ),
  'Changed platform description|layer|blue|over_300',
  'an explicit existing-profile update can restore current catalog values'
);

select *
from public.seller_upsert_breed_profile(
  'b1200000-0000-4000-8000-000000000010',
  (select species_id from breed_snapshot_catalog_source),
  null,
  'Seller Custom Breed',
  'Seller Custom Breed',
  'Independent custom description'
);

select ok(
  exists (
    select 1
    from public.seller_breed_profiles
    where store_id = 'b1200000-0000-4000-8000-000000000010'
      and custom_breed_name = 'Seller Custom Breed'
      and breed_id is null
      and seller_description = 'Independent custom description'
  ),
  'custom breeds remain independent and unlinked to platform breeds'
);

select is(
  (
    select seller_breed_profile_id
    from public.seller_inventory_management
    where inventory_item_id = 'b1200000-0000-4000-8000-000000000050'
  ),
  (
    select id
    from public.seller_breed_profiles
    where store_id = 'b1200000-0000-4000-8000-000000000010'
      and breed_id = (select breed_id from breed_snapshot_catalog_source)
  ),
  'existing listings continue to resolve the same seller profile'
);

select hasnt_column(
  'public',
  'public_storefront_inventory',
  'seller_notes',
  'public storefront inventory does not expose private seller notes'
);

select set_config(
  'request.jwt.claim.sub',
  'b1200000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  format(
    'select * from public.seller_upsert_breed_profile(%L::uuid, %L::uuid, %L::uuid)',
    'b1200000-0000-4000-8000-000000000010',
    (select species_id from breed_snapshot_catalog_source),
    (select breed_id from breed_snapshot_catalog_source)
  ),
  'P0001',
  'Not authorized to manage breed profiles for this store.',
  'seller breed upsert preserves store isolation'
);

select * from finish();
rollback;
