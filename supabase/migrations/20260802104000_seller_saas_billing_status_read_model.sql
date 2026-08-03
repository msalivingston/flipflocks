-- Seller-facing SaaS billing status read model.
--
-- This migration exposes a narrow, owner-only presentation projection of the
-- existing authoritative billing resolver. It does not create billing
-- authority, apply provider events, or enable Checkout or Portal behavior.

begin;

create or replace function public.seller_get_saas_billing_status()
returns table (
  lifecycle_state text,
  checkout_enabled boolean,
  portal_enabled boolean,
  requested_plan_key text,
  requested_billing_cadence text,
  effective_plan_key text,
  effective_billing_cadence text,
  billing_authority text,
  subscription_status text,
  entitlement_reason text,
  has_active_access boolean,
  entitlement_access_until timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  paid_through_at timestamptz,
  grace_ends_at timestamptz,
  payment_failure_started_at timestamptz,
  payment_action_required_at timestamptz,
  cancel_at_period_end boolean,
  current_period_end timestamptz,
  storefront_access_until timestamptz,
  billing_complete boolean,
  checkout_attempt_status text,
  checkout_attempt_expires_at timestamptz,
  resumable_checkout boolean,
  trial_eligibility text,
  customer_binding_exists boolean,
  current_enrollment_exists boolean,
  latest_invoice_status text,
  malformed_or_unclassified boolean,
  administrative_hold boolean,
  complimentary_access_ends_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_onboarding public.seller_onboarding_state%rowtype;
  v_entitlement record;
  v_attempt public.billing_checkout_attempts%rowtype;
  v_checkout_enabled boolean := false;
  v_portal_enabled boolean := false;
  v_customer_exists boolean := false;
  v_enrollment_exists boolean := false;
  v_malformed boolean := false;
  v_lifecycle text := 'unknown';
  v_now timestamptz := statement_timestamp();
begin
  if coalesce(auth.role(), '') <> 'authenticated' or v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  -- The ordinary seller path is owner-only. Platform administrators cannot
  -- use this function to impersonate a seller or enumerate another store.
  select stores.*
  into v_store
  from public.stores as stores
  where stores.owner_user_id = v_user_id
  order by stores.created_at, stores.id
  limit 1;

  if v_store.id is null then
    return;
  end if;

  select status.*
  into v_billing
  from public.seller_billing_status as status
  where status.store_id = v_store.id;

  select onboarding.*
  into v_onboarding
  from public.seller_onboarding_state as onboarding
  where onboarding.store_id = v_store.id;

  select *
  into v_entitlement
  from public.resolve_store_entitlement(v_store.id);

  select attempts.*
  into v_attempt
  from public.billing_checkout_attempts as attempts
  where attempts.store_id = v_store.id
  order by attempts.created_at desc, attempts.id desc
  limit 1;

  select coalesce(settings.boolean_value, false)
  into v_checkout_enabled
  from public.platform_settings as settings
  where settings.setting_key = 'saas_subscription_checkout_enabled';

  select coalesce(settings.boolean_value, false)
  into v_portal_enabled
  from public.platform_settings as settings
  where settings.setting_key = 'saas_billing_portal_enabled';

  if v_billing.current_subscription_enrollment_id is not null then
    select exists (
      select 1
      from public.billing_subscription_enrollments as enrollment
      where enrollment.id = v_billing.current_subscription_enrollment_id
        and enrollment.store_id = v_store.id
        and enrollment.is_current
    ) into v_enrollment_exists;
  end if;

  select exists (
    select 1
    from public.billing_customer_bindings as binding
    where binding.store_id = v_store.id
  ) into v_customer_exists;

  v_malformed := coalesce(v_entitlement.access_reason, 'missing_billing') in (
    'malformed', 'unclassified', 'missing_store'
  ) or v_billing.billing_state_authority = 'legacy_unclassified';

  -- Lifecycle is presentation only. Entitlement remains exclusively defined
  -- by resolve_store_entitlement and the underlying verified evidence.
  if v_store.admin_hold_reason is not null
     or coalesce(v_entitlement.held, false)
     or v_billing.subscription_status = 'suspended' then
    v_lifecycle := 'administrative_hold';
  elsif v_billing.billing_state_authority = 'admin_comp'
        and coalesce(v_entitlement.has_active_access, false) then
    v_lifecycle := 'complimentary_access';
  elsif v_billing.id is null then
    v_lifecycle := 'selection_required';
  elsif v_malformed then
    v_lifecycle := 'unknown';
  elsif coalesce(v_entitlement.access_reason, '') = 'payment_grace' then
    v_lifecycle := 'payment_grace';
  elsif coalesce(v_entitlement.access_reason, '') = 'payment_grace_expired' then
    v_lifecycle := 'suspended_nonpayment';
  elsif coalesce(v_entitlement.access_reason, '') in ('stripe_trial', 'trial') then
    if v_billing.payment_failure_started_at is not null
       or v_billing.payment_action_required_at is not null then
      v_lifecycle := 'trial_payment_problem';
    else
      v_lifecycle := 'trial_active';
    end if;
  elsif coalesce(v_entitlement.access_reason, '') in ('paid', 'paid_canceling') then
    if v_billing.payment_failure_started_at is not null
       or v_billing.payment_action_required_at is not null then
      v_lifecycle := 'payment_failed_paid_through';
    elsif v_billing.cancel_at_period_end then
      v_lifecycle := 'canceling_at_period_end';
    else
      v_lifecycle := 'active_paid';
    end if;
  elsif v_billing.subscription_status = 'canceled'
        and not coalesce(v_entitlement.has_active_access, false) then
    v_lifecycle := 'fully_canceled';
  elsif v_enrollment_exists
        and not coalesce(v_entitlement.has_active_access, false)
        and not coalesce(v_onboarding.billing_complete, false) then
    v_lifecycle := 'payment_pending_no_trial';
  elsif v_attempt.attempt_status in ('completed', 'pending_confirmation') then
    v_lifecycle := 'awaiting_stripe_confirmation';
  elsif v_attempt.attempt_status in ('creating', 'open') then
    v_lifecycle := 'checkout_in_progress';
  elsif v_attempt.attempt_status in ('expired', 'failed', 'superseded')
        and not coalesce(v_entitlement.has_active_access, false) then
    v_lifecycle := 'checkout_canceled';
  elsif v_billing.billing_state_authority = 'pending_checkout'
        and v_billing.requested_plan_key is not null
        and v_billing.requested_billing_cadence is not null then
    v_lifecycle := 'checkout_required';
  elsif v_billing.requested_plan_key is null then
    v_lifecycle := 'selection_required';
  else
    v_lifecycle := 'unknown';
  end if;

  return query select
    v_lifecycle,
    coalesce(v_checkout_enabled, false),
    coalesce(v_portal_enabled, false),
    v_billing.requested_plan_key,
    v_billing.requested_billing_cadence,
    v_entitlement.effective_plan_key,
    v_entitlement.effective_billing_cadence,
    v_billing.billing_state_authority,
    v_billing.subscription_status,
    v_entitlement.access_reason,
    coalesce(v_entitlement.has_active_access, false),
    v_entitlement.access_until,
    v_billing.trial_started_at,
    v_billing.trial_ends_at,
    v_billing.paid_through_at,
    v_billing.grace_ends_at,
    v_billing.payment_failure_started_at,
    v_billing.payment_action_required_at,
    coalesce(v_billing.cancel_at_period_end, false),
    v_billing.current_period_end,
    v_billing.storefront_access_until,
    coalesce(v_onboarding.billing_complete, false),
    v_attempt.attempt_status,
    v_attempt.session_expires_at,
    coalesce(
      v_attempt.attempt_status = 'open'
      and v_attempt.stripe_checkout_session_id is not null
      and v_attempt.session_expires_at > v_now,
      false
    ),
    coalesce(
      v_attempt.trial_eligibility,
      case when
        v_billing.trial_started_at is not null
        or v_billing.trial_ends_at is not null
        or v_billing.billing_state_authority = 'trial'
        or exists (
          select 1 from public.billing_trial_claims as claim
          where claim.store_id = v_store.id
        )
        or exists (
          select 1 from public.billing_subscription_enrollments as enrollment
          where enrollment.store_id = v_store.id
            and enrollment.trial_started_at is not null
            and enrollment.trial_ends_at is not null
        )
      then 'trial_already_used' else 'trial_eligible' end
    ),
    v_customer_exists,
    v_enrollment_exists,
    v_billing.latest_invoice_status,
    v_malformed,
    v_store.admin_hold_reason is not null or coalesce(v_entitlement.held, false),
    case when v_billing.billing_state_authority = 'admin_comp'
      then v_billing.comp_access_until else null end;
end;
$function$;

comment on function public.seller_get_saas_billing_status() is
'Owner-only, read-only seller billing presentation model derived from authoritative entitlement and billing evidence. Returns no provider identifiers or payloads.';

revoke all on function public.seller_get_saas_billing_status()
  from public, anon, authenticated;
grant execute on function public.seller_get_saas_billing_status()
  to authenticated;

-- Deploying the read model must never activate Checkout or Portal behavior.
update public.platform_settings
set boolean_value = false,
    updated_by_user_id = null
where setting_key in (
  'saas_subscription_checkout_enabled',
  'saas_billing_portal_enabled'
);

commit;
