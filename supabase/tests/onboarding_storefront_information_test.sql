begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  'e5000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'onboarding-storefront@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', ''
);

select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok(
  $$select * from public.seller_bootstrap_store_from_onboarding('{}'::jsonb)$$,
  '42501',
  'permission denied for function seller_bootstrap_store_from_onboarding',
  'anonymous callers cannot invoke the onboarding bootstrap'
);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $call$
    select * from public.seller_bootstrap_store_from_onboarding(
      '{
        "store_name":"Onboarding Storefront Farm",
        "phone":"9705551212",
        "billing_address_line1":"10 Billing Road",
        "billing_city":"Billing City",
        "billing_state":"CO",
        "billing_postal_code":"81401",
        "billing_country":"US",
        "public_city":"Billing City",
        "public_state":"CO",
        "store_tagline":"Local birds raised with care",
        "hero_subheading":"Healthy poultry for backyard flocks.",
        "pickup_address_line1":"20 Pickup Lane",
        "pickup_address_line2":"Barn 2",
        "pickup_city":"Pickup Town",
        "pickup_state":"CO",
        "pickup_postal_code":"81402",
        "pickup_country":"US",
        "about_text":"A local farm offering poultry.",
        "location_display_preference":"city_state"
      }'::jsonb
    )
  $call$,
  'authenticated seller can create the draft store with storefront information'
);

reset role;

select results_eq(
  $$
    select store_tagline, hero_subheading, pickup_address_line1, pickup_address_line2,
      pickup_city, pickup_state, pickup_postal_code, pickup_country
    from public.stores
    where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('Local birds raised with care'::text, 'Healthy poultry for backyard flocks.'::text,
    '20 Pickup Lane'::text, 'Barn 2'::text, 'Pickup Town'::text, 'CO'::text,
    '81402'::text, 'US'::text)$$,
  'onboarding saves hero copy and the canonical pickup fields'
);

select results_eq(
  $$
    select billing_address_line1, billing_city, billing_state, billing_postal_code
    from public.stores
    where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('10 Billing Road'::text, 'Billing City'::text, 'CO'::text, '81401'::text)$$,
  'onboarding preserves distinct billing fields'
);

select is(
  (select count(*)::integer from public.stores where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid),
  1,
  'onboarding creates one store record for the seller'
);

select ok(
  position(
    'Hero tagline is required.' in
    pg_get_functiondef('public.seller_bootstrap_store_from_onboarding(jsonb)'::regprocedure)
  ) > 0
  and position(
    'Pickup address is required.' in
    pg_get_functiondef('public.seller_bootstrap_store_from_onboarding(jsonb)'::regprocedure)
  ) > 0,
  'the authoritative RPC validates required hero copy and pickup address'
);

select * from finish();

rollback;
