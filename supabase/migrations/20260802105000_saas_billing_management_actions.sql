-- Batch 10: service-only audit and authorization contracts for Stripe Billing
-- Portal sessions and seller-requested subscription resume operations.
-- These records are request evidence only. They never establish billing truth.

begin;

alter table public.billing_subscription_enrollments
  add constraint billing_subscription_enrollments_management_context_unique
  unique (id, store_id, stripe_subscription_id, stripe_livemode, stripe_account_id);

create table public.billing_management_action_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  subscription_enrollment_id uuid not null,
  action_type text not null,
  request_status text not null default 'requested',
  stripe_account_id text not null,
  stripe_livemode boolean not null,
  environment_id text not null,
  stripe_portal_session_id text,
  stripe_portal_configuration_id text,
  stripe_subscription_id text not null,
  stripe_idempotency_key text,
  requested_at timestamptz not null default statement_timestamp(),
  provider_requested_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),

  constraint billing_management_actions_enrollment_context_fk foreign key (
    subscription_enrollment_id, store_id, stripe_subscription_id,
    stripe_livemode, stripe_account_id
  ) references public.billing_subscription_enrollments (
    id, store_id, stripe_subscription_id, stripe_livemode, stripe_account_id
  ) on delete restrict,
  constraint billing_management_actions_type_check check (
    action_type in (
      'portal_general',
      'portal_payment_method_update',
      'portal_invoice_history',
      'portal_cancel_subscription',
      'resume_subscription'
    )
  ),
  constraint billing_management_actions_status_check check (
    request_status in (
      'requested', 'provider_requested', 'completed', 'failed', 'rate_limited'
    )
  ),
  constraint billing_management_actions_account_check check (
    stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  ),
  constraint billing_management_actions_environment_check check (
    environment_id in (
      'local', 'development', 'test', 'preview', 'staging', 'production'
    )
  ),
  constraint billing_management_actions_subscription_check check (
    stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
  ),
  constraint billing_management_actions_portal_session_check check (
    stripe_portal_session_id is null
    or stripe_portal_session_id ~ '^bps_[A-Za-z0-9]+$'
  ),
  constraint billing_management_actions_portal_config_check check (
    stripe_portal_configuration_id is null
    or stripe_portal_configuration_id ~ '^bpc_[A-Za-z0-9]+$'
  ),
  constraint billing_management_actions_idempotency_check check (
    stripe_idempotency_key is null
    or length(trim(stripe_idempotency_key)) between 1 and 255
  ),
  constraint billing_management_actions_failure_code_check check (
    failure_code is null or failure_code ~ '^[a-z0-9_]{1,100}$'
  ),
  constraint billing_management_actions_shape_check check (
    (
      action_type = 'resume_subscription'
      and stripe_idempotency_key is not null
      and stripe_portal_session_id is null
      and stripe_portal_configuration_id is null
    ) or (
      action_type <> 'resume_subscription'
      and stripe_idempotency_key is null
    )
  ),
  constraint billing_management_actions_state_time_check check (
    (request_status <> 'provider_requested' or provider_requested_at is not null)
    and (request_status <> 'completed' or completed_at is not null)
    and (request_status <> 'failed' or (failed_at is not null and failure_code is not null))
    and (request_status <> 'rate_limited' or completed_at is not null)
  )
);

comment on table public.billing_management_action_requests is
'Service-only, append-preserving audit of seller billing-management requests. Rows are not provider truth and never grant or revoke access.';
comment on column public.billing_management_action_requests.requested_by_user_id is
'Verified Supabase user whose store ownership was derived by a service-role function.';
comment on column public.billing_management_action_requests.stripe_idempotency_key is
'Server-generated resume idempotency key. It contains no seller PII and is never browser supplied.';

create unique index billing_management_actions_portal_session_unique_idx
  on public.billing_management_action_requests (
    stripe_portal_session_id, stripe_livemode, stripe_account_id
  ) where stripe_portal_session_id is not null;

create unique index billing_management_actions_resume_idempotency_unique_idx
  on public.billing_management_action_requests (
    stripe_idempotency_key, stripe_livemode, stripe_account_id
  ) where stripe_idempotency_key is not null;

create unique index billing_management_actions_one_pending_resume_idx
  on public.billing_management_action_requests (
    subscription_enrollment_id, stripe_livemode, stripe_account_id
  ) where action_type = 'resume_subscription'
    and request_status in ('requested', 'provider_requested');

create index billing_management_actions_store_requested_idx
  on public.billing_management_action_requests (store_id, requested_at desc);

create trigger billing_management_actions_set_updated_at
before update on public.billing_management_action_requests
for each row execute function public.set_updated_at();

create function public.enforce_billing_management_action_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.id is distinct from old.id
     or new.store_id is distinct from old.store_id
     or new.requested_by_user_id is distinct from old.requested_by_user_id
     or new.subscription_enrollment_id is distinct from old.subscription_enrollment_id
     or new.action_type is distinct from old.action_type
     or new.stripe_account_id is distinct from old.stripe_account_id
     or new.stripe_livemode is distinct from old.stripe_livemode
     or new.environment_id is distinct from old.environment_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.stripe_idempotency_key is distinct from old.stripe_idempotency_key
     or new.requested_at is distinct from old.requested_at
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_ACTION_IDENTITY_IMMUTABLE';
  end if;
  if old.stripe_portal_session_id is not null
     and new.stripe_portal_session_id is distinct from old.stripe_portal_session_id then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_PORTAL_SESSION_IMMUTABLE';
  end if;
  if old.stripe_portal_configuration_id is not null
     and new.stripe_portal_configuration_id is distinct from old.stripe_portal_configuration_id then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_PORTAL_CONFIG_IMMUTABLE';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_billing_management_action_immutability()
  from public, anon, authenticated, service_role;

create trigger billing_management_actions_enforce_immutability
before update on public.billing_management_action_requests
for each row execute function public.enforce_billing_management_action_immutability();

alter table public.billing_management_action_requests enable row level security;
revoke all on table public.billing_management_action_requests
  from public, anon, authenticated;
grant select, insert, update on table public.billing_management_action_requests
  to service_role;

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
  v_now timestamptz := statement_timestamp();
  v_store public.stores%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_binding public.billing_customer_bindings%rowtype;
  v_action_id uuid := gen_random_uuid();
  v_recent integer;
  v_retry_at timestamptz;
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
  if p_stripe_account_id is null or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_ACCOUNT_INVALID';
  end if;
  if p_environment_id not in ('local','development','test','preview','staging','production') then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_ENVIRONMENT_INVALID';
  end if;
  if not coalesce((select boolean_value from public.platform_settings
                   where setting_key = 'saas_billing_portal_enabled'), false) then
    raise exception using errcode = '55000', message = 'SAAS_BILLING_PORTAL_DISABLED';
  end if;

  select stores.* into v_store
  from public.stores where stores.owner_user_id = p_authenticated_user_id
  order by stores.created_at, stores.id limit 1 for update;
  if v_store.id is null then
    raise exception using errcode = '42501', message = 'BILLING_MANAGEMENT_STORE_NOT_OWNED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas_billing_management:' || v_store.id::text, 0)
  );
  if v_store.admin_hold_reason is not null then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_STORE_HELD';
  end if;

  select status.* into v_billing from public.seller_billing_status status
  where status.store_id = v_store.id for update;
  if v_billing.id is null
     or v_billing.billing_state_authority <> 'stripe'
     or v_billing.current_subscription_enrollment_id is null
     or v_billing.subscription_status not in (
       'trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete'
     ) then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_STATE_INELIGIBLE';
  end if;

  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments enrollment
  where enrollment.id = v_billing.current_subscription_enrollment_id
    and enrollment.store_id = v_store.id
    and enrollment.stripe_livemode = p_stripe_livemode
    and enrollment.stripe_account_id = p_stripe_account_id
    and enrollment.is_current
    and enrollment.ended_at is null
  for update;
  if v_enrollment.id is null
     or v_enrollment.provider_status not in (
       'trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete'
     )
     or v_enrollment.provider_status is distinct from v_billing.subscription_status
     or v_enrollment.cancel_at_period_end is distinct from v_billing.cancel_at_period_end then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_ENROLLMENT_INVALID';
  end if;

  select binding.* into v_binding
  from public.billing_customer_bindings binding
  where binding.id = v_enrollment.customer_binding_id
    and binding.store_id = v_store.id
    and binding.stripe_livemode = p_stripe_livemode
    and binding.stripe_account_id = p_stripe_account_id;
  if v_binding.id is null
     or v_billing.stripe_customer_id is distinct from v_binding.stripe_customer_id
     or v_billing.stripe_subscription_id is distinct from v_enrollment.stripe_subscription_id then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_BINDING_INVALID';
  end if;

  if p_action_type = 'portal_cancel_subscription'
     and (v_billing.cancel_at_period_end
          or v_billing.subscription_status not in ('trialing','active','past_due','unpaid')) then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_CANCEL_INELIGIBLE';
  end if;

  select count(*)::integer, min(actions.requested_at) + interval '15 minutes'
  into v_recent, v_retry_at
  from public.billing_management_action_requests actions
  where actions.store_id = v_store.id
    and actions.action_type like 'portal_%'
    and actions.requested_at >= v_now - interval '15 minutes'
    and actions.request_status <> 'rate_limited';

  if v_recent >= 5 then
    insert into public.billing_management_action_requests (
      id, store_id, requested_by_user_id, subscription_enrollment_id,
      action_type, request_status, stripe_account_id, stripe_livemode,
      environment_id, stripe_subscription_id, completed_at
    ) values (
      v_action_id, v_store.id, p_authenticated_user_id, v_enrollment.id,
      p_action_type, 'rate_limited', p_stripe_account_id, p_stripe_livemode,
      p_environment_id, v_enrollment.stripe_subscription_id, v_now
    );
    return query select 'rate_limited'::text, v_action_id, v_store.id,
      null::text, null::text,
      greatest(1, ceiling(extract(epoch from (v_retry_at - v_now))))::integer;
    return;
  end if;

  insert into public.billing_management_action_requests (
    id, store_id, requested_by_user_id, subscription_enrollment_id,
    action_type, request_status, stripe_account_id, stripe_livemode,
    environment_id, stripe_subscription_id
  ) values (
    v_action_id, v_store.id, p_authenticated_user_id, v_enrollment.id,
    p_action_type, 'requested', p_stripe_account_id, p_stripe_livemode,
    p_environment_id, v_enrollment.stripe_subscription_id
  );

  return query select 'created'::text, v_action_id, v_store.id,
    v_binding.stripe_customer_id, v_enrollment.stripe_subscription_id,
    null::integer;
end;
$function$;

create function public.record_saas_billing_portal_session(
  p_action_request_id uuid,
  p_stripe_portal_session_id text,
  p_stripe_portal_configuration_id text,
  p_provider_requested_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_action public.billing_management_action_requests%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_stripe_portal_session_id !~ '^bps_[A-Za-z0-9]+$'
     or p_stripe_portal_configuration_id !~ '^bpc_[A-Za-z0-9]+$'
     or p_provider_requested_at is null then
    raise exception using errcode = '22023', message = 'BILLING_PORTAL_SESSION_EVIDENCE_INVALID';
  end if;
  select * into v_action from public.billing_management_action_requests
  where id = p_action_request_id for update;
  if v_action.id is null or v_action.action_type not like 'portal_%' then
    raise exception using errcode = '55000', message = 'BILLING_PORTAL_ACTION_INVALID';
  end if;
  if v_action.request_status = 'completed'
     and v_action.stripe_portal_session_id = p_stripe_portal_session_id
     and v_action.stripe_portal_configuration_id = p_stripe_portal_configuration_id then
    return 'already_recorded';
  end if;
  if v_action.request_status <> 'requested' then
    raise exception using errcode = '55000', message = 'BILLING_PORTAL_ACTION_STATE_INVALID';
  end if;
  update public.billing_management_action_requests set
    request_status = 'completed',
    stripe_portal_session_id = p_stripe_portal_session_id,
    stripe_portal_configuration_id = p_stripe_portal_configuration_id,
    provider_requested_at = p_provider_requested_at,
    completed_at = statement_timestamp(),
    failure_code = null,
    failed_at = null
  where id = v_action.id;
  return 'recorded';
end;
$function$;

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
  v_store public.stores%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_entitlement record;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_binding public.billing_customer_bindings%rowtype;
  v_action public.billing_management_action_requests%rowtype;
  v_action_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_authenticated_user_id is null then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_USER_REQUIRED';
  end if;
  if p_stripe_account_id is null or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
     or p_environment_id not in ('local','development','test','preview','staging','production') then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_CONTEXT_INVALID';
  end if;
  if not coalesce((select boolean_value from public.platform_settings
                   where setting_key = 'saas_billing_portal_enabled'), false) then
    raise exception using errcode = '55000', message = 'SAAS_BILLING_PORTAL_DISABLED';
  end if;

  select stores.* into v_store from public.stores
  where stores.owner_user_id = p_authenticated_user_id
  order by stores.created_at, stores.id limit 1 for update;
  if v_store.id is null then
    raise exception using errcode = '42501', message = 'BILLING_MANAGEMENT_STORE_NOT_OWNED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas_billing_management:' || v_store.id::text, 0)
  );
  if v_store.admin_hold_reason is not null then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_STORE_HELD';
  end if;
  select status.* into v_billing from public.seller_billing_status status
  where status.store_id = v_store.id for update;
  select * into v_entitlement from public.resolve_store_entitlement(v_store.id);
  if v_billing.id is null
     or v_billing.billing_state_authority <> 'stripe'
     or not v_billing.cancel_at_period_end
     or v_billing.current_subscription_enrollment_id is null
     or v_billing.subscription_status not in ('trialing','active','past_due','unpaid')
     or not coalesce(v_entitlement.has_active_access, false) then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_RESUME_INELIGIBLE';
  end if;
  select enrollment.* into v_enrollment from public.billing_subscription_enrollments enrollment
  where enrollment.id = v_billing.current_subscription_enrollment_id
    and enrollment.store_id = v_store.id
    and enrollment.stripe_livemode = p_stripe_livemode
    and enrollment.stripe_account_id = p_stripe_account_id
    and enrollment.is_current and enrollment.ended_at is null for update;
  if v_enrollment.id is null then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_ENROLLMENT_INVALID';
  end if;
  if v_enrollment.provider_status is distinct from v_billing.subscription_status
     or not v_enrollment.cancel_at_period_end then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_ENROLLMENT_INVALID';
  end if;
  select binding.* into v_binding from public.billing_customer_bindings binding
  where binding.id = v_enrollment.customer_binding_id
    and binding.store_id = v_store.id
    and binding.stripe_livemode = p_stripe_livemode
    and binding.stripe_account_id = p_stripe_account_id;
  if v_binding.id is null
     or v_billing.stripe_customer_id is distinct from v_binding.stripe_customer_id
     or v_billing.stripe_subscription_id is distinct from v_enrollment.stripe_subscription_id then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_BINDING_INVALID';
  end if;

  select actions.* into v_action from public.billing_management_action_requests actions
  where actions.subscription_enrollment_id = v_enrollment.id
    and actions.action_type = 'resume_subscription'
    and actions.request_status in ('requested','provider_requested')
  for update;
  if v_action.id is not null then
    return query select
      case when v_action.request_status = 'provider_requested'
        then 'already_requested' else 'resumable' end,
      v_action.id, v_store.id, v_binding.stripe_customer_id,
      v_enrollment.stripe_subscription_id, v_action.stripe_idempotency_key;
    return;
  end if;

  v_action_id := gen_random_uuid();
  insert into public.billing_management_action_requests (
    id, store_id, requested_by_user_id, subscription_enrollment_id,
    action_type, request_status, stripe_account_id, stripe_livemode,
    environment_id, stripe_subscription_id, stripe_idempotency_key
  ) values (
    v_action_id, v_store.id, p_authenticated_user_id, v_enrollment.id,
    'resume_subscription', 'requested', p_stripe_account_id, p_stripe_livemode,
    p_environment_id, v_enrollment.stripe_subscription_id,
    'ff:saas_resume:' || p_environment_id || ':' || v_action_id::text || ':v1'
  ) returning * into v_action;
  return query select 'created'::text, v_action.id, v_store.id,
    v_binding.stripe_customer_id, v_enrollment.stripe_subscription_id,
    v_action.stripe_idempotency_key;
end;
$function$;

create function public.record_saas_subscription_resume_requested(
  p_action_request_id uuid,
  p_provider_requested_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_action public.billing_management_action_requests%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  select * into v_action from public.billing_management_action_requests
  where id = p_action_request_id for update;
  if v_action.id is null or v_action.action_type <> 'resume_subscription'
     or p_provider_requested_at is null then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_RESUME_ACTION_INVALID';
  end if;
  if v_action.request_status = 'provider_requested' then return 'already_recorded'; end if;
  if v_action.request_status <> 'requested' then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_RESUME_STATE_INVALID';
  end if;
  update public.billing_management_action_requests set
    request_status = 'provider_requested',
    provider_requested_at = p_provider_requested_at
  where id = v_action.id;
  return 'recorded';
end;
$function$;

create function public.mark_saas_billing_management_action_failed(
  p_action_request_id uuid,
  p_failure_code text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_action public.billing_management_action_requests%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{1,100}$' then
    raise exception using errcode = '22023', message = 'BILLING_MANAGEMENT_FAILURE_CODE_INVALID';
  end if;
  select * into v_action from public.billing_management_action_requests
  where id = p_action_request_id for update;
  if v_action.id is null then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_ACTION_NOT_FOUND';
  end if;
  if v_action.request_status in ('completed','provider_requested') then
    raise exception using errcode = '55000', message = 'BILLING_MANAGEMENT_ACTION_TERMINAL';
  end if;
  update public.billing_management_action_requests set
    request_status = 'failed', failed_at = statement_timestamp(),
    failure_code = p_failure_code
  where id = v_action.id;
  return 'failed';
end;
$function$;

comment on function public.begin_saas_billing_portal_action(uuid,text,boolean,text,text) is
'Service-only authorization, ownership, immutable-binding, feature-flag, and rate-limit contract for seller Portal requests.';
comment on function public.begin_saas_subscription_resume(uuid,boolean,text,text) is
'Service-only authorization contract for seller intent to clear provider cancellation scheduling. It does not change authoritative billing state.';

revoke all on function public.begin_saas_billing_portal_action(uuid,text,boolean,text,text)
  from public, anon, authenticated;
revoke all on function public.record_saas_billing_portal_session(uuid,text,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.begin_saas_subscription_resume(uuid,boolean,text,text)
  from public, anon, authenticated;
revoke all on function public.record_saas_subscription_resume_requested(uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.mark_saas_billing_management_action_failed(uuid,text)
  from public, anon, authenticated;
grant execute on function public.begin_saas_billing_portal_action(uuid,text,boolean,text,text)
  to service_role;
grant execute on function public.record_saas_billing_portal_session(uuid,text,text,timestamptz)
  to service_role;
grant execute on function public.begin_saas_subscription_resume(uuid,boolean,text,text)
  to service_role;
grant execute on function public.record_saas_subscription_resume_requested(uuid,timestamptz)
  to service_role;
grant execute on function public.mark_saas_billing_management_action_failed(uuid,text)
  to service_role;

-- Deployment of this foundation must not expose billing management.
update public.platform_settings
set boolean_value = false, updated_by_user_id = null
where setting_key in (
  'saas_subscription_checkout_enabled', 'saas_billing_portal_enabled'
);

commit;
