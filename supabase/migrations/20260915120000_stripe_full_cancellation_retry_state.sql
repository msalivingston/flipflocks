begin;

-- A prepared action is reusable only until a refund request is attempted.
-- Leave an uncertain Stripe response in flight; only a definite rejection
-- permits another attempt with the same action and idempotency key.
create or replace function public.transition_stripe_full_cancellation_refund_attempt(
  p_refund_action_id uuid,
  p_expected_state text,
  p_next_state text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action public.order_refunds%rowtype;
begin
  if not (
    (p_expected_state in ('refund_pending', 'refund_start_rejected')
      and p_next_state = 'refund_request_in_flight')
    or (p_expected_state = 'refund_request_in_flight'
      and p_next_state = 'refund_start_rejected')
  ) then
    raise exception 'Invalid cancellation refund attempt transition.';
  end if;

  select refunds.* into v_action
  from public.order_refunds as refunds
  where refunds.id = p_refund_action_id
  for update;

  if v_action.id is null
     or v_action.refund_method <> 'stripe'
     or v_action.refund_status <> 'pending'
     or v_action.provider_refund_id is not null
     or v_action.provider_status is not null
     or v_action.processed_at is not null
     or v_action.payment_provider_event_id is not null
     or v_action.metadata ->> 'schema_version' is distinct from 'ff_connect_cancellation_v1'
     or v_action.metadata ->> 'workflow_type' is distinct from 'paid_order_cancellation'
     or v_action.metadata ->> 'cancellation_type' is distinct from 'full'
     or v_action.metadata ->> 'origin_proof' is not null
     or v_action.metadata ->> 'cancellation_applied_at' is not null
     or exists (
       select 1 from public.payment_provider_events as events
       where events.related_refund_id = v_action.id
     ) then
    raise exception 'Cancellation refund action is not retryable.';
  end if;

  if v_action.metadata ->> 'workflow_state' is distinct from p_expected_state then
    return false;
  end if;

  update public.order_refunds as refunds
  set metadata = jsonb_set(
    refunds.metadata,
    '{workflow_state}',
    to_jsonb(p_next_state),
    true
  ) || jsonb_build_object('refund_attempt_state_updated_at', now())
  where refunds.id = v_action.id;

  return true;
end;
$$;

revoke all on function public.transition_stripe_full_cancellation_refund_attempt(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.transition_stripe_full_cancellation_refund_attempt(uuid, text, text)
to service_role;

comment on function public.transition_stripe_full_cancellation_refund_attempt(uuid, text, text) is
'Service-only atomic claim/release of a prepared full-cancellation refund attempt. Unknown provider outcomes remain in flight and cannot be retried automatically.';

commit;
