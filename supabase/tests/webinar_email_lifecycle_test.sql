begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

insert into public.webinars (
  id, title, slug, short_description, starts_at, timezone, join_url, status
)
select
  'f1400000-0000-4000-8000-000000000001',
  'Before Ten Webinar',
  'before-ten-webinar',
  'Reminder must wait.',
  now(),
  zones.name,
  'https://example.test/before-ten',
  'open'
from pg_timezone_names as zones
where (now() at time zone zones.name)::time < time '10:00'
order by zones.name
limit 1;

insert into public.webinars (
  id, title, slug, short_description, starts_at, timezone, join_url, status
)
select
  'f1400000-0000-4000-8000-000000000002',
  'After Ten Webinar',
  'after-ten-webinar',
  'Reminder is eligible.',
  now(),
  zones.name,
  'https://example.test/after-ten',
  'open'
from pg_timezone_names as zones
where (now() at time zone zones.name)::time >= time '10:00'
order by zones.name
limit 1;

select * from public.register_for_webinar(
  'before-ten-webinar', 'Jamie', 'Farmer', 'jamie-before@example.test',
  'Small farm / breeder', '6–25', null
);

select * from public.register_for_webinar(
  'after-ten-webinar', 'Taylor', 'Farmer', 'taylor-after@example.test',
  'Hatchery', '26–100', null
);

select is(
  (
    select count(*)
    from public.webinar_email_queue as q
    join public.webinar_registrations as r on r.id = q.registration_id
    where r.email = 'jamie-before@example.test'
      and q.email_type = 'confirmation'
  ),
  1::bigint,
  'registration creates exactly one confirmation row'
);

select is(
  (
    select count(*)
    from public.webinar_email_queue as q
    join public.webinar_registrations as r on r.id = q.registration_id
    where r.email = 'jamie-before@example.test'
      and q.email_type = 'reminder'
  ),
  1::bigint,
  'registration creates exactly one reminder row'
);

select is(
  (
    select count(*)
    from public.webinar_email_queue as q
    join public.webinar_registrations as r on r.id = q.registration_id
    where r.email = 'jamie-before@example.test'
      and q.email_type = 'admin_registration'
  ),
  1::bigint,
  'registration creates exactly one idempotent admin notification row'
);

select throws_ok(
  $$
    select * from public.register_for_webinar(
      'before-ten-webinar', 'Jamie', 'Farmer', 'jamie-before@example.test',
      'Small farm / breeder', '6–25', null
    )
  $$,
  '23505',
  'ALREADY_REGISTERED',
  'registration retry cannot create duplicate attendee or admin email rows'
);

select is(
  (
    select count(*)
    from public.claim_webinar_email(
      'reminder',
      (select id from public.webinar_registrations
       where email = 'jamie-before@example.test')
    )
  ),
  0::bigint,
  'reminder remains queued before 10 AM in the webinar timezone'
);

create temporary table claimed_webinar_reminder on commit drop as
select *
from public.claim_webinar_email(
  'reminder',
  (select id from public.webinar_registrations
   where email = 'taylor-after@example.test')
);

select is(
  (select count(*) from claimed_webinar_reminder),
  1::bigint,
  'reminder becomes claimable at or after 10 AM on the webinar date'
);

select is(
  (
    select count(*)
    from public.claim_webinar_email(
      'reminder',
      (select id from public.webinar_registrations
       where email = 'taylor-after@example.test')
    )
  ),
  0::bigint,
  'a worker rerun cannot claim the same processing reminder twice'
);

select isnt(
  (select id from public.webinar_registrations where email = 'jamie-before@example.test'),
  (select cancellation_token from public.webinar_registrations where email = 'jamie-before@example.test'),
  'cancellation bearer token is distinct from the registration ID'
);

select is(
  (
    select cancellation_status
    from public.cancel_webinar_registration(
      (select cancellation_token from public.webinar_registrations
       where email = 'jamie-before@example.test')
    )
  ),
  'canceled'::text,
  'first cancellation succeeds'
);

select ok(
  (select canceled_at is not null from public.webinar_registrations
   where email = 'jamie-before@example.test'),
  'cancellation preserves the registration and timestamps it'
);

select is(
  (
    select status
    from public.webinar_email_queue as q
    join public.webinar_registrations as r on r.id = q.registration_id
    where r.email = 'jamie-before@example.test'
      and q.email_type = 'reminder'
  ),
  'canceled'::text,
  'cancellation makes the queued reminder unsendable'
);

select is(
  (
    select cancellation_status
    from public.cancel_webinar_registration(
      (select cancellation_token from public.webinar_registrations
       where email = 'jamie-before@example.test')
    )
  ),
  'already_canceled'::text,
  'repeated cancellation is harmless'
);

select is(
  (
    select count(*)
    from public.webinar_email_queue as q
    join public.webinar_registrations as r on r.id = q.registration_id
    where r.email = 'jamie-before@example.test'
      and q.email_type = 'admin_cancellation'
  ),
  1::bigint,
  'repeated cancellation creates only one admin notification'
);

select is(
  (
    select count(*)
    from public.claim_webinar_email(
      'reminder',
      (select id from public.webinar_registrations
       where email = 'jamie-before@example.test')
    )
  ),
  0::bigint,
  'a canceled registration reminder cannot be claimed'
);

select is(
  (
    select count(*)
    from public.claim_webinar_email(
      'admin_cancellation',
      (select id from public.webinar_registrations
       where email = 'jamie-before@example.test')
    )
  ),
  1::bigint,
  'first cancellation makes exactly one admin notification claimable'
);

select is(
  (
    select count(*)
    from public.claim_webinar_email(
      'admin_cancellation',
      (select id from public.webinar_registrations
       where email = 'jamie-before@example.test')
    )
  ),
  0::bigint,
  'admin cancellation notification cannot be claimed twice'
);

select is(
  (
    select cancellation_status
    from public.cancel_webinar_registration(
      (select cancellation_token from public.webinar_registrations
       where email = 'taylor-after@example.test')
    )
  ),
  'canceled'::text,
  'cancellation can invalidate an already claimed reminder'
);

select is(
  (
    select public.webinar_email_is_sendable(queue_id, processing_token)
    from claimed_webinar_reminder
  ),
  false,
  'worker preflight rejects a reminder canceled after claim'
);

create temporary table generic_webinar_claims on commit drop as
select * from public.claim_webinar_email(null, null);

select is(
  (
    select count(*)
    from generic_webinar_claims
    where email_type in ('admin_registration', 'admin_cancellation')
  ),
  0::bigint,
  'legacy generic claims cannot see newly introduced admin email types'
);

create temporary table claimed_admin_registration on commit drop as
select *
from public.claim_webinar_email(
  'admin_registration',
  (select id from public.webinar_registrations
   where email = 'taylor-after@example.test')
);

select public.mark_webinar_email_delivery_unknown(
  queue_id,
  processing_token,
  'Postmark request outcome is unknown.'
)
from claimed_admin_registration;

select is(
  (
    select status
    from public.webinar_email_queue as q
    join public.webinar_registrations as r on r.id = q.registration_id
    where r.email = 'taylor-after@example.test'
      and q.email_type = 'admin_registration'
  ),
  'delivery_unknown'::text,
  'ambiguous Postmark outcomes are terminal instead of retryable'
);

select is(
  (
    select count(*)
    from public.claim_webinar_email(
      'admin_registration',
      (select id from public.webinar_registrations
       where email = 'taylor-after@example.test')
    )
  ),
  0::bigint,
  'worker reruns do not duplicate delivery-unknown messages'
);

select is(
  (
    select active
    from cron.job
    where jobname = 'flockfront-webinar-email-hourly'
  ),
  true,
  'hourly webinar worker cron is active'
);

select ok(
  (
    select command like '%https://ymbnnipiohoccwpltkkj.supabase.co/functions/v1/webinar-email-worker%'
      and command like '%flockfront_webinar_worker_secret%'
      and command not like '%flockfront_project_url%'
    from cron.job
    where jobname = 'flockfront-webinar-email-hourly'
  ),
  'cron uses the non-secret project URL directly and reads only the worker credential from Vault'
);

select * from finish();
rollback;
