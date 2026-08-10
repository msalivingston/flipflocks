-- Durable seller welcome notification for the first verified Stripe enrollment.
-- The enrollment trigger only records outbox work; email delivery remains
-- independent of billing authority and uses the existing Postmark worker.

begin;

alter table public.email_notifications
  alter column order_id drop not null,
  alter column recipient_email drop not null,
  add column subscription_enrollment_id uuid;

alter table public.email_notifications
  add constraint email_notifications_subscription_enrollment_fk
  foreign key (subscription_enrollment_id, store_id)
  references public.billing_subscription_enrollments(id, store_id)
  on delete restrict;

alter table public.email_notifications
  drop constraint email_notifications_recipient_type_check,
  add constraint email_notifications_recipient_type_check check (
    recipient_type in ('buyer', 'seller', 'seller_account')
  ),
  drop constraint email_notifications_recipient_email_not_empty_check,
  add constraint email_notifications_recipient_email_not_empty_check check (
    recipient_email is null or length(trim(recipient_email)) > 0
  ),
  drop constraint email_notifications_notification_type_check,
  add constraint email_notifications_notification_type_check check (
    notification_type in (
      'buyer_order_confirmation',
      'seller_new_order',
      'buyer_order_updated',
      'seller_order_updated_copy',
      'buyer_order_canceled',
      'seller_order_canceled_copy',
      'seller_subscription_welcome'
    )
  ),
  add constraint email_notifications_context_check check (
    (
      notification_type = 'seller_subscription_welcome'
      and order_id is null
      and subscription_enrollment_id is not null
      and recipient_type = 'seller_account'
    )
    or
    (
      notification_type <> 'seller_subscription_welcome'
      and order_id is not null
      and subscription_enrollment_id is null
      and recipient_type in ('buyer', 'seller')
      and recipient_email is not null
    )
  );

create unique index email_notifications_one_seller_welcome_per_store_idx
  on public.email_notifications(store_id, notification_type)
  where notification_type = 'seller_subscription_welcome';

comment on column public.email_notifications.subscription_enrollment_id is
'Verified immutable Stripe enrollment that authorizes a seller lifecycle email. Null for order email types.';

alter table public.email_notification_delivery_attempts
  alter column order_id drop not null,
  add column subscription_enrollment_id uuid;

alter table public.email_notification_delivery_attempts
  add constraint email_delivery_attempt_subscription_enrollment_fk
  foreign key (subscription_enrollment_id, store_id)
  references public.billing_subscription_enrollments(id, store_id)
  on delete restrict,
  add constraint email_delivery_attempt_context_check check (
    (order_id is not null and subscription_enrollment_id is null)
    or (order_id is null and subscription_enrollment_id is not null)
  );

create or replace function public.enqueue_first_seller_subscription_welcome()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_recipient_email text;
  v_has_trial boolean := new.trial_started_at is not null
    and new.trial_ends_at is not null;
begin
  -- A later replacement subscription, reactivation, renewal, or plan change
  -- must not create another welcome message for this store.
  if exists (
    select 1
    from public.billing_subscription_enrollments as prior
    where prior.store_id = new.store_id
      and prior.id <> new.id
  ) then
    return new;
  end if;

  select nullif(btrim(users.email::text), '')
  into v_recipient_email
  from public.stores as stores
  join auth.users as users on users.id = stores.owner_user_id
  where stores.id = new.store_id;

  insert into public.email_notifications (
    store_id,
    order_id,
    subscription_enrollment_id,
    dedupe_key,
    recipient_type,
    recipient_email,
    notification_type,
    subject_snapshot,
    payload
  ) values (
    new.store_id,
    null,
    new.id,
    'seller_subscription_welcome:subscription:' || new.stripe_subscription_id,
    'seller_account',
    v_recipient_email,
    'seller_subscription_welcome',
    case when v_has_trial
      then 'Welcome to FlockFront — your free trial has started'
      else 'Welcome to FlockFront — your subscription is active'
    end,
    pg_catalog.jsonb_build_object(
      'schema_version', 'seller_subscription_welcome_v1',
      'subscription_enrollment_id', new.id
    )
  )
  on conflict do nothing;

  return new;
exception
  when others then
    -- Notification plumbing must never invalidate an otherwise valid verified
    -- billing enrollment. The database log retains the diagnostic for repair.
    raise warning 'Seller welcome enqueue failed for verified enrollment: %',
      sqlerrm;
    return new;
end;
$function$;

revoke all on function public.enqueue_first_seller_subscription_welcome()
from public, anon, authenticated, service_role;

create trigger billing_subscription_enrollments_enqueue_first_welcome
after insert on public.billing_subscription_enrollments
for each row
execute function public.enqueue_first_seller_subscription_welcome();

create or replace function public.get_seller_subscription_welcome_context(
  p_subscription_enrollment_id uuid
)
returns table (
  recipient_email text,
  first_name text,
  public_plan_name text,
  billing_cadence_label text,
  first_charge_amount_cents bigint,
  currency text,
  first_charge_at timestamptz,
  has_trial boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
  select
    nullif(btrim(users.email::text), '') as recipient_email,
    nullif(btrim(users.raw_user_meta_data ->> 'first_name'), '') as first_name,
    case catalog.plan_key
      when 'small_flock' then 'Coop'
      when 'full_flock' then 'Market'
    end as public_plan_name,
    case catalog.billing_cadence
      when 'monthly' then 'Monthly'
      when 'yearly' then 'Annual'
    end as billing_cadence_label,
    catalog.unit_amount_cents as first_charge_amount_cents,
    catalog.currency,
    case
      when enrollment.trial_started_at is not null
        and enrollment.trial_ends_at is not null
        then enrollment.trial_ends_at
      else billing.current_period_start
    end as first_charge_at,
    enrollment.trial_started_at is not null
      and enrollment.trial_ends_at is not null as has_trial
  from public.billing_subscription_enrollments as enrollment
  join public.stores as stores on stores.id = enrollment.store_id
  left join auth.users as users on users.id = stores.owner_user_id
  left join public.billing_provider_price_catalog as catalog
    on catalog.stripe_price_id = enrollment.initial_stripe_price_id
   and catalog.stripe_livemode = enrollment.stripe_livemode
   and catalog.stripe_account_id = enrollment.stripe_account_id
   and catalog.is_verified
  left join public.seller_billing_status as billing
    on billing.store_id = enrollment.store_id
   and billing.current_subscription_enrollment_id = enrollment.id
  where enrollment.id = p_subscription_enrollment_id;
$function$;

revoke all on function public.get_seller_subscription_welcome_context(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_seller_subscription_welcome_context(uuid)
to service_role;

comment on function public.get_seller_subscription_welcome_context(uuid) is
'Service-only resolution of recipient and billing copy from the authenticated store owner, immutable verified enrollment, current billing snapshot, and verified Price catalog.';

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
    where (p_order_id is null or notifications.order_id = p_order_id)
      and notifications.notification_type in (
        'buyer_order_confirmation',
        'seller_new_order',
        'buyer_order_updated',
        'seller_order_updated_copy',
        'buyer_order_canceled',
        'seller_order_canceled_copy',
        'seller_subscription_welcome'
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
          'seller_subscription_welcome'
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

create or replace function public.begin_email_notification_dispatch(
  p_notification_id uuid,
  p_processing_token uuid
)
returns table (dispatch_attempt_id uuid)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_notification public.email_notifications%rowtype;
  v_dispatch_attempt_id uuid;
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;

  select notifications.* into v_notification
  from public.email_notifications as notifications
  where notifications.id = p_notification_id
    and notifications.processing_token = p_processing_token
    and notifications.notification_status in ('processing', 'dispatching')
  for update;

  if v_notification.id is null then
    raise exception 'Processing notification claim was not found.';
  end if;

  if v_notification.notification_status = 'dispatching' then
    dispatch_attempt_id := v_notification.dispatch_attempt_id;
    return next;
    return;
  end if;

  v_dispatch_attempt_id := gen_random_uuid();

  insert into public.email_notification_delivery_attempts (
    id, notification_id, store_id, order_id, subscription_enrollment_id,
    attempt_number, attempt_status, provider_name, started_at
  ) values (
    v_dispatch_attempt_id, v_notification.id, v_notification.store_id,
    v_notification.order_id, v_notification.subscription_enrollment_id,
    v_notification.attempt_count, 'dispatching', 'postmark', now()
  );

  update public.email_notifications as notifications
  set notification_status = 'dispatching',
      dispatch_attempt_id = v_dispatch_attempt_id,
      dispatch_started_at = now(),
      delivery_unknown_at = null
  where notifications.id = v_notification.id;

  dispatch_attempt_id := v_dispatch_attempt_id;
  return next;
end;
$function$;

revoke all on function public.get_seller_subscription_welcome_context(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_seller_subscription_welcome_context(uuid)
to service_role;

commit;
