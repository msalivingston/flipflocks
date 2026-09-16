import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("full paid cancellation creates one Stripe refund with persisted idempotency", async () => {
  const boundary = await read("supabase/functions/stripe-connect-cancellation-preflight/index.ts");
  assert.equal(boundary.match(/stripe\.refunds\.create\(/g)?.length, 1);
  assert.match(boundary, /prepare_stripe_full_cancellation/);
  assert.match(boundary, /idempotencyKey: prepared\.idempotency_key/);
  assert.match(boundary, /payment_intent: prepared\.stripe_payment_intent_id/);
  assert.match(boundary, /amount: prepared\.refund_amount_cents/);
  assert.match(boundary, /\.\.\.prepared\.stripe_metadata[\s\S]*ff_schema_version: "ff_connect_cancellation_v1"/);
  assert.match(boundary, /stripeAccount: prepared\.stripe_account_id/);
});

test("money is reconciled and rechecked before database finalization", async () => {
  const boundary = await read("supabase/functions/stripe-connect-cancellation-preflight/index.ts");
  const record = boundary.indexOf("await recordProviderRefund(prepared.refund_action_id");
  const finalProviderRead = boundary.lastIndexOf("listAllRefunds(paymentIntentId, accountId)");
  const finalize = boundary.indexOf("finalize_stripe_full_cancellation");
  assert.ok(record > boundary.indexOf("stripe.refunds.create("));
  assert.ok(finalProviderRead > record);
  assert.ok(finalize > finalProviderRead);
  assert.match(boundary, /refunds\.some\(\(refund\) => refund\.id !== currentAction\.provider_refund_id\)/);
});

test("refund failures and lost responses leave cancellation resumable without inventory work", async () => {
  const boundary = await read("supabase/functions/stripe-connect-cancellation-preflight/index.ts");
  assert.match(boundary, /status: "refund_processing"/);
  assert.match(boundary, /status: "refund_failed"/);
  assert.match(boundary, /status: "resume_flockfront_action"/);
  assert.match(boundary, /Refund completed\. Finish cancellation\./);
  assert.doesNotMatch(boundary, /\.rpc\("cancel_order"/);
});

test("phase 3 finalizer is service-only, idempotent, and uses shared inventory reconciliation", async () => {
  const migration = await read("supabase/migrations/20260904140000_stripe_paid_full_cancellation.sql");
  assert.match(migration, /grant execute on function public\.finalize_stripe_full_cancellation[\s\S]*to service_role/);
  assert.match(migration, /revoke all on function public\.finalize_stripe_full_cancellation[\s\S]*authenticated/);
  assert.match(migration, /metadata ->> 'workflow_state' = 'cancellation_applied'/);
  assert.match(migration, /public\.reconcile_order_inventory/);
  assert.match(migration, /inventory_debited_quantity - items\.fulfilled_quantity - items\.restored_quantity/);
  assert.match(migration, /canceled_quantity = items\.canceled_quantity \+ changes\.cancel_quantity/);
  assert.match(migration, /payment_status = 'refunded'/);
});

test("full paid UI has no partial, arbitrary-amount, or inventory-selection controls", async () => {
  const detail = await read("app/dashboard/orders/[orderId]/order-detail.tsx");
  assert.match(detail, /Cancel this order and refund/);
  assert.match(detail, /All remaining unfulfilled inventory will be returned to available stock/);
  assert.match(detail, /paidCancellation \? \(/);
  assert.doesNotMatch(detail, /refundAmountInput|partialCancellation|paidInventorySelection/);
  assert.match(detail, /paidCancellation\?\.mode === "resume"/);
});
