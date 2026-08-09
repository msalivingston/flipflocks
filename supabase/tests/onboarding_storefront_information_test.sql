begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  'e5000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'onboarding-simplified@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok(
  $$select * from public.seller_bootstrap_store_from_onboarding('{}'::jsonb)$$,
  '42501',
  'permission denied for function seller_bootstrap_store_from_onboarding',
  'anonymous callers cannot invoke Farm Basics'
);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'e5000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $call$
    select * from public.seller_bootstrap_store_from_onboarding(
      '{
        "store_name":"Onboarding Simplified Farm",
        "phone":"9705551212",
        "billing_address_line1":"10 Billing Road",
        "billing_city":"Billing City",
        "billing_state":"CO",
        "billing_postal_code":"81401",
        "billing_country":"US"
      }'::jsonb
    )
  $call$,
  'Farm Basics creates the pre-checkout store'
);

reset role;

select results_eq(
  $$
    select store_tagline, hero_subheading,
      about_text like 'We%local farm offering poultry and farm goods%',
      pickup_address_line1 is null, pickup_city is null
    from public.stores
    where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (
    'Local poultry, raised with care.'::text,
    'Quality birds and farm goods for backyard flock owners, homesteaders, and small farms.'::text,
    true, true, true
  )$$,
  'a fresh store receives starter copy and no fabricated pickup address'
);

select results_eq(
  $$
    select billing_address_line1, billing_city, billing_state,
      billing_postal_code, billing_country
    from public.stores
    where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (
    '10 Billing Road'::text, 'Billing City'::text, 'CO'::text,
    '81401'::text, 'US'::text
  )$$,
  'Farm Basics saves the private billing address'
);

select is(
  (
    select count(*)::integer
    from public.stores
    where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
      and store_status = 'draft'
      and storefront_enabled = false
  ),
  1,
  'the bootstrap creates one unpublished private draft store'
);

select is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
      and role = 'seller'
  ),
  1,
  'the bootstrap creates the seller role'
);

select results_eq(
  $$
    select profile_complete, storefront_details_complete, billing_complete,
      categories_complete, pickup_complete, onboarding_complete
    from public.seller_onboarding_state
    where store_id = (
      select id from public.stores
      where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  $$values (true, false, false, false, false, false)$$,
  'Farm Basics satisfies the unchanged checkout profile prerequisite only'
);

update public.stores
set store_tagline = 'Saved seller headline',
    hero_subheading = 'Saved seller subline',
    about_text = 'Saved seller description.'
where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid;

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $call$
    select * from public.seller_bootstrap_store_from_onboarding(
      '{
        "store_name":"Onboarding Simplified Farm Renamed",
        "phone":"9705553434",
        "billing_address_line1":"11 Billing Road",
        "billing_city":"New Billing City",
        "billing_state":"WY",
        "billing_postal_code":"82001",
        "billing_country":"US"
      }'::jsonb
    )
  $call$,
  'Farm Basics is idempotent for an existing partial account'
);

reset role;

select results_eq(
  $$
    select store_tagline, hero_subheading, about_text,
      billing_address_line1, pickup_address_line1 is null
    from public.stores
    where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (
    'Saved seller headline'::text, 'Saved seller subline'::text,
    'Saved seller description.'::text, '11 Billing Road'::text, true
  )$$,
  'editing Farm Basics preserves saved storefront copy and still leaves pickup unset'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select throws_ok(
  $$select * from public.seller_save_onboarding_storefront_details(
    '{"store_tagline":"New headline","hero_subheading":"New subline","about_text":"New description.","location_display_preference":"city_state"}'::jsonb
  )$$,
  'P0001',
  'Complete plan and payment before saving storefront details.',
  'Storefront Details cannot bypass verified billing'
);

reset role;

update public.seller_onboarding_state
set billing_complete = true
where store_id = (
  select id from public.stores
  where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
);

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select * from public.seller_save_onboarding_storefront_details(
    '{"store_tagline":"New headline","hero_subheading":"New subline","about_text":"New description.","location_display_preference":"manual"}'::jsonb
  )$$,
  'verified billing permits Storefront Details'
);

reset role;

select results_eq(
  $$
    select store_tagline, hero_subheading, about_text,
      location_display_preference, billing_address_line1,
      pickup_address_line1 is null, hatching_eggs_enabled,
      equipment_supplies_enabled, processed_poultry_enabled,
      store_slug
    from public.stores
    where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (
    'New headline'::text, 'New subline'::text, 'New description.'::text,
    'manual'::text, '11 Billing Road'::text, true,
    false, false, false, 'onboarding-simplified-farm-renamed'::text
  )$$,
  'Storefront Details changes only its allocated storefront fields'
);

select results_eq(
  $$
    select profile_complete, billing_complete, storefront_details_complete,
      categories_complete, pickup_complete
    from public.seller_onboarding_state
    where store_id = (
      select id from public.stores
      where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  $$values (true, true, true, false, false)$$,
  'Storefront Details records its own completion without resetting progress'
);

update public.seller_onboarding_state
set categories_complete = true
where store_id = (
  select id from public.stores
  where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
);

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select * from public.seller_save_onboarding_pickup(
    '{
      "pickup_address_line1":"20 Pickup Lane",
      "pickup_address_line2":"Barn 2",
      "pickup_city":"Pickup Town",
      "pickup_state":"CO",
      "pickup_postal_code":"81402",
      "pickup_country":"US",
      "pickup_policy":"Pickup is by appointment.",
      "email_enabled":true,
      "text_enabled":false,
      "phone_enabled":false
    }'::jsonb
  )$$,
  'Pickup Details saves the address and policy together'
);

reset role;

select results_eq(
  $$
    select billing_address_line1, pickup_address_line1, pickup_address_line2,
      pickup_city, pickup_state, pickup_postal_code, pickup_policy,
      buyer_contact_email_enabled
    from public.stores
    where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (
    '11 Billing Road'::text, '20 Pickup Lane'::text, 'Barn 2'::text,
    'Pickup Town'::text, 'CO'::text, '81402'::text,
    'Pickup is by appointment.'::text, true
  )$$,
  'billing and pickup addresses remain distinct'
);

select is(
  (
    select pickup_complete
    from public.seller_onboarding_state
    where store_id = (
      select id from public.stores
      where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
    )
  ),
  true,
  'Pickup Details marks its authoritative step complete'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select throws_ok(
  $$select * from public.seller_complete_onboarding()$$,
  'P0001',
  'SELLER_TERMS_ACCEPTANCE_REQUIRED',
  'final completion still requires current Seller Terms acceptance'
);

reset role;

insert into public.seller_terms_acceptances (
  store_id, terms_version, accepted_by_user_id, accepted_at
)
select id, public.current_seller_terms_version(), owner_user_id, now()
from public.stores
where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid;

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select * from public.seller_complete_onboarding()$$,
  'all authoritative prerequisites allow final completion'
);

reset role;

select is(
  (
    select onboarding_complete
    from public.seller_onboarding_state
    where store_id = (
      select id from public.stores
      where owner_user_id = 'e5000000-0000-4000-8000-000000000001'::uuid
    )
  ),
  true,
  'final completion records the completed state'
);

select * from finish();

rollback;
