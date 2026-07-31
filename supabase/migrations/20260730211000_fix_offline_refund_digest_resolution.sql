-- Phase 1 security integration correction: make the existing offline-refund
-- idempotency hash resolve pgcrypto from Supabase's extensions schema without
-- changing the function body, authority, grants, or transaction behavior.

begin;

alter function public.seller_record_offline_refund(
  uuid,
  text,
  numeric,
  text,
  text,
  text
)
set search_path = public, extensions, pg_temp;

comment on function public.seller_record_offline_refund(
  uuid,
  text,
  numeric,
  text,
  text,
  text
) is
'Authenticated owner/platform-admin action for idempotent offline refund accounting. It derives tenant, actor, currency, succeeded state, and null provider fields from trusted database state; pgcrypto resolves through the fixed extensions search path.';

commit;
