import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Connect webhook observes exactly the supported refund events", async () => {
  const webhook = await read("supabase/functions/stripe-connect-webhook/index.ts");

  for (const eventType of ["refund.created", "refund.updated", "refund.failed"]) {
    assert.match(webhook, new RegExp(`"${eventType.replace(".", "\\.")}"`));
  }
  assert.match(webhook, /stripe\.refunds\.retrieve\([\s\S]*stripeAccount:\s*accountId/);
  assert.match(webhook, /stripe\.paymentIntents\.retrieve\([\s\S]*stripeAccount:\s*accountId/);
  assert.match(webhook, /record_stripe_connect_refund_event/);
  assert.doesNotMatch(webhook, /stripe\.refunds\.create/);
  assert.doesNotMatch(webhook, /cancel_order|reconcile_order_inventory|restored_quantity|canceled_quantity/);
});

test("paid cancellation preflight is read-only and paginates Stripe refunds", async () => {
  const preflight = await read("supabase/functions/stripe-connect-cancellation-preflight/index.ts");

  assert.match(preflight, /metadata->>schema_version",\s*"ff_connect_checkout_v1"/);
  assert.match(preflight, /stripe\.refunds\.list\([\s\S]*payment_intent:\s*paymentIntentId/);
  assert.match(preflight, /starting_after:\s*startingAfter/);
  for (const status of ["eligible", "resume_flockfront_action", "support_required", "ineligible"]) {
    assert.match(preflight, new RegExp(`"${status}"`));
  }
  assert.match(preflight, /isProvenFlockFrontRefund/);
  assert.doesNotMatch(preflight, /stripe\.refunds\.create|cancel_order|reconcile_order_inventory/);
});

test("order detail sends paid Stripe cancellation through preflight only", async () => {
  const detail = await read("app/dashboard/orders/[orderId]/order-detail.tsx");
  const predicates = await read("app/dashboard/orders/order-action-predicates.ts");

  assert.match(detail, /stripe-connect-cancellation-preflight/);
  assert.match(detail, /Paid cancellation processing is not enabled yet/);
  assert.match(detail, /requiresPaidPreflight[\s\S]*setShowCancelPanel\(false\)/);
  assert.match(predicates, /"partially_refunded",\s*"refunded"/);
});

test("partially refunded payment state is displayed explicitly", async () => {
  const [detail, list] = await Promise.all([
    read("app/dashboard/orders/[orderId]/order-detail.tsx"),
    read("app/dashboard/orders/orders-list.tsx"),
  ]);

  assert.match(detail, /partially_refunded"\) return "PARTIALLY REFUNDED"/);
  assert.match(list, /label:\s*"Partially refunded"/);
  assert.match(list, /\["paid",\s*"partially_refunded",\s*"refunded"\]/);
});

test("canceled quantity migration separates active quantity from restoration", async () => {
  const migration = await read("supabase/migrations/20260904130000_order_item_canceled_quantity.sql");

  assert.match(migration, /add column canceled_quantity integer not null default 0/);
  assert.match(migration, /fulfilled_quantity \+ canceled_quantity <= quantity/);
  assert.match(migration, /quantity\s*-\s*oi\.fulfilled_quantity\s*-\s*oi\.canceled_quantity/);
  assert.match(migration, /inventory restoration is reported separately/i);
  assert.doesNotMatch(migration, /update public\.order_items[\s\S]{0,160}set canceled_quantity/i);
  assert.doesNotMatch(migration, /create or replace function public\.cancel_order/i);
});
