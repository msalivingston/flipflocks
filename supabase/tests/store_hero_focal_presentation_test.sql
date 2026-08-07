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
    'f5000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'hero-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'f5000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'hero-other@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'f5000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'hero-admin@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.user_roles (user_id, role, store_id)
values ('f5000000-0000-4000-8000-000000000003', 'admin', null);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled
)
values
  (
    'f5000000-0000-4000-8000-000000000010',
    'f5000000-0000-4000-8000-000000000001',
    'Hero Focal Farm', 'hero-focal-farm', 'live', 'hosted', true
  ),
  (
    'f5000000-0000-4000-8000-000000000011',
    'f5000000-0000-4000-8000-000000000001',
    'No Hero Farm', 'no-hero-farm', 'draft', 'hosted', false
  );

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, storefront_access_until,
  billing_state_authority, comp_granted_by_user_id, comp_grant_reason,
  comp_granted_at, comp_access_until
)
values (
  'f5000000-0000-4000-8000-000000000010',
  'full_flock', 'monthly', 'full_flock', 'comped', 'comped',
  statement_timestamp() + interval '30 days', 'admin_comp',
  'f5000000-0000-4000-8000-000000000003', 'Hero focal test',
  statement_timestamp(), statement_timestamp() + interval '30 days'
);

insert into public.media_assets (
  id, store_id, uploaded_by_user_id, bucket_name, storage_path,
  original_filename, content_type, file_size_bytes, width_px, height_px,
  alt_text, asset_status, moderation_status
)
values (
  'f5000000-0000-4000-8000-000000000020',
  'f5000000-0000-4000-8000-000000000010',
  'f5000000-0000-4000-8000-000000000001',
  'seller-media', 'stores/f5000000-0000-4000-8000-000000000010/hero.webp',
  'hero.webp', 'image/webp', 100, 2100, 900,
  'Hero focal test', 'active', 'approved'
);

insert into public.media_links (
  id, store_id, media_asset_id, entity_type, entity_id, display_context,
  sort_order, is_featured, visibility_status, hero_layout, hero_presentation
)
values (
  'f5000000-0000-4000-8000-000000000030',
  'f5000000-0000-4000-8000-000000000010',
  'f5000000-0000-4000-8000-000000000020',
  'store', 'f5000000-0000-4000-8000-000000000010', 'hero',
  0, true, 'active', 'right',
  '{"desktop":{"x":25,"y":75}}'::jsonb
);

select ok(
  public.is_valid_store_hero_presentation(
    '{"desktop":{"x":0,"y":100},"mobile":{"x":50,"y":50}}'::jsonb
  ),
  'desktop and optional mobile focal points accept the full allowed range'
);

select ok(
  not public.is_valid_store_hero_presentation(
    '{"desktop":{"x":101,"y":50}}'::jsonb
  ),
  'out-of-range focal points are rejected authoritatively'
);

select ok(
  not public.is_valid_store_hero_presentation(
    '{"desktop":{"x":50,"y":50,"zoom":2}}'::jsonb
  ),
  'obsolete hero presentation fields are rejected'
);

select set_config(
  'request.jwt.claim.sub', 'f5000000-0000-4000-8000-000000000001', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select * from public.seller_update_store_hero_presentation(
    'f5000000-0000-4000-8000-000000000030',
    '{"desktop":{"x":12.345,"y":67.899},"mobile":{"x":88,"y":22}}'
  )$$,
  'owner can save desktop and mobile focal positions in one call'
);

select is(
  (
    select hero_presentation
    from public.get_seller_storefront_home_preview('hero-focal-farm')
  ),
  '{"desktop":{"x":12.35,"y":67.90},"mobile":{"x":88.00,"y":22.00}}'::jsonb,
  'seller preview home returns the saved hero presentation'
);

select is(
  (
    select hero_image_layout
    from public.get_seller_storefront_home_preview('hero-focal-farm')
  ),
  'right',
  'Right hero layout remains available beside focal positioning'
);

select lives_ok(
  $$select * from public.seller_update_store_hero_layout(
    'f5000000-0000-4000-8000-000000000030', 'full'
  )$$,
  'Full hero layout remains saveable'
);

select is(
  (
    select hero_presentation
    from public.get_seller_storefront_home_preview('no-hero-farm')
  ),
  null::jsonb,
  'storefront without a hero returns no presentation safely'
);

reset role;
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

select is(
  (
    select hero_presentation
    from public.get_public_storefront_home('hero-focal-farm')
  ),
  '{"desktop":{"x":12.35,"y":67.90},"mobile":{"x":88.00,"y":22.00}}'::jsonb,
  'public home returns the saved buyer-safe hero presentation'
);

reset role;
select set_config(
  'request.jwt.claim.sub', 'f5000000-0000-4000-8000-000000000002', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select throws_ok(
  $$select * from public.seller_update_store_hero_presentation(
    'f5000000-0000-4000-8000-000000000030',
    '{"desktop":{"x":50,"y":50}}'
  )$$,
  'P0001',
  'Media link not found',
  'another seller cannot modify the hero presentation'
);

reset role;
select * from finish();
rollback;
