begin;

-- The controlled rollout is complete. The global setting remains the master
-- switch; the permanent authorization contract still derives the seller's
-- store and immutable Stripe bindings before creating a Portal action.
create or replace function public.begin_saas_billing_portal_action(
  p_authenticated_user_id uuid,
  p_action_type text,
  p_stripe_livemode boolean,
  p_stripe_account_id text,
  p_environment_id text
)
returns table (
  action_state text,
  action_request_id uuid,
  store_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  return query
  select * from public.begin_saas_billing_portal_action_unscoped_v1(
    p_authenticated_user_id, p_action_type, p_stripe_livemode,
    p_stripe_account_id, p_environment_id
  );
end;
$function$;

revoke all on function public.begin_saas_billing_portal_action(
  uuid,text,boolean,text,text
) from public, anon, authenticated;
grant execute on function public.begin_saas_billing_portal_action(
  uuid,text,boolean,text,text
) to service_role;

create or replace function public.begin_saas_subscription_resume(
  p_authenticated_user_id uuid,
  p_stripe_livemode boolean,
  p_stripe_account_id text,
  p_environment_id text
)
returns table (
  action_state text,
  action_request_id uuid,
  store_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_idempotency_key text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  return query
  select * from public.begin_saas_subscription_resume_unscoped_v1(
    p_authenticated_user_id, p_stripe_livemode,
    p_stripe_account_id, p_environment_id
  );
end;
$function$;

revoke all on function public.begin_saas_subscription_resume(
  uuid,boolean,text,text
) from public, anon, authenticated;
grant execute on function public.begin_saas_subscription_resume(
  uuid,boolean,text,text
) to service_role;

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
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  return query
  select
    case
      when base.lifecycle_state in ('trial_active', 'trial_payment_problem')
       and base.cancel_at_period_end
       and base.has_active_access
        then 'trial_canceling_at_period_end'::text
      else base.lifecycle_state
    end,
    base.checkout_enabled,
    coalesce(base.portal_enabled, false),
    base.requested_plan_key,
    base.requested_billing_cadence,
    base.effective_plan_key,
    base.effective_billing_cadence,
    base.billing_authority,
    base.subscription_status,
    base.entitlement_reason,
    base.has_active_access,
    base.entitlement_access_until,
    base.trial_started_at,
    base.trial_ends_at,
    base.paid_through_at,
    base.grace_ends_at,
    base.payment_failure_started_at,
    base.payment_action_required_at,
    base.cancel_at_period_end,
    base.current_period_end,
    base.storefront_access_until,
    base.billing_complete,
    base.checkout_attempt_status,
    base.checkout_attempt_expires_at,
    base.resumable_checkout,
    base.trial_eligibility,
    base.customer_binding_exists,
    base.current_enrollment_exists,
    base.latest_invoice_status,
    base.malformed_or_unclassified,
    base.administrative_hold,
    base.complimentary_access_ends_at
  from public.seller_get_saas_billing_status_base_v1() as base;
end;
$function$;

comment on function public.seller_get_saas_billing_status() is
'Owner-only read model. Portal availability uses the global master flag; Portal actions independently require the owner''s immutable current Stripe Customer and Subscription bindings.';

revoke all on function public.seller_get_saas_billing_status()
  from public, anon, authenticated;
grant execute on function public.seller_get_saas_billing_status()
  to authenticated;

commit;
