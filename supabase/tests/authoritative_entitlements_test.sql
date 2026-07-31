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
    'c3000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'entitlement-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  ),
  (
    'c3000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'entitlement-staff@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  ),
  (
    'c3000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'entitlement-foreign@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  ),
  (
    'c3000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'entitlement-admin@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  ),
  (
    'c3000000-0000-4000-8000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'linked-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled
)
values
  (
    'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000001',
    'Entitlement Owner Store', 'entitlement-owner-store', 'draft', 'hosted', false
  ),
  (
    'c3000000-0000-4000-8000-000000000020',
    'c3000000-0000-4000-8000-000000000003',
    'Entitlement Foreign Store', 'entitlement-foreign-store', 'draft', 'hosted', false
  ),
  (
    'c3000000-0000-4000-8000-000000000050',
    'c3000000-0000-4000-8000-000000000005',
    'Linked Billing Store', 'linked-billing-store', 'draft', 'hosted', false
  );

insert into public.user_roles (user_id, role, store_id)
values
  (
    'c3000000-0000-4000-8000-000000000002',
    'staff',
    'c3000000-0000-4000-8000-000000000010'
  ),
  ('c3000000-0000-4000-8000-000000000004', 'admin', null);

insert into public.seller_onboarding_state (store_id, profile_complete)
values
  ('c3000000-0000-4000-8000-000000000010', true),
  ('c3000000-0000-4000-8000-000000000020', true),
  ('c3000000-0000-4000-8000-000000000050', true);

select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"monthly"}'
  )$$,
  'P0001',
  'Authentication is required.',
  'anonymous callers cannot start a trial'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'c3000000-0000-4000-8000-000000000002',
  true
);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"monthly"}'
  )$$,
  'P0001',
  'Complete farm basics before choosing a plan.',
  'store staff cannot issue the owner trial'
);

select set_config(
  'request.jwt.claim.sub',
  'c3000000-0000-4000-8000-000000000004',
  true
);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"monthly"}'
  )$$,
  'P0001',
  'Complete farm basics before choosing a plan.',
  'a platform admin cannot use seller onboarding unless they are the owner'
);

select set_config(
  'request.jwt.claim.sub',
  'c3000000-0000-4000-8000-000000000001',
  true
);
select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"full_flock","requested_billing_cadence":"monthly","promo_code":"FOUNDINGFLOCK"}'
  )$$,
  'the owner receives the one-time trial'
);

select is(
  (
    select subscription_status
    from public.seller_billing_status
    where store_id = 'c3000000-0000-4000-8000-000000000010'
  ),
  'trialing',
  'promo input cannot create paid or comped access'
);
select is(
  (
    select applied_promo_code
    from public.seller_billing_status
    where store_id = 'c3000000-0000-4000-8000-000000000010'
  ),
  null,
  'the compatibility promo input is not persisted'
);
select is(
  (
    select trial_ends_at - trial_started_at
    from public.seller_billing_status
    where store_id = 'c3000000-0000-4000-8000-000000000010'
  ),
  interval '7 days',
  'the trial is exactly seven days'
);

create temporary table original_trial_boundary as
select trial_started_at, trial_ends_at, storefront_access_until
from public.seller_billing_status
where store_id = 'c3000000-0000-4000-8000-000000000010';

select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'back-navigation may change requested plan and cadence during the trial'
);
select is(
  (
    select trial_started_at
    from public.seller_billing_status
    where store_id = 'c3000000-0000-4000-8000-000000000010'
  ),
  (select trial_started_at from original_trial_boundary),
  'replay cannot move trial_started_at'
);
select is(
  (
    select trial_ends_at
    from public.seller_billing_status
    where store_id = 'c3000000-0000-4000-8000-000000000010'
  ),
  (select trial_ends_at from original_trial_boundary),
  'replay cannot extend the trial cutoff'
);
select is(
  (
    select requested_plan_key || ':' || requested_billing_cadence
    from public.seller_billing_status
    where store_id = 'c3000000-0000-4000-8000-000000000010'
  ),
  'small_flock:yearly',
  'requested plan and cadence remain distinct persisted choices'
);
select is(
  (
    select passed
    from public.evaluate_store_launch_readiness(
      'c3000000-0000-4000-8000-000000000010',
      'c3000000-0000-4000-8000-000000000001'
    )
    where item_key = 'billing_access_active'
  ),
  true,
  'an active trial satisfies the launch billing gate'
);

select set_config(
  'request.jwt.claim.sub',
  'c3000000-0000-4000-8000-000000000003',
  true
);
select lives_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"monthly"}'
  )$$,
  'a foreign seller can only issue a trial for their own store'
);
select is(
  (
    select count(*)
    from public.seller_billing_status
    where store_id = 'c3000000-0000-4000-8000-000000000010'
  ),
  1::bigint,
  'the foreign owner call does not create or replace the victim billing row'
);

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, current_period_start, current_period_end,
  storefront_access_until, billing_state_authority, stripe_customer_id,
  stripe_subscription_id
)
values (
  'c3000000-0000-4000-8000-000000000050',
  'full_flock', 'monthly', 'full_flock', 'monthly', 'active',
  statement_timestamp(), statement_timestamp() + interval '30 days',
  statement_timestamp() + interval '30 days', 'legacy_stripe',
  'cus_entitlement_test', 'sub_entitlement_test'
);

select set_config(
  'request.jwt.claim.sub',
  'c3000000-0000-4000-8000-000000000005',
  true
);
select throws_ok(
  $$select public.seller_save_onboarding_plan_access(
    '{"requested_plan_key":"small_flock","requested_billing_cadence":"yearly"}'
  )$$,
  'P0001',
  'Plan access is already established and cannot be replaced from onboarding.',
  'onboarding cannot overwrite Stripe-linked state'
);

-- Resolver state matrix.
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled
)
values
  (
    'c3000000-0000-4000-8000-000000000030',
    'c3000000-0000-4000-8000-000000000001',
    'Missing Billing', 'missing-billing-entitlement', 'live', 'hosted', true
  ),
  (
    'c3000000-0000-4000-8000-000000000031',
    'c3000000-0000-4000-8000-000000000001',
    'State Matrix', 'state-matrix-entitlement', 'live', 'hosted', true
  );

select is(
  public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000030'),
  false,
  'missing billing is inactive'
);

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  billing_state_authority
)
values (
  'c3000000-0000-4000-8000-000000000031',
  'full_flock', 'monthly', 'full_flock', 'monthly', 'trialing',
  statement_timestamp(), statement_timestamp() + interval '7 days',
  statement_timestamp(), statement_timestamp() + interval '7 days',
  statement_timestamp() + interval '7 days', 'trial'
);

select is(
  public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'),
  true,
  'a structurally valid future trial is active'
);

update public.seller_billing_status
set
  trial_started_at = statement_timestamp() - interval '7 days',
  trial_ends_at = statement_timestamp(),
  current_period_start = statement_timestamp() - interval '7 days',
  current_period_end = statement_timestamp(),
  storefront_access_until = statement_timestamp()
where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(
  public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'),
  false,
  'the exact cutoff boundary is inactive'
);

insert into public.billing_provider_price_catalog (
  stripe_price_id, stripe_livemode, stripe_account_id, plan_key,
  billing_cadence
)
values ('price_state_matrix', false, '', 'full_flock', 'monthly');

update public.seller_billing_status
set
  requested_plan_key = 'full_flock',
  requested_billing_cadence = 'monthly',
  plan_key = 'full_flock',
  billing_plan = 'monthly',
  subscription_status = 'active',
  current_period_start = statement_timestamp(),
  current_period_end = statement_timestamp() + interval '30 days',
  storefront_access_until = statement_timestamp() + interval '30 days',
  billing_state_authority = 'stripe',
  stripe_customer_id = 'cus_state_matrix',
  stripe_subscription_id = 'sub_state_matrix',
  stripe_price_id = 'price_state_matrix',
  stripe_livemode = false,
  stripe_account_id = '',
  last_provider_event_id = 'evt_state_matrix',
  last_provider_event_created_at = statement_timestamp();
select is(
  public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'),
  true,
  'valid trusted paid state is active'
);
update public.seller_billing_status
set cancel_at_period_end = true
where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(
  (
    select access_reason
    from public.resolve_store_entitlement(
      'c3000000-0000-4000-8000-000000000031'
    )
  ),
  'paid_canceling',
  'cancel-at-period-end remains active only through its paid cutoff'
);
update public.seller_billing_status
set cancel_at_period_end = false
where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(
  (
    select passed
    from public.evaluate_store_launch_readiness(
      'c3000000-0000-4000-8000-000000000031',
      'c3000000-0000-4000-8000-000000000001'
    )
    where item_key = 'billing_access_active'
  ),
  true,
  'valid paid state satisfies the launch billing gate'
);

update public.seller_billing_status
set stripe_subscription_id = null
where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(
  public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'),
  false,
  'active status without trusted linkage fails closed'
);

update public.seller_billing_status
set stripe_subscription_id = 'sub_state_matrix'
where store_id = 'c3000000-0000-4000-8000-000000000031';

update public.seller_billing_status
set subscription_status = 'past_due'
where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'), false, 'past due has no grace period');
update public.seller_billing_status set subscription_status = 'canceled' where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'), false, 'canceled is inactive');
update public.seller_billing_status set subscription_status = 'dormant' where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'), false, 'dormant is inactive');
update public.seller_billing_status set subscription_status = 'incomplete' where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'), false, 'incomplete is inactive');
update public.seller_billing_status set subscription_status = 'incomplete_expired' where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'), false, 'incomplete-expired is inactive');
update public.seller_billing_status set subscription_status = 'suspended' where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'), false, 'suspended is inactive');

update public.seller_billing_status
set
  plan_key = 'full_flock',
  billing_plan = 'comped',
  subscription_status = 'comped',
  storefront_access_until = statement_timestamp() + interval '10 days',
  billing_state_authority = 'admin_comp',
  stripe_customer_id = null,
  stripe_subscription_id = null,
  stripe_price_id = null,
  last_provider_event_id = null,
  last_provider_event_created_at = null,
  comp_granted_by_user_id = 'c3000000-0000-4000-8000-000000000004',
  comp_grant_reason = 'State matrix comp',
  comp_granted_at = statement_timestamp(),
  comp_access_until = statement_timestamp() + interval '10 days',
  comp_revoked_at = null;
select is(public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'), true, 'valid expiring admin comp is active');
select is(
  (
    select passed
    from public.evaluate_store_launch_readiness(
      'c3000000-0000-4000-8000-000000000031',
      'c3000000-0000-4000-8000-000000000001'
    )
    where item_key = 'billing_access_active'
  ),
  true,
  'valid admin comp satisfies the launch billing gate'
);

update public.stores
set admin_hold_reason = 'Test hold'
where id = 'c3000000-0000-4000-8000-000000000031';
select is(public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'), false, 'administrative hold overrides otherwise active access');
select is(
  (
    select passed
    from public.evaluate_store_launch_readiness(
      'c3000000-0000-4000-8000-000000000031',
      'c3000000-0000-4000-8000-000000000001'
    )
    where item_key = 'billing_access_active'
  ),
  false,
  'a held store fails the launch billing gate'
);
update public.stores set admin_hold_reason = null where id = 'c3000000-0000-4000-8000-000000000031';

update public.seller_billing_status
set
  storefront_access_until = statement_timestamp(),
  comp_access_until = statement_timestamp()
where store_id = 'c3000000-0000-4000-8000-000000000031';
select is(public.store_has_active_entitlement('c3000000-0000-4000-8000-000000000031'), false, 'an expired comp is inactive');

-- Direct helper/provider privileges are narrowed.
select is(
  has_function_privilege('authenticated', 'public.resolve_store_entitlement(uuid)', 'execute'),
  false,
  'authenticated cannot execute the internal resolver'
);
select is(
  has_function_privilege('authenticated', 'public.get_store_plan_key(uuid)', 'execute'),
  false,
  'authenticated cannot query arbitrary effective plans'
);
select is(
  has_function_privilege('authenticated', 'public.small_flock_active_live_bird_units(uuid,uuid,uuid)', 'execute'),
  false,
  'authenticated cannot query arbitrary-store active unit counts'
);
select is(
  has_table_privilege('authenticated', 'public.seller_billing_status', 'update'),
  false,
  'authenticated sellers and admins cannot directly mutate effective billing state'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.apply_verified_stripe_subscription_event(text,timestamptz,text,text,uuid,text,text,text,text,timestamptz,timestamptz,boolean,boolean,text)',
    'execute'
  ),
  false,
  'browser roles cannot call the provider-state writer'
);

-- Public views all carry direct entitlement filtering.
select is(
  (
    select count(*)
    from unnest(array[
      'public_storefronts',
      'public_listing_batches',
      'public_inventory_items',
      'public_storefront_breed_inventory',
      'public_discoverable_storefronts',
      'public_discoverable_inventory',
      'public_storefront_home',
      'public_storefront_item_detail',
      'public_storefront_pickup_options',
      'public_storefront_inventory',
      'public_storefront_equipment_inventory',
      'public_storefront_processed_poultry_inventory',
      'public_storefront_hatching_egg_inventory',
      'public_storefront_media_gallery',
      'public_storefront_processed_poultry_media_gallery'
    ]) as view_names(view_name)
    where position(
      'store_has_active_entitlement' in
      pg_get_viewdef(format('public.%I', view_names.view_name)::regclass, true)
    ) > 0
  ),
  15::bigint,
  'every direct public store/inventory/media/pickup view filters entitlement'
);
select ok(
  position(
    'public_discoverable_inventory' in
    pg_get_viewdef('public.public_breed_availability'::regclass, true)
  ) > 0,
  'aggregate breed discovery inherits entitlement filtering from its wrapped source'
);

select is(
  (
    select is_publicly_available
    from public.get_storefront_public_status('state-matrix-entitlement')
  ),
  false,
  'an expired store fails closed in the public status RPC'
);

select is(
  (
    select is_checkout_available
    from public.get_public_checkout_summary(
      'state-matrix-entitlement',
      '[]'::jsonb
    )
  ),
  false,
  'checkout summary is unavailable for inactive entitlement'
);

insert into public.customers (
  id, store_id, email, first_name, last_name
)
values (
  'c3000000-0000-4000-8000-000000000090',
  'c3000000-0000-4000-8000-000000000031',
  'inactive-order@example.test',
  'Inactive',
  'Buyer'
);
select throws_ok(
  $$insert into public.orders (
    id, store_id, customer_id, order_number, buyer_email_snapshot,
    buyer_first_name_snapshot, buyer_last_name_snapshot
  )
  values (
    'c3000000-0000-4000-8000-000000000091',
    'c3000000-0000-4000-8000-000000000031',
    'c3000000-0000-4000-8000-000000000090',
    'ENT-INACTIVE-1',
    'inactive-order@example.test',
    'Inactive',
    'Buyer'
  )$$,
  'P0001',
  'Active selling access is required.',
  'final order insertion rechecks entitlement transactionally'
);
select is(
  (
    select count(*)
    from public.orders
    where id = 'c3000000-0000-4000-8000-000000000091'
  ),
  0::bigint,
  'failed entitlement leaves no order row'
);

select is(
  (
    select passed
    from public.evaluate_store_launch_readiness(
      'c3000000-0000-4000-8000-000000000031',
      'c3000000-0000-4000-8000-000000000001'
    )
    where item_key = 'billing_access_active'
  ),
  false,
  'launch readiness delegates billing access to the resolver'
);

-- Future Stripe contract: trusted price mapping, idempotency, and ordering.
select set_config('request.jwt.claim.role', 'service_role', true);
update public.seller_billing_status
set
  requested_plan_key = 'small_flock',
  plan_key = 'small_flock'
where seller_billing_status.store_id = 'c3000000-0000-4000-8000-000000000020';
select is(
  public.get_store_plan_key('c3000000-0000-4000-8000-000000000020'),
  'small_flock',
  'the provider fixture starts from an active Coop trial before its plan change'
);
update public.stores
set store_status = 'live', storefront_enabled = true
where id = 'c3000000-0000-4000-8000-000000000020';

insert into public.billing_provider_price_catalog (
  stripe_price_id, stripe_livemode, stripe_account_id, plan_key,
  billing_cadence
)
values ('price_verified_market_monthly', false, '', 'full_flock', 'monthly');

select lives_ok(
  $$select public.apply_verified_stripe_subscription_event(
    'evt_verified_1',
    '2026-07-30 12:00:00+00'::timestamptz,
    'customer.subscription.updated',
    'sha256:verified-1',
    'c3000000-0000-4000-8000-000000000020',
    'cus_verified_foreign',
    'sub_verified_foreign',
    'price_verified_market_monthly',
    'active',
    statement_timestamp(),
    statement_timestamp() + interval '30 days',
    false,
    false,
    ''
  )$$,
  'a service-only verified provider event can apply trusted state'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.apply_verified_stripe_subscription_event(text,timestamptz,text,text,uuid,text,text,text,text,timestamptz,timestamptz,boolean,boolean,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.apply_verified_stripe_subscription_event(text,timestamptz,text,text,uuid,text,text,text,text,timestamptz,timestamptz,boolean,boolean,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.apply_verified_stripe_subscription_event(text,timestamptz,text,text,uuid,text,text,text,text,timestamptz,timestamptz,boolean,boolean,text)',
    'execute'
  ),
  'the corrected provider contract remains service-role-only'
);
select is(
  public.get_store_plan_key('c3000000-0000-4000-8000-000000000020'),
  'full_flock',
  'provider plan is derived from the trusted price catalog'
);
select is(
  (
    select concat_ws(
      ':',
      seller_billing_status.stripe_customer_id,
      seller_billing_status.stripe_subscription_id,
      seller_billing_status.billing_state_authority,
      seller_billing_status.subscription_status
    )
    from public.seller_billing_status
    where seller_billing_status.store_id = 'c3000000-0000-4000-8000-000000000020'
  ),
  'cus_verified_foreign:sub_verified_foreign:stripe:active',
  'the provider event updates the intended store billing snapshot'
);
select is(
  (
    select storefront_enabled
    from public.stores
    where id = 'c3000000-0000-4000-8000-000000000020'
  ),
  false,
  'reactivation or a plan change pauses the storefront for seller review'
);
select lives_ok(
  $$select public.apply_verified_stripe_subscription_event(
    'evt_verified_1',
    '2026-07-30 12:00:00+00'::timestamptz,
    'customer.subscription.updated',
    'sha256:verified-1',
    'c3000000-0000-4000-8000-000000000020',
    'cus_verified_foreign',
    'sub_verified_foreign',
    'price_verified_market_monthly',
    'active',
    statement_timestamp(),
    statement_timestamp() + interval '30 days',
    false,
    false,
    ''
  )$$,
  'an identical provider event retry is idempotent'
);
select is(
  (
    select count(*)
    from public.billing_provider_events
    where provider_event_id = 'evt_verified_1'
  ),
  1::bigint,
  'provider event deduplication stores one event'
);
select throws_ok(
  $$select public.apply_verified_stripe_subscription_event(
    'evt_verified_1',
    '2026-07-30 12:00:00+00'::timestamptz,
    'customer.subscription.updated',
    'sha256:verified-1-changed',
    'c3000000-0000-4000-8000-000000000020',
    'cus_verified_foreign',
    'sub_verified_foreign',
    'price_verified_market_monthly',
    'active',
    statement_timestamp(),
    statement_timestamp() + interval '30 days',
    false,
    false,
    ''
  )$$,
  'P0001',
  'Provider event id was reused with different content.',
  'an event id cannot be reused with changed content'
);
select is(
  (
    select applied
    from public.apply_verified_stripe_subscription_event(
      'evt_verified_stale',
      '2026-07-29 12:00:00+00'::timestamptz,
      'customer.subscription.updated',
      'sha256:verified-stale',
      'c3000000-0000-4000-8000-000000000020',
      'cus_verified_foreign',
      'sub_verified_foreign',
      'price_verified_market_monthly',
      'past_due',
      statement_timestamp() - interval '1 day',
      statement_timestamp() + interval '29 days',
      false,
      false,
      ''
    )
  ),
  false,
  'a stale provider event is recorded but cannot regress newer state'
);
select is(
  (
    select subscription_status
    from public.seller_billing_status
    where store_id = 'c3000000-0000-4000-8000-000000000020'
  ),
  'active',
  'stale provider state does not replace the newer subscription status'
);
select throws_ok(
  $$select public.apply_verified_stripe_subscription_event(
    'evt_verified_cross_store',
    '2026-07-30 13:00:00+00'::timestamptz,
    'customer.subscription.updated',
    'sha256:verified-cross-store',
    'c3000000-0000-4000-8000-000000000010',
    'cus_verified_foreign',
    'sub_verified_foreign',
    'price_verified_market_monthly',
    'active',
    statement_timestamp(),
    statement_timestamp() + interval '30 days',
    false,
    false,
    ''
  )$$,
  'P0001',
  'Provider customer or subscription is already bound to another store.',
  'provider customer and subscription identifiers cannot move to another store'
);
select throws_ok(
  $$select public.apply_verified_stripe_subscription_event(
    'evt_verified_wrong_account',
    '2026-07-30 13:00:00+00'::timestamptz,
    'customer.subscription.updated',
    'sha256:verified-wrong-account',
    'c3000000-0000-4000-8000-000000000010',
    'cus_verified_wrong_account',
    'sub_verified_wrong_account',
    'price_verified_market_monthly',
    'active',
    statement_timestamp(),
    statement_timestamp() + interval '30 days',
    false,
    false,
    'acct_other'
  )$$,
  'P0001',
  'Stripe price is not registered for this environment and account.',
  'provider price mappings are isolated by Stripe account'
);
select throws_ok(
  $$select public.apply_verified_stripe_subscription_event(
    'evt_verified_wrong_mode',
    '2026-07-30 13:00:00+00'::timestamptz,
    'customer.subscription.updated',
    'sha256:verified-wrong-mode',
    'c3000000-0000-4000-8000-000000000010',
    'cus_verified_wrong_mode',
    'sub_verified_wrong_mode',
    'price_verified_market_monthly',
    'active',
    statement_timestamp(),
    statement_timestamp() + interval '30 days',
    false,
    true,
    ''
  )$$,
  'P0001',
  'Stripe price is not registered for this environment and account.',
  'provider price mappings are isolated by live and test mode'
);
select is(
  (
    select count(*)
    from public.billing_entitlement_events
    where billing_entitlement_events.store_id = 'c3000000-0000-4000-8000-000000000020'
      and billing_entitlement_events.provider_event_id = 'evt_verified_1'
      and billing_entitlement_events.event_type = 'provider_state_applied'
  ),
  1::bigint,
  'the provider audit event records the intended store exactly once'
);

select * from finish();
rollback;
