-- Accept Stripe's subscription_update billing reason only for a strictly
-- verified first conversion from an established SaaS trial to paid service.
-- Existing subscription_create and subscription_cycle authority is unchanged.

begin;

do $migration$
declare
  v_definition text;
  v_old text := $old$
  v_extends := v_outcome = 'payment_succeeded'
    and v_collection = 'charge_automatically'
    and v_reason in ('subscription_create', 'subscription_cycle')
    and p_amount_due_cents > 0
$old$;
  v_new text := $new$
  v_extends := v_outcome = 'payment_succeeded'
    and v_collection = 'charge_automatically'
    and (
      v_reason in ('subscription_create', 'subscription_cycle')
      or (
        v_reason = 'subscription_update'
        and v_enrollment.is_current
        and v_enrollment.provider_status = 'active'
        and v_billing.subscription_status = 'active'
        and v_billing.paid_through_at is null
        and v_billing.last_paid_stripe_invoice_id is null
        and v_invoice.paid_through_applied_at is null
        and p_amount_paid_cents = p_amount_due_cents
        and p_amount_due_cents >= p_recurring_line_amount_cents
        and p_service_period_start = v_billing.current_period_start
        and p_service_period_end = v_billing.current_period_end
        and exists (
          select 1
          from public.billing_trial_claims as conversion_claim
          where conversion_claim.store_id = v_enrollment.store_id
            and conversion_claim.subscription_enrollment_id = v_enrollment.id
            and conversion_claim.trial_started_at = v_enrollment.trial_started_at
            and conversion_claim.trial_ends_at = v_enrollment.trial_ends_at
            and p_service_period_start >= conversion_claim.trial_started_at
            and p_service_period_start <= conversion_claim.trial_ends_at
        )
        and not exists (
          select 1
          from public.billing_subscription_invoices as applied_invoice
          where applied_invoice.store_id = v_enrollment.store_id
            and applied_invoice.subscription_enrollment_id = v_enrollment.id
            and applied_invoice.paid_through_applied_at is not null
        )
      )
    )
    and p_amount_due_cents > 0
$new$;
begin
  select pg_get_functiondef(procedure.oid)
  into strict v_definition
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'apply_verified_saas_invoice_lifecycle_internal';

  if position(v_old in v_definition) = 0 then
    raise exception 'expected invoice authority predicate was not found';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;

-- The canonical resolver must recognize the same strictly-applied first
-- conversion invoice. A subscription_update row without paid-through evidence
-- remains non-authoritative.
do $migration$
declare
  v_definition text;
  v_old text := $old$
           and v_paid_invoice.billing_reason in ('subscription_create', 'subscription_cycle')
           and v_paid_invoice.invoice_status = 'paid'
$old$;
  v_new text := $new$
           and (
             v_paid_invoice.billing_reason in ('subscription_create', 'subscription_cycle')
             or (
               v_paid_invoice.billing_reason = 'subscription_update'
               and v_enrollment.is_current
               and v_enrollment.provider_status = 'active'
               and v_billing.subscription_status = 'active'
               and v_trial.store_id is not null
               and v_trial.subscription_enrollment_id = v_enrollment.id
               and v_trial.trial_started_at = v_enrollment.trial_started_at
               and v_trial.trial_ends_at = v_enrollment.trial_ends_at
               and v_paid_invoice.service_period_start = v_billing.current_period_start
               and v_paid_invoice.service_period_end = v_billing.current_period_end
               and v_paid_invoice.service_period_start >= v_trial.trial_started_at
               and v_paid_invoice.service_period_start <= v_trial.trial_ends_at
               and v_paid_invoice.amount_paid_cents = v_paid_invoice.amount_due_cents
               and v_paid_invoice.amount_due_cents >= v_paid_invoice.base_line_amount_cents
               and not exists (
                 select 1
                 from public.billing_subscription_invoices as other_paid_invoice
                 where other_paid_invoice.store_id = v_enrollment.store_id
                   and other_paid_invoice.subscription_enrollment_id = v_enrollment.id
                   and other_paid_invoice.id <> v_paid_invoice.id
                   and other_paid_invoice.paid_through_applied_at is not null
               )
             )
           )
           and v_paid_invoice.invoice_status = 'paid'
$new$;
begin
  select pg_get_functiondef(procedure.oid)
  into strict v_definition
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'resolve_store_entitlement'
    and pg_get_function_identity_arguments(procedure.oid) = 'p_store_id uuid';

  if position(v_old in v_definition) = 0 then
    raise exception 'expected paid entitlement predicate was not found';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;

-- Repair only previously recorded, provider-verified invoices that independently
-- satisfy the new first-conversion predicate. No tenant or Stripe identifier is
-- hard-coded, and no provider event is reopened or replayed.
create temporary table saas_early_trial_conversion_repairs
on commit drop
as
select
  invoice.id as invoice_id,
  invoice.store_id,
  invoice.subscription_enrollment_id,
  invoice.stripe_invoice_id,
  invoice.stripe_price_id,
  invoice.service_period_start,
  invoice.service_period_end,
  invoice.last_provider_event_id,
  invoice.last_provider_event_created_at,
  catalog.plan_key,
  catalog.billing_cadence
from public.billing_subscription_invoices as invoice
join public.billing_subscription_enrollments as enrollment
  on enrollment.id = invoice.subscription_enrollment_id
 and enrollment.store_id = invoice.store_id
 and enrollment.stripe_subscription_id = invoice.stripe_subscription_id
 and enrollment.initial_stripe_price_id = invoice.stripe_price_id
 and enrollment.stripe_account_id = invoice.stripe_account_id
 and enrollment.stripe_livemode = invoice.stripe_livemode
join public.billing_customer_bindings as binding
  on binding.id = invoice.customer_binding_id
 and binding.store_id = invoice.store_id
 and binding.stripe_customer_id = invoice.stripe_customer_id
 and binding.stripe_account_id = invoice.stripe_account_id
 and binding.stripe_livemode = invoice.stripe_livemode
join public.billing_trial_claims as claim
  on claim.store_id = invoice.store_id
 and claim.subscription_enrollment_id = enrollment.id
 and claim.trial_started_at = enrollment.trial_started_at
 and claim.trial_ends_at = enrollment.trial_ends_at
join public.seller_billing_status as status
  on status.store_id = invoice.store_id
 and status.current_subscription_enrollment_id = enrollment.id
 and status.stripe_customer_id = invoice.stripe_customer_id
 and status.stripe_subscription_id = invoice.stripe_subscription_id
 and status.stripe_price_id = invoice.stripe_price_id
 and status.stripe_account_id = invoice.stripe_account_id
 and status.stripe_livemode = invoice.stripe_livemode
join public.billing_provider_price_catalog as catalog
  on catalog.stripe_price_id = invoice.stripe_price_id
 and catalog.stripe_account_id = invoice.stripe_account_id
 and catalog.stripe_livemode = invoice.stripe_livemode
 and catalog.plan_key = status.plan_key
 and catalog.billing_cadence = status.billing_plan
join public.billing_provider_events as provider_event
  on provider_event.provider_event_id = invoice.last_provider_event_id
 and provider_event.stripe_account_id = invoice.stripe_account_id
 and provider_event.stripe_livemode = invoice.stripe_livemode
 and provider_event.store_id = invoice.store_id
 and provider_event.event_type = 'invoice.payment_succeeded'
 and provider_event.provider_object_type = 'invoice'
 and provider_event.provider_object_id = invoice.stripe_invoice_id
where invoice.billing_reason = 'subscription_update'
  and invoice.collection_method = 'charge_automatically'
  and invoice.invoice_status = 'paid'
  and invoice.amount_due_cents > 0
  and invoice.amount_paid_cents = invoice.amount_due_cents
  and invoice.amount_remaining_cents = 0
  and invoice.base_line_amount_cents = catalog.unit_amount_cents
  and invoice.amount_due_cents >= invoice.base_line_amount_cents
  and invoice.currency = catalog.currency
  and invoice.service_period_start = status.current_period_start
  and invoice.service_period_end = status.current_period_end
  and invoice.service_period_start >= claim.trial_started_at
  and invoice.service_period_start <= claim.trial_ends_at
  and invoice.service_period_end = invoice.service_period_start
    + pg_catalog.make_interval(
        months => catalog.recurring_interval_count
          * case when catalog.recurring_interval = 'year' then 12 else 1 end
      )
  and invoice.paid_at is not null
  and invoice.paid_through_applied_at is null
  and enrollment.is_current
  and enrollment.provider_status = 'active'
  and status.billing_state_authority = 'stripe'
  and status.subscription_status = 'active'
  and status.paid_through_at is null
  and status.last_paid_stripe_invoice_id is null
  and catalog.is_active
  and catalog.is_verified
  and catalog.stripe_price_active
  and catalog.stripe_product_active
  and provider_event.processing_status = 'processed'
  and provider_event.applied
  and provider_event.last_error_code is null
  and not exists (
    select 1
    from public.billing_subscription_invoices as applied_invoice
    where applied_invoice.store_id = invoice.store_id
      and applied_invoice.subscription_enrollment_id = enrollment.id
      and applied_invoice.id <> invoice.id
      and applied_invoice.paid_through_applied_at is not null
  );

update public.billing_subscription_invoices as invoice
set paid_through_applied_at = statement_timestamp(),
    updated_at = statement_timestamp()
from saas_early_trial_conversion_repairs as repair
where invoice.id = repair.invoice_id
  and invoice.paid_through_applied_at is null;

update public.seller_billing_status as status
set paid_through_at = repair.service_period_end,
    last_paid_stripe_invoice_id = repair.stripe_invoice_id,
    effective_price_started_at = coalesce(
      status.effective_price_started_at,
      repair.service_period_start
    ),
    latest_stripe_invoice_id = case
      when status.latest_invoice_event_created_at is null
        or (repair.last_provider_event_created_at, repair.last_provider_event_id) >=
          (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then repair.stripe_invoice_id else status.latest_stripe_invoice_id end,
    latest_invoice_status = case
      when status.latest_invoice_event_created_at is null
        or (repair.last_provider_event_created_at, repair.last_provider_event_id) >=
          (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then 'paid' else status.latest_invoice_status end,
    latest_invoice_event_id = case
      when status.latest_invoice_event_created_at is null
        or (repair.last_provider_event_created_at, repair.last_provider_event_id) >=
          (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then repair.last_provider_event_id else status.latest_invoice_event_id end,
    latest_invoice_event_created_at = case
      when status.latest_invoice_event_created_at is null
        or (repair.last_provider_event_created_at, repair.last_provider_event_id) >=
          (status.latest_invoice_event_created_at, status.latest_invoice_event_id)
      then repair.last_provider_event_created_at
      else status.latest_invoice_event_created_at end,
    storefront_access_until = greatest(
      status.storefront_access_until,
      repair.service_period_end
    ),
    updated_at = statement_timestamp()
from saas_early_trial_conversion_repairs as repair
where status.store_id = repair.store_id
  and status.current_subscription_enrollment_id = repair.subscription_enrollment_id
  and status.paid_through_at is null
  and status.last_paid_stripe_invoice_id is null
  and exists (
    select 1
    from public.billing_subscription_invoices as invoice
    where invoice.id = repair.invoice_id
      and invoice.paid_through_applied_at is not null
  );

insert into public.billing_entitlement_events (
  store_id, event_type, plan_key, billing_cadence, access_until,
  provider_event_id, metadata
)
select
  repair.store_id,
  'paid_through_extended',
  repair.plan_key,
  repair.billing_cadence,
  repair.service_period_end,
  repair.last_provider_event_id,
  pg_catalog.jsonb_build_object(
    'invoice_id', repair.stripe_invoice_id,
    'billing_reason', 'subscription_update',
    'migration_reconciled', true
  )
from saas_early_trial_conversion_repairs as repair
where exists (
  select 1
  from public.seller_billing_status as status
  where status.store_id = repair.store_id
    and status.paid_through_at = repair.service_period_end
    and status.last_paid_stripe_invoice_id = repair.stripe_invoice_id
)
and not exists (
  select 1
  from public.billing_entitlement_events as event_row
  where event_row.store_id = repair.store_id
    and event_row.event_type = 'paid_through_extended'
    and event_row.provider_event_id = repair.last_provider_event_id
);

commit;
