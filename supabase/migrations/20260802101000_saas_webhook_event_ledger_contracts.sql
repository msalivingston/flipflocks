begin;

-- A verified platform webhook can arrive before Batch 7 has enough immutable
-- evidence to bind its Stripe object to a store. Preserve that fact without
-- inventing store authority or duplicating the provider-event ledger.
alter table public.billing_provider_events
  alter column store_id drop not null,
  add column if not exists processing_environment_id text,
  add column if not exists processing_lease_expires_at timestamptz,
  add column if not exists processing_lease_token uuid,
  add column if not exists failure_retryable boolean,
  add column if not exists deferred_at timestamptz,
  add column if not exists deferred_reason text;

alter table public.billing_provider_events
  drop constraint billing_provider_events_processing_status_check,
  add constraint billing_provider_events_processing_status_check check (
    processing_status in (
      'received', 'processing', 'deferred', 'processed', 'failed', 'ignored'
    )
  );

alter table public.billing_provider_events
  add constraint billing_provider_events_environment_check check (
    processing_environment_id is null
    or processing_environment_id in (
      'local', 'development', 'test', 'preview', 'staging', 'production'
    )
  ),
  add constraint billing_provider_events_lease_check check (
    processing_environment_id is null
    or (
      (processing_status = 'processing'
        and processing_lease_expires_at is not null
        and processing_lease_token is not null
        and processing_started_at is not null
        and processing_lease_expires_at > processing_started_at)
      or (processing_status <> 'processing'
        and processing_lease_expires_at is null
        and processing_lease_token is null)
    )
  ) not valid,
  add constraint billing_provider_events_failure_retryable_check check (
    processing_environment_id is null
    or (processing_status = 'failed') = (failure_retryable is not null)
  ) not valid,
  add constraint billing_provider_events_deferred_marker_check check (
    (deferred_at is null and deferred_reason is null)
    or (
      deferred_at is not null
      and deferred_reason in (
        'awaiting_verified_enrollment_batch',
        'awaiting_checkout_expiration_batch',
        'awaiting_immutable_enrollment_binding'
      )
      and processing_status in ('deferred', 'processing', 'failed', 'processed')
    )
  ) not valid,
  add constraint billing_provider_events_unbound_not_applied_check check (
    store_id is not null
    or (processing_environment_id is not null and not applied)
  ) not valid,
  add constraint billing_provider_events_webhook_identity_check check (
    processing_environment_id is null
    or (
      provider_event_id ~ '^evt_[A-Za-z0-9]+$'
      and event_type ~ '^[a-z][a-z0-9_.]{0,99}$'
      and payload_hash ~ '^[0-9a-f]{64}$'
      and stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
      and (
        (provider_object_type is null and provider_object_id is null)
        or (
          provider_object_type ~ '^[a-z][a-z0-9_.]{0,99}$'
          and provider_object_id ~ '^[A-Za-z][A-Za-z0-9_]{2,254}$'
        )
      )
    )
  ) not valid;

create index billing_provider_events_global_event_id_idx
  on public.billing_provider_events(provider_event_id);

comment on column public.billing_provider_events.store_id is
'Nullable only while a verified SaaS webhook event is unbound and deferred. A null store never authorizes domain application.';
comment on column public.billing_provider_events.processing_environment_id is
'Trusted deployment environment for the webhook receipt. Existing synchronous provider records may be null.';
comment on column public.billing_provider_events.processing_lease_expires_at is
'Database processing lease. A delivery may reclaim work only after this timestamp.';
comment on column public.billing_provider_events.processing_lease_token is
'Service-only fencing token. A stale worker cannot finalize work after another worker reclaims the lease.';
comment on column public.billing_provider_events.failure_retryable is
'Trusted failure classification. Raw provider errors and payloads are never stored.';
comment on column public.billing_provider_events.deferred_reason is
'Typed replayable reason for an authenticated approved SaaS event awaiting later domain application. Unsupported ignored events never receive this marker.';

create function public.enforce_saas_billing_provider_event_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.stripe_livemode is distinct from old.stripe_livemode
     or new.stripe_account_id is distinct from old.stripe_account_id
     or new.provider_event_id is distinct from old.provider_event_id
     or new.provider_event_created_at is distinct from old.provider_event_created_at
     or new.event_type is distinct from old.event_type
     or new.payload_hash is distinct from old.payload_hash
     or new.provider_object_type is distinct from old.provider_object_type
     or new.provider_object_id is distinct from old.provider_object_id
     or new.processing_environment_id is distinct from old.processing_environment_id then
    raise exception using errcode = '55000', message = 'SAAS_EVENT_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_saas_billing_provider_event_identity()
  from public, anon, authenticated, service_role;

create trigger billing_provider_events_identity_immutable
before update on public.billing_provider_events
for each row execute function public.enforce_saas_billing_provider_event_identity();

create table public.billing_provider_event_audits (
  id uuid primary key default gen_random_uuid(),
  stripe_livemode boolean not null,
  stripe_account_id text not null,
  provider_event_id text not null,
  audit_type text not null,
  result_code text not null,
  attempt_count integer not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint billing_provider_event_audits_account_check check (
    stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  ),
  constraint billing_provider_event_audits_event_check check (
    provider_event_id ~ '^evt_[A-Za-z0-9]+$'
  ),
  constraint billing_provider_event_audits_type_check check (
    audit_type in (
      'provider_event_claimed', 'provider_event_duplicate',
      'provider_event_reclaimed', 'provider_event_processed',
      'provider_event_failed', 'provider_event_ignored',
      'provider_event_deferred', 'provider_event_reconciliation_claimed',
      'provider_event_conflict'
    )
  ),
  constraint billing_provider_event_audits_result_check check (
    result_code ~ '^[a-z][a-z0-9_]{0,99}$'
  ),
  constraint billing_provider_event_audits_attempt_check check (
    attempt_count >= 0
  )
);

create index billing_provider_event_audits_event_idx
  on public.billing_provider_event_audits(
    provider_event_id, created_at desc
  );

alter table public.billing_provider_event_audits enable row level security;
revoke all on table public.billing_provider_event_audits
  from public, anon, authenticated, service_role;
grant select, insert on table public.billing_provider_event_audits
  to service_role;

create function public.claim_saas_billing_provider_event(
  p_provider_event_id text,
  p_event_type text,
  p_provider_event_created_at timestamptz,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_environment_id text,
  p_provider_object_type text default null,
  p_provider_object_id text default null
)
returns table (
  claim_state text,
  processing_status text,
  attempt_count integer,
  processing_lease_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event_id text := btrim(p_provider_event_id);
  v_event_type text := btrim(p_event_type);
  v_hash text := lower(btrim(p_payload_hash));
  v_account text := btrim(p_stripe_account_id);
  v_environment text := btrim(p_environment_id);
  v_object_type text := nullif(btrim(p_provider_object_type), '');
  v_object_id text := nullif(btrim(p_provider_object_id), '');
  v_existing public.billing_provider_events%rowtype;
  v_now timestamptz := statement_timestamp();
  v_lease timestamptz := statement_timestamp() + interval '5 minutes';
  v_lease_token uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if v_event_id !~ '^evt_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_ID_INVALID';
  end if;
  if v_event_type !~ '^[a-z][a-z0-9_.]{0,99}$' then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_TYPE_INVALID';
  end if;
  if p_provider_event_created_at is null then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_CREATED_AT_REQUIRED';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_HASH_INVALID';
  end if;
  if v_account !~ '^acct_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_ACCOUNT_INVALID';
  end if;
  if p_stripe_livemode is null then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_MODE_REQUIRED';
  end if;
  if v_environment not in (
    'local', 'development', 'test', 'preview', 'staging', 'production'
  ) then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_ENVIRONMENT_INVALID';
  end if;
  if (v_object_type is null) <> (v_object_id is null)
     or (v_object_type is not null and (
       v_object_type !~ '^[a-z][a-z0-9_.]{0,99}$'
       or v_object_id !~ '^[A-Za-z][A-Za-z0-9_]{2,254}$'
     )) then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_OBJECT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-provider-event:' || v_event_id, 0)
  );

  select event_row.* into v_existing
  from public.billing_provider_events as event_row
  where event_row.provider_event_id = v_event_id
  order by event_row.created_at
  limit 1
  for update;

  if found and (
    v_existing.stripe_livemode is distinct from p_stripe_livemode
    or v_existing.stripe_account_id is distinct from v_account
    or v_existing.event_type is distinct from v_event_type
    or v_existing.provider_event_created_at is distinct from p_provider_event_created_at
    or v_existing.payload_hash is distinct from v_hash
    or v_existing.processing_environment_id is distinct from v_environment
    or v_existing.provider_object_type is distinct from v_object_type
    or v_existing.provider_object_id is distinct from v_object_id
  ) then
    insert into public.billing_provider_event_audits (
      stripe_livemode, stripe_account_id, provider_event_id,
      audit_type, result_code, attempt_count
    ) values (
      p_stripe_livemode, v_account, v_event_id,
      'provider_event_conflict', 'identity_conflict',
      greatest(coalesce(v_existing.attempt_count, 0), 0)
    );
    return query select
      'conflict'::text, v_existing.processing_status,
      v_existing.attempt_count, null::uuid,
      v_existing.processing_lease_expires_at;
    return;
  end if;

  if not found then
    insert into public.billing_provider_events (
      stripe_livemode, stripe_account_id, provider_event_id,
      provider_event_created_at, store_id, event_type, payload_hash,
      applied, ignored_reason, processing_status, processing_started_at,
      processed_at, failed_at, attempt_count, last_error_code,
      last_error_message, provider_object_type, provider_object_id,
      processing_environment_id, processing_lease_expires_at,
      processing_lease_token, failure_retryable, deferred_at, deferred_reason
    ) values (
      p_stripe_livemode, v_account, v_event_id,
      p_provider_event_created_at, null, v_event_type, v_hash,
      false, null, 'processing', v_now,
      null, null, 1, null,
      null, v_object_type, v_object_id,
      v_environment, v_lease, v_lease_token, null, null, null
    );
    insert into public.billing_provider_event_audits (
      stripe_livemode, stripe_account_id, provider_event_id,
      audit_type, result_code, attempt_count
    ) values (
      p_stripe_livemode, v_account, v_event_id,
      'provider_event_claimed', 'claimed', 1
    );
    return query select
      'claimed'::text, 'processing'::text, 1, v_lease_token, v_lease;
    return;
  end if;

  if v_existing.processing_status in ('processed', 'ignored') then
    insert into public.billing_provider_event_audits (
      stripe_livemode, stripe_account_id, provider_event_id,
      audit_type, result_code, attempt_count
    ) values (
      p_stripe_livemode, v_account, v_event_id,
      'provider_event_duplicate', 'terminal_duplicate', v_existing.attempt_count
    );
    return query select
      'terminal_duplicate'::text, v_existing.processing_status,
      v_existing.attempt_count, null::uuid, null::timestamptz;
    return;
  end if;

  if v_existing.deferred_reason is not null then
    insert into public.billing_provider_event_audits (
      stripe_livemode, stripe_account_id, provider_event_id,
      audit_type, result_code, attempt_count
    ) values (
      p_stripe_livemode, v_account, v_event_id,
      'provider_event_duplicate', 'deferred_duplicate', v_existing.attempt_count
    );
    return query select
      'deferred_duplicate'::text, v_existing.processing_status,
      v_existing.attempt_count, null::uuid,
      v_existing.processing_lease_expires_at;
    return;
  end if;

  if v_existing.processing_status = 'failed'
     and not coalesce(v_existing.failure_retryable, false) then
    insert into public.billing_provider_event_audits (
      stripe_livemode, stripe_account_id, provider_event_id,
      audit_type, result_code, attempt_count
    ) values (
      p_stripe_livemode, v_account, v_event_id,
      'provider_event_duplicate', 'permanent_failure', v_existing.attempt_count
    );
    return query select
      'permanent_failure'::text, 'failed'::text,
      v_existing.attempt_count, null::uuid, null::timestamptz;
    return;
  end if;

  if v_existing.processing_status = 'processing'
     and v_existing.processing_lease_expires_at > v_now then
    insert into public.billing_provider_event_audits (
      stripe_livemode, stripe_account_id, provider_event_id,
      audit_type, result_code, attempt_count
    ) values (
      p_stripe_livemode, v_account, v_event_id,
      'provider_event_duplicate', 'in_progress', v_existing.attempt_count
    );
    return query select
      'in_progress'::text, 'processing'::text,
      v_existing.attempt_count, null::uuid,
      v_existing.processing_lease_expires_at;
    return;
  end if;

  update public.billing_provider_events as target
  set
    processing_status = 'processing',
    processing_started_at = v_now,
    processing_lease_expires_at = v_lease,
    processing_lease_token = v_lease_token,
    processed_at = null,
    failed_at = null,
    failure_retryable = null,
    last_error_code = null,
    last_error_message = null,
    ignored_reason = null,
    attempt_count = target.attempt_count + 1
  where target.stripe_livemode = p_stripe_livemode
    and target.stripe_account_id = v_account
    and target.provider_event_id = v_event_id
  returning target.* into v_existing;

  insert into public.billing_provider_event_audits (
    stripe_livemode, stripe_account_id, provider_event_id,
    audit_type, result_code, attempt_count
  ) values (
    p_stripe_livemode, v_account, v_event_id,
    'provider_event_reclaimed', 'reclaimed', v_existing.attempt_count
  );
  return query select
    'reclaimed'::text, 'processing'::text,
    v_existing.attempt_count, v_lease_token, v_lease;
end;
$function$;

create function public.mark_saas_billing_provider_event_processed(
  p_provider_event_id text,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_processing_lease_token uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_id text := btrim(p_provider_event_id);
  v_hash text := lower(btrim(p_payload_hash));
  v_account text := btrim(p_stripe_account_id);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-provider-event:' || v_id, 0)
  );
  select * into v_event from public.billing_provider_events
  where stripe_livemode = p_stripe_livemode
    and stripe_account_id = v_account
    and provider_event_id = v_id
  for update;
  if not found or v_event.payload_hash is distinct from v_hash then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_IDENTITY_MISMATCH';
  end if;
  if v_event.processing_status = 'processed' then return 'processed_duplicate'; end if;
  if v_event.processing_status <> 'processing'
     or v_event.deferred_reason is null
     or v_event.processing_lease_token is distinct from p_processing_lease_token
     or v_event.processing_lease_expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'SAAS_EVENT_TRANSITION_INVALID';
  end if;
  update public.billing_provider_events set
    processing_status = 'processed', processed_at = statement_timestamp(),
    processing_lease_expires_at = null, processing_lease_token = null,
    failed_at = null,
    failure_retryable = null, last_error_code = null,
    last_error_message = null, ignored_reason = null
  where stripe_livemode = p_stripe_livemode
    and stripe_account_id = v_account and provider_event_id = v_id;
  insert into public.billing_provider_event_audits (
    stripe_livemode, stripe_account_id, provider_event_id,
    audit_type, result_code, attempt_count
  ) values (
    p_stripe_livemode, v_account, v_id,
    'provider_event_processed', 'processed', v_event.attempt_count
  );
  return 'processed';
end;
$function$;

create function public.mark_saas_billing_provider_event_deferred(
  p_provider_event_id text,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_processing_lease_token uuid,
  p_reason_code text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_id text := btrim(p_provider_event_id);
  v_hash text := lower(btrim(p_payload_hash));
  v_account text := btrim(p_stripe_account_id);
  v_reason text := btrim(p_reason_code);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-provider-event:' || v_id, 0)
  );
  select * into v_event from public.billing_provider_events
  where stripe_livemode = p_stripe_livemode
    and stripe_account_id = v_account
    and provider_event_id = v_id
  for update;
  if not found or v_event.payload_hash is distinct from v_hash then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_IDENTITY_MISMATCH';
  end if;
  if v_event.processing_status = 'deferred'
     and v_event.deferred_reason = v_reason then return 'deferred_duplicate'; end if;
  if not (
    (v_reason = 'awaiting_verified_enrollment_batch' and v_event.event_type in (
      'checkout.session.completed',
      'customer.subscription.created', 'customer.subscription.updated',
      'customer.subscription.deleted'
    ))
    or (v_reason = 'awaiting_checkout_expiration_batch'
      and v_event.event_type = 'checkout.session.expired')
    or (v_reason = 'awaiting_immutable_enrollment_binding'
      and v_event.event_type in (
        'invoice.payment_succeeded', 'invoice.payment_failed',
        'invoice.payment_action_required', 'invoice.finalization_failed'
      ))
  ) then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_DEFERRED_REASON_INVALID';
  end if;
  if v_event.processing_status <> 'processing'
     or v_event.deferred_reason is not null
     or v_event.processing_lease_token is distinct from p_processing_lease_token
     or v_event.processing_lease_expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'SAAS_EVENT_TRANSITION_INVALID';
  end if;
  update public.billing_provider_events set
    processing_status = 'deferred', deferred_at = statement_timestamp(),
    deferred_reason = v_reason, processed_at = null, ignored_reason = null,
    processing_lease_expires_at = null, processing_lease_token = null,
    failed_at = null, failure_retryable = null,
    last_error_code = null, last_error_message = null
  where stripe_livemode = p_stripe_livemode
    and stripe_account_id = v_account and provider_event_id = v_id;
  insert into public.billing_provider_event_audits (
    stripe_livemode, stripe_account_id, provider_event_id,
    audit_type, result_code, attempt_count
  ) values (
    p_stripe_livemode, v_account, v_id,
    'provider_event_deferred', v_reason, v_event.attempt_count
  );
  return 'deferred';
end;
$function$;

create function public.mark_saas_billing_provider_event_ignored(
  p_provider_event_id text,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_processing_lease_token uuid,
  p_reason_code text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_id text := btrim(p_provider_event_id);
  v_hash text := lower(btrim(p_payload_hash));
  v_account text := btrim(p_stripe_account_id);
  v_reason text := btrim(p_reason_code);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-provider-event:' || v_id, 0)
  );
  select * into v_event from public.billing_provider_events
  where stripe_livemode = p_stripe_livemode
    and stripe_account_id = v_account
    and provider_event_id = v_id
  for update;
  if not found or v_event.payload_hash is distinct from v_hash then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_IDENTITY_MISMATCH';
  end if;
  if v_event.processing_status = 'ignored'
     and v_event.ignored_reason = v_reason then return 'ignored_duplicate'; end if;
  if not (
    (v_reason = 'informational_trial_will_end'
      and v_event.event_type = 'customer.subscription.trial_will_end')
    or (v_reason = 'unsupported_event_type'
      and v_event.event_type not in (
        'checkout.session.completed', 'checkout.session.expired',
        'customer.subscription.created', 'customer.subscription.updated',
        'customer.subscription.deleted', 'customer.subscription.trial_will_end',
        'invoice.payment_succeeded', 'invoice.payment_failed',
        'invoice.payment_action_required', 'invoice.finalization_failed'
      ))
  ) then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_IGNORED_REASON_INVALID';
  end if;
  if v_event.processing_status <> 'processing'
     or v_event.deferred_reason is not null
     or v_event.processing_lease_token is distinct from p_processing_lease_token
     or v_event.processing_lease_expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'SAAS_EVENT_TRANSITION_INVALID';
  end if;
  update public.billing_provider_events set
    processing_status = 'ignored', ignored_reason = v_reason,
    processed_at = statement_timestamp(), processing_lease_expires_at = null,
    processing_lease_token = null,
    failed_at = null, failure_retryable = null,
    last_error_code = null, last_error_message = null
  where stripe_livemode = p_stripe_livemode
    and stripe_account_id = v_account and provider_event_id = v_id;
  insert into public.billing_provider_event_audits (
    stripe_livemode, stripe_account_id, provider_event_id,
    audit_type, result_code, attempt_count
  ) values (
    p_stripe_livemode, v_account, v_id,
    'provider_event_ignored', v_reason, v_event.attempt_count
  );
  return 'ignored';
end;
$function$;

create function public.mark_saas_billing_provider_event_failed(
  p_provider_event_id text,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_processing_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event public.billing_provider_events%rowtype;
  v_id text := btrim(p_provider_event_id);
  v_hash text := lower(btrim(p_payload_hash));
  v_account text := btrim(p_stripe_account_id);
  v_code text := btrim(p_error_code);
  v_message text := nullif(btrim(p_error_message), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if v_code !~ '^[a-z][a-z0-9_]{0,99}$'
     or p_retryable is null
     or (v_message is not null and (
       length(v_message) > 500
       or v_message !~ '^[A-Za-z0-9][A-Za-z0-9 _.,:;()/-]*$'
     )) then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_FAILURE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-provider-event:' || v_id, 0)
  );
  select * into v_event from public.billing_provider_events
  where stripe_livemode = p_stripe_livemode
    and stripe_account_id = v_account
    and provider_event_id = v_id
  for update;
  if not found or v_event.payload_hash is distinct from v_hash then
    raise exception using errcode = '22023', message = 'SAAS_EVENT_IDENTITY_MISMATCH';
  end if;
  if v_event.processing_status = 'failed'
     and v_event.last_error_code = v_code
     and v_event.failure_retryable = p_retryable then return 'failed_duplicate'; end if;
  if v_event.processing_status <> 'processing'
     or v_event.processing_lease_token is distinct from p_processing_lease_token
     or v_event.processing_lease_expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'SAAS_EVENT_TRANSITION_INVALID';
  end if;
  update public.billing_provider_events set
    processing_status = 'failed', failed_at = statement_timestamp(),
    processing_lease_expires_at = null, processing_lease_token = null,
    failure_retryable = p_retryable,
    last_error_code = v_code, last_error_message = v_message,
    processed_at = null, ignored_reason = null
  where stripe_livemode = p_stripe_livemode
    and stripe_account_id = v_account and provider_event_id = v_id;
  insert into public.billing_provider_event_audits (
    stripe_livemode, stripe_account_id, provider_event_id,
    audit_type, result_code, attempt_count
  ) values (
    p_stripe_livemode, v_account, v_id,
    'provider_event_failed', v_code, v_event.attempt_count
  );
  return 'failed';
end;
$function$;

create function public.claim_deferred_saas_billing_provider_event(
  p_provider_event_id text,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_environment_id text,
  p_event_type text,
  p_provider_object_type text,
  p_provider_object_id text
)
returns table (
  reconciliation_state text,
  processing_status text,
  attempt_count integer,
  processing_lease_token uuid,
  lease_expires_at timestamptz,
  deferred_reason text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event_id text := btrim(p_provider_event_id);
  v_hash text := lower(btrim(p_payload_hash));
  v_account text := btrim(p_stripe_account_id);
  v_environment text := btrim(p_environment_id);
  v_event_type text := btrim(p_event_type);
  v_object_type text := btrim(p_provider_object_type);
  v_object_id text := btrim(p_provider_object_id);
  v_event public.billing_provider_events%rowtype;
  v_now timestamptz := statement_timestamp();
  v_lease timestamptz := statement_timestamp() + interval '5 minutes';
  v_token uuid := gen_random_uuid();
  v_state text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if v_event_id !~ '^evt_[A-Za-z0-9]+$'
     or v_hash !~ '^[0-9a-f]{64}$'
     or v_account !~ '^acct_[A-Za-z0-9]+$'
     or p_stripe_livemode is null
     or v_environment not in (
       'local', 'development', 'test', 'preview', 'staging', 'production'
     )
     or v_event_type !~ '^[a-z][a-z0-9_.]{0,99}$'
     or v_object_type !~ '^[a-z][a-z0-9_.]{0,99}$'
     or v_object_id !~ '^[A-Za-z][A-Za-z0-9_]{2,254}$' then
    raise exception using errcode = '22023', message = 'SAAS_DEFERRED_EVENT_IDENTITY_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-provider-event:' || v_event_id, 0)
  );
  select event_row.* into v_event
  from public.billing_provider_events as event_row
  where event_row.provider_event_id = v_event_id
  order by event_row.created_at
  limit 1
  for update;

  if not found then
    return query select 'not_found'::text, null::text, 0,
      null::uuid, null::timestamptz, null::text;
    return;
  end if;
  if v_event.payload_hash is distinct from v_hash
     or v_event.stripe_account_id is distinct from v_account
     or v_event.stripe_livemode is distinct from p_stripe_livemode
     or v_event.processing_environment_id is distinct from v_environment
     or v_event.event_type is distinct from v_event_type
     or v_event.provider_object_type is distinct from v_object_type
     or v_event.provider_object_id is distinct from v_object_id then
    insert into public.billing_provider_event_audits (
      stripe_livemode, stripe_account_id, provider_event_id,
      audit_type, result_code, attempt_count
    ) values (
      p_stripe_livemode, v_account, v_event_id,
      'provider_event_conflict', 'reconciliation_identity_conflict',
      greatest(coalesce(v_event.attempt_count, 0), 0)
    );
    return query select 'conflict'::text, v_event.processing_status,
      v_event.attempt_count, null::uuid,
      v_event.processing_lease_expires_at, v_event.deferred_reason;
    return;
  end if;

  if v_event.deferred_reason is null or not (
    (v_event.deferred_reason = 'awaiting_verified_enrollment_batch'
      and v_event.event_type in (
        'checkout.session.completed',
        'customer.subscription.created', 'customer.subscription.updated',
        'customer.subscription.deleted'
      ))
    or (v_event.deferred_reason = 'awaiting_checkout_expiration_batch'
      and v_event.event_type = 'checkout.session.expired')
    or (v_event.deferred_reason = 'awaiting_immutable_enrollment_binding'
      and v_event.event_type in (
        'invoice.payment_succeeded', 'invoice.payment_failed',
        'invoice.payment_action_required', 'invoice.finalization_failed'
      ))
  ) then
    return query select 'not_deferred'::text, v_event.processing_status,
      v_event.attempt_count, null::uuid,
      v_event.processing_lease_expires_at, v_event.deferred_reason;
    return;
  end if;
  if v_event.processing_status = 'processed' then
    return query select 'already_processed'::text, 'processed'::text,
      v_event.attempt_count, null::uuid, null::timestamptz,
      v_event.deferred_reason;
    return;
  end if;
  if v_event.processing_status = 'failed'
     and not coalesce(v_event.failure_retryable, false) then
    return query select 'permanent_failure'::text, 'failed'::text,
      v_event.attempt_count, null::uuid, null::timestamptz,
      v_event.deferred_reason;
    return;
  end if;
  if v_event.processing_status = 'processing'
     and v_event.processing_lease_expires_at > v_now then
    return query select 'in_progress'::text, 'processing'::text,
      v_event.attempt_count, null::uuid,
      v_event.processing_lease_expires_at, v_event.deferred_reason;
    return;
  end if;
  if v_event.processing_status not in ('deferred', 'processing', 'failed') then
    return query select 'not_deferred'::text, v_event.processing_status,
      v_event.attempt_count, null::uuid,
      v_event.processing_lease_expires_at, v_event.deferred_reason;
    return;
  end if;

  v_state := case when v_event.processing_status = 'deferred'
    then 'claimed' else 'reclaimed' end;
  update public.billing_provider_events as target set
    processing_status = 'processing',
    processing_started_at = v_now,
    processing_lease_expires_at = v_lease,
    processing_lease_token = v_token,
    failed_at = null,
    failure_retryable = null,
    last_error_code = null,
    last_error_message = null,
    attempt_count = target.attempt_count + 1
  where target.stripe_livemode = p_stripe_livemode
    and target.stripe_account_id = v_account
    and target.provider_event_id = v_event_id
  returning target.* into v_event;

  insert into public.billing_provider_event_audits (
    stripe_livemode, stripe_account_id, provider_event_id,
    audit_type, result_code, attempt_count
  ) values (
    p_stripe_livemode, v_account, v_event_id,
    'provider_event_reconciliation_claimed', v_state, v_event.attempt_count
  );
  return query select v_state, 'processing'::text, v_event.attempt_count,
    v_token, v_lease, v_event.deferred_reason;
end;
$function$;

create function public.get_saas_billing_provider_event_state(
  p_provider_event_id text,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean
)
returns table (
  processing_status text,
  attempt_count integer,
  processing_lease_expires_at timestamptz,
  deferred_at timestamptz,
  deferred_reason text,
  ignored_reason text,
  last_error_code text,
  failure_retryable boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  return query
  select event_row.processing_status, event_row.attempt_count,
    event_row.processing_lease_expires_at, event_row.deferred_at,
    event_row.deferred_reason, event_row.ignored_reason,
    event_row.last_error_code, event_row.failure_retryable
  from public.billing_provider_events as event_row
  where event_row.provider_event_id = btrim(p_provider_event_id)
    and event_row.payload_hash = lower(btrim(p_payload_hash))
    and event_row.stripe_account_id = btrim(p_stripe_account_id)
    and event_row.stripe_livemode = p_stripe_livemode;
end;
$function$;

revoke all on function public.claim_saas_billing_provider_event(
  text, text, timestamptz, text, text, boolean, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.mark_saas_billing_provider_event_processed(
  text, text, text, boolean, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.mark_saas_billing_provider_event_deferred(
  text, text, text, boolean, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.mark_saas_billing_provider_event_ignored(
  text, text, text, boolean, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.mark_saas_billing_provider_event_failed(
  text, text, text, boolean, uuid, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.claim_deferred_saas_billing_provider_event(
  text, text, text, boolean, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.get_saas_billing_provider_event_state(
  text, text, text, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.claim_saas_billing_provider_event(
  text, text, timestamptz, text, text, boolean, text, text, text
) to service_role;
grant execute on function public.mark_saas_billing_provider_event_processed(
  text, text, text, boolean, uuid
) to service_role;
grant execute on function public.mark_saas_billing_provider_event_deferred(
  text, text, text, boolean, uuid, text
) to service_role;
grant execute on function public.mark_saas_billing_provider_event_ignored(
  text, text, text, boolean, uuid, text
) to service_role;
grant execute on function public.mark_saas_billing_provider_event_failed(
  text, text, text, boolean, uuid, text, text, boolean
) to service_role;
grant execute on function public.claim_deferred_saas_billing_provider_event(
  text, text, text, boolean, text, text, text, text
) to service_role;
grant execute on function public.get_saas_billing_provider_event_state(
  text, text, text, boolean
) to service_role;

comment on function public.claim_saas_billing_provider_event(
  text, text, timestamptz, text, text, boolean, text, text, text
) is 'Service-only verified SaaS webhook event claim with global event identity, payload-hash idempotency, and a five-minute database lease.';
comment on function public.mark_saas_billing_provider_event_failed(
  text, text, text, boolean, uuid, text, text, boolean
) is 'Service-only sanitized webhook failure recording. Raw payloads, headers, stack traces, and secrets are prohibited.';
comment on function public.claim_deferred_saas_billing_provider_event(
  text, text, text, boolean, text, text, text, text
) is 'Service-only fenced replay claim for typed deferred SaaS events. Unsupported ignored events cannot enter this path.';

-- Deploying the receipt boundary must not activate enrollment or Portal flows.
update public.platform_settings
set boolean_value = false
where setting_key in (
  'saas_subscription_checkout_enabled', 'saas_billing_portal_enabled'
);

commit;
