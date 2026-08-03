-- Controlled seller Billing Portal rollout and verified resume completion.
--
-- This migration adds no cohort members and leaves both SaaS feature flags
-- disabled. Portal and resume authority remains server-side and continues to
-- depend on the immutable Customer and Subscription bindings from Batch 10.

begin;

create table public.saas_billing_portal_store_cohort (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  is_active boolean not null default true,
  activated_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),

  constraint saas_billing_portal_store_cohort_state_check check (
    (is_active and revoked_at is null)
    or (not is_active and revoked_at is not null)
  )
);

comment on table public.saas_billing_portal_store_cohort is
'Service-managed, append-preserving allowlist for controlled seller Billing Portal rollout. Membership is not billing or entitlement authority.';

create unique index saas_billing_portal_store_cohort_one_active_idx
  on public.saas_billing_portal_store_cohort (store_id)
  where is_active;

create index saas_billing_portal_store_cohort_history_idx
  on public.saas_billing_portal_store_cohort (store_id, activated_at desc);

create trigger saas_billing_portal_store_cohort_set_updated_at
before update on public.saas_billing_portal_store_cohort
for each row execute function public.set_updated_at();

create function public.enforce_saas_billing_portal_cohort_history()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000',
      message = 'SAAS_BILLING_PORTAL_COHORT_HISTORY_IMMUTABLE';
  end if;
  if new.id is distinct from old.id
     or new.store_id is distinct from old.store_id
     or new.activated_at is distinct from old.activated_at
     or new.created_at is distinct from old.created_at
     or (not old.is_active and new.is_active)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception using errcode = '55000',
      message = 'SAAS_BILLING_PORTAL_COHORT_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_saas_billing_portal_cohort_history()
  from public, anon, authenticated, service_role;

create trigger saas_billing_portal_store_cohort_preserve_history
before update or delete on public.saas_billing_portal_store_cohort
for each row execute function public.enforce_saas_billing_portal_cohort_history();

alter table public.saas_billing_portal_store_cohort enable row level security;
revoke all on table public.saas_billing_portal_store_cohort
  from public, anon, authenticated;
grant select, insert, update on table public.saas_billing_portal_store_cohort
  to service_role;

create function public.set_saas_billing_portal_store_cohort(
  p_store_id uuid,
  p_is_active boolean
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_existing public.saas_billing_portal_store_cohort%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_store_id is null or p_is_active is null then
    raise exception using errcode = '22023',
      message = 'SAAS_BILLING_PORTAL_COHORT_INPUT_INVALID';
  end if;

  perform 1 from public.stores where id = p_store_id for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'SAAS_BILLING_PORTAL_COHORT_STORE_NOT_FOUND';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'saas-billing-portal-cohort:' || p_store_id::text, 0
    )
  );

  select cohort.* into v_existing
  from public.saas_billing_portal_store_cohort as cohort
  where cohort.store_id = p_store_id and cohort.is_active
  order by cohort.activated_at desc, cohort.id
  limit 1
  for update;

  if p_is_active then
    if v_existing.id is not null then
      return 'already_active';
    end if;
    insert into public.saas_billing_portal_store_cohort (store_id)
    values (p_store_id);
    return 'activated';
  end if;

  if v_existing.id is null then
    return 'already_inactive';
  end if;
  update public.saas_billing_portal_store_cohort
  set is_active = false,
      revoked_at = statement_timestamp()
  where id = v_existing.id;
  return 'revoked';
end;
$function$;

comment on function public.set_saas_billing_portal_store_cohort(uuid,boolean) is
'Service-only activation or append-preserving revocation of one store Billing Portal cohort membership. It changes no billing or entitlement state.';

revoke all on function public.set_saas_billing_portal_store_cohort(uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.set_saas_billing_portal_store_cohort(uuid,boolean)
  to service_role;

-- Preserve the exact Batch 10 Portal authorization implementation behind a
-- private compatibility helper. The new public RPC adds only the master flag
-- and controlled-cohort boundary before delegating to it.
alter function public.begin_saas_billing_portal_action(uuid,text,boolean,text,text)
  rename to begin_saas_billing_portal_action_unscoped_v1;
revoke all on function public.begin_saas_billing_portal_action_unscoped_v1(uuid,text,boolean,text,text)
  from public, anon, authenticated, service_role;

create function public.begin_saas_billing_portal_action(
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
declare
  v_store_id uuid;
  v_cohort_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_authenticated_user_id is null then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_USER_REQUIRED';
  end if;
  if p_action_type not in (
    'portal_general', 'portal_payment_method_update',
    'portal_invoice_history', 'portal_cancel_subscription'
  ) then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_ACTION_INVALID';
  end if;
  if p_stripe_account_id is null
     or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_ACCOUNT_INVALID';
  end if;
  if p_environment_id not in (
    'local', 'development', 'test', 'preview', 'staging', 'production'
  ) then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_ENVIRONMENT_INVALID';
  end if;
  if not coalesce((
    select boolean_value from public.platform_settings
    where setting_key = 'saas_billing_portal_enabled'
  ), false) then
    raise exception using errcode = '55000', message = 'SAAS_BILLING_PORTAL_DISABLED';
  end if;

  select stores.id into v_store_id
  from public.stores as stores
  where stores.owner_user_id = p_authenticated_user_id
  order by stores.created_at, stores.id
  limit 1;
  if v_store_id is null then
    raise exception using errcode = '42501', message = 'BILLING_MANAGEMENT_STORE_NOT_OWNED';
  end if;

  select cohort.id into v_cohort_id
  from public.saas_billing_portal_store_cohort as cohort
  where cohort.store_id = v_store_id and cohort.is_active
  order by cohort.activated_at desc, cohort.id
  limit 1
  for share;
  if v_cohort_id is null then
    raise exception using errcode = '55000',
      message = 'SAAS_BILLING_PORTAL_COHORT_REQUIRED';
  end if;

  return query
  select * from public.begin_saas_billing_portal_action_unscoped_v1(
    p_authenticated_user_id, p_action_type, p_stripe_livemode,
    p_stripe_account_id, p_environment_id
  );
end;
$function$;

revoke all on function public.begin_saas_billing_portal_action(uuid,text,boolean,text,text)
  from public, anon, authenticated;
grant execute on function public.begin_saas_billing_portal_action(uuid,text,boolean,text,text)
  to service_role;

alter function public.begin_saas_subscription_resume(uuid,boolean,text,text)
  rename to begin_saas_subscription_resume_unscoped_v1;
revoke all on function public.begin_saas_subscription_resume_unscoped_v1(uuid,boolean,text,text)
  from public, anon, authenticated, service_role;

create function public.begin_saas_subscription_resume(
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
declare
  v_store_id uuid;
  v_cohort_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_authenticated_user_id is null then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_USER_REQUIRED';
  end if;
  if p_stripe_account_id is null
     or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
     or p_environment_id not in (
       'local', 'development', 'test', 'preview', 'staging', 'production'
     ) then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_CONTEXT_INVALID';
  end if;
  if not coalesce((
    select boolean_value from public.platform_settings
    where setting_key = 'saas_billing_portal_enabled'
  ), false) then
    raise exception using errcode = '55000', message = 'SAAS_BILLING_PORTAL_DISABLED';
  end if;

  select stores.id into v_store_id
  from public.stores as stores
  where stores.owner_user_id = p_authenticated_user_id
  order by stores.created_at, stores.id
  limit 1;
  if v_store_id is null then
    raise exception using errcode = '42501', message = 'BILLING_MANAGEMENT_STORE_NOT_OWNED';
  end if;

  select cohort.id into v_cohort_id
  from public.saas_billing_portal_store_cohort as cohort
  where cohort.store_id = v_store_id and cohort.is_active
  order by cohort.activated_at desc, cohort.id
  limit 1
  for share;
  if v_cohort_id is null then
    raise exception using errcode = '55000',
      message = 'SAAS_BILLING_PORTAL_COHORT_REQUIRED';
  end if;

  return query
  select * from public.begin_saas_subscription_resume_unscoped_v1(
    p_authenticated_user_id, p_stripe_livemode,
    p_stripe_account_id, p_environment_id
  );
end;
$function$;

revoke all on function public.begin_saas_subscription_resume(uuid,boolean,text,text)
  from public, anon, authenticated;
grant execute on function public.begin_saas_subscription_resume(uuid,boolean,text,text)
  to service_role;

-- Keep the Batch 9 projection as a private base and add only cohort-aware
-- Portal presentation plus a distinct active canceling-trial lifecycle.
alter function public.seller_get_saas_billing_status()
  rename to seller_get_saas_billing_status_base_v1;
revoke all on function public.seller_get_saas_billing_status_base_v1()
  from public, anon, authenticated, service_role;

create function public.seller_get_saas_billing_status()
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
  v_store_id uuid;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  select stores.id into v_store_id
  from public.stores as stores
  where stores.owner_user_id = v_user_id
  order by stores.created_at, stores.id
  limit 1;

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
    coalesce(base.portal_enabled, false) and exists (
      select 1 from public.saas_billing_portal_store_cohort as cohort
      where cohort.store_id = v_store_id and cohort.is_active
    ),
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
'Owner-only read model. Portal availability requires the disabled-by-default master flag and active same-store cohort membership; lifecycle remains presentation only.';

revoke all on function public.seller_get_saas_billing_status()
  from public, anon, authenticated;
grant execute on function public.seller_get_saas_billing_status()
  to authenticated;

-- A resume request becomes complete only as a consequence of the exact
-- verified Subscription update that the existing typed application function
-- accepted and finalized. This trigger changes audit state only.
create function public.complete_saas_resume_action_from_verified_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_binding public.billing_customer_bindings%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_catalog public.billing_provider_price_catalog%rowtype;
begin
  if old.processing_status is not distinct from 'processed'
     or new.processing_status is distinct from 'processed'
     or not coalesce(new.applied, false)
     or new.event_type is distinct from 'customer.subscription.updated'
     or new.provider_object_type is distinct from 'subscription'
     or new.provider_object_id is null
     or new.store_id is null
     or new.processing_environment_id is null
     or new.ignored_reason is not null then
    return new;
  end if;

  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.store_id = new.store_id
    and enrollment.stripe_subscription_id = new.provider_object_id
    and enrollment.stripe_account_id = new.stripe_account_id
    and enrollment.stripe_livemode = new.stripe_livemode
    and enrollment.is_current
    and enrollment.ended_at is null
    and not enrollment.cancel_at_period_end
    and enrollment.last_subscription_event_id = new.provider_event_id
    and enrollment.last_subscription_event_created_at = new.provider_event_created_at;
  if v_enrollment.id is null then
    return new;
  end if;

  select binding.* into v_binding
  from public.billing_customer_bindings as binding
  where binding.id = v_enrollment.customer_binding_id
    and binding.store_id = v_enrollment.store_id
    and binding.stripe_account_id = new.stripe_account_id
    and binding.stripe_livemode = new.stripe_livemode;
  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = v_enrollment.store_id
    and status.current_subscription_enrollment_id = v_enrollment.id
    and status.stripe_customer_id = v_binding.stripe_customer_id
    and status.stripe_subscription_id = v_enrollment.stripe_subscription_id
    and status.stripe_account_id = new.stripe_account_id
    and status.stripe_livemode = new.stripe_livemode
    and status.last_provider_event_id = new.provider_event_id
    and status.last_provider_event_created_at = new.provider_event_created_at
    and status.subscription_status = v_enrollment.provider_status
    and not status.cancel_at_period_end;
  select catalog.* into v_catalog
  from public.billing_provider_price_catalog as catalog
  where catalog.stripe_price_id = v_billing.stripe_price_id
    and catalog.stripe_price_id = v_enrollment.initial_stripe_price_id
    and catalog.stripe_account_id = new.stripe_account_id
    and catalog.stripe_livemode = new.stripe_livemode
    and catalog.is_verified
    and catalog.is_active
    and catalog.stripe_price_active
    and catalog.stripe_product_active
    and catalog.plan_key = v_billing.plan_key
    and catalog.billing_cadence = v_billing.billing_plan;

  if v_binding.id is null or v_billing.id is null or v_catalog.stripe_price_id is null then
    return new;
  end if;

  update public.billing_management_action_requests as action
  set request_status = 'completed',
      completed_at = coalesce(new.processed_at, statement_timestamp())
  where action.store_id = v_enrollment.store_id
    and action.subscription_enrollment_id = v_enrollment.id
    and action.action_type = 'resume_subscription'
    and action.request_status = 'provider_requested'
    and action.stripe_subscription_id = v_enrollment.stripe_subscription_id
    and action.stripe_account_id = new.stripe_account_id
    and action.stripe_livemode = new.stripe_livemode
    and action.environment_id = new.processing_environment_id;

  return new;
end;
$function$;

revoke all on function public.complete_saas_resume_action_from_verified_event()
  from public, anon, authenticated, service_role;

create trigger billing_provider_events_complete_verified_resume
after update of processing_status on public.billing_provider_events
for each row execute function public.complete_saas_resume_action_from_verified_event();

-- Deployment of this safety layer must activate neither enrollment nor Portal.
update public.platform_settings
set boolean_value = false,
    updated_by_user_id = null
where setting_key in (
  'saas_subscription_checkout_enabled',
  'saas_billing_portal_enabled'
);

commit;
