-- Internal admin notification for a seller's first verified Stripe enrollment.
-- Existing enrollments are intentionally not backfilled: only future inserts
-- can fire the enrollment trigger defined below.

begin;

alter table public.email_notifications
  drop constraint email_notifications_recipient_type_check,
  add constraint email_notifications_recipient_type_check check (
    recipient_type in ('buyer', 'seller', 'seller_account', 'admin')
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
      'seller_subscription_welcome',
      'seller_subscription_payment_failed',
      'seller_subscription_canceled',
      'seller_first_sale',
      'admin_new_subscriber'
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
    or (
      notification_type = 'admin_new_subscriber'
      and order_id is null
      and subscription_enrollment_id is not null
      and subscription_invoice_id is null
      and subscription_cancellation_episode_id is null
      and recipient_type = 'admin'
      and lower(btrim(recipient_email)) = 'hello@flockfront.com'
    )
    or (
      notification_type = 'seller_subscription_payment_failed'
      and order_id is null
      and subscription_enrollment_id is null
      and subscription_invoice_id is not null
      and subscription_cancellation_episode_id is null
      and recipient_type = 'seller_account'
    )
    or (
      notification_type = 'seller_subscription_canceled'
      and order_id is null
      and subscription_enrollment_id is null
      and subscription_invoice_id is null
      and subscription_cancellation_episode_id is not null
      and recipient_type = 'seller_account'
    )
    or (
      notification_type = 'seller_first_sale'
      and order_id is not null
      and subscription_enrollment_id is null
      and subscription_invoice_id is null
      and subscription_cancellation_episode_id is null
      and recipient_type = 'seller_account'
    )
    or (
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

create unique index email_notifications_one_admin_new_subscriber_per_subscription_idx
  on public.email_notifications(subscription_enrollment_id)
  where notification_type = 'admin_new_subscriber';

create function public.enqueue_admin_new_subscriber_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_store_name text;
begin
  if new.provider_status not in ('active', 'trialing') then
    return new;
  end if;

  select nullif(btrim(stores.store_name), '')
  into v_store_name
  from public.stores as stores
  where stores.id = new.store_id;

  if v_store_name is null then
    raise exception 'Verified enrollment store name is unavailable.';
  end if;

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
    'admin_new_subscriber:subscription:' || new.stripe_subscription_id,
    'admin',
    'hello@flockfront.com',
    'admin_new_subscriber',
    'New FlockFront subscriber: ' || v_store_name,
    pg_catalog.jsonb_build_object(
      'schema_version', 'admin_new_subscriber_v1',
      'subscription_enrollment_id', new.id
    )
  )
  on conflict do nothing;

  return new;
exception
  when others then
    -- Email plumbing must never invalidate verified billing enrollment.
    raise warning 'Admin subscriber enqueue failed for verified enrollment: %',
      sqlerrm;
    return new;
end;
$function$;

revoke all on function public.enqueue_admin_new_subscriber_notification()
from public, anon, authenticated, service_role;

create trigger billing_subscription_enrollments_enqueue_admin_new_subscriber
after insert on public.billing_subscription_enrollments
for each row
execute function public.enqueue_admin_new_subscriber_notification();

create function public.get_admin_new_subscriber_context(
  p_subscription_enrollment_id uuid
)
returns table (
  recipient_email text,
  store_name text,
  seller_email text,
  public_plan_name text,
  billing_cadence_label text,
  subscription_status text,
  trial_ends_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  signup_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
  select
    'hello@flockfront.com'::text,
    nullif(btrim(stores.store_name), ''),
    nullif(btrim(users.email::text), ''),
    case catalog.plan_key
      when 'small_flock' then 'Coop'
      when 'full_flock' then 'Market'
    end,
    case catalog.billing_cadence
      when 'monthly' then 'Monthly'
      when 'yearly' then 'Annual'
    end,
    enrollment.provider_status,
    case when enrollment.provider_status = 'trialing'
      then enrollment.trial_ends_at
      else null
    end,
    binding.stripe_customer_id,
    enrollment.stripe_subscription_id,
    enrollment.provider_created_at
  from public.billing_subscription_enrollments as enrollment
  join public.stores as stores on stores.id = enrollment.store_id
  left join auth.users as users on users.id = stores.owner_user_id
  join public.billing_customer_bindings as binding
    on binding.id = enrollment.customer_binding_id
   and binding.store_id = enrollment.store_id
  left join public.billing_provider_price_catalog as catalog
    on catalog.stripe_price_id = enrollment.initial_stripe_price_id
   and catalog.stripe_livemode = enrollment.stripe_livemode
   and catalog.stripe_account_id = enrollment.stripe_account_id
   and catalog.is_verified
  where enrollment.id = p_subscription_enrollment_id;
$function$;

revoke all on function public.get_admin_new_subscriber_context(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_admin_new_subscriber_context(uuid)
to service_role;

comment on function public.get_admin_new_subscriber_context(uuid) is
'Service-only internal subscriber email context derived from the verified Stripe enrollment, Customer binding, store owner, and verified Price catalog.';

create function public.claim_subscription_enrollment_emails(
  p_subscription_enrollment_id uuid,
  p_max_attempts integer default 5,
  p_stale_after interval default interval '15 minutes'
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
set search_path = pg_catalog, public
as $function$
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process email notifications.';
  end if;
  if p_subscription_enrollment_id is null then
    raise exception 'Subscription enrollment is required.';
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
    join public.billing_subscription_enrollments as enrollment
      on enrollment.id = notifications.subscription_enrollment_id
     and enrollment.store_id = notifications.store_id
    join public.stores as stores on stores.id = notifications.store_id
    where enrollment.id = p_subscription_enrollment_id
      and (
        (
          notifications.notification_type = 'seller_subscription_welcome'
          and notifications.recipient_type = 'seller_account'
          and notifications.order_id is null
          and notifications.dedupe_key =
            'seller_subscription_welcome:subscription:' ||
            enrollment.stripe_subscription_id
          and notifications.payload = pg_catalog.jsonb_build_object(
            'schema_version', 'seller_subscription_welcome_v1',
            'subscription_enrollment_id', enrollment.id
          )
        )
        or (
          notifications.notification_type = 'admin_new_subscriber'
          and notifications.recipient_type = 'admin'
          and notifications.order_id is null
          and lower(btrim(notifications.recipient_email)) =
            'hello@flockfront.com'
          and notifications.dedupe_key =
            'admin_new_subscriber:subscription:' ||
            enrollment.stripe_subscription_id
          and notifications.subject_snapshot =
            'New FlockFront subscriber: ' || btrim(stores.store_name)
          and notifications.payload = pg_catalog.jsonb_build_object(
            'schema_version', 'admin_new_subscriber_v1',
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
    limit 2
    for update of notifications skip locked
  ),
  claimed as (
    update public.email_notifications as notifications
    set notification_status = 'processing',
        attempt_count = notifications.attempt_count + 1,
        last_attempt_at = now(),
        processing_started_at = now(),
        processing_token = gen_random_uuid(),
        dispatch_attempt_id = null,
        dispatch_started_at = null,
        delivery_unknown_at = null
    from claimable
    where notifications.id = claimable.id
    returning notifications.*
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
  order by claimed.created_at, claimed.id;
end;
$function$;

revoke all on function public.claim_subscription_enrollment_emails(
  uuid, integer, interval
) from public, anon, authenticated, service_role;
grant execute on function public.claim_subscription_enrollment_emails(
  uuid, integer, interval
) to service_role;

comment on function public.claim_subscription_enrollment_emails(
  uuid, integer, interval
) is
'Service-only claim for verified-enrollment seller and internal admin emails; never claims order notifications or another enrollment.';

-- Keep the general retry worker able to recover an admin notification when the
-- enrollment-scoped webhook kick is unavailable.
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
          'seller_order_updated_copy', 'seller_order_canceled_copy'
        ) then lower(trim(owners.email::text))
        else notifications.recipient_email
      end as canonical_recipient_email
    from public.email_notifications as notifications
    join public.stores as stores on stores.id = notifications.store_id
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
        'buyer_order_confirmation', 'seller_new_order',
        'buyer_order_updated', 'seller_order_updated_copy',
        'buyer_order_canceled', 'seller_order_canceled_copy',
        'seller_subscription_welcome', 'seller_first_sale',
        'admin_new_subscriber'
      )
      and (
        not coalesce(p_phase_1_only, false)
        or notifications.notification_type in (
          'buyer_order_confirmation', 'seller_new_order',
          'buyer_order_updated', 'seller_order_updated_copy',
          'buyer_order_canceled', 'seller_order_canceled_copy',
          'seller_subscription_welcome', 'seller_first_sale',
          'admin_new_subscriber'
        )
      )
      and (
        (
          orders.id is not null
          and notifications.recipient_type = 'buyer'
          and notifications.notification_type in (
            'buyer_order_confirmation', 'buyer_order_updated',
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
            'seller_order_updated_copy', 'seller_order_canceled_copy'
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
          notifications.notification_type = 'admin_new_subscriber'
          and notifications.recipient_type = 'admin'
          and notifications.order_id is null
          and enrollment.id is not null
          and lower(btrim(notifications.recipient_email)) =
            'hello@flockfront.com'
          and notifications.dedupe_key =
            'admin_new_subscriber:subscription:' ||
            enrollment.stripe_subscription_id
          and notifications.subject_snapshot =
            'New FlockFront subscriber: ' || btrim(stores.store_name)
          and notifications.payload = pg_catalog.jsonb_build_object(
            'schema_version', 'admin_new_subscriber_v1',
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
    set recipient_email = claimable.canonical_recipient_email,
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
    returning notifications.id, notifications.processing_token,
      notifications.store_id, notifications.order_id,
      notifications.dedupe_key, notifications.recipient_type,
      notifications.recipient_email, notifications.notification_type,
      notifications.subject_snapshot, notifications.payload,
      notifications.attempt_count
  )
  select claimed.id, claimed.processing_token, claimed.store_id,
    claimed.order_id, claimed.dedupe_key, claimed.recipient_type,
    claimed.recipient_email, claimed.notification_type,
    claimed.subject_snapshot, claimed.payload, claimed.attempt_count
  from claimed
  order by claimed.attempt_count, claimed.id;
end;
$function$;

commit;
