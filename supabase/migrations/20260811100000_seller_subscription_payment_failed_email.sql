-- Durable seller payment-failed notification, enqueued only on the first
-- verified failure transition for one immutable subscription invoice.

begin;

alter table public.billing_subscription_invoices
  add constraint billing_subscription_invoices_id_store_unique
  unique (id, store_id);

alter table public.email_notifications
  add column subscription_invoice_id uuid;

alter table public.email_notifications
  add constraint email_notifications_subscription_invoice_fk
  foreign key (subscription_invoice_id, store_id)
  references public.billing_subscription_invoices(id, store_id)
  on delete restrict;

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
      'seller_subscription_payment_failed'
    )
  ),
  drop constraint email_notifications_context_check,
  add constraint email_notifications_context_check check (
    (
      notification_type = 'seller_subscription_welcome'
      and order_id is null
      and subscription_enrollment_id is not null
      and subscription_invoice_id is null
      and recipient_type = 'seller_account'
    )
    or
    (
      notification_type = 'seller_subscription_payment_failed'
      and order_id is null
      and subscription_enrollment_id is null
      and subscription_invoice_id is not null
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
      and recipient_type in ('buyer', 'seller')
      and recipient_email is not null
    )
  );

create unique index email_notifications_one_payment_failed_per_invoice_idx
  on public.email_notifications(subscription_invoice_id)
  where notification_type = 'seller_subscription_payment_failed';

comment on column public.email_notifications.subscription_invoice_id is
'Immutable verified subscription invoice associated with a seller billing email. Null for order and welcome emails.';

alter table public.email_notification_delivery_attempts
  add column subscription_invoice_id uuid;

alter table public.email_notification_delivery_attempts
  add constraint email_delivery_attempt_subscription_invoice_fk
  foreign key (subscription_invoice_id, store_id)
  references public.billing_subscription_invoices(id, store_id)
  on delete restrict;

alter table public.email_notification_delivery_attempts
  drop constraint email_delivery_attempt_context_check,
  add constraint email_delivery_attempt_context_check check (
    pg_catalog.num_nonnulls(
      order_id,
      subscription_enrollment_id,
      subscription_invoice_id
    ) = 1
  );

create function public.set_email_delivery_attempt_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_notification public.email_notifications%rowtype;
begin
  select notifications.*
  into v_notification
  from public.email_notifications as notifications
  where notifications.id = new.notification_id;

  if v_notification.id is null
     or new.store_id is distinct from v_notification.store_id then
    raise exception 'Email delivery attempt context does not match its notification.';
  end if;

  new.order_id := v_notification.order_id;
  new.subscription_enrollment_id := v_notification.subscription_enrollment_id;
  new.subscription_invoice_id := v_notification.subscription_invoice_id;
  return new;
end;
$function$;

revoke all on function public.set_email_delivery_attempt_context()
from public, anon, authenticated, service_role;

create trigger email_delivery_attempt_set_context
before insert on public.email_notification_delivery_attempts
for each row execute function public.set_email_delivery_attempt_context();

create function public.enqueue_first_seller_subscription_payment_failed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_recipient_email text;
begin
  if new.failure_at is null
     or (tg_op = 'UPDATE' and old.failure_at is not null) then
    return new;
  end if;

  if not exists (
    select 1
    from public.billing_provider_events as events
    where events.provider_event_id = new.last_provider_event_id
      and events.stripe_account_id = new.stripe_account_id
      and events.stripe_livemode = new.stripe_livemode
      and events.event_type = 'invoice.payment_failed'
      and events.provider_object_type = 'invoice'
      and events.provider_object_id = new.stripe_invoice_id
      and events.processing_status = 'processing'
      and events.processing_lease_token is not null
  ) then
    raise warning 'Seller payment-failed enqueue skipped because verified provider-event evidence was unavailable for invoice %.',
      new.id;
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
    subscription_invoice_id,
    dedupe_key,
    recipient_type,
    recipient_email,
    notification_type,
    subject_snapshot,
    payload
  ) values (
    new.store_id,
    null,
    null,
    new.id,
    'seller_subscription_payment_failed:invoice:' || new.id::text,
    'seller_account',
    v_recipient_email,
    'seller_subscription_payment_failed',
    'We couldn’t process your FlockFront payment',
    pg_catalog.jsonb_build_object(
      'schema_version', 'seller_subscription_payment_failed_v1',
      'subscription_invoice_id', new.id
    )
  )
  on conflict do nothing;

  return new;
exception
  when others then
    -- Email plumbing cannot invalidate verified invoice or entitlement state.
    raise warning 'Seller payment-failed enqueue failed for verified invoice %: %',
      new.id, sqlerrm;
    return new;
end;
$function$;

revoke all on function public.enqueue_first_seller_subscription_payment_failed()
from public, anon, authenticated, service_role;

create trigger billing_invoice_enqueue_first_payment_failed
after insert or update of failure_at on public.billing_subscription_invoices
for each row
when (new.failure_at is not null)
execute function public.enqueue_first_seller_subscription_payment_failed();

create function public.get_seller_subscription_payment_failed_context(
  p_subscription_invoice_id uuid
)
returns table (
  recipient_email text,
  first_name text,
  public_plan_name text,
  billing_cadence_label text,
  amount_due_cents bigint,
  currency text,
  next_payment_attempt_at timestamptz,
  failure_at timestamptz,
  grace_ends_at timestamptz,
  has_active_access boolean,
  access_until timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'SELLER_PAYMENT_FAILED_CONTEXT_SERVICE_ROLE_REQUIRED';
  end if;

  return query
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
    invoice.amount_remaining_cents as amount_due_cents,
    invoice.currency,
    invoice.next_payment_attempt_at,
    invoice.failure_at,
    invoice.grace_ends_at,
    entitlement.has_active_access,
    entitlement.access_until
  from public.billing_subscription_invoices as invoice
  join public.stores as stores on stores.id = invoice.store_id
  left join auth.users as users on users.id = stores.owner_user_id
  left join public.billing_provider_price_catalog as catalog
    on catalog.stripe_price_id = invoice.stripe_price_id
   and catalog.stripe_livemode = invoice.stripe_livemode
   and catalog.stripe_account_id = invoice.stripe_account_id
   and catalog.is_verified
  left join lateral public.resolve_store_entitlement(invoice.store_id)
    as entitlement on true
  where invoice.id = p_subscription_invoice_id
    and invoice.failure_at is not null;
end;
$function$;

revoke all on function public.get_seller_subscription_payment_failed_context(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_seller_subscription_payment_failed_context(uuid)
to service_role;

comment on function public.get_seller_subscription_payment_failed_context(uuid) is
'Service-only payment-failure context from the authenticated owner, verified invoice, verified Price catalog, and authoritative entitlement resolver.';

create function public.bind_verified_saas_payment_failed_plan_change_event(
  p_provider_event_id text,
  p_processing_lease_token uuid,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_stripe_subscription_id text,
  p_stripe_invoice_id text,
  p_target_stripe_price_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_store_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select events.*
  into v_event
  from public.billing_provider_events as events
  where events.provider_event_id = btrim(p_provider_event_id)
    and events.stripe_account_id = btrim(p_stripe_account_id)
    and events.stripe_livemode = p_stripe_livemode
  for update;

  if not found
     or v_event.event_type <> 'invoice.payment_failed'
     or v_event.provider_object_type <> 'invoice'
     or v_event.provider_object_id <> btrim(p_stripe_invoice_id)
     or v_event.processing_status <> 'processing'
     or v_event.deferred_reason <> 'awaiting_immutable_enrollment_binding'
     or v_event.processing_lease_token is distinct from p_processing_lease_token
     or v_event.processing_lease_expires_at <= statement_timestamp()
     or v_event.applied then
    raise exception using errcode = '55000',
      message = 'SAAS_PLAN_CHANGE_PAYMENT_FAILURE_EVENT_BINDING_INVALID';
  end if;

  select changes.store_id
  into v_store_id
  from public.billing_subscription_plan_changes as changes
  join public.billing_subscription_enrollments as enrollment
    on enrollment.id = changes.subscription_enrollment_id
   and enrollment.store_id = changes.store_id
  where enrollment.stripe_subscription_id = btrim(p_stripe_subscription_id)
    and enrollment.stripe_account_id = btrim(p_stripe_account_id)
    and enrollment.stripe_livemode = p_stripe_livemode
    and changes.target_stripe_price_id = btrim(p_target_stripe_price_id)
    and changes.status in ('requested', 'pending_payment', 'scheduled')
    and (
      changes.stripe_invoice_id is null
      or changes.stripe_invoice_id = btrim(p_stripe_invoice_id)
    )
  for update of changes;

  if v_store_id is null or (
    v_event.store_id is not null and v_event.store_id <> v_store_id
  ) then
    raise exception using errcode = '55000',
      message = 'SAAS_PLAN_CHANGE_PAYMENT_FAILURE_STORE_BINDING_INVALID';
  end if;

  update public.billing_provider_events as events
  set store_id = v_store_id
  where events.provider_event_id = v_event.provider_event_id
    and events.stripe_account_id = v_event.stripe_account_id
    and events.stripe_livemode = v_event.stripe_livemode
    and events.store_id is null;

  return v_store_id;
end;
$function$;

revoke all on function public.bind_verified_saas_payment_failed_plan_change_event(
  text, uuid, text, boolean, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.bind_verified_saas_payment_failed_plan_change_event(
  text, uuid, text, boolean, text, text, text
) to service_role;

comment on function public.bind_verified_saas_payment_failed_plan_change_event(
  text, uuid, text, boolean, text, text, text
) is 'Binds one claimed, deferred payment-failed event to the store proven by its open plan change; changes no billing or entitlement state.';

create function public.claim_seller_subscription_payment_failed_email(
  p_subscription_invoice_id uuid,
  p_max_attempts integer default 5,
  p_stale_after interval default interval '15 minutes'
)
returns table (
  notification_id uuid,
  processing_token uuid,
  store_id uuid,
  order_id uuid,
  subscription_invoice_id uuid,
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

  if p_subscription_invoice_id is null then
    raise exception 'Subscription invoice is required.';
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
    join public.billing_subscription_invoices as invoice
      on invoice.id = notifications.subscription_invoice_id
     and invoice.store_id = notifications.store_id
    where invoice.id = p_subscription_invoice_id
      and invoice.failure_at is not null
      and notifications.notification_type = 'seller_subscription_payment_failed'
      and notifications.recipient_type = 'seller_account'
      and notifications.order_id is null
      and notifications.subscription_enrollment_id is null
      and notifications.dedupe_key =
        'seller_subscription_payment_failed:invoice:' || invoice.id::text
      and notifications.subject_snapshot =
        'We couldn’t process your FlockFront payment'
      and notifications.payload = pg_catalog.jsonb_build_object(
        'schema_version', 'seller_subscription_payment_failed_v1',
        'subscription_invoice_id', invoice.id
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
    limit 1
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
    claimed.subscription_invoice_id,
    claimed.dedupe_key,
    claimed.recipient_type,
    claimed.recipient_email,
    claimed.notification_type,
    claimed.subject_snapshot,
    claimed.payload,
    claimed.attempt_count
  from claimed;
end;
$function$;

revoke all on function public.claim_seller_subscription_payment_failed_email(
  uuid, integer, interval
) from public, anon, authenticated, service_role;
grant execute on function public.claim_seller_subscription_payment_failed_email(
  uuid, integer, interval
) to service_role;

comment on function public.claim_seller_subscription_payment_failed_email(
  uuid, integer, interval
) is 'Service-only claim for one verified failed subscription invoice; never claims order or welcome notifications.';

commit;
