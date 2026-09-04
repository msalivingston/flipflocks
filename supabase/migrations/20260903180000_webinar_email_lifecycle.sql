-- Complete the webinar email lifecycle for future registrations only.
-- Existing registrations and their queue rows are intentionally not backfilled.

begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.webinar_registrations
  add column canceled_at timestamptz,
  add column cancellation_token uuid not null default gen_random_uuid();

create unique index webinar_registrations_cancellation_token_idx
  on public.webinar_registrations(cancellation_token);

comment on column public.webinar_registrations.canceled_at is
'When present, the historical webinar registration is canceled and is excluded from active registration counts and reminder delivery.';

comment on column public.webinar_registrations.cancellation_token is
'Dedicated unguessable bearer token used only by the public self-service cancellation flow. It is distinct from the registration ID.';

alter table public.webinar_email_queue
  drop constraint webinar_email_queue_type_check,
  add constraint webinar_email_queue_type_check check (
    email_type in (
      'confirmation',
      'reminder',
      'admin_registration',
      'admin_cancellation'
    )
  ),
  drop constraint webinar_email_queue_status_check,
  add constraint webinar_email_queue_status_check check (
    status in (
      'pending', 'processing', 'sent', 'failed', 'delivery_unknown', 'canceled'
    )
  );

create or replace function public.register_for_webinar(
  p_slug text, p_first_name text, p_last_name text, p_email text,
  p_business_type text, p_annual_birds_sold text,
  p_referral_source text default null
)
returns table (
  registration_id uuid,
  webinar_title text,
  starts_at timestamptz,
  timezone text,
  join_url text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_webinar public.webinars%rowtype;
  v_registration_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into v_webinar
  from public.webinars
  where slug = lower(btrim(coalesce(p_slug, '')))
    and status = 'open';

  if v_webinar.id is null then
    raise exception using errcode = 'P0001', message = 'WEBINAR_NOT_OPEN';
  end if;
  if btrim(coalesce(p_first_name, '')) = ''
     or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'First and last name are required.';
  end if;
  if v_email !~ '^[^\s@<>\"]+@[^\s@<>\"]+\.[^\s@<>\"]+$' then
    raise exception 'A valid email address is required.';
  end if;
  if p_business_type not in (
    'Small farm / breeder', 'Hatchery', 'Poultry reseller / dealer',
    'Farm store / feed store', 'Other'
  ) then
    raise exception 'Business type is invalid.';
  end if;
  if p_annual_birds_sold not in (
    '0–5', '6–25', '26–100', '101–1,000', '1,000+'
  ) then
    raise exception 'Annual bird sales range is invalid.';
  end if;

  insert into public.webinar_registrations(
    first_name,
    last_name,
    email,
    business_type,
    annual_birds_sold,
    referral_source,
    webinar_id
  ) values (
    btrim(p_first_name),
    btrim(p_last_name),
    v_email,
    p_business_type,
    p_annual_birds_sold,
    nullif(btrim(coalesce(p_referral_source, '')), ''),
    v_webinar.id
  )
  returning id into v_registration_id;

  insert into public.webinar_email_queue(registration_id, email_type)
  values
    (v_registration_id, 'confirmation'),
    (v_registration_id, 'reminder'),
    (v_registration_id, 'admin_registration');

  return query
  select
    v_registration_id,
    v_webinar.title,
    v_webinar.starts_at,
    v_webinar.timezone,
    v_webinar.join_url;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'ALREADY_REGISTERED';
end;
$function$;

drop function public.claim_webinar_email(text, uuid);

create function public.claim_webinar_email(
  p_email_type text default null,
  p_registration_id uuid default null
)
returns table (
  queue_id uuid,
  processing_token uuid,
  registration_id uuid,
  email_type text,
  first_name text,
  last_name text,
  email text,
  webinar_title text,
  starts_at timestamptz,
  timezone text,
  join_url text,
  cancellation_token uuid,
  registered_at timestamptz,
  canceled_at timestamptz,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process webinar emails.';
  end if;

  return query
  with candidates as (
    select q.id
    from public.webinar_email_queue as q
    join public.webinar_registrations as r on r.id = q.registration_id
    join public.webinars as w on w.id = r.webinar_id
    where q.status in ('pending', 'failed')
      and q.next_attempt_at <= now()
      and (
        (p_email_type is null and q.email_type in ('confirmation', 'reminder'))
        or q.email_type = p_email_type
      )
      and (p_registration_id is null or r.id = p_registration_id)
      and (
        q.email_type <> 'reminder'
        or (
          r.canceled_at is null
          and (now() at time zone w.timezone)::date =
              (w.starts_at at time zone w.timezone)::date
          and (now() at time zone w.timezone)::time >= time '10:00'
          and w.status in ('open', 'closed', 'completed')
        )
      )
    order by q.created_at
    for update of q skip locked
    limit 50
  ), claimed as (
    update public.webinar_email_queue as q
    set status = 'processing',
        attempt_count = q.attempt_count + 1,
        processing_token = gen_random_uuid(),
        processing_started_at = now()
    from candidates
    where q.id = candidates.id
    returning q.*
  )
  select
    q.id,
    q.processing_token,
    r.id,
    q.email_type,
    r.first_name,
    r.last_name,
    r.email,
    w.title,
    w.starts_at,
    w.timezone,
    w.join_url,
    r.cancellation_token,
    r.created_at,
    r.canceled_at,
    q.attempt_count
  from claimed as q
  join public.webinar_registrations as r on r.id = q.registration_id
  join public.webinars as w on w.id = r.webinar_id;
end;
$function$;

create or replace function public.mark_webinar_email_sent(
  p_queue_id uuid,
  p_processing_token uuid,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_type text;
  v_registration_id uuid;
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process webinar emails.';
  end if;

  update public.webinar_email_queue
  set status = 'sent',
      sent_at = now(),
      provider_message_id = nullif(btrim(p_provider_message_id), ''),
      processing_token = null,
      processing_started_at = null,
      last_error = null
  where id = p_queue_id
    and processing_token = p_processing_token
    and status = 'processing'
  returning email_type, registration_id
  into v_type, v_registration_id;

  if v_registration_id is null then
    raise exception 'Webinar email claim was not found.';
  end if;

  if v_type = 'confirmation' then
    update public.webinar_registrations
    set confirmation_sent_at = now()
    where id = v_registration_id;
  elsif v_type = 'reminder' then
    update public.webinar_registrations
    set reminder_sent_at = now()
    where id = v_registration_id;
  end if;
end;
$function$;

create function public.webinar_email_is_sendable(
  p_queue_id uuid,
  p_processing_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.webinar_email_queue as q
    join public.webinar_registrations as r on r.id = q.registration_id
    where q.id = p_queue_id
      and q.processing_token = p_processing_token
      and q.status = 'processing'
      and (q.email_type <> 'reminder' or r.canceled_at is null)
  );
$function$;

create function public.mark_webinar_email_delivery_unknown(
  p_queue_id uuid,
  p_processing_token uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.can_process_email_notifications() then
    raise exception 'Not authorized to process webinar emails.';
  end if;

  update public.webinar_email_queue
  set status = 'delivery_unknown',
      last_error = left(coalesce(p_error, 'Email delivery outcome is unknown.'), 1000),
      processing_token = null,
      processing_started_at = null
  where id = p_queue_id
    and processing_token = p_processing_token
    and status = 'processing';
end;
$function$;

create function public.get_public_webinar_cancellation(p_token uuid)
returns table (
  webinar_title text,
  starts_at timestamptz,
  timezone text,
  cancellation_status text
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    w.title,
    w.starts_at,
    w.timezone,
    case when r.canceled_at is null then 'active' else 'canceled' end
  from public.webinar_registrations as r
  join public.webinars as w on w.id = r.webinar_id
  where r.cancellation_token = p_token;
$function$;

create function public.cancel_webinar_registration(p_token uuid)
returns table (
  registration_id uuid,
  cancellation_status text,
  webinar_title text,
  starts_at timestamptz,
  timezone text,
  canceled_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_registration public.webinar_registrations%rowtype;
  v_webinar public.webinars%rowtype;
  v_canceled_at timestamptz;
begin
  select * into v_registration
  from public.webinar_registrations
  where cancellation_token = p_token
  for update;

  if v_registration.id is null then
    return;
  end if;

  select * into v_webinar
  from public.webinars
  where id = v_registration.webinar_id;

  if v_registration.canceled_at is not null then
    return query
    select
      v_registration.id,
      'already_canceled'::text,
      v_webinar.title,
      v_webinar.starts_at,
      v_webinar.timezone,
      v_registration.canceled_at;
    return;
  end if;

  v_canceled_at := clock_timestamp();

  update public.webinar_registrations
  set canceled_at = v_canceled_at
  where id = v_registration.id;

  update public.webinar_email_queue as q
  set status = 'canceled',
      processing_token = null,
      processing_started_at = null,
      last_error = 'Registration canceled before reminder delivery.'
  where q.registration_id = v_registration.id
    and q.email_type = 'reminder'
    and q.status in ('pending', 'failed', 'processing');

  insert into public.webinar_email_queue(registration_id, email_type)
  values (v_registration.id, 'admin_cancellation')
  on conflict on constraint webinar_email_queue_unique_type do nothing;

  return query
  select
    v_registration.id,
    'canceled'::text,
    v_webinar.title,
    v_webinar.starts_at,
    v_webinar.timezone,
    v_canceled_at;
end;
$function$;

revoke all on function public.claim_webinar_email(text, uuid)
from public, anon, authenticated;
grant execute on function public.claim_webinar_email(text, uuid)
to service_role;

revoke all on function public.webinar_email_is_sendable(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.webinar_email_is_sendable(uuid, uuid)
to service_role;

revoke all on function public.mark_webinar_email_delivery_unknown(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.mark_webinar_email_delivery_unknown(uuid, uuid, text)
to service_role;

revoke all on function public.get_public_webinar_cancellation(uuid)
from public, anon, authenticated;
grant execute on function public.get_public_webinar_cancellation(uuid)
to anon, authenticated;

revoke all on function public.cancel_webinar_registration(uuid)
from public, anon, authenticated;
grant execute on function public.cancel_webinar_registration(uuid)
to service_role;

-- Replace the broken out-of-band cron definition. The project URL is public,
-- while the shared worker credential remains in Vault and out of source.
do $block$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'flockfront-webinar-email-hourly'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$block$;

select cron.schedule(
  'flockfront-webinar-email-hourly',
  '0 * * * *',
  $cron$
    select net.http_post(
      url := 'https://ymbnnipiohoccwpltkkj.supabase.co/functions/v1/webinar-email-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-flockfront-worker-secret', coalesce((
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'flockfront_webinar_worker_secret'
        ), '')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $cron$
);

commit;
