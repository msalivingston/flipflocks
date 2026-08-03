-- Verified FlockFront SaaS Checkout completion and trial enrollment.
--
-- This migration consumes only a signature-verified, deferred provider event
-- under a current database fencing lease. It grants no paid-through access and
-- does not treat a Checkout Session or zero-dollar trial invoice as payment.

begin;

alter table public.billing_entitlement_events
  drop constraint billing_entitlement_events_type_check;
alter table public.billing_entitlement_events
  add constraint billing_entitlement_events_type_check check (
    event_type in (
      'trial_started', 'trial_selection_changed', 'legacy_trial_classified',
      'legacy_stripe_classified', 'admin_comp_granted', 'admin_comp_revoked',
      'provider_state_applied', 'provider_event_ignored',
      'invoice_payment_succeeded_recorded', 'paid_through_extended',
      'invoice_payment_failed', 'invoice_payment_action_required',
      'invoice_finalization_failed', 'grace_scheduled', 'payment_recovered',
      'invoice_event_ignored', 'invoice_event_conflict',
      'checkout_selection_saved', 'checkout_selection_changed',
      'checkout_attempt_started', 'checkout_attempt_resumed',
      'checkout_session_created', 'checkout_creation_failed',
      'checkout_rate_limited', 'verified_checkout_completed',
      'stripe_customer_bound', 'stripe_subscription_bound',
      'verified_trial_started', 'checkout_attempt_enrolled',
      'onboarding_billing_completed',
      'verified_paid_enrollment_pending_invoice', 'deferred_event_applied',
      'checkout_completion_rejected'
    )
  );

create function public.apply_verified_saas_checkout_completion(
  p_provider_event_id text,
  p_payload_hash text,
  p_processing_lease_token uuid,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_environment_id text,
  p_provider_event_created_at timestamptz,
  p_checkout_session_id text,
  p_session_created_at timestamptz,
  p_session_expires_at timestamptz,
  p_session_status text,
  p_session_mode text,
  p_session_payment_status text,
  p_session_payment_method_collection text,
  p_session_client_reference_id text,
  p_session_livemode boolean,
  p_attempt_id uuid,
  p_session_metadata_attempt_id text,
  p_session_metadata_store_id text,
  p_session_metadata_environment_id text,
  p_session_metadata_plan_key text,
  p_session_metadata_billing_cadence text,
  p_session_metadata_schema_version text,
  p_stripe_customer_id text,
  p_customer_created_at timestamptz,
  p_customer_livemode boolean,
  p_stripe_subscription_id text,
  p_subscription_status text,
  p_subscription_created_at timestamptz,
  p_subscription_trial_start timestamptz,
  p_subscription_trial_end timestamptz,
  p_subscription_current_period_start timestamptz,
  p_subscription_current_period_end timestamptz,
  p_subscription_cancel_at_period_end boolean,
  p_subscription_livemode boolean,
  p_subscription_collection_method text,
  p_payment_method_ready boolean,
  p_subscription_metadata_attempt_id text,
  p_subscription_metadata_store_id text,
  p_subscription_metadata_environment_id text,
  p_subscription_metadata_plan_key text,
  p_subscription_metadata_billing_cadence text,
  p_subscription_metadata_schema_version text,
  p_stripe_price_id text,
  p_stripe_product_id text,
  p_line_item_quantity integer,
  p_price_livemode boolean,
  p_product_livemode boolean,
  p_price_active boolean,
  p_product_active boolean,
  p_unit_amount_cents bigint,
  p_currency text,
  p_recurring_interval text,
  p_recurring_interval_count integer,
  p_stripe_price_type text,
  p_billing_scheme text,
  p_recurring_usage_type text,
  p_tax_behavior text,
  p_stripe_product_tax_code text
)
returns table (
  application_state text,
  store_id uuid,
  customer_binding_id uuid,
  subscription_enrollment_id uuid,
  trial_claimed boolean,
  billing_complete boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_event_id text := btrim(p_provider_event_id);
  v_hash text := lower(btrim(p_payload_hash));
  v_account text := btrim(p_stripe_account_id);
  v_environment text := btrim(p_environment_id);
  v_session_id text := btrim(p_checkout_session_id);
  v_customer_id text := btrim(p_stripe_customer_id);
  v_subscription_id text := btrim(p_stripe_subscription_id);
  v_price_id text := btrim(p_stripe_price_id);
  v_product_id text := btrim(p_stripe_product_id);
  v_session_pattern text := case when p_stripe_livemode
    then '^cs_live_[A-Za-z0-9]+$' else '^cs_test_[A-Za-z0-9]+$' end;
  v_event public.billing_provider_events%rowtype;
  v_attempt public.billing_checkout_attempts%rowtype;
  v_store public.stores%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_onboarding public.seller_onboarding_state%rowtype;
  v_catalog public.billing_provider_price_catalog%rowtype;
  v_customer public.billing_customer_bindings%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_customer_was_created boolean := false;
  v_is_trial boolean;
  v_processed_result text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'SAAS_ENROLLMENT_SERVICE_ROLE_REQUIRED';
  end if;

  if coalesce(v_event_id, '') !~ '^evt_[A-Za-z0-9]+$'
     or coalesce(v_hash, '') !~ '^[0-9a-f]{64}$'
     or p_processing_lease_token is null
     or coalesce(v_account, '') !~ '^acct_[A-Za-z0-9]+$'
     or p_stripe_livemode is null
     or coalesce(v_environment, '') not in (
       'local', 'development', 'test', 'preview', 'staging', 'production'
     )
     or p_provider_event_created_at is null
     or coalesce(v_session_id, '') !~ v_session_pattern
     or coalesce(v_customer_id, '') !~ '^cus_[A-Za-z0-9]+$'
     or coalesce(v_subscription_id, '') !~ '^sub_[A-Za-z0-9]+$'
     or coalesce(v_price_id, '') !~ '^price_[A-Za-z0-9]+$'
     or coalesce(v_product_id, '') !~ '^prod_[A-Za-z0-9]+$'
     or p_attempt_id is null
     or p_session_created_at is null
     or p_session_expires_at is null
     or p_session_expires_at <= p_session_created_at
     or p_provider_event_created_at < p_session_created_at
     or p_provider_event_created_at > p_session_expires_at
     or p_customer_created_at is null
     or p_subscription_created_at is null
     or p_subscription_current_period_start is null
     or p_subscription_current_period_end is null
     or p_subscription_current_period_end <= p_subscription_current_period_start
     or p_subscription_cancel_at_period_end is null
     or p_payment_method_ready is distinct from true
     or p_line_item_quantity is distinct from 1
     or p_unit_amount_cents is null
     or p_unit_amount_cents < 0
     or p_recurring_interval_count is null
     or p_recurring_interval_count <= 0 then
    raise exception using errcode = '22023',
      message = 'SAAS_ENROLLMENT_EVIDENCE_INVALID';
  end if;

  if p_session_status is distinct from 'complete'
     or p_session_mode is distinct from 'subscription'
     or p_session_payment_method_collection is distinct from 'always'
     or p_subscription_collection_method is distinct from 'charge_automatically'
     or p_session_livemode is distinct from p_stripe_livemode
     or p_customer_livemode is distinct from p_stripe_livemode
     or p_subscription_livemode is distinct from p_stripe_livemode
     or p_price_livemode is distinct from p_stripe_livemode
     or p_product_livemode is distinct from p_stripe_livemode
     or p_price_active is distinct from true
     or p_product_active is distinct from true
     or p_stripe_price_type is distinct from 'recurring'
     or p_billing_scheme is distinct from 'per_unit'
     or p_recurring_usage_type is distinct from 'licensed'
     or p_tax_behavior is distinct from 'exclusive'
     or p_stripe_product_tax_code is distinct from 'txcd_10103001' then
    raise exception using errcode = '22023',
      message = 'SAAS_ENROLLMENT_PROVIDER_SHAPE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-provider-event:' || v_event_id, 0)
  );
  select events.* into v_event
  from public.billing_provider_events as events
  where events.stripe_livemode = p_stripe_livemode
    and events.stripe_account_id = v_account
    and events.provider_event_id = v_event_id
  for update;

  if v_event.provider_event_id is null
     or v_event.payload_hash is distinct from v_hash
     or v_event.provider_event_created_at is distinct from p_provider_event_created_at
     or v_event.event_type is distinct from 'checkout.session.completed'
     or v_event.provider_object_type is distinct from 'checkout.session'
     or v_event.provider_object_id is distinct from v_session_id
     or v_event.processing_environment_id is distinct from v_environment
     or v_event.processing_status is distinct from 'processing'
     or v_event.deferred_reason is distinct from 'awaiting_verified_enrollment_batch'
     or v_event.processing_lease_token is distinct from p_processing_lease_token
     or v_event.processing_lease_expires_at is null
     or v_event.processing_lease_expires_at <= v_now
     or v_event.applied
     or v_event.store_id is not null then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_EVENT_CLAIM_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-checkout-attempt:' || p_attempt_id::text, 0)
  );
  select attempts.* into v_attempt
  from public.billing_checkout_attempts as attempts
  where attempts.id = p_attempt_id
  for update;

  if v_attempt.id is null then
    raise exception using errcode = 'P0002',
      message = 'SAAS_ENROLLMENT_ATTEMPT_NOT_FOUND';
  end if;
  if v_attempt.attempt_status not in ('open', 'completed', 'pending_confirmation')
     or v_attempt.stripe_checkout_session_id is distinct from v_session_id
     or v_attempt.session_created_at is distinct from p_session_created_at
     or v_attempt.session_expires_at is distinct from p_session_expires_at
     or v_attempt.stripe_price_id is distinct from v_price_id
     or v_attempt.stripe_product_id is distinct from v_product_id
     or v_attempt.stripe_livemode is distinct from p_stripe_livemode
     or v_attempt.stripe_account_id is distinct from v_account
     or v_attempt.checkout_environment_id is distinct from v_environment
     or (v_attempt.stripe_customer_id is not null
       and v_attempt.stripe_customer_id is distinct from v_customer_id)
     or (v_attempt.stripe_subscription_id is not null
       and v_attempt.stripe_subscription_id is distinct from v_subscription_id) then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_ATTEMPT_CONFLICT';
  end if;

  select stores.* into v_store
  from public.stores as stores
  where stores.id = v_attempt.store_id
  for update;
  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = v_attempt.store_id
  for update;
  select onboarding.* into v_onboarding
  from public.seller_onboarding_state as onboarding
  where onboarding.store_id = v_attempt.store_id
  for update;

  if v_store.id is null or v_billing.id is null or v_onboarding.id is null
     or not v_onboarding.profile_complete
     or v_store.admin_hold_reason is not null
     or v_billing.current_subscription_enrollment_id is not null
     or exists (
       select 1 from public.billing_subscription_enrollments as enrollments
       where enrollments.store_id = v_attempt.store_id
         and (enrollments.is_current or enrollments.ended_at is null)
     ) then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_BILLING_STATE_CONFLICT';
  end if;

  if p_session_client_reference_id is distinct from v_attempt.id::text
     or p_session_metadata_attempt_id is distinct from v_attempt.id::text
     or p_session_metadata_store_id is distinct from v_attempt.store_id::text
     or p_session_metadata_environment_id is distinct from v_environment
     or p_session_metadata_plan_key is distinct from v_attempt.requested_plan_key
     or p_session_metadata_billing_cadence is distinct from
       v_attempt.requested_billing_cadence
     or p_session_metadata_schema_version is distinct from 'ff_saas_checkout_v1'
     or p_subscription_metadata_attempt_id is distinct from v_attempt.id::text
     or p_subscription_metadata_store_id is distinct from v_attempt.store_id::text
     or p_subscription_metadata_environment_id is distinct from v_environment
     or p_subscription_metadata_plan_key is distinct from v_attempt.requested_plan_key
     or p_subscription_metadata_billing_cadence is distinct from
       v_attempt.requested_billing_cadence
     or p_subscription_metadata_schema_version is distinct from
       'ff_saas_checkout_v1' then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_METADATA_CONFLICT';
  end if;

  select catalog.* into v_catalog
  from public.billing_provider_price_catalog as catalog
  where catalog.plan_key = v_attempt.requested_plan_key
    and catalog.billing_cadence = v_attempt.requested_billing_cadence
    and catalog.stripe_account_id = v_account
    and catalog.stripe_livemode = p_stripe_livemode
    and catalog.is_active
    and catalog.is_verified
  for share;

  if v_catalog.stripe_price_id is null
     or v_catalog.stripe_price_id is distinct from v_price_id
     or v_catalog.stripe_product_id is distinct from v_product_id
     or v_catalog.unit_amount_cents is distinct from p_unit_amount_cents
     or v_catalog.currency is distinct from p_currency
     or v_catalog.recurring_interval is distinct from p_recurring_interval
     or v_catalog.recurring_interval_count is distinct from
       p_recurring_interval_count
     or v_catalog.stripe_price_type is distinct from p_stripe_price_type
     or v_catalog.billing_scheme is distinct from p_billing_scheme
     or v_catalog.recurring_usage_type is distinct from p_recurring_usage_type
     or v_catalog.tax_behavior is distinct from p_tax_behavior
     or v_catalog.stripe_product_tax_code is distinct from
       p_stripe_product_tax_code
     or v_billing.requested_plan_key is distinct from v_catalog.plan_key
     or v_billing.requested_billing_cadence is distinct from
       v_catalog.billing_cadence then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_CATALOG_CONFLICT';
  end if;

  if v_attempt.trial_eligibility is null
     or v_attempt.trial_eligibility not in (
       'trial_eligible', 'trial_already_used'
     ) then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_TRIAL_DECISION_INVALID';
  end if;
  v_is_trial := v_attempt.trial_eligibility = 'trial_eligible';

  if v_is_trial then
    if v_billing.billing_state_authority is distinct from 'pending_checkout'
       or v_billing.subscription_status is distinct from 'dormant'
       or v_billing.plan_key is not null
       or v_billing.billing_plan is not null
       or v_billing.trial_started_at is not null
       or v_billing.trial_ends_at is not null
       or v_billing.paid_through_at is not null
       or v_billing.grace_ends_at is not null
       or v_billing.stripe_customer_id is not null
       or v_billing.stripe_subscription_id is not null
       or v_billing.stripe_price_id is not null
       or v_billing.storefront_access_until is not null
       or p_subscription_status is distinct from 'trialing'
       or p_session_payment_status is distinct from 'no_payment_required'
       or p_subscription_trial_start is null
       or p_subscription_trial_end is null
       or p_subscription_trial_end <= p_subscription_trial_start
       or p_subscription_trial_end - p_subscription_trial_start >
         interval '7 days 5 minutes'
       or p_subscription_current_period_start is distinct from
         p_subscription_trial_start
       or p_subscription_current_period_end is distinct from
         p_subscription_trial_end
       or exists (
         select 1 from public.billing_trial_claims as claims
         where claims.store_id = v_attempt.store_id
       )
       or exists (
         select 1 from public.billing_subscription_enrollments as enrollments
         where enrollments.store_id = v_attempt.store_id
           and (enrollments.trial_started_at is not null
             or enrollments.trial_ends_at is not null)
       ) then
      raise exception using errcode = '55000',
        message = 'SAAS_ENROLLMENT_TRIAL_CONFLICT';
    end if;
  else
    if v_billing.billing_state_authority is distinct from 'trial'
       or v_billing.subscription_status is distinct from 'trialing'
       or v_billing.trial_started_at is null
       or v_billing.trial_ends_at is null
       or v_billing.trial_ends_at > v_now
       or v_billing.stripe_customer_id is not null
       or v_billing.stripe_subscription_id is not null
       or v_billing.stripe_price_id is not null
       or p_subscription_status is distinct from 'active'
       or p_session_payment_status is distinct from 'paid'
       or p_subscription_trial_start is not null
       or p_subscription_trial_end is not null then
      raise exception using errcode = '55000',
        message = 'SAAS_ENROLLMENT_TRIAL_USED_CONFLICT';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stripe-customer:' || v_account || ':' || p_stripe_livemode::text ||
      ':' || v_customer_id,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stripe-subscription:' || v_account || ':' || p_stripe_livemode::text ||
      ':' || v_subscription_id,
      0
    )
  );

  select bindings.* into v_customer
  from public.billing_customer_bindings as bindings
  where bindings.store_id = v_attempt.store_id
    and bindings.stripe_livemode = p_stripe_livemode
    and bindings.stripe_account_id = v_account
  for update;
  if v_customer.id is not null then
    if v_customer.stripe_customer_id is distinct from v_customer_id
       or v_customer.provider_created_at is distinct from p_customer_created_at then
      raise exception using errcode = '55000',
        message = 'SAAS_ENROLLMENT_CUSTOMER_CONFLICT';
    end if;
  else
    if exists (
      select 1 from public.billing_customer_bindings as bindings
      where bindings.stripe_customer_id = v_customer_id
        and bindings.stripe_livemode = p_stripe_livemode
        and bindings.stripe_account_id = v_account
        and bindings.store_id <> v_attempt.store_id
    ) then
      raise exception using errcode = '55000',
        message = 'SAAS_ENROLLMENT_CUSTOMER_CONFLICT';
    end if;
  end if;

  if exists (
    select 1 from public.billing_subscription_enrollments as enrollments
    where enrollments.stripe_subscription_id = v_subscription_id
      and enrollments.stripe_livemode = p_stripe_livemode
      and enrollments.stripe_account_id = v_account
  ) or exists (
    select 1 from public.billing_subscription_enrollments as enrollments
    where enrollments.checkout_attempt_id = v_attempt.id
  ) then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_SUBSCRIPTION_CONFLICT';
  end if;

  -- The existing composite provider-event foreign keys require the verified
  -- receipt to be store-bound before immutable Customer/Subscription inserts.
  -- This update is part of the same transaction and rolls back on any failure.
  update public.billing_provider_events as events
  set store_id = v_attempt.store_id
  where events.stripe_livemode = p_stripe_livemode
    and events.stripe_account_id = v_account
    and events.provider_event_id = v_event_id;

  if v_customer.id is null then
    insert into public.billing_customer_bindings (
      store_id, stripe_customer_id, stripe_livemode, stripe_account_id,
      provider_created_at, bound_by_event_id
    ) values (
      v_attempt.store_id, v_customer_id, p_stripe_livemode, v_account,
      p_customer_created_at, v_event_id
    ) returning * into v_customer;
    v_customer_was_created := true;
  end if;

  insert into public.billing_subscription_enrollments (
    store_id, customer_binding_id, checkout_attempt_id,
    stripe_subscription_id, initial_stripe_price_id, stripe_livemode,
    stripe_account_id, provider_status, trial_started_at, trial_ends_at,
    cancel_at_period_end, is_current, provider_created_at, bound_by_event_id
  ) values (
    v_attempt.store_id, v_customer.id, v_attempt.id,
    v_subscription_id, v_price_id, p_stripe_livemode, v_account,
    p_subscription_status,
    case when v_is_trial then p_subscription_trial_start else null end,
    case when v_is_trial then p_subscription_trial_end else null end,
    p_subscription_cancel_at_period_end, true,
    p_subscription_created_at, v_event_id
  ) returning * into v_enrollment;

  if v_is_trial then
    insert into public.billing_trial_claims (
      store_id, subscription_enrollment_id, trial_started_at,
      trial_ends_at, provider_event_id
    ) values (
      v_attempt.store_id, v_enrollment.id, p_subscription_trial_start,
      p_subscription_trial_end, v_event_id
    );
  end if;

  update public.billing_checkout_attempts as attempts
  set attempt_status = 'enrolled',
      stripe_customer_id = v_customer_id,
      stripe_subscription_id = v_subscription_id,
      completed_at = p_provider_event_created_at,
      last_failure_code = null,
      updated_at = v_now
  where attempts.id = v_attempt.id;

  update public.seller_billing_status as status
  set plan_key = v_catalog.plan_key,
      billing_plan = v_catalog.billing_cadence,
      subscription_status = p_subscription_status,
      current_period_start = p_subscription_current_period_start,
      current_period_end = p_subscription_current_period_end,
      storefront_access_until = case when v_is_trial
        then p_subscription_trial_end else status.storefront_access_until end,
      trial_started_at = case when v_is_trial
        then p_subscription_trial_start else status.trial_started_at end,
      trial_ends_at = case when v_is_trial
        then p_subscription_trial_end else status.trial_ends_at end,
      cancel_at_period_end = p_subscription_cancel_at_period_end,
      billing_state_authority = 'stripe',
      stripe_customer_id = v_customer_id,
      stripe_subscription_id = v_subscription_id,
      stripe_price_id = v_price_id,
      stripe_livemode = p_stripe_livemode,
      stripe_account_id = v_account,
      current_subscription_enrollment_id = v_enrollment.id,
      effective_price_started_at = p_subscription_created_at,
      last_provider_event_id = v_event_id,
      last_provider_event_created_at = p_provider_event_created_at,
      last_provider_event_applied_at = v_now,
      updated_at = v_now
  where status.store_id = v_attempt.store_id;

  update public.seller_onboarding_state as onboarding
  set billing_complete = v_is_trial,
      updated_at = v_now
  where onboarding.store_id = v_attempt.store_id;

  insert into public.billing_entitlement_events (
    store_id, event_type, plan_key, billing_cadence, access_until,
    provider_event_id, metadata
  ) values (
    v_attempt.store_id, 'verified_checkout_completed', v_catalog.plan_key,
    v_catalog.billing_cadence,
    case when v_is_trial then p_subscription_trial_end else null end,
    v_event_id,
    pg_catalog.jsonb_build_object(
      'attempt_id', v_attempt.id,
      'environment_id', v_environment,
      'trial_eligibility', v_attempt.trial_eligibility,
      'schema_version', 'ff_saas_checkout_v1'
    )
  );

  if v_customer_was_created then
    insert into public.billing_entitlement_events (
      store_id, event_type, provider_event_id, metadata
    ) values (
      v_attempt.store_id, 'stripe_customer_bound', v_event_id,
      pg_catalog.jsonb_build_object('attempt_id', v_attempt.id)
    );
  end if;

  insert into public.billing_entitlement_events (
    store_id, event_type, plan_key, billing_cadence, access_until,
    provider_event_id, metadata
  ) values
  (
    v_attempt.store_id, 'stripe_subscription_bound', v_catalog.plan_key,
    v_catalog.billing_cadence, null, v_event_id,
    pg_catalog.jsonb_build_object(
      'attempt_id', v_attempt.id,
      'enrollment_id', v_enrollment.id
    )
  ),
  (
    v_attempt.store_id, 'checkout_attempt_enrolled', v_catalog.plan_key,
    v_catalog.billing_cadence,
    case when v_is_trial then p_subscription_trial_end else null end,
    v_event_id,
    pg_catalog.jsonb_build_object(
      'attempt_id', v_attempt.id,
      'enrollment_id', v_enrollment.id
    )
  ),
  (
    v_attempt.store_id,
    case when v_is_trial then 'verified_trial_started'
      else 'verified_paid_enrollment_pending_invoice' end,
    v_catalog.plan_key, v_catalog.billing_cadence,
    case when v_is_trial then p_subscription_trial_end else null end,
    v_event_id,
    pg_catalog.jsonb_build_object(
      'attempt_id', v_attempt.id,
      'enrollment_id', v_enrollment.id,
      'invoice_payment_authority', false
    )
  ),
  (
    v_attempt.store_id, 'deferred_event_applied', v_catalog.plan_key,
    v_catalog.billing_cadence,
    case when v_is_trial then p_subscription_trial_end else null end,
    v_event_id,
    pg_catalog.jsonb_build_object(
      'attempt_id', v_attempt.id,
      'enrollment_id', v_enrollment.id
    )
  );

  if v_is_trial then
    insert into public.billing_entitlement_events (
      store_id, event_type, plan_key, billing_cadence, access_until,
      provider_event_id, metadata
    ) values (
      v_attempt.store_id, 'onboarding_billing_completed',
      v_catalog.plan_key, v_catalog.billing_cadence,
      p_subscription_trial_end, v_event_id,
      pg_catalog.jsonb_build_object(
        'attempt_id', v_attempt.id,
        'enrollment_id', v_enrollment.id
      )
    );
  end if;

  update public.billing_provider_events as events
  set applied = true
  where events.stripe_livemode = p_stripe_livemode
    and events.stripe_account_id = v_account
    and events.provider_event_id = v_event_id;

  select public.mark_saas_billing_provider_event_processed(
    v_event_id, v_hash, v_account, p_stripe_livemode,
    p_processing_lease_token
  ) into v_processed_result;
  if v_processed_result is distinct from 'processed' then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_EVENT_FINALIZATION_FAILED';
  end if;

  return query select
    case when v_is_trial then 'trial_enrolled'::text
      else 'paid_enrollment_pending_invoice'::text end,
    v_attempt.store_id, v_customer.id, v_enrollment.id,
    v_is_trial, v_is_trial;
end;
$function$;

revoke all on function public.apply_verified_saas_checkout_completion(
  text, text, uuid, text, boolean, text, timestamptz,
  text, timestamptz, timestamptz, text, text, text, text, text, boolean,
  uuid, text, text, text, text, text, text,
  text, timestamptz, boolean,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  timestamptz, boolean, boolean, text, boolean,
  text, text, text, text, text, text,
  text, text, integer, boolean, boolean, boolean, boolean, bigint, text,
  text, integer, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_verified_saas_checkout_completion(
  text, text, uuid, text, boolean, text, timestamptz,
  text, timestamptz, timestamptz, text, text, text, text, text, boolean,
  uuid, text, text, text, text, text, text,
  text, timestamptz, boolean,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  timestamptz, boolean, boolean, text, boolean,
  text, text, text, text, text, text,
  text, text, integer, boolean, boolean, boolean, boolean, bigint, text,
  text, integer, text, text, text, text, text
) to service_role;

comment on function public.apply_verified_saas_checkout_completion(
  text, text, uuid, text, boolean, text, timestamptz,
  text, timestamptz, timestamptz, text, text, text, text, text, boolean,
  uuid, text, text, text, text, text, text,
  text, timestamptz, boolean,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  timestamptz, boolean, boolean, text, boolean,
  text, text, text, text, text, text,
  text, text, integer, boolean, boolean, boolean, boolean, bigint, text,
  text, integer, text, text, text, text, text
) is 'Service-only atomic application of one fenced, deferred, verified SaaS Checkout completion. It creates immutable enrollment authority and may establish one provider trial, but never writes paid-through access.';

-- Keep the canonical resolver as the only entitlement calculator while adding
-- the stricter provenance required for a verified Stripe trial. Existing paid,
-- grace, local-trial, complimentary, legacy, and hold branches are unchanged.
create or replace function public.resolve_store_entitlement(p_store_id uuid)
returns table (
  has_active_access boolean,
  effective_plan_key text,
  effective_billing_cadence text,
  access_reason text,
  access_until timestamptz,
  held boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_billing public.seller_billing_status%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_customer public.billing_customer_bindings%rowtype;
  v_price public.billing_provider_price_catalog%rowtype;
  v_trial public.billing_trial_claims%rowtype;
  v_paid_invoice public.billing_subscription_invoices%rowtype;
  v_grace_invoice public.billing_subscription_invoices%rowtype;
  v_held boolean := false;
  v_now timestamptz := statement_timestamp();
  v_valid boolean := false;
  v_binding_valid boolean := false;
  v_reason text := 'inactive';
  v_until timestamptz;
begin
  select stores.admin_hold_reason is not null
  into v_held
  from public.stores
  where stores.id = p_store_id;

  if not found then
    return query select false, null::text, null::text,
      'missing_store'::text, null::timestamptz, false;
    return;
  end if;

  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = p_store_id;

  if v_billing.id is null then
    return query select false, null::text, null::text,
      'missing_billing'::text, null::timestamptz, v_held;
    return;
  end if;

  if v_billing.current_subscription_enrollment_id is not null then
    select enrollment.* into v_enrollment
    from public.billing_subscription_enrollments as enrollment
    where enrollment.id = v_billing.current_subscription_enrollment_id
      and enrollment.store_id = p_store_id;

    if v_enrollment.id is not null then
      select binding.* into v_customer
      from public.billing_customer_bindings as binding
      where binding.id = v_enrollment.customer_binding_id;

      select price.* into v_price
      from public.billing_provider_price_catalog as price
      where price.stripe_price_id = v_enrollment.initial_stripe_price_id
        and price.stripe_livemode = v_enrollment.stripe_livemode
        and price.stripe_account_id = v_enrollment.stripe_account_id;
    end if;

    v_binding_valid := v_enrollment.id is not null
      and v_enrollment.is_current
      and v_customer.id is not null
      and v_customer.store_id = p_store_id
      and v_customer.id = v_enrollment.customer_binding_id
      and v_customer.stripe_livemode = v_enrollment.stripe_livemode
      and v_customer.stripe_account_id = v_enrollment.stripe_account_id
      and v_billing.billing_state_authority = 'stripe'
      and v_billing.stripe_customer_id = v_customer.stripe_customer_id
      and v_billing.stripe_subscription_id = v_enrollment.stripe_subscription_id
      and v_billing.stripe_price_id = v_enrollment.initial_stripe_price_id
      and v_billing.stripe_livemode = v_enrollment.stripe_livemode
      and v_billing.stripe_account_id = v_enrollment.stripe_account_id
      and v_price.stripe_price_id is not null
      and v_price.plan_key in ('small_flock', 'full_flock')
      and v_price.billing_cadence in ('monthly', 'yearly')
      and v_billing.plan_key = v_price.plan_key
      and v_billing.billing_plan = v_price.billing_cadence;

    if v_billing.subscription_status = 'suspended' then
      v_reason := 'suspended';
    elsif not v_binding_valid then
      v_reason := 'malformed';
    else
      select claim.* into v_trial
      from public.billing_trial_claims as claim
      where claim.store_id = p_store_id
        and claim.subscription_enrollment_id = v_enrollment.id;

      if v_enrollment.provider_status = 'trialing'
         and v_billing.subscription_status = 'trialing'
         and v_price.is_active
         and v_price.is_verified
         and v_trial.store_id is not null
         and v_trial.provider_event_id = v_enrollment.bound_by_event_id
         and v_enrollment.trial_started_at is not null
         and v_enrollment.trial_ends_at > v_enrollment.trial_started_at
         and v_trial.trial_started_at = v_enrollment.trial_started_at
         and v_trial.trial_ends_at = v_enrollment.trial_ends_at
         and v_billing.trial_started_at = v_enrollment.trial_started_at
         and v_billing.trial_ends_at = v_enrollment.trial_ends_at
         and v_billing.storefront_access_until = v_enrollment.trial_ends_at
         and v_now < v_enrollment.trial_ends_at then
        v_valid := true;
        v_reason := 'stripe_trial';
        v_until := v_enrollment.trial_ends_at;
      end if;

      if not v_valid and v_billing.last_paid_stripe_invoice_id is not null then
        select invoice.* into v_paid_invoice
        from public.billing_subscription_invoices as invoice
        where invoice.stripe_invoice_id = v_billing.last_paid_stripe_invoice_id
          and invoice.store_id = p_store_id
          and invoice.subscription_enrollment_id = v_enrollment.id
          and invoice.customer_binding_id = v_customer.id
          and invoice.stripe_customer_id = v_customer.stripe_customer_id
          and invoice.stripe_subscription_id = v_enrollment.stripe_subscription_id
          and invoice.stripe_price_id = v_enrollment.initial_stripe_price_id
          and invoice.stripe_livemode = v_enrollment.stripe_livemode
          and invoice.stripe_account_id = v_enrollment.stripe_account_id;

        if v_billing.paid_through_at is not null
           and v_now < v_billing.paid_through_at
           and v_paid_invoice.id is not null
           and v_paid_invoice.collection_method = 'charge_automatically'
           and v_paid_invoice.billing_reason in ('subscription_create', 'subscription_cycle')
           and v_paid_invoice.invoice_status = 'paid'
           and v_paid_invoice.amount_due_cents > 0
           and v_paid_invoice.amount_paid_cents > 0
           and v_paid_invoice.amount_remaining_cents = 0
           and v_paid_invoice.base_line_amount_cents > 0
           and v_paid_invoice.paid_at is not null
           and v_paid_invoice.paid_through_applied_at is not null
           and v_paid_invoice.service_period_end = v_billing.paid_through_at then
          v_valid := true;
          v_reason := case
            when v_billing.cancel_at_period_end then 'paid_canceling'
            else 'paid'
          end;
          v_until := v_billing.paid_through_at;
        end if;
      end if;

      if not v_valid and v_billing.grace_stripe_invoice_id is not null then
        select invoice.* into v_grace_invoice
        from public.billing_subscription_invoices as invoice
        where invoice.stripe_invoice_id = v_billing.grace_stripe_invoice_id
          and invoice.store_id = p_store_id
          and invoice.subscription_enrollment_id = v_enrollment.id
          and invoice.customer_binding_id = v_customer.id
          and invoice.stripe_customer_id = v_customer.stripe_customer_id
          and invoice.stripe_subscription_id = v_enrollment.stripe_subscription_id
          and invoice.stripe_price_id = v_enrollment.initial_stripe_price_id
          and invoice.stripe_livemode = v_enrollment.stripe_livemode
          and invoice.stripe_account_id = v_enrollment.stripe_account_id;

        if v_grace_invoice.id is not null
           and v_grace_invoice.grace_eligible
           and v_grace_invoice.paid_at is null
           and (
             v_grace_invoice.failure_at is not null
             or v_grace_invoice.action_required_at is not null
             or v_grace_invoice.finalization_failed_at is not null
           )
           and v_grace_invoice.grace_ends_at = v_billing.grace_ends_at
           and v_grace_invoice.last_provider_event_id = v_billing.grace_provider_event_id
           and v_grace_invoice.last_provider_event_created_at = v_billing.grace_provider_event_created_at
           and (
             (v_grace_invoice.billing_reason = 'subscription_create'
               and v_trial.store_id is not null
               and v_grace_invoice.grace_anchor_at = v_enrollment.trial_ends_at)
             or
             (v_grace_invoice.billing_reason = 'subscription_cycle'
               and v_billing.paid_through_at is not null
               and v_grace_invoice.grace_anchor_at = v_billing.paid_through_at)
           )
           and v_now >= v_grace_invoice.grace_anchor_at
           and v_now < v_grace_invoice.grace_ends_at then
          v_valid := true;
          v_reason := 'payment_grace';
          v_until := v_grace_invoice.grace_ends_at;
        elsif v_billing.grace_ends_at is not null and v_now >= v_billing.grace_ends_at then
          v_reason := 'payment_grace_expired';
        end if;
      end if;

      if not v_valid and v_reason = 'inactive' then
        v_reason := case
          when v_billing.subscription_status in (
            'past_due', 'unpaid', 'paused', 'canceled', 'dormant',
            'incomplete', 'incomplete_expired', 'suspended'
          ) then v_billing.subscription_status
          else 'unpaid'
        end;
      end if;
    end if;
  else
    if v_billing.subscription_status = 'trialing'
      and v_billing.billing_state_authority = 'trial'
      and v_billing.plan_key in ('small_flock', 'full_flock')
      and v_billing.billing_plan in ('monthly', 'yearly')
      and v_billing.requested_plan_key = v_billing.plan_key
      and v_billing.requested_billing_cadence = v_billing.billing_plan
      and v_billing.trial_started_at is not null
      and v_billing.trial_ends_at = v_billing.trial_started_at + interval '7 days'
      and v_billing.current_period_start = v_billing.trial_started_at
      and v_billing.storefront_access_until = v_billing.trial_ends_at
      and v_billing.current_period_end = v_billing.trial_ends_at
      and v_billing.trial_ends_at > v_now
      and v_billing.stripe_customer_id is null
      and v_billing.stripe_subscription_id is null
      and v_billing.comp_granted_at is null then
      v_valid := true;
      v_reason := 'trial';
      v_until := v_billing.trial_ends_at;
    elsif v_billing.subscription_status = 'active'
      and v_billing.billing_state_authority in ('stripe', 'legacy_stripe')
      and v_billing.plan_key in ('small_flock', 'full_flock')
      and v_billing.billing_plan in ('monthly', 'yearly')
      and nullif(trim(v_billing.stripe_customer_id), '') is not null
      and nullif(trim(v_billing.stripe_subscription_id), '') is not null
      and v_billing.current_period_end is not null
      and v_billing.storefront_access_until = v_billing.current_period_end
      and v_billing.storefront_access_until > v_now
      and (
        v_billing.billing_state_authority = 'legacy_stripe'
        or (
          v_billing.current_period_start is not null
          and v_billing.current_period_end > v_billing.current_period_start
          and nullif(trim(v_billing.stripe_price_id), '') is not null
          and nullif(trim(v_billing.last_provider_event_id), '') is not null
          and v_billing.last_provider_event_created_at is not null
          and exists (
            select 1 from public.billing_provider_price_catalog as price
            where price.stripe_price_id = v_billing.stripe_price_id
              and price.stripe_livemode = v_billing.stripe_livemode
              and price.stripe_account_id = coalesce(v_billing.stripe_account_id, '')
              and price.plan_key = v_billing.plan_key
              and price.billing_cadence = v_billing.billing_plan
          )
        )
      ) then
      v_valid := true;
      v_reason := case when v_billing.cancel_at_period_end then 'paid_canceling' else 'paid' end;
      v_until := v_billing.storefront_access_until;
    elsif v_billing.subscription_status = 'comped'
      and v_billing.billing_state_authority = 'admin_comp'
      and v_billing.plan_key in ('small_flock', 'full_flock')
      and v_billing.billing_plan = 'comped'
      and v_billing.comp_granted_by_user_id is not null
      and nullif(trim(v_billing.comp_grant_reason), '') is not null
      and v_billing.comp_granted_at is not null
      and v_billing.comp_access_until is not null
      and v_billing.comp_access_until > v_billing.comp_granted_at
      and v_billing.storefront_access_until = v_billing.comp_access_until
      and v_billing.comp_access_until > v_now
      and v_billing.comp_revoked_at is null
      and v_billing.stripe_customer_id is null
      and v_billing.stripe_subscription_id is null then
      v_valid := true;
      v_reason := 'admin_comp';
      v_until := v_billing.comp_access_until;
    else
      v_reason := case
        when v_billing.subscription_status in (
          'past_due', 'unpaid', 'paused', 'canceled', 'dormant',
          'incomplete', 'incomplete_expired', 'suspended'
        ) then v_billing.subscription_status
        when v_billing.billing_state_authority = 'legacy_unclassified' then 'unclassified'
        else 'malformed'
      end;
    end if;
  end if;

  if v_held then
    return query select false, null::text, null::text,
      'administrative_hold'::text, v_until, true;
  elsif v_valid then
    return query select true, v_billing.plan_key,
      case when v_billing.billing_plan in ('monthly', 'yearly')
        then v_billing.billing_plan else null end,
      v_reason, v_until, false;
  else
    return query select false, null::text, null::text, v_reason, v_until, false;
  end if;
end;
$function$;

comment on function public.resolve_store_entitlement(uuid) is
'Canonical timestamp-aware entitlement resolver. Verified Stripe trial access additionally requires an active verified Price, immutable same-store bindings, matching provider trial provenance, and a durable trial claim; paid access remains invoice-backed.';

-- Deployment of this migration must never activate Checkout or Portal access.
update public.platform_settings
set boolean_value = false,
    updated_by_user_id = null
where setting_key in (
  'saas_subscription_checkout_enabled', 'saas_billing_portal_enabled'
);

commit;
