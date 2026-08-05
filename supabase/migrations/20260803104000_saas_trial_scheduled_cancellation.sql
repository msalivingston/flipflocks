-- Preserve Stripe's literal cancellation scheduling fields while retaining the
-- existing normalized cancel_at_period_end read-model contract.
begin;

alter table public.billing_subscription_enrollments
  add column provider_cancel_at_period_end boolean not null default false,
  add column provider_cancel_at timestamptz;

alter table public.seller_billing_status
  add column provider_cancel_at_period_end boolean not null default false,
  add column provider_cancel_at timestamptz;

update public.billing_subscription_enrollments as enrollment
set provider_cancel_at_period_end = enrollment.cancel_at_period_end;

update public.seller_billing_status as status
set provider_cancel_at_period_end = status.cancel_at_period_end;

alter table public.billing_subscription_enrollments
  add constraint billing_subscription_enrollments_normalized_cancel_check check (
    (not provider_cancel_at_period_end or cancel_at_period_end)
    and (provider_cancel_at is null or cancel_at_period_end)
  );

alter table public.seller_billing_status
  add constraint seller_billing_status_normalized_cancel_check check (
    (not provider_cancel_at_period_end or cancel_at_period_end)
    and (provider_cancel_at is null or cancel_at_period_end)
  );

comment on column public.billing_subscription_enrollments.cancel_at_period_end is
'Normalized verified scheduled-cancellation state. True for Stripe cancel_at_period_end or an exact provider cancel_at boundary.';
comment on column public.billing_subscription_enrollments.provider_cancel_at_period_end is
'Literal provider cancel_at_period_end snapshot.';
comment on column public.billing_subscription_enrollments.provider_cancel_at is
'Literal provider cancel_at timestamp. Never browser supplied.';
comment on column public.seller_billing_status.cancel_at_period_end is
'Normalized verified scheduled-cancellation state used by entitlement presentation and billing management.';

create function public.normalize_verified_saas_scheduled_cancellation(
  p_subscription_status text,
  p_current_period_end timestamptz,
  p_verified_trial_end timestamptz,
  p_provider_cancel_at_period_end boolean,
  p_provider_cancel_at timestamptz
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
begin
  if p_provider_cancel_at_period_end is null then
    raise exception using errcode = '22023',
      message = 'SAAS_SUBSCRIPTION_CANCEL_STATE_INVALID';
  end if;
  if p_provider_cancel_at is not null then
    if p_current_period_end is null
       or p_provider_cancel_at is distinct from p_current_period_end
       or (p_subscription_status = 'trialing'
         and p_provider_cancel_at is distinct from p_verified_trial_end) then
      raise exception using errcode = '55000',
        message = 'SAAS_SUBSCRIPTION_CANCEL_AT_MISMATCH';
    end if;
  end if;
  return p_provider_cancel_at_period_end or p_provider_cancel_at is not null;
end;
$function$;

revoke all on function public.normalize_verified_saas_scheduled_cancellation(
  text,timestamptz,timestamptz,boolean,timestamptz
) from public, anon, authenticated, service_role;

alter function public.apply_verified_stripe_subscription_event(
  text,text,uuid,text,boolean,text,timestamptz,text,text,boolean,text,text,text,text,
  timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz,integer,
  boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text
) rename to apply_verified_stripe_subscription_event_without_cancel_at_v1;

revoke all on function public.apply_verified_stripe_subscription_event_without_cancel_at_v1(
  text,text,uuid,text,boolean,text,timestamptz,text,text,boolean,text,text,text,text,
  timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz,integer,
  boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text
) from public, anon, authenticated, service_role;

drop trigger if exists billing_provider_events_complete_verified_resume
  on public.billing_provider_events;

create function public.apply_verified_stripe_subscription_event(
  p_provider_event_id text,
  p_payload_hash text,
  p_processing_lease_token uuid,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_environment_id text,
  p_provider_event_created_at timestamptz,
  p_event_type text,
  p_stripe_subscription_id text,
  p_subscription_livemode boolean,
  p_stripe_customer_id text,
  p_stripe_price_id text,
  p_stripe_product_id text,
  p_subscription_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_subscription_cancel_at timestamptz,
  p_subscription_created_at timestamptz,
  p_subscription_canceled_at timestamptz,
  p_subscription_ended_at timestamptz,
  p_line_quantity integer,
  p_price_livemode boolean,
  p_product_livemode boolean,
  p_price_active boolean,
  p_product_active boolean,
  p_unit_amount_cents bigint,
  p_currency text,
  p_recurring_interval text,
  p_recurring_interval_count integer,
  p_price_type text,
  p_billing_scheme text,
  p_recurring_usage_type text,
  p_tax_behavior text,
  p_product_tax_code text
)
returns table (
  application_state text,
  store_id uuid,
  subscription_status text,
  paid_through_at timestamptz,
  grace_ends_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_normalized_cancel boolean;
  v_result record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'SAAS_SUBSCRIPTION_SERVICE_ROLE_REQUIRED';
  end if;

  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.stripe_subscription_id = btrim(p_stripe_subscription_id)
    and enrollment.stripe_account_id = btrim(p_stripe_account_id)
    and enrollment.stripe_livemode = p_stripe_livemode;

  v_normalized_cancel := public.normalize_verified_saas_scheduled_cancellation(
    p_subscription_status, p_current_period_end, v_enrollment.trial_ends_at,
    p_cancel_at_period_end, p_subscription_cancel_at
  );

  -- Clear literal scheduling evidence before the legacy inner function clears
  -- the normalized flag. The entire wrapper is one transaction, so any later
  -- validation failure rolls this preparation back atomically.
  if not v_normalized_cancel then
    update public.billing_subscription_enrollments as enrollment
    set provider_cancel_at_period_end = false,
        provider_cancel_at = null,
        updated_at = statement_timestamp()
    where enrollment.id = v_enrollment.id;
    update public.seller_billing_status as status
    set provider_cancel_at_period_end = false,
        provider_cancel_at = null,
        updated_at = statement_timestamp()
    where status.store_id = v_enrollment.store_id;
  end if;

  select * into v_result
  from public.apply_verified_stripe_subscription_event_without_cancel_at_v1(
    p_provider_event_id, p_payload_hash, p_processing_lease_token,
    p_stripe_account_id, p_stripe_livemode, p_environment_id,
    p_provider_event_created_at, p_event_type, p_stripe_subscription_id,
    p_subscription_livemode, p_stripe_customer_id, p_stripe_price_id,
    p_stripe_product_id, p_subscription_status, p_current_period_start,
    p_current_period_end, v_normalized_cancel, p_subscription_created_at,
    p_subscription_canceled_at, p_subscription_ended_at, p_line_quantity,
    p_price_livemode, p_product_livemode, p_price_active, p_product_active,
    p_unit_amount_cents, p_currency, p_recurring_interval,
    p_recurring_interval_count, p_price_type, p_billing_scheme,
    p_recurring_usage_type, p_tax_behavior, p_product_tax_code
  );

  if v_result.application_state in ('snapshot_applied', 'terminal_snapshot_applied') then
    update public.billing_subscription_enrollments as enrollment
    set provider_cancel_at_period_end = p_cancel_at_period_end,
        provider_cancel_at = p_subscription_cancel_at,
        updated_at = statement_timestamp()
    where enrollment.store_id = v_result.store_id
      and enrollment.stripe_subscription_id = btrim(p_stripe_subscription_id)
      and enrollment.stripe_account_id = btrim(p_stripe_account_id)
      and enrollment.stripe_livemode = p_stripe_livemode;
    update public.seller_billing_status as status
    set provider_cancel_at_period_end = p_cancel_at_period_end,
        provider_cancel_at = p_subscription_cancel_at,
        updated_at = statement_timestamp()
    where status.store_id = v_result.store_id;

    if p_event_type = 'customer.subscription.updated'
       and not p_cancel_at_period_end
       and p_subscription_cancel_at is null then
      update public.billing_management_action_requests as action
      set request_status = 'completed',
          completed_at = statement_timestamp()
      where action.store_id = v_result.store_id
        and action.subscription_enrollment_id = v_enrollment.id
        and action.action_type = 'resume_subscription'
        and action.request_status = 'provider_requested'
        and action.stripe_subscription_id = btrim(p_stripe_subscription_id)
        and action.stripe_account_id = btrim(p_stripe_account_id)
        and action.stripe_livemode = p_stripe_livemode
        and action.environment_id = btrim(p_environment_id);
    end if;
  end if;

  return query select v_result.application_state, v_result.store_id,
    v_result.subscription_status, v_result.paid_through_at,
    v_result.grace_ends_at;
end;
$function$;

revoke all on function public.apply_verified_stripe_subscription_event(
  text,text,uuid,text,boolean,text,timestamptz,text,text,boolean,text,text,text,text,
  timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz,timestamptz,
  integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.apply_verified_stripe_subscription_event(
  text,text,uuid,text,boolean,text,timestamptz,text,text,boolean,text,text,text,text,
  timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz,timestamptz,
  integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text
) to service_role;

create table public.billing_subscription_snapshot_resyncs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  subscription_enrollment_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  request_status text not null check (request_status in ('requested','completed','failed')),
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  stripe_livemode boolean not null,
  environment_id text not null check (environment_id in ('local','development','test','preview','staging','production')),
  requested_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  failure_code text check (failure_code is null or failure_code ~ '^[a-z0-9_]{1,96}$'),
  constraint billing_subscription_snapshot_resyncs_enrollment_context_fk
    foreign key (subscription_enrollment_id, store_id)
    references public.billing_subscription_enrollments(id, store_id)
    on delete restrict
);
alter table public.billing_subscription_snapshot_resyncs enable row level security;
revoke all on table public.billing_subscription_snapshot_resyncs from public, anon, authenticated;
grant select, insert, update on table public.billing_subscription_snapshot_resyncs to service_role;
create unique index billing_subscription_snapshot_resyncs_open_unique
  on public.billing_subscription_snapshot_resyncs(subscription_enrollment_id)
  where request_status = 'requested';

create function public.begin_saas_subscription_snapshot_resync(
  p_operator_user_id uuid, p_store_id uuid, p_stripe_account_id text,
  p_stripe_livemode boolean, p_environment_id text
)
returns table (
  request_id uuid, stripe_subscription_id text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_request_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.user_roles as user_role
    where user_role.user_id = p_operator_user_id
      and user_role.role = 'admin'
      and user_role.store_id is null
  ) then
    raise exception using errcode = '42501', message = 'SUBSCRIPTION_RESYNC_OPERATOR_REQUIRED';
  end if;
  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments enrollment
  join public.seller_billing_status status
    on status.current_subscription_enrollment_id = enrollment.id
   and status.store_id = enrollment.store_id
  where enrollment.store_id = p_store_id
    and enrollment.stripe_account_id = p_stripe_account_id
    and enrollment.stripe_livemode = p_stripe_livemode
    and enrollment.is_current and enrollment.ended_at is null
    and status.billing_state_authority = 'stripe'
    and exists (
      select 1 from public.billing_provider_events event_row
      where event_row.provider_event_id = enrollment.bound_by_event_id
        and event_row.store_id = enrollment.store_id
        and event_row.stripe_account_id = p_stripe_account_id
        and event_row.stripe_livemode = p_stripe_livemode
        and event_row.processing_environment_id = p_environment_id
    )
  for update of enrollment;
  if v_enrollment.id is null then
    raise exception using errcode = '55000', message = 'SUBSCRIPTION_RESYNC_BINDING_INVALID';
  end if;
  select resync.id into v_request_id
  from public.billing_subscription_snapshot_resyncs as resync
  where resync.subscription_enrollment_id = v_enrollment.id
    and resync.request_status = 'requested'
  for update;
  if v_request_id is null then
    insert into public.billing_subscription_snapshot_resyncs (
      store_id, subscription_enrollment_id, requested_by_user_id,
      request_status, stripe_account_id, stripe_livemode, environment_id
    ) values (
      p_store_id, v_enrollment.id, p_operator_user_id, 'requested',
      p_stripe_account_id, p_stripe_livemode, p_environment_id
    ) returning id into v_request_id;
  end if;
  return query select v_request_id, v_enrollment.stripe_subscription_id;
end;
$function$;

revoke all on function public.begin_saas_subscription_snapshot_resync(uuid,uuid,text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.begin_saas_subscription_snapshot_resync(uuid,uuid,text,boolean,text)
  to service_role;

-- The one-purpose resync updates provider scheduling snapshots only. Immutable
-- binding/catalog identity is revalidated and paid-through/trial authority is untouched.
create function public.apply_verified_saas_subscription_snapshot_resync(
  p_request_id uuid, p_stripe_subscription_id text, p_subscription_livemode boolean,
  p_stripe_customer_id text, p_stripe_price_id text, p_stripe_product_id text,
  p_subscription_status text, p_current_period_start timestamptz,
  p_current_period_end timestamptz, p_cancel_at_period_end boolean,
  p_subscription_cancel_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_request public.billing_subscription_snapshot_resyncs%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_binding public.billing_customer_bindings%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_catalog public.billing_provider_price_catalog%rowtype;
  v_normalized boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  select resync.* into v_request
  from public.billing_subscription_snapshot_resyncs as resync
  where resync.id = p_request_id for update;
  if v_request.id is null then
    raise exception using errcode = '55000', message = 'SUBSCRIPTION_RESYNC_REQUEST_INVALID';
  end if;
  if v_request.request_status = 'completed' then return 'already_applied'; end if;
  if v_request.request_status <> 'requested' then
    raise exception using errcode = '55000', message = 'SUBSCRIPTION_RESYNC_STATE_INVALID';
  end if;
  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.id = v_request.subscription_enrollment_id
    and enrollment.store_id = v_request.store_id
    and enrollment.stripe_subscription_id = p_stripe_subscription_id
    and enrollment.stripe_account_id = v_request.stripe_account_id
    and enrollment.stripe_livemode = v_request.stripe_livemode
    and enrollment.is_current and enrollment.ended_at is null for update;
  select binding.* into v_binding
  from public.billing_customer_bindings as binding
  where binding.id = v_enrollment.customer_binding_id
    and binding.store_id = v_request.store_id
    and binding.stripe_customer_id = p_stripe_customer_id
    and binding.stripe_account_id = v_request.stripe_account_id
    and binding.stripe_livemode = v_request.stripe_livemode;
  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = v_request.store_id
    and status.current_subscription_enrollment_id = v_enrollment.id
    and status.stripe_subscription_id = p_stripe_subscription_id
    and status.stripe_customer_id = p_stripe_customer_id
    and status.stripe_price_id = p_stripe_price_id for update;
  select catalog.* into v_catalog
  from public.billing_provider_price_catalog as catalog
  where catalog.stripe_price_id = p_stripe_price_id
    and catalog.stripe_product_id = p_stripe_product_id
    and catalog.stripe_account_id = v_request.stripe_account_id
    and catalog.stripe_livemode = v_request.stripe_livemode
    and catalog.is_verified and catalog.is_active
    and catalog.stripe_price_active and catalog.stripe_product_active
    and catalog.plan_key = v_billing.plan_key
    and catalog.billing_cadence = v_billing.billing_plan;
  if v_enrollment.id is null or v_binding.id is null or v_billing.id is null
     or v_catalog.stripe_price_id is null
     or p_subscription_livemode is distinct from v_request.stripe_livemode
     or v_enrollment.initial_stripe_price_id is distinct from p_stripe_price_id
     or not exists (
       select 1 from public.billing_provider_events event_row
       where event_row.provider_event_id = v_enrollment.bound_by_event_id
         and event_row.store_id = v_request.store_id
         and event_row.stripe_account_id = v_request.stripe_account_id
         and event_row.stripe_livemode = v_request.stripe_livemode
         and event_row.processing_environment_id = v_request.environment_id
     )
     or p_subscription_status not in ('trialing','active','past_due','unpaid','paused','canceled','incomplete','incomplete_expired')
     or (p_current_period_start is null) <> (p_current_period_end is null)
     or (p_current_period_end is not null and p_current_period_end <= p_current_period_start)
     or (p_subscription_status = 'trialing' and (
       p_current_period_start is distinct from v_enrollment.trial_started_at
       or p_current_period_end is distinct from v_enrollment.trial_ends_at
     )) then
    raise exception using errcode = '55000', message = 'SUBSCRIPTION_RESYNC_BINDING_INVALID';
  end if;
  v_normalized := public.normalize_verified_saas_scheduled_cancellation(
    p_subscription_status, p_current_period_end, v_enrollment.trial_ends_at,
    p_cancel_at_period_end, p_subscription_cancel_at
  );
  update public.billing_subscription_enrollments as enrollment
  set provider_status = p_subscription_status,
      cancel_at_period_end = v_normalized,
      provider_cancel_at_period_end = p_cancel_at_period_end,
      provider_cancel_at = p_subscription_cancel_at,
      updated_at = statement_timestamp()
  where enrollment.id = v_enrollment.id;
  update public.seller_billing_status as status
  set subscription_status = p_subscription_status,
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      cancel_at_period_end = v_normalized,
      provider_cancel_at_period_end = p_cancel_at_period_end,
      provider_cancel_at = p_subscription_cancel_at,
      updated_at = statement_timestamp()
  where status.store_id = v_request.store_id;
  update public.billing_subscription_snapshot_resyncs as resync
  set request_status = 'completed', completed_at = statement_timestamp()
  where resync.id = v_request.id;
  return 'applied';
end;
$function$;

revoke all on function public.apply_verified_saas_subscription_snapshot_resync(
  uuid,text,boolean,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_verified_saas_subscription_snapshot_resync(
  uuid,text,boolean,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz
) to service_role;

update public.platform_settings as setting
set boolean_value = false, updated_by_user_id = null
where setting.setting_key in (
  'saas_subscription_checkout_enabled', 'saas_billing_portal_enabled'
);

commit;
