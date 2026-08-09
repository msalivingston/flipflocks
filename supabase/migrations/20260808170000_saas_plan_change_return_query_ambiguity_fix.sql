-- Qualify plan-change return-query columns that collide with RETURNS TABLE outputs.

begin;

create or replace function public.apply_verified_saas_plan_change_invoice_event(
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
    (
      select billing_status.paid_through_at
      from public.seller_billing_status as billing_status
      where billing_status.store_id = v_enrollment.store_id
    ),
    (
      select billing_status.grace_ends_at
      from public.seller_billing_status as billing_status
      where billing_status.store_id = v_enrollment.store_id
    ),
    coalesce(
      (
        select onboarding_state.billing_complete
        from public.seller_onboarding_state as onboarding_state
        where onboarding_state.store_id = v_enrollment.store_id
      ),
      false
    );
end;
$function$;

create or replace function public.apply_verified_saas_plan_change_subscription_event(
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
    (
      select billing_status.paid_through_at
      from public.seller_billing_status as billing_status
      where billing_status.store_id = v_enrollment.store_id
    ),
    (
      select billing_status.grace_ends_at
      from public.seller_billing_status as billing_status
      where billing_status.store_id = v_enrollment.store_id
    );
end;
$function$;

commit;

