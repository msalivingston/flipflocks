-- SaaS billing enrollment authority foundation.
--
-- This migration adds service-only records for a future verified Stripe
-- subscription workflow. It does not create Checkout Sessions, call Stripe,
-- grant trial access, or change the current entitlement resolver.

begin;

alter table public.billing_provider_price_catalog
  add column if not exists stripe_product_id text,
  add column if not exists unit_amount_cents bigint,
  add column if not exists currency text,
  add column if not exists recurring_interval text,
  add column if not exists recurring_interval_count integer;

alter table public.billing_provider_price_catalog
  add constraint billing_provider_price_catalog_product_not_empty_check
  check (
    stripe_product_id is null
    or length(trim(stripe_product_id)) > 0
  ),
  add constraint billing_provider_price_catalog_amount_nonnegative_check
  check (
    unit_amount_cents is null
    or unit_amount_cents >= 0
  ),
  add constraint billing_provider_price_catalog_currency_check
  check (
    currency is null
    or (
      currency = lower(trim(currency))
      and currency ~ '^[a-z]{3}$'
    )
  ),
  add constraint billing_provider_price_catalog_interval_check
  check (
    recurring_interval is null
    or recurring_interval in ('month', 'year')
  ),
  add constraint billing_provider_price_catalog_interval_count_check
  check (
    recurring_interval_count is null
    or recurring_interval_count > 0
  );

comment on column public.billing_provider_price_catalog.stripe_product_id is
'Trusted Stripe Product identifier observed by a verified service workflow. Nullable until a later activation migration validates the complete catalog.';

comment on column public.billing_provider_price_catalog.unit_amount_cents is
'Trusted recurring Price amount in the currency minor unit. Nullable while SaaS Checkout remains disabled.';

comment on column public.billing_provider_price_catalog.currency is
'Trusted lowercase three-letter recurring Price currency. Nullable while SaaS Checkout remains disabled.';

comment on column public.billing_provider_price_catalog.recurring_interval is
'Trusted Stripe recurring interval. Only month and year are approved for the FlockFront SaaS catalog.';

comment on column public.billing_provider_price_catalog.recurring_interval_count is
'Trusted positive Stripe recurring interval count. Nullable while SaaS Checkout remains disabled.';

create table public.billing_customer_bindings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  stripe_customer_id text not null,
  stripe_livemode boolean not null,
  stripe_account_id text not null,
  provider_created_at timestamptz not null,
  bound_by_event_id text not null,
  created_at timestamptz not null default statement_timestamp(),

  constraint billing_customer_bindings_store_context_unique unique (
    store_id,
    stripe_livemode,
    stripe_account_id
  ),
  constraint billing_customer_bindings_customer_context_unique unique (
    stripe_customer_id,
    stripe_livemode,
    stripe_account_id
  ),
  constraint billing_customer_bindings_context_identity_unique unique (
    id,
    store_id,
    stripe_livemode,
    stripe_account_id
  ),
  constraint billing_customer_bindings_customer_not_empty_check check (
    length(trim(stripe_customer_id)) > 0
  ),
  constraint billing_customer_bindings_account_check check (
    stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  ),
  constraint billing_customer_bindings_event_not_empty_check check (
    length(trim(bound_by_event_id)) > 0
  )
);

comment on table public.billing_customer_bindings is
'Immutable service-only binding of one FlockFront store to one Stripe Customer within a specific FlockFront Stripe platform account and mode.';

comment on column public.billing_customer_bindings.stripe_account_id is
'The real acct_ identifier for the FlockFront Stripe platform account. Empty sentinel values are prohibited.';

create index billing_customer_bindings_store_created_idx
  on public.billing_customer_bindings(store_id, created_at desc);

create table public.billing_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  requested_plan_key text not null,
  requested_billing_cadence text not null,
  stripe_price_id text not null,
  stripe_livemode boolean not null,
  stripe_account_id text not null,
  attempt_status text not null,
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_idempotency_key text not null,
  session_expires_at timestamptz,
  session_created_at timestamptz,
  completed_at timestamptz,
  expired_at timestamptz,
  last_failure_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),

  constraint billing_checkout_attempts_context_identity_unique unique (
    id,
    store_id,
    stripe_livemode,
    stripe_account_id
  ),
  constraint billing_checkout_attempts_plan_check check (
    requested_plan_key in ('small_flock', 'full_flock')
  ),
  constraint billing_checkout_attempts_cadence_check check (
    requested_billing_cadence in ('monthly', 'yearly')
  ),
  constraint billing_checkout_attempts_price_not_empty_check check (
    length(trim(stripe_price_id)) > 0
  ),
  constraint billing_checkout_attempts_account_check check (
    stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  ),
  constraint billing_checkout_attempts_status_check check (
    attempt_status in (
      'creating',
      'open',
      'completed',
      'pending_confirmation',
      'enrolled',
      'expired',
      'superseded',
      'failed'
    )
  ),
  constraint billing_checkout_attempts_session_not_empty_check check (
    stripe_checkout_session_id is null
    or length(trim(stripe_checkout_session_id)) > 0
  ),
  constraint billing_checkout_attempts_customer_not_empty_check check (
    stripe_customer_id is null
    or length(trim(stripe_customer_id)) > 0
  ),
  constraint billing_checkout_attempts_subscription_not_empty_check check (
    stripe_subscription_id is null
    or length(trim(stripe_subscription_id)) > 0
  ),
  constraint billing_checkout_attempts_idempotency_not_empty_check check (
    length(trim(stripe_idempotency_key)) > 0
  ),
  constraint billing_checkout_attempts_session_time_check check (
    session_expires_at is null
    or session_created_at is null
    or session_expires_at > session_created_at
  ),
  constraint billing_checkout_attempts_terminal_time_check check (
    completed_at is null
    or expired_at is null
  ),
  constraint billing_checkout_attempts_failure_code_check check (
    last_failure_code is null
    or length(trim(last_failure_code)) between 1 and 100
  )
);

comment on table public.billing_checkout_attempts is
'Service-only idempotency and audit records for future FlockFront SaaS Checkout creation. This table does not grant access.';

comment on column public.billing_checkout_attempts.stripe_idempotency_key is
'Server-generated Stripe API idempotency key. Browser callers must never supply this value authoritatively.';

create unique index billing_checkout_attempts_session_unique_idx
  on public.billing_checkout_attempts(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index billing_checkout_attempts_idempotency_context_unique_idx
  on public.billing_checkout_attempts(
    stripe_idempotency_key,
    stripe_livemode,
    stripe_account_id
  );

create unique index billing_checkout_attempts_one_unresolved_idx
  on public.billing_checkout_attempts(
    store_id,
    stripe_livemode,
    stripe_account_id
  )
  where attempt_status in (
    'creating',
    'open',
    'completed',
    'pending_confirmation'
  );

create index billing_checkout_attempts_store_created_idx
  on public.billing_checkout_attempts(store_id, created_at desc);

create trigger billing_checkout_attempts_set_updated_at
before update on public.billing_checkout_attempts
for each row
execute function public.set_updated_at();

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
     or new.stripe_idempotency_key is distinct from old.stripe_idempotency_key then
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

create trigger billing_checkout_attempts_enforce_immutability
before update on public.billing_checkout_attempts
for each row
execute function public.enforce_billing_checkout_attempt_immutability();

create table public.billing_subscription_enrollments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  customer_binding_id uuid not null,
  checkout_attempt_id uuid,
  stripe_subscription_id text not null,
  initial_stripe_price_id text not null,
  stripe_livemode boolean not null,
  stripe_account_id text not null,
  provider_status text not null,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  is_current boolean not null default true,
  provider_created_at timestamptz not null,
  bound_by_event_id text not null,
  ended_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),

  constraint billing_subscription_enrollments_identity_unique unique (
    id,
    store_id
  ),
  constraint billing_subscription_enrollments_customer_context_fk foreign key (
    customer_binding_id,
    store_id,
    stripe_livemode,
    stripe_account_id
  ) references public.billing_customer_bindings (
    id,
    store_id,
    stripe_livemode,
    stripe_account_id
  ) on delete restrict,
  constraint billing_subscription_enrollments_attempt_context_fk foreign key (
    checkout_attempt_id,
    store_id,
    stripe_livemode,
    stripe_account_id
  ) references public.billing_checkout_attempts (
    id,
    store_id,
    stripe_livemode,
    stripe_account_id
  ) on delete restrict,
  constraint billing_subscription_enrollments_attempt_unique unique (
    checkout_attempt_id
  ),
  constraint billing_subscription_enrollments_subscription_context_unique unique (
    stripe_subscription_id,
    stripe_livemode,
    stripe_account_id
  ),
  constraint billing_subscription_enrollments_subscription_not_empty_check check (
    length(trim(stripe_subscription_id)) > 0
  ),
  constraint billing_subscription_enrollments_initial_price_not_empty_check check (
    length(trim(initial_stripe_price_id)) > 0
  ),
  constraint billing_subscription_enrollments_account_check check (
    stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  ),
  constraint billing_subscription_enrollments_status_not_empty_check check (
    length(trim(provider_status)) > 0
  ),
  constraint billing_subscription_enrollments_event_not_empty_check check (
    length(trim(bound_by_event_id)) > 0
  ),
  constraint billing_subscription_enrollments_trial_check check (
    (trial_started_at is null and trial_ends_at is null)
    or (
      trial_started_at is not null
      and trial_ends_at is not null
      and trial_ends_at > trial_started_at
    )
  ),
  constraint billing_subscription_enrollments_current_end_check check (
    (is_current and ended_at is null)
    or (not is_current and ended_at is not null)
  )
);

comment on table public.billing_subscription_enrollments is
'Service-only immutable Stripe Subscription binding history. Mutable provider lifecycle snapshots do not permit tenant or provider identifier reassignment.';

create unique index billing_subscription_enrollments_one_current_idx
  on public.billing_subscription_enrollments(
    store_id,
    stripe_livemode,
    stripe_account_id
  )
  where is_current;

create index billing_subscription_enrollments_store_created_idx
  on public.billing_subscription_enrollments(store_id, created_at desc);

create trigger billing_subscription_enrollments_set_updated_at
before update on public.billing_subscription_enrollments
for each row
execute function public.set_updated_at();

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
     or new.initial_stripe_price_id is distinct from old.initial_stripe_price_id
     or new.stripe_livemode is distinct from old.stripe_livemode
     or new.stripe_account_id is distinct from old.stripe_account_id
     or new.provider_created_at is distinct from old.provider_created_at
     or new.bound_by_event_id is distinct from old.bound_by_event_id then
    raise exception 'Billing Subscription enrollment binding fields are immutable.';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_billing_subscription_enrollment_immutability()
  from public, anon, authenticated, service_role;

create trigger billing_subscription_enrollments_enforce_immutability
before update on public.billing_subscription_enrollments
for each row
execute function public.enforce_billing_subscription_enrollment_immutability();

create table public.billing_trial_claims (
  store_id uuid primary key references public.stores(id) on delete restrict,
  subscription_enrollment_id uuid not null,
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz not null,
  provider_event_id text not null,
  claimed_at timestamptz not null default statement_timestamp(),

  constraint billing_trial_claims_enrollment_store_fk foreign key (
    subscription_enrollment_id,
    store_id
  ) references public.billing_subscription_enrollments (
    id,
    store_id
  ) on delete restrict,
  constraint billing_trial_claims_enrollment_unique unique (
    subscription_enrollment_id
  ),
  constraint billing_trial_claims_time_check check (
    trial_ends_at > trial_started_at
  ),
  constraint billing_trial_claims_event_not_empty_check check (
    length(trim(provider_event_id)) > 0
  )
);

comment on table public.billing_trial_claims is
'Append-only one-trial-ever ledger for future verified provider trials. Existing local trial rows are intentionally not backfilled or changed by this disabled foundation migration.';

alter table public.seller_billing_status
  add column if not exists current_subscription_enrollment_id uuid;

alter table public.seller_billing_status
  add constraint seller_billing_status_current_enrollment_fk
  foreign key (current_subscription_enrollment_id, store_id)
  references public.billing_subscription_enrollments(id, store_id)
  on delete restrict;

create index seller_billing_status_current_enrollment_idx
  on public.seller_billing_status(current_subscription_enrollment_id)
  where current_subscription_enrollment_id is not null;

alter table public.billing_provider_events
  add column if not exists processing_status text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists attempt_count integer,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text,
  add column if not exists provider_object_type text,
  add column if not exists provider_object_id text;

-- All pre-foundation rows were synchronously applied or ignored by the
-- verified subscription-event RPC. They must not appear as new pending work.
update public.billing_provider_events
set
  processing_status = case
    when ignored_reason is not null then 'ignored'
    else 'processed'
  end,
  processed_at = coalesce(processed_at, created_at),
  attempt_count = coalesce(attempt_count, 1)
where processing_status is null;

alter table public.billing_provider_events
  alter column processing_status set default 'processed',
  alter column processing_status set not null,
  alter column attempt_count set default 1,
  alter column attempt_count set not null,
  add constraint billing_provider_events_processing_status_check check (
    processing_status in (
      'received',
      'processing',
      'processed',
      'failed',
      'ignored'
    )
  ),
  add constraint billing_provider_events_attempt_count_check check (
    attempt_count >= 0
  ),
  add constraint billing_provider_events_processing_time_check check (
    processing_status <> 'processing'
    or processing_started_at is not null
  ),
  add constraint billing_provider_events_processed_time_check check (
    processing_status not in ('processed', 'ignored')
    or processed_at is not null
  ),
  add constraint billing_provider_events_failed_time_check check (
    processing_status <> 'failed'
    or failed_at is not null
  ),
  add constraint billing_provider_events_error_code_check check (
    last_error_code is null
    or length(trim(last_error_code)) between 1 and 100
  ),
  add constraint billing_provider_events_error_message_check check (
    last_error_message is null
    or length(trim(last_error_message)) between 1 and 500
  ),
  add constraint billing_provider_events_object_pair_check check (
    (provider_object_type is null and provider_object_id is null)
    or (
      provider_object_type is not null
      and provider_object_id is not null
      and length(trim(provider_object_type)) > 0
      and length(trim(provider_object_id)) > 0
    )
  );

create or replace function public.normalize_billing_provider_event_processing_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  -- Preserve compatibility with the existing synchronous verified event RPC,
  -- which writes applied/ignored state but predates processing_status.
  if new.processing_status = 'processed'
     and not new.applied
     and new.ignored_reason is not null then
    new.processing_status := 'ignored';
  end if;

  if new.processing_status in ('processed', 'ignored')
     and new.processed_at is null then
    new.processed_at := statement_timestamp();
  end if;

  return new;
end;
$function$;

revoke all on function public.normalize_billing_provider_event_processing_state()
  from public, anon, authenticated, service_role;

create trigger billing_provider_events_normalize_processing_state
before insert on public.billing_provider_events
for each row
execute function public.normalize_billing_provider_event_processing_state();

create index billing_provider_events_processing_status_idx
  on public.billing_provider_events(processing_status, provider_event_created_at)
  where processing_status in ('received', 'processing', 'failed');

create index billing_provider_events_provider_object_idx
  on public.billing_provider_events(provider_object_type, provider_object_id)
  where provider_object_id is not null;

create unique index billing_provider_events_context_store_event_unique_idx
  on public.billing_provider_events(
    stripe_livemode,
    stripe_account_id,
    provider_event_id,
    store_id
  );

alter table public.billing_customer_bindings
  add constraint billing_customer_bindings_provider_event_fk foreign key (
    stripe_livemode,
    stripe_account_id,
    bound_by_event_id,
    store_id
  ) references public.billing_provider_events (
    stripe_livemode,
    stripe_account_id,
    provider_event_id,
    store_id
  ) on delete restrict;

alter table public.billing_subscription_enrollments
  add constraint billing_subscription_enrollments_provider_event_fk foreign key (
    stripe_livemode,
    stripe_account_id,
    bound_by_event_id,
    store_id
  ) references public.billing_provider_events (
    stripe_livemode,
    stripe_account_id,
    provider_event_id,
    store_id
  ) on delete restrict;

comment on column public.billing_provider_events.last_error_message is
'Sanitized operational error text limited to 500 characters. Never store raw Stripe payloads, secrets, or payment credentials.';

comment on column public.billing_provider_events.provider_object_id is
'Optional non-sensitive Stripe object identifier used for operational reconciliation. Raw event payloads are not stored.';

alter table public.platform_settings
  drop constraint platform_settings_supported_keys_check;

alter table public.platform_settings
  alter column boolean_value set default false,
  add constraint platform_settings_supported_keys_check check (
    setting_key in (
      'seller_signups_enabled',
      'saas_subscription_checkout_enabled',
      'saas_billing_portal_enabled'
    )
  );

insert into public.platform_settings (setting_key, boolean_value)
values
  ('saas_subscription_checkout_enabled', false),
  ('saas_billing_portal_enabled', false)
on conflict (setting_key) do nothing;

alter table public.billing_customer_bindings enable row level security;
alter table public.billing_checkout_attempts enable row level security;
alter table public.billing_subscription_enrollments enable row level security;
alter table public.billing_trial_claims enable row level security;

revoke all on table public.billing_customer_bindings
  from public, anon, authenticated, service_role;
revoke all on table public.billing_checkout_attempts
  from public, anon, authenticated, service_role;
revoke all on table public.billing_subscription_enrollments
  from public, anon, authenticated, service_role;
revoke all on table public.billing_trial_claims
  from public, anon, authenticated, service_role;

grant select, insert on table public.billing_customer_bindings to service_role;
grant select, insert, update on table public.billing_checkout_attempts to service_role;
grant select, insert, update on table public.billing_subscription_enrollments to service_role;
grant select, insert on table public.billing_trial_claims to service_role;

-- Future verified event workers need operational state updates. Browser roles
-- remain fully revoked from this provider ledger.
revoke all on table public.billing_provider_events
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.billing_provider_events to service_role;

commit;
