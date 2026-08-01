-- Provider payment authority hardening.
--
-- Verified provider outcomes may be asserted only by service-role workflows.
-- Platform administrators retain existing read-only operational visibility.
-- Seller/admin Pay at Pickup actions and the narrow offline refund action are
-- deliberately left unchanged.

begin;

create or replace function public.can_process_payment_provider_events()
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(auth.role(), '') = 'service_role';
$function$;

comment on function public.can_process_payment_provider_events() is
'Internal service-role-only assertion used by verified payment provider processing RPCs. Platform administrator status is not provider authority.';

create or replace function public.can_manage_integration_operations()
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(auth.role(), '') = 'service_role';
$function$;

comment on function public.can_manage_integration_operations() is
'Internal service-role-only assertion for integration worker state and payment provider event recovery. Platform administrators retain read-only operational visibility.';

alter function public.record_payment_provider_event(
  text, text, text, jsonb, text, text, text
) set search_path = pg_catalog, public;

alter function public.mark_payment_provider_event_processed(
  uuid, uuid, uuid, uuid
) set search_path = pg_catalog, public;

alter function public.mark_payment_provider_event_failed(
  uuid, text
) set search_path = pg_catalog, public;

alter function public.record_stripe_checkout_session_for_order(
  uuid, text, text, text, text, text, bigint, text, timestamptz, jsonb
) set search_path = pg_catalog, public;

alter function public.record_stripe_payment_succeeded(
  uuid, uuid, text, text, text, text, timestamptz
) set search_path = pg_catalog, public;

alter function public.record_stripe_payment_failed(
  uuid, uuid, text, text, text
) set search_path = pg_catalog, public;

alter function public.retry_payment_provider_event(
  uuid, text, interval
) set search_path = pg_catalog, public;

alter function public.ignore_payment_provider_event(
  uuid, text, interval
) set search_path = pg_catalog, public;

alter function public.record_integration_worker_started(
  text, text, text, jsonb
) set search_path = pg_catalog, public;

alter function public.mark_integration_worker_completed(
  uuid, jsonb
) set search_path = pg_catalog, public;

alter function public.mark_integration_worker_failed(
  uuid, text, jsonb
) set search_path = pg_catalog, public;

comment on function public.record_payment_provider_event(
  text, text, text, jsonb, text, text, text
) is
'Service-role-only RPC to idempotently record and claim a verified provider event. Browser and platform-admin roles cannot create provider truth.';

comment on function public.mark_payment_provider_event_processed(
  uuid, uuid, uuid, uuid
) is
'Service-role-only RPC to mark a verified payment provider event processed after trusted reconciliation.';

comment on function public.mark_payment_provider_event_failed(uuid, text) is
'Service-role-only RPC to record a sanitized provider event processing failure.';

comment on function public.record_stripe_checkout_session_for_order(
  uuid, text, text, text, text, text, bigint, text, timestamptz, jsonb
) is
'Service-role-only legacy buyer-payment RPC. It records provider Checkout state but does not call Stripe.';

comment on function public.record_stripe_payment_succeeded(
  uuid, uuid, text, text, text, text, timestamptz
) is
'Service-role-only legacy buyer-payment RPC for verified Stripe payment success.';

comment on function public.record_stripe_payment_failed(
  uuid, uuid, text, text, text
) is
'Service-role-only legacy buyer-payment RPC for verified Stripe payment failure.';

comment on function public.retry_payment_provider_event(uuid, text, interval) is
'Service-role-only recovery RPC for a failed, ignored, or stale provider event.';

comment on function public.ignore_payment_provider_event(uuid, text, interval) is
'Service-role-only RPC to deliberately ignore a provider event with an operational reason.';

comment on function public.record_integration_worker_started(
  text, text, text, jsonb
) is
'Service-role-only RPC to record or idempotently restart a worker invocation. Platform administrators have read-only operational visibility.';

comment on function public.mark_integration_worker_completed(uuid, jsonb) is
'Service-role-only RPC to mark an integration worker run completed.';

comment on function public.mark_integration_worker_failed(uuid, text, jsonb) is
'Service-role-only RPC to mark an integration worker run failed with sanitized operational metadata.';

revoke all on function public.can_process_payment_provider_events()
  from public, anon, authenticated, service_role;
revoke all on function public.can_manage_integration_operations()
  from public, anon, authenticated, service_role;
revoke all on function public.record_payment_provider_event(
  text, text, text, jsonb, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.mark_payment_provider_event_processed(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.mark_payment_provider_event_failed(
  uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_stripe_checkout_session_for_order(
  uuid, text, text, text, text, text, bigint, text, timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.record_stripe_payment_succeeded(
  uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.record_stripe_payment_failed(
  uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_stripe_refund_result(
  uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.retry_payment_provider_event(
  uuid, text, interval
) from public, anon, authenticated, service_role;
revoke all on function public.ignore_payment_provider_event(
  uuid, text, interval
) from public, anon, authenticated, service_role;
revoke all on function public.record_integration_worker_started(
  text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.mark_integration_worker_completed(
  uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.mark_integration_worker_failed(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.can_process_payment_provider_events()
  to service_role;
grant execute on function public.can_manage_integration_operations()
  to service_role;
grant execute on function public.record_payment_provider_event(
  text, text, text, jsonb, text, text, text
) to service_role;
grant execute on function public.mark_payment_provider_event_processed(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.mark_payment_provider_event_failed(
  uuid, text
) to service_role;
grant execute on function public.record_stripe_checkout_session_for_order(
  uuid, text, text, text, text, text, bigint, text, timestamptz, jsonb
) to service_role;
grant execute on function public.record_stripe_payment_succeeded(
  uuid, uuid, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.record_stripe_payment_failed(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.record_stripe_refund_result(
  uuid, uuid, text, text, text, timestamptz
) to service_role;
grant execute on function public.retry_payment_provider_event(
  uuid, text, interval
) to service_role;
grant execute on function public.ignore_payment_provider_event(
  uuid, text, interval
) to service_role;
grant execute on function public.record_integration_worker_started(
  text, text, text, jsonb
) to service_role;
grant execute on function public.mark_integration_worker_completed(
  uuid, jsonb
) to service_role;
grant execute on function public.mark_integration_worker_failed(
  uuid, text, jsonb
) to service_role;

-- Defense in depth for the underlying legacy provider ledgers. Existing
-- authenticated platform-admin SELECT policies and grants remain unchanged.
revoke insert, update, delete, truncate, references, trigger
  on table public.payment_provider_events from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.stripe_checkout_sessions from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.integration_worker_runs from anon, authenticated;

-- mark_order_paid(uuid,text) is intentionally not redefined or re-granted
-- here. Its current implementation requires an owned/admin order with both
-- payment_provider='offline' and payment_method='pay_at_pickup'. The existing
-- authenticated seller/admin grant therefore remains the separate offline
-- payment authority, not a provider-truth authority.

commit;
