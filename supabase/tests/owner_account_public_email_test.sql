begin;

create extension if not exists pgtap with schema extensions;

select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select hasnt_column(
  'public',
  'stores',
  'public_email',
  'stores no longer has a separate public email address'
);

select has_column(
  'public',
  'stores',
  'show_public_email',
  'stores retains the public-email visibility preference'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    'ac000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'owner-public@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    'ac000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'scoped-staff@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled, storefront_visibility, show_public_email,
  public_phone, show_public_phone, website_url, show_public_website
)
values
  (
    'ac000000-0000-4000-8000-000000000010',
    'ac000000-0000-4000-8000-000000000001',
    'Owner Email Visible', 'owner-email-visible', 'live', 'hosted', true,
    'public', true, '555-0100', true, 'https://visible.example.test', true
  ),
  (
    'ac000000-0000-4000-8000-000000000011',
    'ac000000-0000-4000-8000-000000000001',
    'Owner Email Hidden', 'owner-email-hidden', 'live', 'hosted', true,
    'public', false, '555-0101', true, 'https://hidden.example.test', true
  );

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, storefront_access_until,
  billing_state_authority, comp_granted_by_user_id, comp_grant_reason,
  comp_granted_at, comp_access_until
)
values
  (
    'ac000000-0000-4000-8000-000000000010',
    'small_flock', 'monthly', 'small_flock', 'comped', 'comped',
    statement_timestamp() + interval '30 days', 'admin_comp',
    'ac000000-0000-4000-8000-000000000001', 'Public email test fixture',
    statement_timestamp(), statement_timestamp() + interval '30 days'
  ),
  (
    'ac000000-0000-4000-8000-000000000011',
    'small_flock', 'monthly', 'small_flock', 'comped', 'comped',
    statement_timestamp() + interval '30 days', 'admin_comp',
    'ac000000-0000-4000-8000-000000000001', 'Public email test fixture',
    statement_timestamp(), statement_timestamp() + interval '30 days'
  );

insert into public.user_roles (user_id, role, store_id)
values (
  'ac000000-0000-4000-8000-000000000002',
  'staff',
  'ac000000-0000-4000-8000-000000000010'
);

select is(
  (
    select public_email
    from public.public_storefronts
    where store_id = 'ac000000-0000-4000-8000-000000000010'
  ),
  'owner-public@example.test',
  'public storefront projection exposes the owner account email when enabled'
);

select is(
  (
    select public_email
    from public.public_storefronts
    where store_id = 'ac000000-0000-4000-8000-000000000011'
  ),
  null,
  'public storefront projection hides the owner account email when disabled'
);

select is(
  (
    select public_email
    from public.get_public_storefront_home('owner-email-visible')
  ),
  'owner-public@example.test',
  'public storefront home returns the canonical owner email'
);

select is(
  (
    select public_email
    from public.get_public_storefront_home('owner-email-hidden')
  ),
  null,
  'public storefront home returns no email when visibility is disabled'
);

select results_eq(
  $$
    select public_phone, website_url
    from public.get_public_storefront_home('owner-email-visible')
  $$,
  $$ values ('555-0100'::text, 'https://visible.example.test'::text) $$,
  'phone and website public contact behavior is unchanged'
);

update auth.users
set email = 'owner-updated@example.test'
where id = 'ac000000-0000-4000-8000-000000000001';

select is(
  (
    select public_email
    from public.get_public_storefront_home('owner-email-visible')
  ),
  'owner-updated@example.test',
  'an account-email change is reflected publicly without a store edit'
);

select set_config(
  'request.jwt.claim.sub',
  'ac000000-0000-4000-8000-000000000001',
  true
);

select is(
  (
    select public_email
    from public.get_seller_storefront_home_preview('owner-email-visible')
  ),
  'owner-updated@example.test',
  'seller storefront preview resolves the actual store owner account email'
);

select set_config(
  'request.jwt.claim.sub',
  'ac000000-0000-4000-8000-000000000002',
  true
);

select is(
  (
    select public_email
    from public.get_public_storefront_home('owner-email-visible')
  ),
  'owner-updated@example.test',
  'a scoped staff identity cannot substitute its email for the store owner email'
);

select is_empty(
  $$
    select item_key
    from public.evaluate_store_launch_readiness(
      'ac000000-0000-4000-8000-000000000011',
      'ac000000-0000-4000-8000-000000000001'
    )
    where item_key = 'public_email_present'
  $$,
  'launch readiness does not require or warn about a public email address'
);

select ok(
  position(
    'public_email' in
    replace(
      pg_get_function_result('public.get_seller_context()'::regprocedure),
      'show_public_email',
      ''
    )
  ) = 0,
  'seller context exposes the visibility preference but no email address field'
);

select ok(
  position(
    'public_email' in
    replace(
      pg_get_functiondef(
        'public.seller_update_store_settings(uuid,jsonb)'::regprocedure
      ),
      'show_public_email',
      ''
    )
  ) = 0,
  'seller settings accepts visibility only and cannot save another email address'
);

select is_empty(
  $$
    select procedures.oid
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.prosrc ~ '(stores|target_store|v_store)\.public_email'
  $$,
  'no active public function reads the removed stores.public_email column'
);

select is_empty(
  $$
    select viewname
    from pg_views
    where schemaname = 'public'
      and definition ~ 'stores\.public_email'
  $$,
  'no active public view reads the removed stores.public_email column'
);

select * from finish();

rollback;
