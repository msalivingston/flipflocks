begin;

alter table public.billing_provider_price_catalog
  alter column stripe_account_id drop default,
  add column tax_behavior text,
  add column stripe_product_tax_code text,
  add column stripe_price_type text,
  add column billing_scheme text,
  add column recurring_usage_type text,
  add column stripe_price_active boolean,
  add column stripe_product_active boolean,
  add column stripe_price_created_at timestamptz,
  add column stripe_product_created_at timestamptz,
  add column verified_at timestamptz,
  add column verification_api_version text,
  add column deactivated_at timestamptz,
  add column deactivated_reason text;

alter table public.billing_provider_price_catalog
  add column is_verified boolean generated always as (
    verified_at is not null
    and stripe_product_id is not null
    and unit_amount_cents is not null
    and currency = 'usd'
    and recurring_interval is not null
    and recurring_interval_count = 1
    and tax_behavior = 'exclusive'
    and stripe_product_tax_code = 'txcd_10103001'
    and stripe_price_type = 'recurring'
    and billing_scheme = 'per_unit'
    and recurring_usage_type = 'licensed'
    and stripe_price_active = true
    and stripe_product_active = true
    and stripe_price_created_at is not null
    and stripe_product_created_at is not null
    and verification_api_version is not null
    and (
      (plan_key = 'small_flock' and billing_cadence = 'monthly'
        and unit_amount_cents = 500 and recurring_interval = 'month')
      or (plan_key = 'small_flock' and billing_cadence = 'yearly'
        and unit_amount_cents = 5000 and recurring_interval = 'year')
      or (plan_key = 'full_flock' and billing_cadence = 'monthly'
        and unit_amount_cents = 2900 and recurring_interval = 'month')
      or (plan_key = 'full_flock' and billing_cadence = 'yearly'
        and unit_amount_cents = 27000 and recurring_interval = 'year')
    )
  ) stored;

alter table public.billing_provider_price_catalog
  add constraint billing_provider_price_catalog_account_format_check
    check (verified_at is null or stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  add constraint billing_provider_price_catalog_price_format_check
    check (verified_at is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  add constraint billing_provider_price_catalog_product_format_check
    check (
      verified_at is null
      or (stripe_product_id is not null and stripe_product_id ~ '^prod_[A-Za-z0-9]+$')
    ),
  add constraint billing_provider_price_catalog_tax_behavior_check
    check (tax_behavior is null or tax_behavior = 'exclusive'),
  add constraint billing_provider_price_catalog_product_tax_code_check
    check (stripe_product_tax_code is null or stripe_product_tax_code = 'txcd_10103001'),
  add constraint billing_provider_price_catalog_price_type_check
    check (stripe_price_type is null or stripe_price_type = 'recurring'),
  add constraint billing_provider_price_catalog_billing_scheme_check
    check (billing_scheme is null or billing_scheme = 'per_unit'),
  add constraint billing_provider_price_catalog_usage_type_check
    check (recurring_usage_type is null or recurring_usage_type = 'licensed'),
  add constraint billing_provider_price_catalog_provider_created_check
    check (
      (stripe_price_created_at is null or stripe_price_created_at >= timestamptz '2000-01-01 00:00:00+00')
      and (stripe_product_created_at is null or stripe_product_created_at >= timestamptz '2000-01-01 00:00:00+00')
    ),
  add constraint billing_provider_price_catalog_api_version_check
    check (
      verification_api_version is null
      or (
        verification_api_version = trim(verification_api_version)
        and length(verification_api_version) between 1 and 64
        and verification_api_version !~ '[[:cntrl:]]'
      )
    ),
  add constraint billing_provider_price_catalog_deactivation_reason_check
    check (
      deactivated_reason is null
      or (
        deactivated_reason = trim(deactivated_reason)
        and length(deactivated_reason) between 1 and 256
        and deactivated_reason !~ '[[:cntrl:]]'
      )
    ),
  add constraint billing_provider_price_catalog_verified_evidence_check
    check (
      verified_at is null
      or (
        stripe_product_id ~ '^prod_[A-Za-z0-9]+$'
        and stripe_price_id ~ '^price_[A-Za-z0-9]+$'
        and stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
        and currency = 'usd'
        and recurring_interval_count = 1
        and tax_behavior = 'exclusive'
        and stripe_product_tax_code = 'txcd_10103001'
        and stripe_price_type = 'recurring'
        and billing_scheme = 'per_unit'
        and recurring_usage_type = 'licensed'
        and stripe_price_active = true
        and stripe_product_active = true
        and stripe_price_created_at >= timestamptz '2000-01-01 00:00:00+00'
        and stripe_product_created_at >= timestamptz '2000-01-01 00:00:00+00'
        and verification_api_version is not null
        and (
          (plan_key = 'small_flock' and billing_cadence = 'monthly'
            and unit_amount_cents = 500 and recurring_interval = 'month')
          or (plan_key = 'small_flock' and billing_cadence = 'yearly'
            and unit_amount_cents = 5000 and recurring_interval = 'year')
          or (plan_key = 'full_flock' and billing_cadence = 'monthly'
            and unit_amount_cents = 2900 and recurring_interval = 'month')
          or (plan_key = 'full_flock' and billing_cadence = 'yearly'
            and unit_amount_cents = 27000 and recurring_interval = 'year')
        )
      )
    ),
  add constraint billing_provider_price_catalog_verified_activation_check
    check (
      not is_verified
      or (
        (is_active and deactivated_at is null and deactivated_reason is null)
        or (not is_active and deactivated_at is not null and deactivated_reason is not null)
      )
    );

comment on column public.billing_provider_price_catalog.is_verified is
'Derived, non-caller-controlled proof that all approved FlockFront SaaS Price evidence is present and internally consistent.';

create unique index billing_price_catalog_active_verified_selection_uidx
  on public.billing_provider_price_catalog (
    plan_key, billing_cadence, stripe_account_id, stripe_livemode
  )
  where is_active and is_verified;

create table public.billing_provider_price_catalog_events (
  id uuid primary key default gen_random_uuid(),
  stripe_price_id text not null,
  stripe_product_id text not null,
  stripe_account_id text not null,
  stripe_livemode boolean not null,
  plan_key text not null,
  billing_cadence text not null,
  event_type text not null,
  previous_active_state boolean,
  new_active_state boolean,
  unit_amount_cents bigint not null,
  currency text not null,
  recurring_interval text not null,
  tax_behavior text not null,
  stripe_product_tax_code text not null,
  verification_api_version text not null,
  reason text,
  created_at timestamptz not null default statement_timestamp(),

  constraint billing_provider_price_catalog_events_price_check
    check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  constraint billing_provider_price_catalog_events_product_check
    check (stripe_product_id ~ '^prod_[A-Za-z0-9]+$'),
  constraint billing_provider_price_catalog_events_account_check
    check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  constraint billing_provider_price_catalog_events_plan_check
    check (plan_key in ('small_flock', 'full_flock')),
  constraint billing_provider_price_catalog_events_cadence_check
    check (billing_cadence in ('monthly', 'yearly')),
  constraint billing_provider_price_catalog_events_type_check
    check (event_type in (
      'price_registered', 'price_registration_replayed',
      'price_deactivated', 'price_registration_rejected'
    )),
  constraint billing_provider_price_catalog_events_values_check
    check (
      unit_amount_cents >= 0
      and currency = 'usd'
      and recurring_interval in ('month', 'year')
      and tax_behavior = 'exclusive'
      and stripe_product_tax_code = 'txcd_10103001'
    ),
  constraint billing_provider_price_catalog_events_api_version_check
    check (
      verification_api_version = trim(verification_api_version)
      and length(verification_api_version) between 1 and 64
      and verification_api_version !~ '[[:cntrl:]]'
    ),
  constraint billing_provider_price_catalog_events_reason_check
    check (
      reason is null
      or (
        reason = trim(reason)
        and length(reason) between 1 and 256
        and reason !~ '[[:cntrl:]]'
      )
    )
);

comment on table public.billing_provider_price_catalog_events is
'Typed service-only history of trusted SaaS Price registration and local catalog deactivation. Raw Stripe objects and payloads are prohibited.';

create index billing_provider_price_catalog_events_price_created_idx
  on public.billing_provider_price_catalog_events (
    stripe_price_id, stripe_livemode, stripe_account_id, created_at desc
  );

alter table public.billing_provider_price_catalog_events enable row level security;
revoke all on table public.billing_provider_price_catalog_events
  from public, anon, authenticated, service_role;
grant select on table public.billing_provider_price_catalog_events to service_role;

-- Enforce one Product per plan/account/mode even for direct trusted table writes.
create function public.enforce_saas_catalog_product_consistency()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if new.is_active and new.verified_at is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        new.stripe_account_id || ':' || new.stripe_livemode::text || ':' || new.plan_key,
        0
      )
    );
    if exists (
      select 1
      from public.billing_provider_price_catalog as existing
      where existing.stripe_account_id = new.stripe_account_id
        and existing.stripe_livemode = new.stripe_livemode
        and existing.plan_key = new.plan_key
        and existing.is_active
        and existing.is_verified
        and existing.stripe_product_id <> new.stripe_product_id
        and not (
          existing.stripe_price_id = new.stripe_price_id
          and existing.stripe_account_id = new.stripe_account_id
          and existing.stripe_livemode = new.stripe_livemode
        )
    ) then
      raise exception using
        errcode = '23514',
        message = 'SAAS_CATALOG_PRODUCT_CONFLICT';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_saas_catalog_product_consistency()
  from public, anon, authenticated, service_role;

create trigger billing_provider_price_catalog_product_consistency
before insert or update on public.billing_provider_price_catalog
for each row execute function public.enforce_saas_catalog_product_consistency();

create function public.register_verified_saas_price(
  p_stripe_price_id text,
  p_stripe_product_id text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_plan_key text,
  p_billing_cadence text,
  p_unit_amount_cents bigint,
  p_currency text,
  p_recurring_interval text,
  p_recurring_interval_count integer,
  p_stripe_price_type text,
  p_billing_scheme text,
  p_recurring_usage_type text,
  p_tax_behavior text,
  p_stripe_product_tax_code text,
  p_stripe_price_active boolean,
  p_stripe_product_active boolean,
  p_stripe_price_created_at timestamptz,
  p_stripe_product_created_at timestamptz,
  p_verification_api_version text
)
returns table (registration_status text, registered_stripe_price_id text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_existing public.billing_provider_price_catalog%rowtype;
  v_expected_amount bigint;
  v_expected_interval text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_stripe_price_id is null or p_stripe_price_id !~ '^price_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_PRICE_ID_INVALID';
  end if;
  if p_stripe_product_id is null or p_stripe_product_id !~ '^prod_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_PRODUCT_ID_INVALID';
  end if;
  if p_stripe_account_id is null or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_ACCOUNT_ID_INVALID';
  end if;
  if p_plan_key not in ('small_flock', 'full_flock') then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_PLAN_INVALID';
  end if;
  if p_billing_cadence not in ('monthly', 'yearly') then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_CADENCE_INVALID';
  end if;

  select expected.amount, expected.interval_name
  into v_expected_amount, v_expected_interval
  from (values
    ('small_flock'::text, 'monthly'::text, 500::bigint, 'month'::text),
    ('small_flock', 'yearly', 5000, 'year'),
    ('full_flock', 'monthly', 2900, 'month'),
    ('full_flock', 'yearly', 27000, 'year')
  ) as expected(plan_key, cadence, amount, interval_name)
  where expected.plan_key = p_plan_key
    and expected.cadence = p_billing_cadence;

  if p_unit_amount_cents is distinct from v_expected_amount then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_AMOUNT_MISMATCH';
  end if;
  if p_currency is distinct from 'usd' then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_CURRENCY_MISMATCH';
  end if;
  if p_recurring_interval is distinct from v_expected_interval
    or p_recurring_interval_count is distinct from 1 then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_INTERVAL_MISMATCH';
  end if;
  if p_stripe_price_type is distinct from 'recurring'
    or p_billing_scheme is distinct from 'per_unit'
    or p_recurring_usage_type is distinct from 'licensed' then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_RECURRING_MODEL_MISMATCH';
  end if;
  if p_tax_behavior is distinct from 'exclusive'
    or p_stripe_product_tax_code is distinct from 'txcd_10103001' then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_TAX_MISMATCH';
  end if;
  if p_stripe_price_active is distinct from true
    or p_stripe_product_active is distinct from true then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_PROVIDER_OBJECT_INACTIVE';
  end if;
  if p_stripe_price_created_at is null
    or p_stripe_product_created_at is null
    or p_stripe_price_created_at < timestamptz '2000-01-01 00:00:00+00'
    or p_stripe_product_created_at < timestamptz '2000-01-01 00:00:00+00'
    or p_stripe_price_created_at > statement_timestamp() + interval '5 minutes'
    or p_stripe_product_created_at > statement_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_PROVIDER_TIMESTAMP_INVALID';
  end if;
  if p_verification_api_version is null
    or p_verification_api_version <> trim(p_verification_api_version)
    or length(p_verification_api_version) not between 1 and 64
    or p_verification_api_version ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_API_VERSION_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_stripe_account_id || ':' || p_stripe_livemode::text || ':' || p_plan_key,
      0
    )
  );

  select catalog.* into v_existing
  from public.billing_provider_price_catalog as catalog
  where catalog.stripe_price_id = p_stripe_price_id
    and catalog.stripe_livemode = p_stripe_livemode
    and catalog.stripe_account_id = p_stripe_account_id
  for update;

  if found then
    if v_existing.plan_key <> p_plan_key
      or v_existing.billing_cadence <> p_billing_cadence then
      raise exception using errcode = '23505', message = 'SAAS_CATALOG_PRICE_MAPPING_CONFLICT';
    end if;
    if v_existing.is_verified then
      if not v_existing.is_active then
        raise exception using errcode = '23505', message = 'SAAS_CATALOG_DEACTIVATED_PRICE_IMMUTABLE';
      end if;
      if v_existing.stripe_product_id is distinct from p_stripe_product_id
        or v_existing.unit_amount_cents is distinct from p_unit_amount_cents
        or v_existing.currency is distinct from p_currency
        or v_existing.recurring_interval is distinct from p_recurring_interval
        or v_existing.recurring_interval_count is distinct from p_recurring_interval_count
        or v_existing.tax_behavior is distinct from p_tax_behavior
        or v_existing.stripe_product_tax_code is distinct from p_stripe_product_tax_code
        or v_existing.stripe_price_type is distinct from p_stripe_price_type
        or v_existing.billing_scheme is distinct from p_billing_scheme
        or v_existing.recurring_usage_type is distinct from p_recurring_usage_type
        or v_existing.stripe_price_active is distinct from p_stripe_price_active
        or v_existing.stripe_product_active is distinct from p_stripe_product_active
        or v_existing.stripe_price_created_at is distinct from p_stripe_price_created_at
        or v_existing.stripe_product_created_at is distinct from p_stripe_product_created_at
        or v_existing.verification_api_version is distinct from p_verification_api_version then
        raise exception using errcode = '23505', message = 'SAAS_CATALOG_VERIFIED_REPLAY_CONFLICT';
      end if;

      insert into public.billing_provider_price_catalog_events (
        stripe_price_id, stripe_product_id, stripe_account_id, stripe_livemode,
        plan_key, billing_cadence, event_type, previous_active_state,
        new_active_state, unit_amount_cents, currency, recurring_interval,
        tax_behavior, stripe_product_tax_code, verification_api_version
      ) values (
        p_stripe_price_id, p_stripe_product_id, p_stripe_account_id,
        p_stripe_livemode, p_plan_key, p_billing_cadence,
        'price_registration_replayed', true, true, p_unit_amount_cents,
        p_currency, p_recurring_interval, p_tax_behavior,
        p_stripe_product_tax_code, p_verification_api_version
      );
      return query select 'already_registered'::text, p_stripe_price_id;
      return;
    end if;

    if not v_existing.is_active
      or (v_existing.stripe_product_id is not null and v_existing.stripe_product_id <> p_stripe_product_id)
      or (v_existing.unit_amount_cents is not null and v_existing.unit_amount_cents <> p_unit_amount_cents)
      or (v_existing.currency is not null and v_existing.currency <> p_currency)
      or (v_existing.recurring_interval is not null and v_existing.recurring_interval <> p_recurring_interval)
      or (v_existing.recurring_interval_count is not null and v_existing.recurring_interval_count <> p_recurring_interval_count) then
      raise exception using errcode = '23505', message = 'SAAS_CATALOG_LEGACY_ROW_CONFLICT';
    end if;

    update public.billing_provider_price_catalog
    set stripe_product_id = p_stripe_product_id,
        unit_amount_cents = p_unit_amount_cents,
        currency = p_currency,
        recurring_interval = p_recurring_interval,
        recurring_interval_count = p_recurring_interval_count,
        tax_behavior = p_tax_behavior,
        stripe_product_tax_code = p_stripe_product_tax_code,
        stripe_price_type = p_stripe_price_type,
        billing_scheme = p_billing_scheme,
        recurring_usage_type = p_recurring_usage_type,
        stripe_price_active = p_stripe_price_active,
        stripe_product_active = p_stripe_product_active,
        stripe_price_created_at = p_stripe_price_created_at,
        stripe_product_created_at = p_stripe_product_created_at,
        verified_at = statement_timestamp(),
        verification_api_version = p_verification_api_version
    where stripe_price_id = p_stripe_price_id
      and stripe_livemode = p_stripe_livemode
      and stripe_account_id = p_stripe_account_id;
  else
    insert into public.billing_provider_price_catalog (
      stripe_price_id, stripe_product_id, stripe_account_id, stripe_livemode,
      plan_key, billing_cadence, unit_amount_cents, currency,
      recurring_interval, recurring_interval_count, tax_behavior,
      stripe_product_tax_code, stripe_price_type, billing_scheme,
      recurring_usage_type, stripe_price_active, stripe_product_active,
      stripe_price_created_at, stripe_product_created_at, verified_at,
      verification_api_version, is_active
    ) values (
      p_stripe_price_id, p_stripe_product_id, p_stripe_account_id,
      p_stripe_livemode, p_plan_key, p_billing_cadence,
      p_unit_amount_cents, p_currency, p_recurring_interval,
      p_recurring_interval_count, p_tax_behavior, p_stripe_product_tax_code,
      p_stripe_price_type, p_billing_scheme, p_recurring_usage_type,
      p_stripe_price_active, p_stripe_product_active,
      p_stripe_price_created_at, p_stripe_product_created_at,
      statement_timestamp(), p_verification_api_version, true
    );
  end if;

  insert into public.billing_provider_price_catalog_events (
    stripe_price_id, stripe_product_id, stripe_account_id, stripe_livemode,
    plan_key, billing_cadence, event_type, previous_active_state,
    new_active_state, unit_amount_cents, currency, recurring_interval,
    tax_behavior, stripe_product_tax_code, verification_api_version
  ) values (
    p_stripe_price_id, p_stripe_product_id, p_stripe_account_id,
    p_stripe_livemode, p_plan_key, p_billing_cadence, 'price_registered',
    case when v_existing.stripe_price_id is null then null else v_existing.is_active end,
    true, p_unit_amount_cents, p_currency, p_recurring_interval,
    p_tax_behavior, p_stripe_product_tax_code, p_verification_api_version
  );

  return query select 'registered'::text, p_stripe_price_id;
end;
$function$;

create function public.deactivate_verified_saas_price(
  p_stripe_price_id text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_reason text
)
returns table (deactivation_status text, deactivated_stripe_price_id text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_catalog public.billing_provider_price_catalog%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_stripe_price_id is null or p_stripe_price_id !~ '^price_[A-Za-z0-9]+$'
    or p_stripe_account_id is null or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_DEACTIVATION_TARGET_INVALID';
  end if;
  if p_reason is null or p_reason <> trim(p_reason)
    or length(p_reason) not between 1 and 256
    or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'SAAS_CATALOG_DEACTIVATION_REASON_INVALID';
  end if;

  select catalog.* into v_catalog
  from public.billing_provider_price_catalog as catalog
  where catalog.stripe_price_id = p_stripe_price_id
    and catalog.stripe_account_id = p_stripe_account_id
    and catalog.stripe_livemode = p_stripe_livemode
  for update;

  if not found or not v_catalog.is_verified then
    raise exception using errcode = 'P0002', message = 'SAAS_CATALOG_VERIFIED_PRICE_NOT_FOUND';
  end if;
  if not v_catalog.is_active then
    return query select 'already_inactive'::text, p_stripe_price_id;
    return;
  end if;

  update public.billing_provider_price_catalog
  set is_active = false,
      deactivated_at = statement_timestamp(),
      deactivated_reason = p_reason
  where stripe_price_id = p_stripe_price_id
    and stripe_account_id = p_stripe_account_id
    and stripe_livemode = p_stripe_livemode;

  insert into public.billing_provider_price_catalog_events (
    stripe_price_id, stripe_product_id, stripe_account_id, stripe_livemode,
    plan_key, billing_cadence, event_type, previous_active_state,
    new_active_state, unit_amount_cents, currency, recurring_interval,
    tax_behavior, stripe_product_tax_code, verification_api_version, reason
  ) values (
    v_catalog.stripe_price_id, v_catalog.stripe_product_id,
    v_catalog.stripe_account_id, v_catalog.stripe_livemode,
    v_catalog.plan_key, v_catalog.billing_cadence, 'price_deactivated',
    true, false, v_catalog.unit_amount_cents, v_catalog.currency,
    v_catalog.recurring_interval, v_catalog.tax_behavior,
    v_catalog.stripe_product_tax_code, v_catalog.verification_api_version,
    p_reason
  );

  return query select 'deactivated'::text, p_stripe_price_id;
end;
$function$;

create function public.resolve_verified_saas_price(
  p_plan_key text,
  p_billing_cadence text,
  p_stripe_account_id text,
  p_stripe_livemode boolean
)
returns table (
  stripe_price_id text,
  stripe_product_id text,
  unit_amount_cents bigint,
  currency text,
  recurring_interval text,
  recurring_interval_count integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  select count(*)::integer into v_count
  from public.billing_provider_price_catalog as catalog
  where catalog.plan_key = p_plan_key
    and catalog.billing_cadence = p_billing_cadence
    and catalog.stripe_account_id = p_stripe_account_id
    and catalog.stripe_livemode = p_stripe_livemode
    and catalog.is_active
    and catalog.is_verified;
  if v_count <> 1 then
    raise exception using errcode = 'P0002', message = 'SAAS_CATALOG_TRUSTED_PRICE_UNAVAILABLE';
  end if;
  return query
  select catalog.stripe_price_id, catalog.stripe_product_id,
         catalog.unit_amount_cents, catalog.currency,
         catalog.recurring_interval, catalog.recurring_interval_count
  from public.billing_provider_price_catalog as catalog
  where catalog.plan_key = p_plan_key
    and catalog.billing_cadence = p_billing_cadence
    and catalog.stripe_account_id = p_stripe_account_id
    and catalog.stripe_livemode = p_stripe_livemode
    and catalog.is_active
    and catalog.is_verified;
end;
$function$;

revoke all on table public.billing_provider_price_catalog
  from public, anon, authenticated, service_role;
grant select on table public.billing_provider_price_catalog to service_role;

revoke all on function public.register_verified_saas_price(
  text, text, text, boolean, text, text, bigint, text, text, integer,
  text, text, text, text, text, boolean, boolean, timestamptz,
  timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.register_verified_saas_price(
  text, text, text, boolean, text, text, bigint, text, text, integer,
  text, text, text, text, text, boolean, boolean, timestamptz,
  timestamptz, text
) to service_role;

revoke all on function public.deactivate_verified_saas_price(
  text, text, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.deactivate_verified_saas_price(
  text, text, boolean, text
) to service_role;

revoke all on function public.resolve_verified_saas_price(
  text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_verified_saas_price(
  text, text, text, boolean
) to service_role;

comment on function public.register_verified_saas_price(
  text, text, text, boolean, text, text, bigint, text, text, integer,
  text, text, text, text, text, boolean, boolean, timestamptz,
  timestamptz, text
) is 'Service-only idempotent registration of independently verified FlockFront SaaS Stripe Price attributes.';

comment on function public.deactivate_verified_saas_price(text, text, boolean, text) is
'Service-only local catalog deactivation. It never modifies Stripe or historical billing evidence.';

comment on function public.resolve_verified_saas_price(text, text, text, boolean) is
'Service-only fail-closed resolution of one active fully verified SaaS Price for a trusted plan selection.';

commit;
