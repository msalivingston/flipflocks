begin;

create table public.order_email_action_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_event_id uuid references public.order_events(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  action_type text not null,
  created_at timestamptz not null default now(),
  constraint order_email_action_type_check check (
    action_type in (
      'resend_confirmation',
      'order_updated_pair',
      'worker_kick'
    )
  )
);

create unique index order_email_action_event_unique_idx
on public.order_email_action_requests(action_type, order_event_id)
where order_event_id is not null;

create index order_email_action_order_created_idx
on public.order_email_action_requests(order_id, action_type, created_at desc);

create index order_email_action_store_created_idx
on public.order_email_action_requests(store_id, action_type, created_at desc);

alter table public.order_email_action_requests enable row level security;

comment on table public.order_email_action_requests is
'Server-created audit and quota ledger for narrow seller email actions. IDs are generated in the database and become trusted email deduplication identities.';

create or replace function public.seller_resend_order_confirmation(
  p_order_id uuid
)
returns table (
  notification_queued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_order public.orders%rowtype;
  v_action_id uuid;
  v_dedupe_suffix text;
begin
  if auth.uid() is null or p_order_id is null then
    raise exception 'Order is not available.';
  end if;

  select orders.store_id
  into v_store_id
  from public.orders as orders
  where orders.id = p_order_id
    and (public.owns_store(orders.store_id) or public.is_admin());

  if v_store_id is null then
    raise exception 'Order is not available.';
  end if;

  perform stores.id
  from public.stores as stores
  where stores.id = v_store_id
  for update;

  select orders.*
  into v_order
  from public.orders as orders
  where orders.id = p_order_id
    and orders.store_id = v_store_id
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if v_order.order_status = 'canceled' or v_order.canceled_at is not null then
    raise exception 'Canceled orders are not eligible for confirmation resend.';
  end if;

  if nullif(trim(coalesce(v_order.buyer_email_snapshot, '')), '') is null then
    notification_queued := false;
    return next;
    return;
  end if;

  if exists (
    select 1
    from public.order_email_action_requests as requests
    where requests.order_id = v_order.id
      and requests.action_type = 'resend_confirmation'
      and requests.created_at > now() - interval '60 seconds'
  ) then
    raise exception 'Email request is temporarily unavailable.';
  end if;

  if (
    select count(*)
    from public.order_email_action_requests as requests
    where requests.order_id = v_order.id
      and requests.action_type = 'resend_confirmation'
      and requests.created_at > now() - interval '1 hour'
  ) >= 3 then
    raise exception 'Email request limit reached.';
  end if;

  if (
    select count(*)
    from public.order_email_action_requests as requests
    where requests.store_id = v_order.store_id
      and requests.action_type = 'resend_confirmation'
      and requests.created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'Email request limit reached.';
  end if;

  insert into public.order_email_action_requests (
    store_id,
    order_id,
    actor_user_id,
    action_type
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    'resend_confirmation'
  )
  returning id into v_action_id;

  v_dedupe_suffix := 'request:' || v_action_id::text;

  perform public.enqueue_email_notification(
    v_order.store_id,
    v_order.id,
    'buyer_order_confirmation',
    'buyer',
    null,
    null,
    '{}'::jsonb,
    v_dedupe_suffix
  );

  select exists (
    select 1
    from public.email_notifications as notifications
    where notifications.order_id = v_order.id
      and notifications.store_id = v_order.store_id
      and notifications.notification_type = 'buyer_order_confirmation'
      and notifications.recipient_type = 'buyer'
      and notifications.dedupe_key =
        'buyer_order_confirmation:order:' ||
        v_order.id::text ||
        ':action:' ||
        v_dedupe_suffix
  )
  into notification_queued;

  return next;
end;
$$;

create or replace function public.seller_resend_order_confirmation(
  p_order_id uuid,
  p_email_action_id text
)
returns table (
  notification_queued boolean
)
language sql
security definer
set search_path = public
as $$
  select *
  from public.seller_resend_order_confirmation(p_order_id);
$$;

comment on function public.seller_resend_order_confirmation(uuid) is
'Authenticated owner/admin action that derives identity from auth.uid(), creates a server-side resend identity, enforces cooldown/hour/day quotas, and queues only the canonical buyer recipient.';

comment on function public.seller_resend_order_confirmation(uuid, text) is
'Deployment compatibility wrapper. The browser-provided action identifier is ignored and cannot affect authorization, deduplication, recipients, subjects, or payloads.';

create or replace function public.seller_enqueue_updated_order_email(
  p_order_id uuid
)
returns table (
  buyer_notification_queued boolean,
  seller_copy_queued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_order_event public.order_events%rowtype;
  v_action_id uuid;
  v_dedupe_suffix text;
begin
  if auth.uid() is null or p_order_id is null then
    raise exception 'Order is not available.';
  end if;

  select orders.store_id
  into v_store_id
  from public.orders as orders
  where orders.id = p_order_id
    and (public.owns_store(orders.store_id) or public.is_admin());

  if v_store_id is null then
    raise exception 'Order is not available.';
  end if;

  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = v_store_id
  for update;

  select orders.*
  into v_order
  from public.orders as orders
  where orders.id = p_order_id
    and orders.store_id = v_store_id
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if nullif(trim(coalesce(v_order.buyer_email_snapshot, '')), '') is null
    or coalesce(
      nullif(trim(v_store.order_notification_email), ''),
      nullif(trim(v_store.communication_email), ''),
      nullif(trim(v_store.public_email), '')
    ) is null then
    buyer_notification_queued := false;
    seller_copy_queued := false;
    return next;
    return;
  end if;

  select events.*
  into v_order_event
  from public.order_events as events
  where events.order_id = v_order.id
    and events.store_id = v_order.store_id
    and events.event_type = 'order_edited'
  order by events.created_at desc, events.id desc
  limit 1
  for update;

  if v_order_event.id is null then
    raise exception 'Order edit event is not available.';
  end if;

  select requests.id
  into v_action_id
  from public.order_email_action_requests as requests
  where requests.action_type = 'order_updated_pair'
    and requests.order_event_id = v_order_event.id;

  if v_action_id is null then
    if (
      select count(*)
      from public.order_email_action_requests as requests
      where requests.order_id = v_order.id
        and requests.action_type = 'order_updated_pair'
        and requests.created_at > now() - interval '1 hour'
    ) >= 10 then
      raise exception 'Email request limit reached.';
    end if;

    if (
      select count(*)
      from public.order_email_action_requests as requests
      where requests.store_id = v_order.store_id
        and requests.action_type = 'order_updated_pair'
        and requests.created_at > now() - interval '1 hour'
    ) >= 50 then
      raise exception 'Email request limit reached.';
    end if;

    insert into public.order_email_action_requests (
      store_id,
      order_id,
      order_event_id,
      actor_user_id,
      action_type
    )
    values (
      v_order.store_id,
      v_order.id,
      v_order_event.id,
      auth.uid(),
      'order_updated_pair'
    )
    on conflict (action_type, order_event_id)
      where order_event_id is not null
      do nothing
    returning id into v_action_id;

    if v_action_id is null then
      select requests.id
      into v_action_id
      from public.order_email_action_requests as requests
      where requests.action_type = 'order_updated_pair'
        and requests.order_event_id = v_order_event.id;
    end if;
  end if;

  v_dedupe_suffix := 'event:' || v_order_event.id::text;

  perform public.enqueue_email_notification(
    v_order.store_id,
    v_order.id,
    'buyer_order_updated',
    'buyer',
    null,
    null,
    '{}'::jsonb,
    v_dedupe_suffix
  );

  perform public.enqueue_email_notification(
    v_order.store_id,
    v_order.id,
    'seller_order_updated_copy',
    'seller',
    null,
    null,
    '{}'::jsonb,
    v_dedupe_suffix
  );

  select
    count(*) filter (
      where notifications.notification_type = 'buyer_order_updated'
    ) = 1,
    count(*) filter (
      where notifications.notification_type = 'seller_order_updated_copy'
    ) = 1
  into buyer_notification_queued, seller_copy_queued
  from public.email_notifications as notifications
  where notifications.order_id = v_order.id
    and notifications.store_id = v_order.store_id
    and notifications.dedupe_key in (
      'buyer_order_updated:order:' ||
        v_order.id::text ||
        ':action:' ||
        v_dedupe_suffix,
      'seller_order_updated_copy:order:' ||
        v_order.id::text ||
        ':action:' ||
        v_dedupe_suffix
    );

  if not buyer_notification_queued or not seller_copy_queued then
    raise exception 'Order email pair could not be queued.';
  end if;

  return next;
end;
$$;

create or replace function public.seller_enqueue_updated_order_email(
  p_order_id uuid,
  p_email_action_id text
)
returns table (
  buyer_notification_queued boolean,
  seller_copy_queued boolean
)
language sql
security definer
set search_path = public
as $$
  select *
  from public.seller_enqueue_updated_order_email(p_order_id);
$$;

comment on function public.seller_enqueue_updated_order_email(uuid) is
'Authenticated owner/admin action that binds one atomic buyer/seller pair to the latest trusted order_edited event and derives recipients and content from canonical records.';

comment on function public.seller_enqueue_updated_order_email(uuid, text) is
'Deployment compatibility wrapper. The browser-provided action identifier is ignored; the trusted order_edited event is the canonical deduplication identity.';

create or replace function public.seller_request_order_email_processing(
  p_order_id uuid
)
returns table (
  authorized_order_id uuid,
  queued_notification_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_order public.orders%rowtype;
  v_queued_count integer;
begin
  if auth.uid() is null or p_order_id is null then
    raise exception 'Order is not available.';
  end if;

  select orders.store_id
  into v_store_id
  from public.orders as orders
  where orders.id = p_order_id
    and (public.owns_store(orders.store_id) or public.is_admin());

  if v_store_id is null then
    raise exception 'Order is not available.';
  end if;

  perform stores.id
  from public.stores as stores
  where stores.id = v_store_id
  for update;

  select orders.*
  into v_order
  from public.orders as orders
  where orders.id = p_order_id
    and orders.store_id = v_store_id
  for update;

  select count(*)::integer
  into v_queued_count
  from public.email_notifications as notifications
  where notifications.order_id = v_order.id
    and notifications.store_id = v_order.store_id
    and notifications.notification_type in (
      'buyer_order_confirmation',
      'seller_new_order',
      'buyer_order_updated',
      'seller_order_updated_copy',
      'buyer_order_canceled',
      'seller_order_canceled_copy'
    )
    and notifications.notification_status in ('pending', 'failed')
    and notifications.next_attempt_at <= now();

  if v_queued_count = 0 then
    authorized_order_id := v_order.id;
    queued_notification_count := 0;
    return next;
    return;
  end if;

  if exists (
    select 1
    from public.order_email_action_requests as requests
    where requests.order_id = v_order.id
      and requests.action_type = 'worker_kick'
      and requests.created_at > now() - interval '15 seconds'
  ) then
    raise exception 'Email processing request is temporarily unavailable.';
  end if;

  if (
    select count(*)
    from public.order_email_action_requests as requests
    where requests.order_id = v_order.id
      and requests.action_type = 'worker_kick'
      and requests.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Email processing request limit reached.';
  end if;

  if (
    select count(*)
    from public.order_email_action_requests as requests
    where requests.store_id = v_order.store_id
      and requests.action_type = 'worker_kick'
      and requests.created_at > now() - interval '1 day'
  ) >= 100 then
    raise exception 'Email processing request limit reached.';
  end if;

  insert into public.order_email_action_requests (
    store_id,
    order_id,
    actor_user_id,
    action_type
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    'worker_kick'
  );

  authorized_order_id := v_order.id;
  queued_notification_count := v_queued_count;
  return next;
end;
$$;

comment on function public.seller_request_order_email_processing(uuid) is
'Authenticated owner/admin worker-kick authorization. It locks the canonical store/order, applies per-order and per-store quotas, and returns only the authorized order scope.';

revoke all on function public.seller_resend_order_confirmation(uuid)
from public, anon, authenticated, service_role;

revoke all on function public.seller_resend_order_confirmation(uuid, text)
from public, anon, authenticated, service_role;

revoke all on function public.seller_enqueue_updated_order_email(uuid)
from public, anon, authenticated, service_role;

revoke all on function public.seller_enqueue_updated_order_email(uuid, text)
from public, anon, authenticated, service_role;

revoke all on function public.seller_request_order_email_processing(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.seller_resend_order_confirmation(uuid)
to authenticated;

grant execute on function public.seller_resend_order_confirmation(uuid, text)
to authenticated;

grant execute on function public.seller_enqueue_updated_order_email(uuid)
to authenticated;

grant execute on function public.seller_enqueue_updated_order_email(uuid, text)
to authenticated;

grant execute on function public.seller_request_order_email_processing(uuid)
to authenticated;

commit;
