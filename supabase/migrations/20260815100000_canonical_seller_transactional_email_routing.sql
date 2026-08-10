-- Route every order-related seller notification to the authenticated store
-- owner's current account email. Buyer recipients remain immutable order
-- snapshots. Legacy seller-copy rows are rebound in place without changing
-- their notification identity or delivery state.

begin;

create or replace function public.enqueue_email_notification(
  p_store_id uuid,
  p_order_id uuid,
  p_notification_type text,
  p_recipient_type text,
  p_recipient_email text,
  p_subject_snapshot text,
  p_payload jsonb,
  p_dedupe_suffix text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_notification_type text;
  v_recipient_type text;
  v_recipient_email text;
  v_subject_snapshot text;
  v_dedupe_suffix text := nullif(trim(coalesce(p_dedupe_suffix, '')), '');
  v_dedupe_key text;
  v_payload jsonb;
begin
  if p_order_id is null then
    raise exception 'Order is required to enqueue email notification.';
  end if;

  select orders.*
  into v_order
  from public.orders as orders
  where orders.id = p_order_id;

  if v_order.id is null
    or p_store_id is null
    or v_order.store_id <> p_store_id then
    raise exception 'Order is not available.';
  end if;

  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = v_order.store_id;

  v_notification_type := case nullif(trim(coalesce(p_notification_type, '')), '')
    when 'buyer_order_received' then 'buyer_order_confirmation'
    when 'seller_new_order_received' then 'seller_new_order'
    else nullif(trim(coalesce(p_notification_type, '')), '')
  end;

  if v_notification_type = 'buyer_order_fulfilled' then
    return;
  end if;

  if v_notification_type not in (
    'buyer_order_confirmation',
    'seller_new_order',
    'buyer_order_updated',
    'seller_order_updated_copy',
    'buyer_order_canceled',
    'seller_order_canceled_copy'
  ) then
    raise exception 'Invalid email notification type.';
  end if;

  v_recipient_type := case
    when v_notification_type in (
      'buyer_order_confirmation',
      'buyer_order_updated',
      'buyer_order_canceled'
    ) then 'buyer'
    else 'seller'
  end;

  if nullif(trim(coalesce(p_recipient_type, '')), '') is not null
    and trim(p_recipient_type) <> v_recipient_type then
    raise exception 'Invalid email notification recipient type.';
  end if;

  v_recipient_email := case
    when v_recipient_type = 'buyer' then
      lower(nullif(trim(v_order.buyer_email_snapshot), ''))
    else (
      select lower(nullif(trim(users.email::text), ''))
      from auth.users as users
      where users.id = v_store.owner_user_id
    )
  end;

  if v_recipient_email is null then
    return;
  end if;

  if v_notification_type in (
      'buyer_order_updated',
      'seller_order_updated_copy',
      'buyer_order_canceled',
      'seller_order_canceled_copy'
    )
    and v_dedupe_suffix is null then
    raise exception 'Email notification action identifier is required.';
  end if;

  if v_dedupe_suffix is not null and length(v_dedupe_suffix) > 160 then
    raise exception 'Email notification action identifier is too long.';
  end if;

  v_subject_snapshot := case v_notification_type
    when 'buyer_order_confirmation' then
      'Your order with ' ||
      coalesce(nullif(trim(v_store.store_name), ''), 'your store') ||
      ' is confirmed ' || chr(8212) || ' #' || v_order.order_number
    when 'seller_new_order' then
      'New order from ' || v_order.buyer_first_name_snapshot ||
      ' ' || chr(8212) || ' Order #' || v_order.order_number
    when 'buyer_order_updated' then
      'Your order with ' ||
      coalesce(nullif(trim(v_store.store_name), ''), 'your store') ||
      ' has been updated ' || chr(8212) || ' #' || v_order.order_number
    when 'seller_order_updated_copy' then
      'Customer copy: Updated order #' || v_order.order_number
    when 'buyer_order_canceled' then
      'Order canceled: #' || v_order.order_number
    when 'seller_order_canceled_copy' then
      'Customer copy: Canceled order #' || v_order.order_number
  end;

  v_payload := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'store_id', v_order.store_id,
    'store_name', v_store.store_name,
    'store_slug', v_store.store_slug,
    'buyer_first_name', v_order.buyer_first_name_snapshot,
    'buyer_last_name', v_order.buyer_last_name_snapshot,
    'buyer_email', v_order.buyer_email_snapshot,
    'order_status', v_order.order_status,
    'payment_status', v_order.payment_status,
    'total_amount', v_order.total_amount,
    'created_at', v_order.created_at,
    'canceled_at', v_order.canceled_at,
    'canceled_reason', v_order.canceled_reason,
    'server_action_id', v_dedupe_suffix,
    'resend', (
      v_notification_type = 'buyer_order_confirmation'
      and v_dedupe_suffix is not null
    )
  );

  v_dedupe_key := v_notification_type || ':order:' || v_order.id::text ||
    case
      when v_dedupe_suffix is null then ''
      else ':action:' || v_dedupe_suffix
    end;

  insert into public.email_notifications (
    store_id,
    order_id,
    dedupe_key,
    recipient_type,
    recipient_email,
    notification_type,
    notification_status,
    subject_snapshot,
    payload
  )
  values (
    v_order.store_id,
    v_order.id,
    v_dedupe_key,
    v_recipient_type,
    v_recipient_email,
    v_notification_type,
    'pending',
    v_subject_snapshot,
    v_payload
  )
  on conflict (dedupe_key) do nothing;
end;
$function$;

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
as $function$
declare
  v_store_id uuid;
  v_order public.orders%rowtype;
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

  perform 1
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

  if nullif(trim(coalesce(v_order.buyer_email_snapshot, '')), '') is null then
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
$function$;

-- Rebind only notifications that have not begun provider dispatch. Their IDs,
-- dedupe keys, attempts, retry schedule, and delivery state remain unchanged.
update public.email_notifications as notifications
set recipient_email = lower(trim(owners.email::text))
from public.stores as stores
join auth.users as owners on owners.id = stores.owner_user_id
where stores.id = notifications.store_id
  and notifications.notification_type in (
    'seller_order_updated_copy',
    'seller_order_canceled_copy'
  )
  and notifications.recipient_type = 'seller'
  and notifications.notification_status in ('pending', 'failed', 'processing')
  and notifications.dispatch_started_at is null
  and nullif(trim(owners.email::text), '') is not null
  and notifications.recipient_email is distinct from lower(trim(owners.email::text));

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
set search_path = pg_catalog, public, auth
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
    select
      notifications.id,
      case
        when notifications.notification_type in (
          'seller_order_updated_copy',
          'seller_order_canceled_copy'
        ) then lower(trim(owners.email::text))
        else notifications.recipient_email
      end as canonical_recipient_email
    from public.email_notifications as notifications
    join public.stores as stores
      on stores.id = notifications.store_id
    left join auth.users as owners on owners.id = stores.owner_user_id
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
          and notifications.notification_type = 'seller_new_order'
          and lower(trim(notifications.recipient_email)) =
            lower(trim(owners.email::text))
        )
        or (
          orders.id is not null
          and notifications.recipient_type = 'seller'
          and notifications.notification_type in (
            'seller_order_updated_copy',
            'seller_order_canceled_copy'
          )
          and nullif(trim(owners.email::text), '') is not null
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
      recipient_email = claimable.canonical_recipient_email,
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
