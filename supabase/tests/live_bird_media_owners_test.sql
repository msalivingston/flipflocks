begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

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
  'b2000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'media-owner@example.test',
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
values (
  'b2000000-0000-4000-8000-000000000010',
  'b2000000-0000-4000-8000-000000000001',
  'Media Owner Store',
  'media-owner-store',
  'live',
  'hosted',
  true
);

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
  'b2000000-0000-4000-8000-000000000020',
  'b2000000-0000-4000-8000-000000000010',
  species.id,
  'Media Test Chicken',
  'media test chicken',
  'Media Test Chicken',
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
  'b2000000-0000-4000-8000-000000000030',
  'b2000000-0000-4000-8000-000000000010',
  species.id,
  current_date - 30,
  current_date - 1,
  10.00,
  'live_animals',
  'active',
  'normal'
from public.species
where species.slug = 'chicken';

insert into public.listing_batch_breeds (
  id,
  store_id,
  listing_batch_id,
  seller_breed_profile_id,
  visibility_status,
  moderation_status
)
values (
  'b2000000-0000-4000-8000-000000000031',
  'b2000000-0000-4000-8000-000000000010',
  'b2000000-0000-4000-8000-000000000030',
  'b2000000-0000-4000-8000-000000000020',
  'active',
  'normal'
);

insert into public.inventory_items (
  id,
  store_id,
  listing_batch_id,
  listing_batch_breed_id,
  inventory_type,
  quantity_available,
  price_override,
  visibility_status,
  moderation_status
)
values (
  'b2000000-0000-4000-8000-000000000040',
  'b2000000-0000-4000-8000-000000000010',
  'b2000000-0000-4000-8000-000000000030',
  'b2000000-0000-4000-8000-000000000031',
  'female',
  5,
  12.00,
  'active',
  'normal'
);

insert into public.media_assets (
  id,
  store_id,
  uploaded_by_user_id,
  bucket_name,
  storage_path,
  original_filename,
  content_type,
  file_size_bytes,
  width_px,
  height_px,
  alt_text,
  asset_status,
  moderation_status
)
values
  (
    'b2000000-0000-4000-8000-000000000101',
    'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000001',
    'seller-media',
    'stores/b2000000-0000-4000-8000-000000000010/images/2026/07/store.webp',
    'store.webp',
    'image/webp',
    100,
    100,
    100,
    'Store image',
    'active',
    'approved'
  ),
  (
    'b2000000-0000-4000-8000-000000000102',
    'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000001',
    'seller-media',
    'stores/b2000000-0000-4000-8000-000000000010/images/2026/07/profile.webp',
    'profile.webp',
    'image/webp',
    100,
    100,
    100,
    'Profile image',
    'active',
    'approved'
  ),
  (
    'b2000000-0000-4000-8000-000000000103',
    'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000001',
    'seller-media',
    'stores/b2000000-0000-4000-8000-000000000010/images/2026/07/inventory.webp',
    'inventory.webp',
    'image/webp',
    100,
    100,
    100,
    'Inventory image',
    'active',
    'approved'
  );

insert into public.media_links (
  id,
  store_id,
  media_asset_id,
  entity_type,
  entity_id,
  display_context,
  sort_order,
  is_featured,
  visibility_status
)
values
  (
    'b2000000-0000-4000-8000-000000000111',
    'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000101',
    'store',
    'b2000000-0000-4000-8000-000000000010',
    'gallery',
    0,
    true,
    'active'
  ),
  (
    'b2000000-0000-4000-8000-000000000112',
    'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000102',
    'seller_breed_profile',
    'b2000000-0000-4000-8000-000000000020',
    'gallery',
    0,
    true,
    'active'
  ),
  (
    'b2000000-0000-4000-8000-000000000113',
    'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000103',
    'inventory_item',
    'b2000000-0000-4000-8000-000000000040',
    'gallery',
    0,
    true,
    'active'
  );

select is(
  public.validate_seller_media_entity(
    'b2000000-0000-4000-8000-000000000010',
    'listing_batch',
    'b2000000-0000-4000-8000-000000000030'
  ),
  false,
  'listing_batch is rejected even when the batch exists'
);

select is(
  public.validate_seller_media_entity(
    'b2000000-0000-4000-8000-000000000010',
    'listing_batch_breed',
    'b2000000-0000-4000-8000-000000000031'
  ),
  false,
  'listing_batch_breed is rejected even when the breed row exists'
);

select is(public.validate_seller_media_context('listing_batch', 'gallery'), false, 'listing_batch gallery context is rejected');
select is(public.validate_seller_media_context('listing_batch_breed', 'gallery'), false, 'listing_batch_breed gallery context is rejected');
select is(public.validate_seller_media_context('store', 'gallery'), true, 'store media remains supported');
select is(public.validate_seller_media_context('seller_breed_profile', 'gallery'), true, 'seller breed profile media remains supported');
select is(public.validate_seller_media_context('inventory_item', 'gallery'), true, 'inventory item media remains supported');
select is(public.validate_seller_media_context('equipment_inventory_item', 'gallery'), true, 'equipment media remains supported');
select is(public.validate_seller_media_context('processed_poultry_inventory_item', 'gallery'), true, 'poultry product media remains supported');
select is(public.validate_seller_media_context('hatching_egg_inventory_item', 'gallery'), true, 'hatching egg media remains supported');

create function pg_temp.try_legacy_media_link(p_entity_type text, p_entity_id uuid)
returns text
language plpgsql
as $$
begin
  insert into public.media_links (
    store_id,
    media_asset_id,
    entity_type,
    entity_id,
    display_context
  )
  values (
    'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000101',
    p_entity_type,
    p_entity_id,
    'gallery'
  );

  return null;
exception
  when others then
    return sqlstate;
end;
$$;

select is(
  pg_temp.try_legacy_media_link('listing_batch', 'b2000000-0000-4000-8000-000000000030'),
  '23514',
  'media_links constraint rejects listing_batch'
);

select is(
  pg_temp.try_legacy_media_link('listing_batch_breed', 'b2000000-0000-4000-8000-000000000031'),
  '23514',
  'media_links constraint rejects listing_batch_breed'
);

select is(
  (
    select count(*)::integer
    from public.media_links
    where entity_type in ('listing_batch', 'listing_batch_breed')
  ),
  0,
  'the migrated database contains no legacy batch media links'
);

select is(
  (
    select count(*)::integer
    from public.public_storefront_media_gallery
    where entity_type in ('listing_batch', 'listing_batch_breed')
  ),
  0,
  'the public storefront gallery exposes no legacy batch media'
);

select is(
  (
    select featured_image_alt_text
    from public.public_storefront_breed_inventory
    where inventory_item_id = 'b2000000-0000-4000-8000-000000000040'
  ),
  'Inventory image',
  'inventory item media has first storefront precedence'
);

update public.media_links
set visibility_status = 'archived'
where id = 'b2000000-0000-4000-8000-000000000113';

select is(
  (
    select featured_image_alt_text
    from public.public_storefront_breed_inventory
    where inventory_item_id = 'b2000000-0000-4000-8000-000000000040'
  ),
  'Profile image',
  'seller breed profile media is the second storefront fallback'
);

update public.media_links
set visibility_status = 'archived'
where id = 'b2000000-0000-4000-8000-000000000112';

select is(
  (
    select featured_image_alt_text
    from public.public_storefront_breed_inventory
    where inventory_item_id = 'b2000000-0000-4000-8000-000000000040'
  ),
  'Store image',
  'store media is the final storefront fallback'
);

update public.media_links
set visibility_status = 'active'
where id in (
  'b2000000-0000-4000-8000-000000000112',
  'b2000000-0000-4000-8000-000000000113'
);

select ok(
  exists (
    select 1
    from public.public_storefront_media_gallery
    where entity_type = 'store'
      and entity_id = 'b2000000-0000-4000-8000-000000000010'
  ),
  'public gallery retains store media'
);

select ok(
  exists (
    select 1
    from public.public_storefront_media_gallery
    where entity_type = 'seller_breed_profile'
      and entity_id = 'b2000000-0000-4000-8000-000000000020'
  ),
  'public gallery retains seller breed profile media'
);

select ok(
  exists (
    select 1
    from public.public_storefront_media_gallery
    where entity_type = 'inventory_item'
      and entity_id = 'b2000000-0000-4000-8000-000000000040'
  ),
  'public gallery retains inventory item media'
);

select ok(
  position(
    'listing_batch' in (
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conrelid = 'public.media_links'::regclass
        and conname = 'media_links_entity_type_check'
    )
  ) = 0,
  'media_links entity type constraint contains no legacy batch owner'
);

select ok(
  (
    select bool_and(
      pg_get_constraintdef(oid) like '%' || retained.entity_type || '%'
    )
    from pg_constraint
    cross join (
      values
        ('store'),
        ('seller_breed_profile'),
        ('inventory_item'),
        ('equipment_inventory_item'),
        ('processed_poultry_inventory_item'),
        ('hatching_egg_inventory_item')
    ) as retained(entity_type)
    where conrelid = 'public.media_links'::regclass
      and conname = 'media_links_entity_type_check'
  ),
  'media_links constraint preserves every retained media owner'
);

select * from finish();

rollback;
