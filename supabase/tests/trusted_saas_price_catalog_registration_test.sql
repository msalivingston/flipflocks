begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select has_table('public', 'billing_provider_price_catalog_events', 'catalog audit table exists');
select is(
  (
    with required(name) as (values
      ('tax_behavior'), ('stripe_product_tax_code'), ('stripe_price_type'),
      ('billing_scheme'), ('recurring_usage_type'), ('stripe_price_active'),
      ('stripe_product_active'), ('stripe_price_created_at'),
      ('stripe_product_created_at'), ('verified_at'),
      ('verification_api_version'), ('deactivated_at'),
      ('deactivated_reason'), ('is_verified')
    )
    select count(*)::integer from required
    left join information_schema.columns as columns
      on columns.table_schema = 'public'
     and columns.table_name = 'billing_provider_price_catalog'
     and columns.column_name = required.name
    where columns.column_name is null
  ),
  0,
  'all trusted catalog verification columns exist'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.billing_provider_price_catalog_events'::regclass),
  'catalog audit table has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.billing_provider_price_catalog_events', 'select')
  and not has_table_privilege('anon', 'public.billing_provider_price_catalog_events', 'insert'),
  'anon cannot read or write catalog audit history'
);
select ok(
  not has_table_privilege('authenticated', 'public.billing_provider_price_catalog', 'insert')
  and not has_table_privilege('authenticated', 'public.billing_provider_price_catalog', 'update'),
  'authenticated cannot write the catalog directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.register_verified_saas_price(text,text,text,boolean,text,text,bigint,text,text,integer,text,text,text,text,text,boolean,boolean,timestamptz,timestamptz,text)', 'execute'),
  'authenticated cannot execute trusted registration'
);
select ok(
  has_function_privilege('service_role', 'public.register_verified_saas_price(text,text,text,boolean,text,text,bigint,text,text,integer,text,text,text,text,text,boolean,boolean,timestamptz,timestamptz,text)', 'execute'),
  'service role can execute trusted registration'
);
select ok(
  not has_function_privilege('authenticated', 'public.deactivate_verified_saas_price(text,text,boolean,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.resolve_verified_saas_price(text,text,text,boolean)', 'execute'),
  'browser roles cannot execute catalog mutation or trusted lookup helpers'
);
select is(
  (select proconfig::text from pg_proc where oid = 'public.register_verified_saas_price(text,text,text,boolean,text,text,bigint,text,text,integer,text,text,text,text,text,boolean,boolean,timestamptz,timestamptz,text)'::regprocedure),
  '{"search_path=pg_catalog, public"}',
  'registration has a fixed safe search path'
);
select is(
  (select proconfig::text from pg_proc where oid = 'public.deactivate_verified_saas_price(text,text,boolean,text)'::regprocedure),
  '{"search_path=pg_catalog, public"}',
  'deactivation has a fixed safe search path'
);

create function pg_temp.batch4_register(p jsonb)
returns text
language sql
as $function$
  select registration_status
  from public.register_verified_saas_price(
    coalesce(p->>'price', 'price_Batch4Default'),
    coalesce(p->>'product', 'prod_Batch4Coop'),
    coalesce(p->>'account', 'acct_Batch4PlatformA'),
    coalesce((p->>'livemode')::boolean, false),
    coalesce(p->>'plan', 'small_flock'),
    coalesce(p->>'cadence', 'monthly'),
    coalesce((p->>'amount')::bigint, 500),
    coalesce(p->>'currency', 'usd'),
    coalesce(p->>'interval', 'month'),
    coalesce((p->>'interval_count')::integer, 1),
    coalesce(p->>'price_type', 'recurring'),
    coalesce(p->>'billing_scheme', 'per_unit'),
    coalesce(p->>'usage_type', 'licensed'),
    coalesce(p->>'tax_behavior', 'exclusive'),
    coalesce(p->>'tax_code', 'txcd_10103001'),
    coalesce((p->>'price_active')::boolean, true),
    coalesce((p->>'product_active')::boolean, true),
    coalesce((p->>'price_created')::timestamptz, timestamptz '2026-01-01 00:00:00+00'),
    coalesce((p->>'product_created')::timestamptz, timestamptz '2026-01-01 00:00:00+00'),
    coalesce(p->>'api_version', '2026-06-24.dahlia')
  );
$function$;

select throws_ok($$select pg_temp.batch4_register('{"account":""}')$$, '22023', 'SAAS_CATALOG_ACCOUNT_ID_INVALID', 'missing account is rejected');
select throws_ok($$select pg_temp.batch4_register('{"account":"platform"}')$$, '22023', 'SAAS_CATALOG_ACCOUNT_ID_INVALID', 'malformed account is rejected');
select throws_ok($$select pg_temp.batch4_register('{"product":""}')$$, '22023', 'SAAS_CATALOG_PRODUCT_ID_INVALID', 'missing Product is rejected');
select throws_ok($$select pg_temp.batch4_register('{"price":""}')$$, '22023', 'SAAS_CATALOG_PRICE_ID_INVALID', 'missing Price is rejected');
select throws_ok($$select pg_temp.batch4_register('{"plan":"unknown"}')$$, '22023', 'SAAS_CATALOG_PLAN_INVALID', 'unknown plan is rejected');
select throws_ok($$select pg_temp.batch4_register('{"cadence":"weekly"}')$$, '22023', 'SAAS_CATALOG_CADENCE_INVALID', 'unknown cadence is rejected');
select throws_ok($$select pg_temp.batch4_register('{"amount":501}')$$, '22023', 'SAAS_CATALOG_AMOUNT_MISMATCH', 'incorrect Coop monthly amount is rejected');
select throws_ok($$select pg_temp.batch4_register('{"cadence":"yearly","amount":5001,"interval":"year"}')$$, '22023', 'SAAS_CATALOG_AMOUNT_MISMATCH', 'incorrect Coop annual amount is rejected');
select throws_ok($$select pg_temp.batch4_register('{"plan":"full_flock","amount":2901,"product":"prod_Batch4Market"}')$$, '22023', 'SAAS_CATALOG_AMOUNT_MISMATCH', 'incorrect Market monthly amount is rejected');
select throws_ok($$select pg_temp.batch4_register('{"plan":"full_flock","cadence":"yearly","amount":27001,"interval":"year","product":"prod_Batch4Market"}')$$, '22023', 'SAAS_CATALOG_AMOUNT_MISMATCH', 'incorrect Market annual amount is rejected');
select throws_ok($$select pg_temp.batch4_register('{"currency":"eur"}')$$, '22023', 'SAAS_CATALOG_CURRENCY_MISMATCH', 'non-USD currency is rejected');
select throws_ok($$select pg_temp.batch4_register('{"currency":"USD"}')$$, '22023', 'SAAS_CATALOG_CURRENCY_MISMATCH', 'uppercase currency is rejected');
select throws_ok($$select pg_temp.batch4_register('{"price_type":"one_time"}')$$, '22023', 'SAAS_CATALOG_RECURRING_MODEL_MISMATCH', 'one-time Price is rejected');
select throws_ok($$select pg_temp.batch4_register('{"usage_type":"metered"}')$$, '22023', 'SAAS_CATALOG_RECURRING_MODEL_MISMATCH', 'metered Price is rejected');
select throws_ok($$select pg_temp.batch4_register('{"billing_scheme":"tiered"}')$$, '22023', 'SAAS_CATALOG_RECURRING_MODEL_MISMATCH', 'tiered Price is rejected');
select throws_ok($$select pg_temp.batch4_register('{"interval":"year"}')$$, '22023', 'SAAS_CATALOG_INTERVAL_MISMATCH', 'incorrect interval is rejected');
select throws_ok($$select pg_temp.batch4_register('{"interval_count":2}')$$, '22023', 'SAAS_CATALOG_INTERVAL_MISMATCH', 'interval count other than one is rejected');
select throws_ok($$select pg_temp.batch4_register('{"tax_behavior":"inclusive"}')$$, '22023', 'SAAS_CATALOG_TAX_MISMATCH', 'inclusive tax behavior is rejected');
select throws_ok($$select pg_temp.batch4_register('{"tax_behavior":"unspecified"}')$$, '22023', 'SAAS_CATALOG_TAX_MISMATCH', 'unspecified tax behavior is rejected');
select throws_ok($$select pg_temp.batch4_register('{"tax_code":"txcd_wrong"}')$$, '22023', 'SAAS_CATALOG_TAX_MISMATCH', 'wrong Product tax code is rejected');
select throws_ok($$select pg_temp.batch4_register('{"price_active":false}')$$, '22023', 'SAAS_CATALOG_PROVIDER_OBJECT_INACTIVE', 'inactive Price is rejected');
select throws_ok($$select pg_temp.batch4_register('{"product_active":false}')$$, '22023', 'SAAS_CATALOG_PROVIDER_OBJECT_INACTIVE', 'inactive Product is rejected');

select is(
  pg_temp.batch4_register('{"price":"price_Batch4CoopMonthly"}'),
  'registered',
  'service role registers an exact verified Coop monthly Price'
);
select is(
  pg_temp.batch4_register('{"price":"price_Batch4CoopMonthly"}'),
  'already_registered',
  'exact replay is idempotent'
);
select throws_ok(
  $$select pg_temp.batch4_register('{"price":"price_Batch4CoopMonthly","plan":"full_flock","product":"prod_Batch4Market","amount":2900}')$$,
  '23505', 'SAAS_CATALOG_PRICE_MAPPING_CONFLICT',
  'the same Price cannot map to a second plan'
);
select throws_ok(
  $$select pg_temp.batch4_register('{"price":"price_Batch4CoopMonthly","cadence":"yearly","amount":5000,"interval":"year"}')$$,
  '23505', 'SAAS_CATALOG_PRICE_MAPPING_CONFLICT',
  'the same Price cannot map to a second cadence'
);
select throws_ok(
  $$select pg_temp.batch4_register('{"price":"price_Batch4SecondCoopMonthly"}')$$,
  '23505', null,
  'one plan/cadence cannot have two active verified Prices in one context'
);
select is(
  pg_temp.batch4_register('{"price":"price_Batch4CoopYearly","cadence":"yearly","amount":5000,"interval":"year"}'),
  'registered',
  'Coop monthly and yearly Prices may share the Coop Product'
);
-- Establish Product-conflict checks in isolated account contexts.
select is(
  pg_temp.batch4_register('{"price":"price_Batch4ConflictMonthly","account":"acct_Batch4Conflict","product":"prod_Batch4ConflictA"}'),
  'registered',
  'first Coop Product in an isolated account is accepted'
);
select throws_ok(
  $$select pg_temp.batch4_register('{"price":"price_Batch4ConflictYearly","account":"acct_Batch4Conflict","product":"prod_Batch4ConflictB","cadence":"yearly","amount":5000,"interval":"year"}')$$,
  '23514', 'SAAS_CATALOG_PRODUCT_CONFLICT',
  'Coop monthly and annual cannot use different active Products'
);
select is(
  pg_temp.batch4_register('{"price":"price_Batch4MarketMonthly","plan":"full_flock","product":"prod_Batch4Market","amount":2900}'),
  'registered',
  'Coop and Market may use different Products'
);
select is(
  pg_temp.batch4_register('{"price":"price_Batch4MarketYearly","plan":"full_flock","product":"prod_Batch4Market","cadence":"yearly","amount":27000,"interval":"year"}'),
  'registered',
  'Market monthly and annual may share the Market Product'
);
select is(
  pg_temp.batch4_register('{"price":"price_Batch4Live","account":"acct_Batch4PlatformA","livemode":true}'),
  'registered',
  'live mode remains a separate catalog context'
);
select is(
  pg_temp.batch4_register('{"price":"price_Batch4OtherAccount","account":"acct_Batch4Other"}'),
  'registered',
  'different platform accounts remain separate'
);
select is(
  pg_temp.batch4_register('{"price":"price_Batch4MarketConflictMonthly","account":"acct_Batch4MarketConflict","plan":"full_flock","product":"prod_Batch4MarketConflictA","amount":2900}'),
  'registered',
  'first Market Product in an isolated account is accepted'
);
select throws_ok(
  $$select pg_temp.batch4_register('{"price":"price_Batch4MarketConflictYearly","account":"acct_Batch4MarketConflict","plan":"full_flock","product":"prod_Batch4MarketConflictB","cadence":"yearly","amount":27000,"interval":"year"}')$$,
  '23514', 'SAAS_CATALOG_PRODUCT_CONFLICT',
  'Market monthly and annual cannot use different active Products'
);

select is(
  (select count(*)::integer from public.billing_provider_price_catalog_events where event_type = 'price_registered'),
  8,
  'successful registrations write typed audit events'
);
select is(
  (select count(*)::integer from public.billing_provider_price_catalog_events where event_type = 'price_registration_replayed'),
  1,
  'exact replay records the approved replay audit event'
);
select is(
  (select stripe_price_id from public.resolve_verified_saas_price('small_flock', 'monthly', 'acct_Batch4PlatformA', false)),
  'price_Batch4CoopMonthly',
  'trusted resolution returns exactly one active verified Price'
);
select throws_ok(
  $$select * from public.resolve_verified_saas_price('small_flock', 'monthly', 'acct_Batch4Missing', false)$$,
  'P0002', 'SAAS_CATALOG_TRUSTED_PRICE_UNAVAILABLE',
  'missing trusted Price fails closed'
);

insert into public.billing_provider_price_catalog (
  stripe_price_id, stripe_livemode, stripe_account_id, plan_key, billing_cadence
) values (
  'price_Batch4Incomplete', false, 'acct_Batch4Incomplete', 'small_flock', 'monthly'
);
select lives_ok(
  $$
    insert into public.billing_provider_price_catalog (
      stripe_price_id, stripe_livemode, stripe_account_id, plan_key, billing_cadence
    ) values (
      'legacy_price_with_separators', false, '', 'small_flock', 'monthly'
    )
  $$,
  'unverified legacy rows retain their disabled-phase structural compatibility'
);
select throws_ok(
  $$select * from public.resolve_verified_saas_price('small_flock', 'monthly', 'acct_Batch4Incomplete', false)$$,
  'P0002', 'SAAS_CATALOG_TRUSTED_PRICE_UNAVAILABLE',
  'incomplete legacy catalog rows fail closed for trusted resolution'
);

-- Historical invoice evidence is deliberately independent of local catalog activation.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  'd4000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'batch4-catalog@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);
insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status,
  storefront_mode, storefront_enabled
) values (
  'd4000000-0000-4000-9000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'Batch 4 Catalog Store', 'batch-4-catalog-store', 'draft', 'hosted', false
);
insert into public.billing_provider_events (
  stripe_livemode, stripe_account_id, provider_event_id,
  provider_event_created_at, store_id, event_type, payload_hash,
  applied, processing_status, processed_at, attempt_count,
  provider_object_type, provider_object_id
) values
  (
    false, 'acct_Batch4PlatformA', 'evt_Batch4CustomerEvidence',
    timestamptz '2026-01-01 00:00:00+00',
    'd4000000-0000-4000-9000-000000000001', 'customer.created',
    'batch4-customer-evidence-hash', true, 'processed',
    timestamptz '2026-01-01 00:00:01+00', 1, 'customer', 'cus_Batch4Evidence'
  ),
  (
    false, 'acct_Batch4PlatformA', 'evt_Batch4SubscriptionEvidence',
    timestamptz '2026-01-01 00:01:00+00',
    'd4000000-0000-4000-9000-000000000001', 'customer.subscription.created',
    'batch4-subscription-evidence-hash', true, 'processed',
    timestamptz '2026-01-01 00:01:01+00', 1, 'subscription', 'sub_Batch4Evidence'
  ),
  (
    false, 'acct_Batch4PlatformA', 'evt_Batch4InvoiceEvidence',
    timestamptz '2026-01-02 00:00:00+00',
    'd4000000-0000-4000-9000-000000000001', 'invoice.paid',
    'batch4-invoice-evidence-hash', true, 'processed',
    timestamptz '2026-01-02 00:00:01+00', 1, 'invoice', 'in_Batch4Evidence'
  );
insert into public.billing_customer_bindings (
  id, store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
  provider_created_at, bound_by_event_id
) values (
  'd4000000-0000-4000-a000-000000000001',
  'd4000000-0000-4000-9000-000000000001', 'cus_Batch4Evidence', false,
  'acct_Batch4PlatformA', timestamptz '2026-01-01 00:00:00+00',
  'evt_Batch4CustomerEvidence'
);
insert into public.billing_subscription_enrollments (
  id, store_id, customer_binding_id, stripe_subscription_id,
  initial_stripe_price_id, stripe_livemode, stripe_account_id,
  provider_status, provider_created_at, bound_by_event_id
) values (
  'd4000000-0000-4000-b000-000000000001',
  'd4000000-0000-4000-9000-000000000001',
  'd4000000-0000-4000-a000-000000000001', 'sub_Batch4Evidence',
  'price_Batch4CoopMonthly', false, 'acct_Batch4PlatformA', 'active',
  timestamptz '2026-01-01 00:00:00+00', 'evt_Batch4SubscriptionEvidence'
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
  'd4000000-0000-4000-9000-000000000001',
  'd4000000-0000-4000-b000-000000000001',
  'd4000000-0000-4000-a000-000000000001', 'cus_Batch4Evidence',
  'sub_Batch4Evidence', 'in_Batch4Evidence', 'price_Batch4CoopMonthly',
  false, 'acct_Batch4PlatformA', 'subscription_cycle',
  'charge_automatically', 'paid', 'usd', 500, 500, 0, 500,
  timestamptz '2026-01-01 00:00:00+00',
  timestamptz '2026-02-01 00:00:00+00',
  timestamptz '2026-01-02 00:00:00+00',
  'evt_Batch4InvoiceEvidence', timestamptz '2026-01-02 00:00:00+00'
);

select is(
  (select deactivation_status from public.deactivate_verified_saas_price(
    'price_Batch4CoopMonthly', 'acct_Batch4PlatformA', false, 'Replaced during controlled test'
  )),
  'deactivated',
  'verified Price can be locally deactivated'
);
select ok(
  exists (
    select 1 from public.billing_provider_price_catalog
    where stripe_price_id = 'price_Batch4CoopMonthly'
      and not is_active and deactivated_at is not null
  ),
  'deactivation preserves the row and records inactive state'
);
select is(
  (select count(*)::integer from public.billing_provider_price_catalog_events
   where stripe_price_id = 'price_Batch4CoopMonthly' and event_type = 'price_deactivated'),
  1,
  'deactivation writes one audit event'
);
select is(
  (select deactivation_status from public.deactivate_verified_saas_price(
    'price_Batch4CoopMonthly', 'acct_Batch4PlatformA', false, 'Repeated request'
  )),
  'already_inactive',
  'deactivation replay is idempotent'
);
select throws_ok(
  $$select pg_temp.batch4_register('{"price":"price_Batch4CoopMonthly"}')$$,
  '23505', 'SAAS_CATALOG_DEACTIVATED_PRICE_IMMUTABLE',
  'a deactivated Price cannot be silently remapped or reactivated'
);
select is(
  pg_temp.batch4_register('{"price":"price_Batch4ReplacementMonthly"}'),
  'registered',
  'a replacement Price may become the sole active Price'
);
select is(
  (select count(*)::integer from public.billing_provider_price_catalog
   where plan_key = 'small_flock' and billing_cadence = 'monthly'
     and stripe_account_id = 'acct_Batch4PlatformA' and not stripe_livemode
     and is_active and is_verified),
  1,
  'replacement remains the sole active verified selection'
);

select is(
  (select boolean_value from public.platform_settings where setting_key = 'saas_subscription_checkout_enabled'),
  false,
  'SaaS Checkout remains disabled'
);
select is(
  (select boolean_value from public.platform_settings where setting_key = 'saas_billing_portal_enabled'),
  false,
  'Billing Portal remains disabled'
);
select is(
  (select count(*)::integer from public.billing_entitlement_events),
  0,
  'catalog registration and deactivation create no entitlement events'
);
select is(
  (select stripe_price_id from public.billing_subscription_invoices where stripe_invoice_id = 'in_Batch4Evidence'),
  'price_Batch4CoopMonthly',
  'historical invoice evidence remains valid after catalog deactivation'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select pg_temp.batch4_register('{"price":"price_Batch4Browser"}')$$,
  '42501', 'SERVICE_ROLE_REQUIRED',
  'authenticated platform context cannot assert verified catalog truth'
);
select set_config('request.jwt.claim.role', 'service_role', true);

select * from finish();
rollback;
