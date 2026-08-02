begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select has_column('public', 'billing_provider_events', 'processing_environment_id',
  'provider events retain their processing environment');
select has_column('public', 'billing_provider_events', 'processing_lease_expires_at',
  'provider events expose a bounded processing lease');
select has_column('public', 'billing_provider_events', 'processing_lease_token',
  'provider events fence workers with a lease token');
select has_column('public', 'billing_provider_events', 'deferred_at',
  'provider events record when verified work was deferred');
select has_column('public', 'billing_provider_events', 'deferred_reason',
  'provider events retain a typed deferred reason');
select has_table('public', 'billing_provider_event_audits',
  'provider event transitions have a narrow audit ledger');

select ok(
  has_function_privilege('service_role',
    'public.claim_saas_billing_provider_event(text,text,timestamptz,text,text,boolean,text,text,text)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.claim_saas_billing_provider_event(text,text,timestamptz,text,text,boolean,text,text,text)',
    'execute'),
  'webhook event claim is service-role only'
);
select ok(
  has_function_privilege('service_role',
    'public.claim_deferred_saas_billing_provider_event(text,text,text,boolean,text,text,text,text)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.claim_deferred_saas_billing_provider_event(text,text,text,boolean,text,text,text,text)',
    'execute')
  and not has_function_privilege('anon',
    'public.claim_deferred_saas_billing_provider_event(text,text,text,boolean,text,text,text,text)',
    'execute'),
  'deferred reconciliation claim is service-role only'
);
select ok(
  not has_function_privilege('authenticated',
    'public.mark_saas_billing_provider_event_deferred(text,text,text,boolean,uuid,text)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.mark_saas_billing_provider_event_ignored(text,text,text,boolean,uuid,text)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.mark_saas_billing_provider_event_failed(text,text,text,boolean,uuid,text,text,boolean)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.mark_saas_billing_provider_event_processed(text,text,text,boolean,uuid)',
    'execute'),
  'browser and platform-admin roles cannot write provider-event outcomes'
);

select throws_ok(
  $$select * from public.claim_saas_billing_provider_event(
    '', 'invoice.payment_succeeded', now(), repeat('a', 64),
    'acct_Batch6', false, 'local', 'invoice', 'in_Batch6')$$,
  '22023', 'SAAS_EVENT_ID_INVALID', 'blank event ID is rejected'
);
select throws_ok(
  $$select * from public.claim_saas_billing_provider_event(
    'evt_Batch6BlankType', '', now(), repeat('a', 64),
    'acct_Batch6', false, 'local', 'invoice', 'in_Batch6')$$,
  '22023', 'SAAS_EVENT_TYPE_INVALID', 'blank event type is rejected'
);
select throws_ok(
  $$select * from public.claim_saas_billing_provider_event(
    'evt_Batch6BadAccount', 'invoice.payment_succeeded', now(), repeat('a', 64),
    'invalid', false, 'local', 'invoice', 'in_Batch6')$$,
  '22023', 'SAAS_EVENT_ACCOUNT_INVALID', 'invalid account is rejected'
);
select throws_ok(
  $$select * from public.claim_saas_billing_provider_event(
    'evt_Batch6BadHash', 'invoice.payment_succeeded', now(), 'abc',
    'acct_Batch6', false, 'local', 'invoice', 'in_Batch6')$$,
  '22023', 'SAAS_EVENT_HASH_INVALID', 'invalid hash is rejected'
);

create temporary table batch6_domain_counts as
select
  (select count(*) from public.seller_billing_status) as billing_rows,
  (select count(*) from public.billing_customer_bindings) as customer_bindings,
  (select count(*) from public.billing_subscription_enrollments) as enrollments,
  (select count(*) from public.billing_trial_claims) as trial_claims;

create temporary table batch6_completed_claim as
select * from public.claim_saas_billing_provider_event(
  'evt_Batch6Completed', 'checkout.session.completed',
  timestamptz '2026-08-02 12:00:00+00', repeat('a', 64),
  'acct_Batch6', false, 'local', 'checkout.session', 'cs_test_Batch6Completed'
);
select is((select claim_state from batch6_completed_claim), 'claimed',
  'first verified Checkout completion claim succeeds');
select isnt((select processing_lease_token from batch6_completed_claim), null::uuid,
  'first claim returns a fenced service lease token');
select is(
  (select claim_state from public.claim_saas_billing_provider_event(
    'evt_Batch6Completed', 'checkout.session.completed',
    timestamptz '2026-08-02 12:00:00+00', repeat('a', 64),
    'acct_Batch6', false, 'local', 'checkout.session', 'cs_test_Batch6Completed')),
  'in_progress', 'fresh duplicate webhook cannot steal the receipt lease'
);
select is(
  (select claim_state from public.claim_saas_billing_provider_event(
    'evt_Batch6Completed', 'checkout.session.completed',
    timestamptz '2026-08-02 12:00:00+00', repeat('b', 64),
    'acct_Batch6', false, 'local', 'checkout.session', 'cs_test_Batch6Completed')),
  'conflict', 'conflicting webhook hash is rejected'
);
select is(
  (select claim_state from public.claim_saas_billing_provider_event(
    'evt_Batch6Completed', 'checkout.session.completed',
    timestamptz '2026-08-02 12:00:00+00', repeat('a', 64),
    'acct_OtherBatch6', false, 'local', 'checkout.session', 'cs_test_Batch6Completed')),
  'conflict', 'conflicting webhook account is rejected'
);
select is(
  public.mark_saas_billing_provider_event_deferred(
    'evt_Batch6Completed', repeat('a', 64), 'acct_Batch6', false,
    (select processing_lease_token from batch6_completed_claim),
    'awaiting_verified_enrollment_batch'),
  'deferred', 'Checkout completion becomes replayable deferred work'
);
select is(
  (select processing_status from public.billing_provider_events
   where provider_event_id = 'evt_Batch6Completed'),
  'deferred', 'Checkout completion is stored as deferred, not ignored'
);
select is(
  (select deferred_reason from public.billing_provider_events
   where provider_event_id = 'evt_Batch6Completed'),
  'awaiting_verified_enrollment_batch', 'deferred reason is typed'
);
select is(
  (select ignored_reason from public.billing_provider_events
   where provider_event_id = 'evt_Batch6Completed'),
  null::text, 'deferred Checkout completion has no ignored reason'
);
select is(
  (select applied from public.billing_provider_events
   where provider_event_id = 'evt_Batch6Completed'),
  false, 'deferred receipt is not represented as domain-applied'
);
select is(
  (select claim_state from public.claim_saas_billing_provider_event(
    'evt_Batch6Completed', 'checkout.session.completed',
    timestamptz '2026-08-02 12:00:00+00', repeat('a', 64),
    'acct_Batch6', false, 'local', 'checkout.session', 'cs_test_Batch6Completed')),
  'deferred_duplicate', 'duplicate webhook delivery remains idempotent'
);

create temporary table batch6_reconciliation_claim as
select * from public.claim_deferred_saas_billing_provider_event(
  'evt_Batch6Completed', repeat('a', 64), 'acct_Batch6', false,
  'local', 'checkout.session.completed', 'checkout.session',
  'cs_test_Batch6Completed'
);
select is((select reconciliation_state from batch6_reconciliation_claim), 'claimed',
  'authorized reconciliation can claim deferred work');
select isnt((select processing_lease_token from batch6_reconciliation_claim), null::uuid,
  'reconciliation receives a new fenced lease token');
select is(
  (select reconciliation_state from public.claim_deferred_saas_billing_provider_event(
    'evt_Batch6Completed', repeat('a', 64), 'acct_Batch6', false,
    'local', 'checkout.session.completed', 'checkout.session',
    'cs_test_Batch6Completed')),
  'in_progress', 'second reconciliation worker cannot claim fresh work'
);
select is(
  (select reconciliation_state from public.claim_deferred_saas_billing_provider_event(
    'evt_Batch6Completed', repeat('f', 64), 'acct_Batch6', false,
    'local', 'checkout.session.completed', 'checkout.session',
    'cs_test_Batch6Completed')),
  'conflict', 'reconciliation requires the original payload hash'
);
select is(
  public.mark_saas_billing_provider_event_processed(
    'evt_Batch6Completed', repeat('a', 64), 'acct_Batch6', false,
    (select processing_lease_token from batch6_reconciliation_claim)),
  'processed', 'authorized reconciliation can terminally complete its lease'
);
select is(
  (select reconciliation_state from public.claim_deferred_saas_billing_provider_event(
    'evt_Batch6Completed', repeat('a', 64), 'acct_Batch6', false,
    'local', 'checkout.session.completed', 'checkout.session',
    'cs_test_Batch6Completed')),
  'already_processed', 'processed deferred work cannot be replayed'
);

create temporary table batch6_unsupported_claim as
select * from public.claim_saas_billing_provider_event(
  'evt_Batch6Unsupported', 'product.updated',
  timestamptz '2026-08-02 12:01:00+00', repeat('c', 64),
  'acct_Batch6', false, 'local', 'product', 'prod_Batch6Unsupported'
);
select is(
  public.mark_saas_billing_provider_event_ignored(
    'evt_Batch6Unsupported', repeat('c', 64), 'acct_Batch6', false,
    (select processing_lease_token from batch6_unsupported_claim),
    'unsupported_event_type'),
  'ignored', 'unsupported authenticated event is terminally ignored'
);
select is(
  (select reconciliation_state from public.claim_deferred_saas_billing_provider_event(
    'evt_Batch6Unsupported', repeat('c', 64), 'acct_Batch6', false,
    'local', 'product.updated', 'product', 'prod_Batch6Unsupported')),
  'not_deferred', 'unsupported ignored event cannot be reopened'
);
select is(
  (select claim_state from public.claim_saas_billing_provider_event(
    'evt_Batch6Unsupported', 'product.updated',
    timestamptz '2026-08-02 12:01:00+00', repeat('c', 64),
    'acct_Batch6', false, 'local', 'product', 'prod_Batch6Unsupported')),
  'terminal_duplicate', 'unsupported ignored webhook duplicate is terminal'
);

create temporary table batch6_trial_notice_claim as
select * from public.claim_saas_billing_provider_event(
  'evt_Batch6TrialNotice', 'customer.subscription.trial_will_end',
  timestamptz '2026-08-02 12:02:00+00', repeat('d', 64),
  'acct_Batch6', false, 'local', 'subscription', 'sub_Batch6TrialNotice'
);
select is(
  public.mark_saas_billing_provider_event_ignored(
    'evt_Batch6TrialNotice', repeat('d', 64), 'acct_Batch6', false,
    (select processing_lease_token from batch6_trial_notice_claim),
    'informational_trial_will_end'),
  'ignored', 'trial-will-end is deliberately informational and terminal'
);

create temporary table batch6_retry_claim as
select * from public.claim_saas_billing_provider_event(
  'evt_Batch6Retry', 'invoice.payment_failed',
  timestamptz '2026-08-02 12:03:00+00', repeat('e', 64),
  'acct_Batch6', false, 'local', 'invoice', 'in_Batch6Retry'
);
select is(
  public.mark_saas_billing_provider_event_failed(
    'evt_Batch6Retry', repeat('e', 64), 'acct_Batch6', false,
    (select processing_lease_token from batch6_retry_claim),
    'database_unavailable', 'sanitized operational message', true),
  'failed', 'retryable receipt failure is recorded with its lease'
);
select is(
  (select claim_state from public.claim_saas_billing_provider_event(
    'evt_Batch6Retry', 'invoice.payment_failed',
    timestamptz '2026-08-02 12:03:00+00', repeat('e', 64),
    'acct_Batch6', false, 'local', 'invoice', 'in_Batch6Retry')),
  'reclaimed', 'retryable receipt failure can be reclaimed'
);

select throws_ok(
  $$update public.billing_provider_events set payload_hash = repeat('9', 64)
    where provider_event_id = 'evt_Batch6Completed'$$,
  '55000', 'SAAS_EVENT_IDENTITY_IMMUTABLE',
  'provider-event identity is immutable'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'billing_provider_events'
     and column_name in ('raw_payload', 'payload', 'request_body', 'headers')),
  0, 'provider ledger stores no raw payload or request headers'
);
select ok(
  (select count(*) > 0 from public.billing_provider_event_audits
   where provider_event_id = 'evt_Batch6Completed'
     and audit_type = 'provider_event_reconciliation_claimed'),
  'reconciliation claim is audited'
);

select is((select count(*) from public.seller_billing_status),
  (select billing_rows from batch6_domain_counts),
  'Batch 6 changes no seller billing rows');
select is((select count(*) from public.billing_customer_bindings),
  (select customer_bindings from batch6_domain_counts),
  'Batch 6 creates no Customer binding');
select is((select count(*) from public.billing_subscription_enrollments),
  (select enrollments from batch6_domain_counts),
  'Batch 6 creates no Subscription enrollment');
select is((select count(*) from public.billing_trial_claims),
  (select trial_claims from batch6_domain_counts),
  'Batch 6 creates no trial claim');
select is((select boolean_value from public.platform_settings
  where setting_key = 'saas_subscription_checkout_enabled'), false,
  'Checkout feature remains disabled');
select is((select boolean_value from public.platform_settings
  where setting_key = 'saas_billing_portal_enabled'), false,
  'Billing Portal feature remains disabled');
select ok(
  not has_function_privilege('authenticated',
    'public.apply_verified_saas_invoice_payment_succeeded(text,timestamptz,text,text,boolean,uuid,text,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,timestamptz,timestamptz,timestamptz)',
    'execute'),
  'invoice payment authority remains service-only'
);
select ok(
  not has_function_privilege('authenticated',
    'public.apply_verified_stripe_subscription_event(text,timestamptz,text,text,uuid,text,text,text,text,timestamptz,timestamptz,boolean,boolean,text)',
    'execute'),
  'subscription snapshot authority remains service-only'
);

select * from finish();
rollback;
