-- One durable seller milestone email for the first accepted public storefront
-- order. Existing storefront sellers are backfilled as already achieved without
-- enqueuing historical email.

begin;

create table public.seller_first_sale_milestones (
  store_id uuid primary key references public.stores(id) on delete restrict,
  qualifying_order_id uuid not null unique,
  achieved_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint seller_first_sale_milestone_order_context_fk
    foreign key (qualifying_order_id, store_id)
    references public.orders(id, store_id)
    on delete restrict
);

alter table public.seller_first_sale_milestones enable row level security;
revoke all on table public.seller_first_sale_milestones
from public, anon, authenticated;
grant select, insert on table public.seller_first_sale_milestones
to service_role;

comment on table public.seller_first_sale_milestones is
'One authoritative first-public-storefront-sale marker per store. Backfilled rows suppress historical milestone email; new rows are created transactionally with the qualifying order.';

insert into public.seller_first_sale_milestones (
  store_id,
  qualifying_order_id,
  achieved_at
)
select distinct on (orders.store_id)
  orders.store_id,
  orders.id,
  orders.created_at
from public.orders as orders
where orders.order_source = 'storefront'
order by orders.store_id, orders.created_at, orders.id
on conflict (store_id) do nothing;

alter table public.email_notifications
  drop constraint email_notifications_notification_type_check,
  add constraint email_notifications_notification_type_check check (
    notification_type in (
      'buyer_order_confirmation',
      'seller_new_order',
      'buyer_order_updated',
      'seller_order_updated_copy',
      'buyer_order_canceled',
      'seller_order_canceled_copy',
      'seller_subscription_welcome',
      'seller_subscription_payment_failed',
      'seller_subscription_canceled',
      'seller_first_sale'
    )
  ),
  drop constraint email_notifications_context_check,
  add constraint email_notifications_context_check check (
    (
      notification_type = 'seller_subscription_welcome'
      and order_id is null
      and subscription_enrollment_id is not null
      and subscription_invoice_id is null
      and subscription_cancellation_episode_id is null
      and recipient_type = 'seller_account'
    )
    or
    (
      notification_type = 'seller_subscription_payment_failed'
      and order_id is null
      and subscription_enrollment_id is null
      and subscription_invoice_id is not null
      and subscription_cancellation_episode_id is null
      and recipient_type = 'seller_account'
    )
    or
    (
      notification_type = 'seller_subscription_canceled'
      and order_id is null
      and subscription_enrollment_id is null
      and subscription_invoice_id is null
      and subscription_cancellation_episode_id is not null
      and recipient_type = 'seller_account'
    )
    or
    (
      notification_type = 'seller_first_sale'
      and order_id is not null
      and subscription_enrollment_id is null
      and subscription_invoice_id is null
      and subscription_cancellation_episode_id is null
      and recipient_type = 'seller_account'
    )
    or
    (
      notification_type in (
        'buyer_order_confirmation',
        'seller_new_order',
        'buyer_order_updated',
        'seller_order_updated_copy',
        'buyer_order_canceled',
        'seller_order_canceled_copy'
      )
      and order_id is not null
      and subscription_enrollment_id is null
      and subscription_invoice_id is null
      and subscription_cancellation_episode_id is null
      and recipient_type in ('buyer', 'seller')
      and recipient_email is not null
    )
  );

create unique index email_notifications_one_first_sale_per_store_idx
  on public.email_notifications(store_id)
  where notification_type = 'seller_first_sale';

create function public.enqueue_seller_first_sale()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_qualifying_order_id uuid;
  v_recipient_email text;
begin
  if new.order_source <> 'storefront'
     or new.order_status <> 'open'
     or new.payment_method <> 'pay_at_pickup'
     or new.payment_status <> 'pay_at_pickup' then
    return new;
  end if;

  insert into public.seller_first_sale_milestones (
    store_id,
    qualifying_order_id,
    achieved_at
  ) values (
    new.store_id,
    new.id,
    new.created_at
  )
  on conflict (store_id) do nothing
  returning qualifying_order_id into v_qualifying_order_id;

  if v_qualifying_order_id is distinct from new.id then
    return new;
  end if;

  select nullif(btrim(users.email::text), '')
  into v_recipient_email
  from public.stores as stores
  left join auth.users as users on users.id = stores.owner_user_id
  where stores.id = new.store_id;

  insert into public.email_notifications (
    store_id,
    order_id,
    dedupe_key,
    recipient_type,
    recipient_email,
    notification_type,
    subject_snapshot,
    payload
  ) values (
    new.store_id,
    new.id,
    'seller_first_sale:store:' || new.store_id::text,
    'seller_account',
    v_recipient_email,
    'seller_first_sale',
    'You made your first FlockFront sale!',
    pg_catalog.jsonb_build_object(
      'schema_version', 'seller_first_sale_v1',
      'order_id', new.id
    )
  )
  on conflict do nothing;

  return new;
end;
$function$;

revoke all on function public.enqueue_seller_first_sale()
from public, anon, authenticated, service_role;

create trigger orders_enqueue_seller_first_sale
after insert on public.orders
for each row execute function public.enqueue_seller_first_sale();

create function public.get_seller_first_sale_context(p_order_id uuid)
returns table (
  recipient_email text,
  first_name text,
  order_id uuid,
  order_number text,
  order_total_cents bigint,
  buyer_first_name text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'SELLER_FIRST_SALE_CONTEXT_SERVICE_ROLE_REQUIRED';
  end if;

  return query
  select
    nullif(btrim(users.email::text), ''),
    nullif(btrim(users.raw_user_meta_data ->> 'first_name'), ''),
    orders.id,
    orders.order_number,
    pg_catalog.round(orders.total_amount * 100)::bigint,
    nullif(btrim(orders.buyer_first_name_snapshot), '')
  from public.seller_first_sale_milestones as milestone
  join public.orders as orders
    on orders.id = milestone.qualifying_order_id
   and orders.store_id = milestone.store_id
  join public.stores as stores on stores.id = milestone.store_id
  left join auth.users as users on users.id = stores.owner_user_id
  where milestone.qualifying_order_id = p_order_id
    and orders.order_source = 'storefront';
end;
$function$;

revoke all on function public.get_seller_first_sale_context(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_seller_first_sale_context(uuid)
to service_role;

comment on function public.get_seller_first_sale_context(uuid) is
'Service-only rendering context for the authenticated store owner and the authoritative qualifying storefront order.';

create or replace function public.claim_email_notifications_internal(
  p_order_id uuid,
  p_phase_1_only boolean,
  p_batch_size integer,
  p_max_attempts integer,
  p_stale_after interval
)
returns table (
  notification_id uuid,
  processing_token uuid,
  store_id uuid,
  order_id uuid,
  dedupe_key text,
  recipient_type text,
  recipient_email text,
  notification_type text,
  subject_snapshot text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'Batch size must be between 1 and 100.';
  end if;

  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'Max attempts must be at least 1.';
  end if;

  if p_stale_after is null or p_stale_after <= interval '0 seconds' then
    raise exception 'Stale processing interval must be positive.';
  end if;

  return query
  with claimable as (
    select notifications.id
    from public.email_notifications as notifications
    join public.stores as stores
      on stores.id = notifications.store_id
    left join public.orders as orders
      on orders.id = notifications.order_id
     and orders.store_id = notifications.store_id
    left join public.billing_subscription_enrollments as enrollment
      on enrollment.id = notifications.subscription_enrollment_id
     and enrollment.store_id = notifications.store_id
    left join public.seller_first_sale_milestones as first_sale
      on first_sale.qualifying_order_id = notifications.order_id
     and first_sale.store_id = notifications.store_id
    where (p_order_id is null or notifications.order_id = p_order_id)
      and notifications.notification_type in (
        'buyer_order_confirmation',
        'seller_new_order',
        'buyer_order_updated',
        'seller_order_updated_copy',
        'buyer_order_canceled',
        'seller_order_canceled_copy',
        'seller_subscription_welcome',
        'seller_first_sale'
      )
      and (
        not coalesce(p_phase_1_only, false)
        or notifications.notification_type in (
          'buyer_order_confirmation',
          'seller_new_order',
          'buyer_order_updated',
          'seller_order_updated_copy',
          'buyer_order_canceled',
          'seller_order_canceled_copy',
          'seller_subscription_welcome',
          'seller_first_sale'
        )
      )
      and (
        (
          orders.id is not null
          and notifications.recipient_type = 'buyer'
          and notifications.notification_type in (
            'buyer_order_confirmation',
            'buyer_order_updated',
            'buyer_order_canceled'
          )
          and lower(trim(notifications.recipient_email)) =
            lower(trim(orders.buyer_email_snapshot))
        )
        or (
          orders.id is not null
          and notifications.recipient_type = 'seller'
          and notifications.notification_type in (
            'seller_new_order',
            'seller_order_updated_copy',
            'seller_order_canceled_copy'
          )
          and lower(trim(notifications.recipient_email)) =
            lower(coalesce(
              nullif(trim(stores.order_notification_email), ''),
              nullif(trim(stores.communication_email), ''),
              nullif(trim(stores.public_email), '')
            ))
        )
        or (
          notifications.notification_type = 'seller_subscription_welcome'
          and notifications.recipient_type = 'seller_account'
          and notifications.order_id is null
          and enrollment.id is not null
          and notifications.dedupe_key =
            'seller_subscription_welcome:subscription:' ||
            enrollment.stripe_subscription_id
          and notifications.payload = pg_catalog.jsonb_build_object(
            'schema_version', 'seller_subscription_welcome_v1',
            'subscription_enrollment_id', enrollment.id
          )
        )
        or (
          notifications.notification_type = 'seller_first_sale'
          and notifications.recipient_type = 'seller_account'
          and orders.id is not null
          and orders.order_source = 'storefront'
          and first_sale.qualifying_order_id = orders.id
          and notifications.dedupe_key =
            'seller_first_sale:store:' || stores.id::text
          and notifications.subject_snapshot =
            'You made your first FlockFront sale!'
          and notifications.payload = pg_catalog.jsonb_build_object(
            'schema_version', 'seller_first_sale_v1',
            'order_id', orders.id
          )
        )
      )
      and (
        (
          notifications.notification_status in ('pending', 'failed')
          and notifications.next_attempt_at <= now()
          and notifications.attempt_count < p_max_attempts
        )
        or (
          notifications.notification_status = 'processing'
          and notifications.dispatch_started_at is null
          and notifications.processing_started_at <= now() - p_stale_after
          and notifications.attempt_count < p_max_attempts
        )
      )
    order by notifications.next_attempt_at, notifications.created_at
    limit p_batch_size
    for update of notifications skip locked
  ),
  claimed as (
    update public.email_notifications as notifications
    set
      notification_status = 'processing',
      attempt_count = notifications.attempt_count + 1,
      last_attempt_at = now(),
      processing_started_at = now(),
      processing_token = gen_random_uuid(),
      dispatch_attempt_id = null,
      dispatch_started_at = null,
      delivery_unknown_at = null
    from claimable
    where notifications.id = claimable.id
    returning
      notifications.id,
      notifications.processing_token,
      notifications.store_id,
      notifications.order_id,
      notifications.dedupe_key,
      notifications.recipient_type,
      notifications.recipient_email,
      notifications.notification_type,
      notifications.subject_snapshot,
      notifications.payload,
      notifications.attempt_count
  )
  select
    claimed.id,
    claimed.processing_token,
    claimed.store_id,
    claimed.order_id,
    claimed.dedupe_key,
    claimed.recipient_type,
    claimed.recipient_email,
    claimed.notification_type,
    claimed.subject_snapshot,
    claimed.payload,
    claimed.attempt_count
  from claimed
  order by claimed.attempt_count, claimed.id;
end;
$function$;

commit;
