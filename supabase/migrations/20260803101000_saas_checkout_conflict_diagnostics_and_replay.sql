-- Precise verified Checkout-enrollment conflicts and a narrow failed-event replay.
--
-- This migration does not reopen arbitrary provider events. It permits one
-- service-role reconciliation lease only for a signature-verified,
-- checkout.session.completed event that failed before creating any immutable
-- Customer, Subscription, or trial authority.

begin;

alter function public.apply_verified_saas_checkout_completion(
  text, text, uuid, text, boolean, text, timestamptz,
  text, timestamptz, timestamptz, text, text, text, text, text, boolean,
  uuid, text, text, text, text, text, text,
  text, timestamptz, boolean,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  timestamptz, boolean, boolean, text, boolean,
  text, text, text, text, text, text,
  text, text, integer, boolean, boolean, boolean, boolean, bigint, text,
  text, integer, text, text, text, text, text
) rename to apply_verified_saas_checkout_completion_transactional_v1;

revoke all on function public.apply_verified_saas_checkout_completion_transactional_v1(
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
  v_event_id text := btrim(p_provider_event_id);
  v_hash text := lower(btrim(p_payload_hash));
  v_account text := btrim(p_stripe_account_id);
  v_environment text := btrim(p_environment_id);
  v_session_id text := btrim(p_checkout_session_id);
  v_customer_id text := btrim(p_stripe_customer_id);
  v_subscription_id text := btrim(p_stripe_subscription_id);
  v_price_id text := btrim(p_stripe_price_id);
  v_product_id text := btrim(p_stripe_product_id);
  v_event public.billing_provider_events%rowtype;
  v_attempt public.billing_checkout_attempts%rowtype;
  v_store public.stores%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_onboarding public.seller_onboarding_state%rowtype;
  v_catalog public.billing_provider_price_catalog%rowtype;
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
     or coalesce(v_session_id, '') !~ '^cs_(test|live)_[A-Za-z0-9]+$'
     or coalesce(v_customer_id, '') !~ '^cus_[A-Za-z0-9]+$'
     or coalesce(v_subscription_id, '') !~ '^sub_[A-Za-z0-9]+$'
     or coalesce(v_price_id, '') !~ '^price_[A-Za-z0-9]+$'
     or coalesce(v_product_id, '') !~ '^prod_[A-Za-z0-9]+$'
     or p_attempt_id is null then
    raise exception using errcode = '22023',
      message = 'SAAS_ENROLLMENT_EVIDENCE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-provider-event:' || v_event_id, 0)
  );
  select events.* into v_event
  from public.billing_provider_events as events
  where events.provider_event_id = v_event_id
  order by events.created_at
  limit 1
  for update;

  if v_event.provider_event_id is null
     or v_event.payload_hash is distinct from v_hash
     or v_event.event_type is distinct from 'checkout.session.completed'
     or v_event.provider_object_type is distinct from 'checkout.session'
     or v_event.provider_object_id is distinct from v_session_id
     or v_event.provider_event_created_at is distinct from
       p_provider_event_created_at
     or v_event.processing_status is distinct from 'processing'
     or v_event.deferred_reason is distinct from
       'awaiting_verified_enrollment_batch'
     or v_event.processing_lease_token is distinct from
       p_processing_lease_token
     or v_event.processing_lease_expires_at is null
     or v_event.processing_lease_expires_at <= statement_timestamp()
     or v_event.applied then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_EVENT_FENCE_CONFLICT';
  end if;
  if v_event.stripe_account_id is distinct from v_account then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_ACCOUNT_MISMATCH';
  end if;
  if v_event.stripe_livemode is distinct from p_stripe_livemode then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_LIVEMODE_MISMATCH';
  end if;
  if v_event.processing_environment_id is distinct from v_environment then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_ENVIRONMENT_MISMATCH';
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
  if v_attempt.attempt_status not in ('open', 'completed', 'pending_confirmation') then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_ATTEMPT_STATE_MISMATCH';
  end if;
  if v_attempt.stripe_checkout_session_id is distinct from v_session_id then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_SESSION_ID_MISMATCH';
  end if;
  if p_session_created_at is null or p_session_expires_at is null
     or p_session_expires_at <= p_session_created_at
     or v_attempt.session_created_at is distinct from p_session_created_at
     or v_attempt.session_expires_at is distinct from p_session_expires_at
     or p_provider_event_created_at < p_session_created_at
     or p_provider_event_created_at > p_session_expires_at then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_SESSION_TIMESTAMP_MISMATCH';
  end if;
  if v_attempt.stripe_price_id is distinct from v_price_id then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_PRICE_MISMATCH';
  end if;
  if v_attempt.stripe_product_id is distinct from v_product_id then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_PRODUCT_MISMATCH';
  end if;
  if v_attempt.stripe_account_id is distinct from v_account then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_ACCOUNT_MISMATCH';
  end if;
  if v_attempt.stripe_livemode is distinct from p_stripe_livemode
     or p_session_livemode is distinct from p_stripe_livemode
     or p_customer_livemode is distinct from p_stripe_livemode
     or p_subscription_livemode is distinct from p_stripe_livemode
     or p_price_livemode is distinct from p_stripe_livemode
     or p_product_livemode is distinct from p_stripe_livemode then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_LIVEMODE_MISMATCH';
  end if;
  if v_attempt.checkout_environment_id is distinct from v_environment
     or p_session_metadata_environment_id is distinct from v_environment
     or p_subscription_metadata_environment_id is distinct from v_environment then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_ENVIRONMENT_MISMATCH';
  end if;
  if (v_attempt.stripe_customer_id is not null and
      v_attempt.stripe_customer_id is distinct from v_customer_id)
     or p_stripe_customer_id is distinct from v_customer_id then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_CUSTOMER_MISMATCH';
  end if;
  if v_attempt.stripe_subscription_id is not null and
     v_attempt.stripe_subscription_id is distinct from v_subscription_id then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_SUBSCRIPTION_MISMATCH';
  end if;

  if p_session_client_reference_id is distinct from v_attempt.id::text
     or p_session_metadata_attempt_id is distinct from v_attempt.id::text
     or p_session_metadata_store_id is distinct from v_attempt.store_id::text
     or p_session_metadata_schema_version is distinct from 'ff_saas_checkout_v1' then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_SESSION_METADATA_MISMATCH';
  end if;
  if p_subscription_metadata_attempt_id is distinct from v_attempt.id::text
     or p_subscription_metadata_store_id is distinct from v_attempt.store_id::text
     or p_subscription_metadata_schema_version is distinct from
       'ff_saas_checkout_v1' then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_SUBSCRIPTION_METADATA_MISMATCH';
  end if;
  if p_session_metadata_plan_key is distinct from v_attempt.requested_plan_key
     or p_subscription_metadata_plan_key is distinct from
       v_attempt.requested_plan_key then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_PLAN_MISMATCH';
  end if;
  if p_session_metadata_billing_cadence is distinct from
       v_attempt.requested_billing_cadence
     or p_subscription_metadata_billing_cadence is distinct from
       v_attempt.requested_billing_cadence then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_CADENCE_MISMATCH';
  end if;

  if p_session_status is distinct from 'complete'
     or p_session_mode is distinct from 'subscription'
     or p_session_payment_method_collection is distinct from 'always' then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_SESSION_STATE_MISMATCH';
  end if;
  if p_subscription_collection_method is distinct from 'charge_automatically' then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_PROVIDER_SHAPE_INVALID';
  end if;
  if p_payment_method_ready is distinct from true then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_PAYMENT_METHOD_NOT_READY';
  end if;
  if p_subscription_created_at is null
     or p_customer_created_at is null
     or p_subscription_created_at < p_session_created_at
     or p_subscription_created_at > p_provider_event_created_at
     or p_subscription_current_period_start is null
     or p_subscription_current_period_end is null
     or p_subscription_current_period_end <= p_subscription_current_period_start then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_SUBSCRIPTION_TIMESTAMP_MISMATCH';
  end if;

  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = v_attempt.store_id
  for update;
  select stores.* into v_store
  from public.stores as stores
  where stores.id = v_attempt.store_id
  for update;
  select onboarding.* into v_onboarding
  from public.seller_onboarding_state as onboarding
  where onboarding.store_id = v_attempt.store_id
  for update;
  if v_store.id is null or v_billing.id is null or v_onboarding.id is null
     or not v_onboarding.profile_complete
     or v_store.admin_hold_reason is not null then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_BILLING_STATE_CONFLICT';
  end if;
  if v_billing.current_subscription_enrollment_id is not null
     or exists (
       select 1 from public.billing_subscription_enrollments as enrollments
       where enrollments.store_id = v_attempt.store_id
         and (enrollments.is_current or enrollments.ended_at is null)
     ) then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_SUBSCRIPTION_BINDING_CONFLICT';
  end if;
  select catalog.* into v_catalog
  from public.billing_provider_price_catalog as catalog
  where catalog.plan_key = v_attempt.requested_plan_key
    and catalog.billing_cadence = v_attempt.requested_billing_cadence
    and catalog.stripe_account_id = v_account
    and catalog.stripe_livemode = p_stripe_livemode
  for share;

  if v_catalog.stripe_price_id is null or not v_catalog.is_active
     or not v_catalog.is_verified then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_CATALOG_VALIDATION_FAILED';
  end if;
  if v_catalog.stripe_price_id is distinct from v_price_id then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_PRICE_MISMATCH';
  end if;
  if v_catalog.stripe_product_id is distinct from v_product_id then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_PRODUCT_MISMATCH';
  end if;
  if v_billing.requested_plan_key is distinct from v_catalog.plan_key then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_PLAN_MISMATCH';
  end if;
  if v_billing.requested_billing_cadence is distinct from
     v_catalog.billing_cadence then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_CADENCE_MISMATCH';
  end if;
  if v_catalog.unit_amount_cents is distinct from p_unit_amount_cents
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
     or p_line_item_quantity is distinct from 1
     or p_price_active is distinct from true
     or p_product_active is distinct from true then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_CATALOG_VALIDATION_FAILED';
  end if;

  if v_attempt.trial_eligibility not in (
    'trial_eligible', 'trial_already_used'
  ) then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_TRIAL_DECISION_INVALID';
  end if;
  if v_attempt.trial_eligibility = 'trial_eligible' then
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
       or v_billing.storefront_access_until is not null then
      raise exception using errcode = '55000',
        message = 'SAAS_ENROLLMENT_BILLING_STATE_CONFLICT';
    end if;
    if p_subscription_status is distinct from 'trialing'
       or p_session_payment_status is distinct from 'no_payment_required' then
      raise exception using errcode = '55000',
        message = 'SAAS_ENROLLMENT_TRIAL_STATE_MISMATCH';
    end if;
    if p_subscription_trial_start is null or p_subscription_trial_end is null
       or p_subscription_trial_end <= p_subscription_trial_start
       or p_subscription_current_period_start is distinct from
         p_subscription_trial_start
       or p_subscription_current_period_end is distinct from
         p_subscription_trial_end then
      raise exception using errcode = '55000',
        message = 'SAAS_ENROLLMENT_TRIAL_TIMESTAMP_MISMATCH';
    end if;
    if p_subscription_trial_end - p_subscription_trial_start >
       interval '7 days 5 minutes' then
      raise exception using errcode = '55000',
        message = 'SAAS_ENROLLMENT_TRIAL_DURATION_VIOLATION';
    end if;
    if exists (
      select 1 from public.billing_trial_claims as claims
      where claims.store_id = v_attempt.store_id
    ) or exists (
      select 1 from public.billing_subscription_enrollments as enrollments
      where enrollments.store_id = v_attempt.store_id
        and (enrollments.trial_started_at is not null
          or enrollments.trial_ends_at is not null)
    ) then
      raise exception using errcode = '55000',
        message = 'SAAS_ENROLLMENT_PRIOR_TRIAL_CONFLICT';
    end if;
  else
    if v_billing.billing_state_authority is distinct from 'trial'
       or v_billing.subscription_status is distinct from 'trialing'
       or v_billing.trial_started_at is null
       or v_billing.trial_ends_at is null
       or v_billing.trial_ends_at > statement_timestamp()
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

  if exists (
    select 1 from public.billing_customer_bindings as bindings
    where bindings.stripe_livemode = p_stripe_livemode
      and bindings.stripe_account_id = v_account
      and (bindings.store_id = v_attempt.store_id
        or bindings.stripe_customer_id = v_customer_id)
      and (bindings.store_id is distinct from v_attempt.store_id
        or bindings.stripe_customer_id is distinct from v_customer_id
        or bindings.provider_created_at is distinct from p_customer_created_at)
  ) then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_CUSTOMER_BINDING_CONFLICT';
  end if;
  if exists (
    select 1 from public.billing_subscription_enrollments as enrollments
    where (enrollments.stripe_livemode = p_stripe_livemode
      and enrollments.stripe_account_id = v_account
      and enrollments.stripe_subscription_id = v_subscription_id)
      or enrollments.checkout_attempt_id = v_attempt.id
  ) then
    raise exception using errcode = '55000',
      message = 'SAAS_ENROLLMENT_SUBSCRIPTION_BINDING_CONFLICT';
  end if;

  return query
  select * from public.apply_verified_saas_checkout_completion_transactional_v1(
    p_provider_event_id, p_payload_hash, p_processing_lease_token,
    p_stripe_account_id, p_stripe_livemode, p_environment_id,
    p_provider_event_created_at, p_checkout_session_id, p_session_created_at,
    p_session_expires_at, p_session_status, p_session_mode,
    p_session_payment_status, p_session_payment_method_collection,
    p_session_client_reference_id, p_session_livemode, p_attempt_id,
    p_session_metadata_attempt_id, p_session_metadata_store_id,
    p_session_metadata_environment_id, p_session_metadata_plan_key,
    p_session_metadata_billing_cadence, p_session_metadata_schema_version,
    p_stripe_customer_id, p_customer_created_at, p_customer_livemode,
    p_stripe_subscription_id, p_subscription_status,
    p_subscription_created_at, p_subscription_trial_start,
    p_subscription_trial_end, p_subscription_current_period_start,
    p_subscription_current_period_end, p_subscription_cancel_at_period_end,
    p_subscription_livemode, p_subscription_collection_method,
    p_payment_method_ready, p_subscription_metadata_attempt_id,
    p_subscription_metadata_store_id, p_subscription_metadata_environment_id,
    p_subscription_metadata_plan_key,
    p_subscription_metadata_billing_cadence,
    p_subscription_metadata_schema_version, p_stripe_price_id,
    p_stripe_product_id, p_line_item_quantity, p_price_livemode,
    p_product_livemode, p_price_active, p_product_active,
    p_unit_amount_cents, p_currency, p_recurring_interval,
    p_recurring_interval_count, p_stripe_price_type, p_billing_scheme,
    p_recurring_usage_type, p_tax_behavior, p_stripe_product_tax_code
  );
end;
$function$;

create function public.get_failed_saas_checkout_completion_replay_state(
  p_provider_event_id text
)
returns table (
  provider_event_id text,
  payload_hash text,
  stripe_account_id text,
  stripe_livemode boolean,
  processing_environment_id text,
  event_type text,
  provider_object_type text,
  provider_object_id text,
  provider_event_created_at timestamptz,
  processing_status text,
  last_error_code text,
  attempt_status text,
  customer_binding_exists boolean,
  subscription_enrollment_exists boolean,
  trial_claim_exists boolean,
  lifecycle_state text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_attempt public.billing_checkout_attempts%rowtype;
  v_entitlement record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  select events.* into v_event
  from public.billing_provider_events as events
  where events.provider_event_id = btrim(p_provider_event_id)
    and events.event_type = 'checkout.session.completed'
    and events.provider_object_type = 'checkout.session';
  if v_event.provider_event_id is null then return; end if;
  select attempts.* into v_attempt
  from public.billing_checkout_attempts as attempts
  where attempts.stripe_checkout_session_id = v_event.provider_object_id
    and attempts.stripe_account_id = v_event.stripe_account_id
    and attempts.stripe_livemode = v_event.stripe_livemode
  order by attempts.created_at
  limit 1;
  if v_attempt.store_id is not null then
    select * into v_entitlement
    from public.resolve_store_entitlement(v_attempt.store_id);
  end if;
  return query select
    v_event.provider_event_id, v_event.payload_hash,
    v_event.stripe_account_id, v_event.stripe_livemode,
    v_event.processing_environment_id, v_event.event_type,
    v_event.provider_object_type, v_event.provider_object_id,
    v_event.provider_event_created_at, v_event.processing_status,
    v_event.last_error_code, v_attempt.attempt_status,
    exists (
      select 1 from public.billing_customer_bindings as bindings
      where bindings.store_id = v_attempt.store_id
    ),
    exists (
      select 1 from public.billing_subscription_enrollments as enrollments
      where enrollments.store_id = v_attempt.store_id
    ),
    exists (
      select 1 from public.billing_trial_claims as claims
      where claims.store_id = v_attempt.store_id
    ),
    case
      when coalesce(v_entitlement.has_active_access, false)
        then coalesce(v_entitlement.access_reason, 'active')
      when v_attempt.attempt_status = 'enrolled' then 'enrolled_inactive'
      when v_attempt.attempt_status in ('open', 'completed', 'pending_confirmation')
        then 'checkout_in_progress'
      else 'inactive'
    end;
end;
$function$;

create function public.claim_failed_saas_checkout_completion_replay(
  p_provider_event_id text,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_environment_id text,
  p_event_type text,
  p_provider_object_type text,
  p_provider_object_id text
)
returns table (
  replay_state text,
  attempt_count integer,
  processing_lease_token uuid,
  lease_expires_at timestamptz,
  conflict_code text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_attempt public.billing_checkout_attempts%rowtype;
  v_now timestamptz := statement_timestamp();
  v_token uuid := gen_random_uuid();
  v_lease timestamptz := statement_timestamp() + interval '5 minutes';
  v_replayable_codes constant text[] := array[
    'checkout_completion_binding_conflict',
    'checkout_attempt_state_mismatch', 'checkout_session_id_mismatch',
    'checkout_session_state_mismatch', 'checkout_session_timestamp_mismatch',
    'checkout_session_metadata_mismatch',
    'checkout_subscription_metadata_mismatch', 'checkout_customer_mismatch',
    'checkout_subscription_mismatch', 'checkout_price_mismatch',
    'checkout_product_mismatch', 'checkout_plan_mismatch',
    'checkout_cadence_mismatch', 'checkout_account_mismatch',
    'checkout_mode_mismatch', 'checkout_environment_mismatch',
    'checkout_subscription_timestamp_mismatch',
    'checkout_trial_timestamp_mismatch', 'checkout_trial_duration_violation',
    'checkout_payment_method_not_ready', 'checkout_catalog_validation_failed',
    'checkout_prior_trial_conflict', 'checkout_trial_state_mismatch',
    'checkout_trial_used_conflict',
    'checkout_customer_binding_conflict',
    'checkout_subscription_enrollment_conflict',
    'checkout_event_fence_conflict', 'checkout_billing_state_conflict',
    'checkout_metadata_conflict', 'checkout_trial_decision_invalid',
    'checkout_provider_shape_invalid', 'checkout_evidence_invalid',
    'checkout_event_finalization_failed'
  ];
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if btrim(p_provider_event_id) !~ '^evt_[A-Za-z0-9]+$'
     or lower(btrim(p_payload_hash)) !~ '^[0-9a-f]{64}$'
     or btrim(p_stripe_account_id) !~ '^acct_[A-Za-z0-9]+$'
     or p_stripe_livemode is null
     or btrim(p_environment_id) not in (
       'local', 'development', 'test', 'preview', 'staging', 'production'
     )
     or btrim(p_event_type) <> 'checkout.session.completed'
     or btrim(p_provider_object_type) <> 'checkout.session'
     or btrim(p_provider_object_id) !~ '^cs_(test|live)_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023',
      message = 'SAAS_CHECKOUT_REPLAY_IDENTITY_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'saas-provider-event:' || btrim(p_provider_event_id), 0
    )
  );
  select events.* into v_event
  from public.billing_provider_events as events
  where events.provider_event_id = btrim(p_provider_event_id)
  order by events.created_at
  limit 1
  for update;
  if v_event.provider_event_id is null then
    return query select 'not_found'::text, 0, null::uuid,
      null::timestamptz, null::text;
    return;
  end if;
  if v_event.payload_hash is distinct from lower(btrim(p_payload_hash))
     or v_event.stripe_account_id is distinct from btrim(p_stripe_account_id)
     or v_event.stripe_livemode is distinct from p_stripe_livemode
     or v_event.processing_environment_id is distinct from btrim(p_environment_id)
     or v_event.event_type is distinct from btrim(p_event_type)
     or v_event.provider_object_type is distinct from btrim(p_provider_object_type)
     or v_event.provider_object_id is distinct from btrim(p_provider_object_id) then
    insert into public.billing_provider_event_audits (
      stripe_livemode, stripe_account_id, provider_event_id,
      audit_type, result_code, attempt_count
    ) values (
      v_event.stripe_livemode, v_event.stripe_account_id,
      v_event.provider_event_id, 'provider_event_conflict',
      'checkout_replay_identity_conflict', v_event.attempt_count
    );
    return query select 'conflict'::text, v_event.attempt_count,
      null::uuid, null::timestamptz, 'checkout_replay_identity_conflict'::text;
    return;
  end if;
  if v_event.processing_status = 'processed' or v_event.applied then
    return query select 'already_processed'::text, v_event.attempt_count,
      null::uuid, null::timestamptz, null::text;
    return;
  end if;
  if v_event.processing_status = 'processing'
     and v_event.processing_lease_expires_at > v_now then
    return query select 'in_progress'::text, v_event.attempt_count,
      null::uuid, v_event.processing_lease_expires_at,
      v_event.last_error_code;
    return;
  end if;
  if v_event.processing_status <> 'failed'
     or v_event.failure_retryable is distinct from false
     or v_event.deferred_reason is distinct from
       'awaiting_verified_enrollment_batch'
     or not (v_event.last_error_code = any(v_replayable_codes)) then
    return query select 'not_replayable'::text, v_event.attempt_count,
      null::uuid, null::timestamptz, v_event.last_error_code;
    return;
  end if;
  select attempts.* into v_attempt
  from public.billing_checkout_attempts as attempts
  where attempts.stripe_checkout_session_id = v_event.provider_object_id
    and attempts.stripe_account_id = v_event.stripe_account_id
    and attempts.stripe_livemode = v_event.stripe_livemode
  order by attempts.created_at
  limit 1
  for update;
  if v_attempt.id is null
     or v_attempt.attempt_status not in ('open', 'completed', 'pending_confirmation')
     or exists (
       select 1 from public.billing_customer_bindings as bindings
       where bindings.store_id = v_attempt.store_id
     )
     or exists (
       select 1 from public.billing_subscription_enrollments as enrollments
       where enrollments.store_id = v_attempt.store_id
         or enrollments.checkout_attempt_id = v_attempt.id
     )
     or exists (
       select 1 from public.billing_trial_claims as claims
       where claims.store_id = v_attempt.store_id
     ) then
    return query select 'authority_already_exists'::text,
      v_event.attempt_count, null::uuid, null::timestamptz,
      'checkout_replay_authority_conflict'::text;
    return;
  end if;
  update public.billing_provider_events as events
  set processing_status = 'processing',
      processing_started_at = v_now,
      processing_lease_expires_at = v_lease,
      processing_lease_token = v_token,
      failed_at = null,
      failure_retryable = null,
      last_error_message = null,
      attempt_count = events.attempt_count + 1
  where events.stripe_livemode = v_event.stripe_livemode
    and events.stripe_account_id = v_event.stripe_account_id
    and events.provider_event_id = v_event.provider_event_id
  returning events.* into v_event;
  insert into public.billing_provider_event_audits (
    stripe_livemode, stripe_account_id, provider_event_id,
    audit_type, result_code, attempt_count
  ) values (
    v_event.stripe_livemode, v_event.stripe_account_id,
    v_event.provider_event_id, 'provider_event_reconciliation_claimed',
    'checkout_conflict_replay_claimed', v_event.attempt_count
  );
  return query select 'claimed'::text, v_event.attempt_count,
    v_token, v_lease, v_event.last_error_code;
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

revoke all on function public.get_failed_saas_checkout_completion_replay_state(text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_failed_saas_checkout_completion_replay(
  text, text, text, boolean, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.get_failed_saas_checkout_completion_replay_state(text)
  to service_role;
grant execute on function public.claim_failed_saas_checkout_completion_replay(
  text, text, text, boolean, text, text, text, text
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
) is 'Service-only atomic verified Checkout application with locked, stable, sanitized conflict classification.';
comment on function public.claim_failed_saas_checkout_completion_replay(
  text, text, text, boolean, text, text, text, text
) is 'Service-only narrow replay lease for a failed, verified checkout.session.completed event with no resulting billing authority.';

-- Diagnostics and replay never activate seller-facing Stripe functionality.
update public.platform_settings
set boolean_value = false
where setting_key in (
  'saas_subscription_checkout_enabled', 'saas_billing_portal_enabled'
);

commit;
