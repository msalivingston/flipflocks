begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select has_table(
  'public', 'billing_subscription_plan_changes',
  'one plan-change table exists'
);
select ok(
  has_function_privilege('service_role',
    'public.begin_saas_subscription_plan_change(uuid,text,text,boolean,text,text)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.begin_saas_subscription_plan_change(uuid,text,text,boolean,text,text)',
    'execute'),
  'plan-change authorization is service-role only'
);
select ok(
  has_function_privilege('authenticated',
    'public.seller_get_saas_downgrade_inventory_preview()', 'execute'),
  'the owner-facing downgrade preview is exposed through its narrow RPC'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  'ab000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'plan-change@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);
insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'ab000000-0000-4000-9000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'Plan Change Store', 'plan-change-store', 'draft', 'hosted', false
);
insert into public.seller_onboarding_state (store_id, profile_complete, billing_complete)
values ('ab000000-0000-4000-9000-000000000001', true, true);

insert into public.billing_provider_price_catalog (
  stripe_price_id, stripe_product_id, stripe_livemode, stripe_account_id,
  plan_key, billing_cadence, is_active, unit_amount_cents, currency,
  recurring_interval, recurring_interval_count, tax_behavior,
  stripe_product_tax_code, stripe_price_type, billing_scheme,
  recurring_usage_type, stripe_price_active, stripe_product_active,
  stripe_price_created_at, stripe_product_created_at, verified_at,
  verification_api_version
) values
  ('price_PlanChangeCoop', 'prod_PlanChangeCoop', false,
   'acct_1CTOghL1R5g4hhXt', 'small_flock', 'monthly', true, 500, 'usd',
   'month', 1, 'exclusive', 'txcd_10103001', 'recurring', 'per_unit',
   'licensed', true, true, statement_timestamp() - interval '30 days',
   statement_timestamp() - interval '30 days',
   statement_timestamp() - interval '30 days', '2026-06-24.dahlia'),
  ('price_PlanChangeMarket', 'prod_PlanChangeMarket', false,
   'acct_1CTOghL1R5g4hhXt', 'full_flock', 'monthly', true, 2900, 'usd',
   'month', 1, 'exclusive', 'txcd_10103001', 'recurring', 'per_unit',
   'licensed', true, true, statement_timestamp() - interval '30 days',
   statement_timestamp() - interval '30 days',
   statement_timestamp() - interval '30 days', '2026-06-24.dahlia');

insert into public.billing_provider_events (
  stripe_livemode, stripe_account_id, provider_event_id,
  provider_event_created_at, store_id, event_type, payload_hash,
  applied, processing_status, processed_at, attempt_count,
  provider_object_type, provider_object_id, processing_environment_id
) values (
  false, 'acct_1CTOghL1R5g4hhXt', 'evt_PlanChangeEnrollment',
  statement_timestamp() - interval '60 days',
  'ab000000-0000-4000-9000-000000000001',
  'checkout.session.completed', repeat('a', 64), true, 'processed',
  statement_timestamp() - interval '60 days', 1,
  'checkout.session', 'cs_test_PlanChange', 'local'
);
insert into public.billing_customer_bindings (
  id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
  provider_created_at, bound_by_event_id
) values (
  'ab000000-0000-4000-a000-000000000001',
  'ab000000-0000-4000-9000-000000000001', 'cus_PlanChange', false,
  'acct_1CTOghL1R5g4hhXt', statement_timestamp() - interval '60 days',
  'evt_PlanChangeEnrollment'
);
insert into public.billing_provider_events (
  stripe_livemode, stripe_account_id, provider_event_id,
  provider_event_created_at, store_id, event_type, payload_hash,
  applied, processing_status, processed_at, attempt_count,
  provider_object_type, provider_object_id, processing_environment_id
) values (
  false, 'acct_1CTOghL1R5g4hhXt', 'evt_PlanChangeBoundaryPaid',
  '2026-09-01 00:00:10+00',
  'ab000000-0000-4000-9000-000000000001',
  'invoice.payment_succeeded', repeat('b', 64), true, 'processed',
  '2026-09-01 00:00:10+00', 1,
  'invoice', 'in_PlanChangeCoopBoundary', 'local'
);
insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, stripe_subscription_id,
  initial_stripe_price_id, stripe_livemode, stripe_account_id,
  provider_status, cancel_at_period_end, is_current,
  provider_created_at, bound_by_event_id
) values (
  'ab000000-0000-4000-b000-000000000001',
  'ab000000-0000-4000-9000-000000000001',
  'ab000000-0000-4000-a000-000000000001', 'sub_PlanChange',
  'price_PlanChangeMarket', false, 'acct_1CTOghL1R5g4hhXt',
  'active', false, true, statement_timestamp() - interval '60 days',
  'evt_PlanChangeEnrollment'
);
insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence,
  plan_key, billing_plan, subscription_status, billing_state_authority,
  stripe_customer_id, stripe_subscription_id, stripe_price_id,
  stripe_livemode, stripe_account_id, current_period_start,
  current_period_end, paid_through_at, storefront_access_until,
  current_subscription_enrollment_id, last_paid_stripe_invoice_id,
  latest_stripe_invoice_id, latest_invoice_status,
  last_provider_event_id, last_provider_event_created_at,
  last_provider_event_applied_at
) values (
  'ab000000-0000-4000-9000-000000000001', 'full_flock', 'monthly',
  'full_flock', 'monthly', 'active', 'stripe', 'cus_PlanChange',
  'sub_PlanChange', 'price_PlanChangeMarket', false,
  'acct_1CTOghL1R5g4hhXt', '2026-08-01 00:00:00+00',
  '2026-09-01 00:00:00+00', '2026-09-01 00:00:00+00',
  '2026-09-01 00:00:00+00',
  'ab000000-0000-4000-b000-000000000001', 'in_PreviousMarket',
  'in_PreviousMarket', 'paid', 'evt_PlanChangeEnrollment',
  statement_timestamp() - interval '60 days', statement_timestamp()
);
insert into public.saas_billing_portal_store_cohort (store_id, is_active)
values ('ab000000-0000-4000-9000-000000000001', true);

insert into public.billing_subscription_invoices (
  store_id, subscription_enrollment_id, customer_binding_id,
  stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
  stripe_price_id, stripe_livemode, stripe_account_id, billing_reason,
  collection_method, invoice_status, currency, amount_due_cents,
  amount_paid_cents, amount_remaining_cents, base_line_amount_cents,
  service_period_start, service_period_end, paid_at, paid_through_applied_at,
  last_provider_event_id, last_provider_event_created_at
) values (
  'ab000000-0000-4000-9000-000000000001',
  'ab000000-0000-4000-b000-000000000001',
  'ab000000-0000-4000-a000-000000000001', 'cus_PlanChange',
  'sub_PlanChange', 'in_PreviousMarket', 'price_PlanChangeMarket', false,
  'acct_1CTOghL1R5g4hhXt', 'subscription_cycle', 'charge_automatically',
  'paid', 'usd', 2900, 2900, 0, 2900,
  '2026-08-01 00:00:00+00', '2026-09-01 00:00:00+00',
  '2026-08-01 00:00:10+00', '2026-08-01 00:00:11+00',
  'evt_PlanChangeEnrollment',
  statement_timestamp() - interval '30 days'
);

insert into public.seller_breed_profiles (
  id, store_id, species_id, custom_breed_name,
  normalized_custom_breed_name, display_name, visibility_status,
  moderation_status
)
select 'ab000000-0000-4000-c000-000000000001',
  'ab000000-0000-4000-9000-000000000001', species.id,
  'Plan Change Chicken', 'plan change chicken', 'Plan Change Chicken',
  'active', 'normal'
from public.species where species.slug = 'chicken';
insert into public.listing_batches (
  id, store_id, species_id, origin_date, available_date, base_price,
  batch_type, visibility_status, moderation_status, seller_notes
)
select batches.id, 'ab000000-0000-4000-9000-000000000001', species.id,
  current_date - 30, current_date, 25, 'live_animals',
  batches.visibility_status, 'normal', batches.note
from public.species
cross join (values
  ('ab000000-0000-4000-d000-000000000001'::uuid, 'active'::text, 'preserve active listing'::text),
  ('ab000000-0000-4000-d000-000000000002'::uuid, 'hidden'::text, 'preserve hidden listing'::text)
) as batches(id, visibility_status, note)
where species.slug = 'chicken';
insert into public.listing_batch_breeds (
  id, store_id, listing_batch_id, seller_breed_profile_id,
  visibility_status, moderation_status
) values
  ('ab000000-0000-4000-e000-000000000001',
   'ab000000-0000-4000-9000-000000000001',
   'ab000000-0000-4000-d000-000000000001',
   'ab000000-0000-4000-c000-000000000001', 'active', 'normal'),
  ('ab000000-0000-4000-e000-000000000002',
   'ab000000-0000-4000-9000-000000000001',
   'ab000000-0000-4000-d000-000000000002',
   'ab000000-0000-4000-c000-000000000001', 'active', 'normal');
insert into public.inventory_items (
  id, store_id, listing_batch_id, listing_batch_breed_id,
  inventory_type, quantity_available, price_override, visibility_status,
  seller_notes
) values
  ('ab000000-0000-4000-f000-000000000001',
   'ab000000-0000-4000-9000-000000000001',
   'ab000000-0000-4000-d000-000000000001',
   'ab000000-0000-4000-e000-000000000001', 'female', 7, 30,
   'active', 'preserve active item'),
  ('ab000000-0000-4000-f000-000000000002',
   'ab000000-0000-4000-9000-000000000001',
   'ab000000-0000-4000-d000-000000000002',
   'ab000000-0000-4000-e000-000000000002', 'trio', 2, 70,
   'hidden', 'preserve hidden item');

insert into public.billing_subscription_plan_changes (
  id, store_id, subscription_enrollment_id, requested_by_user_id,
  source_stripe_price_id, target_stripe_price_id, change_timing,
  status, stripe_schedule_id, stripe_invoice_id, effective_at
) values (
  'ab000000-0000-4001-a000-000000000001',
  'ab000000-0000-4000-9000-000000000001',
  'ab000000-0000-4000-b000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'price_PlanChangeMarket', 'price_PlanChangeCoop', 'period_end',
  'scheduled', 'sub_sched_PlanChange', 'in_PlanChangeCoopBoundary',
  '2026-09-01 00:00:00+00'
);
insert into public.billing_subscription_invoices (
  store_id, subscription_enrollment_id, customer_binding_id,
  stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
  stripe_price_id, stripe_livemode, stripe_account_id, billing_reason,
  collection_method, invoice_status, currency, amount_due_cents,
  amount_paid_cents, amount_remaining_cents, base_line_amount_cents,
  service_period_start, service_period_end, paid_at,
  last_provider_event_id, last_provider_event_created_at
) values (
  'ab000000-0000-4000-9000-000000000001',
  'ab000000-0000-4000-b000-000000000001',
  'ab000000-0000-4000-a000-000000000001', 'cus_PlanChange',
  'sub_PlanChange', 'in_PlanChangeCoopBoundary', 'price_PlanChangeCoop',
  false, 'acct_1CTOghL1R5g4hhXt', 'subscription_cycle',
  'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
  '2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00',
  '2026-09-01 00:00:10+00', 'evt_PlanChangeBoundaryPaid',
  '2026-09-01 00:00:10+00'
);

select is(
  (select sum(quantity_available)::integer from public.inventory_items
   where store_id = 'ab000000-0000-4000-9000-000000000001'),
  9,
  'scheduling the downgrade does not reset inventory'
);
select throws_ok(
  $$select public.complete_verified_saas_plan_change(
    'ab000000-0000-4001-a000-000000000001', 'evt_PlanChangeWrongBoundary',
    '2026-09-01 00:00:10+00', '2026-09-01 00:00:00+00',
    '2026-10-02 00:00:00+00')$$,
  'SAAS_PLAN_CHANGE_BOUNDARY_INVALID',
  'invalid boundary evidence fails closed'
);
select is(
  (select sum(quantity_available)::integer from public.inventory_items
   where store_id = 'ab000000-0000-4000-9000-000000000001'),
  9,
  'failed completion leaves every inventory quantity unchanged'
);
select is(
  public.complete_verified_saas_plan_change(
    'ab000000-0000-4001-a000-000000000001', 'evt_PlanChangeBoundaryPaid',
    '2026-09-01 00:00:10+00', '2026-09-01 00:00:00+00',
    '2026-10-01 00:00:00+00'),
  'completed',
  'verified paid Coop boundary completes the downgrade'
);
select is(
  (select plan_key from public.seller_billing_status
   where store_id = 'ab000000-0000-4000-9000-000000000001'),
  'small_flock',
  'Coop becomes the effective plan'
);
select is(
  (select sum(quantity_available)::integer from public.inventory_items
   where store_id = 'ab000000-0000-4000-9000-000000000001'),
  0,
  'all active and hidden live-poultry quantities reset to zero'
);
select is(
  (select count(*)::integer from public.inventory_activity_events
   where store_id = 'ab000000-0000-4000-9000-000000000001'
     and metadata ->> 'reason' = 'market_to_coop_effective'),
  2,
  'each changed inventory row has one existing activity event'
);
select results_eq(
  $$select from_quantity_available, to_quantity_available
    from public.inventory_activity_events
    where store_id = 'ab000000-0000-4000-9000-000000000001'
      and metadata ->> 'reason' = 'market_to_coop_effective'
    order by from_quantity_available$$,
  $$values (2, 0), (7, 0)$$,
  'activity history records exact before-and-after quantities'
);
select is(
  (select count(*)::integer from public.inventory_items
   where store_id = 'ab000000-0000-4000-9000-000000000001'
     and price_override in (30, 70) and seller_notes like 'preserve%'),
  2,
  'prices, notes, and listing records remain intact'
);
select is(
  public.complete_verified_saas_plan_change(
    'ab000000-0000-4001-a000-000000000001', 'evt_PlanChangeDuplicate',
    '2026-09-01 00:00:11+00', '2026-09-01 00:00:00+00',
    '2026-10-01 00:00:00+00'),
  'already_completed',
  'duplicate completion is idempotent'
);
select is(
  (select count(*)::integer from public.inventory_activity_events
   where store_id = 'ab000000-0000-4000-9000-000000000001'
     and metadata ->> 'reason' = 'market_to_coop_effective'),
  2,
  'duplicate completion does not reset or log inventory twice'
);
select lives_ok(
  $$update public.inventory_items set quantity_available = 5
    where id = 'ab000000-0000-4000-f000-000000000001'$$,
  'the existing Coop five-bird limit permits five active birds afterward'
);
select throws_ok(
  $$insert into public.inventory_items (
      id, store_id, listing_batch_id, listing_batch_breed_id,
      inventory_type, quantity_available, visibility_status
    ) values (
      'ab000000-0000-4000-f000-000000000003',
      'ab000000-0000-4000-9000-000000000001',
      'ab000000-0000-4000-d000-000000000001',
      'ab000000-0000-4000-e000-000000000001', 'male', 1, 'active'
    )$$,
  'P0001',
  'Coop includes up to 5 active birds for sale at one time. Upgrade to Market for unlimited live bird quantities.',
  'the existing Coop five-bird limit remains enforced afterward'
);

insert into public.billing_provider_events (
  stripe_livemode, stripe_account_id, provider_event_id,
  provider_event_created_at, store_id, event_type, payload_hash,
  applied, processing_status, processed_at, attempt_count,
  provider_object_type, provider_object_id, processing_environment_id
) values (
  false, 'acct_1CTOghL1R5g4hhXt', 'evt_PlanChangeImmediatePaid',
  '2026-09-10 00:00:10+00',
  'ab000000-0000-4000-9000-000000000001',
  'invoice.payment_succeeded', repeat('c', 64), true, 'processed',
  '2026-09-10 00:00:10+00', 1,
  'invoice', 'in_PlanChangeImmediate', 'local'
);
insert into public.billing_subscription_plan_changes (
  id, store_id, subscription_enrollment_id, requested_by_user_id,
  source_stripe_price_id, target_stripe_price_id, change_timing,
  status, stripe_invoice_id
) values (
  'ab000000-0000-4001-a000-000000000002',
  'ab000000-0000-4000-9000-000000000001',
  'ab000000-0000-4000-b000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'price_PlanChangeCoop', 'price_PlanChangeMarket', 'immediate',
  'pending_payment', 'in_PlanChangeImmediate'
);
insert into public.billing_subscription_invoices (
  store_id, subscription_enrollment_id, customer_binding_id,
  stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
  stripe_price_id, stripe_livemode, stripe_account_id, billing_reason,
  collection_method, invoice_status, currency, amount_due_cents,
  amount_paid_cents, amount_remaining_cents, base_line_amount_cents,
  service_period_start, service_period_end, paid_at,
  last_provider_event_id, last_provider_event_created_at
) values (
  'ab000000-0000-4000-9000-000000000001',
  'ab000000-0000-4000-b000-000000000001',
  'ab000000-0000-4000-a000-000000000001', 'cus_PlanChange',
  'sub_PlanChange', 'in_PlanChangeImmediate', 'price_PlanChangeMarket',
  false, 'acct_1CTOghL1R5g4hhXt', 'subscription_update',
  'charge_automatically', 'open', 'usd', 1200, 0, 1200, 1200,
  '2026-09-10 00:00:00+00', '2026-10-01 00:00:00+00',
  null, 'evt_PlanChangeImmediatePaid',
  '2026-09-10 00:00:10+00'
);
select throws_ok(
  $$select public.complete_verified_saas_plan_change(
    'ab000000-0000-4001-a000-000000000002',
    'evt_PlanChangeImmediatePaid', '2026-09-10 00:00:10+00',
    '2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00')$$,
  'SAAS_PLAN_CHANGE_COMPLETION_EVIDENCE_INVALID',
  'an unpaid immediate upgrade cannot complete'
);
select is(
  (select plan_key from public.seller_billing_status
   where store_id = 'ab000000-0000-4000-9000-000000000001'),
  'small_flock',
  'failed or action-required payment leaves Coop effective'
);
update public.billing_subscription_invoices
set invoice_status = 'paid', amount_paid_cents = 1200,
    amount_remaining_cents = 0, paid_at = '2026-09-10 00:00:10+00'
where stripe_invoice_id = 'in_PlanChangeImmediate';
select is(
  public.complete_verified_saas_plan_change(
    'ab000000-0000-4001-a000-000000000002',
    'evt_PlanChangeImmediatePaid', '2026-09-10 00:00:10+00',
    '2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'),
  'completed',
  'a paid immediate Coop-to-Market change completes'
);
select results_eq(
  $$select plan_key, stripe_price_id, paid_through_at
    from public.seller_billing_status
    where store_id = 'ab000000-0000-4000-9000-000000000001'$$,
  $$values ('full_flock'::text, 'price_PlanChangeMarket'::text,
    '2026-10-01 00:00:00+00'::timestamptz)$$,
  'immediate completion changes the entitlement without extending paid-through'
);
select is(
  (select initial_stripe_price_id from public.billing_subscription_enrollments
   where id = 'ab000000-0000-4000-b000-000000000001'),
  'price_PlanChangeMarket',
  'the existing enrollment advances only its verified Price binding'
);
select is(
  (select has_active_access from public.resolve_store_entitlement(
    'ab000000-0000-4000-9000-000000000001')),
  true,
  'the entitlement resolver remains active after an immediate paid upgrade'
);
select is(
  (select sum(quantity_available)::integer from public.inventory_items
   where store_id = 'ab000000-0000-4000-9000-000000000001'),
  5,
  'an immediate upgrade never resets inventory'
);

insert into public.billing_subscription_plan_changes (
  id, store_id, subscription_enrollment_id, requested_by_user_id,
  source_stripe_price_id, target_stripe_price_id, change_timing,
  status, stripe_schedule_id, stripe_invoice_id, effective_at
) values (
  'ab000000-0000-4001-a000-000000000003',
  'ab000000-0000-4000-9000-000000000001',
  'ab000000-0000-4000-b000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'price_PlanChangeMarket', 'price_PlanChangeCoop', 'period_end',
  'scheduled', 'sub_sched_PlanChangeFailure', 'in_PlanChangeFailure',
  '2026-10-01 00:00:00+00'
);
create temporary table plan_change_failure_claim as
select * from public.claim_saas_billing_provider_event(
  'evt_PlanChangeFailure', 'invoice.payment_failed',
  '2026-09-20 00:00:00+00', repeat('d', 64),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  'invoice', 'in_PlanChangeFailure'
);
update public.billing_provider_events
set deferred_at = statement_timestamp(),
    deferred_reason = 'awaiting_immutable_enrollment_binding'
where provider_event_id = 'evt_PlanChangeFailure'
  and stripe_account_id = 'acct_1CTOghL1R5g4hhXt'
  and not stripe_livemode;
select is(
  public.bind_verified_saas_payment_failed_plan_change_event(
    'evt_PlanChangeFailure',
    (select processing_lease_token from plan_change_failure_claim),
    'acct_1CTOghL1R5g4hhXt', false, 'sub_PlanChange',
    'in_PlanChangeFailure', 'price_PlanChangeCoop'
  ),
  'ab000000-0000-4000-9000-000000000001'::uuid,
  'verified plan-change failure binds through the narrow service-only path'
);
create temporary table plan_change_failure_result as
select * from public.apply_verified_saas_plan_change_invoice_event(
  'payment_failed', 'evt_PlanChangeFailure', repeat('d', 64),
  (select processing_lease_token from plan_change_failure_claim),
  'acct_1CTOghL1R5g4hhXt', false, 'local',
  '2026-09-20 00:00:00+00', 'in_PlanChangeFailure', false,
  'cus_PlanChange', 'sub_PlanChange', 'price_PlanChangeCoop',
  'prod_PlanChangeCoop', 'price_PlanChangeMarket', 1,
  '2026-09-10 00:00:00+00', '2026-10-01 00:00:00+00',
  'subscription_cycle', 'charge_automatically', 'open', 'usd',
  500, 0, 500, 500,
  '2026-10-01 00:00:00+00', '2026-11-01 00:00:00+00',
  '2026-09-20 00:00:00+00', '2026-09-21 00:00:00+00',
  1, false, false, true, true, 500, 'usd', 'month', 1,
  'recurring', 'per_unit', 'licensed', 'exclusive', 'txcd_10103001'
);
select is(
  (select application_state from plan_change_failure_result),
  'nonpayment_recorded',
  'verified plan-change invoice failure is applied through its existing path'
);
select is(
  (select count(*)::integer
   from public.email_notifications as notification
   join public.billing_subscription_invoices as invoice
     on invoice.id = notification.subscription_invoice_id
   where invoice.stripe_invoice_id = 'in_PlanChangeFailure'
     and notification.notification_type =
       'seller_subscription_payment_failed'),
  1,
  'verified plan-change invoice failure enqueues the same payment email type'
);
select is(
  (select public_plan_name
   from public.get_seller_subscription_payment_failed_context(
     (select id from public.billing_subscription_invoices
      where stripe_invoice_id = 'in_PlanChangeFailure'))),
  'Coop',
  'plan-change payment email resolves the failed invoice target plan'
);

select * from finish();
rollback;
