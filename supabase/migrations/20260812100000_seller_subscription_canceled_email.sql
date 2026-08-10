-- Durable seller cancellation confirmations. One notification is associated
-- with one verified cancellation episode and its FlockFront access boundary.

begin;

create table public.billing_subscription_cancellation_episodes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  subscription_enrollment_id uuid not null,
  cancellation_kind text not null check (
    cancellation_kind in ('scheduled', 'immediate')
  ),
  stripe_price_id text not null,
  access_ends_at timestamptz,
  access_boundary_source text not null check (
    access_boundary_source in (
      'entitlement_resolver',
      'verified_terminal_application',
      'missing'
    )
  ),
  provider_event_id text not null,
  provider_event_created_at timestamptz not null,
  resumed_at timestamptz,
  resumed_by_event_id text,
  created_at timestamptz not null default statement_timestamp(),
  constraint billing_cancellation_episodes_id_store_unique
    unique (id, store_id),
  constraint billing_cancellation_episodes_enrollment_context_fk
    foreign key (subscription_enrollment_id, store_id)
    references public.billing_subscription_enrollments(id, store_id)
    on delete restrict,
  constraint billing_cancellation_episodes_resume_check check (
    (resumed_at is null and resumed_by_event_id is null)
    or (resumed_at is not null and resumed_by_event_id is not null)
  )
);

alter table public.billing_subscription_cancellation_episodes enable row level security;
revoke all on table public.billing_subscription_cancellation_episodes
from public, anon, authenticated;
grant select, insert, update on table
  public.billing_subscription_cancellation_episodes to service_role;

create unique index billing_cancellation_episode_boundary_unique_idx
  on public.billing_subscription_cancellation_episodes(
    subscription_enrollment_id,
    access_ends_at
  )
  where access_ends_at is not null;

create unique index billing_cancellation_episode_one_open_idx
  on public.billing_subscription_cancellation_episodes(
    subscription_enrollment_id
  )
  where resumed_at is null;

comment on table public.billing_subscription_cancellation_episodes is
'Email-only cancellation episode identity derived from an applied verified Subscription transition and FlockFront access boundary; grants no billing authority.';
comment on column public.billing_subscription_cancellation_episodes.access_ends_at is
'FlockFront entitlement resolver boundary, or the verified application boundary when an immediate terminal transition leaves no continuing access.';

alter table public.email_notifications
  add column subscription_cancellation_episode_id uuid;

alter table public.email_notifications
  add constraint email_notifications_cancellation_episode_fk
  foreign key (subscription_cancellation_episode_id, store_id)
  references public.billing_subscription_cancellation_episodes(id, store_id)
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
      'seller_subscription_payment_failed',
      'seller_subscription_canceled'
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

create unique index email_notifications_one_canceled_per_episode_idx
  on public.email_notifications(subscription_cancellation_episode_id)
  where notification_type = 'seller_subscription_canceled';

alter table public.email_notification_delivery_attempts
  add column subscription_cancellation_episode_id uuid;

alter table public.email_notification_delivery_attempts
  add constraint email_delivery_attempt_cancellation_episode_fk
  foreign key (subscription_cancellation_episode_id, store_id)
  references public.billing_subscription_cancellation_episodes(id, store_id)
  on delete restrict;

alter table public.email_notification_delivery_attempts
  drop constraint email_delivery_attempt_context_check,
  add constraint email_delivery_attempt_context_check check (
    pg_catalog.num_nonnulls(
      order_id,
      subscription_enrollment_id,
      subscription_invoice_id,
      subscription_cancellation_episode_id
    ) = 1
  );

create or replace function public.set_email_delivery_attempt_context()
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
  new.subscription_cancellation_episode_id :=
    v_notification.subscription_cancellation_episode_id;
  return new;
end;
$function$;

create function public.enqueue_verified_seller_subscription_canceled()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_enrollment public.billing_subscription_enrollments%rowtype;
  v_episode public.billing_subscription_cancellation_episodes%rowtype;
  v_entitlement record;
  v_scheduled_transition boolean;
  v_immediate_transition boolean;
  v_resume_transition boolean;
  v_access_ends_at timestamptz;
  v_boundary_source text;
  v_recipient_email text;
begin
  select events.*
  into v_event
  from public.billing_provider_events as events
  where events.provider_event_id = new.last_provider_event_id
    and events.store_id = new.store_id
    and events.stripe_account_id = new.stripe_account_id
    and events.stripe_livemode = new.stripe_livemode
    and events.event_type in (
      'customer.subscription.updated',
      'customer.subscription.deleted'
    )
    and events.provider_object_type = 'subscription'
    and events.provider_object_id = new.stripe_subscription_id
    and events.processing_status = 'processing'
    and events.processing_lease_token is not null
    and events.processing_lease_expires_at > statement_timestamp()
    and events.applied;

  if v_event.provider_event_id is null then
    return new;
  end if;

  select enrollment.*
  into v_enrollment
  from public.billing_subscription_enrollments as enrollment
  where enrollment.id = new.current_subscription_enrollment_id
    and enrollment.store_id = new.store_id
    and enrollment.stripe_subscription_id = new.stripe_subscription_id
    and enrollment.stripe_account_id = new.stripe_account_id
    and enrollment.stripe_livemode = new.stripe_livemode;

  if v_enrollment.id is null then
    return new;
  end if;

  v_scheduled_transition := not old.cancel_at_period_end
    and new.cancel_at_period_end;
  v_immediate_transition := old.subscription_status <> 'canceled'
    and new.subscription_status = 'canceled';
  v_resume_transition := old.cancel_at_period_end
    and not new.cancel_at_period_end
    and new.subscription_status <> 'canceled';

  if v_resume_transition then
    update public.billing_subscription_cancellation_episodes as episode
    set resumed_at = statement_timestamp(),
        resumed_by_event_id = v_event.provider_event_id
    where episode.subscription_enrollment_id = v_enrollment.id
      and episode.store_id = new.store_id
      and episode.resumed_at is null;
    return new;
  end if;

  select episode.*
  into v_episode
  from public.billing_subscription_cancellation_episodes as episode
  where episode.subscription_enrollment_id = v_enrollment.id
    and episode.store_id = new.store_id
    and episode.resumed_at is null
  for update;

  if v_scheduled_transition or (v_immediate_transition and v_episode.id is null) then
    select entitlement.*
    into v_entitlement
    from public.resolve_store_entitlement(new.store_id) as entitlement;

    v_access_ends_at := v_entitlement.access_until;
    v_boundary_source := case
      when v_access_ends_at is not null then 'entitlement_resolver'
      when v_immediate_transition then 'verified_terminal_application'
      else 'missing'
    end;

    if v_immediate_transition and v_access_ends_at is null then
      v_access_ends_at := new.last_provider_event_applied_at;
    end if;

    insert into public.billing_subscription_cancellation_episodes (
      store_id,
      subscription_enrollment_id,
      cancellation_kind,
      stripe_price_id,
      access_ends_at,
      access_boundary_source,
      provider_event_id,
      provider_event_created_at
    ) values (
      new.store_id,
      v_enrollment.id,
      case when v_scheduled_transition then 'scheduled' else 'immediate' end,
      new.stripe_price_id,
      v_access_ends_at,
      v_boundary_source,
      v_event.provider_event_id,
      v_event.provider_event_created_at
    )
    on conflict do nothing
    returning * into v_episode;

    if v_episode.id is null and v_access_ends_at is not null then
      select episode.*
      into v_episode
      from public.billing_subscription_cancellation_episodes as episode
      where episode.subscription_enrollment_id = v_enrollment.id
        and episode.access_ends_at = v_access_ends_at;
    end if;
  end if;

  if v_episode.id is null then
    return new;
  end if;

  select nullif(btrim(users.email::text), '')
  into v_recipient_email
  from public.stores as stores
  join auth.users as users on users.id = stores.owner_user_id
  where stores.id = new.store_id;

  begin
    insert into public.email_notifications (
      store_id,
      order_id,
      subscription_enrollment_id,
      subscription_invoice_id,
      subscription_cancellation_episode_id,
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
      null,
      v_episode.id,
      'seller_subscription_canceled:episode:' || v_episode.id::text,
      'seller_account',
      v_recipient_email,
      'seller_subscription_canceled',
      'Your FlockFront subscription has been canceled',
      pg_catalog.jsonb_build_object(
        'schema_version', 'seller_subscription_canceled_v1',
        'subscription_cancellation_episode_id', v_episode.id
      )
    )
    on conflict do nothing;
  exception
    when others then
      raise warning 'Seller cancellation notification enqueue failed for episode %: %',
        v_episode.id, sqlerrm;
  end;

  return new;
exception
  when others then
    -- Email bookkeeping cannot invalidate verified subscription state.
    raise warning 'Seller cancellation episode processing failed for store %: %',
      new.store_id, sqlerrm;
    return new;
end;
$function$;

revoke all on function public.enqueue_verified_seller_subscription_canceled()
from public, anon, authenticated, service_role;

create trigger seller_billing_enqueue_verified_subscription_canceled
after update of subscription_status, cancel_at_period_end,
  last_provider_event_id, last_provider_event_applied_at
on public.seller_billing_status
for each row execute function
  public.enqueue_verified_seller_subscription_canceled();

create function public.get_seller_subscription_canceled_context(
  p_subscription_cancellation_episode_id uuid
)
returns table (
  recipient_email text,
  first_name text,
  public_plan_name text,
  billing_cadence_label text,
  cancellation_kind text,
  access_ends_at timestamptz,
  access_continues boolean,
  can_reactivate boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'SELLER_CANCELED_CONTEXT_SERVICE_ROLE_REQUIRED';
  end if;

  return query
  select
    nullif(btrim(users.email::text), ''),
    nullif(btrim(users.raw_user_meta_data ->> 'first_name'), ''),
    case catalog.plan_key
      when 'small_flock' then 'Coop'
      when 'full_flock' then 'Market'
    end,
    case catalog.billing_cadence
      when 'monthly' then 'Monthly'
      when 'yearly' then 'Annual'
    end,
    episode.cancellation_kind,
    episode.access_ends_at,
    episode.access_ends_at > statement_timestamp(),
    episode.cancellation_kind = 'scheduled'
      and episode.resumed_at is null
      and episode.access_ends_at > statement_timestamp()
      and status.cancel_at_period_end
      and status.subscription_status <> 'canceled'
  from public.billing_subscription_cancellation_episodes as episode
  join public.stores as stores on stores.id = episode.store_id
  left join auth.users as users on users.id = stores.owner_user_id
  left join public.billing_provider_price_catalog as catalog
    on catalog.stripe_price_id = episode.stripe_price_id
   and catalog.stripe_livemode = (
     select enrollment.stripe_livemode
     from public.billing_subscription_enrollments as enrollment
     where enrollment.id = episode.subscription_enrollment_id
   )
   and catalog.stripe_account_id = (
     select enrollment.stripe_account_id
     from public.billing_subscription_enrollments as enrollment
     where enrollment.id = episode.subscription_enrollment_id
   )
   and catalog.is_verified
  left join public.seller_billing_status as status
    on status.store_id = episode.store_id
  where episode.id = p_subscription_cancellation_episode_id;
end;
$function$;

revoke all on function public.get_seller_subscription_canceled_context(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_seller_subscription_canceled_context(uuid)
to service_role;

create function public.get_seller_subscription_cancellation_episode_for_event(
  p_provider_event_id text
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_episode_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select episode.id
  into v_episode_id
  from public.billing_subscription_cancellation_episodes as episode
  join public.billing_subscription_enrollments as enrollment
    on enrollment.id = episode.subscription_enrollment_id
   and enrollment.store_id = episode.store_id
  join public.billing_provider_events as events
    on events.provider_event_id = btrim(p_provider_event_id)
   and events.store_id = episode.store_id
   and events.stripe_account_id = enrollment.stripe_account_id
   and events.stripe_livemode = enrollment.stripe_livemode
   and events.provider_object_type = 'subscription'
   and events.provider_object_id = enrollment.stripe_subscription_id
   and events.event_type in (
     'customer.subscription.updated',
     'customer.subscription.deleted'
   )
   and events.processing_status = 'processed'
   and events.applied
  join public.email_notifications as notification
    on notification.subscription_cancellation_episode_id = episode.id
   and notification.store_id = episode.store_id
   and notification.notification_type = 'seller_subscription_canceled'
  where episode.resumed_at is null
  order by episode.created_at desc
  limit 1;

  return v_episode_id;
end;
$function$;

revoke all on function
  public.get_seller_subscription_cancellation_episode_for_event(text)
from public, anon, authenticated, service_role;
grant execute on function
  public.get_seller_subscription_cancellation_episode_for_event(text)
to service_role;

create function public.claim_seller_subscription_canceled_email(
  p_subscription_cancellation_episode_id uuid,
  p_max_attempts integer default 5,
  p_stale_after interval default interval '15 minutes'
)
returns table (
  notification_id uuid,
  processing_token uuid,
  store_id uuid,
  order_id uuid,
  subscription_cancellation_episode_id uuid,
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
  if p_subscription_cancellation_episode_id is null then
    raise exception 'Subscription cancellation episode is required.';
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
    join public.billing_subscription_cancellation_episodes as episode
      on episode.id = notifications.subscription_cancellation_episode_id
     and episode.store_id = notifications.store_id
    where episode.id = p_subscription_cancellation_episode_id
      and episode.resumed_at is null
      and notifications.notification_type = 'seller_subscription_canceled'
      and notifications.recipient_type = 'seller_account'
      and notifications.order_id is null
      and notifications.subscription_enrollment_id is null
      and notifications.subscription_invoice_id is null
      and notifications.dedupe_key =
        'seller_subscription_canceled:episode:' || episode.id::text
      and notifications.subject_snapshot =
        'Your FlockFront subscription has been canceled'
      and notifications.payload = pg_catalog.jsonb_build_object(
        'schema_version', 'seller_subscription_canceled_v1',
        'subscription_cancellation_episode_id', episode.id
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
  select claimed.id, claimed.processing_token, claimed.store_id,
    claimed.order_id, claimed.subscription_cancellation_episode_id,
    claimed.dedupe_key, claimed.recipient_type, claimed.recipient_email,
    claimed.notification_type, claimed.subject_snapshot, claimed.payload,
    claimed.attempt_count
  from claimed;
end;
$function$;

revoke all on function public.claim_seller_subscription_canceled_email(
  uuid, integer, interval
) from public, anon, authenticated, service_role;
grant execute on function public.claim_seller_subscription_canceled_email(
  uuid, integer, interval
) to service_role;

comment on function public.claim_seller_subscription_canceled_email(
  uuid, integer, interval
) is 'Service-only claim for one verified cancellation episode; never claims order, welcome, or payment-failed notifications.';

commit;
