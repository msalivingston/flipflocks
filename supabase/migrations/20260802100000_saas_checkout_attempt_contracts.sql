begin;

alter table public.billing_checkout_attempts
  add column checkout_environment_id text,
  add column stripe_product_id text,
  add column trial_eligibility text;

alter table public.billing_checkout_attempts
  add constraint billing_checkout_attempts_environment_check check (
    checkout_environment_id is null
    or checkout_environment_id in (
      'local', 'development', 'test', 'preview', 'staging', 'production'
    )
  ),
  add constraint billing_checkout_attempts_product_check check (
    stripe_product_id is null
    or stripe_product_id ~ '^prod_[A-Za-z0-9]+$'
  ),
  add constraint billing_checkout_attempts_trial_eligibility_check check (
    trial_eligibility is null
    or trial_eligibility in ('trial_eligible', 'trial_already_used')
  ),
  add constraint billing_checkout_attempts_checkout_contract_check check (
    checkout_environment_id is null
    or (
      stripe_product_id is not null
      and trial_eligibility is not null
      and stripe_idempotency_key =
        'ff:saas_checkout:' || checkout_environment_id || ':' || id::text || ':v1'
    )
  ) not valid,
  add constraint billing_checkout_attempts_open_session_check check (
    checkout_environment_id is null
    or attempt_status <> 'open'
    or (
      stripe_checkout_session_id is not null
      and session_created_at is not null
      and session_expires_at is not null
      and session_expires_at > session_created_at
    )
  ) not valid;

comment on column public.billing_checkout_attempts.checkout_environment_id is
'Trusted deployment environment used in the stable Stripe idempotency key. Browser callers cannot set it.';
comment on column public.billing_checkout_attempts.stripe_product_id is
'Trusted Product resolved with the Price by the service-only SaaS catalog contract.';
comment on column public.billing_checkout_attempts.trial_eligibility is
'Stable server decision derived only from authoritative trial evidence. Checkout-attempt history alone is neutral.';

create index billing_checkout_attempts_session_rate_idx
  on public.billing_checkout_attempts(store_id, session_created_at desc)
  where session_created_at is not null;

create or replace function public.enforce_billing_checkout_attempt_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.store_id is distinct from old.store_id
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.requested_plan_key is distinct from old.requested_plan_key
     or new.requested_billing_cadence is distinct from old.requested_billing_cadence
     or new.stripe_price_id is distinct from old.stripe_price_id
     or new.stripe_livemode is distinct from old.stripe_livemode
     or new.stripe_account_id is distinct from old.stripe_account_id
     or new.stripe_idempotency_key is distinct from old.stripe_idempotency_key
     or new.checkout_environment_id is distinct from old.checkout_environment_id
     or new.stripe_product_id is distinct from old.stripe_product_id
     or new.trial_eligibility is distinct from old.trial_eligibility then
    raise exception 'Billing Checkout attempt authority fields are immutable.';
  end if;

  if (old.stripe_checkout_session_id is not null
        and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id)
     or (old.stripe_customer_id is not null
        and new.stripe_customer_id is distinct from old.stripe_customer_id)
     or (old.stripe_subscription_id is not null
        and new.stripe_subscription_id is distinct from old.stripe_subscription_id) then
    raise exception 'Billing Checkout provider identifiers cannot be reassigned.';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_billing_checkout_attempt_immutability()
  from public, anon, authenticated, service_role;

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
      'checkout_rate_limited'
    )
  );

create function public.begin_saas_subscription_checkout(
  p_authenticated_user_id uuid,
  p_requested_plan_key text,
  p_requested_billing_cadence text,
  p_stripe_livemode boolean,
  p_stripe_account_id text,
  p_environment_id text
)
returns table (
  checkout_state text,
  attempt_id uuid,
  store_id uuid,
  attempt_status text,
  stripe_price_id text,
  stripe_product_id text,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_idempotency_key text,
  session_created_at timestamptz,
  session_expires_at timestamptz,
  trial_eligibility text,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_store public.stores%rowtype;
  v_onboarding public.seller_onboarding_state%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_attempt public.billing_checkout_attempts%rowtype;
  v_price record;
  v_customer_id text;
  v_trial_used boolean := false;
  v_trial_state text;
  v_recent_15 integer := 0;
  v_recent_24 integer := 0;
  v_retry_at timestamptz;
  v_attempt_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_authenticated_user_id is null then
    raise exception using errcode = '22023', message = 'SAAS_CHECKOUT_USER_REQUIRED';
  end if;
  if p_requested_plan_key not in ('small_flock', 'full_flock') then
    raise exception using errcode = '22023', message = 'SAAS_CHECKOUT_PLAN_INVALID';
  end if;
  if p_requested_billing_cadence not in ('monthly', 'yearly') then
    raise exception using errcode = '22023', message = 'SAAS_CHECKOUT_CADENCE_INVALID';
  end if;
  if p_stripe_account_id is null
     or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'SAAS_CHECKOUT_ACCOUNT_INVALID';
  end if;
  if p_environment_id not in (
    'local', 'development', 'test', 'preview', 'staging', 'production'
  ) then
    raise exception using errcode = '22023', message = 'SAAS_CHECKOUT_ENVIRONMENT_INVALID';
  end if;
  if not coalesce((
    select settings.boolean_value
    from public.platform_settings as settings
    where settings.setting_key = 'saas_subscription_checkout_enabled'
  ), false) then
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_DISABLED';
  end if;

  select stores.*
  into v_store
  from public.stores
  where stores.owner_user_id = p_authenticated_user_id
  order by stores.created_at asc
  limit 1
  for update;

  if v_store.id is null then
    raise exception using errcode = '42501', message = 'SAAS_CHECKOUT_STORE_NOT_OWNED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas_checkout:' || v_store.id::text, 0)
  );
  if v_store.admin_hold_reason is not null then
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_STORE_HELD';
  end if;

  select onboarding.*
  into v_onboarding
  from public.seller_onboarding_state as onboarding
  where onboarding.store_id = v_store.id
  for update;
  if v_onboarding.id is null or not v_onboarding.profile_complete then
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_ONBOARDING_INCOMPLETE';
  end if;

  select status.*
  into v_billing
  from public.seller_billing_status as status
  where status.store_id = v_store.id
  for update;
  if v_billing.id is null then
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_SELECTION_REQUIRED';
  end if;

  if v_billing.billing_state_authority = 'pending_checkout' then
    if v_onboarding.billing_complete
       or v_billing.subscription_status <> 'dormant'
       or v_billing.plan_key is not null
       or v_billing.billing_plan is not null
       or v_billing.trial_started_at is not null
       or v_billing.trial_ends_at is not null
       or v_billing.paid_through_at is not null
       or v_billing.grace_ends_at is not null
       or v_billing.storefront_access_until is not null
       or v_billing.stripe_customer_id is not null
       or v_billing.stripe_subscription_id is not null
       or v_billing.stripe_price_id is not null
       or v_billing.current_subscription_enrollment_id is not null then
      raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_BILLING_STATE_INVALID';
    end if;
  elsif v_billing.billing_state_authority = 'trial'
        and v_billing.subscription_status = 'trialing'
        and v_billing.plan_key in ('small_flock', 'full_flock')
        and v_billing.billing_plan in ('monthly', 'yearly')
        and v_billing.requested_plan_key = v_billing.plan_key
        and v_billing.requested_billing_cadence = v_billing.billing_plan
        and v_billing.trial_started_at is not null
        and v_billing.trial_ends_at =
          v_billing.trial_started_at + interval '7 days'
        and v_billing.current_period_start = v_billing.trial_started_at
        and v_billing.current_period_end = v_billing.trial_ends_at
        and v_billing.storefront_access_until = v_billing.trial_ends_at
        and v_billing.trial_ends_at <= v_now
        and v_billing.stripe_customer_id is null
        and v_billing.stripe_subscription_id is null
        and v_billing.stripe_price_id is null
        and v_billing.current_subscription_enrollment_id is null
        and v_billing.comp_granted_at is null
        and v_billing.paid_through_at is null
        and v_billing.grace_ends_at is null
        and v_billing.last_paid_stripe_invoice_id is null
        and v_billing.latest_invoice_event_id is null
        and v_billing.last_provider_event_id is null then
    null;
  elsif v_billing.billing_state_authority = 'trial'
        and v_billing.trial_ends_at > v_now then
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_LOCAL_TRIAL_ACTIVE';
  else
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_AUTHORITY_CONFLICT';
  end if;

  select attempts.*
  into v_attempt
  from public.billing_checkout_attempts as attempts
  where attempts.store_id = v_store.id
    and attempts.stripe_livemode = p_stripe_livemode
    and attempts.stripe_account_id = p_stripe_account_id
    and attempts.attempt_status in (
      'creating', 'open', 'completed', 'pending_confirmation'
    )
  for update;

  if v_attempt.id is not null
     and (
       v_attempt.requested_plan_key is distinct from p_requested_plan_key
       or v_attempt.requested_billing_cadence is distinct from
         p_requested_billing_cadence
     ) then
    return query select
      'selection_conflict'::text, v_attempt.id, v_store.id,
      v_attempt.attempt_status, null::text, null::text, null::text,
      null::text, null::text, v_attempt.session_created_at,
      v_attempt.session_expires_at, null::text, null::integer;
    return;
  end if;

  if v_billing.requested_plan_key is distinct from p_requested_plan_key
     or v_billing.requested_billing_cadence is distinct from
       p_requested_billing_cadence then
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_SELECTION_MISMATCH';
  end if;

  if exists (
    select 1
    from public.billing_subscription_enrollments as enrollments
    where enrollments.store_id = v_store.id
      and (enrollments.is_current or enrollments.ended_at is null)
  ) then
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_ENROLLMENT_CONFLICT';
  end if;

  select bindings.stripe_customer_id
  into v_customer_id
  from public.billing_customer_bindings as bindings
  where bindings.store_id = v_store.id
    and bindings.stripe_livemode = p_stripe_livemode
    and bindings.stripe_account_id = p_stripe_account_id;

  v_trial_used := v_billing.trial_started_at is not null
    or v_billing.trial_ends_at is not null
    or v_billing.billing_state_authority = 'trial'
    or exists (
      select 1 from public.billing_trial_claims as claims
      where claims.store_id = v_store.id
    )
    or exists (
      select 1
      from public.billing_subscription_enrollments as enrollments
      where enrollments.store_id = v_store.id
        and (
          enrollments.trial_started_at is not null
          or enrollments.trial_ends_at is not null
        )
    );
  v_trial_state := case when v_trial_used
    then 'trial_already_used' else 'trial_eligible' end;

  select catalog.*
  into v_price
  from public.resolve_verified_saas_price(
    p_requested_plan_key,
    p_requested_billing_cadence,
    p_stripe_account_id,
    p_stripe_livemode
  ) as catalog;

  if v_attempt.id is not null then
    if v_attempt.checkout_environment_id is distinct from p_environment_id
       or v_attempt.stripe_price_id is distinct from v_price.stripe_price_id
       or v_attempt.stripe_product_id is distinct from v_price.stripe_product_id
       or v_attempt.trial_eligibility is distinct from v_trial_state then
      raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_ATTEMPT_CONFLICT';
    end if;

    insert into public.billing_entitlement_events (
      store_id, actor_user_id, event_type, plan_key, billing_cadence,
      access_until, metadata
    ) values (
      v_store.id, p_authenticated_user_id, 'checkout_attempt_resumed',
      p_requested_plan_key, p_requested_billing_cadence, null,
      pg_catalog.jsonb_build_object(
        'attempt_id', v_attempt.id,
        'attempt_status', v_attempt.attempt_status,
        'environment_id', p_environment_id,
        'trial_eligibility', v_trial_state
      )
    );

    return query select
      'resumable'::text, v_attempt.id, v_store.id,
      v_attempt.attempt_status, v_attempt.stripe_price_id,
      v_attempt.stripe_product_id, v_customer_id,
      v_attempt.stripe_checkout_session_id, v_attempt.stripe_idempotency_key,
      v_attempt.session_created_at, v_attempt.session_expires_at,
      v_attempt.trial_eligibility, null::integer;
    return;
  end if;

  select
    count(*) filter (where attempts.session_created_at >= v_now - interval '15 minutes')::integer,
    count(*) filter (where attempts.session_created_at >= v_now - interval '24 hours')::integer
  into v_recent_15, v_recent_24
  from public.billing_checkout_attempts as attempts
  where attempts.store_id = v_store.id
    and attempts.session_created_at >= v_now - interval '24 hours';

  if v_recent_15 >= 3 or v_recent_24 >= 10 then
    if v_recent_15 >= 3 then
      select min(attempts.session_created_at) + interval '15 minutes'
      into v_retry_at
      from public.billing_checkout_attempts as attempts
      where attempts.store_id = v_store.id
        and attempts.session_created_at >= v_now - interval '15 minutes';
    else
      select min(attempts.session_created_at) + interval '24 hours'
      into v_retry_at
      from public.billing_checkout_attempts as attempts
      where attempts.store_id = v_store.id
        and attempts.session_created_at >= v_now - interval '24 hours';
    end if;

    insert into public.billing_entitlement_events (
      store_id, actor_user_id, event_type, plan_key, billing_cadence,
      access_until, metadata
    ) values (
      v_store.id, p_authenticated_user_id, 'checkout_rate_limited',
      p_requested_plan_key, p_requested_billing_cadence, null,
      pg_catalog.jsonb_build_object(
        'environment_id', p_environment_id,
        'sessions_15_minutes', v_recent_15,
        'sessions_24_hours', v_recent_24
      )
    );

    return query select
      'rate_limited'::text, null::uuid, v_store.id, null::text,
      null::text, null::text, null::text, null::text, null::text,
      null::timestamptz, null::timestamptz, v_trial_state,
      greatest(1, ceiling(extract(epoch from (v_retry_at - v_now))))::integer;
    return;
  end if;

  v_attempt_id := gen_random_uuid();
  insert into public.billing_checkout_attempts (
    id, store_id, created_by_user_id, requested_plan_key,
    requested_billing_cadence, stripe_price_id, stripe_product_id,
    stripe_livemode, stripe_account_id, checkout_environment_id,
    trial_eligibility, attempt_status, stripe_idempotency_key
  ) values (
    v_attempt_id, v_store.id, p_authenticated_user_id,
    p_requested_plan_key, p_requested_billing_cadence,
    v_price.stripe_price_id, v_price.stripe_product_id,
    p_stripe_livemode, p_stripe_account_id, p_environment_id,
    v_trial_state, 'creating',
    'ff:saas_checkout:' || p_environment_id || ':' || v_attempt_id::text || ':v1'
  ) returning * into v_attempt;

  insert into public.billing_entitlement_events (
    store_id, actor_user_id, event_type, plan_key, billing_cadence,
    access_until, metadata
  ) values (
    v_store.id, p_authenticated_user_id, 'checkout_attempt_started',
    p_requested_plan_key, p_requested_billing_cadence, null,
    pg_catalog.jsonb_build_object(
      'attempt_id', v_attempt.id,
      'environment_id', p_environment_id,
      'trial_eligibility', v_trial_state
    )
  );

  return query select
    'created'::text, v_attempt.id, v_store.id, v_attempt.attempt_status,
    v_attempt.stripe_price_id, v_attempt.stripe_product_id, v_customer_id,
    null::text, v_attempt.stripe_idempotency_key, null::timestamptz,
    null::timestamptz, v_attempt.trial_eligibility, null::integer;
end;
$function$;

create function public.record_saas_checkout_session(
  p_attempt_id uuid,
  p_stripe_checkout_session_id text,
  p_session_created_at timestamptz,
  p_session_expires_at timestamptz,
  p_stripe_livemode boolean,
  p_stripe_account_id text,
  p_stripe_customer_id text default null
)
returns table (record_state text, attempt_status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attempt public.billing_checkout_attempts%rowtype;
  v_expected_session_pattern text := case when p_stripe_livemode
    then '^cs_live_[A-Za-z0-9]+$' else '^cs_test_[A-Za-z0-9]+$' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_attempt_id is null
     or p_stripe_checkout_session_id is null
     or p_stripe_checkout_session_id !~ v_expected_session_pattern
     or p_stripe_account_id is null
     or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
     or p_session_created_at is null
     or p_session_expires_at is null
     or p_session_expires_at <= p_session_created_at
     or (p_stripe_customer_id is not null
       and p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$') then
    raise exception using errcode = '22023', message = 'SAAS_CHECKOUT_SESSION_EVIDENCE_INVALID';
  end if;

  select attempts.* into v_attempt
  from public.billing_checkout_attempts as attempts
  where attempts.id = p_attempt_id
  for update;
  if v_attempt.id is null then
    raise exception using errcode = 'P0002', message = 'SAAS_CHECKOUT_ATTEMPT_NOT_FOUND';
  end if;
  if v_attempt.stripe_livemode is distinct from p_stripe_livemode
     or v_attempt.stripe_account_id is distinct from p_stripe_account_id then
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_CONTEXT_MISMATCH';
  end if;
  if v_attempt.attempt_status not in ('creating', 'open') then
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_ATTEMPT_NOT_RECORDABLE';
  end if;
  if v_attempt.stripe_checkout_session_id is not null then
    if v_attempt.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id
       or v_attempt.session_created_at is distinct from p_session_created_at
       or v_attempt.session_expires_at is distinct from p_session_expires_at
       or (v_attempt.stripe_customer_id is not null
         and v_attempt.stripe_customer_id is distinct from p_stripe_customer_id) then
      raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_SESSION_CONFLICT';
    end if;
    return query select 'already_recorded'::text, v_attempt.attempt_status;
    return;
  end if;

  update public.billing_checkout_attempts as attempts
  set stripe_checkout_session_id = p_stripe_checkout_session_id,
      stripe_customer_id = p_stripe_customer_id,
      session_created_at = p_session_created_at,
      session_expires_at = p_session_expires_at,
      attempt_status = 'open',
      last_failure_code = null
  where attempts.id = v_attempt.id;

  insert into public.billing_entitlement_events (
    store_id, actor_user_id, event_type, plan_key, billing_cadence,
    access_until, metadata
  ) values (
    v_attempt.store_id, v_attempt.created_by_user_id,
    'checkout_session_created', v_attempt.requested_plan_key,
    v_attempt.requested_billing_cadence, null,
    pg_catalog.jsonb_build_object(
      'attempt_id', v_attempt.id,
      'environment_id', v_attempt.checkout_environment_id
    )
  );

  return query select 'recorded'::text, 'open'::text;
end;
$function$;

create function public.mark_saas_checkout_creation_failed(
  p_attempt_id uuid,
  p_failure_code text
)
returns table (failure_state text, attempt_status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attempt public.billing_checkout_attempts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_attempt_id is null
     or p_failure_code is null
     or p_failure_code <> trim(p_failure_code)
     or p_failure_code !~ '^[a-z0-9_]{1,100}$' then
    raise exception using errcode = '22023', message = 'SAAS_CHECKOUT_FAILURE_CODE_INVALID';
  end if;

  select attempts.* into v_attempt
  from public.billing_checkout_attempts as attempts
  where attempts.id = p_attempt_id
  for update;
  if v_attempt.id is null then
    raise exception using errcode = 'P0002', message = 'SAAS_CHECKOUT_ATTEMPT_NOT_FOUND';
  end if;
  if v_attempt.attempt_status = 'failed'
     and v_attempt.last_failure_code = p_failure_code then
    return query select 'already_failed'::text, 'failed'::text;
    return;
  end if;
  if v_attempt.attempt_status <> 'creating'
     or v_attempt.stripe_checkout_session_id is not null then
    raise exception using errcode = '55000', message = 'SAAS_CHECKOUT_ATTEMPT_NOT_FAILABLE';
  end if;

  update public.billing_checkout_attempts as attempts
  set attempt_status = 'failed',
      last_failure_code = p_failure_code
  where attempts.id = v_attempt.id;

  insert into public.billing_entitlement_events (
    store_id, actor_user_id, event_type, plan_key, billing_cadence,
    access_until, metadata
  ) values (
    v_attempt.store_id, v_attempt.created_by_user_id,
    'checkout_creation_failed', v_attempt.requested_plan_key,
    v_attempt.requested_billing_cadence, null,
    pg_catalog.jsonb_build_object(
      'attempt_id', v_attempt.id,
      'failure_code', p_failure_code,
      'environment_id', v_attempt.checkout_environment_id
    )
  );

  return query select 'failed'::text, 'failed'::text;
end;
$function$;

create function public.get_resumable_saas_checkout_attempt(
  p_authenticated_user_id uuid,
  p_attempt_id uuid,
  p_stripe_livemode boolean,
  p_stripe_account_id text,
  p_environment_id text
)
returns table (
  attempt_id uuid,
  store_id uuid,
  attempt_status text,
  stripe_price_id text,
  stripe_product_id text,
  stripe_checkout_session_id text,
  stripe_idempotency_key text,
  session_created_at timestamptz,
  session_expires_at timestamptz,
  trial_eligibility text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  return query
  select attempts.id, attempts.store_id, attempts.attempt_status,
         attempts.stripe_price_id, attempts.stripe_product_id,
         attempts.stripe_checkout_session_id, attempts.stripe_idempotency_key,
         attempts.session_created_at, attempts.session_expires_at,
         attempts.trial_eligibility
  from public.billing_checkout_attempts as attempts
  join public.stores on stores.id = attempts.store_id
  where attempts.id = p_attempt_id
    and stores.owner_user_id = p_authenticated_user_id
    and attempts.stripe_livemode = p_stripe_livemode
    and attempts.stripe_account_id = p_stripe_account_id
    and attempts.checkout_environment_id = p_environment_id
    and attempts.attempt_status in (
      'creating', 'open', 'completed', 'pending_confirmation'
    );
end;
$function$;

revoke all on function public.begin_saas_subscription_checkout(
  uuid, text, text, boolean, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_saas_checkout_session(
  uuid, text, timestamptz, timestamptz, boolean, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.mark_saas_checkout_creation_failed(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_resumable_saas_checkout_attempt(
  uuid, uuid, boolean, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.begin_saas_subscription_checkout(
  uuid, text, text, boolean, text, text
) to service_role;
grant execute on function public.record_saas_checkout_session(
  uuid, text, timestamptz, timestamptz, boolean, text, text
) to service_role;
grant execute on function public.mark_saas_checkout_creation_failed(uuid, text)
  to service_role;
grant execute on function public.get_resumable_saas_checkout_attempt(
  uuid, uuid, boolean, text, text
) to service_role;

comment on function public.begin_saas_subscription_checkout(
  uuid, text, text, boolean, text, text
) is 'Service-only owner-bound, catalog-resolved, rate-limited creation or resumption of one SaaS Checkout attempt. It grants no access and consumes no trial.';
comment on function public.record_saas_checkout_session(
  uuid, text, timestamptz, timestamptz, boolean, text, text
) is 'Service-only recording of narrow Stripe Checkout Session creation evidence. It creates no Customer binding, enrollment, trial claim, or entitlement.';
comment on function public.mark_saas_checkout_creation_failed(uuid, text)
  is 'Service-only terminal failure transition for a definitively failed pre-Session creation attempt using a bounded stable code.';
comment on function public.get_resumable_saas_checkout_attempt(
  uuid, uuid, boolean, text, text
) is 'Service-only owner and provider-context lookup of one unresolved SaaS Checkout attempt.';

-- Deploying the contracts must not activate Checkout or Portal behavior.
update public.platform_settings
set boolean_value = false,
    updated_by_user_id = null
where setting_key in (
  'saas_subscription_checkout_enabled',
  'saas_billing_portal_enabled'
);

commit;
