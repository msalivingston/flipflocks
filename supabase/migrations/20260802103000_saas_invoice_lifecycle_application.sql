-- Verified FlockFront SaaS invoice and Subscription lifecycle application.
--
-- This migration consumes only signature-verified, deferred provider events
-- under current database fencing leases. Only the payment-succeeded path may
-- extend paid-through access; Subscription scheduling remains non-payment
-- evidence.

begin;

alter table public.billing_subscription_enrollments
  add column provider_canceled_at timestamptz,
  add column last_subscription_event_id text,
  add column last_subscription_event_created_at timestamptz;

alter table public.billing_subscription_enrollments
  add constraint billing_subscription_enrollments_last_event_pair_check check (
    (last_subscription_event_id is null and last_subscription_event_created_at is null)
    or (
      length(trim(last_subscription_event_id)) > 0
      and last_subscription_event_created_at is not null
    )
  ),
  add constraint billing_subscription_enrollments_canceled_time_check check (
    provider_canceled_at is null or provider_canceled_at >= provider_created_at
  );

comment on column public.billing_subscription_enrollments.provider_canceled_at is
'Provider cancellation snapshot. It cannot shorten invoice-proven paid-through access.';
comment on column public.billing_subscription_enrollments.last_subscription_event_created_at is
'Object-specific ordering boundary for verified Subscription snapshots.';

-- Shared private implementation for the four fenced invoice-event overloads.
-- Browser roles and service_role cannot call this helper directly.
create function public.apply_verified_saas_invoice_lifecycle_internal(
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
  p_stripe_price_id text,
  p_stripe_product_id text,
  p_billing_reason text,
  p_collection_method text,
  p_invoice_status text,
  p_currency text,
  p_amount_due_cents bigint,
  p_amount_paid_cents bigint,
  p_amount_remaining_cents bigint,
  p_recurring_line_amount_cents bigint,
  p_service_period_start timestamptz,
  p_service_period_end timestamptz,
  p_observed_at timestamptz,
  p_next_payment_attempt_at timestamptz,
  p_failure_code text,
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
  v_now timestamptz := statement_timestamp();
  v_outcome text := btrim(p_outcome);
  v_event_type text;
  v_audit_type text;
  v_event_id text := btrim(p_provider_event_id);
  v_hash text := lower(btrim(p_payload_hash));
  v_account text := btrim(p_stripe_account_id);
  v_environment text := btrim(p_environment_id);
  v_invoice_id text := btrim(p_stripe_invoice_id);
  v_customer_id text := btrim(p_stripe_customer_id);
  v_subscription_id text := btrim(p_stripe_subscription_id);
  v_price_id text := btrim(p_stripe_price_id);
  v_product_id text := btrim(p_stripe_product_id);
  v_reason text := btrim(p_billing_reason);
  v_collection text := btrim(p_collection_method);
  v_status text := btrim(p_invoice_status);
  v_currency text := lower(btrim(p_currency));
  v_failure_code text := nullif(btrim(p_failure_code), '');
  v_event public.billing_provider_events%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_customer public.billing_customer_bindings%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_catalog public.billing_provider_price_catalog%rowtype;
  v_invoice public.billing_subscription_invoices%rowtype;
  v_grace_invoice public.billing_subscription_invoices%rowtype;
  v_trial public.billing_trial_claims%rowtype;
  v_attempt public.billing_checkout_attempts%rowtype;
  v_extends boolean := false;
  v_stale boolean := false;
  v_grace_eligible boolean := false;
  v_grace_anchor timestamptz;
  v_grace_end timestamptz;
  v_clears_recovery boolean := false;
  v_advanced boolean := false;
  v_onboarding_completed boolean := false;
  v_ignore_reason text;
  v_finalized text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'SAAS_INVOICE_SERVICE_ROLE_REQUIRED';
  end if;

  case v_outcome
    when 'payment_succeeded' then
      v_event_type := 'invoice.payment_succeeded';
      v_audit_type := 'invoice_payment_succeeded_recorded';
    when 'payment_failed' then
      v_event_type := 'invoice.payment_failed';
      v_audit_type := 'invoice_payment_failed';
    when 'payment_action_required' then
      v_event_type := 'invoice.payment_action_required';
      v_audit_type := 'invoice_payment_action_required';
    when 'finalization_failed' then
      v_event_type := 'invoice.finalization_failed';
      v_audit_type := 'invoice_finalization_failed';
    else
      raise exception using errcode = '22023',
        message = 'SAAS_INVOICE_OUTCOME_INVALID';
  end case;

  if coalesce(v_event_id, '') !~ '^evt_[A-Za-z0-9]+$'
     or coalesce(v_hash, '') !~ '^[0-9a-f]{64}$'
     or p_processing_lease_token is null
     or coalesce(v_account, '') !~ '^acct_[A-Za-z0-9]+$'
     or p_stripe_livemode is null
     or coalesce(v_environment, '') not in (
       'local', 'development', 'test', 'preview', 'staging', 'production'
     )
     or p_provider_event_created_at is null
     or coalesce(v_invoice_id, '') !~ '^in_[A-Za-z0-9]+$'
     or coalesce(v_customer_id, '') !~ '^cus_[A-Za-z0-9]+$'
     or coalesce(v_subscription_id, '') !~ '^sub_[A-Za-z0-9]+$'
     or coalesce(v_price_id, '') !~ '^price_[A-Za-z0-9]+$'
     or coalesce(v_product_id, '') !~ '^prod_[A-Za-z0-9]+$'
     or p_invoice_livemode is distinct from p_stripe_livemode
     or p_observed_at is null then
    raise exception using errcode = '22023',
      message = 'SAAS_INVOICE_EVIDENCE_INVALID';
  end if;

  if v_collection not in ('charge_automatically', 'send_invoice')
     or coalesce(v_reason, '') = ''
     or coalesce(v_status, '') = ''
     or v_currency !~ '^[a-z]{3}$'
     or p_amount_due_cents < 0
     or p_amount_paid_cents < 0
     or p_amount_remaining_cents < 0
     or p_recurring_line_amount_cents < 0
     or p_amount_paid_cents + p_amount_remaining_cents <> p_amount_due_cents
     or (p_service_period_start is null) <> (p_service_period_end is null)
     or (p_service_period_end is not null
       and p_service_period_end <= p_service_period_start) then
    raise exception using errcode = '22023',
      message = 'SAAS_INVOICE_SHAPE_INVALID';
  end if;

  if p_line_quantity <> 1
     or p_price_livemode is distinct from p_stripe_livemode
     or p_product_livemode is distinct from p_stripe_livemode
     or not coalesce(p_price_active, false)
     or not coalesce(p_product_active, false)
     or p_unit_amount_cents is null or p_unit_amount_cents < 0
     or lower(btrim(p_price_currency)) <> v_currency
     or p_recurring_interval not in ('month', 'year')
     or p_recurring_interval_count is null
     or p_recurring_interval_count < 1
     or p_price_type is distinct from 'recurring'
     or p_billing_scheme is distinct from 'per_unit'
     or p_recurring_usage_type is distinct from 'licensed'
     or p_tax_behavior is distinct from 'exclusive'
     or p_product_tax_code is distinct from 'txcd_10103001' then
    raise exception using errcode = '22023',
      message = 'SAAS_INVOICE_PROVIDER_SHAPE_INVALID';
  end if;

  if v_outcome = 'payment_succeeded' then
    if v_status <> 'paid' or p_amount_remaining_cents <> 0 then
      raise exception using errcode = '22023',
        message = 'SAAS_INVOICE_SUCCESS_INVALID';
    end if;
  elsif v_outcome = 'payment_failed' and v_status not in ('open', 'uncollectible') then
    raise exception using errcode = '22023',
      message = 'SAAS_INVOICE_FAILURE_STATUS_INVALID';
  elsif v_outcome = 'payment_action_required' and v_status <> 'open' then
    raise exception using errcode = '22023',
      message = 'SAAS_INVOICE_ACTION_STATUS_INVALID';
  elsif v_outcome = 'finalization_failed' and v_status not in ('draft', 'open') then
    raise exception using errcode = '22023',
      message = 'SAAS_INVOICE_FINALIZATION_STATUS_INVALID';
  end if;

  if v_failure_code is not null and (
       length(v_failure_code) > 100
       or v_failure_code !~ '^[a-z][a-z0-9_]{0,99}$'
       or (
         v_outcome = 'payment_failed' and v_failure_code <> 'payment_failed'
       )
       or (
         v_outcome = 'payment_action_required'
         and v_failure_code <> 'payment_action_required'
       )
       or (
         v_outcome = 'finalization_failed'
         and v_failure_code not in (
           'seller_billing_information_required',
           'payment_configuration_required',
           'provider_configuration_failure'
         )
       )
     ) then
    raise exception using errcode = '22023',
      message = 'SAAS_INVOICE_FAILURE_CODE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-provider-event:' || v_event_id, 0)
  );
  select event_row.* into v_event
  from public.billing_provider_events as event_row
  where event_row.provider_event_id = v_event_id
  order by event_row.created_at
  limit 1
  for update;

  if not found
     or v_event.payload_hash is distinct from v_hash
     or v_event.stripe_account_id is distinct from v_account
     or v_event.stripe_livemode is distinct from p_stripe_livemode
     or v_event.processing_environment_id is distinct from v_environment
     or v_event.provider_event_created_at is distinct from p_provider_event_created_at
     or v_event.event_type is distinct from v_event_type
     or v_event.provider_object_type is distinct from 'invoice'
     or v_event.provider_object_id is distinct from v_invoice_id
     or v_event.deferred_reason is distinct from 'awaiting_immutable_enrollment_binding' then
    raise exception using errcode = '55000',
      message = 'SAAS_INVOICE_EVENT_CLAIM_INVALID';
  end if;

  if v_event.processing_status = 'processed' then
    select invoice_row.* into v_invoice
    from public.billing_subscription_invoices as invoice_row
    where invoice_row.stripe_invoice_id = v_invoice_id
      and invoice_row.stripe_livemode = p_stripe_livemode
      and invoice_row.stripe_account_id = v_account;
    return query select 'already_processed'::text, v_event.store_id,
      v_invoice.id,
      (select status.paid_through_at from public.seller_billing_status as status
        where status.store_id = v_event.store_id),
      (select status.grace_ends_at from public.seller_billing_status as status
        where status.store_id = v_event.store_id),
      coalesce((select onboarding.billing_complete
        from public.seller_onboarding_state as onboarding
        where onboarding.store_id = v_event.store_id), false);
    return;
  end if;

  if v_event.processing_status <> 'processing'
     or v_event.processing_lease_token is distinct from p_processing_lease_token
     or v_event.processing_lease_expires_at <= v_now
     or v_event.applied then
    raise exception using errcode = '55000',
      message = 'SAAS_INVOICE_EVENT_FENCE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stripe-subscription:' || v_account || ':' ||
      p_stripe_livemode::text || ':' || v_subscription_id,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'saas-invoice:' || v_account || ':' ||
      p_stripe_livemode::text || ':' || v_invoice_id,
      0
    )
  );

  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.stripe_subscription_id = v_subscription_id
    and enrollment.stripe_livemode = p_stripe_livemode
    and enrollment.stripe_account_id = v_account
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'SAAS_INVOICE_ENROLLMENT_NOT_FOUND';
  end if;

  perform 1 from public.stores as store_row
  where store_row.id = v_enrollment.store_id for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'SAAS_INVOICE_STORE_NOT_FOUND';
  end if;

  select binding.* into v_customer
  from public.billing_customer_bindings as binding
  where binding.id = v_enrollment.customer_binding_id;
  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = v_enrollment.store_id
  for update;

  if v_customer.id is null
     or v_customer.store_id is distinct from v_enrollment.store_id
     or v_customer.stripe_customer_id is distinct from v_customer_id
     or v_customer.stripe_livemode is distinct from p_stripe_livemode
     or v_customer.stripe_account_id is distinct from v_account
     or v_billing.id is null
     or v_billing.current_subscription_enrollment_id is distinct from v_enrollment.id
     or v_billing.stripe_customer_id is distinct from v_customer_id
     or v_billing.stripe_subscription_id is distinct from v_subscription_id
     or v_billing.stripe_price_id is distinct from v_price_id
     or v_billing.stripe_livemode is distinct from p_stripe_livemode
     or v_billing.stripe_account_id is distinct from v_account
     or v_enrollment.initial_stripe_price_id is distinct from v_price_id then
    raise exception using errcode = '55000',
      message = 'SAAS_INVOICE_BINDING_CONFLICT';
  end if;

  select catalog.* into v_catalog
  from public.billing_provider_price_catalog as catalog
  where catalog.stripe_price_id = v_price_id
    and catalog.stripe_livemode = p_stripe_livemode
    and catalog.stripe_account_id = v_account;
  if v_catalog.stripe_price_id is null
     or not v_catalog.is_active
     or not v_catalog.is_verified
     or v_catalog.stripe_product_id is distinct from v_product_id
     or v_catalog.unit_amount_cents is distinct from p_unit_amount_cents
     or v_catalog.unit_amount_cents is distinct from p_recurring_line_amount_cents
     or v_catalog.currency is distinct from v_currency
     or v_catalog.recurring_interval is distinct from p_recurring_interval
     or v_catalog.recurring_interval_count is distinct from p_recurring_interval_count
     or p_price_currency is distinct from v_catalog.currency
     or v_catalog.plan_key not in ('small_flock', 'full_flock')
     or v_catalog.billing_cadence not in ('monthly', 'yearly')
     or v_billing.plan_key is distinct from v_catalog.plan_key
     or v_billing.billing_plan is distinct from v_catalog.billing_cadence then
    raise exception using errcode = '55000',
      message = 'SAAS_INVOICE_CATALOG_CONFLICT';
  end if;

  select invoice_row.* into v_invoice
  from public.billing_subscription_invoices as invoice_row
  where invoice_row.stripe_invoice_id = v_invoice_id
    and invoice_row.stripe_livemode = p_stripe_livemode
    and invoice_row.stripe_account_id = v_account
  for update;
  if v_invoice.id is not null and (
       v_invoice.store_id is distinct from v_enrollment.store_id
       or v_invoice.subscription_enrollment_id is distinct from v_enrollment.id
       or v_invoice.customer_binding_id is distinct from v_customer.id
       or v_invoice.stripe_customer_id is distinct from v_customer_id
       or v_invoice.stripe_subscription_id is distinct from v_subscription_id
       or v_invoice.stripe_price_id is distinct from v_price_id
       or v_invoice.billing_reason is distinct from v_reason
       or v_invoice.collection_method is distinct from v_collection
       or v_invoice.currency is distinct from v_currency
       or v_invoice.amount_due_cents is distinct from p_amount_due_cents
       or v_invoice.base_line_amount_cents is distinct from p_recurring_line_amount_cents
       or v_invoice.service_period_start is distinct from p_service_period_start
       or v_invoice.service_period_end is distinct from p_service_period_end
     ) then
    raise exception using errcode = '55000',
      message = 'SAAS_INVOICE_IDENTITY_CONFLICT';
  end if;

  v_extends := v_outcome = 'payment_succeeded'
    and v_collection = 'charge_automatically'
    and v_reason in ('subscription_create', 'subscription_cycle')
    and p_amount_due_cents > 0
    and p_amount_paid_cents > 0
    and p_amount_remaining_cents = 0
    and p_recurring_line_amount_cents > 0
    and p_service_period_start is not null
    and p_service_period_end is not null;

  if v_extends and p_service_period_end <> p_service_period_start +
      pg_catalog.make_interval(
        months => p_recurring_interval_count *
          case when p_recurring_interval = 'year' then 12 else 1 end
      ) then
    raise exception using errcode = '22023',
      message = 'SAAS_INVOICE_SERVICE_PERIOD_INVALID';
  end if;

  if v_outcome <> 'payment_succeeded' then
    v_stale := v_invoice.paid_at is not null
      or (
        v_invoice.last_provider_event_created_at is not null
        and (
          v_invoice.last_provider_event_created_at > p_provider_event_created_at
          or (
            v_invoice.last_provider_event_created_at = p_provider_event_created_at
            and v_invoice.last_provider_event_id > v_event_id
          )
        )
      )
      or (
        p_service_period_end is not null
        and v_billing.paid_through_at is not null
        and p_service_period_end <= v_billing.paid_through_at
      );
  elsif v_invoice.paid_at is not null then
    v_stale := true;
  end if;

  if v_stale then
    v_ignore_reason := case
      when v_invoice.paid_at is not null then 'successful_invoice_precedence'
      else 'stale_invoice_event'
    end;
  elsif v_outcome = 'payment_succeeded' and not v_extends then
    v_ignore_reason := case
      when p_amount_due_cents = 0 and p_amount_paid_cents = 0
        then 'zero_dollar_invoice'
      when v_collection <> 'charge_automatically' then 'manual_collection'
      else 'unsupported_billing_reason_or_collection'
    end;
  end if;

  select claim.* into v_trial
  from public.billing_trial_claims as claim
  where claim.store_id = v_enrollment.store_id
    and claim.subscription_enrollment_id = v_enrollment.id;

  if not v_stale
     and v_outcome <> 'payment_succeeded'
     and v_collection = 'charge_automatically'
     and p_amount_due_cents > 0
     and p_service_period_start is not null
     and p_service_period_end is not null
     and v_enrollment.is_current
     and v_enrollment.provider_status <> 'canceled' then
    if v_trial.store_id is not null
       and v_billing.paid_through_at is null
       and v_reason in ('subscription_create', 'subscription_cycle')
       and v_trial.trial_started_at = v_enrollment.trial_started_at
       and v_trial.trial_ends_at = v_enrollment.trial_ends_at
       and p_service_period_start = v_enrollment.trial_ends_at then
      v_grace_anchor := v_enrollment.trial_ends_at;
      v_grace_eligible := true;
    elsif v_reason = 'subscription_cycle'
       and v_billing.paid_through_at is not null
       and p_service_period_start = v_billing.paid_through_at then
      v_grace_anchor := v_billing.paid_through_at;
      v_grace_eligible := true;
    end if;
  end if;

  if v_grace_eligible then
    if p_service_period_end <> p_service_period_start +
        pg_catalog.make_interval(
          months => p_recurring_interval_count *
            case when p_recurring_interval = 'year' then 12 else 1 end
        ) then
      raise exception using errcode = '22023',
        message = 'SAAS_INVOICE_SERVICE_PERIOD_INVALID';
    end if;
    v_grace_end := v_grace_anchor + interval '3 days';
  end if;

  update public.billing_provider_events as events
  set store_id = v_enrollment.store_id
  where events.provider_event_id = v_event_id
    and events.stripe_account_id = v_account
    and events.stripe_livemode = p_stripe_livemode;

  if v_invoice.id is null then
    insert into public.billing_subscription_invoices (
      store_id, subscription_enrollment_id, customer_binding_id,
      stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
      stripe_price_id, stripe_livemode, stripe_account_id, billing_reason,
      collection_method, invoice_status, currency, amount_due_cents,
      amount_paid_cents, amount_remaining_cents, base_line_amount_cents,
      service_period_start, service_period_end, paid_at, failure_at,
      action_required_at, finalization_failed_at, next_payment_attempt_at,
      paid_through_applied_at, grace_eligible, grace_anchor_at, grace_ends_at,
      failure_code, last_provider_event_id, last_provider_event_created_at
    ) values (
      v_enrollment.store_id, v_enrollment.id, v_customer.id,
      v_customer_id, v_subscription_id, v_invoice_id, v_price_id,
      p_stripe_livemode, v_account, v_reason, v_collection, v_status,
      v_currency, p_amount_due_cents, p_amount_paid_cents,
      p_amount_remaining_cents, p_recurring_line_amount_cents,
      p_service_period_start, p_service_period_end,
      case when v_outcome = 'payment_succeeded' then p_observed_at end,
      case when v_outcome = 'payment_failed' then p_observed_at end,
      case when v_outcome = 'payment_action_required' then p_observed_at end,
      case when v_outcome = 'finalization_failed' then p_observed_at end,
      p_next_payment_attempt_at,
      case when v_extends and (
        v_billing.paid_through_at is null
        or p_service_period_end > v_billing.paid_through_at
      ) then v_now end,
      v_grace_eligible, v_grace_anchor, v_grace_end, v_failure_code,
      v_event_id, p_provider_event_created_at
    ) returning * into v_invoice;
  elsif not v_stale then
    update public.billing_subscription_invoices as invoice_row
    set invoice_status = v_status,
        amount_paid_cents = case when v_outcome = 'payment_succeeded'
          then greatest(invoice_row.amount_paid_cents, p_amount_paid_cents)
          else p_amount_paid_cents end,
        amount_remaining_cents = p_amount_remaining_cents,
        paid_at = case when v_outcome = 'payment_succeeded'
          then coalesce(invoice_row.paid_at, p_observed_at)
          else invoice_row.paid_at end,
        failure_at = case when v_outcome = 'payment_failed'
          then coalesce(invoice_row.failure_at, p_observed_at)
          else invoice_row.failure_at end,
        action_required_at = case when v_outcome = 'payment_action_required'
          then coalesce(invoice_row.action_required_at, p_observed_at)
          else invoice_row.action_required_at end,
        finalization_failed_at = case when v_outcome = 'finalization_failed'
          then coalesce(invoice_row.finalization_failed_at, p_observed_at)
          else invoice_row.finalization_failed_at end,
        next_payment_attempt_at = p_next_payment_attempt_at,
        paid_through_applied_at = case when v_extends and (
          v_billing.paid_through_at is null
          or p_service_period_end > v_billing.paid_through_at
        ) then coalesce(invoice_row.paid_through_applied_at, v_now)
          else invoice_row.paid_through_applied_at end,
        grace_eligible = case when v_outcome = 'payment_succeeded'
          then false else v_grace_eligible end,
        grace_anchor_at = case when v_outcome = 'payment_succeeded'
          then null else v_grace_anchor end,
        grace_ends_at = case when v_outcome = 'payment_succeeded'
          then null else v_grace_end end,
        failure_code = case when v_outcome = 'payment_succeeded'
          then null else v_failure_code end,
        last_provider_event_id = v_event_id,
        last_provider_event_created_at = p_provider_event_created_at
    where invoice_row.id = v_invoice.id
    returning * into v_invoice;
  end if;

  if v_extends and not v_stale then
    v_advanced := v_billing.paid_through_at is null
      or p_service_period_end > v_billing.paid_through_at;

    if v_billing.grace_stripe_invoice_id is not null then
      select invoice_row.* into v_grace_invoice
      from public.billing_subscription_invoices as invoice_row
      where invoice_row.stripe_invoice_id = v_billing.grace_stripe_invoice_id
        and invoice_row.stripe_livemode = p_stripe_livemode
        and invoice_row.stripe_account_id = v_account;
    end if;
    v_clears_recovery := v_billing.payment_failure_started_at is not null
      or v_billing.payment_action_required_at is not null
      or v_billing.grace_ends_at is not null;

    update public.seller_billing_status as status
    set paid_through_at = greatest(status.paid_through_at, p_service_period_end),
        last_paid_stripe_invoice_id = case when status.paid_through_at is null
          or p_service_period_end > status.paid_through_at
          then v_invoice_id else status.last_paid_stripe_invoice_id end,
        effective_price_started_at = coalesce(
          status.effective_price_started_at, p_service_period_start
        ),
        payment_failure_started_at = case
          when status.grace_stripe_invoice_id = v_invoice_id
            or v_grace_invoice.grace_anchor_at is null
            or v_grace_invoice.grace_anchor_at <= p_service_period_end
          then null else status.payment_failure_started_at end,
        payment_action_required_at = case
          when status.grace_stripe_invoice_id = v_invoice_id
            or v_grace_invoice.grace_anchor_at is null
            or v_grace_invoice.grace_anchor_at <= p_service_period_end
          then null else status.payment_action_required_at end,
        grace_ends_at = case
          when status.grace_stripe_invoice_id = v_invoice_id
            or v_grace_invoice.grace_anchor_at is null
            or v_grace_invoice.grace_anchor_at <= p_service_period_end
          then null else status.grace_ends_at end,
        grace_stripe_invoice_id = case
          when status.grace_stripe_invoice_id = v_invoice_id
            or v_grace_invoice.grace_anchor_at is null
            or v_grace_invoice.grace_anchor_at <= p_service_period_end
          then null else status.grace_stripe_invoice_id end,
        grace_provider_event_id = case
          when status.grace_stripe_invoice_id = v_invoice_id
            or v_grace_invoice.grace_anchor_at is null
            or v_grace_invoice.grace_anchor_at <= p_service_period_end
          then null else status.grace_provider_event_id end,
        grace_provider_event_created_at = case
          when status.grace_stripe_invoice_id = v_invoice_id
            or v_grace_invoice.grace_anchor_at is null
            or v_grace_invoice.grace_anchor_at <= p_service_period_end
          then null else status.grace_provider_event_created_at end,
        latest_stripe_invoice_id = case
          when status.latest_invoice_event_created_at is null
            or (p_provider_event_created_at, v_event_id) >=
              (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
          then v_invoice_id else status.latest_stripe_invoice_id end,
        latest_invoice_status = case
          when status.latest_invoice_event_created_at is null
            or (p_provider_event_created_at, v_event_id) >=
              (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
          then 'paid' else status.latest_invoice_status end,
        latest_invoice_event_id = case
          when status.latest_invoice_event_created_at is null
            or (p_provider_event_created_at, v_event_id) >=
              (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
          then v_event_id else status.latest_invoice_event_id end,
        latest_invoice_event_created_at = case
          when status.latest_invoice_event_created_at is null
            or (p_provider_event_created_at, v_event_id) >=
              (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
          then p_provider_event_created_at else status.latest_invoice_event_created_at end,
        storefront_access_until = greatest(
          status.storefront_access_until, p_service_period_end
        ),
        updated_at = v_now
    where status.store_id = v_enrollment.store_id
    returning * into v_billing;

    if v_enrollment.checkout_attempt_id is not null
       and v_trial.store_id is null then
      select attempt.* into v_attempt
      from public.billing_checkout_attempts as attempt
      where attempt.id = v_enrollment.checkout_attempt_id;
      if v_attempt.trial_eligibility = 'trial_already_used' then
        update public.seller_onboarding_state as onboarding
        set billing_complete = true,
            updated_at = v_now
        where onboarding.store_id = v_enrollment.store_id
          and not onboarding.billing_complete;
        v_onboarding_completed := found;
      end if;
    end if;
  elsif not v_stale and v_outcome <> 'payment_succeeded' then
    update public.seller_billing_status as status
    set payment_failure_started_at = case when v_outcome = 'payment_failed'
          then p_observed_at else status.payment_failure_started_at end,
        payment_action_required_at = case
          when v_outcome = 'payment_action_required'
          then p_observed_at else status.payment_action_required_at end,
        grace_ends_at = case when v_grace_eligible
          then v_grace_end else status.grace_ends_at end,
        grace_stripe_invoice_id = case when v_grace_eligible
          then v_invoice_id else status.grace_stripe_invoice_id end,
        grace_provider_event_id = case when v_grace_eligible
          then v_event_id else status.grace_provider_event_id end,
        grace_provider_event_created_at = case when v_grace_eligible
          then p_provider_event_created_at else status.grace_provider_event_created_at end,
        latest_stripe_invoice_id = case
          when status.latest_invoice_event_created_at is null
            or (p_provider_event_created_at, v_event_id) >=
              (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
          then v_invoice_id else status.latest_stripe_invoice_id end,
        latest_invoice_status = case
          when status.latest_invoice_event_created_at is null
            or (p_provider_event_created_at, v_event_id) >=
              (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
          then v_status else status.latest_invoice_status end,
        latest_invoice_event_id = case
          when status.latest_invoice_event_created_at is null
            or (p_provider_event_created_at, v_event_id) >=
              (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
          then v_event_id else status.latest_invoice_event_id end,
        latest_invoice_event_created_at = case
          when status.latest_invoice_event_created_at is null
            or (p_provider_event_created_at, v_event_id) >=
              (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
          then p_provider_event_created_at else status.latest_invoice_event_created_at end,
        storefront_access_until = case when v_grace_eligible
          then greatest(status.storefront_access_until, v_grace_end)
          else status.storefront_access_until end,
        updated_at = v_now
    where status.store_id = v_enrollment.store_id
    returning * into v_billing;
  end if;

  insert into public.billing_entitlement_events (
    store_id, event_type, plan_key, billing_cadence, access_until,
    provider_event_id, metadata
  ) values (
    v_enrollment.store_id, v_audit_type, v_catalog.plan_key,
    v_catalog.billing_cadence,
    case when v_grace_eligible then v_grace_end else v_billing.paid_through_at end,
    v_event_id,
    pg_catalog.jsonb_build_object(
      'invoice_id', v_invoice_id,
      'billing_reason', v_reason,
      'paid_through_authority', v_extends and not v_stale,
      'grace_eligible', v_grace_eligible,
      'stale', v_stale
    )
  );

  if v_advanced then
    insert into public.billing_entitlement_events (
      store_id, event_type, plan_key, billing_cadence, access_until,
      provider_event_id, metadata
    ) values (
      v_enrollment.store_id, 'paid_through_extended', v_catalog.plan_key,
      v_catalog.billing_cadence, v_billing.paid_through_at, v_event_id,
      pg_catalog.jsonb_build_object('invoice_id', v_invoice_id)
    );
  end if;
  if v_grace_eligible then
    insert into public.billing_entitlement_events (
      store_id, event_type, plan_key, billing_cadence, access_until,
      provider_event_id, metadata
    ) values (
      v_enrollment.store_id, 'grace_scheduled', v_catalog.plan_key,
      v_catalog.billing_cadence, v_grace_end, v_event_id,
      pg_catalog.jsonb_build_object(
        'invoice_id', v_invoice_id, 'anchor', v_grace_anchor
      )
    );
  end if;
  if v_clears_recovery and v_extends and not v_stale
     and v_billing.grace_ends_at is null then
    insert into public.billing_entitlement_events (
      store_id, event_type, plan_key, billing_cadence, access_until,
      provider_event_id, metadata
    ) values (
      v_enrollment.store_id, 'payment_recovered', v_catalog.plan_key,
      v_catalog.billing_cadence, v_billing.paid_through_at, v_event_id,
      pg_catalog.jsonb_build_object('invoice_id', v_invoice_id)
    );
  end if;
  if v_onboarding_completed then
    insert into public.billing_entitlement_events (
      store_id, event_type, plan_key, billing_cadence, access_until,
      provider_event_id, metadata
    ) values (
      v_enrollment.store_id, 'onboarding_billing_completed',
      v_catalog.plan_key, v_catalog.billing_cadence,
      v_billing.paid_through_at, v_event_id,
      pg_catalog.jsonb_build_object(
        'invoice_id', v_invoice_id,
        'subscription_enrollment_id', v_enrollment.id
      )
    );
  end if;
  if v_stale or v_ignore_reason is not null then
    insert into public.billing_entitlement_events (
      store_id, event_type, provider_event_id, metadata
    ) values (
      v_enrollment.store_id, 'invoice_event_ignored', v_event_id,
      pg_catalog.jsonb_build_object(
        'invoice_id', v_invoice_id,
        'reason', coalesce(v_ignore_reason, 'stale_invoice_event')
      )
    );
  end if;

  update public.billing_provider_events as events
  set applied = not v_stale,
      ignored_reason = case when v_stale then v_ignore_reason else null end
  where events.provider_event_id = v_event_id
    and events.stripe_account_id = v_account
    and events.stripe_livemode = p_stripe_livemode;

  select public.mark_saas_billing_provider_event_processed(
    v_event_id, v_hash, v_account, p_stripe_livemode,
    p_processing_lease_token
  ) into v_finalized;
  if v_finalized is distinct from 'processed' then
    raise exception using errcode = '55000',
      message = 'SAAS_INVOICE_EVENT_FINALIZATION_FAILED';
  end if;

  return query select
    case
      when v_stale then 'stale_recorded'::text
      when v_extends and v_advanced then 'paid_through_extended'::text
      when v_extends then 'payment_recorded'::text
      when v_grace_eligible then 'grace_scheduled'::text
      when v_outcome = 'payment_succeeded' then 'non_authoritative_payment_recorded'::text
      else 'nonpayment_recorded'::text
    end,
    v_enrollment.store_id, v_invoice.id, v_billing.paid_through_at,
    v_billing.grace_ends_at,
    coalesce((select onboarding.billing_complete
      from public.seller_onboarding_state as onboarding
      where onboarding.store_id = v_enrollment.store_id), false);
end;
$function$;

revoke all on function public.apply_verified_saas_invoice_lifecycle_internal(
  text, text, text, uuid, text, boolean, text, timestamptz,
  text, boolean, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, bigint, timestamptz, timestamptz, timestamptz,
  timestamptz, text, integer, boolean, boolean, boolean, boolean,
  bigint, text, text, integer, text, text, text, text, text
) from public, anon, authenticated, service_role;

-- Fenced overload used only by the signature-verified webhook workflow.
create function public.apply_verified_saas_invoice_payment_succeeded(
  p_provider_event_id text, p_payload_hash text, p_processing_lease_token uuid,
  p_stripe_account_id text, p_stripe_livemode boolean, p_environment_id text,
  p_provider_event_created_at timestamptz, p_stripe_invoice_id text,
  p_invoice_livemode boolean, p_stripe_customer_id text,
  p_stripe_subscription_id text, p_stripe_price_id text,
  p_stripe_product_id text, p_billing_reason text, p_collection_method text,
  p_invoice_status text, p_currency text, p_amount_due_cents bigint,
  p_amount_paid_cents bigint, p_amount_remaining_cents bigint,
  p_recurring_line_amount_cents bigint, p_service_period_start timestamptz,
  p_service_period_end timestamptz, p_paid_at timestamptz,
  p_next_payment_attempt_at timestamptz, p_failure_code text,
  p_line_quantity integer, p_price_livemode boolean,
  p_product_livemode boolean, p_price_active boolean,
  p_product_active boolean, p_unit_amount_cents bigint,
  p_price_currency text, p_recurring_interval text,
  p_recurring_interval_count integer, p_price_type text,
  p_billing_scheme text, p_recurring_usage_type text,
  p_tax_behavior text, p_product_tax_code text
)
returns table (
  application_state text, store_id uuid, invoice_id uuid,
  paid_through_at timestamptz, grace_ends_at timestamptz,
  billing_complete boolean
)
language sql security definer set search_path = pg_catalog, public
as $function$
  select * from public.apply_verified_saas_invoice_lifecycle_internal(
    'payment_succeeded', p_provider_event_id, p_payload_hash,
    p_processing_lease_token, p_stripe_account_id, p_stripe_livemode,
    p_environment_id, p_provider_event_created_at, p_stripe_invoice_id,
    p_invoice_livemode, p_stripe_customer_id, p_stripe_subscription_id,
    p_stripe_price_id, p_stripe_product_id, p_billing_reason,
    p_collection_method, p_invoice_status, p_currency, p_amount_due_cents,
    p_amount_paid_cents, p_amount_remaining_cents,
    p_recurring_line_amount_cents, p_service_period_start,
    p_service_period_end, p_paid_at, p_next_payment_attempt_at,
    p_failure_code, p_line_quantity, p_price_livemode,
    p_product_livemode, p_price_active, p_product_active,
    p_unit_amount_cents, p_price_currency, p_recurring_interval,
    p_recurring_interval_count, p_price_type, p_billing_scheme,
    p_recurring_usage_type, p_tax_behavior, p_product_tax_code
  );
$function$;

create function public.apply_verified_saas_invoice_payment_failed(
  p_provider_event_id text, p_payload_hash text, p_processing_lease_token uuid,
  p_stripe_account_id text, p_stripe_livemode boolean, p_environment_id text,
  p_provider_event_created_at timestamptz, p_stripe_invoice_id text,
  p_invoice_livemode boolean, p_stripe_customer_id text,
  p_stripe_subscription_id text, p_stripe_price_id text,
  p_stripe_product_id text, p_billing_reason text, p_collection_method text,
  p_invoice_status text, p_currency text, p_amount_due_cents bigint,
  p_amount_paid_cents bigint, p_amount_remaining_cents bigint,
  p_recurring_line_amount_cents bigint, p_service_period_start timestamptz,
  p_service_period_end timestamptz, p_failure_at timestamptz,
  p_next_payment_attempt_at timestamptz, p_failure_code text,
  p_line_quantity integer, p_price_livemode boolean,
  p_product_livemode boolean, p_price_active boolean,
  p_product_active boolean, p_unit_amount_cents bigint,
  p_price_currency text, p_recurring_interval text,
  p_recurring_interval_count integer, p_price_type text,
  p_billing_scheme text, p_recurring_usage_type text,
  p_tax_behavior text, p_product_tax_code text
)
returns table (
  application_state text, store_id uuid, invoice_id uuid,
  paid_through_at timestamptz, grace_ends_at timestamptz,
  billing_complete boolean
)
language sql security definer set search_path = pg_catalog, public
as $function$
  select * from public.apply_verified_saas_invoice_lifecycle_internal(
    'payment_failed', p_provider_event_id, p_payload_hash,
    p_processing_lease_token, p_stripe_account_id, p_stripe_livemode,
    p_environment_id, p_provider_event_created_at, p_stripe_invoice_id,
    p_invoice_livemode, p_stripe_customer_id, p_stripe_subscription_id,
    p_stripe_price_id, p_stripe_product_id, p_billing_reason,
    p_collection_method, p_invoice_status, p_currency, p_amount_due_cents,
    p_amount_paid_cents, p_amount_remaining_cents,
    p_recurring_line_amount_cents, p_service_period_start,
    p_service_period_end, p_failure_at, p_next_payment_attempt_at,
    p_failure_code, p_line_quantity, p_price_livemode,
    p_product_livemode, p_price_active, p_product_active,
    p_unit_amount_cents, p_price_currency, p_recurring_interval,
    p_recurring_interval_count, p_price_type, p_billing_scheme,
    p_recurring_usage_type, p_tax_behavior, p_product_tax_code
  );
$function$;

create function public.apply_verified_saas_invoice_payment_action_required(
  p_provider_event_id text, p_payload_hash text, p_processing_lease_token uuid,
  p_stripe_account_id text, p_stripe_livemode boolean, p_environment_id text,
  p_provider_event_created_at timestamptz, p_stripe_invoice_id text,
  p_invoice_livemode boolean, p_stripe_customer_id text,
  p_stripe_subscription_id text, p_stripe_price_id text,
  p_stripe_product_id text, p_billing_reason text, p_collection_method text,
  p_invoice_status text, p_currency text, p_amount_due_cents bigint,
  p_amount_paid_cents bigint, p_amount_remaining_cents bigint,
  p_recurring_line_amount_cents bigint, p_service_period_start timestamptz,
  p_service_period_end timestamptz, p_action_required_at timestamptz,
  p_next_payment_attempt_at timestamptz, p_failure_code text,
  p_line_quantity integer, p_price_livemode boolean,
  p_product_livemode boolean, p_price_active boolean,
  p_product_active boolean, p_unit_amount_cents bigint,
  p_price_currency text, p_recurring_interval text,
  p_recurring_interval_count integer, p_price_type text,
  p_billing_scheme text, p_recurring_usage_type text,
  p_tax_behavior text, p_product_tax_code text
)
returns table (
  application_state text, store_id uuid, invoice_id uuid,
  paid_through_at timestamptz, grace_ends_at timestamptz,
  billing_complete boolean
)
language sql security definer set search_path = pg_catalog, public
as $function$
  select * from public.apply_verified_saas_invoice_lifecycle_internal(
    'payment_action_required', p_provider_event_id, p_payload_hash,
    p_processing_lease_token, p_stripe_account_id, p_stripe_livemode,
    p_environment_id, p_provider_event_created_at, p_stripe_invoice_id,
    p_invoice_livemode, p_stripe_customer_id, p_stripe_subscription_id,
    p_stripe_price_id, p_stripe_product_id, p_billing_reason,
    p_collection_method, p_invoice_status, p_currency, p_amount_due_cents,
    p_amount_paid_cents, p_amount_remaining_cents,
    p_recurring_line_amount_cents, p_service_period_start,
    p_service_period_end, p_action_required_at, p_next_payment_attempt_at,
    p_failure_code, p_line_quantity, p_price_livemode,
    p_product_livemode, p_price_active, p_product_active,
    p_unit_amount_cents, p_price_currency, p_recurring_interval,
    p_recurring_interval_count, p_price_type, p_billing_scheme,
    p_recurring_usage_type, p_tax_behavior, p_product_tax_code
  );
$function$;

create function public.apply_verified_saas_invoice_finalization_failed(
  p_provider_event_id text, p_payload_hash text, p_processing_lease_token uuid,
  p_stripe_account_id text, p_stripe_livemode boolean, p_environment_id text,
  p_provider_event_created_at timestamptz, p_stripe_invoice_id text,
  p_invoice_livemode boolean, p_stripe_customer_id text,
  p_stripe_subscription_id text, p_stripe_price_id text,
  p_stripe_product_id text, p_billing_reason text, p_collection_method text,
  p_invoice_status text, p_currency text, p_amount_due_cents bigint,
  p_amount_paid_cents bigint, p_amount_remaining_cents bigint,
  p_recurring_line_amount_cents bigint, p_service_period_start timestamptz,
  p_service_period_end timestamptz, p_finalization_failed_at timestamptz,
  p_next_payment_attempt_at timestamptz, p_failure_code text,
  p_line_quantity integer, p_price_livemode boolean,
  p_product_livemode boolean, p_price_active boolean,
  p_product_active boolean, p_unit_amount_cents bigint,
  p_price_currency text, p_recurring_interval text,
  p_recurring_interval_count integer, p_price_type text,
  p_billing_scheme text, p_recurring_usage_type text,
  p_tax_behavior text, p_product_tax_code text
)
returns table (
  application_state text, store_id uuid, invoice_id uuid,
  paid_through_at timestamptz, grace_ends_at timestamptz,
  billing_complete boolean
)
language sql security definer set search_path = pg_catalog, public
as $function$
  select * from public.apply_verified_saas_invoice_lifecycle_internal(
    'finalization_failed', p_provider_event_id, p_payload_hash,
    p_processing_lease_token, p_stripe_account_id, p_stripe_livemode,
    p_environment_id, p_provider_event_created_at, p_stripe_invoice_id,
    p_invoice_livemode, p_stripe_customer_id, p_stripe_subscription_id,
    p_stripe_price_id, p_stripe_product_id, p_billing_reason,
    p_collection_method, p_invoice_status, p_currency, p_amount_due_cents,
    p_amount_paid_cents, p_amount_remaining_cents,
    p_recurring_line_amount_cents, p_service_period_start,
    p_service_period_end, p_finalization_failed_at,
    p_next_payment_attempt_at, p_failure_code, p_line_quantity,
    p_price_livemode, p_product_livemode, p_price_active,
    p_product_active, p_unit_amount_cents, p_price_currency,
    p_recurring_interval, p_recurring_interval_count, p_price_type,
    p_billing_scheme, p_recurring_usage_type, p_tax_behavior,
    p_product_tax_code
  );
$function$;

-- Fenced Subscription snapshot overload. It derives the store from immutable
-- enrollment authority and never writes paid-through or grace fields.
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
  v_now timestamptz := statement_timestamp();
  v_event_id text := btrim(p_provider_event_id);
  v_hash text := lower(btrim(p_payload_hash));
  v_account text := btrim(p_stripe_account_id);
  v_environment text := btrim(p_environment_id);
  v_event_type text := btrim(p_event_type);
  v_subscription_id text := btrim(p_stripe_subscription_id);
  v_customer_id text := btrim(p_stripe_customer_id);
  v_price_id text := btrim(p_stripe_price_id);
  v_product_id text := btrim(p_stripe_product_id);
  v_event public.billing_provider_events%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_customer public.billing_customer_bindings%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_catalog public.billing_provider_price_catalog%rowtype;
  v_stale boolean := false;
  v_finalized text;
  v_terminal_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'SAAS_SUBSCRIPTION_SERVICE_ROLE_REQUIRED';
  end if;
  if coalesce(v_event_id, '') !~ '^evt_[A-Za-z0-9]+$'
     or coalesce(v_hash, '') !~ '^[0-9a-f]{64}$'
     or p_processing_lease_token is null
     or coalesce(v_account, '') !~ '^acct_[A-Za-z0-9]+$'
     or p_stripe_livemode is null
     or p_subscription_livemode is distinct from p_stripe_livemode
     or coalesce(v_environment, '') not in (
       'local', 'development', 'test', 'preview', 'staging', 'production'
     )
     or p_provider_event_created_at is null
     or v_event_type not in (
       'customer.subscription.created', 'customer.subscription.updated',
       'customer.subscription.deleted'
     )
     or coalesce(v_subscription_id, '') !~ '^sub_[A-Za-z0-9]+$'
     or coalesce(v_customer_id, '') !~ '^cus_[A-Za-z0-9]+$'
     or coalesce(v_price_id, '') !~ '^price_[A-Za-z0-9]+$'
     or coalesce(v_product_id, '') !~ '^prod_[A-Za-z0-9]+$'
     or p_subscription_created_at is null
     or p_subscription_status not in (
       'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled',
       'incomplete', 'incomplete_expired'
     )
     or p_cancel_at_period_end is null
     or p_line_quantity <> 1 then
    raise exception using errcode = '22023',
      message = 'SAAS_SUBSCRIPTION_EVIDENCE_INVALID';
  end if;
  if (p_current_period_start is null) <> (p_current_period_end is null)
     or (p_current_period_end is not null
       and p_current_period_end <= p_current_period_start)
     or p_price_livemode is distinct from p_stripe_livemode
     or p_product_livemode is distinct from p_stripe_livemode
     or p_unit_amount_cents is null or p_unit_amount_cents < 0
     or lower(btrim(p_currency)) !~ '^[a-z]{3}$'
     or p_recurring_interval not in ('month', 'year')
     or p_recurring_interval_count is null or p_recurring_interval_count < 1
     or p_price_type is distinct from 'recurring'
     or p_billing_scheme is distinct from 'per_unit'
     or p_recurring_usage_type is distinct from 'licensed'
     or p_tax_behavior is distinct from 'exclusive'
     or p_product_tax_code is distinct from 'txcd_10103001' then
    raise exception using errcode = '22023',
      message = 'SAAS_SUBSCRIPTION_PROVIDER_SHAPE_INVALID';
  end if;
  if v_event_type = 'customer.subscription.deleted' and (
       p_subscription_status <> 'canceled'
       or coalesce(p_subscription_ended_at, p_subscription_canceled_at) is null
     ) then
    raise exception using errcode = '22023',
      message = 'SAAS_SUBSCRIPTION_TERMINAL_STATE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-provider-event:' || v_event_id, 0)
  );
  select event_row.* into v_event
  from public.billing_provider_events as event_row
  where event_row.provider_event_id = v_event_id
  order by event_row.created_at
  limit 1
  for update;
  if not found
     or v_event.payload_hash is distinct from v_hash
     or v_event.stripe_account_id is distinct from v_account
     or v_event.stripe_livemode is distinct from p_stripe_livemode
     or v_event.processing_environment_id is distinct from v_environment
     or v_event.provider_event_created_at is distinct from p_provider_event_created_at
     or v_event.event_type is distinct from v_event_type
     or v_event.provider_object_type is distinct from 'subscription'
     or v_event.provider_object_id is distinct from v_subscription_id
     or v_event.deferred_reason is distinct from 'awaiting_verified_enrollment_batch' then
    raise exception using errcode = '55000',
      message = 'SAAS_SUBSCRIPTION_EVENT_CLAIM_INVALID';
  end if;
  if v_event.processing_status = 'processed' then
    return query select 'already_processed'::text, v_event.store_id,
      (select enrollment.provider_status
       from public.billing_subscription_enrollments as enrollment
       where enrollment.stripe_subscription_id = v_subscription_id
         and enrollment.stripe_livemode = p_stripe_livemode
         and enrollment.stripe_account_id = v_account),
      (select status.paid_through_at from public.seller_billing_status as status
       where status.store_id = v_event.store_id),
      (select status.grace_ends_at from public.seller_billing_status as status
       where status.store_id = v_event.store_id);
    return;
  end if;
  if v_event.processing_status <> 'processing'
     or v_event.processing_lease_token is distinct from p_processing_lease_token
     or v_event.processing_lease_expires_at <= v_now
     or v_event.applied then
    raise exception using errcode = '55000',
      message = 'SAAS_SUBSCRIPTION_EVENT_FENCE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stripe-subscription:' || v_account || ':' ||
      p_stripe_livemode::text || ':' || v_subscription_id,
      0
    )
  );
  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.stripe_subscription_id = v_subscription_id
    and enrollment.stripe_livemode = p_stripe_livemode
    and enrollment.stripe_account_id = v_account
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'SAAS_SUBSCRIPTION_ENROLLMENT_NOT_FOUND';
  end if;
  perform 1 from public.stores as store_row
  where store_row.id = v_enrollment.store_id for update;

  select binding.* into v_customer
  from public.billing_customer_bindings as binding
  where binding.id = v_enrollment.customer_binding_id;
  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = v_enrollment.store_id
  for update;
  select catalog.* into v_catalog
  from public.billing_provider_price_catalog as catalog
  where catalog.stripe_price_id = v_price_id
    and catalog.stripe_livemode = p_stripe_livemode
    and catalog.stripe_account_id = v_account;

  if v_customer.id is null
     or v_customer.store_id is distinct from v_enrollment.store_id
     or v_customer.stripe_customer_id is distinct from v_customer_id
     or v_customer.stripe_livemode is distinct from p_stripe_livemode
     or v_customer.stripe_account_id is distinct from v_account
     or v_billing.id is null
     or v_billing.current_subscription_enrollment_id is distinct from v_enrollment.id
     or v_billing.stripe_customer_id is distinct from v_customer_id
     or v_billing.stripe_subscription_id is distinct from v_subscription_id
     or v_billing.stripe_price_id is distinct from v_price_id
     or v_enrollment.initial_stripe_price_id is distinct from v_price_id
     or v_catalog.stripe_price_id is null
     or not v_catalog.is_verified
     or v_catalog.stripe_product_id is distinct from v_product_id
     or v_catalog.unit_amount_cents is distinct from p_unit_amount_cents
     or v_catalog.currency is distinct from lower(btrim(p_currency))
     or v_catalog.recurring_interval is distinct from p_recurring_interval
     or v_catalog.recurring_interval_count is distinct from p_recurring_interval_count
     or v_billing.plan_key is distinct from v_catalog.plan_key
     or v_billing.billing_plan is distinct from v_catalog.billing_cadence then
    raise exception using errcode = '55000',
      message = 'SAAS_SUBSCRIPTION_BINDING_CONFLICT';
  end if;

  if v_enrollment.last_subscription_event_created_at is not null and (
       v_enrollment.last_subscription_event_created_at > p_provider_event_created_at
       or (
         v_enrollment.last_subscription_event_created_at = p_provider_event_created_at
         and v_enrollment.last_subscription_event_id > v_event_id
       )
     ) then
    v_stale := true;
  end if;
  if not v_stale and not v_enrollment.is_current
     and v_event_type <> 'customer.subscription.deleted' then
    raise exception using errcode = '55000',
      message = 'SAAS_SUBSCRIPTION_TERMINAL_CONFLICT';
  end if;
  if p_subscription_status = 'trialing' and not exists (
    select 1 from public.billing_trial_claims as claim
    where claim.store_id = v_enrollment.store_id
      and claim.subscription_enrollment_id = v_enrollment.id
      and claim.trial_started_at = p_current_period_start
      and claim.trial_ends_at = p_current_period_end
  ) then
    raise exception using errcode = '55000',
      message = 'SAAS_SUBSCRIPTION_TRIAL_CONFLICT';
  end if;

  update public.billing_provider_events as events
  set store_id = v_enrollment.store_id,
      applied = not v_stale,
      ignored_reason = case when v_stale then 'stale_subscription_event' end
  where events.provider_event_id = v_event_id
    and events.stripe_account_id = v_account
    and events.stripe_livemode = p_stripe_livemode;

  if not v_stale then
    v_terminal_at := coalesce(
      p_subscription_ended_at, p_subscription_canceled_at,
      p_provider_event_created_at
    );
    update public.billing_subscription_enrollments as enrollment
    set provider_status = p_subscription_status,
        cancel_at_period_end = p_cancel_at_period_end,
        provider_canceled_at = case when p_subscription_status = 'canceled'
          then coalesce(p_subscription_canceled_at, v_terminal_at)
          else enrollment.provider_canceled_at end,
        is_current = case when v_event_type = 'customer.subscription.deleted'
          then false else enrollment.is_current end,
        ended_at = case when v_event_type = 'customer.subscription.deleted'
          then v_terminal_at else enrollment.ended_at end,
        last_subscription_event_id = v_event_id,
        last_subscription_event_created_at = p_provider_event_created_at,
        updated_at = v_now
    where enrollment.id = v_enrollment.id
    returning * into v_enrollment;

    update public.seller_billing_status as status
    set subscription_status = p_subscription_status,
        current_period_start = p_current_period_start,
        current_period_end = p_current_period_end,
        cancel_at_period_end = p_cancel_at_period_end,
        last_provider_event_id = v_event_id,
        last_provider_event_created_at = p_provider_event_created_at,
        last_provider_event_applied_at = v_now,
        updated_at = v_now
    where status.store_id = v_enrollment.store_id
    returning * into v_billing;
  end if;

  insert into public.billing_entitlement_events (
    store_id, event_type, plan_key, billing_cadence, access_until,
    provider_event_id, metadata
  ) values (
    v_enrollment.store_id,
    case when v_stale then 'provider_event_ignored'
      else 'provider_state_applied' end,
    v_catalog.plan_key, v_catalog.billing_cadence,
    v_billing.storefront_access_until, v_event_id,
    pg_catalog.jsonb_build_object(
      'event_type', v_event_type,
      'subscription_status', p_subscription_status,
      'cancel_at_period_end', p_cancel_at_period_end,
      'invoice_payment_authority', false,
      'stale', v_stale
    )
  );

  select public.mark_saas_billing_provider_event_processed(
    v_event_id, v_hash, v_account, p_stripe_livemode,
    p_processing_lease_token
  ) into v_finalized;
  if v_finalized is distinct from 'processed' then
    raise exception using errcode = '55000',
      message = 'SAAS_SUBSCRIPTION_EVENT_FINALIZATION_FAILED';
  end if;

  return query select
    case when v_stale then 'stale_snapshot'::text
      when v_event_type = 'customer.subscription.deleted'
        then 'terminal_snapshot_applied'::text
      else 'snapshot_applied'::text end,
    v_enrollment.store_id, v_billing.subscription_status,
    v_billing.paid_through_at, v_billing.grace_ends_at;
end;
$function$;

-- A terminal enrollment remains valid historical proof for paid/grace access,
-- but can never grant a Stripe trial. All other branches are copied from the
-- Batch 7 canonical resolver without changing their authority.
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
  select stores.admin_hold_reason is not null into v_held
  from public.stores where stores.id = p_store_id;
  if not found then
    return query select false, null::text, null::text,
      'missing_store'::text, null::timestamptz, false;
    return;
  end if;
  select status.* into v_billing from public.seller_billing_status as status
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
      and (v_enrollment.is_current or (
        v_enrollment.provider_status = 'canceled'
        and v_enrollment.ended_at is not null
      ))
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
      select claim.* into v_trial from public.billing_trial_claims as claim
      where claim.store_id = p_store_id
        and claim.subscription_enrollment_id = v_enrollment.id;
      if v_enrollment.is_current
         and v_enrollment.provider_status = 'trialing'
         and v_billing.subscription_status = 'trialing'
         and v_price.is_active and v_price.is_verified
         and v_trial.store_id is not null
         and v_trial.provider_event_id = v_enrollment.bound_by_event_id
         and v_enrollment.trial_started_at is not null
         and v_enrollment.trial_ends_at > v_enrollment.trial_started_at
         and v_trial.trial_started_at = v_enrollment.trial_started_at
         and v_trial.trial_ends_at = v_enrollment.trial_ends_at
         and v_billing.trial_started_at = v_enrollment.trial_started_at
         and v_billing.trial_ends_at = v_enrollment.trial_ends_at
         and v_billing.storefront_access_until = v_enrollment.trial_ends_at
         and v_now < v_enrollment.trial_ends_at then
        v_valid := true; v_reason := 'stripe_trial';
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
          v_reason := case when v_billing.cancel_at_period_end
            then 'paid_canceling' else 'paid' end;
          v_until := v_billing.paid_through_at;
        end if;
      end if;
      if not v_valid and v_enrollment.is_current
         and v_billing.grace_stripe_invoice_id is not null then
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
           and v_grace_invoice.grace_eligible and v_grace_invoice.paid_at is null
           and (v_grace_invoice.failure_at is not null
             or v_grace_invoice.action_required_at is not null
             or v_grace_invoice.finalization_failed_at is not null)
           and v_grace_invoice.grace_ends_at = v_billing.grace_ends_at
           and v_grace_invoice.last_provider_event_id = v_billing.grace_provider_event_id
           and v_grace_invoice.last_provider_event_created_at = v_billing.grace_provider_event_created_at
           and ((v_trial.store_id is not null
               and v_grace_invoice.grace_anchor_at = v_enrollment.trial_ends_at)
             or (v_grace_invoice.billing_reason = 'subscription_cycle'
               and v_billing.paid_through_at is not null
               and v_grace_invoice.grace_anchor_at = v_billing.paid_through_at))
           and v_now >= v_grace_invoice.grace_anchor_at
           and v_now < v_grace_invoice.grace_ends_at then
          v_valid := true; v_reason := 'payment_grace';
          v_until := v_grace_invoice.grace_ends_at;
        elsif v_billing.grace_ends_at is not null
           and v_now >= v_billing.grace_ends_at then
          v_reason := 'payment_grace_expired';
        end if;
      end if;
      if not v_valid and v_reason = 'inactive' then
        v_reason := case when v_billing.subscription_status in (
          'past_due', 'unpaid', 'paused', 'canceled', 'dormant',
          'incomplete', 'incomplete_expired', 'suspended'
        ) then v_billing.subscription_status else 'unpaid' end;
      end if;
    end if;
  else
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
      v_valid := true; v_reason := 'trial'; v_until := v_billing.trial_ends_at;
    elsif v_billing.subscription_status = 'active'
      and v_billing.billing_state_authority in ('stripe', 'legacy_stripe')
      and v_billing.plan_key in ('small_flock', 'full_flock')
      and v_billing.billing_plan in ('monthly', 'yearly')
      and nullif(trim(v_billing.stripe_customer_id), '') is not null
      and nullif(trim(v_billing.stripe_subscription_id), '') is not null
      and v_billing.current_period_end is not null
      and v_billing.storefront_access_until = v_billing.current_period_end
      and v_billing.storefront_access_until > v_now
      and (v_billing.billing_state_authority = 'legacy_stripe'
        or (v_billing.current_period_start is not null
          and v_billing.current_period_end > v_billing.current_period_start
          and nullif(trim(v_billing.stripe_price_id), '') is not null
          and nullif(trim(v_billing.last_provider_event_id), '') is not null
          and v_billing.last_provider_event_created_at is not null
          and exists (select 1 from public.billing_provider_price_catalog as price
            where price.stripe_price_id = v_billing.stripe_price_id
              and price.stripe_livemode = v_billing.stripe_livemode
              and price.stripe_account_id = coalesce(v_billing.stripe_account_id, '')
              and price.plan_key = v_billing.plan_key
              and price.billing_cadence = v_billing.billing_plan))) then
      v_valid := true;
      v_reason := case when v_billing.cancel_at_period_end
        then 'paid_canceling' else 'paid' end;
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
      v_valid := true; v_reason := 'admin_comp';
      v_until := v_billing.comp_access_until;
    else
      v_reason := case when v_billing.subscription_status in (
        'past_due', 'unpaid', 'paused', 'canceled', 'dormant',
        'incomplete', 'incomplete_expired', 'suspended'
      ) then v_billing.subscription_status
      when v_billing.billing_state_authority = 'legacy_unclassified'
        then 'unclassified' else 'malformed' end;
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
'Canonical entitlement resolver. Only fenced verified invoice payment can extend paid-through; terminal Subscription snapshots cannot shorten already-proven service.';

-- Explicitly expose only the fenced overloads to service_role.
do $grants$
declare
  v_signature regprocedure;
begin
  for v_signature in
    select procedure.oid::regprocedure
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'apply_verified_saas_invoice_payment_succeeded',
        'apply_verified_saas_invoice_payment_failed',
        'apply_verified_saas_invoice_payment_action_required',
        'apply_verified_saas_invoice_finalization_failed',
        'apply_verified_stripe_subscription_event'
      )
      and pg_catalog.pg_get_function_arguments(procedure.oid)
        like '%p_processing_lease_token uuid%'
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_signature
    );
    execute pg_catalog.format(
      'grant execute on function %s to service_role', v_signature
    );
  end loop;
end;
$grants$;

update public.platform_settings
set boolean_value = false,
    updated_by_user_id = null
where setting_key in (
  'saas_subscription_checkout_enabled', 'saas_billing_portal_enabled'
);

commit;
