begin;

-- A terminal Stripe result may be established either by a signed provider
-- event or by the trusted server process that received the Refund directly
-- from Stripe. Ordinary clients cannot write order_refunds.
alter table public.order_refunds
drop constraint if exists order_refunds_stripe_binding_check;

alter table public.order_refunds
add constraint order_refunds_stripe_binding_check
check (
  refund_method <> 'stripe'
  or (
    currency_code is not null
    and nullif(trim(stripe_checkout_session_id), '') is not null
    and nullif(trim(stripe_payment_intent_id), '') is not null
    and nullif(trim(stripe_account_id), '') is not null
    and stripe_livemode is not null
    and (
      refund_status = 'pending'
      or (
        refund_status in ('succeeded', 'failed', 'canceled')
        and nullif(trim(provider_refund_id), '') is not null
        and nullif(trim(provider_status), '') is not null
        and (
          payment_provider_event_id is not null
          or metadata ->> 'origin_proof' = 'stripe_api_response'
        )
      )
    )
  )
) not valid;

create or replace function public.prepare_stripe_full_cancellation(
  p_order_id uuid,
  p_actor_user_id uuid,
  p_canceled_reason text default null,
  p_send_buyer_notification boolean default false
)
returns table (
  refund_action_id uuid,
  idempotency_key text,
  request_hash text,
  refund_amount_cents bigint,
  currency text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_account_id text,
  stripe_livemode boolean,
  stripe_metadata jsonb,
  provider_refund_id text,
  refund_status text,
  provider_status text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_session public.stripe_checkout_sessions%rowtype;
  v_action public.order_refunds%rowtype;
  v_key text;
  v_hash text;
  v_currency text;
  v_amount_cents bigint;
  v_lines jsonb;
  v_reason text := nullif(trim(p_canceled_reason), '');
begin
  if p_order_id is null or p_actor_user_id is null then
    raise exception 'Order is not available.';
  end if;

  select orders.* into v_order
  from public.orders as orders
  join public.stores as stores
    on stores.id = orders.store_id
   and stores.owner_user_id = p_actor_user_id
  where orders.id = p_order_id
  for update of orders;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;
  if v_order.order_status not in ('pending', 'open') or v_order.canceled_at is not null then
    raise exception 'Only an active order can be canceled.';
  end if;
  if v_order.payment_method <> 'stripe_checkout'
     or v_order.payment_provider <> 'stripe'
     or v_order.payment_status <> 'paid' then
    raise exception 'Order is not an eligible paid Stripe order.';
  end if;

  select sessions.* into v_session
  from public.stripe_checkout_sessions as sessions
  where sessions.store_id = v_order.store_id
    and sessions.order_id = v_order.id
    and sessions.metadata ->> 'schema_version' = 'ff_connect_checkout_v1'
  for update;

  if v_session.id is null
     or nullif(v_session.stripe_payment_intent_id, '') is null
     or nullif(v_session.metadata ->> 'stripe_account_id', '') is null
     or v_session.metadata -> 'stripe_livemode' is null then
    raise exception 'Order does not have a verified FlockFront Stripe payment.';
  end if;

  perform 1 from public.order_items as items
  where items.order_id = v_order.id and items.store_id = v_order.store_id
  order by items.id
  for update;

  if not exists (
    select 1 from public.order_items as items
    where items.order_id = v_order.id and items.store_id = v_order.store_id
  ) then
    raise exception 'Order has no cancellable items.';
  end if;
  if exists (
    select 1 from public.order_items as items
    where items.order_id = v_order.id
      and items.store_id = v_order.store_id
      and items.fulfilled_quantity > 0
  ) then
    raise exception 'Orders with fulfilled items require support.';
  end if;
  if exists (
    select 1 from public.order_items as items
    where items.order_id = v_order.id
      and items.store_id = v_order.store_id
      and items.canceled_quantity > 0
  ) then
    raise exception 'Orders with previously canceled quantities require support.';
  end if;
  if exists (
    select 1 from public.order_items as items
    where items.order_id = v_order.id
      and items.store_id = v_order.store_id
      and items.order_item_source <> 'custom'
      and items.inventory_debited_quantity is null
  ) then
    raise exception 'Order inventory requires operational reconciliation before cancellation.';
  end if;

  v_currency := upper(v_session.currency);
  v_amount_cents := v_session.amount_total_cents;
  if v_currency <> upper(v_order.currency_code)
     or v_amount_cents <> round(v_order.total_amount * 100)::bigint then
    raise exception 'Order and Stripe payment totals do not match.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'order_item_id', items.id,
      'quantity', items.quantity,
      'remaining_active_quantity', items.quantity - items.fulfilled_quantity - items.canceled_quantity,
      'eligible_restoration_quantity', case
        when items.order_item_source = 'custom' then 0
        else greatest(
          items.inventory_debited_quantity - items.fulfilled_quantity - items.restored_quantity,
          0
        )
      end
    ) order by items.id
  ), '[]'::jsonb)
  into v_lines
  from public.order_items as items
  where items.order_id = v_order.id and items.store_id = v_order.store_id;

  v_key := 'ff-full-cancel-v1:' || encode(extensions.digest(
    concat_ws(':', v_order.id::text, v_session.stripe_payment_intent_id, v_amount_cents::text, v_currency),
    'sha256'
  ), 'hex');
  v_hash := encode(extensions.digest(
    jsonb_build_object(
      'schema_version', 'ff_connect_cancellation_v1',
      'cancellation_type', 'full',
      'order_id', v_order.id,
      'store_id', v_order.store_id,
      'stripe_checkout_session_id', v_session.stripe_checkout_session_id,
      'stripe_payment_intent_id', v_session.stripe_payment_intent_id,
      'stripe_account_id', v_session.metadata ->> 'stripe_account_id',
      'stripe_livemode', (v_session.metadata ->> 'stripe_livemode')::boolean,
      'refund_amount_cents', v_amount_cents,
      'currency', lower(v_currency),
      'remaining_active_quantities', v_lines,
      'restoration_intent', 'all_eligible_remaining_inventory'
    )::text,
    'sha256'
  ), 'hex');

  select refunds.* into v_action
  from public.order_refunds as refunds
  where refunds.store_id = v_order.store_id
    and refunds.order_id = v_order.id
    and refunds.idempotency_key = v_key
  for update;

  if v_action.id is null then
    insert into public.order_refunds (
      store_id, order_id, idempotency_key, request_hash, refund_amount,
      refund_method, refund_status, reason, metadata, created_by_user_id,
      currency_code, stripe_checkout_session_id, stripe_payment_intent_id,
      stripe_account_id, stripe_livemode
    ) values (
      v_order.store_id, v_order.id, v_key, v_hash,
      (v_amount_cents::numeric / 100)::numeric(10, 2),
      'stripe', 'pending', v_reason,
      jsonb_build_object(
        'schema_version', 'ff_connect_cancellation_v1',
        'ff_schema_version', 'ff_connect_cancellation_v1',
        'workflow_type', 'paid_order_cancellation',
        'workflow_state', 'refund_pending',
        'cancellation_type', 'full',
        'request_hash', v_hash,
        'remaining_active_quantities', v_lines,
        'restoration_intent', 'all_eligible_remaining_inventory',
        'send_buyer_notification', coalesce(p_send_buyer_notification, false)
      ),
      p_actor_user_id, v_currency, v_session.stripe_checkout_session_id,
      v_session.stripe_payment_intent_id,
      v_session.metadata ->> 'stripe_account_id',
      (v_session.metadata ->> 'stripe_livemode')::boolean
    ) returning * into v_action;
  elsif v_action.request_hash <> v_hash
     or round(v_action.refund_amount * 100)::bigint <> v_amount_cents
     or v_action.currency_code <> v_currency
     or v_action.stripe_checkout_session_id <> v_session.stripe_checkout_session_id
     or v_action.stripe_payment_intent_id <> v_session.stripe_payment_intent_id
     or v_action.stripe_account_id <> v_session.metadata ->> 'stripe_account_id'
     or v_action.stripe_livemode <> (v_session.metadata ->> 'stripe_livemode')::boolean
     or v_action.metadata ->> 'cancellation_type' <> 'full' then
    raise exception 'Existing cancellation action does not match this request.';
  end if;

  return query select
    v_action.id,
    v_action.idempotency_key,
    v_action.request_hash,
    v_amount_cents,
    lower(v_currency),
    v_action.stripe_checkout_session_id,
    v_action.stripe_payment_intent_id,
    v_action.stripe_account_id,
    v_action.stripe_livemode,
    jsonb_build_object(
      'ff_cancellation_schema_version', 'ff_connect_cancellation_v1',
      'ff_refund_action_id', v_action.id::text,
      'ff_order_id', v_order.id::text,
      'ff_request_hash', v_action.request_hash,
      'ff_cancellation_type', 'full'
    ),
    v_action.provider_refund_id,
    v_action.refund_status,
    v_action.provider_status;
end;
$$;

comment on function public.prepare_stripe_full_cancellation(uuid, uuid, text, boolean) is
'Service-only preparation for one deterministic full paid-order cancellation action. It creates no Stripe refund and changes no order or inventory state.';
revoke all on function public.prepare_stripe_full_cancellation(uuid, uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.prepare_stripe_full_cancellation(uuid, uuid, text, boolean)
to service_role;

create or replace function public.record_stripe_full_cancellation_refund_response(
  p_refund_action_id uuid,
  p_provider_refund_id text,
  p_provider_status text,
  p_refund_amount_cents bigint,
  p_currency text,
  p_stripe_payment_intent_id text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_stripe_metadata jsonb,
  p_refund_created_at timestamptz
)
returns table (
  refund_action_id uuid,
  order_id uuid,
  refund_status text,
  payment_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action public.order_refunds%rowtype;
  v_order public.orders%rowtype;
  v_status text;
  v_payment_status text;
  v_total_succeeded numeric(10, 2);
begin
  select refunds.* into v_action
  from public.order_refunds as refunds
  where refunds.id = p_refund_action_id
  for update;
  if v_action.id is null then raise exception 'Refund action is not available.'; end if;

  select orders.* into v_order
  from public.orders as orders
  where orders.id = v_action.order_id and orders.store_id = v_action.store_id
  for update;

  if v_action.refund_method <> 'stripe'
     or v_action.metadata ->> 'schema_version' <> 'ff_connect_cancellation_v1'
     or v_action.metadata ->> 'workflow_type' <> 'paid_order_cancellation'
     or v_action.metadata ->> 'cancellation_type' <> 'full'
     or v_action.stripe_payment_intent_id <> p_stripe_payment_intent_id
     or v_action.stripe_account_id <> p_stripe_account_id
     or v_action.stripe_livemode <> p_stripe_livemode
     or v_action.currency_code <> upper(p_currency)
     or round(v_action.refund_amount * 100)::bigint <> p_refund_amount_cents
     or p_stripe_metadata ->> 'ff_cancellation_schema_version' <> 'ff_connect_cancellation_v1'
     or p_stripe_metadata ->> 'ff_refund_action_id' <> v_action.id::text
     or p_stripe_metadata ->> 'ff_order_id' <> v_action.order_id::text
     or p_stripe_metadata ->> 'ff_request_hash' <> v_action.request_hash
     or p_stripe_metadata ->> 'ff_cancellation_type' <> 'full'
     or v_action.created_at > coalesce(p_refund_created_at, now()) + interval '1 second'
     or (v_action.provider_refund_id is not null and v_action.provider_refund_id <> p_provider_refund_id)
     or exists (
       select 1 from public.order_refunds as other
       where other.provider_refund_id = p_provider_refund_id and other.id <> v_action.id
     ) then
    raise exception 'Stripe refund response does not match the cancellation action.';
  end if;

  v_status := case p_provider_status
    when 'succeeded' then 'succeeded'
    when 'failed' then 'failed'
    when 'canceled' then 'canceled'
    else 'pending'
  end;

  update public.order_refunds as refunds
  set refund_status = v_status,
      provider_refund_id = p_provider_refund_id,
      provider_status = p_provider_status,
      processed_at = case when v_status = 'succeeded' then now() else refunds.processed_at end,
      metadata = refunds.metadata || jsonb_build_object(
        'origin_classification', 'flockfront',
        'origin_proof', 'stripe_api_response',
        'workflow_state', case
          when v_status = 'succeeded' then 'refund_succeeded'
          when v_status = 'failed' then 'refund_failed'
          else 'refund_pending'
        end
      )
  where refunds.id = v_action.id
  returning * into v_action;

  select coalesce(sum(refunds.refund_amount), 0)::numeric(10, 2)
  into v_total_succeeded
  from public.order_refunds as refunds
  where refunds.order_id = v_order.id
    and refunds.store_id = v_order.store_id
    and refunds.refund_method = 'stripe'
    and refunds.refund_status = 'succeeded';

  v_payment_status := case
    when v_total_succeeded <= 0 then 'paid'
    when v_total_succeeded >= v_order.total_amount then 'refunded'
    else 'partially_refunded'
  end;
  update public.orders as orders
  set payment_status = v_payment_status,
      provider_payment_status = v_payment_status,
      payment_provider_status_updated_at = now()
  where orders.id = v_order.id;

  return query select v_action.id, v_order.id, v_status, v_payment_status;
end;
$$;

comment on function public.record_stripe_full_cancellation_refund_response(uuid, text, text, bigint, text, text, text, boolean, jsonb, timestamptz) is
'Service-only reconciliation of the real Stripe Refund returned to the paid cancellation orchestrator. This provider proof alone never cancels an order or changes inventory.';
revoke all on function public.record_stripe_full_cancellation_refund_response(uuid, text, text, bigint, text, text, text, boolean, jsonb, timestamptz)
from public, anon, authenticated;
grant execute on function public.record_stripe_full_cancellation_refund_response(uuid, text, text, bigint, text, text, text, boolean, jsonb, timestamptz)
to service_role;

-- Keep out-of-order refund.updated/refund.failed events from downgrading a
-- refund whose real provider ID was already bound by the Stripe API response.
alter function public.record_stripe_connect_refund_event(
  text, text, text, text, bigint, text, text, text, boolean, jsonb, text, timestamptz
) rename to record_stripe_connect_refund_event_phase1_internal;

revoke all on function public.record_stripe_connect_refund_event_phase1_internal(
  text, text, text, text, bigint, text, text, text, boolean, jsonb, text, timestamptz
) from public, anon, authenticated, service_role;

create function public.record_stripe_connect_refund_event(
  p_provider_event_id text,
  p_event_type text,
  p_provider_refund_id text,
  p_provider_status text,
  p_refund_amount_cents bigint,
  p_currency text,
  p_stripe_payment_intent_id text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_stripe_metadata jsonb,
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
set search_path = public, pg_temp
as $$
declare
  v_result record;
  v_action public.order_refunds%rowtype;
begin
  select * into v_result
  from public.record_stripe_connect_refund_event_phase1_internal(
    p_provider_event_id, p_event_type, p_provider_refund_id, p_provider_status,
    p_refund_amount_cents, p_currency, p_stripe_payment_intent_id,
    p_stripe_account_id, p_stripe_livemode, p_stripe_metadata,
    p_request_idempotency_key, p_refund_created_at
  );

  if v_result.origin_classification = 'external_unproven' then
    select refunds.* into v_action
    from public.order_refunds as refunds
    where refunds.id = v_result.refund_id
      and refunds.provider_refund_id = p_provider_refund_id
      and refunds.refund_method = 'stripe'
      and refunds.stripe_payment_intent_id = p_stripe_payment_intent_id
      and refunds.stripe_account_id = p_stripe_account_id
      and refunds.stripe_livemode = p_stripe_livemode
      and refunds.currency_code = upper(p_currency)
      and round(refunds.refund_amount * 100)::bigint = p_refund_amount_cents
      and refunds.metadata ->> 'schema_version' = 'ff_connect_cancellation_v1'
      and refunds.metadata ->> 'workflow_type' = 'paid_order_cancellation'
      and refunds.metadata ->> 'origin_proof' = 'stripe_api_response'
      and p_stripe_metadata ->> 'ff_refund_action_id' = refunds.id::text
      and p_stripe_metadata ->> 'ff_order_id' = refunds.order_id::text
      and p_stripe_metadata ->> 'ff_request_hash' = refunds.request_hash
    for update;

    if v_action.id is not null then
      update public.order_refunds as refunds
      set metadata = refunds.metadata || jsonb_build_object(
        'origin_classification', 'flockfront',
        'origin_proof', 'stripe_api_response'
      )
      where refunds.id = v_action.id;
      update public.payment_provider_events as events
      set payload_summary = events.payload_summary || jsonb_build_object(
        'origin_classification', 'flockfront',
        'origin_proof', 'stripe_api_response'
      )
      where events.provider = 'stripe' and events.provider_event_id = p_provider_event_id;
      v_result.origin_classification := 'flockfront';
    end if;
  end if;

  return query select
    v_result.was_duplicate,
    v_result.refund_id,
    v_result.order_id,
    v_result.origin_classification,
    v_result.payment_status;
end;
$$;

comment on function public.record_stripe_connect_refund_event(text, text, text, text, bigint, text, text, text, boolean, jsonb, text, timestamptz) is
'Service-only Stripe Connect refund observation. It preserves prior API-response origin proof and never cancels orders or changes inventory.';
revoke all on function public.record_stripe_connect_refund_event(text, text, text, text, bigint, text, text, text, boolean, jsonb, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.record_stripe_connect_refund_event(text, text, text, text, bigint, text, text, text, boolean, jsonb, text, timestamptz)
to service_role;

create or replace function public.finalize_stripe_full_cancellation(
  p_refund_action_id uuid,
  p_actor_user_id uuid,
  p_canceled_reason text default null,
  p_send_buyer_notification boolean default false
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  order_status text,
  payment_status text,
  canceled_at timestamptz,
  refund_action_id uuid,
  provider_refund_id text,
  buyer_notification_queued boolean,
  seller_copy_queued boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action public.order_refunds%rowtype;
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_session public.stripe_checkout_sessions%rowtype;
  v_changes jsonb := '[]'::jsonb;
  v_inventory_metadata jsonb;
  v_from_order_status text;
  v_reason text := nullif(trim(p_canceled_reason), '');
  v_buyer_queued boolean := false;
  v_seller_queued boolean := false;
  v_email_action_id text;
begin
  select refunds.* into v_action
  from public.order_refunds as refunds
  where refunds.id = p_refund_action_id
  for update;
  if v_action.id is null then raise exception 'Refund action is not available.'; end if;

  select orders.* into v_order
  from public.orders as orders
  join public.stores as stores
    on stores.id = orders.store_id and stores.owner_user_id = p_actor_user_id
  where orders.id = v_action.order_id and orders.store_id = v_action.store_id
  for update of orders;
  if v_order.id is null then raise exception 'Order is not available.'; end if;

  if v_action.metadata ->> 'cancellation_applied_at' is not null
     or v_action.metadata ->> 'workflow_state' = 'cancellation_applied' then
    return query select v_order.id, v_order.order_number, v_order.store_id,
      v_order.order_status, v_order.payment_status, v_order.canceled_at,
      v_action.id, v_action.provider_refund_id, false, false;
    return;
  end if;

  if v_order.order_status not in ('pending', 'open') or v_order.canceled_at is not null then
    raise exception 'Only an active order can be finalized.';
  end if;
  if v_order.payment_method <> 'stripe_checkout'
     or v_order.payment_provider <> 'stripe'
     or v_order.payment_status <> 'refunded'
     or v_action.refund_status <> 'succeeded'
     or v_action.provider_status <> 'succeeded'
     or nullif(v_action.provider_refund_id, '') is null
     or v_action.metadata ->> 'schema_version' <> 'ff_connect_cancellation_v1'
     or v_action.metadata ->> 'workflow_type' <> 'paid_order_cancellation'
     or v_action.metadata ->> 'cancellation_type' <> 'full'
     or v_action.metadata ->> 'origin_classification' <> 'flockfront'
     or v_action.metadata ->> 'origin_proof' not in (
       'stripe_api_response', 'stripe_event_request_idempotency'
     ) then
    raise exception 'A proven successful FlockFront refund is required.';
  end if;

  select sessions.* into v_session
  from public.stripe_checkout_sessions as sessions
  where sessions.store_id = v_order.store_id
    and sessions.order_id = v_order.id
    and sessions.metadata ->> 'schema_version' = 'ff_connect_checkout_v1'
  for update;
  if v_session.id is null
     or v_action.stripe_checkout_session_id <> v_session.stripe_checkout_session_id
     or v_action.stripe_payment_intent_id <> v_session.stripe_payment_intent_id
     or v_action.stripe_account_id <> v_session.metadata ->> 'stripe_account_id'
     or v_action.stripe_livemode <> (v_session.metadata ->> 'stripe_livemode')::boolean
     or v_action.currency_code <> upper(v_session.currency)
     or round(v_action.refund_amount * 100)::bigint <> v_session.amount_total_cents
     or round(v_order.total_amount * 100)::bigint <> v_session.amount_total_cents then
    raise exception 'Refund action does not match the trusted Stripe payment.';
  end if;
  if exists (
    select 1 from public.order_refunds as refunds
    where refunds.order_id = v_order.id and refunds.store_id = v_order.store_id
      and refunds.provider_refund_id is not null and refunds.id <> v_action.id
  ) then
    raise exception 'Another Stripe refund requires support.';
  end if;

  perform 1 from public.order_items as items
  where items.order_id = v_order.id and items.store_id = v_order.store_id
  order by items.id
  for update;
  if exists (
    select 1 from public.order_items as items
    where items.order_id = v_order.id and items.store_id = v_order.store_id
      and items.fulfilled_quantity > 0
  ) then raise exception 'Orders with fulfilled items require support.'; end if;
  if exists (
    select 1 from public.order_items as items
    where items.order_id = v_order.id and items.store_id = v_order.store_id
      and items.order_item_source <> 'custom'
      and items.inventory_debited_quantity is null
  ) then raise exception 'Order inventory requires operational reconciliation before cancellation.'; end if;

  drop table if exists pg_temp.stripe_full_cancel_changes;
  create temporary table pg_temp.stripe_full_cancel_changes on commit drop as
  select
    items.id as order_item_id,
    case when coalesce(items.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
      then 'listing_inventory' else items.order_item_source end as item_type,
    case
      when coalesce(items.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory') then items.inventory_item_id
      when items.order_item_source = 'equipment_inventory' then items.equipment_inventory_item_id
      when items.order_item_source = 'processed_poultry_inventory' then items.processed_poultry_inventory_item_id
      when items.order_item_source = 'hatching_egg_inventory' then items.hatching_egg_inventory_item_id
      else null
    end as source_id,
    (items.quantity - items.fulfilled_quantity - items.canceled_quantity)::integer as cancel_quantity,
    case when items.order_item_source = 'custom' then 0 else greatest(
      items.inventory_debited_quantity - items.fulfilled_quantity - items.restored_quantity,
      0
    )::integer end as restore_quantity,
    items.inventory_debited_quantity,
    items.restored_quantity
  from public.order_items as items
  where items.order_id = v_order.id and items.store_id = v_order.store_id;

  select public.reconcile_order_inventory(
    v_order.store_id,
    'order_canceled',
    coalesce(jsonb_agg(jsonb_build_object(
      'order_item_id', changes.order_item_id,
      'item_type', changes.item_type,
      'source_id', changes.source_id,
      'quantity_delta', -changes.restore_quantity,
      'prior_debited_quantity', changes.inventory_debited_quantity,
      'new_debited_quantity', changes.inventory_debited_quantity,
      'prior_restored_quantity', changes.restored_quantity,
      'new_restored_quantity', changes.restored_quantity + changes.restore_quantity
    )) filter (where changes.restore_quantity > 0), '[]'::jsonb)
  ) into v_changes
  from pg_temp.stripe_full_cancel_changes as changes;

  update public.order_items as items
  set canceled_quantity = items.canceled_quantity + changes.cancel_quantity,
      restored_quantity = items.restored_quantity + changes.restore_quantity
  from pg_temp.stripe_full_cancel_changes as changes
  where items.id = changes.order_item_id;

  select jsonb_build_object(
    'refund_action_id', v_action.id,
    'provider_refund_id', v_action.provider_refund_id,
    'restore_inventory_requested', true,
    'inventory_adjustments', coalesce(jsonb_agg(jsonb_build_object(
      'order_item_id', changes.order_item_id,
      'item_type', changes.item_type,
      'quantity_canceled', changes.cancel_quantity,
      'quantity_restored', changes.restore_quantity
    ) order by changes.order_item_id), '[]'::jsonb)
  ) into v_inventory_metadata
  from pg_temp.stripe_full_cancel_changes as changes;

  v_from_order_status := v_order.order_status;
  update public.orders as orders
  set order_status = 'canceled', payment_status = 'refunded',
      provider_payment_status = 'refunded', canceled_at = now(),
      canceled_reason = v_reason, payment_provider_status_updated_at = now()
  where orders.id = v_order.id
  returning orders.* into v_order;

  insert into public.order_events (
    store_id, order_id, actor_user_id, actor_type, event_type,
    from_order_status, to_order_status, from_payment_status, to_payment_status,
    note, metadata
  ) values (
    v_order.store_id, v_order.id, p_actor_user_id, 'seller', 'order_canceled',
    v_from_order_status, 'canceled', 'refunded', 'refunded', v_reason,
    v_inventory_metadata
  );

  perform public.record_order_inventory_reconciliation(
    v_order.id, v_order.store_id, 'order_canceled', v_changes
  );

  select stores.* into v_store from public.stores as stores where stores.id = v_order.store_id;
  if coalesce(p_send_buyer_notification, false)
     and nullif(trim(coalesce(v_order.buyer_email_snapshot, '')), '') is not null then
    v_email_action_id := v_action.id::text;
    begin
      perform public.enqueue_email_notification(
        v_order.store_id, v_order.id, 'buyer_order_canceled', 'buyer',
        v_order.buyer_email_snapshot, 'Order canceled: ' || v_order.order_number,
        jsonb_build_object(
          'order_id', v_order.id, 'order_number', v_order.order_number,
          'store_id', v_order.store_id, 'store_name', v_store.store_name,
          'store_slug', v_store.store_slug,
          'buyer_first_name', v_order.buyer_first_name_snapshot,
          'buyer_last_name', v_order.buyer_last_name_snapshot,
          'buyer_email', v_order.buyer_email_snapshot,
          'order_status', v_order.order_status, 'payment_status', v_order.payment_status,
          'total_amount', v_order.total_amount, 'created_at', v_order.created_at,
          'canceled_at', v_order.canceled_at, 'canceled_reason', v_order.canceled_reason,
          'email_action_id', v_email_action_id
        ), v_email_action_id
      );
      select exists (
        select 1 from public.email_notifications as emails
        where emails.store_id = v_order.store_id and emails.order_id = v_order.id
          and emails.notification_type = 'buyer_order_canceled'
          and emails.recipient_type = 'buyer'
          and emails.dedupe_key = 'buyer_order_canceled:order:' || v_order.id::text || ':action:' || v_email_action_id
      ) into v_buyer_queued;
    exception when others then v_buyer_queued := false; end;

    if v_buyer_queued then
      begin
        perform public.enqueue_email_notification(
          v_order.store_id, v_order.id, 'seller_order_canceled_copy', 'seller',
          v_store.order_notification_email,
          'Customer copy: Canceled order #' || v_order.order_number,
          jsonb_build_object(
            'order_id', v_order.id, 'order_number', v_order.order_number,
            'store_id', v_order.store_id, 'store_name', v_store.store_name,
            'store_slug', v_store.store_slug,
            'buyer_first_name', v_order.buyer_first_name_snapshot,
            'buyer_last_name', v_order.buyer_last_name_snapshot,
            'buyer_email', v_order.buyer_email_snapshot,
            'order_status', v_order.order_status, 'payment_status', v_order.payment_status,
            'total_amount', v_order.total_amount, 'created_at', v_order.created_at,
            'canceled_at', v_order.canceled_at, 'canceled_reason', v_order.canceled_reason,
            'email_action_id', v_email_action_id
          ), v_email_action_id
        );
        select exists (
          select 1 from public.email_notifications as emails
          where emails.store_id = v_order.store_id and emails.order_id = v_order.id
            and emails.notification_type = 'seller_order_canceled_copy'
            and emails.recipient_type = 'seller'
            and emails.dedupe_key = 'seller_order_canceled_copy:order:' || v_order.id::text || ':action:' || v_email_action_id
        ) into v_seller_queued;
      exception when others then v_seller_queued := false; end;
    end if;
  end if;

  update public.order_refunds as refunds
  set reason = coalesce(v_reason, refunds.reason),
      metadata = refunds.metadata || jsonb_build_object(
        'workflow_state', 'cancellation_applied',
        'cancellation_applied_at', now(),
        'cancellation_order_event_recorded', true,
        'inventory_reconciliation_applied', true
      )
  where refunds.id = v_action.id
  returning * into v_action;

  return query select v_order.id, v_order.order_number, v_order.store_id,
    v_order.order_status, v_order.payment_status, v_order.canceled_at,
    v_action.id, v_action.provider_refund_id, v_buyer_queued, v_seller_queued;
end;
$$;

comment on function public.finalize_stripe_full_cancellation(uuid, uuid, text, boolean) is
'Service-only, idempotent finalization of a proven successful FlockFront full Stripe refund. It cancels active quantities and restores eligible inventory through the shared reconciler.';
revoke all on function public.finalize_stripe_full_cancellation(uuid, uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.finalize_stripe_full_cancellation(uuid, uuid, text, boolean)
to service_role;

commit;
