-- Add a service-role-only, database-backed rate limiter for public checkout.
-- Idempotency retries are exempt only after the authoritative order
-- idempotency record has been linked to a successfully created order.

create table public.public_checkout_rate_limit_buckets (
  store_id uuid not null references public.stores(id) on delete cascade,
  scope text not null,
  identifier_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),

  primary key (store_id, scope, identifier_hash, window_started_at),

  constraint public_checkout_rate_limit_buckets_scope_check check (
    scope in ('store', 'store_email', 'store_ip')
  ),
  constraint public_checkout_rate_limit_buckets_identifier_hash_check check (
    identifier_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint public_checkout_rate_limit_buckets_request_count_check check (
    request_count > 0
  )
);

comment on table public.public_checkout_rate_limit_buckets is
'Internal fixed-window counters for the public checkout Edge Function. Contains only hashed buyer identifiers and is accessible only to service-role checkout infrastructure.';

create index public_checkout_rate_limit_buckets_window_idx
on public.public_checkout_rate_limit_buckets(window_started_at);

alter table public.public_checkout_rate_limit_buckets enable row level security;

revoke all on public.public_checkout_rate_limit_buckets from public;
revoke all on public.public_checkout_rate_limit_buckets from anon;
revoke all on public.public_checkout_rate_limit_buckets from authenticated;


create or replace function public.consume_public_checkout_rate_limit(
  p_store_id uuid,
  p_idempotency_key text,
  p_buyer_email text,
  p_buyer_ip text default null,
  p_store_email_limit integer default 6,
  p_store_ip_limit integer default 30,
  p_store_limit integer default 120
)
returns table (
  allowed boolean,
  authoritative_retry boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_idempotency_key text := nullif(trim(p_idempotency_key), '');
  v_buyer_email text := lower(nullif(trim(p_buyer_email), ''));
  v_buyer_ip text;
  v_window_started_at timestamptz;
  v_window_ends_at timestamptz;
  v_store_hash text;
  v_email_hash text;
  v_ip_hash text;
  v_store_count integer := 0;
  v_email_count integer := 0;
  v_ip_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authorized to consume public checkout rate limits.';
  end if;

  if p_store_id is null then
    raise exception 'Store is required for checkout rate limiting.';
  end if;

  if v_idempotency_key is null or length(v_idempotency_key) > 200 then
    raise exception 'A valid idempotency key is required for checkout rate limiting.';
  end if;

  if v_buyer_email is null then
    raise exception 'Buyer email is required for checkout rate limiting.';
  end if;

  if p_store_email_limit <= 0 or p_store_ip_limit <= 0 or p_store_limit <= 0 then
    raise exception 'Checkout rate limits must be positive.';
  end if;

  begin
    v_buyer_ip := host(nullif(trim(p_buyer_ip), '')::inet);
  exception
    when invalid_text_representation then
      v_buyer_ip := null;
  end;

  -- Only an idempotency record linked to an actual order is authoritative.
  -- Failed order transactions roll their idempotency inserts back and must
  -- continue consuming capacity when retried.
  if exists (
    select 1
    from public.order_idempotency_keys as idempotency_keys
    where idempotency_keys.store_id = p_store_id
      and idempotency_keys.idempotency_key = v_idempotency_key
      and idempotency_keys.order_id is not null
  ) then
    return query select true, true, 0;
    return;
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / 900) * 900
  );
  v_window_ends_at := v_window_started_at + interval '15 minutes';

  v_store_hash := encode(
    digest(p_store_id::text, 'sha256'),
    'hex'
  );
  v_email_hash := encode(
    digest(p_store_id::text || ':' || v_buyer_email, 'sha256'),
    'hex'
  );

  if v_buyer_ip is not null then
    v_ip_hash := encode(
      digest(p_store_id::text || ':' || v_buyer_ip, 'sha256'),
      'hex'
    );
  end if;

  -- Advisory locks serialize competing requests in a consistent order. This
  -- lets all dimensions be checked before any counter is incremented.
  perform pg_advisory_xact_lock(
    hashtextextended('public-checkout-rate:store:' || p_store_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      'public-checkout-rate:email:' || p_store_id::text || ':' || v_email_hash,
      0
    )
  );

  if v_ip_hash is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        'public-checkout-rate:ip:' || p_store_id::text || ':' || v_ip_hash,
        0
      )
    );
  end if;

  select coalesce(max(buckets.request_count), 0)
  into v_store_count
  from public.public_checkout_rate_limit_buckets as buckets
  where buckets.store_id = p_store_id
    and buckets.scope = 'store'
    and buckets.identifier_hash = v_store_hash
    and buckets.window_started_at = v_window_started_at;

  select coalesce(max(buckets.request_count), 0)
  into v_email_count
  from public.public_checkout_rate_limit_buckets as buckets
  where buckets.store_id = p_store_id
    and buckets.scope = 'store_email'
    and buckets.identifier_hash = v_email_hash
    and buckets.window_started_at = v_window_started_at;

  if v_ip_hash is not null then
    select coalesce(max(buckets.request_count), 0)
    into v_ip_count
    from public.public_checkout_rate_limit_buckets as buckets
    where buckets.store_id = p_store_id
      and buckets.scope = 'store_ip'
      and buckets.identifier_hash = v_ip_hash
      and buckets.window_started_at = v_window_started_at;
  end if;

  if v_email_count >= p_store_email_limit
    or v_ip_count >= p_store_ip_limit
    or v_store_count >= p_store_limit then
    return query
    select
      false,
      false,
      greatest(
        1,
        ceil(extract(epoch from (v_window_ends_at - clock_timestamp())))::integer
      );
    return;
  end if;

  insert into public.public_checkout_rate_limit_buckets (
    store_id,
    scope,
    identifier_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_store_id,
    'store',
    v_store_hash,
    v_window_started_at,
    1,
    now()
  )
  on conflict (store_id, scope, identifier_hash, window_started_at)
  do update set
    request_count = public_checkout_rate_limit_buckets.request_count + 1,
    updated_at = now();

  insert into public.public_checkout_rate_limit_buckets (
    store_id,
    scope,
    identifier_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_store_id,
    'store_email',
    v_email_hash,
    v_window_started_at,
    1,
    now()
  )
  on conflict (store_id, scope, identifier_hash, window_started_at)
  do update set
    request_count = public_checkout_rate_limit_buckets.request_count + 1,
    updated_at = now();

  if v_ip_hash is not null then
    insert into public.public_checkout_rate_limit_buckets (
      store_id,
      scope,
      identifier_hash,
      window_started_at,
      request_count,
      updated_at
    )
    values (
      p_store_id,
      'store_ip',
      v_ip_hash,
      v_window_started_at,
      1,
      now()
    )
    on conflict (store_id, scope, identifier_hash, window_started_at)
    do update set
      request_count = public_checkout_rate_limit_buckets.request_count + 1,
      updated_at = now();
  end if;

  -- Keep operational data bounded without requiring a scheduler at launch.
  delete from public.public_checkout_rate_limit_buckets as expired_buckets
  where expired_buckets.window_started_at
    < v_window_started_at - interval '24 hours';

  return query select true, false, 0;
end;
$$;

comment on function public.consume_public_checkout_rate_limit(
  uuid,
  text,
  text,
  text,
  integer,
  integer,
  integer
) is
'Service-role-only atomic public checkout limiter. Applies store, store/email, and store/IP fixed-window limits. Retries bypass counters only when order_idempotency_keys already links the store/key to an order.';

revoke all on function public.consume_public_checkout_rate_limit(
  uuid,
  text,
  text,
  text,
  integer,
  integer,
  integer
) from public;

grant execute on function public.consume_public_checkout_rate_limit(
  uuid,
  text,
  text,
  text,
  integer,
  integer,
  integer
) to service_role;
