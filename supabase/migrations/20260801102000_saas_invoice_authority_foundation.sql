-- SaaS invoice payment authority foundation.
--
-- This migration adds typed, service-only evidence for future verified Stripe
-- invoice events. It does not add a webhook, call Stripe, enable billing, or
-- infer payment from Subscription scheduling fields.

begin;

-- Exact composite identities support database-enforced store, Customer,
-- Subscription, account, and mode binding on every invoice row.
alter table public.billing_customer_bindings
  add constraint billing_customer_bindings_invoice_identity_unique unique (
    id,
    store_id,
    stripe_customer_id,
    stripe_livemode,
    stripe_account_id
  );

alter table public.billing_subscription_enrollments
  add constraint billing_subscription_enrollments_invoice_identity_unique unique (
    id,
    store_id,
    customer_binding_id,
    stripe_subscription_id,
    stripe_livemode,
    stripe_account_id
  );

create table public.billing_subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  subscription_enrollment_id uuid not null,
  customer_binding_id uuid not null,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  stripe_invoice_id text not null,
  stripe_price_id text not null,
  stripe_livemode boolean not null,
  stripe_account_id text not null,
  billing_reason text not null,
  collection_method text not null,
  invoice_status text not null,
  currency text not null,
  amount_due_cents bigint not null,
  amount_paid_cents bigint not null,
  amount_remaining_cents bigint not null,
  base_line_amount_cents bigint not null,
  service_period_start timestamptz,
  service_period_end timestamptz,
  paid_at timestamptz,
  failure_at timestamptz,
  action_required_at timestamptz,
  finalization_failed_at timestamptz,
  next_payment_attempt_at timestamptz,
  paid_through_applied_at timestamptz,
  grace_eligible boolean not null default false,
  grace_anchor_at timestamptz,
  grace_ends_at timestamptz,
  failure_code text,
  last_provider_event_id text not null,
  last_provider_event_created_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),

  constraint billing_subscription_invoices_customer_context_fk foreign key (
    customer_binding_id,
    store_id,
    stripe_customer_id,
    stripe_livemode,
    stripe_account_id
  ) references public.billing_customer_bindings (
    id,
    store_id,
    stripe_customer_id,
    stripe_livemode,
    stripe_account_id
  ) on delete restrict,
  constraint billing_subscription_invoices_enrollment_context_fk foreign key (
    subscription_enrollment_id,
    store_id,
    customer_binding_id,
    stripe_subscription_id,
    stripe_livemode,
    stripe_account_id
  ) references public.billing_subscription_enrollments (
    id,
    store_id,
    customer_binding_id,
    stripe_subscription_id,
    stripe_livemode,
    stripe_account_id
  ) on delete restrict,
  constraint billing_subscription_invoices_context_unique unique (
    stripe_invoice_id,
    stripe_livemode,
    stripe_account_id
  ),
  constraint billing_subscription_invoices_context_identity_unique unique (
    stripe_invoice_id,
    store_id,
    subscription_enrollment_id,
    stripe_livemode,
    stripe_account_id
  ),
  constraint billing_subscription_invoices_invoice_not_empty_check check (
    length(trim(stripe_invoice_id)) > 0
  ),
  constraint billing_subscription_invoices_customer_not_empty_check check (
    length(trim(stripe_customer_id)) > 0
  ),
  constraint billing_subscription_invoices_subscription_not_empty_check check (
    length(trim(stripe_subscription_id)) > 0
  ),
  constraint billing_subscription_invoices_price_not_empty_check check (
    length(trim(stripe_price_id)) > 0
  ),
  constraint billing_subscription_invoices_account_check check (
    stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  ),
  constraint billing_subscription_invoices_reason_not_empty_check check (
    length(trim(billing_reason)) > 0
  ),
  constraint billing_subscription_invoices_collection_method_check check (
    collection_method in ('charge_automatically', 'send_invoice')
  ),
  constraint billing_subscription_invoices_status_not_empty_check check (
    length(trim(invoice_status)) > 0
  ),
  constraint billing_subscription_invoices_currency_check check (
    currency = lower(trim(currency)) and currency ~ '^[a-z]{3}$'
  ),
  constraint billing_subscription_invoices_amounts_check check (
    amount_due_cents >= 0
    and amount_paid_cents >= 0
    and amount_remaining_cents >= 0
    and base_line_amount_cents >= 0
  ),
  constraint billing_subscription_invoices_service_period_check check (
    (service_period_start is null and service_period_end is null)
    or (
      service_period_start is not null
      and service_period_end is not null
      and service_period_end > service_period_start
    )
  ),
  constraint billing_subscription_invoices_grace_check check (
    (
      not grace_eligible
      and grace_anchor_at is null
      and grace_ends_at is null
    )
    or (
      grace_eligible
      and grace_anchor_at is not null
      and grace_ends_at = grace_anchor_at + interval '3 days'
    )
  ),
  constraint billing_subscription_invoices_failure_code_check check (
    failure_code is null
    or (
      length(trim(failure_code)) between 1 and 100
      and failure_code = trim(failure_code)
    )
  ),
  constraint billing_subscription_invoices_event_not_empty_check check (
    length(trim(last_provider_event_id)) > 0
  )
);

alter table public.billing_subscription_invoices
  add constraint billing_subscription_invoices_provider_event_fk foreign key (
    stripe_livemode,
    stripe_account_id,
    last_provider_event_id,
    store_id
  ) references public.billing_provider_events (
    stripe_livemode,
    stripe_account_id,
    provider_event_id,
    store_id
  ) on delete restrict;

comment on table public.billing_subscription_invoices is
'Typed service-only evidence for FlockFront SaaS invoice events. Full provider payloads and payment credentials are intentionally excluded.';

comment on column public.billing_subscription_invoices.paid_through_applied_at is
'When the successful-payment sink advanced seller paid-through access from this invoice. Null for zero-dollar, manual, failed, or non-entitlement invoices.';

create index billing_subscription_invoices_store_created_idx
  on public.billing_subscription_invoices(store_id, created_at desc);
create index billing_subscription_invoices_enrollment_created_idx
  on public.billing_subscription_invoices(subscription_enrollment_id, created_at desc);
create index billing_subscription_invoices_status_idx
  on public.billing_subscription_invoices(invoice_status, last_provider_event_created_at desc);
create index billing_subscription_invoices_grace_monitor_idx
  on public.billing_subscription_invoices(grace_ends_at, store_id)
  where grace_eligible and paid_at is null;

create trigger billing_subscription_invoices_set_updated_at
before update on public.billing_subscription_invoices
for each row execute function public.set_updated_at();

create or replace function public.enforce_billing_subscription_invoice_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.store_id is distinct from old.store_id
     or new.subscription_enrollment_id is distinct from old.subscription_enrollment_id
     or new.customer_binding_id is distinct from old.customer_binding_id
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.stripe_invoice_id is distinct from old.stripe_invoice_id
     or new.stripe_price_id is distinct from old.stripe_price_id
     or new.stripe_livemode is distinct from old.stripe_livemode
     or new.stripe_account_id is distinct from old.stripe_account_id
     or new.billing_reason is distinct from old.billing_reason
     or new.collection_method is distinct from old.collection_method
     or new.currency is distinct from old.currency
     or new.amount_due_cents is distinct from old.amount_due_cents
     or new.base_line_amount_cents is distinct from old.base_line_amount_cents
     or new.service_period_start is distinct from old.service_period_start
     or new.service_period_end is distinct from old.service_period_end then
    raise exception 'SaaS invoice binding and recurring-line evidence is immutable.';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_billing_subscription_invoice_immutability()
  from public, anon, authenticated, service_role;

create trigger billing_subscription_invoices_enforce_immutability
before update on public.billing_subscription_invoices
for each row execute function public.enforce_billing_subscription_invoice_immutability();

alter table public.seller_billing_status
  add column paid_through_at timestamptz,
  add column grace_ends_at timestamptz,
  add column payment_failure_started_at timestamptz,
  add column payment_action_required_at timestamptz,
  add column effective_price_started_at timestamptz,
  add column latest_stripe_invoice_id text,
  add column latest_invoice_status text,
  add column last_paid_stripe_invoice_id text,
  add column latest_invoice_event_id text,
  add column latest_invoice_event_created_at timestamptz,
  add column grace_stripe_invoice_id text,
  add column grace_provider_event_id text,
  add column grace_provider_event_created_at timestamptz;

alter table public.seller_billing_status
  add constraint seller_billing_status_latest_invoice_not_empty_check check (
    latest_stripe_invoice_id is null or length(trim(latest_stripe_invoice_id)) > 0
  ),
  add constraint seller_billing_status_latest_invoice_status_check check (
    latest_invoice_status is null or length(trim(latest_invoice_status)) > 0
  ),
  add constraint seller_billing_status_last_paid_invoice_not_empty_check check (
    last_paid_stripe_invoice_id is null or length(trim(last_paid_stripe_invoice_id)) > 0
  ),
  add constraint seller_billing_status_invoice_event_pair_check check (
    (latest_invoice_event_id is null and latest_invoice_event_created_at is null)
    or (latest_invoice_event_id is not null and latest_invoice_event_created_at is not null)
  ),
  add constraint seller_billing_status_grace_evidence_check check (
    (
      grace_ends_at is null
      and grace_stripe_invoice_id is null
      and grace_provider_event_id is null
      and grace_provider_event_created_at is null
    )
    or (
      grace_ends_at is not null
      and grace_stripe_invoice_id is not null
      and grace_provider_event_id is not null
      and grace_provider_event_created_at is not null
    )
  );

comment on column public.seller_billing_status.current_period_end is
'Provider Subscription scheduling snapshot. It is not proof that an invoice was successfully collected.';
comment on column public.seller_billing_status.paid_through_at is
'Monotonic service boundary established only by the verified invoice.payment_succeeded database sink.';
comment on column public.seller_billing_status.grace_ends_at is
'Read-model boundary backed by an eligible typed invoice failure. This timestamp alone is never entitlement authority.';

alter table public.seller_billing_status
  drop constraint seller_billing_status_subscription_status_check;
alter table public.seller_billing_status
  add constraint seller_billing_status_subscription_status_check check (
    subscription_status in (
      'trialing', 'active', 'past_due', 'unpaid', 'paused', 'dormant',
      'canceled', 'comped', 'incomplete', 'incomplete_expired', 'suspended'
    )
  ) not valid;

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
      'invoice_event_ignored', 'invoice_event_conflict'
    )
  );

-- Shared validation and mutation path for the three non-payment invoice
-- outcomes. It cannot write paid_through_at or last_paid_stripe_invoice_id.
create or replace function public.apply_verified_saas_invoice_nonpayment(
  p_outcome text,
  p_provider_event_id text,
  p_provider_event_created_at timestamptz,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_store_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_invoice_id text,
  p_stripe_price_id text,
  p_billing_reason text,
  p_collection_method text,
  p_invoice_status text,
  p_currency text,
  p_amount_due_cents bigint,
  p_amount_paid_cents bigint,
  p_amount_remaining_cents bigint,
  p_base_line_amount_cents bigint,
  p_service_period_start timestamptz,
  p_service_period_end timestamptz,
  p_observed_at timestamptz,
  p_next_payment_attempt_at timestamptz default null,
  p_failure_code text default null
)
returns table (
  applied boolean,
  invoice_id uuid,
  paid_through_at timestamptz,
  grace_ends_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event_type text;
  v_audit_type text;
  v_event_id text := nullif(trim(p_provider_event_id), '');
  v_hash text := nullif(trim(p_payload_hash), '');
  v_account text := nullif(trim(p_stripe_account_id), '');
  v_customer text := nullif(trim(p_stripe_customer_id), '');
  v_subscription text := nullif(trim(p_stripe_subscription_id), '');
  v_invoice text := nullif(trim(p_stripe_invoice_id), '');
  v_price text := nullif(trim(p_stripe_price_id), '');
  v_reason text := nullif(trim(p_billing_reason), '');
  v_collection text := nullif(trim(p_collection_method), '');
  v_status text := nullif(trim(p_invoice_status), '');
  v_currency text := nullif(trim(p_currency), '');
  v_failure_code text := nullif(trim(p_failure_code), '');
  v_billing public.seller_billing_status%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_customer_binding public.billing_customer_bindings%rowtype;
  v_price_row public.billing_provider_price_catalog%rowtype;
  v_prior_event public.billing_provider_events%rowtype;
  v_invoice_row public.billing_subscription_invoices%rowtype;
  v_grace_anchor timestamptz;
  v_grace_end timestamptz;
  v_eligible boolean := false;
  v_stale boolean := false;
  v_ignore_reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Verified SaaS invoice outcomes require a service workflow.';
  end if;

  case p_outcome
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
      raise exception 'Unsupported SaaS invoice non-payment outcome.';
  end case;

  if v_event_id is null or p_provider_event_created_at is null or v_hash is null
     or v_account is null or v_account !~ '^acct_[A-Za-z0-9]+$'
     or p_stripe_livemode is null or p_store_id is null
     or v_customer is null or v_subscription is null or v_invoice is null
     or v_price is null or v_reason is null or v_collection is null
     or v_status is null or v_currency is null or p_observed_at is null then
    raise exception 'Verified SaaS invoice event fields are required.';
  end if;
  if v_currency <> lower(v_currency) or v_currency !~ '^[a-z]{3}$'
     or p_amount_due_cents < 0 or p_amount_paid_cents < 0
     or p_amount_remaining_cents < 0 or p_base_line_amount_cents < 0 then
    raise exception 'Verified SaaS invoice monetary fields are invalid.';
  end if;
  if v_collection not in ('charge_automatically', 'send_invoice') then
    raise exception 'Unsupported invoice collection method.';
  end if;
  if (p_service_period_start is null) <> (p_service_period_end is null)
     or (p_service_period_end is not null and p_service_period_end <= p_service_period_start) then
    raise exception 'Recurring service period is invalid.';
  end if;
  if v_failure_code is not null
     and (length(v_failure_code) > 100 or v_failure_code <> trim(v_failure_code)) then
    raise exception 'Failure code must be sanitized.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'saas-provider-event:' || p_stripe_livemode::text || ':' || v_account || ':' || v_event_id, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'saas-invoice:' || p_stripe_livemode::text || ':' || v_account || ':' || v_invoice, 0
  ));

  select provider_event.* into v_prior_event
  from public.billing_provider_events as provider_event
  where provider_event.stripe_livemode = p_stripe_livemode
    and provider_event.stripe_account_id = v_account
    and provider_event.provider_event_id = v_event_id;

  if v_prior_event.provider_event_id is not null then
    if v_prior_event.payload_hash <> v_hash
       or v_prior_event.store_id <> p_store_id
       or v_prior_event.event_type <> v_event_type
       or v_prior_event.provider_event_created_at <> p_provider_event_created_at
       or v_prior_event.provider_object_type is distinct from 'invoice'
       or v_prior_event.provider_object_id is distinct from v_invoice then
      raise exception 'Provider event id was reused with different content.';
    end if;
    select invoice_record.* into v_invoice_row
    from public.billing_subscription_invoices as invoice_record
    where invoice_record.stripe_invoice_id = v_invoice
      and invoice_record.stripe_livemode = p_stripe_livemode
      and invoice_record.stripe_account_id = v_account;
    return query select v_prior_event.applied, v_invoice_row.id,
      (select status.paid_through_at from public.seller_billing_status status where status.store_id = p_store_id),
      (select status.grace_ends_at from public.seller_billing_status status where status.store_id = p_store_id);
    return;
  end if;

  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = p_store_id
  for update;
  if v_billing.id is null or v_billing.current_subscription_enrollment_id is null then
    raise exception 'Store does not have a current invoice-backed enrollment.';
  end if;

  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.id = v_billing.current_subscription_enrollment_id
  for update;
  if v_enrollment.id is null or not v_enrollment.is_current
     or v_enrollment.store_id <> p_store_id
     or v_enrollment.stripe_livemode <> p_stripe_livemode
     or v_enrollment.stripe_account_id <> v_account
     or v_enrollment.stripe_subscription_id <> v_subscription
     or v_enrollment.initial_stripe_price_id <> v_price then
    raise exception 'Invoice does not match the current Subscription enrollment.';
  end if;

  select binding.* into v_customer_binding
  from public.billing_customer_bindings as binding
  where binding.id = v_enrollment.customer_binding_id;
  if v_customer_binding.id is null or v_customer_binding.store_id <> p_store_id
     or v_customer_binding.stripe_livemode <> p_stripe_livemode
     or v_customer_binding.stripe_account_id <> v_account
     or v_customer_binding.stripe_customer_id <> v_customer then
    raise exception 'Invoice does not match the immutable Customer binding.';
  end if;
  if v_billing.stripe_customer_id is distinct from v_customer
     or v_billing.stripe_subscription_id is distinct from v_subscription
     or v_billing.stripe_livemode is distinct from p_stripe_livemode
     or v_billing.stripe_account_id is distinct from v_account then
    raise exception 'Billing snapshot conflicts with the immutable enrollment binding.';
  end if;

  select price.* into v_price_row
  from public.billing_provider_price_catalog as price
  where price.stripe_price_id = v_price
    and price.stripe_livemode = p_stripe_livemode
    and price.stripe_account_id = v_account
    and price.is_active;
  if v_price_row.stripe_price_id is null
     or v_price_row.stripe_product_id is null
     or v_price_row.unit_amount_cents is null
     or v_price_row.currency is null
     or v_price_row.recurring_interval is null
     or v_price_row.recurring_interval_count is null then
    raise exception 'Invoice Price is not a complete active trusted recurring Price.';
  end if;
  if v_currency <> v_price_row.currency
     or p_base_line_amount_cents <> v_price_row.unit_amount_cents then
    raise exception 'Invoice recurring-line evidence does not match the trusted Price.';
  end if;

  select invoice_record.* into v_invoice_row
  from public.billing_subscription_invoices as invoice_record
  where invoice_record.stripe_invoice_id = v_invoice
    and invoice_record.stripe_livemode = p_stripe_livemode
    and invoice_record.stripe_account_id = v_account
  for update;
  if v_invoice_row.id is not null and (
       v_invoice_row.store_id <> p_store_id
       or v_invoice_row.subscription_enrollment_id <> v_enrollment.id
       or v_invoice_row.customer_binding_id <> v_customer_binding.id
       or v_invoice_row.stripe_customer_id <> v_customer
       or v_invoice_row.stripe_subscription_id <> v_subscription
       or v_invoice_row.stripe_price_id <> v_price
       or v_invoice_row.billing_reason <> v_reason
       or v_invoice_row.collection_method <> v_collection
       or v_invoice_row.currency <> v_currency
       or v_invoice_row.amount_due_cents <> p_amount_due_cents
       or v_invoice_row.base_line_amount_cents <> p_base_line_amount_cents
       or v_invoice_row.service_period_start is distinct from p_service_period_start
       or v_invoice_row.service_period_end is distinct from p_service_period_end
     ) then
    raise exception 'Stripe Invoice identifier conflicts with existing immutable evidence.';
  end if;

  if v_invoice_row.paid_at is not null then
    v_stale := true;
    v_ignore_reason := 'successful_invoice_precedence';
  elsif v_invoice_row.last_provider_event_created_at is not null and (
      v_invoice_row.last_provider_event_created_at > p_provider_event_created_at
      or (
        v_invoice_row.last_provider_event_created_at = p_provider_event_created_at
        and v_invoice_row.last_provider_event_id > v_event_id
      )
    ) then
    v_stale := true;
    v_ignore_reason := 'stale_invoice_event';
  end if;

  if not v_stale and v_collection = 'charge_automatically'
     and p_service_period_end is not null
     and p_amount_due_cents > 0 then
    if v_reason = 'subscription_create'
       and exists (
         select 1 from public.billing_trial_claims as claim
         where claim.store_id = p_store_id
           and claim.subscription_enrollment_id = v_enrollment.id
           and claim.trial_started_at = v_enrollment.trial_started_at
           and claim.trial_ends_at = v_enrollment.trial_ends_at
           and v_billing.trial_started_at = claim.trial_started_at
           and v_billing.trial_ends_at = claim.trial_ends_at
       ) then
      v_grace_anchor := v_enrollment.trial_ends_at;
      v_eligible := true;
    elsif v_reason = 'subscription_cycle' and v_billing.paid_through_at is not null then
      v_grace_anchor := v_billing.paid_through_at;
      v_eligible := true;
    end if;
  end if;
  if v_eligible then
    v_grace_end := v_grace_anchor + interval '3 days';
    if p_service_period_end <> p_service_period_start + make_interval(
      months => v_price_row.recurring_interval_count *
        case when v_price_row.recurring_interval = 'year' then 12 else 1 end
    ) then
      raise exception 'Invoice service period does not match the trusted recurring interval.';
    end if;
  end if;

  insert into public.billing_provider_events (
    stripe_livemode, stripe_account_id, provider_event_id,
    provider_event_created_at, store_id, event_type, payload_hash,
    applied, ignored_reason, processing_status, processed_at, attempt_count,
    provider_object_type, provider_object_id
  ) values (
    p_stripe_livemode, v_account, v_event_id,
    p_provider_event_created_at, p_store_id, v_event_type, v_hash,
    not v_stale, v_ignore_reason,
    case when v_stale then 'ignored' else 'processed' end,
    statement_timestamp(), 1, 'invoice', v_invoice
  );

  if v_stale then
    insert into public.billing_entitlement_events (
      store_id, event_type, provider_event_id, metadata
    ) values (
      p_store_id, 'invoice_event_ignored', v_event_id,
      jsonb_build_object('reason', v_ignore_reason, 'invoice_id', v_invoice)
    );
    return query select false, v_invoice_row.id, v_billing.paid_through_at, v_billing.grace_ends_at;
    return;
  end if;

  insert into public.billing_subscription_invoices as invoice_record (
    store_id, subscription_enrollment_id, customer_binding_id,
    stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
    stripe_price_id, stripe_livemode, stripe_account_id, billing_reason,
    collection_method, invoice_status, currency, amount_due_cents,
    amount_paid_cents, amount_remaining_cents, base_line_amount_cents,
    service_period_start, service_period_end, failure_at, action_required_at,
    finalization_failed_at, next_payment_attempt_at, grace_eligible,
    grace_anchor_at, grace_ends_at, failure_code,
    last_provider_event_id, last_provider_event_created_at
  ) values (
    p_store_id, v_enrollment.id, v_customer_binding.id,
    v_customer, v_subscription, v_invoice, v_price, p_stripe_livemode,
    v_account, v_reason, v_collection, v_status, v_currency,
    p_amount_due_cents, p_amount_paid_cents, p_amount_remaining_cents,
    p_base_line_amount_cents, p_service_period_start, p_service_period_end,
    case when p_outcome = 'payment_failed' then p_observed_at end,
    case when p_outcome = 'payment_action_required' then p_observed_at end,
    case when p_outcome = 'finalization_failed' then p_observed_at end,
    p_next_payment_attempt_at, v_eligible, v_grace_anchor, v_grace_end,
    v_failure_code, v_event_id, p_provider_event_created_at
  )
  on conflict (stripe_invoice_id, stripe_livemode, stripe_account_id) do update set
    invoice_status = excluded.invoice_status,
    amount_paid_cents = excluded.amount_paid_cents,
    amount_remaining_cents = excluded.amount_remaining_cents,
    failure_at = coalesce(invoice_record.failure_at, excluded.failure_at),
    action_required_at = coalesce(invoice_record.action_required_at, excluded.action_required_at),
    finalization_failed_at = coalesce(invoice_record.finalization_failed_at, excluded.finalization_failed_at),
    next_payment_attempt_at = excluded.next_payment_attempt_at,
    grace_eligible = excluded.grace_eligible,
    grace_anchor_at = excluded.grace_anchor_at,
    grace_ends_at = excluded.grace_ends_at,
    failure_code = excluded.failure_code,
    last_provider_event_id = excluded.last_provider_event_id,
    last_provider_event_created_at = excluded.last_provider_event_created_at
  returning invoice_record.* into v_invoice_row;

  update public.seller_billing_status as status
  set
    payment_failure_started_at = case
      when p_outcome = 'payment_failed' then p_observed_at
      else status.payment_failure_started_at
    end,
    payment_action_required_at = case
      when p_outcome = 'payment_action_required' then p_observed_at
      else status.payment_action_required_at
    end,
    grace_ends_at = case when v_eligible then v_grace_end else status.grace_ends_at end,
    grace_stripe_invoice_id = case when v_eligible then v_invoice else status.grace_stripe_invoice_id end,
    grace_provider_event_id = case when v_eligible then v_event_id else status.grace_provider_event_id end,
    grace_provider_event_created_at = case when v_eligible then p_provider_event_created_at else status.grace_provider_event_created_at end,
    latest_stripe_invoice_id = case
      when status.latest_invoice_event_created_at is null
        or (p_provider_event_created_at, v_event_id) >= (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then v_invoice else status.latest_stripe_invoice_id end,
    latest_invoice_status = case
      when status.latest_invoice_event_created_at is null
        or (p_provider_event_created_at, v_event_id) >= (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then v_status else status.latest_invoice_status end,
    latest_invoice_event_id = case
      when status.latest_invoice_event_created_at is null
        or (p_provider_event_created_at, v_event_id) >= (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then v_event_id else status.latest_invoice_event_id end,
    latest_invoice_event_created_at = case
      when status.latest_invoice_event_created_at is null
        or (p_provider_event_created_at, v_event_id) >= (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then p_provider_event_created_at else status.latest_invoice_event_created_at end,
    storefront_access_until = case
      when v_eligible then greatest(status.storefront_access_until, v_grace_end)
      else status.storefront_access_until end,
    updated_at = statement_timestamp()
  where status.store_id = p_store_id
  returning status.* into v_billing;

  insert into public.billing_entitlement_events (
    store_id, event_type, plan_key, billing_cadence, access_until,
    provider_event_id, metadata
  ) values (
    p_store_id, v_audit_type, v_price_row.plan_key, v_price_row.billing_cadence,
    v_billing.storefront_access_until, v_event_id,
    jsonb_build_object(
      'invoice_id', v_invoice, 'invoice_status', v_status,
      'billing_reason', v_reason, 'grace_eligible', v_eligible
    )
  );
  if v_eligible then
    insert into public.billing_entitlement_events (
      store_id, event_type, plan_key, billing_cadence, access_until,
      provider_event_id, metadata
    ) values (
      p_store_id, 'grace_scheduled', v_price_row.plan_key,
      v_price_row.billing_cadence, v_grace_end, v_event_id,
      jsonb_build_object('invoice_id', v_invoice, 'anchor', v_grace_anchor)
    );
  end if;

  return query select true, v_invoice_row.id, v_billing.paid_through_at, v_billing.grace_ends_at;
end;
$function$;

revoke all on function public.apply_verified_saas_invoice_nonpayment(
  text, text, timestamptz, text, text, boolean, uuid, text, text, text,
  text, text, text, text, text, bigint, bigint, bigint, bigint,
  timestamptz, timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;

create or replace function public.apply_verified_saas_invoice_payment_succeeded(
  p_provider_event_id text,
  p_provider_event_created_at timestamptz,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_store_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_invoice_id text,
  p_stripe_price_id text,
  p_billing_reason text,
  p_collection_method text,
  p_invoice_status text,
  p_currency text,
  p_amount_due_cents bigint,
  p_amount_paid_cents bigint,
  p_amount_remaining_cents bigint,
  p_base_line_amount_cents bigint,
  p_service_period_start timestamptz,
  p_service_period_end timestamptz,
  p_paid_at timestamptz
)
returns table (
  applied boolean,
  invoice_id uuid,
  paid_through_at timestamptz,
  grace_ends_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event_id text := nullif(trim(p_provider_event_id), '');
  v_hash text := nullif(trim(p_payload_hash), '');
  v_account text := nullif(trim(p_stripe_account_id), '');
  v_customer text := nullif(trim(p_stripe_customer_id), '');
  v_subscription text := nullif(trim(p_stripe_subscription_id), '');
  v_invoice text := nullif(trim(p_stripe_invoice_id), '');
  v_price text := nullif(trim(p_stripe_price_id), '');
  v_reason text := nullif(trim(p_billing_reason), '');
  v_collection text := nullif(trim(p_collection_method), '');
  v_status text := nullif(trim(p_invoice_status), '');
  v_currency text := nullif(trim(p_currency), '');
  v_billing public.seller_billing_status%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_customer_binding public.billing_customer_bindings%rowtype;
  v_price_row public.billing_provider_price_catalog%rowtype;
  v_prior_event public.billing_provider_events%rowtype;
  v_invoice_row public.billing_subscription_invoices%rowtype;
  v_extends boolean := false;
  v_advanced boolean := false;
  v_recovered boolean := false;
  v_ignore_reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Verified SaaS invoice payment requires a service workflow.';
  end if;
  if v_event_id is null or p_provider_event_created_at is null or v_hash is null
     or v_account is null or v_account !~ '^acct_[A-Za-z0-9]+$'
     or p_stripe_livemode is null or p_store_id is null
     or v_customer is null or v_subscription is null or v_invoice is null
     or v_price is null or v_reason is null or v_collection is null
     or v_status is null or v_currency is null or p_paid_at is null then
    raise exception 'Verified SaaS invoice payment fields are required.';
  end if;
  if v_currency <> lower(v_currency) or v_currency !~ '^[a-z]{3}$'
     or p_amount_due_cents < 0 or p_amount_paid_cents < 0
     or p_amount_remaining_cents < 0 or p_base_line_amount_cents < 0 then
    raise exception 'Verified SaaS invoice monetary fields are invalid.';
  end if;
  if v_collection not in ('charge_automatically', 'send_invoice') then
    raise exception 'Unsupported invoice collection method.';
  end if;
  if v_status <> 'paid' or p_amount_remaining_cents <> 0 then
    raise exception 'Successful invoice event must carry a paid, zero-remaining invoice.';
  end if;
  if (p_service_period_start is null) <> (p_service_period_end is null)
     or (p_service_period_end is not null and p_service_period_end <= p_service_period_start) then
    raise exception 'Recurring service period is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'saas-provider-event:' || p_stripe_livemode::text || ':' || v_account || ':' || v_event_id, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'saas-invoice:' || p_stripe_livemode::text || ':' || v_account || ':' || v_invoice, 0
  ));

  select provider_event.* into v_prior_event
  from public.billing_provider_events as provider_event
  where provider_event.stripe_livemode = p_stripe_livemode
    and provider_event.stripe_account_id = v_account
    and provider_event.provider_event_id = v_event_id;
  if v_prior_event.provider_event_id is not null then
    if v_prior_event.payload_hash <> v_hash
       or v_prior_event.store_id <> p_store_id
       or v_prior_event.event_type <> 'invoice.payment_succeeded'
       or v_prior_event.provider_event_created_at <> p_provider_event_created_at
       or v_prior_event.provider_object_type is distinct from 'invoice'
       or v_prior_event.provider_object_id is distinct from v_invoice then
      raise exception 'Provider event id was reused with different content.';
    end if;
    select invoice_record.* into v_invoice_row
    from public.billing_subscription_invoices as invoice_record
    where invoice_record.stripe_invoice_id = v_invoice
      and invoice_record.stripe_livemode = p_stripe_livemode
      and invoice_record.stripe_account_id = v_account;
    return query select v_prior_event.applied, v_invoice_row.id,
      (select status.paid_through_at from public.seller_billing_status status where status.store_id = p_store_id),
      (select status.grace_ends_at from public.seller_billing_status status where status.store_id = p_store_id);
    return;
  end if;

  select status.* into v_billing
  from public.seller_billing_status as status
  where status.store_id = p_store_id
  for update;
  if v_billing.id is null or v_billing.current_subscription_enrollment_id is null then
    raise exception 'Store does not have a current invoice-backed enrollment.';
  end if;
  select enrollment.* into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.id = v_billing.current_subscription_enrollment_id
  for update;
  if v_enrollment.id is null or not v_enrollment.is_current
     or v_enrollment.store_id <> p_store_id
     or v_enrollment.stripe_livemode <> p_stripe_livemode
     or v_enrollment.stripe_account_id <> v_account
     or v_enrollment.stripe_subscription_id <> v_subscription
     or v_enrollment.initial_stripe_price_id <> v_price then
    raise exception 'Invoice does not match the current Subscription enrollment.';
  end if;
  select binding.* into v_customer_binding
  from public.billing_customer_bindings as binding
  where binding.id = v_enrollment.customer_binding_id;
  if v_customer_binding.id is null or v_customer_binding.store_id <> p_store_id
     or v_customer_binding.stripe_livemode <> p_stripe_livemode
     or v_customer_binding.stripe_account_id <> v_account
     or v_customer_binding.stripe_customer_id <> v_customer then
    raise exception 'Invoice does not match the immutable Customer binding.';
  end if;
  if v_billing.stripe_customer_id is distinct from v_customer
     or v_billing.stripe_subscription_id is distinct from v_subscription
     or v_billing.stripe_livemode is distinct from p_stripe_livemode
     or v_billing.stripe_account_id is distinct from v_account then
    raise exception 'Billing snapshot conflicts with the immutable enrollment binding.';
  end if;
  select price.* into v_price_row
  from public.billing_provider_price_catalog as price
  where price.stripe_price_id = v_price
    and price.stripe_livemode = p_stripe_livemode
    and price.stripe_account_id = v_account
    and price.is_active;
  if v_price_row.stripe_price_id is null
     or v_price_row.stripe_product_id is null
     or v_price_row.unit_amount_cents is null
     or v_price_row.currency is null
     or v_price_row.recurring_interval is null
     or v_price_row.recurring_interval_count is null then
    raise exception 'Invoice Price is not a complete active trusted recurring Price.';
  end if;
  if v_currency <> v_price_row.currency
     or p_base_line_amount_cents <> v_price_row.unit_amount_cents then
    raise exception 'Invoice recurring-line evidence does not match the trusted Price.';
  end if;

  select invoice_record.* into v_invoice_row
  from public.billing_subscription_invoices as invoice_record
  where invoice_record.stripe_invoice_id = v_invoice
    and invoice_record.stripe_livemode = p_stripe_livemode
    and invoice_record.stripe_account_id = v_account
  for update;
  if v_invoice_row.id is not null and (
       v_invoice_row.store_id <> p_store_id
       or v_invoice_row.subscription_enrollment_id <> v_enrollment.id
       or v_invoice_row.customer_binding_id <> v_customer_binding.id
       or v_invoice_row.stripe_customer_id <> v_customer
       or v_invoice_row.stripe_subscription_id <> v_subscription
       or v_invoice_row.stripe_price_id <> v_price
       or v_invoice_row.billing_reason <> v_reason
       or v_invoice_row.collection_method <> v_collection
       or v_invoice_row.currency <> v_currency
       or v_invoice_row.amount_due_cents <> p_amount_due_cents
       or v_invoice_row.base_line_amount_cents <> p_base_line_amount_cents
       or v_invoice_row.service_period_start is distinct from p_service_period_start
       or v_invoice_row.service_period_end is distinct from p_service_period_end
     ) then
    raise exception 'Stripe Invoice identifier conflicts with existing immutable evidence.';
  end if;

  v_extends := v_collection = 'charge_automatically'
    and v_reason in ('subscription_create', 'subscription_cycle')
    and p_amount_due_cents > 0
    and p_amount_paid_cents > 0
    and p_base_line_amount_cents > 0
    and p_service_period_start is not null
    and p_service_period_end is not null;
  if v_extends and p_service_period_end <> p_service_period_start + make_interval(
    months => v_price_row.recurring_interval_count *
      case when v_price_row.recurring_interval = 'year' then 12 else 1 end
  ) then
    raise exception 'Invoice service period does not match the trusted recurring interval.';
  end if;
  if not v_extends then
    v_ignore_reason := case
      when p_amount_due_cents = 0 and p_amount_paid_cents = 0 then 'zero_dollar_invoice'
      when v_collection <> 'charge_automatically' then 'manual_collection'
      else 'unsupported_billing_reason_or_collection'
    end;
  end if;

  insert into public.billing_provider_events (
    stripe_livemode, stripe_account_id, provider_event_id,
    provider_event_created_at, store_id, event_type, payload_hash,
    applied, ignored_reason, processing_status, processed_at, attempt_count,
    provider_object_type, provider_object_id
  ) values (
    p_stripe_livemode, v_account, v_event_id,
    p_provider_event_created_at, p_store_id, 'invoice.payment_succeeded', v_hash,
    v_extends, v_ignore_reason,
    case when v_extends then 'processed' else 'ignored' end,
    statement_timestamp(), 1, 'invoice', v_invoice
  );

  insert into public.billing_subscription_invoices as invoice_record (
    store_id, subscription_enrollment_id, customer_binding_id,
    stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
    stripe_price_id, stripe_livemode, stripe_account_id, billing_reason,
    collection_method, invoice_status, currency, amount_due_cents,
    amount_paid_cents, amount_remaining_cents, base_line_amount_cents,
    service_period_start, service_period_end, paid_at,
    paid_through_applied_at, grace_eligible, last_provider_event_id,
    last_provider_event_created_at
  ) values (
    p_store_id, v_enrollment.id, v_customer_binding.id,
    v_customer, v_subscription, v_invoice, v_price, p_stripe_livemode,
    v_account, v_reason, v_collection, v_status, v_currency,
    p_amount_due_cents, p_amount_paid_cents, p_amount_remaining_cents,
    p_base_line_amount_cents, p_service_period_start, p_service_period_end,
    p_paid_at, case when v_extends and (v_billing.paid_through_at is null or p_service_period_end > v_billing.paid_through_at)
      then statement_timestamp() end,
    false, v_event_id, p_provider_event_created_at
  )
  on conflict (stripe_invoice_id, stripe_livemode, stripe_account_id) do update set
    invoice_status = 'paid',
    amount_paid_cents = greatest(invoice_record.amount_paid_cents, excluded.amount_paid_cents),
    amount_remaining_cents = 0,
    paid_at = coalesce(invoice_record.paid_at, excluded.paid_at),
    paid_through_applied_at = coalesce(invoice_record.paid_through_applied_at, excluded.paid_through_applied_at),
    grace_eligible = false,
    grace_anchor_at = null,
    grace_ends_at = null,
    failure_code = null,
    last_provider_event_id = case
      when (excluded.last_provider_event_created_at, excluded.last_provider_event_id)
        >= (invoice_record.last_provider_event_created_at, invoice_record.last_provider_event_id)
      then excluded.last_provider_event_id else invoice_record.last_provider_event_id end,
    last_provider_event_created_at = greatest(
      invoice_record.last_provider_event_created_at,
      excluded.last_provider_event_created_at
    )
  returning invoice_record.* into v_invoice_row;

  if not v_extends then
    insert into public.billing_entitlement_events (
      store_id, event_type, provider_event_id, metadata
    ) values (
      p_store_id, 'invoice_event_ignored', v_event_id,
      jsonb_build_object('reason', v_ignore_reason, 'invoice_id', v_invoice)
    );
    return query select false, v_invoice_row.id, v_billing.paid_through_at, v_billing.grace_ends_at;
    return;
  end if;

  v_advanced := v_billing.paid_through_at is null
    or p_service_period_end > v_billing.paid_through_at;
  v_recovered := v_billing.payment_failure_started_at is not null
    or v_billing.payment_action_required_at is not null
    or v_billing.grace_ends_at is not null;

  update public.seller_billing_status as status
  set
    paid_through_at = greatest(status.paid_through_at, p_service_period_end),
    last_paid_stripe_invoice_id = case
      when status.paid_through_at is null or p_service_period_end > status.paid_through_at
      then v_invoice else status.last_paid_stripe_invoice_id end,
    effective_price_started_at = coalesce(status.effective_price_started_at, p_service_period_start),
    payment_failure_started_at = case
      when status.grace_stripe_invoice_id = v_invoice
        or status.grace_provider_event_created_at is null
        or p_provider_event_created_at >= status.grace_provider_event_created_at
      then null else status.payment_failure_started_at end,
    payment_action_required_at = case
      when status.grace_stripe_invoice_id = v_invoice
        or status.grace_provider_event_created_at is null
        or p_provider_event_created_at >= status.grace_provider_event_created_at
      then null else status.payment_action_required_at end,
    grace_ends_at = case
      when status.grace_stripe_invoice_id = v_invoice
        or status.grace_provider_event_created_at is null
        or p_provider_event_created_at >= status.grace_provider_event_created_at
      then null else status.grace_ends_at end,
    grace_stripe_invoice_id = case
      when status.grace_stripe_invoice_id = v_invoice
        or status.grace_provider_event_created_at is null
        or p_provider_event_created_at >= status.grace_provider_event_created_at
      then null else status.grace_stripe_invoice_id end,
    grace_provider_event_id = case
      when status.grace_stripe_invoice_id = v_invoice
        or status.grace_provider_event_created_at is null
        or p_provider_event_created_at >= status.grace_provider_event_created_at
      then null else status.grace_provider_event_id end,
    grace_provider_event_created_at = case
      when status.grace_stripe_invoice_id = v_invoice
        or status.grace_provider_event_created_at is null
        or p_provider_event_created_at >= status.grace_provider_event_created_at
      then null else status.grace_provider_event_created_at end,
    latest_stripe_invoice_id = case
      when status.latest_stripe_invoice_id = v_invoice
        or status.latest_invoice_event_created_at is null
        or (p_provider_event_created_at, v_event_id) >= (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then v_invoice else status.latest_stripe_invoice_id end,
    latest_invoice_status = case
      when status.latest_stripe_invoice_id = v_invoice
        or status.latest_invoice_event_created_at is null
        or (p_provider_event_created_at, v_event_id) >= (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then 'paid' else status.latest_invoice_status end,
    latest_invoice_event_id = case
      when status.latest_stripe_invoice_id = v_invoice
        or status.latest_invoice_event_created_at is null
        or (p_provider_event_created_at, v_event_id) >= (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then v_event_id else status.latest_invoice_event_id end,
    latest_invoice_event_created_at = case
      when status.latest_stripe_invoice_id = v_invoice
        or status.latest_invoice_event_created_at is null
        or (p_provider_event_created_at, v_event_id) >= (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then p_provider_event_created_at else status.latest_invoice_event_created_at end,
    storefront_access_until = greatest(status.storefront_access_until, p_service_period_end),
    updated_at = statement_timestamp()
  where status.store_id = p_store_id
  returning status.* into v_billing;

  insert into public.billing_entitlement_events (
    store_id, event_type, plan_key, billing_cadence, access_until,
    provider_event_id, metadata
  ) values (
    p_store_id, 'invoice_payment_succeeded_recorded', v_price_row.plan_key,
    v_price_row.billing_cadence, v_billing.paid_through_at, v_event_id,
    jsonb_build_object('invoice_id', v_invoice, 'billing_reason', v_reason)
  );
  if v_advanced then
    insert into public.billing_entitlement_events (
      store_id, event_type, plan_key, billing_cadence, access_until,
      provider_event_id, metadata
    ) values (
      p_store_id, 'paid_through_extended', v_price_row.plan_key,
      v_price_row.billing_cadence, v_billing.paid_through_at, v_event_id,
      jsonb_build_object('invoice_id', v_invoice, 'service_period_start', p_service_period_start)
    );
  end if;
  if v_recovered and v_billing.grace_ends_at is null then
    insert into public.billing_entitlement_events (
      store_id, event_type, plan_key, billing_cadence, access_until,
      provider_event_id, metadata
    ) values (
      p_store_id, 'payment_recovered', v_price_row.plan_key,
      v_price_row.billing_cadence, v_billing.paid_through_at, v_event_id,
      jsonb_build_object('invoice_id', v_invoice)
    );
  end if;

  return query select true, v_invoice_row.id, v_billing.paid_through_at, v_billing.grace_ends_at;
end;
$function$;

-- Public wrappers make each trusted event contract explicit while sharing the
-- no-access non-payment implementation above.
create or replace function public.apply_verified_saas_invoice_payment_failed(
  p_provider_event_id text, p_provider_event_created_at timestamptz,
  p_payload_hash text, p_stripe_account_id text, p_stripe_livemode boolean,
  p_store_id uuid, p_stripe_customer_id text, p_stripe_subscription_id text,
  p_stripe_invoice_id text, p_stripe_price_id text, p_billing_reason text,
  p_collection_method text, p_invoice_status text, p_currency text,
  p_amount_due_cents bigint, p_amount_paid_cents bigint,
  p_amount_remaining_cents bigint, p_base_line_amount_cents bigint,
  p_service_period_start timestamptz, p_service_period_end timestamptz,
  p_failure_at timestamptz, p_next_payment_attempt_at timestamptz default null,
  p_failure_code text default null
)
returns table (applied boolean, invoice_id uuid, paid_through_at timestamptz, grace_ends_at timestamptz)
language sql security definer set search_path = pg_catalog, public
as $function$
  select * from public.apply_verified_saas_invoice_nonpayment(
    'payment_failed', p_provider_event_id, p_provider_event_created_at,
    p_payload_hash, p_stripe_account_id, p_stripe_livemode, p_store_id,
    p_stripe_customer_id, p_stripe_subscription_id, p_stripe_invoice_id,
    p_stripe_price_id, p_billing_reason, p_collection_method, p_invoice_status,
    p_currency, p_amount_due_cents, p_amount_paid_cents,
    p_amount_remaining_cents, p_base_line_amount_cents,
    p_service_period_start, p_service_period_end, p_failure_at,
    p_next_payment_attempt_at, p_failure_code
  );
$function$;

create or replace function public.apply_verified_saas_invoice_payment_action_required(
  p_provider_event_id text, p_provider_event_created_at timestamptz,
  p_payload_hash text, p_stripe_account_id text, p_stripe_livemode boolean,
  p_store_id uuid, p_stripe_customer_id text, p_stripe_subscription_id text,
  p_stripe_invoice_id text, p_stripe_price_id text, p_billing_reason text,
  p_collection_method text, p_invoice_status text, p_currency text,
  p_amount_due_cents bigint, p_amount_paid_cents bigint,
  p_amount_remaining_cents bigint, p_base_line_amount_cents bigint,
  p_service_period_start timestamptz, p_service_period_end timestamptz,
  p_action_required_at timestamptz, p_next_payment_attempt_at timestamptz default null,
  p_failure_code text default null
)
returns table (applied boolean, invoice_id uuid, paid_through_at timestamptz, grace_ends_at timestamptz)
language sql security definer set search_path = pg_catalog, public
as $function$
  select * from public.apply_verified_saas_invoice_nonpayment(
    'payment_action_required', p_provider_event_id, p_provider_event_created_at,
    p_payload_hash, p_stripe_account_id, p_stripe_livemode, p_store_id,
    p_stripe_customer_id, p_stripe_subscription_id, p_stripe_invoice_id,
    p_stripe_price_id, p_billing_reason, p_collection_method, p_invoice_status,
    p_currency, p_amount_due_cents, p_amount_paid_cents,
    p_amount_remaining_cents, p_base_line_amount_cents,
    p_service_period_start, p_service_period_end, p_action_required_at,
    p_next_payment_attempt_at, p_failure_code
  );
$function$;

create or replace function public.apply_verified_saas_invoice_finalization_failed(
  p_provider_event_id text, p_provider_event_created_at timestamptz,
  p_payload_hash text, p_stripe_account_id text, p_stripe_livemode boolean,
  p_store_id uuid, p_stripe_customer_id text, p_stripe_subscription_id text,
  p_stripe_invoice_id text, p_stripe_price_id text, p_billing_reason text,
  p_collection_method text, p_invoice_status text, p_currency text,
  p_amount_due_cents bigint, p_amount_paid_cents bigint,
  p_amount_remaining_cents bigint, p_base_line_amount_cents bigint,
  p_service_period_start timestamptz, p_service_period_end timestamptz,
  p_finalization_failed_at timestamptz, p_next_payment_attempt_at timestamptz default null,
  p_failure_code text default null
)
returns table (applied boolean, invoice_id uuid, paid_through_at timestamptz, grace_ends_at timestamptz)
language sql security definer set search_path = pg_catalog, public
as $function$
  select * from public.apply_verified_saas_invoice_nonpayment(
    'finalization_failed', p_provider_event_id, p_provider_event_created_at,
    p_payload_hash, p_stripe_account_id, p_stripe_livemode, p_store_id,
    p_stripe_customer_id, p_stripe_subscription_id, p_stripe_invoice_id,
    p_stripe_price_id, p_billing_reason, p_collection_method, p_invoice_status,
    p_currency, p_amount_due_cents, p_amount_paid_cents,
    p_amount_remaining_cents, p_base_line_amount_cents,
    p_service_period_start, p_service_period_end, p_finalization_failed_at,
    p_next_payment_attempt_at, p_failure_code
  );
$function$;

alter table public.billing_subscription_invoices enable row level security;
revoke all on table public.billing_subscription_invoices
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.billing_subscription_invoices to service_role;

revoke all on function public.apply_verified_saas_invoice_payment_succeeded(
  text, timestamptz, text, text, boolean, uuid, text, text, text, text,
  text, text, text, text, bigint, bigint, bigint, bigint,
  timestamptz, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.apply_verified_saas_invoice_payment_succeeded(
  text, timestamptz, text, text, boolean, uuid, text, text, text, text,
  text, text, text, text, bigint, bigint, bigint, bigint,
  timestamptz, timestamptz, timestamptz
) to service_role;

revoke all on function public.apply_verified_saas_invoice_payment_failed(
  text, timestamptz, text, text, boolean, uuid, text, text, text, text,
  text, text, text, text, bigint, bigint, bigint, bigint,
  timestamptz, timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_verified_saas_invoice_payment_failed(
  text, timestamptz, text, text, boolean, uuid, text, text, text, text,
  text, text, text, text, bigint, bigint, bigint, bigint,
  timestamptz, timestamptz, timestamptz, timestamptz, text
) to service_role;

revoke all on function public.apply_verified_saas_invoice_payment_action_required(
  text, timestamptz, text, text, boolean, uuid, text, text, text, text,
  text, text, text, text, bigint, bigint, bigint, bigint,
  timestamptz, timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_verified_saas_invoice_payment_action_required(
  text, timestamptz, text, text, boolean, uuid, text, text, text, text,
  text, text, text, text, bigint, bigint, bigint, bigint,
  timestamptz, timestamptz, timestamptz, timestamptz, text
) to service_role;

revoke all on function public.apply_verified_saas_invoice_finalization_failed(
  text, timestamptz, text, text, boolean, uuid, text, text, text, text,
  text, text, text, text, bigint, bigint, bigint, bigint,
  timestamptz, timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_verified_saas_invoice_finalization_failed(
  text, timestamptz, text, text, boolean, uuid, text, text, text, text,
  text, text, text, text, bigint, bigint, bigint, bigint,
  timestamptz, timestamptz, timestamptz, timestamptz, text
) to service_role;

-- Even possession of the service key must not turn a generic table mutation
-- into invoice authority. Existing security-definer billing functions keep
-- owner-level access; service clients retain direct access only to the older,
-- non-invoice columns they already used.
revoke insert, update on table public.seller_billing_status from service_role;
do $grant_non_invoice_columns$
declare
  v_insert_columns text;
  v_update_columns text;
begin
  select string_agg(format('%I', columns.column_name), ', ' order by columns.ordinal_position)
  into v_insert_columns
  from information_schema.columns
  where columns.table_schema = 'public'
    and columns.table_name = 'seller_billing_status'
    and columns.column_name not in (
      'paid_through_at', 'grace_ends_at', 'payment_failure_started_at',
      'payment_action_required_at', 'effective_price_started_at',
      'latest_stripe_invoice_id', 'latest_invoice_status',
      'last_paid_stripe_invoice_id', 'latest_invoice_event_id',
      'latest_invoice_event_created_at', 'grace_stripe_invoice_id',
      'grace_provider_event_id', 'grace_provider_event_created_at'
    );

  select string_agg(format('%I', columns.column_name), ', ' order by columns.ordinal_position)
  into v_update_columns
  from information_schema.columns
  where columns.table_schema = 'public'
    and columns.table_name = 'seller_billing_status'
    and columns.column_name not in (
      'id', 'store_id', 'created_at',
      'paid_through_at', 'grace_ends_at', 'payment_failure_started_at',
      'payment_action_required_at', 'effective_price_started_at',
      'latest_stripe_invoice_id', 'latest_invoice_status',
      'last_paid_stripe_invoice_id', 'latest_invoice_event_id',
      'latest_invoice_event_created_at', 'grace_stripe_invoice_id',
      'grace_provider_event_id', 'grace_provider_event_created_at'
    );

  execute format(
    'grant insert (%s) on table public.seller_billing_status to service_role',
    v_insert_columns
  );
  execute format(
    'grant update (%s) on table public.seller_billing_status to service_role',
    v_update_columns
  );
end;
$grant_non_invoice_columns$;

commit;
