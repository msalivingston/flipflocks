begin;

create table public.webinars (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null,
  short_description text not null,
  starts_at timestamptz not null,
  timezone text not null default 'America/Denver',
  join_url text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webinars_slug_unique unique (slug),
  constraint webinars_status_check check (status in ('draft', 'open', 'closed', 'completed')),
  constraint webinars_title_not_blank check (btrim(title) <> ''),
  constraint webinars_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint webinars_description_not_blank check (btrim(short_description) <> ''),
  constraint webinars_join_url_check check (join_url ~ '^https?://'),
  constraint webinars_timezone_not_blank check (btrim(timezone) <> '')
);

create index webinars_status_starts_at_idx on public.webinars(status, starts_at);

create table public.webinar_registrations (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  business_type text not null,
  annual_birds_sold text not null,
  referral_source text,
  attended boolean not null default false,
  confirmation_sent_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webinar_registrations_one_email unique (webinar_id, email),
  constraint webinar_registrations_first_name_not_blank check (btrim(first_name) <> ''),
  constraint webinar_registrations_last_name_not_blank check (btrim(last_name) <> ''),
  constraint webinar_registrations_email_not_blank check (btrim(email) <> ''),
  constraint webinar_registrations_business_type_check check (business_type in (
    'Small farm / breeder', 'Hatchery', 'Poultry reseller / dealer',
    'Farm store / feed store', 'Other'
  )),
  constraint webinar_registrations_birds_check check (annual_birds_sold in (
    '0–5', '6–25', '26–100', '101–1,000', '1,000+'
  ))
);

create index webinar_registrations_webinar_created_idx
  on public.webinar_registrations(webinar_id, created_at desc);

create table public.webinar_email_queue (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.webinar_registrations(id) on delete cascade,
  email_type text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processing_token uuid,
  processing_started_at timestamptz,
  provider_message_id text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint webinar_email_queue_unique_type unique (registration_id, email_type),
  constraint webinar_email_queue_type_check check (email_type in ('confirmation', 'reminder')),
  constraint webinar_email_queue_status_check check (status in ('pending', 'processing', 'sent', 'failed'))
);

create index webinar_email_queue_due_idx
  on public.webinar_email_queue(status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

create trigger webinars_set_updated_at before update on public.webinars
for each row execute function public.set_updated_at();
create trigger webinar_registrations_set_updated_at before update on public.webinar_registrations
for each row execute function public.set_updated_at();

alter table public.webinars enable row level security;
alter table public.webinar_registrations enable row level security;
alter table public.webinar_email_queue enable row level security;

create policy "Platform admins can manage webinars" on public.webinars
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "Platform admins can read webinar registrations" on public.webinar_registrations
for select to authenticated using (public.is_platform_admin());
create policy "Platform admins can update webinar attendance" on public.webinar_registrations
for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

revoke all on public.webinars from anon, authenticated;
revoke all on public.webinar_registrations from anon, authenticated;
revoke all on public.webinar_email_queue from anon, authenticated;
grant select, insert, update, delete on public.webinars to authenticated;
grant select, update on public.webinar_registrations to authenticated;

create or replace function public.get_public_webinar(p_slug text)
returns table (id uuid, title text, slug text, short_description text, starts_at timestamptz, timezone text)
language sql stable security definer set search_path = public
as $$
  select id, title, slug, short_description, starts_at, timezone
  from public.webinars
  where slug = lower(btrim(p_slug)) and status = 'open';
$$;

create or replace function public.register_for_webinar(
  p_slug text, p_first_name text, p_last_name text, p_email text,
  p_business_type text, p_annual_birds_sold text, p_referral_source text default null
)
returns table (registration_id uuid, webinar_title text, starts_at timestamptz, timezone text, join_url text)
language plpgsql security definer set search_path = public
as $$
declare
  v_webinar public.webinars%rowtype;
  v_registration_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into v_webinar from public.webinars
  where slug = lower(btrim(coalesce(p_slug, ''))) and status = 'open';
  if v_webinar.id is null then raise exception using errcode = 'P0001', message = 'WEBINAR_NOT_OPEN'; end if;
  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then raise exception 'First and last name are required.'; end if;
  if v_email !~ '^[^\s@<>\"]+@[^\s@<>\"]+\.[^\s@<>\"]+$' then raise exception 'A valid email address is required.'; end if;
  if p_business_type not in ('Small farm / breeder', 'Hatchery', 'Poultry reseller / dealer', 'Farm store / feed store', 'Other') then raise exception 'Business type is invalid.'; end if;
  if p_annual_birds_sold not in ('0–5', '6–25', '26–100', '101–1,000', '1,000+') then raise exception 'Annual bird sales range is invalid.'; end if;

  insert into public.webinar_registrations(first_name, last_name, email, business_type, annual_birds_sold, referral_source, webinar_id)
  values (btrim(p_first_name), btrim(p_last_name), v_email, p_business_type, p_annual_birds_sold, nullif(btrim(coalesce(p_referral_source, '')), ''), v_webinar.id)
  returning id into v_registration_id;

  insert into public.webinar_email_queue(registration_id, email_type)
  values (v_registration_id, 'confirmation');

  return query select v_registration_id, v_webinar.title, v_webinar.starts_at, v_webinar.timezone, v_webinar.join_url;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'ALREADY_REGISTERED';
end;
$$;

create or replace function public.claim_webinar_email(p_email_type text default null, p_registration_id uuid default null)
returns table (queue_id uuid, processing_token uuid, registration_id uuid, email_type text, first_name text, email text, webinar_title text, starts_at timestamptz, timezone text, join_url text, attempt_count integer)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_process_email_notifications() then raise exception 'Not authorized to process webinar emails.'; end if;
  return query
  with candidates as (
    select q.id from public.webinar_email_queue q
    join public.webinar_registrations r on r.id = q.registration_id
    join public.webinars w on w.id = r.webinar_id
    where q.status in ('pending', 'failed') and q.next_attempt_at <= now()
      and (p_email_type is null or q.email_type = p_email_type)
      and (p_registration_id is null or r.id = p_registration_id)
      and (q.email_type = 'confirmation' or (
        (now() at time zone w.timezone)::date = (w.starts_at at time zone w.timezone)::date
        and (now() at time zone w.timezone)::time >= time '10:00'
        and w.status in ('open', 'closed', 'completed')
      ))
    order by q.created_at for update of q skip locked limit 50
  ), claimed as (
    update public.webinar_email_queue q set status = 'processing', attempt_count = q.attempt_count + 1,
      processing_token = gen_random_uuid(), processing_started_at = now()
    from candidates c where q.id = c.id returning q.*
  )
  select q.id, q.processing_token, r.id, q.email_type, r.first_name, r.email, w.title, w.starts_at, w.timezone, w.join_url, q.attempt_count
  from claimed q join public.webinar_registrations r on r.id = q.registration_id join public.webinars w on w.id = r.webinar_id;
end;
$$;

create or replace function public.mark_webinar_email_sent(p_queue_id uuid, p_processing_token uuid, p_provider_message_id text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_type text; v_registration_id uuid;
begin
  if not public.can_process_email_notifications() then raise exception 'Not authorized to process webinar emails.'; end if;
  update public.webinar_email_queue set status = 'sent', sent_at = now(), provider_message_id = nullif(btrim(p_provider_message_id), ''), processing_token = null, processing_started_at = null
  where id = p_queue_id and processing_token = p_processing_token and status = 'processing'
  returning email_type, registration_id into v_type, v_registration_id;
  if v_registration_id is null then raise exception 'Webinar email claim was not found.'; end if;
  if v_type = 'confirmation' then update public.webinar_registrations set confirmation_sent_at = now() where id = v_registration_id;
  else update public.webinar_registrations set reminder_sent_at = now() where id = v_registration_id; end if;
end;
$$;

create or replace function public.mark_webinar_email_failed(p_queue_id uuid, p_processing_token uuid, p_error text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_process_email_notifications() then raise exception 'Not authorized to process webinar emails.'; end if;
  update public.webinar_email_queue set status = 'failed', last_error = left(coalesce(p_error, 'Email delivery failed.'), 1000), next_attempt_at = now() + interval '15 minutes', processing_token = null, processing_started_at = null
  where id = p_queue_id and processing_token = p_processing_token and status = 'processing';
end;
$$;

revoke all on function public.get_public_webinar(text) from public, anon, authenticated;
grant execute on function public.get_public_webinar(text) to anon, authenticated;
revoke all on function public.register_for_webinar(text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.register_for_webinar(text,text,text,text,text,text,text) to anon, authenticated;
revoke all on function public.claim_webinar_email(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_webinar_email(text, uuid) to service_role;
revoke all on function public.mark_webinar_email_sent(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.mark_webinar_email_sent(uuid,uuid,text) to service_role;
revoke all on function public.mark_webinar_email_failed(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.mark_webinar_email_failed(uuid,uuid,text) to service_role;

commit;
