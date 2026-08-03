begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(
  has_function_privilege(
    'service_role',
    'public.defer_saas_subscription_event_until_enrollment(text,text,text,boolean,text,text,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.defer_saas_subscription_event_until_enrollment(text,text,text,boolean,text,text,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.defer_saas_subscription_event_until_enrollment(text,text,text,boolean,text,text,text,text,uuid)',
    'execute'
  ),
  'only service role can preserve an early Subscription event as deferred'
);

create temporary table domain_counts_before as
select
  (select count(*) from public.seller_billing_status) as billing_rows,
  (select count(*) from public.billing_customer_bindings) as customer_bindings,
  (select count(*) from public.billing_subscription_enrollments) as enrollments,
  (select count(*) from public.billing_trial_claims) as trial_claims,
  (select count(*) from public.billing_subscription_invoices) as invoices;

create temporary table early_subscription_receipt as
select * from public.claim_saas_billing_provider_event(
  'evt_EarlySubscriptionCreated',
  'customer.subscription.created',
  timestamptz '2026-08-03 12:00:00+00',
  repeat('a', 64),
  'acct_EarlySubscription',
  false,
  'local',
  'subscription',
  'sub_EarlySubscription'
);

select is(
  public.mark_saas_billing_provider_event_deferred(
    'evt_EarlySubscriptionCreated',
    repeat('a', 64),
    'acct_EarlySubscription',
    false,
    (select processing_lease_token from early_subscription_receipt),
    'awaiting_verified_enrollment_batch'
  ),
  'deferred',
  'verified early Subscription receipt enters the existing deferred queue'
);

create temporary table early_subscription_reconciliation as
select * from public.claim_deferred_saas_billing_provider_event(
  'evt_EarlySubscriptionCreated',
  repeat('a', 64),
  'acct_EarlySubscription',
  false,
  'local',
  'customer.subscription.created',
  'subscription',
  'sub_EarlySubscription'
);

select is(
  public.defer_saas_subscription_event_until_enrollment(
    'evt_EarlySubscriptionCreated',
    repeat('a', 64),
    'acct_EarlySubscription',
    false,
    'local',
    'customer.subscription.created',
    'subscription',
    'sub_EarlySubscription',
    (select processing_lease_token from early_subscription_reconciliation)
  ),
  'deferred',
  'missing immutable enrollment releases the fenced event back to deferred'
);

select is(
  (select processing_status from public.billing_provider_events
   where provider_event_id = 'evt_EarlySubscriptionCreated'),
  'deferred',
  'early Subscription event is not failed, processed, or ignored'
);
select is(
  (select deferred_reason from public.billing_provider_events
   where provider_event_id = 'evt_EarlySubscriptionCreated'),
  'awaiting_verified_enrollment_batch',
  'the original typed deferred reason is preserved'
);
select is(
  (select applied from public.billing_provider_events
   where provider_event_id = 'evt_EarlySubscriptionCreated'),
  false,
  'early Subscription event is not domain-applied'
);
select is(
  (select processing_lease_token from public.billing_provider_events
   where provider_event_id = 'evt_EarlySubscriptionCreated'),
  null::uuid,
  'released event has no active reconciliation lease'
);
select is(
  (select last_error_code from public.billing_provider_events
   where provider_event_id = 'evt_EarlySubscriptionCreated'),
  null::text,
  'missing enrollment is not recorded as a processing failure'
);
select ok(
  exists (
    select 1 from public.billing_provider_event_audits
    where provider_event_id = 'evt_EarlySubscriptionCreated'
      and audit_type = 'provider_event_deferred'
      and result_code = 'enrollment_not_yet_available'
  ),
  'the enrollment wait is retained in the audit history'
);

select is(
  public.defer_saas_subscription_event_until_enrollment(
    'evt_EarlySubscriptionCreated',
    repeat('a', 64),
    'acct_EarlySubscription',
    false,
    'local',
    'customer.subscription.created',
    'subscription',
    'sub_EarlySubscription',
    (select processing_lease_token from early_subscription_reconciliation)
  ),
  'deferred_duplicate',
  'releasing the same exact event is idempotent'
);

create temporary table post_enrollment_reconciliation as
select * from public.claim_deferred_saas_billing_provider_event(
  'evt_EarlySubscriptionCreated',
  repeat('a', 64),
  'acct_EarlySubscription',
  false,
  'local',
  'customer.subscription.created',
  'subscription',
  'sub_EarlySubscription'
);

select is(
  (select reconciliation_state from post_enrollment_reconciliation),
  'claimed',
  'the deferred event remains claimable after enrollment becomes available'
);
select is(
  (select reconciliation_state
   from public.claim_deferred_saas_billing_provider_event(
     'evt_EarlySubscriptionCreated',
     repeat('a', 64),
     'acct_EarlySubscription',
     false,
     'local',
     'customer.subscription.created',
     'subscription',
     'sub_EarlySubscription'
   )),
  'in_progress',
  'a second reconciliation worker cannot steal the active lease'
);

select throws_ok(
  $$select public.defer_saas_subscription_event_until_enrollment(
    'evt_EarlySubscriptionCreated', repeat('b', 64),
    'acct_EarlySubscription', false, 'local',
    'customer.subscription.created', 'subscription',
    'sub_EarlySubscription',
    (select processing_lease_token from post_enrollment_reconciliation)
  )$$,
  '22023',
  'SAAS_SUBSCRIPTION_DEFER_IDENTITY_MISMATCH',
  'a conflicting payload hash cannot release or replace the event'
);

select is(
  public.mark_saas_billing_provider_event_processed(
    'evt_EarlySubscriptionCreated',
    repeat('a', 64),
    'acct_EarlySubscription',
    false,
    (select processing_lease_token from post_enrollment_reconciliation)
  ),
  'processed',
  'trusted reconciliation may process the event exactly once after enrollment'
);
select is(
  (select reconciliation_state
   from public.claim_deferred_saas_billing_provider_event(
     'evt_EarlySubscriptionCreated',
     repeat('a', 64),
     'acct_EarlySubscription',
     false,
     'local',
     'customer.subscription.created',
     'subscription',
     'sub_EarlySubscription'
   )),
  'already_processed',
  'processed Subscription event cannot be replayed'
);
select throws_ok(
  $$select public.defer_saas_subscription_event_until_enrollment(
    'evt_EarlySubscriptionCreated', repeat('a', 64),
    'acct_EarlySubscription', false, 'local',
    'customer.subscription.created', 'subscription',
    'sub_EarlySubscription',
    (select processing_lease_token from post_enrollment_reconciliation)
  )$$,
  '55000',
  'SAAS_SUBSCRIPTION_DEFER_FENCE_INVALID',
  'processed Subscription event cannot be reopened as deferred'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.defer_saas_subscription_event_until_enrollment(
    'evt_EarlySubscriptionCreated', repeat('a', 64),
    'acct_EarlySubscription', false, 'local',
    'customer.subscription.created', 'subscription',
    'sub_EarlySubscription', gen_random_uuid()
  )$$,
  '42501',
  'SERVICE_ROLE_REQUIRED',
  'browser roles cannot reclassify provider events'
);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select count(*) from public.seller_billing_status),
  (select billing_rows from domain_counts_before),
  'early Subscription handling writes no seller billing authority'
);
select is(
  (select count(*) from public.billing_customer_bindings),
  (select customer_bindings from domain_counts_before),
  'early Subscription handling creates no Customer binding'
);
select is(
  (select count(*) from public.billing_subscription_enrollments),
  (select enrollments from domain_counts_before),
  'early Subscription handling creates no enrollment'
);
select is(
  (select count(*) from public.billing_trial_claims),
  (select trial_claims from domain_counts_before),
  'early Subscription handling creates no trial claim'
);
select is(
  (select count(*) from public.billing_subscription_invoices),
  (select invoices from domain_counts_before),
  'early Subscription handling creates no paid-through evidence'
);
select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_subscription_checkout_enabled'),
  false,
  'Checkout feature remains disabled'
);
select is(
  (select boolean_value from public.platform_settings
   where setting_key = 'saas_billing_portal_enabled'),
  false,
  'Portal feature remains disabled'
);

select * from finish();
rollback;
