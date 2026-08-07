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
    'f4000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'preview-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'f4000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'preview-other@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'f4000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'preview-admin@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled, hatching_eggs_enabled, equipment_supplies_enabled,
  processed_poultry_enabled
)
values
  (
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000001',
    'Hidden Preview Farm', 'hidden-preview-farm', 'draft', 'hosted', false,
    false, false, false
  ),
  (
    'f4000000-0000-4000-8000-000000000011',
    'f4000000-0000-4000-8000-000000000002',
    'Other Hidden Farm', 'other-hidden-farm', 'draft', 'hosted', false,
    false, false, false
  );

insert into public.user_roles (user_id, role, store_id)
values ('f4000000-0000-4000-8000-000000000003', 'admin', null);

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, storefront_access_until,
  billing_state_authority, comp_granted_by_user_id, comp_grant_reason,
  comp_granted_at, comp_access_until
)
values (
  'f4000000-0000-4000-8000-000000000010',
  'full_flock', 'monthly', 'full_flock', 'comped', 'comped',
  statement_timestamp() + interval '30 days', 'admin_comp',
  'f4000000-0000-4000-8000-000000000003',
  'Secure preview inventory test', statement_timestamp(),
  statement_timestamp() + interval '30 days'
);

update public.stores
set
  hatching_eggs_enabled = true,
  equipment_supplies_enabled = true,
  processed_poultry_enabled = true
where id = 'f4000000-0000-4000-8000-000000000010';

insert into public.seller_breed_profiles (
  id, store_id, species_id, custom_breed_name, normalized_custom_breed_name,
  display_name, visibility_status, moderation_status
)
select
  'f4000000-0000-4000-8000-000000000020',
  'f4000000-0000-4000-8000-000000000010',
  species.id, 'Preview Chicken', 'preview chicken', 'Preview Chicken',
  'active', 'normal'
from public.species
where species.slug = 'chicken';

insert into public.listing_batches (
  id, store_id, species_id, origin_date, available_date, base_price,
  batch_type, visibility_status, moderation_status
)
select
  batch.id,
  'f4000000-0000-4000-8000-000000000010'::uuid,
  species.id,
  current_date - 30,
  batch.available_date,
  12.00,
  'live_animals',
  batch.visibility_status,
  'normal'
from public.species
cross join (
  values
    ('f4000000-0000-4000-8000-000000000030'::uuid, current_date, 'active'),
    ('f4000000-0000-4000-8000-000000000031'::uuid, current_date + 7, 'active'),
    ('f4000000-0000-4000-8000-000000000032'::uuid, current_date, 'hidden')
) as batch(id, available_date, visibility_status)
where species.slug = 'chicken';

insert into public.listing_batch_breeds (
  id, store_id, listing_batch_id, seller_breed_profile_id,
  visibility_status, moderation_status
)
values
  (
    'f4000000-0000-4000-8000-000000000040',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000030',
    'f4000000-0000-4000-8000-000000000020', 'active', 'normal'
  ),
  (
    'f4000000-0000-4000-8000-000000000041',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000031',
    'f4000000-0000-4000-8000-000000000020', 'active', 'normal'
  ),
  (
    'f4000000-0000-4000-8000-000000000042',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000032',
    'f4000000-0000-4000-8000-000000000020', 'active', 'normal'
  );

insert into public.inventory_items (
  id, store_id, listing_batch_id, listing_batch_breed_id, inventory_type,
  quantity_available, price_override, visibility_status, moderation_status,
  sort_order
)
values
  (
    'f4000000-0000-4000-8000-000000000050',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000030',
    'f4000000-0000-4000-8000-000000000040', 'female', 4, 14.00,
    'active', 'normal', 0
  ),
  (
    'f4000000-0000-4000-8000-000000000051',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000030',
    'f4000000-0000-4000-8000-000000000040', 'male', 0, 10.00,
    'active', 'normal', 1
  ),
  (
    'f4000000-0000-4000-8000-000000000052',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000031',
    'f4000000-0000-4000-8000-000000000041', 'female', 2, 15.00,
    'active', 'normal', 0
  ),
  (
    'f4000000-0000-4000-8000-000000000053',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000032',
    'f4000000-0000-4000-8000-000000000042', 'female', 9, 11.00,
    'active', 'normal', 0
  );

insert into public.equipment_inventory_items (
  id, store_id, item_name, category, condition, quantity_available, price,
  visibility_status, moderation_status, available_date, seller_notes
)
values
  (
    'f4000000-0000-4000-8000-000000000060',
    'f4000000-0000-4000-8000-000000000010', 'Preview Feeder',
    'Feeders & Waterers', 'Good', 3, 20.00, 'active', 'normal', current_date,
    'Private equipment note'
  ),
  (
    'f4000000-0000-4000-8000-000000000061',
    'f4000000-0000-4000-8000-000000000010', 'Future Feeder',
    'Feeders & Waterers', 'Good', 3, 20.00, 'active', 'normal',
    current_date + 1, null
  ),
  (
    'f4000000-0000-4000-8000-000000000062',
    'f4000000-0000-4000-8000-000000000010', 'Empty Feeder',
    'Feeders & Waterers', 'Good', 0, 20.00, 'active', 'normal', current_date,
    null
  );

insert into public.hatching_egg_inventory_items (
  id, store_id, item_name, species_id, quantity_available, price,
  available_date, minimum_order_quantity, visibility_status,
  moderation_status, archived_at, seller_notes
)
select
  egg.id,
  'f4000000-0000-4000-8000-000000000010'::uuid,
  egg.item_name,
  species.id,
  egg.quantity_available,
  5.00,
  egg.available_date,
  2,
  'active',
  'normal',
  egg.archived_at,
  'Private egg note'
from public.species
cross join (
  values
    (
      'f4000000-0000-4000-8000-000000000070'::uuid,
      'Current Eggs', 6, current_date, null::timestamptz
    ),
    (
      'f4000000-0000-4000-8000-000000000071'::uuid,
      'Future Eggs', 5, current_date + 5, null::timestamptz
    ),
    (
      'f4000000-0000-4000-8000-000000000072'::uuid,
      'Empty Eggs', 0, current_date, null::timestamptz
    ),
    (
      'f4000000-0000-4000-8000-000000000073'::uuid,
      'Archived Eggs', 8, current_date, statement_timestamp()
    )
) as egg(id, item_name, quantity_available, available_date, archived_at)
where species.slug = 'chicken';

insert into public.processed_poultry_inventory_items (
  id, store_id, product_name, poultry_type, product_type,
  quantity_available, price, visibility_status, moderation_status,
  available_date, seller_notes
)
values
  (
    'f4000000-0000-4000-8000-000000000080',
    'f4000000-0000-4000-8000-000000000010', 'Preview Whole Bird',
    'Chicken', 'Meat & Broth', 2, 30.00, 'active', 'normal', current_date,
    'Private poultry note'
  ),
  (
    'f4000000-0000-4000-8000-000000000081',
    'f4000000-0000-4000-8000-000000000010', 'Future Whole Bird',
    'Chicken', 'Meat & Broth', 2, 30.00, 'active', 'normal', current_date + 1,
    null
  ),
  (
    'f4000000-0000-4000-8000-000000000082',
    'f4000000-0000-4000-8000-000000000010', 'Empty Whole Bird',
    'Chicken', 'Meat & Broth', 0, 30.00, 'active', 'normal', current_date,
    null
  );

insert into public.media_assets (
  id, store_id, uploaded_by_user_id, bucket_name, storage_path,
  original_filename, content_type, file_size_bytes, width_px, height_px,
  alt_text, asset_status, moderation_status
)
values
  (
    'f4000000-0000-4000-8000-000000000090',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000001', 'seller-media',
    'stores/f4000000-0000-4000-8000-000000000010/profile.webp',
    'profile.webp', 'image/webp', 100, 100, 100,
    'Approved profile image', 'active', 'approved'
  ),
  (
    'f4000000-0000-4000-8000-000000000091',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000001', 'seller-media',
    'stores/f4000000-0000-4000-8000-000000000010/unapproved.webp',
    'unapproved.webp', 'image/webp', 100, 100, 100,
    'Unapproved inventory image', 'active', 'pending'
  );

insert into public.media_links (
  id, store_id, media_asset_id, entity_type, entity_id, display_context,
  sort_order, is_featured, visibility_status
)
values
  (
    'f4000000-0000-4000-8000-000000000100',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000090', 'seller_breed_profile',
    'f4000000-0000-4000-8000-000000000020', 'gallery', 0, true, 'active'
  ),
  (
    'f4000000-0000-4000-8000-000000000101',
    'f4000000-0000-4000-8000-000000000010',
    'f4000000-0000-4000-8000-000000000091', 'inventory_item',
    'f4000000-0000-4000-8000-000000000050', 'gallery', 0, true, 'active'
  );

select ok(
  not has_function_privilege(
    'anon', 'public.get_seller_storefront_preview_data(text)', 'execute'
  ),
  'anonymous callers cannot execute seller preview inventory'
);

select results_eq(
  format(
    'select count(*)::bigint from public.%I where store_id = %L::uuid',
    view_name,
    'f4000000-0000-4000-8000-000000000010'
  ),
  array[0::bigint],
  format('hidden store remains absent from public.%s', view_name)
)
from unnest(array[
  'public_storefront_inventory',
  'public_storefront_equipment_inventory',
  'public_storefront_hatching_egg_inventory',
  'public_storefront_processed_poultry_inventory',
  'public_storefront_media_gallery'
]) as public_views(view_name);

select set_config(
  'request.jwt.claim.sub',
  'f4000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (
    select jsonb_array_length(inventory)
    from public.get_seller_storefront_preview_data('hidden-preview-farm')
  ),
  3,
  'owner preview includes eligible live, future, and public sold-out Live Birds rows'
);

select is(
  (
    select jsonb_array_length(equipment)
    from public.get_seller_storefront_preview_data('hidden-preview-farm')
  ),
  1,
  'owner preview excludes future and zero-quantity equipment'
);

select is(
  (
    select jsonb_array_length(hatching_eggs)
    from public.get_seller_storefront_preview_data('hidden-preview-farm')
  ),
  2,
  'owner preview includes current/future eggs and excludes zero/archived eggs'
);

select is(
  (
    select jsonb_array_length(processed_poultry)
    from public.get_seller_storefront_preview_data('hidden-preview-farm')
  ),
  1,
  'owner preview excludes future and zero-quantity processed poultry'
);

select is(
  (
    select storefront_home ->> 'public_inventory_item_count'
    from public.get_seller_storefront_preview_data('hidden-preview-farm')
  ),
  '7',
  'preview home count includes every eligible returned module row'
);

select is(
  (
    select live_poultry_profile_images
      -> 'f4000000-0000-4000-8000-000000000020'
      ->> 'imageAlt'
    from public.get_seller_storefront_preview_data('hidden-preview-farm')
  ),
  'Approved profile image',
  'buyer-visible breed profile image is included'
);

select ok(
  (
    select position('Private equipment note' in equipment::text) = 0
      and position('Private egg note' in hatching_eggs::text) = 0
      and position('Private poultry note' in processed_poultry::text) = 0
      and position('Unapproved inventory image' in inventory::text) = 0
    from public.get_seller_storefront_preview_data('hidden-preview-farm')
  ),
  'seller notes and unapproved media are absent from the buyer-safe payload'
);

select throws_ok(
  $$select * from public.get_seller_storefront_preview_data('other-hidden-farm')$$,
  '42501',
  'Storefront preview is not available for this account.',
  'seller A cannot request seller B preview data'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

update public.stores
set equipment_supplies_enabled = false
where id = 'f4000000-0000-4000-8000-000000000010';

select set_config(
  'request.jwt.claim.sub',
  'f4000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (
    select jsonb_array_length(equipment)
    from public.get_seller_storefront_preview_data('hidden-preview-farm')
  ),
  0,
  'disabled Equipment module remains hidden in owner preview'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

update public.stores
set equipment_supplies_enabled = true
where id = 'f4000000-0000-4000-8000-000000000010';

update public.seller_breed_profiles
set visibility_status = 'hidden'
where id = 'f4000000-0000-4000-8000-000000000020';

select set_config(
  'request.jwt.claim.sub',
  'f4000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (
    select jsonb_array_length(inventory)
    from public.get_seller_storefront_preview_data('hidden-preview-farm')
  ),
  0,
  'inactive breed profiles remain hidden in owner preview'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

update public.seller_breed_profiles
set visibility_status = 'active'
where id = 'f4000000-0000-4000-8000-000000000020';

update public.seller_billing_status
set
  requested_plan_key = 'small_flock',
  plan_key = 'small_flock'
where store_id = 'f4000000-0000-4000-8000-000000000010';

select set_config(
  'request.jwt.claim.sub',
  'f4000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select ok(
  (
    select jsonb_array_length(inventory) = 3
      and jsonb_array_length(equipment) = 0
      and jsonb_array_length(hatching_eggs) = 0
      and jsonb_array_length(processed_poultry) = 0
    from public.get_seller_storefront_preview_data('hidden-preview-farm')
  ),
  'Coop preview retains eligible Live Birds and hides every Market-only module'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

update public.seller_billing_status
set
  requested_plan_key = 'full_flock',
  plan_key = 'full_flock'
where store_id = 'f4000000-0000-4000-8000-000000000010';

select set_config(
  'request.jwt.claim.sub',
  'f4000000-0000-4000-8000-000000000003',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select * from public.get_seller_storefront_preview_data('hidden-preview-farm')$$,
  'existing platform admin role can preview seller inventory'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

select throws_ok(
  $$select * from public.get_seller_storefront_preview_data('hidden-preview-farm')$$,
  '42501',
  'permission denied for function get_seller_storefront_preview_data',
  'anonymous caller cannot invoke the preview RPC'
);

reset role;
select * from finish();
rollback;
