-- Invoice-backed SaaS entitlement resolution.
--
-- Rows with a current Subscription enrollment use verified trial claims,
-- successful recurring-invoice evidence, and eligible failure evidence.
-- Rows without that marker retain the existing local-trial, legacy Stripe,
-- complimentary-access, administrative-hold, and fail-closed behavior.

begin;

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
         and v_trial.store_id is not null
         and v_enrollment.trial_started_at is not null
         and v_enrollment.trial_ends_at > v_enrollment.trial_started_at
         and v_trial.trial_started_at = v_enrollment.trial_started_at
         and v_trial.trial_ends_at = v_enrollment.trial_ends_at
         and v_billing.trial_started_at = v_enrollment.trial_started_at
         and v_billing.trial_ends_at = v_enrollment.trial_ends_at
         and v_now < v_enrollment.trial_ends_at then
        v_valid := true;
        v_reason := 'trial';
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
    -- Compatibility branch: existing local trials, classified legacy Stripe,
    -- and audited complimentary access retain their pre-Batch-2 semantics.
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
'Canonical timestamp-aware entitlement resolver. Enrollment-backed paid access requires successful recurring-invoice evidence; Subscription current_period_end is scheduling only.';

revoke all on function public.resolve_store_entitlement(uuid)
  from public, anon, authenticated, service_role;

-- The seller context keeps its established shape, but its public-availability
-- bit now follows the same canonical resolver as public projections and
-- selling guards. No invoice timestamps are exposed through this RPC.
create or replace function public.get_seller_context()
returns table (
  store_id uuid,
  store_name text,
  store_tagline text,
  hero_subheading text,
  storefront_font_pair text,
  storefront_heading_color text,
  storefront_text_color text,
  storefront_top_menu_color text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  hatching_eggs_enabled boolean,
  equipment_supplies_enabled boolean,
  processed_poultry_enabled boolean,
  is_publicly_available boolean,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  public_email text,
  public_phone text,
  show_public_email boolean,
  show_public_phone boolean,
  website_url text,
  social_url text,
  npip_number text,
  show_npip boolean,
  order_notification_email text,
  plan_key text,
  billing_plan text,
  subscription_status text,
  storefront_access_until timestamptz,
  trial_ends_at timestamptz,
  profile_complete boolean,
  billing_complete boolean,
  terms_accepted boolean,
  first_listing_created boolean,
  ready_to_launch boolean,
  launched_at timestamptz,
  role text,
  is_admin boolean,
  other_policies text,
  custom_policies jsonb,
  requested_plan_key text,
  requested_billing_cadence text,
  effective_plan_key text,
  effective_billing_cadence text,
  has_active_entitlement boolean,
  entitlement_reason text,
  entitlement_access_until timestamptz,
  entitlement_held boolean,
  cancel_at_period_end boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    stores.id,
    stores.store_name,
    stores.store_tagline,
    stores.hero_subheading,
    stores.storefront_font_pair,
    stores.storefront_heading_color,
    stores.storefront_text_color,
    stores.storefront_top_menu_color,
    stores.store_slug,
    stores.store_status,
    stores.storefront_mode,
    stores.storefront_enabled,
    stores.hatching_eggs_enabled,
    stores.equipment_supplies_enabled,
    stores.processed_poultry_enabled,
    (
      stores.storefront_enabled = true
      and stores.store_status = 'live'
      and stores.storefront_mode in ('hosted', 'embedded')
      and entitlement.has_active_access
    ),
    stores.public_city,
    stores.public_state,
    stores.public_country,
    stores.about_text,
    stores.pickup_policy,
    stores.cancellation_policy,
    stores.public_email,
    stores.public_phone,
    stores.show_public_email,
    stores.show_public_phone,
    stores.website_url,
    stores.social_url,
    stores.npip_number,
    stores.show_npip,
    stores.order_notification_email,
    entitlement.effective_plan_key,
    entitlement.effective_billing_cadence,
    seller_billing_status.subscription_status,
    seller_billing_status.storefront_access_until,
    seller_billing_status.trial_ends_at,
    coalesce(seller_onboarding_state.profile_complete, false),
    coalesce(seller_onboarding_state.billing_complete, false),
    coalesce(seller_onboarding_state.terms_accepted, false),
    coalesce(seller_onboarding_state.first_listing_created, false),
    coalesce(seller_onboarding_state.ready_to_launch, false),
    seller_onboarding_state.launched_at,
    user_roles.role,
    public.is_admin(),
    stores.other_policies,
    stores.custom_policies,
    seller_billing_status.requested_plan_key,
    seller_billing_status.requested_billing_cadence,
    entitlement.effective_plan_key,
    entitlement.effective_billing_cadence,
    entitlement.has_active_access,
    entitlement.access_reason,
    entitlement.access_until,
    entitlement.held,
    coalesce(seller_billing_status.cancel_at_period_end, false)
  from public.stores
  left join public.user_roles
    on user_roles.store_id = stores.id
   and user_roles.user_id = auth.uid()
   and user_roles.role in ('seller', 'staff')
  left join public.seller_billing_status
    on seller_billing_status.store_id = stores.id
  left join public.seller_onboarding_state
    on seller_onboarding_state.store_id = stores.id
  cross join lateral public.resolve_store_entitlement(stores.id) as entitlement
  where stores.owner_user_id = auth.uid()
     or user_roles.store_id = stores.id;
$function$;

revoke all on function public.get_seller_context()
  from public, anon, authenticated, service_role;
grant execute on function public.get_seller_context() to authenticated;

-- Preserve the exact prior behavior for rows without an enrollment marker.
alter function public.apply_verified_stripe_subscription_event(
  text, timestamptz, text, text, uuid, text, text, text, text,
  timestamptz, timestamptz, boolean, boolean, text
) rename to apply_verified_stripe_subscription_event_legacy_compat;

revoke all on function public.apply_verified_stripe_subscription_event_legacy_compat(
  text, timestamptz, text, text, uuid, text, text, text, text,
  timestamptz, timestamptz, boolean, boolean, text
) from public, anon, authenticated, service_role;

create or replace function public.apply_verified_stripe_subscription_event(
  p_provider_event_id text,
  p_provider_event_created_at timestamptz,
  p_event_type text,
  p_payload_hash text,
  p_store_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_price_id text,
  p_subscription_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_stripe_livemode boolean,
  p_stripe_account_id text default ''
)
returns table (
  applied boolean,
  store_id uuid,
  subscription_status text,
  access_until timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event_id text := nullif(trim(p_provider_event_id), '');
  v_event_type text := nullif(trim(p_event_type), '');
  v_hash text := nullif(trim(p_payload_hash), '');
  v_customer text := nullif(trim(p_stripe_customer_id), '');
  v_subscription text := nullif(trim(p_stripe_subscription_id), '');
  v_price_id text := nullif(trim(p_stripe_price_id), '');
  v_account text := coalesce(trim(p_stripe_account_id), '');
  v_billing public.seller_billing_status%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_customer_binding public.billing_customer_bindings%rowtype;
  v_price public.billing_provider_price_catalog%rowtype;
  v_prior_event public.billing_provider_events%rowtype;
  v_stale boolean := false;
  v_ignore_reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Provider billing updates require a verified service workflow.';
  end if;

  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = p_store_id;

  if v_billing.current_subscription_enrollment_id is null then
    return query
    select legacy.applied, legacy.store_id, legacy.subscription_status, legacy.access_until
    from public.apply_verified_stripe_subscription_event_legacy_compat(
      p_provider_event_id, p_provider_event_created_at, p_event_type,
      p_payload_hash, p_store_id, p_stripe_customer_id,
      p_stripe_subscription_id, p_stripe_price_id, p_subscription_status,
      p_current_period_start, p_current_period_end, p_cancel_at_period_end,
      p_stripe_livemode, p_stripe_account_id
    ) as legacy;
    return;
  end if;

  if v_event_id is null or v_event_type is null or v_hash is null
     or p_provider_event_created_at is null or p_store_id is null
     or v_customer is null or v_subscription is null or v_price_id is null
     or p_stripe_livemode is null
     or v_account !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'Verified provider event fields are required.';
  end if;
  if p_subscription_status not in (
    'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled',
    'incomplete', 'incomplete_expired', 'suspended'
  ) then
    raise exception 'Unsupported provider subscription status.';
  end if;
  if p_subscription_status in ('trialing', 'active') and (
       p_current_period_start is null or p_current_period_end is null
       or p_current_period_end <= p_current_period_start
     ) then
    raise exception 'Provider scheduling period is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('stripe-customer:' || v_customer, 0));
  perform pg_advisory_xact_lock(hashtextextended('stripe-subscription:' || v_subscription, 0));

  select provider_event.* into v_prior_event
  from public.billing_provider_events as provider_event
  where provider_event.stripe_livemode = p_stripe_livemode
    and provider_event.stripe_account_id = v_account
    and provider_event.provider_event_id = v_event_id;
  if v_prior_event.provider_event_id is not null then
    if v_prior_event.payload_hash <> v_hash
       or v_prior_event.store_id <> p_store_id
       or v_prior_event.event_type <> v_event_type
       or v_prior_event.provider_event_created_at <> p_provider_event_created_at then
      raise exception 'Provider event id was reused with different content.';
    end if;
    return query select v_prior_event.applied, p_store_id,
      v_billing.subscription_status, v_billing.storefront_access_until;
    return;
  end if;

  perform 1 from public.stores as store where store.id = p_store_id for update;
  if not found then raise exception 'Store is not available.'; end if;
  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = p_store_id for update;

  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.id = v_billing.current_subscription_enrollment_id
  for update;
  if v_enrollment.id is null or not v_enrollment.is_current
     or v_enrollment.store_id <> p_store_id
     or v_enrollment.stripe_subscription_id <> v_subscription
     or v_enrollment.initial_stripe_price_id <> v_price_id
     or v_enrollment.stripe_livemode <> p_stripe_livemode
     or v_enrollment.stripe_account_id <> v_account then
    raise exception 'Subscription snapshot conflicts with the immutable enrollment.';
  end if;
  select binding.* into v_customer_binding
  from public.billing_customer_bindings as binding
  where binding.id = v_enrollment.customer_binding_id;
  if v_customer_binding.id is null
     or v_customer_binding.store_id <> p_store_id
     or v_customer_binding.stripe_customer_id <> v_customer
     or v_customer_binding.stripe_livemode <> p_stripe_livemode
     or v_customer_binding.stripe_account_id <> v_account then
    raise exception 'Subscription snapshot conflicts with the immutable Customer binding.';
  end if;
  select price.* into v_price
  from public.billing_provider_price_catalog as price
  where price.stripe_price_id = v_price_id
    and price.stripe_livemode = p_stripe_livemode
    and price.stripe_account_id = v_account;
  if v_price.stripe_price_id is null
     or v_price.plan_key not in ('small_flock', 'full_flock')
     or v_price.billing_cadence not in ('monthly', 'yearly') then
    raise exception 'Subscription Price is not registered for this enrollment context.';
  end if;
  if v_billing.stripe_customer_id is distinct from v_customer
     or v_billing.stripe_subscription_id is distinct from v_subscription
     or v_billing.stripe_price_id is distinct from v_price_id
     or v_billing.stripe_livemode is distinct from p_stripe_livemode
     or v_billing.stripe_account_id is distinct from v_account then
    raise exception 'Billing snapshot conflicts with the immutable enrollment.';
  end if;
  if p_subscription_status = 'trialing' and exists (
    select 1 from public.billing_trial_claims as claim
    where claim.store_id = p_store_id
      and claim.subscription_enrollment_id = v_enrollment.id
      and (
        claim.trial_started_at is distinct from p_current_period_start
        or claim.trial_ends_at is distinct from p_current_period_end
      )
  ) then
    raise exception 'Subscription trial snapshot conflicts with the durable trial claim.';
  end if;

  if v_billing.last_provider_event_created_at is not null and (
       v_billing.last_provider_event_created_at > p_provider_event_created_at
       or (
         v_billing.last_provider_event_created_at = p_provider_event_created_at
         and coalesce(v_billing.last_provider_event_id, '') > v_event_id
       )
     ) then
    v_stale := true;
    v_ignore_reason := 'stale_subscription_event';
  end if;

  insert into public.billing_provider_events (
    stripe_livemode, stripe_account_id, provider_event_id,
    provider_event_created_at, store_id, event_type, payload_hash,
    applied, ignored_reason, processing_status, processed_at, attempt_count,
    provider_object_type, provider_object_id
  ) values (
    p_stripe_livemode, v_account, v_event_id,
    p_provider_event_created_at, p_store_id, v_event_type, v_hash,
    not v_stale, v_ignore_reason,
    case when v_stale then 'ignored' else 'processed' end,
    statement_timestamp(), 1, 'subscription', v_subscription
  );

  if v_stale then
    insert into public.billing_entitlement_events (
      store_id, event_type, provider_event_id, metadata
    ) values (
      p_store_id, 'provider_event_ignored', v_event_id,
      jsonb_build_object('reason', v_ignore_reason, 'event_type', v_event_type)
    );
    return query select false, p_store_id,
      v_billing.subscription_status, v_billing.storefront_access_until;
    return;
  end if;

  update public.billing_subscription_enrollments as enrollment
  set provider_status = p_subscription_status,
      trial_started_at = case when p_subscription_status = 'trialing'
        then p_current_period_start else enrollment.trial_started_at end,
      trial_ends_at = case when p_subscription_status = 'trialing'
        then p_current_period_end else enrollment.trial_ends_at end,
      cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
      updated_at = statement_timestamp()
  where enrollment.id = v_enrollment.id;

  update public.seller_billing_status as status
  set
    plan_key = v_price.plan_key,
    billing_plan = v_price.billing_cadence,
    subscription_status = p_subscription_status,
    current_period_start = p_current_period_start,
    current_period_end = p_current_period_end,
    trial_started_at = case when p_subscription_status = 'trialing'
      then p_current_period_start else status.trial_started_at end,
    trial_ends_at = case when p_subscription_status = 'trialing'
      then p_current_period_end else status.trial_ends_at end,
    cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
    billing_state_authority = 'stripe',
    last_provider_event_id = v_event_id,
    last_provider_event_created_at = p_provider_event_created_at,
    last_provider_event_applied_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where status.store_id = p_store_id
  returning status.* into v_billing;

  insert into public.billing_entitlement_events (
    store_id, event_type, plan_key, billing_cadence, access_until,
    provider_event_id, metadata
  ) values (
    p_store_id, 'provider_state_applied', v_price.plan_key,
    v_price.billing_cadence, v_billing.storefront_access_until, v_event_id,
    jsonb_build_object(
      'subscription_status', p_subscription_status,
      'event_type', v_event_type,
      'cancel_at_period_end', coalesce(p_cancel_at_period_end, false),
      'invoice_backed', true
    )
  );

  return query select true, p_store_id,
    v_billing.subscription_status, v_billing.storefront_access_until;
end;
$function$;

comment on function public.apply_verified_stripe_subscription_event(
  text, timestamptz, text, text, uuid, text, text, text, text,
  timestamptz, timestamptz, boolean, boolean, text
) is
'Service-only Subscription snapshot sink. Enrollment-backed scheduling periods never establish paid-through access; unmarked legacy rows retain their prior compatibility behavior.';

revoke all on function public.apply_verified_stripe_subscription_event(
  text, timestamptz, text, text, uuid, text, text, text, text,
  timestamptz, timestamptz, boolean, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_verified_stripe_subscription_event(
  text, timestamptz, text, text, uuid, text, text, text, text,
  timestamptz, timestamptz, boolean, boolean, text
) to service_role;

commit;
