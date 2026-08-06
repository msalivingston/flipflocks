begin;

-- First production slice: Coop monthly -> Market monthly immediately and
-- Market monthly -> Coop monthly at period end. No other transition is valid.
create table public.billing_subscription_plan_changes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  subscription_enrollment_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  source_stripe_price_id text not null,
  target_stripe_price_id text not null,
  change_timing text not null,
  status text not null default 'requested',
  stripe_invoice_id text,
  stripe_schedule_id text,
  effective_at timestamptz,
  last_provider_event_id text,
  last_provider_event_created_at timestamptz,
  failure_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  canceled_at timestamptz,
  failed_at timestamptz,

  constraint billing_subscription_plan_changes_enrollment_fk foreign key (
    subscription_enrollment_id, store_id
  ) references public.billing_subscription_enrollments(id, store_id)
    on delete restrict,
  constraint billing_subscription_plan_changes_prices_check check (
    source_stripe_price_id ~ '^price_[A-Za-z0-9]+$'
    and target_stripe_price_id ~ '^price_[A-Za-z0-9]+$'
    and source_stripe_price_id <> target_stripe_price_id
  ),
  constraint billing_subscription_plan_changes_timing_check check (
    change_timing in ('immediate', 'period_end')
  ),
  constraint billing_subscription_plan_changes_status_check check (
    status in (
      'requested', 'pending_payment', 'scheduled',
      'completed', 'canceled', 'failed'
    )
  ),
  constraint billing_subscription_plan_changes_invoice_check check (
    stripe_invoice_id is null or stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'
  ),
  constraint billing_subscription_plan_changes_schedule_check check (
    stripe_schedule_id is null or stripe_schedule_id ~ '^sub_sched_[A-Za-z0-9]+$'
  ),
  constraint billing_subscription_plan_changes_binding_shape_check check (
    (change_timing = 'immediate' and stripe_schedule_id is null and effective_at is null)
    or
    (change_timing = 'period_end')
  ),
  constraint billing_subscription_plan_changes_terminal_check check (
    (status = 'completed' and completed_at is not null and canceled_at is null and failed_at is null)
    or (status = 'canceled' and canceled_at is not null and completed_at is null and failed_at is null)
    or (status = 'failed' and failed_at is not null and completed_at is null and canceled_at is null)
    or (status in ('requested', 'pending_payment', 'scheduled')
      and completed_at is null and canceled_at is null and failed_at is null)
  ),
  constraint billing_subscription_plan_changes_failure_check check (
    failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,99}$'
  ),
  constraint billing_subscription_plan_changes_event_pair_check check (
    (last_provider_event_id is null and last_provider_event_created_at is null)
    or (last_provider_event_id ~ '^evt_[A-Za-z0-9]+$'
      and last_provider_event_created_at is not null)
  )
);

create unique index billing_subscription_plan_changes_one_open_idx
  on public.billing_subscription_plan_changes(subscription_enrollment_id)
  where status in ('requested', 'pending_payment', 'scheduled');
create unique index billing_subscription_plan_changes_invoice_idx
  on public.billing_subscription_plan_changes(stripe_invoice_id)
  where stripe_invoice_id is not null;
create unique index billing_subscription_plan_changes_schedule_idx
  on public.billing_subscription_plan_changes(stripe_schedule_id)
  where stripe_schedule_id is not null;
create index billing_subscription_plan_changes_store_created_idx
  on public.billing_subscription_plan_changes(store_id, created_at desc);

create trigger billing_subscription_plan_changes_set_updated_at
before update on public.billing_subscription_plan_changes
for each row execute function public.set_updated_at();

create function public.enforce_billing_subscription_plan_change_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.id is distinct from old.id
     or new.store_id is distinct from old.store_id
     or new.subscription_enrollment_id is distinct from old.subscription_enrollment_id
     or new.requested_by_user_id is distinct from old.requested_by_user_id
     or new.source_stripe_price_id is distinct from old.source_stripe_price_id
     or new.target_stripe_price_id is distinct from old.target_stripe_price_id
     or new.change_timing is distinct from old.change_timing
     or new.created_at is distinct from old.created_at
     or (old.stripe_invoice_id is not null
       and new.stripe_invoice_id is distinct from old.stripe_invoice_id)
     or (old.stripe_schedule_id is not null
       and new.stripe_schedule_id is distinct from old.stripe_schedule_id)
     or (old.effective_at is not null and new.effective_at is distinct from old.effective_at)
     or old.status in ('completed', 'canceled', 'failed') then
    raise exception using errcode = '55000',
      message = 'SAAS_PLAN_CHANGE_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$function$;

create trigger billing_subscription_plan_changes_preserve_identity
before update on public.billing_subscription_plan_changes
for each row execute function public.enforce_billing_subscription_plan_change_immutability();

-- Advance the enrollment's verified Price binding only through a completed,
-- audited plan change. Customer, Subscription, store, account, and mode remain
-- immutable, and the plan-change row preserves the source Price history.
create or replace function public.enforce_billing_subscription_enrollment_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.store_id is distinct from old.store_id
     or new.customer_binding_id is distinct from old.customer_binding_id
     or new.checkout_attempt_id is distinct from old.checkout_attempt_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.stripe_livemode is distinct from old.stripe_livemode
     or new.stripe_account_id is distinct from old.stripe_account_id
     or new.provider_created_at is distinct from old.provider_created_at
     or new.bound_by_event_id is distinct from old.bound_by_event_id then
    raise exception 'Billing Subscription enrollment binding fields are immutable.';
  end if;
  if new.initial_stripe_price_id is distinct from old.initial_stripe_price_id
     and not exists (
       select 1 from public.billing_subscription_plan_changes as changes
       where changes.subscription_enrollment_id = old.id
         and changes.store_id = old.store_id
         and changes.source_stripe_price_id = old.initial_stripe_price_id
         and changes.target_stripe_price_id = new.initial_stripe_price_id
         and changes.status = 'completed'
     ) then
    raise exception 'Billing Subscription enrollment binding fields are immutable.';
  end if;
  return new;
end;
$function$;

alter table public.billing_subscription_plan_changes enable row level security;
revoke all on table public.billing_subscription_plan_changes
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.billing_subscription_plan_changes
  to service_role;

create function public.begin_saas_subscription_plan_change(
  p_authenticated_user_id uuid,
  p_target_plan_key text,
  p_target_billing_cadence text,
  p_stripe_livemode boolean,
  p_stripe_account_id text,
  p_environment_id text
)
returns table (
  action_state text,
  plan_change_id uuid,
  store_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  source_stripe_price_id text,
  target_stripe_price_id text,
  change_timing text,
  stripe_idempotency_key text,
  stripe_invoice_id text,
  stripe_schedule_id text,
  effective_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_store public.stores%rowtype;
  v_status public.seller_billing_status%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_binding public.billing_customer_bindings%rowtype;
  v_target public.billing_provider_price_catalog%rowtype;
  v_existing public.billing_subscription_plan_changes%rowtype;
  v_change public.billing_subscription_plan_changes%rowtype;
  v_timing text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_authenticated_user_id is null
     or p_target_plan_key not in ('small_flock', 'full_flock')
     or p_target_billing_cadence <> 'monthly'
     or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
     or p_environment_id not in (
       'local', 'development', 'test', 'preview', 'staging', 'production'
     ) then
    raise exception using errcode = '22023', message = 'SAAS_PLAN_CHANGE_INPUT_INVALID';
  end if;

  select stores.* into v_store
  from public.stores
  where stores.owner_user_id = p_authenticated_user_id
  order by stores.created_at, stores.id
  limit 1
  for update;
  if v_store.id is null then
    raise exception using errcode = '42501', message = 'SAAS_PLAN_CHANGE_STORE_NOT_OWNED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-plan-change:' || v_store.id::text, 0)
  );
  if v_store.admin_hold_reason is not null
     or not exists (
       select 1 from public.saas_billing_portal_store_cohort as cohort
       where cohort.store_id = v_store.id and cohort.is_active
     ) then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_NOT_ENABLED';
  end if;

  select status.* into v_status
  from public.seller_billing_status as status
  where status.store_id = v_store.id
  for update;
  if v_status.id is null
     or v_status.billing_state_authority <> 'stripe'
     or v_status.subscription_status <> 'active'
     or v_status.billing_plan <> 'monthly'
     or v_status.plan_key not in ('small_flock', 'full_flock')
     or v_status.stripe_price_id is null
     or v_status.stripe_customer_id is null
     or v_status.stripe_subscription_id is null
     or v_status.stripe_livemode is distinct from p_stripe_livemode
     or v_status.stripe_account_id is distinct from p_stripe_account_id
     or v_status.current_subscription_enrollment_id is null
     or v_status.cancel_at_period_end
     or v_status.paid_through_at is null
     or v_status.paid_through_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_STATUS_INELIGIBLE';
  end if;

  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.id = v_status.current_subscription_enrollment_id
    and enrollment.store_id = v_store.id
    and enrollment.stripe_subscription_id = v_status.stripe_subscription_id
    and enrollment.stripe_livemode = p_stripe_livemode
    and enrollment.stripe_account_id = p_stripe_account_id
    and enrollment.is_current and enrollment.ended_at is null
    and enrollment.provider_status = 'active'
  for update;
  if v_enrollment.id is null then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_ENROLLMENT_INVALID';
  end if;
  select binding.* into v_binding
  from public.billing_customer_bindings as binding
  where binding.id = v_enrollment.customer_binding_id
    and binding.store_id = v_store.id
    and binding.stripe_customer_id = v_status.stripe_customer_id
    and binding.stripe_livemode = p_stripe_livemode
    and binding.stripe_account_id = p_stripe_account_id;
  if v_binding.id is null then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_BINDING_INVALID';
  end if;

  select catalog.* into v_target
  from public.billing_provider_price_catalog as catalog
  where catalog.plan_key = p_target_plan_key
    and catalog.billing_cadence = 'monthly'
    and catalog.stripe_livemode = p_stripe_livemode
    and catalog.stripe_account_id = p_stripe_account_id
    and catalog.is_active and catalog.is_verified;
  if v_target.stripe_price_id is null
     or v_target.stripe_price_id = v_status.stripe_price_id then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_TARGET_INVALID';
  end if;

  if v_status.plan_key = 'small_flock' and p_target_plan_key = 'full_flock' then
    v_timing := 'immediate';
  elsif v_status.plan_key = 'full_flock' and p_target_plan_key = 'small_flock' then
    v_timing := 'period_end';
  else
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_TRANSITION_UNSUPPORTED';
  end if;

  select changes.* into v_existing
  from public.billing_subscription_plan_changes as changes
  where changes.subscription_enrollment_id = v_enrollment.id
    and changes.status in ('requested', 'pending_payment', 'scheduled')
  for update;
  if v_existing.id is not null then
    if v_existing.target_stripe_price_id <> v_target.stripe_price_id
       or v_existing.change_timing <> v_timing then
      raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_ALREADY_OPEN';
    end if;
    return query select 'already_pending'::text, v_existing.id, v_store.id,
      v_binding.stripe_customer_id, v_enrollment.stripe_subscription_id,
      v_existing.source_stripe_price_id, v_existing.target_stripe_price_id,
      v_existing.change_timing,
      'ff:saas-plan-change:' || p_environment_id || ':' || v_existing.id::text || ':v1',
      v_existing.stripe_invoice_id, v_existing.stripe_schedule_id,
      v_existing.effective_at;
    return;
  end if;

  insert into public.billing_subscription_plan_changes (
    store_id, subscription_enrollment_id, requested_by_user_id,
    source_stripe_price_id, target_stripe_price_id, change_timing
  ) values (
    v_store.id, v_enrollment.id, p_authenticated_user_id,
    v_status.stripe_price_id, v_target.stripe_price_id, v_timing
  ) returning * into v_change;

  return query select 'created'::text, v_change.id, v_store.id,
    v_binding.stripe_customer_id, v_enrollment.stripe_subscription_id,
    v_change.source_stripe_price_id, v_change.target_stripe_price_id,
    v_change.change_timing,
    'ff:saas-plan-change:' || p_environment_id || ':' || v_change.id::text || ':v1',
    null::text, null::text, null::timestamptz;
end;
$function$;

create function public.record_saas_plan_change_provider_binding(
  p_plan_change_id uuid,
  p_stripe_invoice_id text,
  p_stripe_schedule_id text,
  p_effective_at timestamptz,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_change public.billing_subscription_plan_changes%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  select * into v_change from public.billing_subscription_plan_changes
  where id = p_plan_change_id for update;
  if v_change.id is null or v_change.status not in ('requested', 'pending_payment', 'scheduled') then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_NOT_OPEN';
  end if;
  if v_change.change_timing = 'immediate' then
    if p_status <> 'pending_payment' or p_stripe_invoice_id !~ '^in_[A-Za-z0-9]+$'
       or p_stripe_schedule_id is not null or p_effective_at is not null then
      raise exception using errcode = '22023', message = 'SAAS_PLAN_CHANGE_INVOICE_BINDING_INVALID';
    end if;
    update public.billing_subscription_plan_changes
    set stripe_invoice_id = coalesce(stripe_invoice_id, p_stripe_invoice_id),
        status = 'pending_payment'
    where id = v_change.id
      and (stripe_invoice_id is null or stripe_invoice_id = p_stripe_invoice_id);
  else
    if p_status <> 'scheduled' or p_stripe_schedule_id !~ '^sub_sched_[A-Za-z0-9]+$'
       or p_stripe_invoice_id is not null or p_effective_at <= statement_timestamp() then
      raise exception using errcode = '22023', message = 'SAAS_PLAN_CHANGE_SCHEDULE_BINDING_INVALID';
    end if;
    update public.billing_subscription_plan_changes
    set stripe_schedule_id = coalesce(stripe_schedule_id, p_stripe_schedule_id),
        effective_at = coalesce(effective_at, p_effective_at), status = 'scheduled'
    where id = v_change.id
      and (stripe_schedule_id is null or stripe_schedule_id = p_stripe_schedule_id)
      and (effective_at is null or effective_at = p_effective_at);
  end if;
  if not found then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_BINDING_CONFLICT';
  end if;
  return p_status;
end;
$function$;

create function public.begin_saas_scheduled_plan_change_cancellation(
  p_authenticated_user_id uuid,
  p_stripe_livemode boolean,
  p_stripe_account_id text,
  p_environment_id text
)
returns table (
  plan_change_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_schedule_id text,
  stripe_idempotency_key text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_store public.stores%rowtype;
  v_change public.billing_subscription_plan_changes%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_binding public.billing_customer_bindings%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_environment_id not in ('local','development','test','preview','staging','production') then
    raise exception using errcode = '22023', message = 'SAAS_PLAN_CHANGE_INPUT_INVALID';
  end if;
  select * into v_store from public.stores
  where owner_user_id = p_authenticated_user_id
  order by created_at, id limit 1 for update;
  if v_store.id is null or not exists (
    select 1 from public.saas_billing_portal_store_cohort
    where store_id = v_store.id and is_active
  ) then
    raise exception using errcode = '42501', message = 'SAAS_PLAN_CHANGE_STORE_NOT_OWNED';
  end if;
  select * into v_change from public.billing_subscription_plan_changes
  where store_id = v_store.id and change_timing = 'period_end'
    and status = 'scheduled' for update;
  if v_change.id is null or v_change.stripe_schedule_id is null then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_SCHEDULE_NOT_FOUND';
  end if;
  select * into v_enrollment from public.billing_subscription_enrollments
  where id = v_change.subscription_enrollment_id
    and stripe_livemode = p_stripe_livemode
    and stripe_account_id = p_stripe_account_id
    and is_current and ended_at is null;
  select * into v_binding from public.billing_customer_bindings
  where id = v_enrollment.customer_binding_id
    and store_id = v_store.id
    and stripe_livemode = p_stripe_livemode
    and stripe_account_id = p_stripe_account_id;
  if v_enrollment.id is null or v_binding.id is null then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_BINDING_INVALID';
  end if;
  return query select v_change.id, v_binding.stripe_customer_id,
    v_enrollment.stripe_subscription_id, v_change.stripe_schedule_id,
    'ff:saas-plan-change:' || p_environment_id || ':' || v_change.id::text || ':release:v1';
end;
$function$;

create function public.record_saas_scheduled_plan_change_canceled(p_plan_change_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  update public.billing_subscription_plan_changes
  set status = 'canceled', canceled_at = statement_timestamp()
  where id = p_plan_change_id and change_timing = 'period_end' and status = 'scheduled';
  if not found then
    if exists (select 1 from public.billing_subscription_plan_changes
      where id = p_plan_change_id and status = 'canceled') then return 'already_canceled'; end if;
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_CANCEL_CONFLICT';
  end if;
  insert into public.billing_entitlement_events (
    store_id, event_type, metadata
  ) select store_id, 'provider_state_applied',
    pg_catalog.jsonb_build_object(
      'lifecycle_event', 'scheduled_change_canceled', 'plan_change_id', id
    )
  from public.billing_subscription_plan_changes where id = p_plan_change_id;
  return 'canceled';
end;
$function$;

create function public.mark_saas_subscription_plan_change_failed(
  p_plan_change_id uuid, p_failure_code text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_failure_code !~ '^[a-z][a-z0-9_]{0,99}$' then
    raise exception using errcode = '22023', message = 'SAAS_PLAN_CHANGE_FAILURE_INVALID';
  end if;
  update public.billing_subscription_plan_changes
  set status = 'failed', failed_at = statement_timestamp(), failure_code = p_failure_code
  where id = p_plan_change_id and status in ('requested', 'pending_payment', 'scheduled');
  if not found then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_NOT_OPEN';
  end if;
  return 'failed';
end;
$function$;

create function public.seller_get_saas_downgrade_inventory_preview()
returns table (
  inventory_item_id uuid,
  breed_display_name text,
  species_name text,
  inventory_type text,
  quantity_available integer,
  bird_units integer,
  effective_unit_price numeric,
  inventory_visibility_status text,
  listing_batch_visibility_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare v_store_id uuid;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  select stores.id into v_store_id from public.stores
  where stores.owner_user_id = auth.uid()
  order by stores.created_at, stores.id limit 1;
  if v_store_id is null then
    raise exception using errcode = '42501', message = 'STORE_NOT_OWNED';
  end if;
  return query
  select inventory.inventory_item_id, inventory.breed_display_name,
    inventory.species_name, inventory.inventory_type,
    inventory.quantity_available,
    public.live_bird_plan_units(
      inventory.inventory_type, inventory.quantity_available
    ),
    inventory.effective_unit_price,
    inventory.inventory_visibility_status,
    inventory.listing_batch_visibility_status
  from public.seller_inventory_management as inventory
  where inventory.store_id = v_store_id
    and inventory.batch_type = 'live_animals'
  order by inventory.breed_display_name, inventory.inventory_type,
    inventory.inventory_item_id;
end;
$function$;

alter function public.seller_get_saas_billing_status()
  rename to seller_get_saas_billing_status_without_plan_changes_v1;
revoke all on function public.seller_get_saas_billing_status_without_plan_changes_v1()
  from public, anon, authenticated;

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
  complimentary_access_ends_at timestamptz,
  subscription_changes_available boolean,
  pending_plan_change_status text,
  pending_plan_key text,
  pending_billing_cadence text,
  pending_effective_at timestamptz,
  pending_payment_required boolean,
  scheduled_change_cancelable boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_store_id uuid;
  v_change public.billing_subscription_plan_changes%rowtype;
  v_target public.billing_provider_price_catalog%rowtype;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  select stores.id into v_store_id from public.stores
  where stores.owner_user_id = auth.uid()
  order by stores.created_at, stores.id limit 1;
  select changes.* into v_change
  from public.billing_subscription_plan_changes as changes
  where changes.store_id = v_store_id
    and changes.status in ('requested', 'pending_payment', 'scheduled')
  order by changes.created_at desc limit 1;
  if v_change.id is not null then
    select catalog.* into v_target
    from public.billing_provider_price_catalog as catalog
    join public.billing_subscription_enrollments as enrollment
      on enrollment.id = v_change.subscription_enrollment_id
     and enrollment.stripe_livemode = catalog.stripe_livemode
     and enrollment.stripe_account_id = catalog.stripe_account_id
    where catalog.stripe_price_id = v_change.target_stripe_price_id;
  end if;

  return query
  select base.*,
    (
      base.portal_enabled and base.lifecycle_state = 'active_paid'
      and not base.cancel_at_period_end
      and base.effective_billing_cadence = 'monthly'
      and base.effective_plan_key in ('small_flock', 'full_flock')
      and exists (
        select 1 from public.saas_billing_portal_store_cohort as cohort
        where cohort.store_id = v_store_id and cohort.is_active
      )
    ),
    v_change.status,
    v_target.plan_key,
    v_target.billing_cadence,
    v_change.effective_at,
    v_change.status = 'pending_payment',
    v_change.status = 'scheduled' and v_change.stripe_schedule_id is not null
  from public.seller_get_saas_billing_status_without_plan_changes_v1() as base;
end;
$function$;

revoke all on function public.seller_get_saas_billing_status()
  from public, anon, authenticated;
grant execute on function public.seller_get_saas_billing_status()
  to authenticated;
revoke all on function public.seller_get_saas_downgrade_inventory_preview()
  from public, anon, authenticated;
grant execute on function public.seller_get_saas_downgrade_inventory_preview()
  to authenticated;

create function public.complete_verified_saas_plan_change(
  p_plan_change_id uuid,
  p_provider_event_id text,
  p_provider_event_created_at timestamptz,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_change public.billing_subscription_plan_changes%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_status public.seller_billing_status%rowtype;
  v_target public.billing_provider_price_catalog%rowtype;
  v_invoice public.billing_subscription_invoices%rowtype;
  v_item record;
  v_reset_count integer := 0;
begin
  select * into v_change from public.billing_subscription_plan_changes
  where id = p_plan_change_id for update;
  if v_change.status = 'completed' then return 'already_completed'; end if;
  if v_change.id is null or v_change.status not in ('requested','pending_payment','scheduled') then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_NOT_OPEN';
  end if;
  select * into v_enrollment from public.billing_subscription_enrollments
  where id = v_change.subscription_enrollment_id and store_id = v_change.store_id
    and is_current and ended_at is null for update;
  select * into v_status from public.seller_billing_status
  where store_id = v_change.store_id for update;
  select * into v_target from public.billing_provider_price_catalog
  where stripe_price_id = v_change.target_stripe_price_id
    and stripe_livemode = v_enrollment.stripe_livemode
    and stripe_account_id = v_enrollment.stripe_account_id
    and is_active and is_verified;
  select * into v_invoice from public.billing_subscription_invoices
  where stripe_invoice_id = v_change.stripe_invoice_id
    and subscription_enrollment_id = v_enrollment.id
    and stripe_price_id = v_change.target_stripe_price_id
    and invoice_status = 'paid' and paid_at is not null
  for update;
  if v_enrollment.id is null or v_status.id is null or v_target.stripe_price_id is null
     or v_invoice.id is null or v_status.stripe_price_id <> v_change.source_stripe_price_id
     or v_status.stripe_subscription_id <> v_enrollment.stripe_subscription_id
     or p_current_period_start is null or p_current_period_end <= p_current_period_start then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_COMPLETION_EVIDENCE_INVALID';
  end if;
  if v_change.change_timing = 'period_end' and (
       v_change.effective_at is null
       or v_invoice.service_period_start is distinct from v_change.effective_at
       or v_invoice.service_period_end is distinct from p_current_period_end
     ) then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_BOUNDARY_INVALID';
  end if;

  if v_change.change_timing = 'period_end' then
    for v_item in
      select inventory_items.id, inventory_items.listing_batch_id,
        inventory_items.listing_batch_breed_id,
        inventory_items.quantity_available,
        inventory_items.visibility_status
      from public.inventory_items
      join public.listing_batches
        on listing_batches.id = inventory_items.listing_batch_id
       and listing_batches.store_id = inventory_items.store_id
      where inventory_items.store_id = v_change.store_id
        and listing_batches.batch_type = 'live_animals'
        and inventory_items.quantity_available <> 0
      order by inventory_items.id
      for update of inventory_items
    loop
      update public.inventory_items
      set quantity_available = 0, updated_at = statement_timestamp()
      where id = v_item.id;
      insert into public.inventory_activity_events (
        store_id, listing_batch_id, listing_batch_breed_id, inventory_item_id,
        actor_user_id, actor_type, event_type,
        from_quantity_available, to_quantity_available,
        from_visibility_status, to_visibility_status, note, metadata
      ) values (
        v_change.store_id, v_item.listing_batch_id,
        v_item.listing_batch_breed_id, v_item.id,
        null, 'system', 'inventory_quantity_adjusted',
        v_item.quantity_available, 0,
        v_item.visibility_status, v_item.visibility_status,
        'Inventory reset when Market to Coop downgrade became effective.',
        pg_catalog.jsonb_build_object(
          'plan_change_id', v_change.id,
          'reason', 'market_to_coop_effective'
        )
      );
      v_reset_count := v_reset_count + 1;
    end loop;
  end if;

  update public.billing_subscription_plan_changes
  set status = 'completed', completed_at = statement_timestamp(),
      last_provider_event_id = p_provider_event_id,
      last_provider_event_created_at = p_provider_event_created_at
  where id = v_change.id;
  update public.billing_subscription_enrollments
  set initial_stripe_price_id = v_change.target_stripe_price_id,
      updated_at = statement_timestamp()
  where id = v_enrollment.id;
  update public.billing_subscription_invoices
  set paid_through_applied_at = coalesce(
    paid_through_applied_at, statement_timestamp()
  )
  where id = v_invoice.id;

  update public.seller_billing_status as status
  set plan_key = v_target.plan_key,
      billing_plan = v_target.billing_cadence,
      stripe_price_id = v_target.stripe_price_id,
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      effective_price_started_at = p_current_period_start,
      paid_through_at = case when v_change.change_timing = 'period_end'
        then greatest(coalesce(status.paid_through_at, '-infinity'::timestamptz),
          v_invoice.service_period_end)
        else status.paid_through_at end,
      storefront_access_until = case when v_change.change_timing = 'period_end'
        then greatest(coalesce(status.storefront_access_until, '-infinity'::timestamptz),
          v_invoice.service_period_end)
        else status.storefront_access_until end,
      last_paid_stripe_invoice_id = v_invoice.stripe_invoice_id,
      latest_stripe_invoice_id = v_invoice.stripe_invoice_id,
      latest_invoice_status = 'paid',
      latest_invoice_event_id = p_provider_event_id,
      latest_invoice_event_created_at = p_provider_event_created_at,
      last_provider_event_id = p_provider_event_id,
      last_provider_event_created_at = p_provider_event_created_at,
      last_provider_event_applied_at = statement_timestamp(),
      payment_failure_started_at = null,
      payment_action_required_at = null,
      grace_ends_at = null,
      updated_at = statement_timestamp()
  where status.store_id = v_change.store_id;

  insert into public.billing_entitlement_events (
    store_id, event_type, plan_key, billing_cadence, access_until,
    provider_event_id, metadata
  ) values (
    v_change.store_id, 'provider_state_applied', v_target.plan_key,
    v_target.billing_cadence,
    case when v_change.change_timing = 'period_end'
      then v_invoice.service_period_end else v_status.paid_through_at end,
    p_provider_event_id,
    pg_catalog.jsonb_build_object(
      'lifecycle_event', case when v_change.change_timing = 'period_end'
        then 'market_to_coop_completed' else 'immediate_plan_change_completed' end,
      'plan_change_id', v_change.id,
      'invoice_id', v_invoice.stripe_invoice_id,
      'inventory_rows_reset', v_reset_count
    )
  );
  return 'completed';
end;
$function$;

-- Preserve the existing resolver and its OID for every caller, changing only
-- the paid-invoice predicate needed by a verified immediate plan change. The
-- guarded replacement makes migration drift fail instead of silently widening
-- entitlement authority.
do $block$
declare
  v_definition text;
  v_old constant text :=
    'v_paid_invoice.billing_reason in (''subscription_create'', ''subscription_cycle'')';
  v_new constant text :=
    '(v_paid_invoice.billing_reason in (''subscription_create'', ''subscription_cycle'') or (v_paid_invoice.billing_reason = ''subscription_update'' and exists (select 1 from public.billing_subscription_plan_changes as verified_change where verified_change.subscription_enrollment_id = v_enrollment.id and verified_change.change_timing = ''immediate'' and verified_change.status = ''completed'' and verified_change.stripe_invoice_id = v_paid_invoice.stripe_invoice_id and verified_change.target_stripe_price_id = v_paid_invoice.stripe_price_id)))';
begin
  select pg_catalog.pg_get_functiondef(
    'public.resolve_store_entitlement(uuid)'::pg_catalog.regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_old) = 0
     or pg_catalog.strpos(
       pg_catalog.substr(v_definition, pg_catalog.strpos(v_definition, v_old) + 1),
       v_old
     ) <> 0 then
    raise exception using errcode = '55000',
      message = 'SAAS_PLAN_CHANGE_ENTITLEMENT_CONTRACT_DRIFT';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$block$;

create function public.apply_verified_saas_plan_change_invoice_event(
  p_outcome text,
  p_provider_event_id text,
  p_payload_hash text,
  p_processing_lease_token uuid,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_environment_id text,
  p_provider_event_created_at timestamptz,
  p_stripe_invoice_id text,
  p_invoice_livemode boolean,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_target_stripe_price_id text,
  p_target_stripe_product_id text,
  p_current_subscription_price_id text,
  p_current_subscription_quantity integer,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_billing_reason text,
  p_collection_method text,
  p_invoice_status text,
  p_currency text,
  p_amount_due_cents bigint,
  p_amount_paid_cents bigint,
  p_amount_remaining_cents bigint,
  p_target_line_amount_cents bigint,
  p_service_period_start timestamptz,
  p_service_period_end timestamptz,
  p_observed_at timestamptz,
  p_next_payment_attempt_at timestamptz,
  p_line_quantity integer,
  p_price_livemode boolean,
  p_product_livemode boolean,
  p_price_active boolean,
  p_product_active boolean,
  p_unit_amount_cents bigint,
  p_price_currency text,
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
  invoice_id uuid,
  paid_through_at timestamptz,
  grace_ends_at timestamptz,
  billing_complete boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_change public.billing_subscription_plan_changes%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_binding public.billing_customer_bindings%rowtype;
  v_status public.seller_billing_status%rowtype;
  v_catalog public.billing_provider_price_catalog%rowtype;
  v_invoice public.billing_subscription_invoices%rowtype;
  v_event_type text;
  v_failure_code text;
  v_completion text;
  v_finalized text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  v_event_type := case p_outcome
    when 'payment_succeeded' then 'invoice.payment_succeeded'
    when 'payment_failed' then 'invoice.payment_failed'
    when 'payment_action_required' then 'invoice.payment_action_required'
    else null end;
  v_failure_code := case p_outcome
    when 'payment_failed' then 'payment_failed'
    when 'payment_action_required' then 'payment_action_required'
    else null end;
  if v_event_type is null
     or p_provider_event_id !~ '^evt_[A-Za-z0-9]+$'
     or p_payload_hash !~ '^[0-9a-f]{64}$'
     or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
     or p_environment_id not in ('local','development','test','preview','staging','production')
     or p_stripe_invoice_id !~ '^in_[A-Za-z0-9]+$'
     or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
     or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     or p_target_stripe_price_id !~ '^price_[A-Za-z0-9]+$'
     or p_target_stripe_product_id !~ '^prod_[A-Za-z0-9]+$'
     or p_invoice_livemode is distinct from p_stripe_livemode
     or p_current_subscription_quantity <> 1 or p_line_quantity <> 1
     or p_collection_method <> 'charge_automatically'
     or p_currency <> lower(p_currency)
     or p_amount_due_cents < 0 or p_amount_paid_cents < 0
     or p_amount_remaining_cents < 0 or p_target_line_amount_cents < 0
     or p_amount_paid_cents + p_amount_remaining_cents <> p_amount_due_cents
     or p_service_period_end <= p_service_period_start
     or p_current_period_end <= p_current_period_start
     or p_observed_at is null then
    raise exception using errcode = '22023', message = 'SAAS_PLAN_CHANGE_INVOICE_EVIDENCE_INVALID';
  end if;
  if (p_outcome = 'payment_succeeded' and
      (p_invoice_status <> 'paid' or p_amount_remaining_cents <> 0))
     or (p_outcome in ('payment_failed','payment_action_required')
      and p_invoice_status not in ('open','uncollectible')) then
    raise exception using errcode = '22023', message = 'SAAS_PLAN_CHANGE_INVOICE_STATUS_INVALID';
  end if;
  if p_price_livemode is distinct from p_stripe_livemode
     or p_product_livemode is distinct from p_stripe_livemode
     or not p_price_active or not p_product_active
     or p_unit_amount_cents <= 0
     or p_price_currency <> p_currency
     or p_recurring_interval <> 'month' or p_recurring_interval_count <> 1
     or p_price_type <> 'recurring' or p_billing_scheme <> 'per_unit'
     or p_recurring_usage_type <> 'licensed' or p_tax_behavior <> 'exclusive'
     or p_product_tax_code <> 'txcd_10103001' then
    raise exception using errcode = '22023', message = 'SAAS_PLAN_CHANGE_INVOICE_PROVIDER_INVALID';
  end if;

  select * into v_event from public.billing_provider_events
  where provider_event_id = p_provider_event_id
    and stripe_account_id = p_stripe_account_id
    and stripe_livemode = p_stripe_livemode
  for update;
  if v_event.provider_event_id is null
     or v_event.payload_hash <> p_payload_hash
     or v_event.event_type <> v_event_type
     or v_event.provider_object_type <> 'invoice'
     or v_event.provider_object_id <> p_stripe_invoice_id
     or v_event.processing_environment_id <> p_environment_id
     or v_event.processing_status <> 'processing'
     or v_event.processing_lease_token <> p_processing_lease_token
     or v_event.processing_lease_expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_EVENT_FENCE_INVALID';
  end if;

  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.stripe_subscription_id = p_stripe_subscription_id
    and enrollment.stripe_livemode = p_stripe_livemode
    and enrollment.stripe_account_id = p_stripe_account_id
    and enrollment.is_current and enrollment.ended_at is null
  for update;
  select binding.* into v_binding from public.billing_customer_bindings as binding
  where binding.id = v_enrollment.customer_binding_id
    and binding.stripe_customer_id = p_stripe_customer_id
    and binding.stripe_livemode = p_stripe_livemode
    and binding.stripe_account_id = p_stripe_account_id;
  select status.* into v_status from public.seller_billing_status as status
  where status.store_id = v_enrollment.store_id for update;
  select changes.* into v_change
  from public.billing_subscription_plan_changes as changes
  where changes.subscription_enrollment_id = v_enrollment.id
    and changes.target_stripe_price_id = p_target_stripe_price_id
    and changes.status in ('requested','pending_payment','scheduled')
    and (changes.stripe_invoice_id is null
      or changes.stripe_invoice_id = p_stripe_invoice_id)
  for update;
  select catalog.* into v_catalog
  from public.billing_provider_price_catalog as catalog
  where catalog.stripe_price_id = p_target_stripe_price_id
    and catalog.stripe_product_id = p_target_stripe_product_id
    and catalog.stripe_livemode = p_stripe_livemode
    and catalog.stripe_account_id = p_stripe_account_id
    and catalog.is_active and catalog.is_verified;
  if v_enrollment.id is null or v_binding.id is null or v_status.id is null
     or v_change.id is null or v_catalog.stripe_price_id is null
     or v_event.store_id <> v_enrollment.store_id
     or v_status.stripe_price_id <> v_change.source_stripe_price_id
     or p_current_subscription_price_id not in (
       v_change.source_stripe_price_id, v_change.target_stripe_price_id
     )
     or v_catalog.unit_amount_cents <> p_unit_amount_cents
     or p_target_line_amount_cents > p_unit_amount_cents
     or (v_change.change_timing = 'immediate'
       and p_billing_reason <> 'subscription_update')
     or (v_change.change_timing = 'period_end'
       and p_billing_reason <> 'subscription_cycle') then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_INVOICE_BINDING_INVALID';
  end if;

  update public.billing_subscription_plan_changes
  set stripe_invoice_id = coalesce(stripe_invoice_id, p_stripe_invoice_id),
      status = case when p_outcome = 'payment_succeeded' then status
        else 'pending_payment' end,
      last_provider_event_id = p_provider_event_id,
      last_provider_event_created_at = p_provider_event_created_at
  where id = v_change.id;

  insert into public.billing_subscription_invoices (
    store_id, subscription_enrollment_id, customer_binding_id,
    stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
    stripe_price_id, stripe_livemode, stripe_account_id,
    billing_reason, collection_method, invoice_status, currency,
    amount_due_cents, amount_paid_cents, amount_remaining_cents,
    base_line_amount_cents, service_period_start, service_period_end,
    paid_at, failure_at, action_required_at, next_payment_attempt_at,
    failure_code, last_provider_event_id, last_provider_event_created_at
  ) values (
    v_enrollment.store_id, v_enrollment.id, v_binding.id,
    p_stripe_customer_id, p_stripe_subscription_id, p_stripe_invoice_id,
    p_target_stripe_price_id, p_stripe_livemode, p_stripe_account_id,
    p_billing_reason, p_collection_method, p_invoice_status, p_currency,
    p_amount_due_cents, p_amount_paid_cents, p_amount_remaining_cents,
    p_target_line_amount_cents, p_service_period_start, p_service_period_end,
    case when p_outcome = 'payment_succeeded' then p_observed_at end,
    case when p_outcome = 'payment_failed' then p_observed_at end,
    case when p_outcome = 'payment_action_required' then p_observed_at end,
    p_next_payment_attempt_at, v_failure_code,
    p_provider_event_id, p_provider_event_created_at
  )
  on conflict (stripe_invoice_id, stripe_livemode, stripe_account_id)
  do update set
    invoice_status = excluded.invoice_status,
    amount_paid_cents = excluded.amount_paid_cents,
    amount_remaining_cents = excluded.amount_remaining_cents,
    paid_at = coalesce(public.billing_subscription_invoices.paid_at, excluded.paid_at),
    failure_at = coalesce(excluded.failure_at, public.billing_subscription_invoices.failure_at),
    action_required_at = coalesce(excluded.action_required_at,
      public.billing_subscription_invoices.action_required_at),
    next_payment_attempt_at = excluded.next_payment_attempt_at,
    failure_code = excluded.failure_code,
    last_provider_event_id = excluded.last_provider_event_id,
    last_provider_event_created_at = excluded.last_provider_event_created_at
  returning * into v_invoice;

  if p_outcome = 'payment_succeeded'
     and p_current_subscription_price_id = v_change.target_stripe_price_id then
    v_completion := public.complete_verified_saas_plan_change(
      v_change.id, p_provider_event_id, p_provider_event_created_at,
      p_current_period_start, p_current_period_end
    );
  elsif p_outcome <> 'payment_succeeded' then
    insert into public.billing_entitlement_events (
      store_id, event_type, provider_event_id, metadata
    ) values (
      v_enrollment.store_id, 'provider_state_applied', p_provider_event_id,
      pg_catalog.jsonb_build_object(
        'lifecycle_event', 'plan_change_payment_pending',
        'plan_change_id', v_change.id, 'invoice_id', p_stripe_invoice_id,
        'outcome', p_outcome
      )
    );
  end if;

  update public.billing_provider_events
  set applied = true, ignored_reason = null
  where provider_event_id = p_provider_event_id
    and stripe_account_id = p_stripe_account_id
    and stripe_livemode = p_stripe_livemode;
  select public.mark_saas_billing_provider_event_processed(
    p_provider_event_id, p_payload_hash, p_stripe_account_id,
    p_stripe_livemode, p_processing_lease_token
  ) into v_finalized;
  if v_finalized <> 'processed' then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_EVENT_FINALIZATION_FAILED';
  end if;
  return query select coalesce(v_completion,
      case when p_outcome = 'payment_succeeded' then 'payment_recorded'
        else 'nonpayment_recorded' end),
    v_enrollment.store_id, v_invoice.id,
    (select paid_through_at from public.seller_billing_status
      where seller_billing_status.store_id = v_enrollment.store_id),
    (select grace_ends_at from public.seller_billing_status
      where seller_billing_status.store_id = v_enrollment.store_id),
    coalesce((select billing_complete from public.seller_onboarding_state
      where seller_onboarding_state.store_id = v_enrollment.store_id), false);
end;
$function$;

create function public.apply_verified_saas_plan_change_subscription_event(
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
  v_event public.billing_provider_events%rowtype;
  v_change public.billing_subscription_plan_changes%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_binding public.billing_customer_bindings%rowtype;
  v_catalog public.billing_provider_price_catalog%rowtype;
  v_invoice public.billing_subscription_invoices%rowtype;
  v_completion text;
  v_finalized text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_event_type not in (
       'customer.subscription.updated',
       'customer.subscription.pending_update_applied'
     )
     or p_subscription_livemode is distinct from p_stripe_livemode
     or p_subscription_status <> 'active' or p_cancel_at_period_end
     or p_line_quantity <> 1
     or p_current_period_end <= p_current_period_start
     or p_price_livemode is distinct from p_stripe_livemode
     or p_product_livemode is distinct from p_stripe_livemode
     or not p_price_active or not p_product_active
     or p_unit_amount_cents <= 0 or p_recurring_interval <> 'month'
     or p_recurring_interval_count <> 1 or p_price_type <> 'recurring'
     or p_billing_scheme <> 'per_unit' or p_recurring_usage_type <> 'licensed'
     or p_tax_behavior <> 'exclusive' or p_product_tax_code <> 'txcd_10103001' then
    raise exception using errcode = '22023', message = 'SAAS_PLAN_CHANGE_SUBSCRIPTION_EVIDENCE_INVALID';
  end if;
  select * into v_event from public.billing_provider_events
  where provider_event_id = p_provider_event_id
    and stripe_account_id = p_stripe_account_id
    and stripe_livemode = p_stripe_livemode for update;
  if v_event.provider_event_id is null or v_event.payload_hash <> p_payload_hash
     or v_event.event_type <> p_event_type
     or v_event.provider_object_type <> 'subscription'
     or v_event.provider_object_id <> p_stripe_subscription_id
     or v_event.processing_environment_id <> p_environment_id
     or v_event.processing_status <> 'processing'
     or v_event.processing_lease_token <> p_processing_lease_token
     or v_event.processing_lease_expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_EVENT_FENCE_INVALID';
  end if;
  select * into v_enrollment from public.billing_subscription_enrollments
  where stripe_subscription_id = p_stripe_subscription_id
    and stripe_livemode = p_stripe_livemode
    and stripe_account_id = p_stripe_account_id
    and is_current and ended_at is null for update;
  select * into v_binding from public.billing_customer_bindings
  where id = v_enrollment.customer_binding_id
    and stripe_customer_id = p_stripe_customer_id
    and stripe_livemode = p_stripe_livemode
    and stripe_account_id = p_stripe_account_id;
  select * into v_change from public.billing_subscription_plan_changes
  where subscription_enrollment_id = v_enrollment.id
    and status in ('requested','pending_payment','scheduled')
    and p_stripe_price_id in (source_stripe_price_id, target_stripe_price_id)
  for update;
  select * into v_catalog from public.billing_provider_price_catalog
  where stripe_price_id = p_stripe_price_id
    and stripe_product_id = p_stripe_product_id
    and stripe_livemode = p_stripe_livemode
    and stripe_account_id = p_stripe_account_id
    and unit_amount_cents = p_unit_amount_cents
    and currency = p_currency and is_active and is_verified;
  if v_enrollment.id is null or v_binding.id is null or v_change.id is null
     or v_catalog.stripe_price_id is null or v_event.store_id <> v_enrollment.store_id then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_SUBSCRIPTION_BINDING_INVALID';
  end if;

  if p_stripe_price_id = v_change.target_stripe_price_id then
    select * into v_invoice from public.billing_subscription_invoices
    where stripe_invoice_id = v_change.stripe_invoice_id
      and subscription_enrollment_id = v_enrollment.id
      and stripe_price_id = v_change.target_stripe_price_id
      and invoice_status = 'paid' and paid_at is not null;
    if v_invoice.id is not null then
      v_completion := public.complete_verified_saas_plan_change(
        v_change.id, p_provider_event_id, p_provider_event_created_at,
        p_current_period_start, p_current_period_end
      );
    end if;
  end if;

  update public.billing_subscription_plan_changes
  set last_provider_event_id = p_provider_event_id,
      last_provider_event_created_at = p_provider_event_created_at
  where id = v_change.id and status <> 'completed';
  update public.billing_provider_events set applied = true, ignored_reason = null
  where provider_event_id = p_provider_event_id
    and stripe_account_id = p_stripe_account_id
    and stripe_livemode = p_stripe_livemode;
  select public.mark_saas_billing_provider_event_processed(
    p_provider_event_id, p_payload_hash, p_stripe_account_id,
    p_stripe_livemode, p_processing_lease_token
  ) into v_finalized;
  if v_finalized <> 'processed' then
    raise exception using errcode = '55000', message = 'SAAS_PLAN_CHANGE_EVENT_FINALIZATION_FAILED';
  end if;
  return query select coalesce(v_completion, 'plan_change_snapshot_recorded'),
    v_enrollment.store_id, p_subscription_status,
    (select paid_through_at from public.seller_billing_status
      where seller_billing_status.store_id = v_enrollment.store_id),
    (select grace_ends_at from public.seller_billing_status
      where seller_billing_status.store_id = v_enrollment.store_id);
end;
$function$;

-- Service lookup used by the existing webhook handler to select the narrow
-- plan-change sink without changing normal invoice/subscription processing.
create function public.get_open_saas_plan_change_for_subscription(
  p_stripe_subscription_id text,
  p_stripe_account_id text,
  p_stripe_livemode boolean
)
returns table (
  plan_change_id uuid,
  source_stripe_price_id text,
  target_stripe_price_id text,
  change_timing text,
  stripe_invoice_id text
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
  select changes.id, changes.source_stripe_price_id,
    changes.target_stripe_price_id, changes.change_timing,
    changes.stripe_invoice_id
  from public.billing_subscription_plan_changes as changes
  join public.billing_subscription_enrollments as enrollment
    on enrollment.id = changes.subscription_enrollment_id
  where enrollment.stripe_subscription_id = p_stripe_subscription_id
    and enrollment.stripe_account_id = p_stripe_account_id
    and enrollment.stripe_livemode = p_stripe_livemode
    and enrollment.is_current and enrollment.ended_at is null
    and changes.status in ('requested','pending_payment','scheduled');
end;
$function$;

revoke all on function public.begin_saas_subscription_plan_change(
  uuid,text,text,boolean,text,text
) from public, anon, authenticated;
revoke all on function public.record_saas_plan_change_provider_binding(
  uuid,text,text,timestamptz,text
) from public, anon, authenticated;
revoke all on function public.begin_saas_scheduled_plan_change_cancellation(
  uuid,boolean,text,text
) from public, anon, authenticated;
revoke all on function public.record_saas_scheduled_plan_change_canceled(uuid)
  from public, anon, authenticated;
revoke all on function public.mark_saas_subscription_plan_change_failed(uuid,text)
  from public, anon, authenticated;
revoke all on function public.complete_verified_saas_plan_change(
  uuid,text,timestamptz,timestamptz,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.get_open_saas_plan_change_for_subscription(
  text,text,boolean
) from public, anon, authenticated;

grant execute on function public.begin_saas_subscription_plan_change(
  uuid,text,text,boolean,text,text
) to service_role;
grant execute on function public.record_saas_plan_change_provider_binding(
  uuid,text,text,timestamptz,text
) to service_role;
grant execute on function public.begin_saas_scheduled_plan_change_cancellation(
  uuid,boolean,text,text
) to service_role;
grant execute on function public.record_saas_scheduled_plan_change_canceled(uuid)
  to service_role;
grant execute on function public.mark_saas_subscription_plan_change_failed(uuid,text)
  to service_role;
grant execute on function public.get_open_saas_plan_change_for_subscription(
  text,text,boolean
) to service_role;

do $grants$
declare v_signature regprocedure;
begin
  for v_signature in
    select procedure.oid::regprocedure
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'apply_verified_saas_plan_change_invoice_event',
        'apply_verified_saas_plan_change_subscription_event'
      )
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_signature
    );
    execute pg_catalog.format('grant execute on function %s to service_role', v_signature);
  end loop;
end;
$grants$;

commit;
