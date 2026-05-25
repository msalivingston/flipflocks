-- Group 30: Public Storefront + Pay-at-Pickup Checkout API Foundation
--
-- Scope:
-- - Keeps existing public storefront read views/RPCs as the buyer browse API.
-- - Moves public pay-at-pickup order creation behind an Edge Function by
--   limiting direct execute on the trusted order creation RPC to service_role.
-- - Does not add checkout/payment tables, Stripe, webhooks, media upload
--   behavior, marketplace discovery, or new order business logic.
--
-- Edge Function:
-- - supabase/functions/pay-at-pickup-order/index.ts
--
-- The Edge Function validates public request shape and then calls this existing
-- RPC with the service role. The RPC remains the source of truth for storefront
-- eligibility, server-side totals, item validation, row locks, idempotency,
-- inventory decrement, customer/order creation, and notification enqueueing.


revoke all on function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text
) from public;

revoke all on function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text
) from anon, authenticated;

grant execute on function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text
) to service_role;

comment on function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text
) is
'Trusted pay-at-pickup storefront order creation RPC. Called by the pay-at-pickup-order Edge Function using service_role. Validates seller storefront publication status, inventory eligibility, item ownership, server-side totals, idempotency, and atomically decrements inventory before enqueueing buyer/seller transactional email notifications.';
