-- Requested-only onboarding transition for future Stripe Checkout enrollment.
--
-- The Checkout flag remains disabled. While disabled, the public onboarding RPC
-- delegates to an exact private copy of the existing local-trial implementation.
-- When deliberately enabled later, new eligible stores may persist requested
-- plan intent without gaining trial, payment, provider, or entitlement authority.

begin;

-- A requested-only row must not inherit the historical Coop storage default as
-- an effective plan. Existing populated rows and the default itself are retained
-- for compatibility; the new authority constraint requires an explicit null.
alter table public.seller_billing_status
  alter column plan_key drop not null;

alter table public.seller_billing_status
  drop constraint seller_billing_status_authority_check;

alter table public.seller_billing_status
  add constraint seller_billing_status_authority_check check (
    billing_state_authority in (
      'legacy_unclassified',
      'trial',
      'legacy_stripe',
      'stripe',
      'admin_comp',
      'pending_checkout'
    )
  ) not valid;

alter table public.seller_billing_status
  add constraint seller_billing_status_pending_checkout_consistency_check check (
    billing_state_authority <> 'pending_checkout'
    or (
      requested_plan_key in ('small_flock', 'full_flock')
      and requested_billing_cadence in ('monthly', 'yearly')
      and plan_key is null
      and billing_plan is null
      and subscription_status = 'dormant'
      and trial_started_at is null
      and trial_ends_at is null
      and current_period_start is null
      and current_period_end is null
      and storefront_access_until is null
      and paid_through_at is null
      and grace_ends_at is null
      and payment_failure_started_at is null
      and payment_action_required_at is null
      and effective_price_started_at is null
      and stripe_customer_id is null
      and stripe_subscription_id is null
      and stripe_price_id is null
      and stripe_livemode is null
      and stripe_account_id is null
      and current_subscription_enrollment_id is null
      and latest_stripe_invoice_id is null
      and latest_invoice_status is null
      and last_paid_stripe_invoice_id is null
      and latest_invoice_event_id is null
      and latest_invoice_event_created_at is null
      and grace_stripe_invoice_id is null
      and grace_provider_event_id is null
      and grace_provider_event_created_at is null
      and last_provider_event_id is null
      and last_provider_event_created_at is null
      and last_provider_event_applied_at is null
      and cancel_at_period_end = false
      and paused_at is null
      and dormancy_started_at is null
      and applied_promo_code is null
      and comp_granted_by_user_id is null
      and comp_grant_reason is null
      and comp_granted_at is null
      and comp_access_until is null
      and comp_revoked_by_user_id is null
      and comp_revocation_reason is null
      and comp_revoked_at is null
    )
  );

comment on constraint seller_billing_status_pending_checkout_consistency_check
  on public.seller_billing_status is
'Pending Checkout stores requested intent only. It cannot carry effective plan, trial, Stripe, invoice, enrollment, paid-through, grace, complimentary, or storefront-access authority.';

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
      'checkout_selection_saved', 'checkout_selection_changed'
    )
  );

-- This helper is the pre-Batch-3 implementation copied without behavioral
-- changes. Browser roles cannot invoke it directly; the public wrapper reaches
-- it only while the Checkout flag is false or for an existing valid local trial.
create function public.seller_save_onboarding_plan_access_local_trial_compat(
  p_plan jsonb
)
returns table (
  store_id uuid,
  plan_key text,
  billing_plan text,
  subscription_status text,
  applied_promo_code text,
  trial_ends_at timestamptz,
  storefront_access_until timestamptz,
  billing_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_plan jsonb := coalesce(p_plan, '{}'::jsonb);
  v_requested_plan text;
  v_requested_cadence text;
  v_now timestamptz := statement_timestamp();
  v_started boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if jsonb_typeof(v_plan) <> 'object' then
    raise exception 'Plan access details must be provided.';
  end if;

  v_requested_plan := coalesce(
    nullif(trim(v_plan ->> 'requested_plan_key'), ''),
    nullif(trim(v_plan ->> 'plan_key'), '')
  );
  v_requested_cadence := coalesce(
    nullif(trim(v_plan ->> 'requested_billing_cadence'), ''),
    nullif(trim(v_plan ->> 'billing_plan'), ''),
    'monthly'
  );

  if v_requested_plan not in ('small_flock', 'full_flock') then
    raise exception 'Choose Coop or Market before continuing.';
  end if;
  if v_requested_cadence not in ('monthly', 'yearly') then
    raise exception 'Choose monthly or yearly billing before continuing.';
  end if;

  -- Reject attempts to smuggle effective billing state through the compatibility
  -- JSON argument. promo_code is tolerated for one old-app deployment window
  -- but is deliberately ignored and never persisted.
  if v_plan ?| array[
    'subscription_status',
    'storefront_access_until',
    'trial_started_at',
    'trial_ends_at',
    'stripe_customer_id',
    'stripe_subscription_id',
    'stripe_price_id',
    'billing_state_authority'
  ] then
    raise exception 'Effective billing state cannot be set from onboarding.';
  end if;

  select stores.*
  into v_store
  from public.stores
  where stores.owner_user_id = v_user_id
  order by stores.created_at asc
  limit 1
  for update;

  if v_store.id is null then
    raise exception 'Complete farm basics before choosing a plan.';
  end if;
  if not exists (
    select 1
    from public.seller_onboarding_state
    where seller_onboarding_state.store_id = v_store.id
      and seller_onboarding_state.profile_complete = true
  ) then
    raise exception 'Complete farm basics before choosing a plan.';
  end if;

  select *
  into v_billing
  from public.seller_billing_status
  where seller_billing_status.store_id = v_store.id
  for update;

  if v_billing.id is null then
    insert into public.seller_billing_status (
      store_id,
      requested_plan_key,
      requested_billing_cadence,
      plan_key,
      billing_plan,
      subscription_status,
      trial_started_at,
      trial_ends_at,
      current_period_start,
      current_period_end,
      storefront_access_until,
      billing_state_authority,
      applied_promo_code
    )
    values (
      v_store.id,
      v_requested_plan,
      v_requested_cadence,
      v_requested_plan,
      v_requested_cadence,
      'trialing',
      v_now,
      v_now + interval '7 days',
      v_now,
      v_now + interval '7 days',
      v_now + interval '7 days',
      'trial',
      null
    )
    returning * into v_billing;
    v_started := true;
  elsif v_billing.billing_state_authority = 'trial'
    and v_billing.subscription_status = 'trialing'
    and v_billing.trial_started_at is not null
    and v_billing.trial_ends_at = v_billing.trial_started_at + interval '7 days'
    and v_billing.storefront_access_until = v_billing.trial_ends_at
    and v_billing.trial_ends_at > v_now
    and v_billing.stripe_customer_id is null
    and v_billing.stripe_subscription_id is null
    and v_billing.comp_granted_at is null then
    update public.seller_billing_status
    set
      requested_plan_key = v_requested_plan,
      requested_billing_cadence = v_requested_cadence,
      plan_key = v_requested_plan,
      billing_plan = v_requested_cadence,
      applied_promo_code = null
    where seller_billing_status.id = v_billing.id
    returning * into v_billing;
  else
    raise exception 'Plan access is already established and cannot be replaced from onboarding.';
  end if;

  insert into public.billing_entitlement_events (
    store_id,
    actor_user_id,
    event_type,
    plan_key,
    billing_cadence,
    access_until
  )
  values (
    v_store.id,
    v_user_id,
    case when v_started then 'trial_started' else 'trial_selection_changed' end,
    v_requested_plan,
    v_requested_cadence,
    v_billing.trial_ends_at
  );

  update public.seller_onboarding_state
  set
    billing_complete = true,
    categories_complete = false,
    updated_at = v_now
  where seller_onboarding_state.store_id = v_store.id;

  return query
  select
    v_store.id,
    v_billing.plan_key,
    v_billing.billing_plan,
    v_billing.subscription_status,
    null::text,
    v_billing.trial_ends_at,
    v_billing.storefront_access_until,
    true,
    4;
end;
$function$;

comment on function public.seller_save_onboarding_plan_access_local_trial_compat(jsonb) is
'Private compatibility implementation for the existing one-time local seven-day onboarding trial. It is reachable only through the trusted public wrapper.';

revoke all on function public.seller_save_onboarding_plan_access_local_trial_compat(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.seller_save_onboarding_plan_access(p_plan jsonb)
returns table (
  store_id uuid,
  plan_key text,
  billing_plan text,
  subscription_status text,
  applied_promo_code text,
  trial_ends_at timestamptz,
  storefront_access_until timestamptz,
  billing_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_onboarding public.seller_onboarding_state%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_plan jsonb := coalesce(p_plan, '{}'::jsonb);
  v_checkout_enabled boolean := false;
  v_requested_plan text;
  v_requested_cadence text;
  v_previous_requested_plan text;
  v_previous_requested_cadence text;
  v_now timestamptz := statement_timestamp();
  v_created boolean := false;
  v_changed boolean := false;
begin
  select coalesce(settings.boolean_value, false)
  into v_checkout_enabled
  from public.platform_settings as settings
  where settings.setting_key = 'saas_subscription_checkout_enabled';

  if not coalesce(v_checkout_enabled, false) then
    return query
    select *
    from public.seller_save_onboarding_plan_access_local_trial_compat(p_plan);
    return;
  end if;

  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if jsonb_typeof(v_plan) <> 'object' then
    raise exception 'Plan access details must be provided.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_plan) as supplied(key)
    where supplied.key not in (
      'requested_plan_key',
      'requested_billing_cadence'
    )
  ) then
    raise exception 'Only requested plan and billing cadence may be set from onboarding.';
  end if;

  v_requested_plan := nullif(trim(v_plan ->> 'requested_plan_key'), '');
  v_requested_cadence := nullif(
    trim(v_plan ->> 'requested_billing_cadence'),
    ''
  );

  if v_requested_plan not in ('small_flock', 'full_flock') then
    raise exception 'Choose Coop or Market before continuing.';
  end if;
  if v_requested_cadence not in ('monthly', 'yearly') then
    raise exception 'Choose monthly or yearly billing before continuing.';
  end if;

  select stores.*
  into v_store
  from public.stores
  where stores.owner_user_id = v_user_id
  order by stores.created_at asc
  limit 1
  for update;

  if v_store.id is null then
    raise exception 'Complete farm basics before choosing a plan.';
  end if;

  select onboarding.*
  into v_onboarding
  from public.seller_onboarding_state as onboarding
  where onboarding.store_id = v_store.id
  for update;

  if v_onboarding.id is null or not v_onboarding.profile_complete then
    raise exception 'Complete farm basics before choosing a plan.';
  end if;

  select status.*
  into v_billing
  from public.seller_billing_status as status
  where status.store_id = v_store.id
  for update;

  -- A valid pre-activation local trial keeps the exact compatibility behavior,
  -- including its original start/end boundary and current completion semantics.
  if v_billing.id is not null
    and v_billing.current_subscription_enrollment_id is null
    and v_billing.billing_state_authority = 'trial'
    and v_billing.subscription_status = 'trialing'
    and v_billing.plan_key in ('small_flock', 'full_flock')
    and v_billing.billing_plan in ('monthly', 'yearly')
    and v_billing.requested_plan_key = v_billing.plan_key
    and v_billing.requested_billing_cadence = v_billing.billing_plan
    and v_billing.trial_started_at is not null
    and v_billing.trial_ends_at = v_billing.trial_started_at + interval '7 days'
    and v_billing.current_period_start = v_billing.trial_started_at
    and v_billing.current_period_end = v_billing.trial_ends_at
    and v_billing.storefront_access_until = v_billing.trial_ends_at
    and v_billing.trial_ends_at > v_now
    and v_billing.stripe_customer_id is null
    and v_billing.stripe_subscription_id is null
    and v_billing.comp_granted_at is null then
    return query
    select *
    from public.seller_save_onboarding_plan_access_local_trial_compat(p_plan);
    return;
  end if;

  if v_billing.id is not null
     and v_billing.billing_state_authority <> 'pending_checkout' then
    if v_billing.billing_state_authority = 'trial'
       or v_billing.trial_started_at is not null
       or v_billing.trial_ends_at is not null
       or exists (
         select 1
         from public.billing_trial_claims as claims
         where claims.store_id = v_store.id
       ) then
      raise exception 'Trial already used; a paid subscription is required.';
    end if;
    raise exception 'Plan access is already established and cannot be replaced from onboarding.';
  end if;

  if v_billing.id is null then
    if v_store.admin_hold_reason is not null then
      raise exception 'Plan access cannot be changed while the store is on administrative hold.';
    end if;
    if v_onboarding.billing_complete then
      raise exception 'Plan access is already established and cannot be replaced from onboarding.';
    end if;
    if exists (
      select 1
      from public.billing_trial_claims as claims
      where claims.store_id = v_store.id
    ) or exists (
      select 1
      from public.billing_subscription_enrollments as enrollments
      where enrollments.store_id = v_store.id
        and (
          enrollments.trial_started_at is not null
          or enrollments.trial_ends_at is not null
        )
    ) then
      raise exception 'Trial already used; a paid subscription is required.';
    end if;
    if exists (
      select 1
      from public.billing_customer_bindings as bindings
      where bindings.store_id = v_store.id
    ) or exists (
      select 1
      from public.billing_subscription_enrollments as enrollments
      where enrollments.store_id = v_store.id
    ) then
      raise exception 'Plan access is already established and cannot be replaced from onboarding.';
    end if;

    -- Checkout-attempt history is deliberately absent from the eligibility
    -- guards. Creating, opening, completing, canceling, failing, superseding,
    -- expiring, or awaiting confirmation does not prove that a trial began.
    -- Only authoritative trial evidence or a verified enrollment may block it.

    insert into public.seller_billing_status (
      store_id,
      requested_plan_key,
      requested_billing_cadence,
      plan_key,
      billing_plan,
      subscription_status,
      billing_state_authority,
      cancel_at_period_end
    )
    values (
      v_store.id,
      v_requested_plan,
      v_requested_cadence,
      null,
      null,
      'dormant',
      'pending_checkout',
      false
    )
    returning * into v_billing;
    v_created := true;
  else
    if v_onboarding.billing_complete then
      raise exception 'Pending Checkout is malformed and cannot be changed from onboarding.';
    end if;

    v_previous_requested_plan := v_billing.requested_plan_key;
    v_previous_requested_cadence := v_billing.requested_billing_cadence;
    v_changed := v_previous_requested_plan is distinct from v_requested_plan
      or v_previous_requested_cadence is distinct from v_requested_cadence;

    if v_changed then
      update public.seller_billing_status as status
      set
        requested_plan_key = v_requested_plan,
        requested_billing_cadence = v_requested_cadence
      where status.id = v_billing.id
      returning * into v_billing;
    end if;
  end if;

  if v_created or v_changed then
    insert into public.billing_entitlement_events (
      store_id,
      actor_user_id,
      event_type,
      plan_key,
      billing_cadence,
      access_until,
      metadata
    )
    values (
      v_store.id,
      v_user_id,
      case
        when v_created then 'checkout_selection_saved'
        else 'checkout_selection_changed'
      end,
      v_requested_plan,
      v_requested_cadence,
      null,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'requested_plan_key', v_requested_plan,
        'requested_billing_cadence', v_requested_cadence,
        'previous_requested_plan_key', v_previous_requested_plan,
        'previous_requested_billing_cadence', v_previous_requested_cadence,
        'feature_mode', 'requested_only_v1'
      ))
    );
  end if;

  -- The established return shape is retained. Null effective values, dormant
  -- status, and billing_complete=false identify the Checkout-required state.
  return query
  select
    v_store.id,
    null::text,
    null::text,
    'dormant'::text,
    null::text,
    null::timestamptz,
    null::timestamptz,
    false,
    4;
end;
$function$;

comment on function public.seller_save_onboarding_plan_access(jsonb) is
'Owner-only onboarding plan request. While SaaS Checkout is disabled it preserves the existing local trial; when enabled it stores requested intent only for eligible new stores.';

revoke all on function public.seller_save_onboarding_plan_access(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_save_onboarding_plan_access(jsonb)
  to authenticated;

-- Deploying this migration must never activate Checkout. Preserve an existing
-- disabled row and defensively force the supported flag to false in case local
-- test state was left altered before migration application.
insert into public.platform_settings (setting_key, boolean_value)
values ('saas_subscription_checkout_enabled', false)
on conflict (setting_key) do update
set boolean_value = false,
    updated_by_user_id = null;

commit;
