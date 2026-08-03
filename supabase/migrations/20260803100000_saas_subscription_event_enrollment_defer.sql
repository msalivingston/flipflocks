begin;

-- A verified Subscription event may legitimately precede the Checkout event
-- that creates its immutable enrollment. Release only that fenced
-- reconciliation lease back to the existing deferred queue; never infer a
-- store or enrollment from Subscription metadata.
create function public.defer_saas_subscription_event_until_enrollment(
  p_provider_event_id text,
  p_payload_hash text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_environment_id text,
  p_event_type text,
  p_provider_object_type text,
  p_provider_object_id text,
  p_processing_lease_token uuid
)
returns text
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
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if v_event_id !~ '^evt_[A-Za-z0-9]+$'
     or v_hash !~ '^[0-9a-f]{64}$'
     or v_account !~ '^acct_[A-Za-z0-9]+$'
     or p_stripe_livemode is null
     or v_environment not in (
       'local', 'development', 'test', 'preview', 'staging', 'production'
     )
     or v_event_type not in (
       'customer.subscription.created',
       'customer.subscription.updated',
       'customer.subscription.deleted'
     )
     or v_object_type <> 'subscription'
     or v_object_id !~ '^sub_[A-Za-z0-9]+$'
     or p_processing_lease_token is null then
    raise exception using errcode = '22023',
      message = 'SAAS_SUBSCRIPTION_DEFER_EVIDENCE_INVALID';
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

  if not found
     or v_event.payload_hash is distinct from v_hash
     or v_event.stripe_account_id is distinct from v_account
     or v_event.stripe_livemode is distinct from p_stripe_livemode
     or v_event.processing_environment_id is distinct from v_environment
     or v_event.event_type is distinct from v_event_type
     or v_event.provider_object_type is distinct from v_object_type
     or v_event.provider_object_id is distinct from v_object_id then
    raise exception using errcode = '22023',
      message = 'SAAS_SUBSCRIPTION_DEFER_IDENTITY_MISMATCH';
  end if;

  if v_event.processing_status = 'deferred'
     and v_event.deferred_reason = 'awaiting_verified_enrollment_batch'
     and not v_event.applied then
    return 'deferred_duplicate';
  end if;
  if v_event.processing_status <> 'processing'
     or v_event.deferred_reason is distinct from
       'awaiting_verified_enrollment_batch'
     or v_event.processing_lease_token is distinct from
       p_processing_lease_token
     or v_event.processing_lease_expires_at <= v_now
     or v_event.applied
     or v_event.processed_at is not null then
    raise exception using errcode = '55000',
      message = 'SAAS_SUBSCRIPTION_DEFER_FENCE_INVALID';
  end if;

  update public.billing_provider_events as target
  set processing_status = 'deferred',
      deferred_at = coalesce(target.deferred_at, v_now),
      processing_lease_expires_at = null,
      processing_lease_token = null,
      processed_at = null,
      failed_at = null,
      failure_retryable = null,
      last_error_code = null,
      last_error_message = null,
      ignored_reason = null
  where target.provider_event_id = v_event_id
    and target.stripe_account_id = v_account
    and target.stripe_livemode = p_stripe_livemode;

  insert into public.billing_provider_event_audits (
    stripe_livemode, stripe_account_id, provider_event_id,
    audit_type, result_code, attempt_count
  ) values (
    p_stripe_livemode, v_account, v_event_id,
    'provider_event_deferred', 'enrollment_not_yet_available',
    v_event.attempt_count
  );
  return 'deferred';
end;
$function$;

comment on function public.defer_saas_subscription_event_until_enrollment(
  text, text, text, boolean, text, text, text, text, uuid
) is
'Service-only fenced transition that preserves a verified Subscription event as deferred when its immutable enrollment has not yet been created.';

revoke all on function public.defer_saas_subscription_event_until_enrollment(
  text, text, text, boolean, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.defer_saas_subscription_event_until_enrollment(
  text, text, text, boolean, text, text, text, text, uuid
) to service_role;

commit;
