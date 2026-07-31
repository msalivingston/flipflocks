-- Phase 1 Security Batch C, part 1:
-- establish an authoritative, expiry-aware billing snapshot and trusted writers.
--
-- This migration intentionally does not change public visibility. The following
-- enforcement migration applies the resolver only after access-granting legacy
-- rows have been classified.

begin;

alter table public.seller_billing_status
  add column if not exists requested_plan_key text,
  add column if not exists requested_billing_cadence text,
  add column if not exists trial_started_at timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists billing_state_authority text not null default 'legacy_unclassified',
  add column if not exists stripe_price_id text,
  add column if not exists stripe_livemode boolean,
  add column if not exists stripe_account_id text,
  add column if not exists last_provider_event_id text,
  add column if not exists last_provider_event_created_at timestamptz,
  add column if not exists last_provider_event_applied_at timestamptz,
  add column if not exists comp_granted_by_user_id uuid references auth.users(id),
  add column if not exists comp_grant_reason text,
  add column if not exists comp_granted_at timestamptz,
  add column if not exists comp_access_until timestamptz,
  add column if not exists comp_revoked_by_user_id uuid references auth.users(id),
  add column if not exists comp_revocation_reason text,
  add column if not exists comp_revoked_at timestamptz;

alter table public.seller_billing_status
  alter column subscription_status set default 'dormant';

-- Browser and platform-admin sessions receive read-only billing snapshots.
-- Effective-state changes must use the owner onboarding wrapper, audited admin
-- comp wrappers, or the future verified service contract below.
drop policy if exists "Admins can insert billing status"
  on public.seller_billing_status;
drop policy if exists "Admins can update billing status"
  on public.seller_billing_status;
drop policy if exists "Admins can delete billing status"
  on public.seller_billing_status;

revoke all on table public.seller_billing_status
  from public, anon, authenticated;
grant select on table public.seller_billing_status to authenticated;

update public.seller_billing_status
set
  requested_plan_key = case
    when plan_key in ('small_flock', 'full_flock') then plan_key
    else 'small_flock'
  end,
  requested_billing_cadence = case
    when billing_plan in ('monthly', 'yearly') then billing_plan
    else null
  end
where requested_plan_key is null;

-- Only classify legacy trials whose original seven-day boundary is structurally
-- intact. Replayed, promo-derived, or otherwise ambiguous rows remain
-- legacy_unclassified and block the enforcement migration.
update public.seller_billing_status
set
  billing_state_authority = 'trial',
  trial_started_at = trial_ends_at - interval '7 days',
  current_period_start = trial_ends_at - interval '7 days',
  current_period_end = trial_ends_at,
  applied_promo_code = null
where billing_state_authority = 'legacy_unclassified'
  and subscription_status = 'trialing'
  and applied_promo_code is null
  and stripe_customer_id is null
  and stripe_subscription_id is null
  and trial_ends_at is not null
  and storefront_access_until = trial_ends_at
  and trial_ends_at > created_at
  and trial_ends_at <= created_at + interval '7 days 5 minutes'
  and plan_key in ('small_flock', 'full_flock')
  and billing_plan in ('monthly', 'yearly');

-- A linked legacy paid row can be classified without inventing provider data
-- only when the existing provider identifiers and paid cutoff agree.
update public.seller_billing_status
set billing_state_authority = 'legacy_stripe'
where billing_state_authority = 'legacy_unclassified'
  and subscription_status = 'active'
  and nullif(trim(stripe_customer_id), '') is not null
  and nullif(trim(stripe_subscription_id), '') is not null
  and current_period_end is not null
  and storefront_access_until = current_period_end
  and plan_key in ('small_flock', 'full_flock')
  and billing_plan in ('monthly', 'yearly');

alter table public.seller_billing_status
  drop constraint if exists seller_billing_status_subscription_status_check;

alter table public.seller_billing_status
  add constraint seller_billing_status_subscription_status_check
  check (
    subscription_status in (
      'trialing',
      'active',
      'past_due',
      'dormant',
      'canceled',
      'comped',
      'incomplete',
      'incomplete_expired',
      'suspended'
    )
  ) not valid;

alter table public.seller_billing_status
  add constraint seller_billing_status_requested_plan_key_check
  check (
    requested_plan_key is null
    or requested_plan_key in ('small_flock', 'full_flock')
  ) not valid,
  add constraint seller_billing_status_requested_cadence_check
  check (
    requested_billing_cadence is null
    or requested_billing_cadence in ('monthly', 'yearly')
  ) not valid,
  add constraint seller_billing_status_authority_check
  check (
    billing_state_authority in (
      'legacy_unclassified',
      'trial',
      'legacy_stripe',
      'stripe',
      'admin_comp'
    )
  ) not valid,
  add constraint seller_billing_status_comp_reason_check
  check (
    comp_grant_reason is null
    or (
      length(trim(comp_grant_reason)) between 1 and 500
      and comp_grant_reason = trim(comp_grant_reason)
    )
  ) not valid,
  add constraint seller_billing_status_comp_revocation_reason_check
  check (
    comp_revocation_reason is null
    or (
      length(trim(comp_revocation_reason)) between 1 and 500
      and comp_revocation_reason = trim(comp_revocation_reason)
    )
  ) not valid;

create index if not exists seller_billing_status_authority_idx
  on public.seller_billing_status(billing_state_authority);

create index if not exists seller_billing_status_provider_event_idx
  on public.seller_billing_status(last_provider_event_created_at, last_provider_event_id);

create table if not exists public.billing_entitlement_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  event_type text not null,
  reason text,
  plan_key text,
  billing_cadence text,
  access_until timestamptz,
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),

  constraint billing_entitlement_events_type_check check (
    event_type in (
      'trial_started',
      'trial_selection_changed',
      'legacy_trial_classified',
      'legacy_stripe_classified',
      'admin_comp_granted',
      'admin_comp_revoked',
      'provider_state_applied',
      'provider_event_ignored'
    )
  ),
  constraint billing_entitlement_events_reason_length_check check (
    reason is null or length(reason) <= 500
  ),
  constraint billing_entitlement_events_plan_check check (
    plan_key is null or plan_key in ('small_flock', 'full_flock')
  ),
  constraint billing_entitlement_events_cadence_check check (
    billing_cadence is null or billing_cadence in ('monthly', 'yearly')
  )
);

create index if not exists billing_entitlement_events_store_created_idx
  on public.billing_entitlement_events(store_id, created_at desc);

insert into public.billing_entitlement_events (
  store_id,
  event_type,
  plan_key,
  billing_cadence,
  access_until,
  metadata
)
select
  seller_billing_status.store_id,
  case
    when seller_billing_status.billing_state_authority = 'trial'
      then 'legacy_trial_classified'
    else 'legacy_stripe_classified'
  end,
  seller_billing_status.plan_key,
  case
    when seller_billing_status.billing_plan in ('monthly', 'yearly')
      then seller_billing_status.billing_plan
    else null
  end,
  seller_billing_status.storefront_access_until,
  jsonb_build_object('classification_batch', 'phase_1_security_batch_c')
from public.seller_billing_status
where seller_billing_status.billing_state_authority in ('trial', 'legacy_stripe');

alter table public.billing_entitlement_events enable row level security;

drop policy if exists "Platform admins can read billing entitlement events"
  on public.billing_entitlement_events;
create policy "Platform admins can read billing entitlement events"
  on public.billing_entitlement_events
  for select
  to authenticated
  using (public.is_admin());

revoke all on table public.billing_entitlement_events from public, anon, authenticated;
grant select on table public.billing_entitlement_events to authenticated;

create table if not exists public.billing_provider_price_catalog (
  stripe_price_id text not null,
  stripe_livemode boolean not null,
  stripe_account_id text not null default '',
  plan_key text not null,
  billing_cadence text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (stripe_price_id, stripe_livemode, stripe_account_id),

  constraint billing_provider_price_catalog_plan_check check (
    plan_key in ('small_flock', 'full_flock')
  ),
  constraint billing_provider_price_catalog_cadence_check check (
    billing_cadence in ('monthly', 'yearly')
  ),
  constraint billing_provider_price_catalog_price_not_empty_check check (
    length(trim(stripe_price_id)) > 0
  )
);

create trigger billing_provider_price_catalog_set_updated_at
before update on public.billing_provider_price_catalog
for each row
execute function public.set_updated_at();

alter table public.billing_provider_price_catalog enable row level security;
revoke all on table public.billing_provider_price_catalog
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.billing_provider_price_catalog to service_role;

create table if not exists public.billing_provider_events (
  stripe_livemode boolean not null,
  stripe_account_id text not null default '',
  provider_event_id text not null,
  provider_event_created_at timestamptz not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  event_type text not null,
  payload_hash text not null,
  applied boolean not null,
  ignored_reason text,
  created_at timestamptz not null default statement_timestamp(),
  primary key (stripe_livemode, stripe_account_id, provider_event_id),

  constraint billing_provider_events_id_not_empty_check check (
    length(trim(provider_event_id)) > 0
  ),
  constraint billing_provider_events_hash_not_empty_check check (
    length(trim(payload_hash)) > 0
  )
);

create index if not exists billing_provider_events_store_created_idx
  on public.billing_provider_events(store_id, provider_event_created_at desc);

alter table public.billing_provider_events enable row level security;
revoke all on table public.billing_provider_events
  from public, anon, authenticated;
grant select, insert on table public.billing_provider_events to service_role;

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
  v_held boolean := false;
  v_now timestamptz := statement_timestamp();
  v_valid boolean := false;
  v_reason text := 'inactive';
  v_until timestamptz;
begin
  select stores.admin_hold_reason is not null
  into v_held
  from public.stores
  where stores.id = p_store_id;

  if not found then
    return query select false, null::text, null::text, 'missing_store'::text, null::timestamptz, false;
    return;
  end if;

  select *
  into v_billing
  from public.seller_billing_status
  where seller_billing_status.store_id = p_store_id;

  if v_billing.id is null then
    return query select false, null::text, null::text, 'missing_billing'::text, null::timestamptz, v_held;
    return;
  end if;

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
          select 1
          from public.billing_provider_price_catalog
          where billing_provider_price_catalog.stripe_price_id = v_billing.stripe_price_id
            and billing_provider_price_catalog.stripe_livemode = v_billing.stripe_livemode
            and billing_provider_price_catalog.stripe_account_id = coalesce(v_billing.stripe_account_id, '')
            and billing_provider_price_catalog.plan_key = v_billing.plan_key
            and billing_provider_price_catalog.billing_cadence = v_billing.billing_plan
        )
      )
    ) then
    v_valid := true;
    v_reason := case
      when v_billing.cancel_at_period_end then 'paid_canceling'
      else 'paid'
    end;
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
        'past_due', 'canceled', 'dormant', 'incomplete',
        'incomplete_expired', 'suspended'
      ) then v_billing.subscription_status
      when v_billing.billing_state_authority = 'legacy_unclassified' then 'unclassified'
      else 'malformed'
    end;
  end if;

  if v_held then
    return query select false, null::text, null::text, 'administrative_hold'::text, v_until, true;
  elsif v_valid then
    return query
    select
      true,
      v_billing.plan_key,
      case when v_billing.billing_plan in ('monthly', 'yearly') then v_billing.billing_plan else null end,
      v_reason,
      v_until,
      false;
  else
    return query select false, null::text, null::text, v_reason, v_until, false;
  end if;
end;
$function$;

comment on function public.resolve_store_entitlement(uuid) is
'Internal authoritative entitlement resolver. Missing, expired, held, unclassified, or contradictory state fails closed.';

revoke all on function public.resolve_store_entitlement(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.store_has_active_entitlement(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(
    (
      select entitlement.has_active_access
      from public.resolve_store_entitlement(p_store_id) as entitlement
    ),
    false
  );
$function$;

revoke all on function public.store_has_active_entitlement(uuid) from public;
grant execute on function public.store_has_active_entitlement(uuid)
  to anon, authenticated, service_role;

drop function if exists public.seller_save_onboarding_plan_access(jsonb);
create function public.seller_save_onboarding_plan_access(p_plan jsonb)
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

comment on function public.seller_save_onboarding_plan_access(jsonb) is
'Owner-only onboarding plan request. Starts one immutable seven-day trial or changes requested plan/cadence during that same unexpired trial; browser promotions never grant access.';

revoke all on function public.seller_save_onboarding_plan_access(jsonb) from public;
grant execute on function public.seller_save_onboarding_plan_access(jsonb) to authenticated;

create or replace function public.admin_grant_store_comp(
  p_store_id uuid,
  p_plan_key text,
  p_reason text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(p_reason), '');
  v_store public.stores%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_inventory record;
  v_was_active boolean := false;
  v_now timestamptz := statement_timestamp();
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;
  if p_plan_key not in ('small_flock', 'full_flock') then
    raise exception 'Plan must be small_flock or full_flock.';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'A reason between 1 and 500 characters is required.';
  end if;
  if p_expires_at is null or p_expires_at <= v_now then
    raise exception 'A future comp expiration is required.';
  end if;

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id
  for update;
  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  v_was_active := public.store_has_active_entitlement(v_store.id);

  select *
  into v_billing
  from public.seller_billing_status
  where seller_billing_status.store_id = v_store.id
  for update;

  if v_billing.id is not null
    and (
      nullif(trim(v_billing.stripe_customer_id), '') is not null
      or nullif(trim(v_billing.stripe_subscription_id), '') is not null
      or v_billing.billing_state_authority in ('stripe', 'legacy_stripe')
    ) then
    raise exception 'A Stripe-linked billing state cannot be replaced by an administrative comp.';
  end if;

  if v_billing.id is null then
    insert into public.seller_billing_status (
      store_id,
      requested_plan_key,
      plan_key,
      billing_plan,
      subscription_status,
      storefront_access_until,
      billing_state_authority,
      comp_granted_by_user_id,
      comp_grant_reason,
      comp_granted_at,
      comp_access_until
    )
    values (
      v_store.id,
      p_plan_key,
      p_plan_key,
      'comped',
      'comped',
      p_expires_at,
      'admin_comp',
      v_actor,
      v_reason,
      v_now,
      p_expires_at
    );
  else
    update public.seller_billing_status
    set
      requested_plan_key = p_plan_key,
      plan_key = p_plan_key,
      billing_plan = 'comped',
      subscription_status = 'comped',
      storefront_access_until = p_expires_at,
      billing_state_authority = 'admin_comp',
      cancel_at_period_end = false,
      comp_granted_by_user_id = v_actor,
      comp_grant_reason = v_reason,
      comp_granted_at = v_now,
      comp_access_until = p_expires_at,
      comp_revoked_by_user_id = null,
      comp_revocation_reason = null,
      comp_revoked_at = null,
      applied_promo_code = null
    where seller_billing_status.id = v_billing.id;
  end if;

  perform public.assert_store_plan_allows_store_modules(
    v_store.id,
    v_store.hatching_eggs_enabled,
    v_store.equipment_supplies_enabled,
    v_store.processed_poultry_enabled
  );

  for v_inventory in
    select
      inventory_items.id,
      inventory_items.listing_batch_id,
      listing_batches.batch_type,
      inventory_items.inventory_type,
      inventory_items.custom_inventory_label,
      inventory_items.quantity_available,
      inventory_items.visibility_status
    from public.inventory_items
    join public.listing_batches
      on listing_batches.id = inventory_items.listing_batch_id
    where inventory_items.store_id = v_store.id
      and inventory_items.visibility_status = 'active'
  loop
    perform public.assert_store_plan_allows_inventory_item(
      v_store.id,
      v_inventory.listing_batch_id,
      v_inventory.batch_type,
      v_inventory.inventory_type,
      v_inventory.custom_inventory_label,
      v_inventory.quantity_available,
      v_inventory.visibility_status,
      v_inventory.id
    );
  end loop;

  if not v_was_active then
    update public.stores
    set storefront_enabled = false
    where stores.id = v_store.id;
  end if;

  insert into public.billing_entitlement_events (
    store_id, actor_user_id, event_type, reason, plan_key, access_until
  )
  values (
    v_store.id, v_actor, 'admin_comp_granted', v_reason, p_plan_key, p_expires_at
  );

  insert into public.admin_activity_events (
    actor_user_id, action_type, target_store_id, reason, metadata
  )
  values (
    v_actor,
    'store_comp_granted',
    v_store.id,
    v_reason,
    jsonb_build_object('plan_key', p_plan_key, 'access_until', p_expires_at)
  );
end;
$function$;

create or replace function public.admin_revoke_store_comp(
  p_store_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(p_reason), '');
  v_billing public.seller_billing_status%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'A reason between 1 and 500 characters is required.';
  end if;

  select *
  into v_billing
  from public.seller_billing_status
  where seller_billing_status.store_id = p_store_id
  for update;

  if v_billing.id is null
    or v_billing.billing_state_authority <> 'admin_comp'
    or v_billing.subscription_status <> 'comped'
    or v_billing.comp_revoked_at is not null then
    raise exception 'An active administrative comp is not available.';
  end if;

  update public.seller_billing_status
  set
    subscription_status = 'canceled',
    storefront_access_until = v_now,
    comp_access_until = v_now,
    comp_revoked_by_user_id = v_actor,
    comp_revocation_reason = v_reason,
    comp_revoked_at = v_now
  where seller_billing_status.id = v_billing.id;

  update public.stores
  set storefront_enabled = false
  where stores.id = p_store_id;

  insert into public.billing_entitlement_events (
    store_id, actor_user_id, event_type, reason, plan_key, access_until
  )
  values (
    p_store_id, v_actor, 'admin_comp_revoked', v_reason, v_billing.plan_key, v_now
  );

  insert into public.admin_activity_events (
    actor_user_id, action_type, target_store_id, reason, metadata
  )
  values (
    v_actor,
    'store_comp_revoked',
    p_store_id,
    v_reason,
    jsonb_build_object('previous_access_until', v_billing.comp_access_until)
  );
end;
$function$;

revoke all on function public.admin_grant_store_comp(uuid, text, text, timestamptz)
  from public, anon;
revoke all on function public.admin_revoke_store_comp(uuid, text)
  from public, anon;
grant execute on function public.admin_grant_store_comp(uuid, text, text, timestamptz)
  to authenticated;
grant execute on function public.admin_revoke_store_comp(uuid, text)
  to authenticated;

alter table public.admin_activity_events
  drop constraint if exists admin_activity_events_action_type_check;
alter table public.admin_activity_events
  add constraint admin_activity_events_action_type_check check (
    action_type in (
      'store_suspended',
      'store_reactivated',
      'notification_retried',
      'notification_suppressed',
      'storefront_enabled',
      'storefront_disabled',
      'store_hold_placed',
      'store_hold_removed',
      'store_plan_changed',
      'store_comp_granted',
      'store_comp_revoked',
      'store_internal_note_updated'
    )
  );

-- The historical admin operation remains callable for deployment compatibility,
-- but now changes requested plan only and can never create effective access.
create or replace function public.admin_change_store_plan(
  p_store_id uuid,
  p_plan_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
  v_store public.stores%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_previous_requested text;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;
  if p_plan_key not in ('small_flock', 'full_flock') then
    raise exception 'Plan must be small_flock or full_flock.';
  end if;

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id
  for update;
  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  select *
  into v_billing
  from public.seller_billing_status
  where seller_billing_status.store_id = v_store.id
  for update;

  v_previous_requested := v_billing.requested_plan_key;

  if v_billing.id is null then
    insert into public.seller_billing_status (
      store_id,
      requested_plan_key,
      plan_key,
      subscription_status,
      billing_state_authority
    )
    values (
      v_store.id,
      p_plan_key,
      'small_flock',
      'dormant',
      'legacy_unclassified'
    );
  else
    update public.seller_billing_status
    set requested_plan_key = p_plan_key
    where seller_billing_status.id = v_billing.id;
  end if;

  insert into public.admin_activity_events (
    actor_user_id, action_type, target_store_id, metadata
  )
  values (
    v_actor,
    'store_plan_changed',
    v_store.id,
    jsonb_build_object(
      'previous_requested_value', v_previous_requested,
      'new_requested_value', p_plan_key,
      'change_mode', 'requested_only'
    )
  );
end;
$function$;

revoke all on function public.admin_change_store_plan(uuid, text) from public, anon;
grant execute on function public.admin_change_store_plan(uuid, text) to authenticated;

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

  select *
  into v_prior_event
  from public.billing_provider_events
  where billing_provider_events.stripe_livemode = p_stripe_livemode
    and billing_provider_events.stripe_account_id = v_account
    and billing_provider_events.provider_event_id = v_event_id;

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
          select seller_billing_status.subscription_status
          from public.seller_billing_status
          where seller_billing_status.store_id = v_prior_event.store_id
        ),
        'dormant'
      ),
      (
        select seller_billing_status.storefront_access_until
        from public.seller_billing_status
        where seller_billing_status.store_id = v_prior_event.store_id
      );
    return;
  end if;

  select *
  into v_price_row
  from public.billing_provider_price_catalog
  where billing_provider_price_catalog.stripe_price_id = v_price
    and billing_provider_price_catalog.stripe_livemode = p_stripe_livemode
    and billing_provider_price_catalog.stripe_account_id = v_account
    and billing_provider_price_catalog.is_active = true;
  if v_price_row.stripe_price_id is null then
    raise exception 'Stripe price is not registered for this environment and account.';
  end if;

  if exists (
    select 1
    from public.seller_billing_status
    where seller_billing_status.store_id <> p_store_id
      and seller_billing_status.stripe_customer_id = v_customer
  ) or exists (
    select 1
    from public.seller_billing_status
    where seller_billing_status.store_id <> p_store_id
      and seller_billing_status.stripe_subscription_id = v_subscription
  ) then
    raise exception 'Provider customer or subscription is already bound to another store.';
  end if;

  perform 1
  from public.stores
  where stores.id = p_store_id
  for update;
  if not found then
    raise exception 'Store is not available.';
  end if;

  v_was_active := public.store_has_active_entitlement(p_store_id);

  select *
  into v_billing
  from public.seller_billing_status
  where seller_billing_status.store_id = p_store_id
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

  insert into public.seller_billing_status (
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
  on conflict (store_id) do update
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
  returning * into v_billing;

  if (
      not v_was_active
      or v_previous_plan_key is distinct from v_price_row.plan_key
    )
    and p_subscription_status = 'active' then
    update public.stores
    set storefront_enabled = false
    where stores.id = p_store_id;
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
