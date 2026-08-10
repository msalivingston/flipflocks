begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select hasnt_column(
  'public', 'stores', 'show_public_website',
  'website has no public-contact visibility flag'
);
select has_column('public', 'stores', 'show_public_email', 'email visibility remains');
select has_column('public', 'stores', 'show_public_phone', 'phone visibility remains');
select col_default_is(
  'public', 'stores', 'show_public_email', 'true',
  'new stores start with a valid email contact method'
);
select has_check(
  'public', 'stores',
  'stores has a check constraint for public contact visibility'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.stores'::regclass
      and conname = 'stores_public_contact_method_required'
      and contype = 'c'
  ),
  'the database requires email or phone visibility'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    'ad000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'contact-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'ad000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'contact-staff@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, hero_subheading, store_slug, store_status,
  storefront_mode, storefront_enabled, storefront_visibility, public_phone,
  show_public_email, show_public_phone, website_url,
  buyer_contact_phone_enabled, buyer_contact_text_enabled
)
values
  (
    'ad000000-0000-4000-8000-000000000010',
    'ad000000-0000-4000-8000-000000000001',
    'Both Contacts Farm', 'Both contacts', 'both-contacts-farm', 'live',
    'hosted', true, 'public', '555-0100', true, true,
    'https://both.example.test', true, true
  ),
  (
    'ad000000-0000-4000-8000-000000000011',
    'ad000000-0000-4000-8000-000000000001',
    'Email Contact Farm', 'Email contact', 'email-contact-farm', 'live',
    'hosted', true, 'public', '555-0101', true, false,
    'https://email.example.test', false, false
  ),
  (
    'ad000000-0000-4000-8000-000000000012',
    'ad000000-0000-4000-8000-000000000001',
    'Phone Contact Farm', 'Phone contact', 'phone-contact-farm', 'live',
    'hosted', true, 'public', '555-0102', false, true,
    'https://phone.example.test', true, false
  ),
  (
    'ad000000-0000-4000-8000-000000000013',
    'ad000000-0000-4000-8000-000000000001',
    'Embedded Contact Farm', 'Embedded contact', 'embedded-contact-farm', 'live',
    'embedded', true, 'embed_only', '555-0103', true, false,
    'https://embedded.example.test', false, true
  );

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, storefront_access_until,
  billing_state_authority, comp_granted_by_user_id, comp_grant_reason,
  comp_granted_at, comp_access_until
)
select
  stores.id, 'small_flock', 'monthly', 'small_flock', 'comped', 'comped',
  statement_timestamp() + interval '30 days', 'admin_comp',
  'ad000000-0000-4000-8000-000000000001'::uuid,
  'Storefront contact visibility test', statement_timestamp(),
  statement_timestamp() + interval '30 days'
from public.stores
where stores.id between
  'ad000000-0000-4000-8000-000000000010'::uuid and
  'ad000000-0000-4000-8000-000000000013'::uuid;

insert into public.user_roles (user_id, role, store_id)
values (
  'ad000000-0000-4000-8000-000000000002', 'staff',
  'ad000000-0000-4000-8000-000000000010'
);

select results_eq(
  $$select public_email, public_phone, buyer_contact_phone_enabled,
      buyer_contact_text_enabled, website_url
    from public.get_public_storefront_home('both-contacts-farm')$$,
  $$values (
    'contact-owner@example.test'::text, '555-0100'::text,
    true, true, 'https://both.example.test'::text
  )$$,
  'email and phone can display together while website remains operational data'
);

select results_eq(
  $$select public_email, public_phone
    from public.get_public_storefront_home('email-contact-farm')$$,
  $$values ('contact-owner@example.test'::text, null::text)$$,
  'email displays and phone is hidden when only email is enabled'
);

select results_eq(
  $$select public_email, public_phone
    from public.get_public_storefront_home('phone-contact-farm')$$,
  $$values (null::text, '555-0102'::text)$$,
  'phone displays and email is hidden when only phone is enabled'
);

select set_config('request.jwt.claim.sub', 'ad000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select public_email, public_phone, buyer_contact_phone_enabled,
      buyer_contact_text_enabled
    from public.get_seller_storefront_home_preview('both-contacts-farm')$$,
  $$values ('contact-owner@example.test'::text, '555-0100'::text, true, true)$$,
  'seller preview matches public email, phone, and phone-label context'
);

select set_config('request.jwt.claim.sub', 'ad000000-0000-4000-8000-000000000002', true);
select is(
  (select public_email from public.get_public_storefront_home('both-contacts-farm')),
  'contact-owner@example.test',
  'scoped staff identity cannot replace the owner public email'
);

select set_config('request.jwt.claim.sub', 'ad000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select * from public.seller_update_store_settings(
    'ad000000-0000-4000-8000-000000000010',
    '{"show_public_email":false,"show_public_phone":false}'::jsonb
  )$$,
  'P0001',
  'Choose at least one contact method to display on your storefront.',
  'seller settings cannot save both contact methods off'
);
reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select lives_ok(
  $$select * from public.seller_update_store_settings(
    'ad000000-0000-4000-8000-000000000011',
    '{"show_public_email":false,"show_public_phone":true,"buyer_contact_phone_enabled":false,"buyer_contact_text_enabled":true}'::jsonb
  )$$,
  'Store Admin can persist a Text-only public phone choice'
);
reset role;

select results_eq(
  $$select public_email, public_phone, buyer_contact_phone_enabled,
      buyer_contact_text_enabled
    from public.get_public_storefront_home('email-contact-farm')$$,
  $$values (null::text, '555-0101'::text, false, true)$$,
  'Text-only persistence exposes one phone entry with text-only context'
);

select throws_ok(
  $$update public.stores set show_public_email = false, show_public_phone = false
    where id = 'ad000000-0000-4000-8000-000000000010'$$,
  'P0001',
  'Choose at least one contact method to display on your storefront.',
  'direct database updates cannot create a both-off state'
);

insert into public.stores (
  id, owner_user_id, store_name, hero_subheading, store_slug,
  show_public_email, show_public_phone
) values (
  'ad000000-0000-4000-8000-000000000020',
  'ad000000-0000-4000-8000-000000000001',
  'Repaired Contact Farm', 'Repaired contact', 'repaired-contact-farm',
  false, false
);
select is(
  (select show_public_email from public.stores
    where id = 'ad000000-0000-4000-8000-000000000020'),
  true,
  'database repairs a new both-off store to canonical email visibility'
);

select is(
  (select website_url from public.get_public_storefront_access('embedded-contact-farm')),
  'https://embedded.example.test',
  'embed routing retains the raw website URL without a visibility flag'
);

select ok(
  position('show_public_website' in pg_get_function_result(
    'public.get_seller_context()'::regprocedure
  )) = 0,
  'seller context no longer exposes website visibility'
);
select ok(
  position('show_public_website' in pg_get_functiondef(
    'public.seller_update_store_settings(uuid,jsonb)'::regprocedure
  )) = 0,
  'seller settings no longer accepts website visibility'
);
select ok(
  position('show_public_email = v_email_enabled' in pg_get_functiondef(
    'public.seller_save_onboarding_pickup(jsonb)'::regprocedure
  )) > 0
  and position('show_public_phone = (v_text_enabled or v_phone_enabled)' in
    pg_get_functiondef('public.seller_save_onboarding_pickup(jsonb)'::regprocedure)
  ) > 0,
  'onboarding maps Email and Phone or Text to public contact visibility'
);

select is_empty(
  $$select item_key from public.evaluate_store_launch_readiness(
      'ad000000-0000-4000-8000-000000000011',
      'ad000000-0000-4000-8000-000000000001'
    ) where item_key in ('public_email_present', 'public_phone_present')$$,
  'no launch-readiness requirement was introduced'
);

select * from finish();
rollback;
