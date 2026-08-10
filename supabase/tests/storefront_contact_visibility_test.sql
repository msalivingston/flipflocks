begin;

create extension if not exists pgtap with schema extensions;

select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select has_column(
  'public',
  'stores',
  'show_public_website',
  'stores has an explicit website visibility preference'
);

select ok(
  (
    select is_nullable = 'NO' and column_default = 'false'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'show_public_website'
  ),
  'website visibility is non-null and privacy-safe by default'
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
  show_public_email, show_public_phone, website_url, show_public_website
)
values
  (
    'ad000000-0000-4000-8000-000000000010',
    'ad000000-0000-4000-8000-000000000001',
    'All Contacts Farm', 'All contacts available', 'all-contacts-farm', 'live',
    'hosted', true, 'public', '555-0100', true, true,
    'https://all-contacts.example.test', true
  ),
  (
    'ad000000-0000-4000-8000-000000000011',
    'ad000000-0000-4000-8000-000000000001',
    'Hidden Contacts Farm', 'Contacts remain private', 'hidden-contacts-farm',
    'live', 'hosted', true, 'public', '555-0101', false, false,
    'https://hidden-contacts.example.test', false
  ),
  (
    'ad000000-0000-4000-8000-000000000012',
    'ad000000-0000-4000-8000-000000000001',
    'Embedded Contacts Farm', 'Embedded storefront',
    'embedded-contacts-farm', 'live', 'embedded', true, 'embed_only',
    '555-0102', false, false,
    'https://embedded-contacts.example.test', false
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
where stores.id in (
  'ad000000-0000-4000-8000-000000000010',
  'ad000000-0000-4000-8000-000000000011',
  'ad000000-0000-4000-8000-000000000012'
);

insert into public.user_roles (user_id, role, store_id)
values (
  'ad000000-0000-4000-8000-000000000002',
  'staff',
  'ad000000-0000-4000-8000-000000000010'
);

select set_config(
  'request.jwt.claim.sub',
  'ad000000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $$
    select *
    from public.seller_update_store_settings(
      'ad000000-0000-4000-8000-000000000010',
      '{"show_public_website":false}'::jsonb
    )
  $$,
  'seller settings persists the new website visibility preference'
);

select is(
  (
    select show_public_website
    from public.stores
    where id = 'ad000000-0000-4000-8000-000000000010'
  ),
  false,
  'seller settings can disable public website display'
);

select lives_ok(
  $$
    select *
    from public.seller_update_store_settings(
      'ad000000-0000-4000-8000-000000000010',
      '{"show_public_website":true}'::jsonb
    )
  $$,
  'seller settings can re-enable public website display'
);

select results_eq(
  $$
    select public_email, public_phone, website_url
    from public.get_public_storefront_home('all-contacts-farm')
  $$,
  $$
    values (
      'contact-owner@example.test'::text,
      '555-0100'::text,
      'https://all-contacts.example.test'::text
    )
  $$,
  'email, phone, and website can be displayed together'
);

select results_eq(
  $$
    select public_email, public_phone, website_url
    from public.get_public_storefront_home('hidden-contacts-farm')
  $$,
  $$ values (null::text, null::text, null::text) $$,
  'each disabled public contact method is hidden'
);

update public.stores
set show_public_email = true
where id = 'ad000000-0000-4000-8000-000000000011';

select results_eq(
  $$
    select public_email, public_phone, website_url
    from public.get_public_storefront_home('hidden-contacts-farm')
  $$,
  $$
    values ('contact-owner@example.test'::text, null::text, null::text)
  $$,
  'email visibility is independent from phone and website visibility'
);

update public.stores
set show_public_email = false, show_public_phone = true
where id = 'ad000000-0000-4000-8000-000000000011';

select results_eq(
  $$
    select public_email, public_phone, website_url
    from public.get_public_storefront_home('hidden-contacts-farm')
  $$,
  $$ values (null::text, '555-0101'::text, null::text) $$,
  'phone visibility is independent from email and website visibility'
);

update public.stores
set show_public_phone = false, show_public_website = true
where id = 'ad000000-0000-4000-8000-000000000011';

select results_eq(
  $$
    select public_email, public_phone, website_url
    from public.get_public_storefront_home('hidden-contacts-farm')
  $$,
  $$
    values (null::text, null::text, 'https://hidden-contacts.example.test'::text)
  $$,
  'website visibility is independent from email and phone visibility'
);

select results_eq(
  $$
    select public_email, public_phone, website_url
    from public.public_storefronts
    where store_id = 'ad000000-0000-4000-8000-000000000010'
  $$,
  $$
    values (
      'contact-owner@example.test'::text,
      '555-0100'::text,
      'https://all-contacts.example.test'::text
    )
  $$,
  'the public storefront projection applies all three visibility flags'
);

select set_config(
  'request.jwt.claim.sub',
  'ad000000-0000-4000-8000-000000000001',
  true
);

select results_eq(
  $$
    select public_email, public_phone, website_url
    from public.get_seller_storefront_home_preview('all-contacts-farm')
  $$,
  $$
    values (
      'contact-owner@example.test'::text,
      '555-0100'::text,
      'https://all-contacts.example.test'::text
    )
  $$,
  'seller preview matches the public contact visibility projection'
);

select set_config(
  'request.jwt.claim.sub',
  'ad000000-0000-4000-8000-000000000002',
  true
);

select is(
  (
    select public_email
    from public.get_public_storefront_home('all-contacts-farm')
  ),
  'contact-owner@example.test',
  'scoped staff identity cannot replace the store owner public email'
);

select is(
  (
    select website_url
    from public.get_public_storefront_access('embedded-contacts-farm')
  ),
  'https://embedded-contacts.example.test',
  'embed routing retains the raw website URL when public display is disabled'
);

select is_empty(
  $$
    select item_key
    from public.evaluate_store_launch_readiness(
      'ad000000-0000-4000-8000-000000000011',
      'ad000000-0000-4000-8000-000000000001'
    )
    where item_key in (
      'public_email_present',
      'public_phone_present',
      'public_website_present',
      'show_public_email',
      'show_public_phone',
      'show_public_website'
    )
  $$,
  'public contact choices do not become launch requirements'
);

select ok(
  position(
    'show_public_website boolean' in
    pg_get_function_result('public.get_seller_context()'::regprocedure)
  ) > 0,
  'seller context exposes website visibility state'
);

select ok(
  position(
    '''show_public_website''' in
    pg_get_functiondef(
      'public.seller_update_store_settings(uuid,jsonb)'::regprocedure
    )
  ) > 0,
  'seller settings accepts website visibility state'
);

select * from finish();

rollback;
