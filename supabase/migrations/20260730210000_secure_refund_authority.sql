-- Phase 1 Security Batch E: separate seller-recorded offline refunds from
-- Stripe provider truth. Stripe refund reconciliation remains deliberately
-- disabled until a signed, account/mode-bound provider workflow exists.

begin;

-- An omitted status must never become a successful refund implicitly.
alter table public.order_refunds
  alter column refund_status drop default;

-- Nullable-first provider binding fields preserve historical rows for later
-- classification. New rows are constrained below without rewriting history.
alter table public.order_refunds
  add column if not exists currency_code text,
  add column if not exists payment_provider_event_id uuid,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_account_id text,
  add column if not exists stripe_livemode boolean;

alter table public.order_refunds
  add constraint order_refunds_payment_provider_event_fk
    foreign key (payment_provider_event_id)
    references public.payment_provider_events(id)
    on delete restrict
    not valid,
  add constraint order_refunds_currency_code_format_check
    check (
      currency_code is null
      or currency_code ~ '^[A-Z]{3}$'
    ) not valid,
  add constraint order_refunds_offline_authority_check
    check (
      refund_method = 'stripe'
      or (
        refund_method in ('offline_cash', 'offline_check', 'offline_other')
        and refund_status = 'succeeded'
        and currency_code is not null
        and provider_refund_id is null
        and provider_status is null
        and payment_provider_event_id is null
        and stripe_checkout_session_id is null
        and stripe_payment_intent_id is null
        and stripe_account_id is null
        and stripe_livemode is null
        and metadata = '{}'::jsonb
      )
    ) not valid,
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
            and payment_provider_event_id is not null
            and nullif(trim(provider_refund_id), '') is not null
            and nullif(trim(provider_status), '') is not null
          )
        )
      )
    ) not valid;

create unique index if not exists order_refunds_payment_provider_event_unique_idx
on public.order_refunds(payment_provider_event_id)
where payment_provider_event_id is not null;

create index if not exists order_refunds_order_status_amount_idx
on public.order_refunds(order_id, refund_status, refund_amount);

comment on column public.order_refunds.currency_code is
'Uppercase ISO-style order currency snapshot. New offline refunds derive this from orders.currency_code; provider refunds must match trusted provider payment data.';

comment on column public.order_refunds.payment_provider_event_id is
'Trusted provider event that established a terminal Stripe refund result. Historical NULL values require classification before provider reconciliation can be enabled.';

comment on column public.order_refunds.stripe_checkout_session_id is
'Trusted Stripe Checkout Session binding for a future provider-created refund. Browser callers never supply this field.';

comment on column public.order_refunds.stripe_payment_intent_id is
'Trusted Stripe PaymentIntent binding for a future provider-created refund. Browser callers never supply this field.';

comment on column public.order_refunds.stripe_account_id is
'Explicit Stripe account binding for future refund reconciliation.';

comment on column public.order_refunds.stripe_livemode is
'Explicit Stripe live/test mode binding for future refund reconciliation.';

-- Browser roles must not mutate the refund ledger directly. Reads continue to
-- use the existing store-owner/admin RLS policy.
revoke insert, update, delete on table public.order_refunds
from public, anon, authenticated;

-- Revoke every historical overload before installing the narrow action and
-- service-only fail-closed provider boundary.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'seller_record_refund',
        'seller_record_offline_refund',
        'record_stripe_refund_result'
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_function.signature
    );
  end loop;
end;
$$;

create or replace function public.seller_record_offline_refund(
  p_order_id uuid,
  p_idempotency_key text,
  p_refund_amount numeric,
  p_offline_method text,
  p_reason text default null,
  p_note text default null
)
returns table (
  refund_id uuid,
  order_id uuid,
  refund_amount numeric(10, 2),
  refund_method text,
  refund_status text,
  currency_code text,
  payment_status text,
  refundable_amount_remaining numeric(10, 2),
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_refund public.order_refunds%rowtype;
  v_idempotency_key text := nullif(trim(p_idempotency_key), '');
  v_refund_amount numeric(10, 2) := p_refund_amount::numeric(10, 2);
  v_offline_method text := lower(nullif(trim(p_offline_method), ''));
  v_reason text := nullif(trim(p_reason), '');
  v_note text := nullif(trim(p_note), '');
  v_request_hash text;
  v_paid_amount numeric(10, 2);
  v_reserved_refund_total numeric(10, 2);
  v_succeeded_refund_total numeric(10, 2);
  v_from_payment_status text;
  v_new_payment_status text;
begin
  if v_idempotency_key is null then
    raise exception 'Refund idempotency key is required.';
  end if;

  if length(v_idempotency_key) > 200 then
    raise exception 'Refund idempotency key must be 200 characters or fewer.';
  end if;

  if v_refund_amount is null or v_refund_amount <= 0 then
    raise exception 'Refund amount must be greater than zero.';
  end if;

  if v_offline_method not in (
    'offline_cash',
    'offline_check',
    'offline_other'
  ) then
    raise exception 'Offline refund method is not supported.';
  end if;

  select orders.*
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if v_order.id is null
     or v_actor_user_id is null
     or not (
       public.owns_store(v_order.store_id)
       or public.is_admin()
     ) then
    raise exception 'Order is not available.';
  end if;

  if v_order.payment_provider <> 'offline'
     or v_order.payment_method <> 'pay_at_pickup' then
    raise exception 'Offline refunds are available only for offline pay-at-pickup orders.';
  end if;

  if v_order.payment_status not in (
    'paid',
    'partially_refunded',
    'refunded'
  ) then
    raise exception 'Only paid or previously refunded offline orders can receive refunds.';
  end if;

  v_paid_amount := v_order.total_amount::numeric(10, 2);
  v_from_payment_status := v_order.payment_status;

  if v_paid_amount is null or v_paid_amount <= 0 then
    raise exception 'Order has no refundable paid amount.';
  end if;

  -- The order row serializes all refund attempts for an order. Locking the
  -- existing rows as well protects future internal writers that follow the
  -- same order-first lock convention.
  perform 1
  from public.order_refunds
  where order_refunds.order_id = v_order.id
    and order_refunds.store_id = v_order.store_id
  order by order_refunds.id
  for update;

  v_request_hash := encode(
    digest(
      jsonb_build_object(
        'operation', 'seller_record_offline_refund',
        'actor_user_id', v_actor_user_id,
        'order_id', v_order.id,
        'refund_amount', v_refund_amount,
        'refund_method', v_offline_method,
        'currency_code', v_order.currency_code,
        'reason', v_reason,
        'note', v_note
      )::text,
      'sha256'
    ),
    'hex'
  );

  select order_refunds.*
  into v_refund
  from public.order_refunds
  where order_refunds.store_id = v_order.store_id
    and order_refunds.order_id = v_order.id
    and order_refunds.idempotency_key = v_idempotency_key
  for update;

  select
    coalesce(sum(order_refunds.refund_amount) filter (
      where order_refunds.refund_status in ('pending', 'succeeded')
    ), 0)::numeric(10, 2),
    coalesce(sum(order_refunds.refund_amount) filter (
      where order_refunds.refund_status = 'succeeded'
    ), 0)::numeric(10, 2)
  into
    v_reserved_refund_total,
    v_succeeded_refund_total
  from public.order_refunds
  where order_refunds.order_id = v_order.id
    and order_refunds.store_id = v_order.store_id;

  if v_refund.id is not null then
    if v_refund.request_hash <> v_request_hash then
      raise exception 'Refund idempotency key was already used with different refund details.';
    end if;

    return query
    select
      v_refund.id,
      v_refund.order_id,
      v_refund.refund_amount,
      v_refund.refund_method,
      v_refund.refund_status,
      v_refund.currency_code,
      v_order.payment_status,
      greatest(v_paid_amount - v_reserved_refund_total, 0)::numeric(10, 2),
      v_refund.created_at;
    return;
  end if;

  if v_reserved_refund_total > v_paid_amount
     or v_succeeded_refund_total > v_paid_amount then
    raise exception 'Existing refund records require operational reconciliation.';
  end if;

  if v_reserved_refund_total + v_refund_amount > v_paid_amount then
    raise exception 'Refund amount exceeds remaining refundable amount.';
  end if;

  insert into public.order_refunds (
    store_id,
    order_id,
    idempotency_key,
    request_hash,
    refund_amount,
    refund_method,
    refund_status,
    currency_code,
    provider_refund_id,
    provider_status,
    payment_provider_event_id,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    stripe_account_id,
    stripe_livemode,
    reason,
    note,
    metadata,
    created_by_user_id,
    processed_at
  )
  values (
    v_order.store_id,
    v_order.id,
    v_idempotency_key,
    v_request_hash,
    v_refund_amount,
    v_offline_method,
    'succeeded',
    v_order.currency_code,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    v_reason,
    v_note,
    '{}'::jsonb,
    v_actor_user_id,
    statement_timestamp()
  )
  returning order_refunds.* into v_refund;

  v_reserved_refund_total := v_reserved_refund_total + v_refund.refund_amount;
  v_succeeded_refund_total := v_succeeded_refund_total + v_refund.refund_amount;

  if v_succeeded_refund_total = v_paid_amount then
    v_new_payment_status := 'refunded';
  else
    v_new_payment_status := 'partially_refunded';
  end if;

  if v_new_payment_status is distinct from v_order.payment_status then
    update public.orders
    set payment_status = v_new_payment_status
    where orders.id = v_order.id
      and orders.store_id = v_order.store_id
    returning orders.* into v_order;
  end if;

  insert into public.order_events (
    store_id,
    order_id,
    actor_user_id,
    actor_type,
    event_type,
    from_order_status,
    to_order_status,
    from_payment_status,
    to_payment_status,
    note,
    metadata
  )
  values (
    v_order.store_id,
    v_order.id,
    v_actor_user_id,
    case when public.is_admin() then 'admin' else 'seller' end,
    'refund_recorded',
    v_order.order_status,
    v_order.order_status,
    v_from_payment_status,
    v_new_payment_status,
    v_note,
    jsonb_build_object(
      'operation', 'offline_refund_recorded',
      'refund_id', v_refund.id,
      'refund_amount', v_refund.refund_amount,
      'refund_method', v_refund.refund_method,
      'refund_status', v_refund.refund_status,
      'currency_code', v_refund.currency_code,
      'reason', v_refund.reason,
      'actual_actor_user_id', v_actor_user_id
    )
  );

  return query
  select
    v_refund.id,
    v_refund.order_id,
    v_refund.refund_amount,
    v_refund.refund_method,
    v_refund.refund_status,
    v_refund.currency_code,
    v_order.payment_status,
    greatest(v_paid_amount - v_reserved_refund_total, 0)::numeric(10, 2),
    v_refund.created_at;
end;
$$;

comment on function public.seller_record_offline_refund(
  uuid, text, numeric, text, text, text
) is
'Authenticated owner/platform-admin action for idempotent offline refund accounting. It derives tenant, actor, currency, succeeded state, and null provider fields from trusted database state.';

revoke all on function public.seller_record_offline_refund(
  uuid, text, numeric, text, text, text
) from public, anon, service_role;
grant execute on function public.seller_record_offline_refund(
  uuid, text, numeric, text, text, text
) to authenticated;

-- Keep the historical provider result signature as a service-only, fail-closed
-- boundary. The existing tables do not establish a verified refund request,
-- Stripe account/mode, signed event, captured amount, and immutable request
-- binding strongly enough to apply provider truth safely.
create or replace function public.record_stripe_refund_result(
  p_refund_id uuid,
  p_payment_provider_event_id uuid,
  p_provider_refund_id text,
  p_refund_status text,
  p_provider_status text default null,
  p_processed_at timestamptz default now()
)
returns public.order_refunds
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authorized to record Stripe refund results.';
  end if;

  raise exception 'Stripe refund reconciliation is disabled until a verified provider refund workflow is deployed.';
end;
$$;

comment on function public.record_stripe_refund_result(
  uuid, uuid, text, text, text, timestamptz
) is
'Service-role-only fail-closed Stripe refund boundary. No provider result is applied until a signed, amount/currency/account/mode-bound refund workflow is deployed.';

revoke all on function public.record_stripe_refund_result(
  uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_stripe_refund_result(
  uuid, uuid, text, text, text, timestamptz
) to service_role;

commit;
