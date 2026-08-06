-- Permit Stripe's positive prorated current-Price line for the existing,
-- strictly verified early trial-to-paid subscription_update path. Catalog
-- Price authority remains exact; only invoice-line amount equality is relaxed.

begin;

do $migration$
declare
  v_definition text;
  v_old constant text :=
    'or v_catalog.unit_amount_cents is distinct from p_recurring_line_amount_cents';
  v_new constant text := $replacement$
or (
       v_catalog.unit_amount_cents is distinct from p_recurring_line_amount_cents
       and not (
         v_reason = 'subscription_update'
         and v_enrollment.is_current
         and v_enrollment.provider_status = 'active'
         and v_billing.subscription_status = 'active'
         and v_billing.paid_through_at is null
         and v_billing.last_paid_stripe_invoice_id is null
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
       )
     )
$replacement$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid)
  into strict v_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname =
      'apply_verified_saas_invoice_lifecycle_internal';

  if pg_catalog.strpos(v_definition, v_old) = 0
     or pg_catalog.strpos(
       pg_catalog.substr(
         v_definition,
         pg_catalog.strpos(v_definition, v_old) + 1
       ),
       v_old
     ) <> 0 then
    raise exception using errcode = '55000',
      message = 'SAAS_PRORATED_TRIAL_CONVERSION_CONTRACT_DRIFT';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$migration$;

commit;
