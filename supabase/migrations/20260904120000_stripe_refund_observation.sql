-- Observe Stripe Connect refunds without canceling orders or changing inventory.

begin;

create or replace function public.record_stripe_connect_refund_event(
  p_provider_event_id text,
  p_event_type text,
  p_provider_refund_id text,
  p_provider_status text,
  p_refund_amount_cents bigint,
  p_currency text,
  p_stripe_payment_intent_id text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_stripe_metadata jsonb default '{}'::jsonb,
  p_request_idempotency_key text default null,
  p_refund_created_at timestamptz default null
)
returns table (
  was_duplicate boolean,
  refund_id uuid,
  order_id uuid,
  origin_classification text,
  payment_status text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_event public.payment_provider_events%rowtype;
  v_session public.stripe_checkout_sessions%rowtype;
  v_order public.orders%rowtype;
  v_refund public.order_refunds%rowtype;
  v_candidate public.order_refunds%rowtype;
  v_refund_status text;
  v_currency text := upper(nullif(trim(p_currency), ''));
  v_action_id uuid;
  v_is_flockfront boolean := false;
  v_has_origin_event boolean := false;
  v_request_key_hash text;
  v_succeeded_refund_total numeric(10, 2);
  v_payment_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authorized to record Stripe Connect refund events.';
  end if;

  if p_event_type is null
    or p_event_type not in ('refund.created', 'refund.updated', 'refund.failed') then
    raise exception 'Unsupported Stripe refund event type.';
  end if;
  if nullif(trim(p_provider_event_id), '') is null
    or nullif(trim(p_provider_refund_id), '') is null
    or nullif(trim(p_stripe_payment_intent_id), '') is null
    or nullif(trim(p_stripe_account_id), '') is null then
    raise exception 'Stripe refund event identifiers are required.';
  end if;
  if p_provider_status is null
    or p_provider_status not in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') then
    raise exception 'Unsupported Stripe refund status.';
  end if;
  if p_refund_amount_cents is null
    or p_refund_amount_cents <= 0
    or p_stripe_livemode is null
    or v_currency is null
    or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Stripe refund amount or currency is invalid.';
  end if;
  if p_stripe_metadata is null or jsonb_typeof(p_stripe_metadata) <> 'object' then
    raise exception 'Stripe refund metadata must be an object.';
  end if;

  select sessions.*
  into v_session
  from public.stripe_checkout_sessions as sessions
  where sessions.stripe_payment_intent_id = p_stripe_payment_intent_id
    and sessions.metadata ->> 'schema_version' = 'ff_connect_checkout_v1'
  for update;

  if v_session.id is null
    or v_session.metadata ->> 'stripe_account_id' <> p_stripe_account_id
    or v_session.metadata ->> 'stripe_livemode' <> p_stripe_livemode::text
    or upper(v_session.currency) <> v_currency then
    raise exception 'Stripe refund does not match a trusted FlockFront Checkout payment.';
  end if;

  select orders.*
  into v_order
  from public.orders as orders
  where orders.id = v_session.order_id
    and orders.store_id = v_session.store_id
  for update;

  if v_order.id is null
    or v_order.payment_method <> 'stripe_checkout'
    or v_order.payment_provider <> 'stripe'
    or upper(v_order.currency_code) <> v_currency
    or round(v_order.total_amount * 100)::bigint <> v_session.amount_total_cents
    or p_refund_amount_cents > v_session.amount_total_cents then
    raise exception 'Stripe refund order binding is invalid.';
  end if;

  select events.*
  into v_event
  from public.payment_provider_events as events
  where events.provider = 'stripe'
    and events.provider_event_id = p_provider_event_id
  for update;

  if v_event.id is not null then
    select refunds.*
    into v_refund
    from public.order_refunds as refunds
    where refunds.id = v_event.related_refund_id;

    return query select
      true,
      v_event.related_refund_id,
      v_event.related_order_id,
      coalesce(v_event.payload_summary ->> 'origin_classification', 'external_unproven'),
      v_order.payment_status;
    return;
  end if;

  insert into public.payment_provider_events (
    provider,
    provider_event_id,
    event_type,
    event_status,
    related_store_id,
    related_order_id,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    provider_refund_id,
    payload_summary,
    processing_started_at
  )
  values (
    'stripe',
    p_provider_event_id,
    p_event_type,
    'processing',
    v_order.store_id,
    v_order.id,
    v_session.stripe_checkout_session_id,
    p_stripe_payment_intent_id,
    p_provider_refund_id,
    jsonb_build_object(
      'provider_status', p_provider_status,
      'refund_amount_cents', p_refund_amount_cents,
      'currency', lower(v_currency),
      'origin_classification', 'external_unproven'
    ),
    now()
  )
  on conflict (provider, provider_event_id) do nothing
  returning * into v_event;

  if v_event.id is null then
    select events.*
    into v_event
    from public.payment_provider_events as events
    where events.provider = 'stripe'
      and events.provider_event_id = p_provider_event_id;

    return query select
      true,
      v_event.related_refund_id,
      v_event.related_order_id,
      coalesce(v_event.payload_summary ->> 'origin_classification', 'external_unproven'),
      v_order.payment_status;
    return;
  end if;

  v_refund_status := case p_provider_status
    when 'succeeded' then 'succeeded'
    when 'failed' then 'failed'
    when 'canceled' then 'canceled'
    else 'pending'
  end;

  select refunds.*
  into v_refund
  from public.order_refunds as refunds
  where refunds.provider_refund_id = p_provider_refund_id
  for update;

  if p_stripe_metadata ->> 'ff_refund_action_id'
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_action_id := (p_stripe_metadata ->> 'ff_refund_action_id')::uuid;
  end if;

  if v_action_id is not null then
    select refunds.*
    into v_candidate
    from public.order_refunds as refunds
    where refunds.id = v_action_id
    for update;
  elsif v_refund.id is not null then
    v_candidate := v_refund;
  end if;

  if v_candidate.id is not null then
    select exists (
      select 1
      from public.payment_provider_events as proof_events
      where proof_events.related_refund_id = v_candidate.id
        and proof_events.provider = 'stripe'
        and proof_events.event_type = 'refund.created'
        and proof_events.event_status = 'processed'
        and proof_events.provider_refund_id = p_provider_refund_id
        and proof_events.stripe_payment_intent_id = p_stripe_payment_intent_id
        and proof_events.payload_summary ->> 'origin_proof' = 'stripe_event_request_idempotency'
    ) into v_has_origin_event;

    v_is_flockfront :=
      v_candidate.refund_method = 'stripe'
      and v_candidate.store_id = v_order.store_id
      and v_candidate.order_id = v_order.id
      and v_candidate.currency_code = v_currency
      and round(v_candidate.refund_amount * 100)::bigint = p_refund_amount_cents
      and v_candidate.stripe_checkout_session_id = v_session.stripe_checkout_session_id
      and v_candidate.stripe_payment_intent_id = p_stripe_payment_intent_id
      and v_candidate.stripe_account_id = p_stripe_account_id
      and v_candidate.stripe_livemode = p_stripe_livemode
      and v_candidate.metadata ->> 'schema_version' = 'ff_connect_cancellation_v1'
      and v_candidate.metadata ->> 'workflow_type' = 'paid_order_cancellation'
      and p_stripe_metadata ->> 'ff_cancellation_schema_version' = 'ff_connect_cancellation_v1'
      and p_stripe_metadata ->> 'ff_refund_action_id' = v_candidate.id::text
      and p_stripe_metadata ->> 'ff_order_id' = v_candidate.order_id::text
      and p_stripe_metadata ->> 'ff_request_hash' = v_candidate.request_hash
      and v_candidate.created_at <= coalesce(p_refund_created_at, now()) + interval '1 second'
      and (v_candidate.provider_refund_id is null or v_candidate.provider_refund_id = p_provider_refund_id)
      and (
        v_refund.id is null
        or v_refund.id = v_candidate.id
        or v_refund.metadata ->> 'observation_schema_version' = 'ff_connect_refund_observation_v1'
      )
      and (
        v_has_origin_event
        or (
          p_event_type = 'refund.created'
          and nullif(p_request_idempotency_key, '') is not null
          and p_request_idempotency_key = v_candidate.idempotency_key
        )
      );
  end if;

  if v_is_flockfront then
    v_request_key_hash := encode(
      extensions.digest(v_candidate.idempotency_key, 'sha256'),
      'hex'
    );

    if v_refund.id is not null and v_refund.id <> v_candidate.id then
      update public.payment_provider_events as prior_events
      set related_refund_id = v_candidate.id
      where prior_events.related_refund_id = v_refund.id;

      delete from public.order_refunds as observed_refunds
      where observed_refunds.id = v_refund.id
        and observed_refunds.metadata ->> 'observation_schema_version' =
          'ff_connect_refund_observation_v1';
    end if;

    update public.order_refunds as refunds
    set
      refund_status = v_refund_status,
      provider_refund_id = p_provider_refund_id,
      provider_status = p_provider_status,
      payment_provider_event_id = v_event.id,
      processed_at = now(),
      metadata = refunds.metadata || jsonb_build_object(
        'origin_classification', 'flockfront',
        'origin_proof', 'stripe_event_request_idempotency'
      )
    where refunds.id = v_candidate.id
    returning * into v_refund;
  elsif v_refund.id is not null then
    update public.order_refunds as refunds
    set
      refund_status = v_refund_status,
      provider_status = p_provider_status,
      payment_provider_event_id = v_event.id,
      processed_at = now(),
      metadata = refunds.metadata || jsonb_build_object(
        'origin_classification', 'external_unproven'
      )
    where refunds.id = v_refund.id
    returning * into v_refund;
  else
    insert into public.order_refunds (
      store_id,
      order_id,
      idempotency_key,
      request_hash,
      refund_amount,
      refund_method,
      refund_status,
      provider_refund_id,
      provider_status,
      metadata,
      created_by_user_id,
      processed_at,
      currency_code,
      payment_provider_event_id,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      stripe_account_id,
      stripe_livemode
    )
    values (
      v_order.store_id,
      v_order.id,
      'stripe-refund-observation:' || p_provider_refund_id,
      encode(extensions.digest(
        concat_ws(':', p_provider_refund_id, v_order.id::text, p_refund_amount_cents::text, v_currency),
        'sha256'
      ), 'hex'),
      (p_refund_amount_cents::numeric / 100)::numeric(10, 2),
      'stripe',
      v_refund_status,
      p_provider_refund_id,
      p_provider_status,
      jsonb_build_object(
        'observation_schema_version', 'ff_connect_refund_observation_v1',
        'origin_classification', 'external_unproven'
      ),
      null,
      now(),
      v_currency,
      v_event.id,
      v_session.stripe_checkout_session_id,
      p_stripe_payment_intent_id,
      p_stripe_account_id,
      p_stripe_livemode
    )
    returning * into v_refund;
  end if;

  select coalesce(sum(refunds.refund_amount), 0)::numeric(10, 2)
  into v_succeeded_refund_total
  from public.order_refunds as refunds
  where refunds.order_id = v_order.id
    and refunds.store_id = v_order.store_id
    and refunds.refund_method = 'stripe'
    and refunds.refund_status = 'succeeded';

  v_payment_status := case
    when v_succeeded_refund_total <= 0 then 'paid'
    when v_succeeded_refund_total >= v_order.total_amount then 'refunded'
    else 'partially_refunded'
  end;

  update public.orders as orders
  set
    payment_status = v_payment_status,
    provider_payment_status = v_payment_status,
    payment_provider_status_updated_at = now()
  where orders.id = v_order.id;

  update public.payment_provider_events as events
  set
    event_status = 'processed',
    related_refund_id = v_refund.id,
    payload_summary = events.payload_summary || jsonb_build_object(
      'origin_classification', case when v_is_flockfront then 'flockfront' else 'external_unproven' end,
      'origin_proof', case when v_is_flockfront then 'stripe_event_request_idempotency' else null end,
      'request_idempotency_key_sha256', case when v_is_flockfront then v_request_key_hash else null end
    ),
    processed_at = now(),
    failed_at = null,
    last_error = null
  where events.id = v_event.id;

  return query select
    false,
    v_refund.id,
    v_order.id,
    case when v_is_flockfront then 'flockfront' else 'external_unproven' end,
    v_payment_status;
end;
$$;

comment on function public.record_stripe_connect_refund_event(
  text, text, text, text, bigint, text, text, text, boolean, jsonb, text, timestamptz
) is
'Service-only Stripe Connect refund observation. It records provider payment truth and origin proof but never cancels orders or changes inventory.';

revoke all on function public.record_stripe_connect_refund_event(
  text, text, text, text, bigint, text, text, text, boolean, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_stripe_connect_refund_event(
  text, text, text, text, bigint, text, text, text, boolean, jsonb, text, timestamptz
) to service_role;

commit;
