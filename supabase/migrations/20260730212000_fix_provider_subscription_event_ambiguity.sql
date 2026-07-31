-- Phase 1 security integration correction: keep the verified provider contract
-- service-only while removing PL/pgSQL output-column ambiguity from its
-- per-store billing snapshot upsert.

begin;

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
  v_price text := nullif(trim(p_stripe_price_id), '');
  v_account text := coalesce(trim(p_stripe_account_id), '');
  v_price_row public.billing_provider_price_catalog%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_prior_event public.billing_provider_events%rowtype;
  v_was_active boolean := false;
  v_now timestamptz := statement_timestamp();
  v_apply boolean := true;
  v_ignore_reason text;
  v_previous_plan_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Provider billing updates require a verified service workflow.';
  end if;
  if v_event_id is null or v_event_type is null or v_hash is null
    or p_provider_event_created_at is null or p_store_id is null
    or v_customer is null or v_subscription is null or v_price is null
    or p_stripe_livemode is null then
    raise exception 'Verified provider event fields are required.';
  end if;
  if p_subscription_status not in (
    'active', 'past_due', 'canceled', 'incomplete',
    'incomplete_expired', 'suspended'
  ) then
    raise exception 'Unsupported provider subscription status.';
  end if;
  if p_subscription_status = 'active'
    and (
      p_current_period_start is null
      or p_current_period_end is null
      or p_current_period_end <= p_current_period_start
    ) then
    raise exception 'An active subscription requires a valid paid period.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('stripe-customer:' || v_customer, 0));
  perform pg_advisory_xact_lock(hashtextextended('stripe-subscription:' || v_subscription, 0));

  select provider_event.*
  into v_prior_event
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
    return query
    select
      v_prior_event.applied,
      v_prior_event.store_id,
      coalesce(
        (
          select billing_snapshot.subscription_status
          from public.seller_billing_status as billing_snapshot
          where billing_snapshot.store_id = v_prior_event.store_id
        ),
        'dormant'
      ),
      (
        select billing_snapshot.storefront_access_until
        from public.seller_billing_status as billing_snapshot
        where billing_snapshot.store_id = v_prior_event.store_id
      );
    return;
  end if;

  select price_mapping.*
  into v_price_row
  from public.billing_provider_price_catalog as price_mapping
  where price_mapping.stripe_price_id = v_price
    and price_mapping.stripe_livemode = p_stripe_livemode
    and price_mapping.stripe_account_id = v_account
    and price_mapping.is_active = true;
  if v_price_row.stripe_price_id is null then
    raise exception 'Stripe price is not registered for this environment and account.';
  end if;

  if exists (
    select 1
    from public.seller_billing_status as customer_binding
    where customer_binding.store_id <> p_store_id
      and customer_binding.stripe_customer_id = v_customer
  ) or exists (
    select 1
    from public.seller_billing_status as subscription_binding
    where subscription_binding.store_id <> p_store_id
      and subscription_binding.stripe_subscription_id = v_subscription
  ) then
    raise exception 'Provider customer or subscription is already bound to another store.';
  end if;

  perform 1
  from public.stores as target_store
  where target_store.id = p_store_id
  for update;
  if not found then
    raise exception 'Store is not available.';
  end if;

  v_was_active := public.store_has_active_entitlement(p_store_id);

  select billing_snapshot.*
  into v_billing
  from public.seller_billing_status as billing_snapshot
  where billing_snapshot.store_id = p_store_id
  for update;
  v_previous_plan_key := v_billing.plan_key;

  if v_billing.id is not null
    and (
      (
        nullif(trim(v_billing.stripe_customer_id), '') is not null
        and v_billing.stripe_customer_id <> v_customer
      )
      or (
        nullif(trim(v_billing.stripe_subscription_id), '') is not null
        and v_billing.stripe_subscription_id <> v_subscription
      )
    ) then
    raise exception 'Provider customer or subscription cannot be rebound to a different identifier.';
  end if;

  if v_billing.last_provider_event_created_at is not null
    and (
      v_billing.last_provider_event_created_at > p_provider_event_created_at
      or (
        v_billing.last_provider_event_created_at = p_provider_event_created_at
        and coalesce(v_billing.last_provider_event_id, '') > v_event_id
      )
    ) then
    v_apply := false;
    v_ignore_reason := 'stale_event';
  end if;

  insert into public.billing_provider_events (
    stripe_livemode,
    stripe_account_id,
    provider_event_id,
    provider_event_created_at,
    store_id,
    event_type,
    payload_hash,
    applied,
    ignored_reason
  )
  values (
    p_stripe_livemode,
    v_account,
    v_event_id,
    p_provider_event_created_at,
    p_store_id,
    v_event_type,
    v_hash,
    v_apply,
    v_ignore_reason
  );

  if not v_apply then
    insert into public.billing_entitlement_events (
      store_id, event_type, provider_event_id, metadata
    )
    values (
      p_store_id,
      'provider_event_ignored',
      v_event_id,
      jsonb_build_object('reason', v_ignore_reason, 'event_type', v_event_type)
    );
    return query
    select false, p_store_id, v_billing.subscription_status, v_billing.storefront_access_until;
    return;
  end if;

  insert into public.seller_billing_status as billing_snapshot (
    store_id,
    requested_plan_key,
    requested_billing_cadence,
    plan_key,
    billing_plan,
    subscription_status,
    current_period_start,
    current_period_end,
    storefront_access_until,
    cancel_at_period_end,
    billing_state_authority,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    stripe_livemode,
    stripe_account_id,
    last_provider_event_id,
    last_provider_event_created_at,
    last_provider_event_applied_at,
    applied_promo_code
  )
  values (
    p_store_id,
    v_price_row.plan_key,
    v_price_row.billing_cadence,
    v_price_row.plan_key,
    v_price_row.billing_cadence,
    p_subscription_status,
    p_current_period_start,
    p_current_period_end,
    case when p_subscription_status = 'active' then p_current_period_end else null end,
    coalesce(p_cancel_at_period_end, false),
    'stripe',
    v_customer,
    v_subscription,
    v_price,
    p_stripe_livemode,
    v_account,
    v_event_id,
    p_provider_event_created_at,
    v_now,
    null
  )
  on conflict on constraint seller_billing_status_store_id_key do update
  set
    requested_plan_key = excluded.requested_plan_key,
    requested_billing_cadence = excluded.requested_billing_cadence,
    plan_key = excluded.plan_key,
    billing_plan = excluded.billing_plan,
    subscription_status = excluded.subscription_status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    storefront_access_until = excluded.storefront_access_until,
    cancel_at_period_end = excluded.cancel_at_period_end,
    billing_state_authority = excluded.billing_state_authority,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    stripe_livemode = excluded.stripe_livemode,
    stripe_account_id = excluded.stripe_account_id,
    last_provider_event_id = excluded.last_provider_event_id,
    last_provider_event_created_at = excluded.last_provider_event_created_at,
    last_provider_event_applied_at = excluded.last_provider_event_applied_at,
    comp_granted_by_user_id = null,
    comp_grant_reason = null,
    comp_granted_at = null,
    comp_access_until = null,
    comp_revoked_by_user_id = null,
    comp_revocation_reason = null,
    comp_revoked_at = null,
    applied_promo_code = null
  returning billing_snapshot.* into v_billing;

  if (
      not v_was_active
      or v_previous_plan_key is distinct from v_price_row.plan_key
    )
    and p_subscription_status = 'active' then
    update public.stores as target_store
    set storefront_enabled = false
    where target_store.id = p_store_id;
  end if;

  insert into public.billing_entitlement_events (
    store_id,
    event_type,
    plan_key,
    billing_cadence,
    access_until,
    provider_event_id,
    metadata
  )
  values (
    p_store_id,
    'provider_state_applied',
    v_price_row.plan_key,
    v_price_row.billing_cadence,
    v_billing.storefront_access_until,
    v_event_id,
    jsonb_build_object(
      'subscription_status', p_subscription_status,
      'event_type', v_event_type,
      'cancel_at_period_end', coalesce(p_cancel_at_period_end, false),
      'livemode', p_stripe_livemode,
      'account_id', v_account
    )
  );

  return query
  select true, p_store_id, v_billing.subscription_status, v_billing.storefront_access_until;
end;
$function$;

comment on function public.apply_verified_stripe_subscription_event(
  text, timestamptz, text, text, uuid, text, text, text, text,
  timestamptz, timestamptz, boolean, boolean, text
) is
'Service-role-only contract for a future verified Stripe event path. Plan and cadence are derived from the trusted price catalog; duplicate and stale events are safe.';

revoke all on function public.apply_verified_stripe_subscription_event(
  text, timestamptz, text, text, uuid, text, text, text, text,
  timestamptz, timestamptz, boolean, boolean, text
) from public, anon, authenticated;
grant execute on function public.apply_verified_stripe_subscription_event(
  text, timestamptz, text, text, uuid, text, text, text, text,
  timestamptz, timestamptz, boolean, boolean, text
) to service_role;

commit;
