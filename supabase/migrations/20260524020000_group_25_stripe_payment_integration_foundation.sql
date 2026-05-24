-- Group 25: Stripe Payment Integration Foundation
--
-- Scope:
-- - Adds provider payment state fields to orders without storing card data.
-- - Adds Stripe Checkout Session reconciliation records.
-- - Adds provider webhook/event idempotency records.
-- - Adds service/admin RPCs for future Edge Functions to record provider
--   sessions, payment outcomes, webhook processing, and refund outcomes.
--
-- This group does not add:
-- - Stripe API calls from Postgres
-- - custom card forms or raw payment method storage
-- - Stripe Connect, marketplace payouts, balances, or split payments
-- - disputes/chargebacks, subscriptions, store credits, or accounting exports


alter table public.orders
add column if not exists payment_provider text not null default 'offline',
add column if not exists provider_payment_status text,
add column if not exists payment_provider_status_updated_at timestamptz,
add column if not exists paid_at timestamptz;

update public.orders
set payment_provider = 'stripe'
where payment_method = 'stripe_checkout'
  and payment_provider <> 'stripe';

alter table public.orders
add constraint orders_payment_provider_check check (
  payment_provider in ('offline', 'stripe')
),
add constraint orders_provider_payment_status_not_empty_check check (
  provider_payment_status is null
  or length(trim(provider_payment_status)) > 0
),
add constraint orders_payment_method_provider_compatible_check check (
  (
    payment_method = 'pay_at_pickup'
    and payment_provider = 'offline'
  )
  or (
    payment_method = 'stripe_checkout'
    and payment_provider = 'stripe'
  )
);

comment on column public.orders.payment_provider is
'Payment provider for this order. Offline covers pay-at-pickup/cash/check flows; stripe covers Stripe-hosted checkout flows.';

comment on column public.orders.provider_payment_status is
'Provider-specific payment status snapshot, such as Stripe Checkout or PaymentIntent status. Internal payment_status remains the business-facing status.';

comment on column public.orders.payment_provider_status_updated_at is
'Timestamp when provider_payment_status was last updated by trusted server/Edge processing.';

comment on column public.orders.paid_at is
'Timestamp when trusted server/Edge processing recorded successful provider payment or seller/admin marked payment paid.';

create index if not exists orders_store_payment_provider_status_idx
on public.orders(store_id, payment_provider, provider_payment_status, created_at desc);

create index if not exists orders_paid_at_idx
on public.orders(paid_at desc)
where paid_at is not null;


create table public.stripe_checkout_sessions (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,

  stripe_checkout_session_id text not null,
  stripe_payment_intent_id text,
  stripe_customer_id text,

  checkout_session_status text,
  payment_status text,

  amount_total_cents bigint,
  currency text,
  expires_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stripe_checkout_sessions_session_id_unique unique (
    stripe_checkout_session_id
  ),

  constraint stripe_checkout_sessions_session_id_not_empty_check check (
    length(trim(stripe_checkout_session_id)) > 0
  ),

  constraint stripe_checkout_sessions_payment_intent_not_empty_check check (
    stripe_payment_intent_id is null
    or length(trim(stripe_payment_intent_id)) > 0
  ),

  constraint stripe_checkout_sessions_customer_id_not_empty_check check (
    stripe_customer_id is null
    or length(trim(stripe_customer_id)) > 0
  ),

  constraint stripe_checkout_sessions_status_check check (
    checkout_session_status is null
    or checkout_session_status in ('open', 'complete', 'expired')
  ),

  constraint stripe_checkout_sessions_payment_status_check check (
    payment_status is null
    or payment_status in ('paid', 'unpaid', 'no_payment_required')
  ),

  constraint stripe_checkout_sessions_amount_total_nonnegative_check check (
    amount_total_cents is null
    or amount_total_cents >= 0
  ),

  constraint stripe_checkout_sessions_currency_check check (
    currency is null
    or currency ~ '^[a-z]{3}$'
  ),

  constraint stripe_checkout_sessions_metadata_object_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

comment on table public.stripe_checkout_sessions is
'Service/admin-only Stripe Checkout Session reconciliation records. Actual Stripe API calls and hosted checkout redirects happen outside Postgres.';

comment on column public.stripe_checkout_sessions.stripe_checkout_session_id is
'Stripe Checkout Session id returned by Stripe-hosted Checkout.';

comment on column public.stripe_checkout_sessions.stripe_payment_intent_id is
'Optional Stripe PaymentIntent id linked to the Checkout Session when available.';

comment on column public.stripe_checkout_sessions.stripe_customer_id is
'Optional Stripe Customer id linked to the Checkout Session when available.';

comment on column public.stripe_checkout_sessions.metadata is
'Small operational metadata only. Do not store raw card data, full Stripe payloads, or webhook bodies here.';

create unique index stripe_checkout_sessions_payment_intent_unique_idx
on public.stripe_checkout_sessions(stripe_payment_intent_id)
where stripe_payment_intent_id is not null;

create index stripe_checkout_sessions_store_created_at_idx
on public.stripe_checkout_sessions(store_id, created_at desc);

create index stripe_checkout_sessions_order_created_at_idx
on public.stripe_checkout_sessions(order_id, created_at desc);

create index stripe_checkout_sessions_customer_idx
on public.stripe_checkout_sessions(stripe_customer_id)
where stripe_customer_id is not null;

create trigger stripe_checkout_sessions_set_updated_at
before update on public.stripe_checkout_sessions
for each row
execute function public.set_updated_at();

alter table public.stripe_checkout_sessions enable row level security;

create policy "Platform admins can read stripe checkout sessions"
on public.stripe_checkout_sessions
for select
to authenticated
using (
  public.is_admin()
);

revoke all on public.stripe_checkout_sessions from public;
grant select on public.stripe_checkout_sessions to authenticated;
grant select, insert, update on public.stripe_checkout_sessions to service_role;


create table public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),

  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  event_status text not null default 'received',

  related_store_id uuid references public.stores(id) on delete set null,
  related_order_id uuid references public.orders(id) on delete set null,
  related_refund_id uuid references public.order_refunds(id) on delete set null,

  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  provider_refund_id text,

  payload_summary jsonb not null default '{}'::jsonb,
  last_error text,

  received_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint payment_provider_events_provider_event_unique unique (
    provider,
    provider_event_id
  ),

  constraint payment_provider_events_provider_check check (
    provider in ('stripe')
  ),

  constraint payment_provider_events_provider_event_id_not_empty_check check (
    length(trim(provider_event_id)) > 0
  ),

  constraint payment_provider_events_event_type_not_empty_check check (
    length(trim(event_type)) > 0
  ),

  constraint payment_provider_events_status_check check (
    event_status in ('received', 'processing', 'processed', 'failed', 'ignored')
  ),

  constraint payment_provider_events_processing_timestamp_check check (
    event_status <> 'processing'
    or processing_started_at is not null
  ),

  constraint payment_provider_events_processed_timestamp_check check (
    event_status <> 'processed'
    or processed_at is not null
  ),

  constraint payment_provider_events_failed_timestamp_check check (
    event_status <> 'failed'
    or failed_at is not null
  ),

  constraint payment_provider_events_session_id_not_empty_check check (
    stripe_checkout_session_id is null
    or length(trim(stripe_checkout_session_id)) > 0
  ),

  constraint payment_provider_events_payment_intent_id_not_empty_check check (
    stripe_payment_intent_id is null
    or length(trim(stripe_payment_intent_id)) > 0
  ),

  constraint payment_provider_events_provider_refund_id_not_empty_check check (
    provider_refund_id is null
    or length(trim(provider_refund_id)) > 0
  ),

  constraint payment_provider_events_last_error_not_empty_check check (
    last_error is null
    or length(trim(last_error)) > 0
  ),

  constraint payment_provider_events_payload_summary_object_check check (
    jsonb_typeof(payload_summary) = 'object'
  )
);

comment on table public.payment_provider_events is
'Provider webhook/event idempotency and reconciliation records. Signature verification and provider API work happen in application/server or Edge code before calling trusted RPCs.';

comment on column public.payment_provider_events.provider_event_id is
'Provider event id, such as Stripe evt_*. Unique with provider to prevent duplicate webhook processing.';

comment on column public.payment_provider_events.payload_summary is
'Small non-sensitive summary used for reconciliation. Do not store full raw webhook payloads or payment method details here.';

create index payment_provider_events_status_received_idx
on public.payment_provider_events(event_status, received_at)
where event_status in ('received', 'processing', 'failed');

create index payment_provider_events_related_order_idx
on public.payment_provider_events(related_order_id, received_at desc)
where related_order_id is not null;

create index payment_provider_events_related_refund_idx
on public.payment_provider_events(related_refund_id, received_at desc)
where related_refund_id is not null;

create index payment_provider_events_stripe_session_idx
on public.payment_provider_events(stripe_checkout_session_id)
where stripe_checkout_session_id is not null;

create index payment_provider_events_payment_intent_idx
on public.payment_provider_events(stripe_payment_intent_id)
where stripe_payment_intent_id is not null;

create index payment_provider_events_provider_refund_idx
on public.payment_provider_events(provider_refund_id)
where provider_refund_id is not null;

create trigger payment_provider_events_set_updated_at
before update on public.payment_provider_events
for each row
execute function public.set_updated_at();

alter table public.payment_provider_events enable row level security;

create policy "Platform admins can read payment provider events"
on public.payment_provider_events
for select
to authenticated
using (
  public.is_admin()
);

revoke all on public.payment_provider_events from public;
grant select on public.payment_provider_events to authenticated;
grant select, insert, update on public.payment_provider_events to service_role;


create unique index if not exists order_refunds_provider_refund_id_unique_idx
on public.order_refunds(provider_refund_id)
where provider_refund_id is not null;

create index if not exists order_refunds_provider_status_idx
on public.order_refunds(refund_method, provider_status, created_at desc)
where provider_refund_id is not null;


alter table public.order_events
drop constraint if exists order_events_event_type_check;

alter table public.order_events
add constraint order_events_event_type_check check (
  event_type in (
    'payment_marked_paid',
    'payment_marked_pay_at_pickup',
    'payment_provider_checkout_session_recorded',
    'payment_provider_payment_succeeded',
    'payment_provider_payment_failed',
    'payment_provider_refund_updated',
    'order_ready_for_pickup',
    'order_partially_fulfilled',
    'order_fulfilled',
    'order_canceled',
    'order_reinstated',
    'refund_recorded'
  )
);


create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_note text default null
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  order_status text,
  payment_status text,
  fulfilled_at timestamptz,
  canceled_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_note text;
  v_actor_type text;
begin
  v_note := nullif(trim(p_note), '');

  select *
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order not found.';
  end if;

  if not (
    public.owns_store(v_order.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to manage this order.';
  end if;

  if v_order.payment_method <> 'pay_at_pickup' then
    raise exception 'Payment correction is only available for pay-at-pickup orders.';
  end if;

  if v_order.order_status not in ('pending', 'open', 'fulfilled') then
    raise exception 'Only pending, open, or fulfilled orders can be marked paid.';
  end if;

  if v_order.payment_status <> 'pay_at_pickup' then
    raise exception 'Only pay-at-pickup orders can be marked paid.';
  end if;

  update public.orders
  set
    payment_status = 'paid',
    paid_at = coalesce(paid_at, now())
  where orders.id = v_order.id
  returning * into v_order;

  v_actor_type := case
    when public.is_admin() then 'admin'
    else 'seller'
  end;

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
    note
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    v_actor_type,
    'payment_marked_paid',
    v_order.order_status,
    v_order.order_status,
    'pay_at_pickup',
    'paid',
    v_note
  );

  return query
  select
    orders.id,
    orders.order_number,
    orders.store_id,
    orders.order_status,
    orders.payment_status,
    orders.fulfilled_at,
    orders.canceled_at,
    orders.updated_at
  from public.orders
  where orders.id = v_order.id;
end;
$$;


create or replace function public.can_process_payment_provider_events()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role'
    or public.is_admin();
$$;

comment on function public.can_process_payment_provider_events() is
'Internal helper for payment provider processing RPCs. Allows platform admins and service-role Edge/server workers to reconcile provider payment events.';

revoke all on function public.can_process_payment_provider_events() from public;


create or replace function public.record_payment_provider_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_payload_summary jsonb default '{}'::jsonb,
  p_stripe_checkout_session_id text default null,
  p_stripe_payment_intent_id text default null,
  p_provider_refund_id text default null
)
returns table (
  payment_provider_event_id uuid,
  event_status text,
  should_process boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text;
  v_provider_event_id text;
  v_event_type text;
  v_payload_summary jsonb;
  v_stripe_checkout_session_id text;
  v_stripe_payment_intent_id text;
  v_provider_refund_id text;
  v_event public.payment_provider_events%rowtype;
  v_inserted boolean := false;
begin
  if not public.can_process_payment_provider_events() then
    raise exception 'Not authorized to process payment provider events.';
  end if;

  v_provider := lower(nullif(trim(p_provider), ''));
  v_provider_event_id := nullif(trim(p_provider_event_id), '');
  v_event_type := nullif(trim(p_event_type), '');
  v_payload_summary := coalesce(p_payload_summary, '{}'::jsonb);
  v_stripe_checkout_session_id := nullif(trim(p_stripe_checkout_session_id), '');
  v_stripe_payment_intent_id := nullif(trim(p_stripe_payment_intent_id), '');
  v_provider_refund_id := nullif(trim(p_provider_refund_id), '');

  if v_provider <> 'stripe' then
    raise exception 'Payment provider is not supported.';
  end if;

  if v_provider_event_id is null then
    raise exception 'Provider event id is required.';
  end if;

  if v_event_type is null then
    raise exception 'Provider event type is required.';
  end if;

  if jsonb_typeof(v_payload_summary) <> 'object' then
    raise exception 'Provider event payload summary must be a JSON object.';
  end if;

  insert into public.payment_provider_events (
    provider,
    provider_event_id,
    event_type,
    event_status,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    provider_refund_id,
    payload_summary,
    processing_started_at
  )
  values (
    v_provider,
    v_provider_event_id,
    v_event_type,
    'processing',
    v_stripe_checkout_session_id,
    v_stripe_payment_intent_id,
    v_provider_refund_id,
    v_payload_summary,
    now()
  )
  on conflict (provider, provider_event_id) do nothing
  returning * into v_event;

  if v_event.id is not null then
    v_inserted := true;
  end if;

  if not v_inserted then
    select *
    into v_event
    from public.payment_provider_events
    where payment_provider_events.provider = v_provider
      and payment_provider_events.provider_event_id = v_provider_event_id
    for update;
  end if;

  if v_inserted then
    return query
    select
      v_event.id,
      v_event.event_status,
      true;

    return;
  end if;

  if v_event.event_status in ('processed', 'processing', 'ignored') then
    return query
    select
      v_event.id,
      v_event.event_status,
      false;

    return;
  end if;

  update public.payment_provider_events
  set
    event_status = 'processing',
    event_type = v_event_type,
    stripe_checkout_session_id = coalesce(
      v_stripe_checkout_session_id,
      payment_provider_events.stripe_checkout_session_id
    ),
    stripe_payment_intent_id = coalesce(
      v_stripe_payment_intent_id,
      payment_provider_events.stripe_payment_intent_id
    ),
    provider_refund_id = coalesce(
      v_provider_refund_id,
      payment_provider_events.provider_refund_id
    ),
    payload_summary = v_payload_summary,
    last_error = null,
    processing_started_at = now(),
    failed_at = null
  where payment_provider_events.id = v_event.id
  returning * into v_event;

  return query
  select
    v_event.id,
    v_event.event_status,
    true;
end;
$$;


create or replace function public.mark_payment_provider_event_processed(
  p_payment_provider_event_id uuid,
  p_related_store_id uuid default null,
  p_related_order_id uuid default null,
  p_related_refund_id uuid default null
)
returns public.payment_provider_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.payment_provider_events%rowtype;
begin
  if not public.can_process_payment_provider_events() then
    raise exception 'Not authorized to process payment provider events.';
  end if;

  select *
  into v_event
  from public.payment_provider_events
  where payment_provider_events.id = p_payment_provider_event_id
  for update;

  if v_event.id is null then
    raise exception 'Payment provider event is not available.';
  end if;

  update public.payment_provider_events
  set
    event_status = 'processed',
    related_store_id = coalesce(p_related_store_id, related_store_id),
    related_order_id = coalesce(p_related_order_id, related_order_id),
    related_refund_id = coalesce(p_related_refund_id, related_refund_id),
    processed_at = coalesce(processed_at, now()),
    last_error = null
  where payment_provider_events.id = v_event.id
  returning * into v_event;

  return v_event;
end;
$$;


create or replace function public.mark_payment_provider_event_failed(
  p_payment_provider_event_id uuid,
  p_last_error text
)
returns public.payment_provider_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.payment_provider_events%rowtype;
  v_last_error text;
begin
  if not public.can_process_payment_provider_events() then
    raise exception 'Not authorized to process payment provider events.';
  end if;

  v_last_error := nullif(trim(p_last_error), '');

  if v_last_error is null then
    raise exception 'Provider event failure error is required.';
  end if;

  select *
  into v_event
  from public.payment_provider_events
  where payment_provider_events.id = p_payment_provider_event_id
  for update;

  if v_event.id is null then
    raise exception 'Payment provider event is not available.';
  end if;

  if v_event.event_status = 'processed' then
    raise exception 'Processed provider events cannot be marked failed.';
  end if;

  update public.payment_provider_events
  set
    event_status = 'failed',
    last_error = v_last_error,
    failed_at = now()
  where payment_provider_events.id = v_event.id
  returning * into v_event;

  return v_event;
end;
$$;


create or replace function public.record_stripe_checkout_session_for_order(
  p_order_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_payment_intent_id text default null,
  p_stripe_customer_id text default null,
  p_checkout_session_status text default 'open',
  p_payment_status text default 'unpaid',
  p_amount_total_cents bigint default null,
  p_currency text default null,
  p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.stripe_checkout_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_session public.stripe_checkout_sessions%rowtype;
  v_from_payment_status text;
  v_stripe_checkout_session_id text;
  v_stripe_payment_intent_id text;
  v_stripe_customer_id text;
  v_checkout_session_status text;
  v_payment_status text;
  v_currency text;
  v_metadata jsonb;
begin
  if not public.can_process_payment_provider_events() then
    raise exception 'Not authorized to record Stripe checkout sessions.';
  end if;

  v_stripe_checkout_session_id := nullif(trim(p_stripe_checkout_session_id), '');
  v_stripe_payment_intent_id := nullif(trim(p_stripe_payment_intent_id), '');
  v_stripe_customer_id := nullif(trim(p_stripe_customer_id), '');
  v_checkout_session_status := nullif(trim(p_checkout_session_status), '');
  v_payment_status := nullif(trim(p_payment_status), '');
  v_currency := lower(nullif(trim(p_currency), ''));
  v_metadata := coalesce(p_metadata, '{}'::jsonb);

  if v_stripe_checkout_session_id is null then
    raise exception 'Stripe checkout session id is required.';
  end if;

  if v_checkout_session_status is not null
    and v_checkout_session_status not in ('open', 'complete', 'expired') then
    raise exception 'Stripe checkout session status is not supported.';
  end if;

  if v_payment_status is not null
    and v_payment_status not in ('paid', 'unpaid', 'no_payment_required') then
    raise exception 'Stripe checkout payment status is not supported.';
  end if;

  if p_amount_total_cents is not null
    and p_amount_total_cents < 0 then
    raise exception 'Stripe checkout amount cannot be negative.';
  end if;

  if v_currency is not null
    and v_currency !~ '^[a-z]{3}$' then
    raise exception 'Stripe checkout currency must be a lowercase ISO currency code.';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'Stripe checkout metadata must be a JSON object.';
  end if;

  select *
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if v_order.order_status = 'canceled' then
    raise exception 'Canceled orders cannot receive new Stripe checkout sessions.';
  end if;

  if v_order.payment_status in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'Already-paid orders cannot receive new Stripe checkout sessions.';
  end if;

  v_from_payment_status := v_order.payment_status;

  insert into public.stripe_checkout_sessions (
    store_id,
    order_id,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    stripe_customer_id,
    checkout_session_status,
    payment_status,
    amount_total_cents,
    currency,
    expires_at,
    metadata
  )
  values (
    v_order.store_id,
    v_order.id,
    v_stripe_checkout_session_id,
    v_stripe_payment_intent_id,
    v_stripe_customer_id,
    v_checkout_session_status,
    v_payment_status,
    p_amount_total_cents,
    v_currency,
    p_expires_at,
    v_metadata
  )
  on conflict (stripe_checkout_session_id) do update
  set
    stripe_payment_intent_id = coalesce(
      excluded.stripe_payment_intent_id,
      stripe_checkout_sessions.stripe_payment_intent_id
    ),
    stripe_customer_id = coalesce(
      excluded.stripe_customer_id,
      stripe_checkout_sessions.stripe_customer_id
    ),
    checkout_session_status = coalesce(
      excluded.checkout_session_status,
      stripe_checkout_sessions.checkout_session_status
    ),
    payment_status = coalesce(
      excluded.payment_status,
      stripe_checkout_sessions.payment_status
    ),
    amount_total_cents = coalesce(
      excluded.amount_total_cents,
      stripe_checkout_sessions.amount_total_cents
    ),
    currency = coalesce(excluded.currency, stripe_checkout_sessions.currency),
    expires_at = coalesce(excluded.expires_at, stripe_checkout_sessions.expires_at),
    metadata = excluded.metadata
  where stripe_checkout_sessions.order_id = v_order.id
    and stripe_checkout_sessions.store_id = v_order.store_id
  returning * into v_session;

  if v_session.id is null then
    raise exception 'Stripe checkout session is already linked to another order.';
  end if;

  update public.orders
  set
    payment_method = 'stripe_checkout',
    payment_provider = 'stripe',
    payment_status = 'unpaid',
    provider_payment_status = coalesce(v_payment_status, provider_payment_status),
    payment_provider_status_updated_at = now()
  where orders.id = v_order.id
  returning * into v_order;

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
    metadata
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    case when public.is_admin() then 'admin' else 'system' end,
    'payment_provider_checkout_session_recorded',
    v_order.order_status,
    v_order.order_status,
    v_from_payment_status,
    v_order.payment_status,
    jsonb_build_object(
      'stripe_checkout_session_id', v_session.stripe_checkout_session_id,
      'stripe_payment_intent_id', v_session.stripe_payment_intent_id,
      'checkout_session_status', v_session.checkout_session_status,
      'provider_payment_status', v_session.payment_status
    )
  );

  return v_session;
end;
$$;


create or replace function public.record_stripe_payment_succeeded(
  p_order_id uuid,
  p_payment_provider_event_id uuid,
  p_stripe_checkout_session_id text default null,
  p_stripe_payment_intent_id text default null,
  p_stripe_customer_id text default null,
  p_provider_payment_status text default 'succeeded',
  p_paid_at timestamptz default now()
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_event public.payment_provider_events%rowtype;
  v_from_payment_status text;
  v_stripe_checkout_session_id text;
  v_stripe_payment_intent_id text;
  v_stripe_customer_id text;
  v_provider_payment_status text;
begin
  if not public.can_process_payment_provider_events() then
    raise exception 'Not authorized to record Stripe payment results.';
  end if;

  v_stripe_checkout_session_id := nullif(trim(p_stripe_checkout_session_id), '');
  v_stripe_payment_intent_id := nullif(trim(p_stripe_payment_intent_id), '');
  v_stripe_customer_id := nullif(trim(p_stripe_customer_id), '');
  v_provider_payment_status := coalesce(nullif(trim(p_provider_payment_status), ''), 'succeeded');

  select *
  into v_event
  from public.payment_provider_events
  where payment_provider_events.id = p_payment_provider_event_id
  for update;

  if v_event.id is null then
    raise exception 'Payment provider event is not available.';
  end if;

  if v_event.provider <> 'stripe' then
    raise exception 'Payment provider event is not a Stripe event.';
  end if;

  select *
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if v_event.event_status = 'processed' then
    if v_event.related_order_id is not null
      and v_event.related_order_id <> v_order.id then
      raise exception 'Payment provider event was already processed for another order.';
    end if;

    return v_order;
  end if;

  if v_event.event_status <> 'processing' then
    raise exception 'Payment provider event must be claimed before recording payment success.';
  end if;

  if v_order.order_status = 'canceled' then
    raise exception 'Canceled orders cannot be marked paid by Stripe.';
  end if;

  if v_order.payment_status in ('partially_refunded', 'refunded') then
    raise exception 'Refunded orders cannot be marked paid again.';
  end if;

  if v_event.stripe_checkout_session_id is not null then
    if v_stripe_checkout_session_id is not null
      and v_stripe_checkout_session_id <> v_event.stripe_checkout_session_id then
      raise exception 'Stripe checkout session id does not match the provider event.';
    end if;

    if exists (
      select 1
      from public.stripe_checkout_sessions
      where stripe_checkout_sessions.stripe_checkout_session_id = v_event.stripe_checkout_session_id
        and stripe_checkout_sessions.order_id <> v_order.id
    ) then
      raise exception 'Stripe checkout session is already linked to another order.';
    end if;

    if not exists (
      select 1
      from public.stripe_checkout_sessions
      where stripe_checkout_sessions.order_id = v_order.id
        and stripe_checkout_sessions.stripe_checkout_session_id = v_event.stripe_checkout_session_id
    )
      and v_stripe_checkout_session_id is distinct from v_event.stripe_checkout_session_id then
      raise exception 'Provider event checkout session is not linked to this order.';
    end if;
  end if;

  if v_event.stripe_payment_intent_id is not null then
    if v_stripe_payment_intent_id is not null
      and v_stripe_payment_intent_id <> v_event.stripe_payment_intent_id then
      raise exception 'Stripe payment intent id does not match the provider event.';
    end if;

    if exists (
      select 1
      from public.stripe_checkout_sessions
      where stripe_checkout_sessions.stripe_payment_intent_id = v_event.stripe_payment_intent_id
        and stripe_checkout_sessions.order_id <> v_order.id
    ) then
      raise exception 'Stripe payment intent is already linked to another order.';
    end if;

    if not exists (
      select 1
      from public.stripe_checkout_sessions
      where stripe_checkout_sessions.order_id = v_order.id
        and stripe_checkout_sessions.stripe_payment_intent_id = v_event.stripe_payment_intent_id
    )
      and v_stripe_payment_intent_id is distinct from v_event.stripe_payment_intent_id then
      raise exception 'Provider event payment intent is not linked to this order.';
    end if;
  end if;

  v_from_payment_status := v_order.payment_status;

  if v_stripe_checkout_session_id is not null then
    update public.stripe_checkout_sessions
    set
      stripe_payment_intent_id = coalesce(
        v_stripe_payment_intent_id,
        stripe_checkout_sessions.stripe_payment_intent_id
      ),
      stripe_customer_id = coalesce(
        v_stripe_customer_id,
        stripe_checkout_sessions.stripe_customer_id
      ),
      checkout_session_status = 'complete',
      payment_status = 'paid'
    where stripe_checkout_sessions.order_id = v_order.id
      and stripe_checkout_sessions.stripe_checkout_session_id = v_stripe_checkout_session_id;
  end if;

  update public.orders
  set
    payment_method = 'stripe_checkout',
    payment_provider = 'stripe',
    payment_status = 'paid',
    provider_payment_status = v_provider_payment_status,
    payment_provider_status_updated_at = now(),
    paid_at = coalesce(p_paid_at, paid_at, now())
  where orders.id = v_order.id
  returning * into v_order;

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
    metadata
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    case when public.is_admin() then 'admin' else 'system' end,
    'payment_provider_payment_succeeded',
    v_order.order_status,
    v_order.order_status,
    v_from_payment_status,
    v_order.payment_status,
    jsonb_build_object(
      'payment_provider_event_id', v_event.id,
      'provider_event_id', v_event.provider_event_id,
      'stripe_checkout_session_id', v_stripe_checkout_session_id,
      'stripe_payment_intent_id', v_stripe_payment_intent_id,
      'provider_payment_status', v_provider_payment_status
    )
  );

  perform public.mark_payment_provider_event_processed(
    v_event.id,
    v_order.store_id,
    v_order.id,
    null
  );

  return v_order;
end;
$$;


create or replace function public.record_stripe_payment_failed(
  p_order_id uuid,
  p_payment_provider_event_id uuid,
  p_stripe_checkout_session_id text default null,
  p_provider_payment_status text default 'failed',
  p_failure_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_event public.payment_provider_events%rowtype;
  v_provider_payment_status text;
  v_failure_note text;
  v_from_payment_status text;
begin
  if not public.can_process_payment_provider_events() then
    raise exception 'Not authorized to record Stripe payment results.';
  end if;

  v_provider_payment_status := coalesce(nullif(trim(p_provider_payment_status), ''), 'failed');
  v_failure_note := nullif(trim(p_failure_note), '');

  select *
  into v_event
  from public.payment_provider_events
  where payment_provider_events.id = p_payment_provider_event_id
  for update;

  if v_event.id is null then
    raise exception 'Payment provider event is not available.';
  end if;

  if v_event.provider <> 'stripe' then
    raise exception 'Payment provider event is not a Stripe event.';
  end if;

  select *
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if v_event.event_status = 'processed' then
    if v_event.related_order_id is not null
      and v_event.related_order_id <> v_order.id then
      raise exception 'Payment provider event was already processed for another order.';
    end if;

    return v_order;
  end if;

  if v_event.event_status <> 'processing' then
    raise exception 'Payment provider event must be claimed before recording payment failure.';
  end if;

  if v_order.payment_status in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'Paid or refunded orders cannot be marked failed by Stripe.';
  end if;

  if v_event.stripe_checkout_session_id is not null then
    if nullif(trim(p_stripe_checkout_session_id), '') is not null
      and nullif(trim(p_stripe_checkout_session_id), '') <> v_event.stripe_checkout_session_id then
      raise exception 'Stripe checkout session id does not match the provider event.';
    end if;

    if exists (
      select 1
      from public.stripe_checkout_sessions
      where stripe_checkout_sessions.stripe_checkout_session_id = v_event.stripe_checkout_session_id
        and stripe_checkout_sessions.order_id <> v_order.id
    ) then
      raise exception 'Stripe checkout session is already linked to another order.';
    end if;

    if not exists (
      select 1
      from public.stripe_checkout_sessions
      where stripe_checkout_sessions.order_id = v_order.id
        and stripe_checkout_sessions.stripe_checkout_session_id = v_event.stripe_checkout_session_id
    )
      and nullif(trim(p_stripe_checkout_session_id), '') is distinct from v_event.stripe_checkout_session_id then
      raise exception 'Provider event checkout session is not linked to this order.';
    end if;
  end if;

  if v_event.stripe_payment_intent_id is not null then
    if exists (
      select 1
      from public.stripe_checkout_sessions
      where stripe_checkout_sessions.stripe_payment_intent_id = v_event.stripe_payment_intent_id
        and stripe_checkout_sessions.order_id <> v_order.id
    ) then
      raise exception 'Stripe payment intent is already linked to another order.';
    end if;

    if not exists (
      select 1
      from public.stripe_checkout_sessions
      where stripe_checkout_sessions.order_id = v_order.id
        and stripe_checkout_sessions.stripe_payment_intent_id = v_event.stripe_payment_intent_id
    ) then
      raise exception 'Provider event payment intent is not linked to this order.';
    end if;
  end if;

  v_from_payment_status := v_order.payment_status;

  if p_stripe_checkout_session_id is not null then
    update public.stripe_checkout_sessions
    set
      checkout_session_status = case
        when v_provider_payment_status = 'expired' then 'expired'
        else checkout_session_status
      end,
      payment_status = 'unpaid'
    where stripe_checkout_sessions.order_id = v_order.id
      and stripe_checkout_sessions.stripe_checkout_session_id = nullif(trim(p_stripe_checkout_session_id), '');
  end if;

  update public.orders
  set
    payment_method = 'stripe_checkout',
    payment_provider = 'stripe',
    payment_status = 'unpaid',
    provider_payment_status = v_provider_payment_status,
    payment_provider_status_updated_at = now()
  where orders.id = v_order.id
  returning * into v_order;

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
    auth.uid(),
    case when public.is_admin() then 'admin' else 'system' end,
    'payment_provider_payment_failed',
    v_order.order_status,
    v_order.order_status,
    v_from_payment_status,
    v_order.payment_status,
    v_failure_note,
    jsonb_build_object(
      'payment_provider_event_id', v_event.id,
      'provider_event_id', v_event.provider_event_id,
      'stripe_checkout_session_id', nullif(trim(p_stripe_checkout_session_id), ''),
      'provider_payment_status', v_provider_payment_status
    )
  );

  perform public.mark_payment_provider_event_processed(
    v_event.id,
    v_order.store_id,
    v_order.id,
    null
  );

  return v_order;
end;
$$;


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
declare
  v_event public.payment_provider_events%rowtype;
  v_refund public.order_refunds%rowtype;
  v_order public.orders%rowtype;
  v_provider_refund_id text;
  v_refund_status text;
  v_provider_status text;
  v_reserved_refund_total numeric(10, 2);
  v_succeeded_refund_total numeric(10, 2);
  v_from_payment_status text;
  v_new_payment_status text;
begin
  if not public.can_process_payment_provider_events() then
    raise exception 'Not authorized to record Stripe refund results.';
  end if;

  v_provider_refund_id := nullif(trim(p_provider_refund_id), '');
  v_refund_status := coalesce(nullif(trim(p_refund_status), ''), 'succeeded');
  v_provider_status := nullif(trim(p_provider_status), '');

  if v_provider_refund_id is null then
    raise exception 'Stripe refund id is required.';
  end if;

  if v_refund_status not in ('pending', 'succeeded', 'failed', 'canceled') then
    raise exception 'Refund status is not supported.';
  end if;

  select *
  into v_event
  from public.payment_provider_events
  where payment_provider_events.id = p_payment_provider_event_id
  for update;

  if v_event.id is null then
    raise exception 'Payment provider event is not available.';
  end if;

  if v_event.provider <> 'stripe' then
    raise exception 'Payment provider event is not a Stripe event.';
  end if;

  select *
  into v_refund
  from public.order_refunds
  where order_refunds.id = p_refund_id
  for update;

  if v_refund.id is null then
    raise exception 'Refund is not available.';
  end if;

  if v_event.event_status = 'processed' then
    if v_event.related_refund_id is not null
      and v_event.related_refund_id <> v_refund.id then
      raise exception 'Payment provider event was already processed for another refund.';
    end if;

    return v_refund;
  end if;

  if v_event.event_status <> 'processing' then
    raise exception 'Payment provider event must be claimed before recording refund results.';
  end if;

  if v_refund.refund_method <> 'stripe' then
    raise exception 'Only Stripe refunds can be updated from Stripe results.';
  end if;

  if v_event.provider_refund_id is not null
    and v_event.provider_refund_id <> v_provider_refund_id then
    raise exception 'Stripe refund id does not match the provider event.';
  end if;

  if v_refund.provider_refund_id is not null
    and v_refund.provider_refund_id <> v_provider_refund_id then
    raise exception 'Stripe refund id does not match the existing refund record.';
  end if;

  select *
  into v_order
  from public.orders
  where orders.id = v_refund.order_id
    and orders.store_id = v_refund.store_id
  for update;

  if v_order.id is null then
    raise exception 'Refund order is not available.';
  end if;

  if v_refund_status in ('pending', 'succeeded') then
    select coalesce(sum(order_refunds.refund_amount), 0)::numeric(10, 2)
    into v_reserved_refund_total
    from public.order_refunds
    where order_refunds.order_id = v_order.id
      and order_refunds.id <> v_refund.id
      and order_refunds.refund_status in ('pending', 'succeeded');

    if v_reserved_refund_total + v_refund.refund_amount > v_order.total_amount then
      raise exception 'Refund amount exceeds remaining refundable amount.';
    end if;
  end if;

  update public.order_refunds
  set
    refund_status = v_refund_status,
    provider_refund_id = v_provider_refund_id,
    provider_status = v_provider_status,
    processed_at = case
      when v_refund_status = 'succeeded'
        then coalesce(p_processed_at, processed_at, now())
      else processed_at
    end
  where order_refunds.id = v_refund.id
  returning * into v_refund;

  select coalesce(sum(order_refunds.refund_amount), 0)::numeric(10, 2)
  into v_succeeded_refund_total
  from public.order_refunds
  where order_refunds.order_id = v_order.id
    and order_refunds.refund_status = 'succeeded';

  v_from_payment_status := v_order.payment_status;

  if v_succeeded_refund_total >= v_order.total_amount then
    v_new_payment_status := 'refunded';
  elsif v_succeeded_refund_total > 0 then
    v_new_payment_status := 'partially_refunded';
  else
    v_new_payment_status := case
      when v_order.payment_status in ('partially_refunded', 'refunded')
        then 'paid'
      else v_order.payment_status
    end;
  end if;

  if v_new_payment_status <> v_order.payment_status then
    update public.orders
    set payment_status = v_new_payment_status
    where orders.id = v_order.id
    returning * into v_order;
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
    metadata
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    case when public.is_admin() then 'admin' else 'system' end,
    'payment_provider_refund_updated',
    v_order.order_status,
    v_order.order_status,
    v_from_payment_status,
    v_order.payment_status,
    jsonb_build_object(
      'payment_provider_event_id', v_event.id,
      'provider_event_id', v_event.provider_event_id,
      'refund_id', v_refund.id,
      'provider_refund_id', v_refund.provider_refund_id,
      'refund_status', v_refund.refund_status,
      'provider_status', v_refund.provider_status
    )
  );

  perform public.mark_payment_provider_event_processed(
    v_event.id,
    v_order.store_id,
    v_order.id,
    v_refund.id
  );

  return v_refund;
end;
$$;


comment on function public.record_payment_provider_event(text, text, text, jsonb, text, text, text) is
'Service/admin RPC to idempotently record and claim a provider webhook/event for processing. Returns should_process=false for duplicate in-flight, processed, or ignored events.';

comment on function public.mark_payment_provider_event_processed(uuid, uuid, uuid, uuid) is
'Service/admin RPC to mark a payment provider event processed after trusted reconciliation completes.';

comment on function public.mark_payment_provider_event_failed(uuid, text) is
'Service/admin RPC to mark a payment provider event failed so it can be inspected or retried later.';

comment on function public.record_stripe_checkout_session_for_order(uuid, text, text, text, text, text, bigint, text, timestamptz, jsonb) is
'Service/admin RPC to attach a Stripe-hosted Checkout Session to an existing order after the external Stripe API call succeeds.';

comment on function public.record_stripe_payment_succeeded(uuid, uuid, text, text, text, text, timestamptz) is
'Service/admin RPC to reconcile a successful Stripe payment event to an order. Does not call Stripe.';

comment on function public.record_stripe_payment_failed(uuid, uuid, text, text, text) is
'Service/admin RPC to reconcile a failed, canceled, or expired Stripe payment event to an order. Does not call Stripe.';

comment on function public.record_stripe_refund_result(uuid, uuid, text, text, text, timestamptz) is
'Service/admin RPC to reconcile a Stripe refund result to an existing refund record. Does not call Stripe.';

comment on function public.mark_order_paid(uuid, text) is
'Trusted seller/admin RPC to mark an eligible pay-at-pickup order paid and set paid_at for offline payment consistency.';

revoke all on function public.mark_order_paid(uuid, text) from public;
revoke all on function public.record_payment_provider_event(text, text, text, jsonb, text, text, text) from public;
revoke all on function public.mark_payment_provider_event_processed(uuid, uuid, uuid, uuid) from public;
revoke all on function public.mark_payment_provider_event_failed(uuid, text) from public;
revoke all on function public.record_stripe_checkout_session_for_order(uuid, text, text, text, text, text, bigint, text, timestamptz, jsonb) from public;
revoke all on function public.record_stripe_payment_succeeded(uuid, uuid, text, text, text, text, timestamptz) from public;
revoke all on function public.record_stripe_payment_failed(uuid, uuid, text, text, text) from public;
revoke all on function public.record_stripe_refund_result(uuid, uuid, text, text, text, timestamptz) from public;

grant execute on function public.mark_order_paid(uuid, text) to authenticated;
grant execute on function public.record_payment_provider_event(text, text, text, jsonb, text, text, text) to authenticated, service_role;
grant execute on function public.mark_payment_provider_event_processed(uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.mark_payment_provider_event_failed(uuid, text) to authenticated, service_role;
grant execute on function public.record_stripe_checkout_session_for_order(uuid, text, text, text, text, text, bigint, text, timestamptz, jsonb) to authenticated, service_role;
grant execute on function public.record_stripe_payment_succeeded(uuid, uuid, text, text, text, text, timestamptz) to authenticated, service_role;
grant execute on function public.record_stripe_payment_failed(uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.record_stripe_refund_result(uuid, uuid, text, text, text, timestamptz) to authenticated, service_role;
