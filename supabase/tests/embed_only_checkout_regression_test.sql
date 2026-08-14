begin;

create extension if not exists pgtap with schema extensions;

select plan(10);
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    'e8100000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'public-checkout@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'e8100000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'embed-checkout@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled, storefront_visibility, website_url,
  pay_at_pickup_enabled, card_payments_enabled
)
values
  (
    'e8100000-0000-4000-8000-000000000010',
    'e8100000-0000-4000-8000-000000000001',
    'Public Checkout Farm', 'public-checkout-farm', 'live', 'hosted', true,
    'public', null, true, false
  ),
  (
    'e8100000-0000-4000-8000-000000000020',
    'e8100000-0000-4000-8000-000000000002',
    'Embed Checkout Farm', 'embed-checkout-farm', 'live', 'hosted', true,
    'embed_only', 'https://example.test/shopping', true, true
  );

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  billing_state_authority
)
values
  (
    'e8100000-0000-4000-8000-000000000010',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    now(), now() + interval '7 days', now(), now() + interval '7 days',
    now() + interval '7 days', 'trial'
  ),
  (
    'e8100000-0000-4000-8000-000000000020',
    'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
    now(), now() + interval '7 days', now(), now() + interval '7 days',
    now() + interval '7 days', 'trial'
  );

update public.stores
set equipment_supplies_enabled = true
where id in (
  'e8100000-0000-4000-8000-000000000010',
  'e8100000-0000-4000-8000-000000000020'
);

insert into public.equipment_inventory_items (
  id, store_id, item_name, category, condition, quantity_available, price,
  visibility_status, moderation_status, available_date
)
values
  (
    'e8100000-0000-4000-8000-000000000110',
    'e8100000-0000-4000-8000-000000000010',
    'Public Feeder', 'Feeders & Waterers', 'Good', 2, 25.00,
    'active', 'normal', current_date
  ),
  (
    'e8100000-0000-4000-8000-000000000120',
    'e8100000-0000-4000-8000-000000000020',
    'Embed Feeder', 'Feeders & Waterers', 'Good', 2, 25.00,
    'active', 'normal', current_date
  );

select is(
  (
    select storefront ->> 'store_id'
    from public.get_public_storefront_by_slug('public-checkout-farm')
  ),
  'e8100000-0000-4000-8000-000000000010',
  'public storefront lookup still returns its canonical home payload'
);

select is(
  (
    select is_checkout_available
    from public.get_public_checkout_summary(
      'public-checkout-farm',
      '[{"item_type":"equipment_inventory","item_id":"e8100000-0000-4000-8000-000000000110","quantity":1}]'::jsonb
    )
  ),
  true,
  'public storefront checkout remains available'
);

select is(
  (
    select storefront ->> 'store_id'
    from public.get_public_storefront_by_slug('embed-checkout-farm')
  ),
  'e8100000-0000-4000-8000-000000000020',
  'embed-only storefront lookup returns its canonical home payload'
);

select is(
  (
    select storefront ->> 'pay_at_pickup_enabled'
    from public.get_public_storefront_by_slug('embed-checkout-farm')
  ),
  'true',
  'embed-only storefront payload preserves Pay at Pickup'
);

select is(
  (
    select storefront ->> 'card_payments_enabled'
    from public.get_public_storefront_by_slug('embed-checkout-farm')
  ),
  'true',
  'embed-only storefront payload exposes enabled card payments to availability checks'
);

select is(
  (
    select is_checkout_available
    from public.get_public_checkout_summary(
      'embed-checkout-farm',
      '[{"item_type":"equipment_inventory","item_id":"e8100000-0000-4000-8000-000000000120","quantity":1}]'::jsonb
    )
  ),
  true,
  'embed-only storefront checkout is available after validated route access'
);

select is(
  (
    select count(*)::integer
    from public.public_storefronts
    where store_slug = 'public-checkout-farm'
  ),
  1,
  'public storefront remains in the public storefront projection'
);

select is(
  (
    select count(*)::integer
    from public.public_storefronts
    where store_slug = 'embed-checkout-farm'
  ),
  0,
  'embed-only storefront remains excluded from the public storefront projection'
);

select is(
  (
    select count(*)::integer
    from public.public_discoverable_storefronts
    where store_slug = 'embed-checkout-farm'
  ),
  0,
  'embed-only storefront remains excluded from public discovery'
);

select is(
  (
    select count(*)::integer
    from public.public_discoverable_inventory
    where store_slug = 'embed-checkout-farm'
  ),
  0,
  'embed-only inventory remains excluded from public discovery'
);

select * from finish();

rollback;
