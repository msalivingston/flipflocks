import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  parseSellerFirstSaleContext,
  parseSellerFirstSalePayload,
  renderSellerFirstSaleEmail,
  sellerFirstSaleFromEmail,
  sellerFirstSaleNotificationType,
  sellerFirstSaleSubject,
} from "../supabase/functions/postmark-email-worker/seller-first-sale.ts";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(resolve(
  root,
  "supabase/migrations/20260813100000_seller_first_sale_email.sql",
), "utf8");
const worker = readFileSync(resolve(
  root,
  "supabase/functions/postmark-email-worker/index.ts",
), "utf8");
const checkout = readFileSync(resolve(
  root,
  "supabase/functions/pay-at-pickup-order/handler.ts",
), "utf8");

function context(overrides = {}) {
  return parseSellerFirstSaleContext({
    recipient_email: "owner@example.test",
    first_name: "Avery",
    order_id: "f1300000-0000-4000-8000-000000000001",
    order_number: "1042",
    order_total_cents: 12750,
    buyer_first_name: "Jamie",
    ...overrides,
  });
}

test("first-sale payload is narrow and accepts only its order association", () => {
  assert.deepEqual(parseSellerFirstSalePayload({
    schema_version: "seller_first_sale_v1",
    order_id: "F1300000-0000-4000-8000-000000000001",
  }), {
    schema_version: "seller_first_sale_v1",
    order_id: "f1300000-0000-4000-8000-000000000001",
  });

  for (const invalid of [
    {},
    { schema_version: "seller_first_sale_v1" },
    { schema_version: "seller_first_sale_v1", order_id: "browser-order" },
    {
      schema_version: "seller_first_sale_v1",
      order_id: "f1300000-0000-4000-8000-000000000001",
      recipient_email: "browser@example.test",
    },
  ]) {
    assert.throws(() => parseSellerFirstSalePayload(invalid), /payload is invalid/);
  }
});

test("first-sale email renders the approved guidance, summary, branding, and dashboard CTA", () => {
  const email = renderSellerFirstSaleEmail(context());

  assert.equal(sellerFirstSaleNotificationType, "seller_first_sale");
  assert.equal(sellerFirstSaleFromEmail, "welcome@flockfront.com");
  assert.equal(email.subject, sellerFirstSaleSubject);
  assert.match(email.html, /flockfront-logo-final-cropped\.png/);
  assert.match(email.text, /Hi Avery,/);
  assert.match(email.text, /Congratulations, you made your first sale!/);
  assert.match(email.text,
    /Your buyer has already received an order confirmation, so the first step is taken care of\./);
  assert.match(email.text, /Here’s what to do next:/);
  assert.match(email.text, /1\. Review the order and buyer information\./);
  assert.match(email.text,
    /2\. Contact the buyer to finalize pickup or delivery details\./);
  assert.match(email.text,
    /3\. Confirm the date, time, location, and anything else they need to know\./);
  assert.match(email.text,
    /4\. Once the order has been picked up or delivered, mark it as Fulfilled\. This clears those birds from your Reserved count so your dashboard stays accurate\./);
  assert.match(email.text, /Order number: #1042/);
  assert.match(email.text, /Buyer: Jamie/);
  assert.match(email.text, /Order total: \$127\.50/);
  assert.match(email.text, /View order & contact buyer:/);
  assert.match(email.text,
    /A quick response goes a long way\. Buyers have a much better experience when they know exactly what to expect for pickup or delivery\./);
  assert.match(email.text, /The FlockFront Team$/);
  assert.match(email.html,
    /https:\/\/www\.flockfront\.com\/dashboard\/orders\/f1300000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(`${email.html}\n${email.text}`,
    /buyer@example|phone|subscription|upgrade|unsubscribe/i);
  assert.equal((email.text.match(/Congratulations/g) ?? []).length, 1);
});

test("buyer first name is optional and all dynamic HTML is escaped", () => {
  const email = renderSellerFirstSaleEmail(context({
    first_name: '<img src=x onerror="alert(1)">',
    order_number: "<1042>",
    buyer_first_name: null,
  }));

  assert.doesNotMatch(email.html, /<img src=x/);
  assert.match(email.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(email.html, /Order number:[\s\S]*#&lt;1042&gt;/);
  assert.doesNotMatch(email.text, /^Buyer:/m);
});

test("missing owner or authoritative order context fails visibly", () => {
  for (const overrides of [
    { recipient_email: null },
    { first_name: "" },
    { order_id: "not-a-uuid" },
    { order_number: "" },
    { order_total_cents: null },
    { order_total_cents: -1 },
    { buyer_first_name: "" },
  ]) {
    assert.throws(() => context(overrides), /Seller first-sale/);
  }
});

test("database trigger is transactional, source/state scoped, and race safe", () => {
  assert.match(migration, /create trigger orders_enqueue_seller_first_sale\s+after insert on public\.orders/);
  assert.match(migration, /new\.order_source <> 'storefront'/);
  assert.match(migration, /new\.order_status <> 'open'/);
  assert.match(migration, /new\.payment_method <> 'pay_at_pickup'/);
  assert.match(migration, /new\.payment_status <> 'pay_at_pickup'/);
  assert.doesNotMatch(migration, /count\s*\(\s*\*\s*\)\s*=\s*1/i);
  assert.match(migration, /seller_first_sale_milestones[\s\S]*store_id uuid primary key/);
  assert.match(migration, /on conflict \(store_id\) do nothing[\s\S]*returning qualifying_order_id/);
  assert.match(migration, /email_notifications_one_first_sale_per_store_idx/);
  assert.match(migration, /seller_first_sale:store:' \|\| new\.store_id::text/);
  assert.match(migration, /select distinct on \(orders\.store_id\)[\s\S]*orders\.order_source = 'storefront'/);
});

test("context resolves the authenticated owner, not the operational order recipient", () => {
  const contextFunction = migration.match(
    /create function public\.get_seller_first_sale_context[\s\S]*?comment on function public\.get_seller_first_sale_context[\s\S]*?;/,
  )?.[0] ?? "";
  assert.match(contextFunction, /users\.email/);
  assert.match(contextFunction, /users\.raw_user_meta_data ->> 'first_name'/);
  assert.match(contextFunction, /users\.id = stores\.owner_user_id/);
  assert.doesNotMatch(contextFunction,
    /order_notification_email|communication_email|public_email/);
  assert.match(contextFunction, /service_role/);
});

test("existing order-scoped worker kick and claim are reused without changing checkout semantics", () => {
  assert.match(checkout, /create_pay_at_pickup_order_v2/);
  assert.match(checkout,
    /if \(createdOrderId\) \{[\s\S]*triggerPostmarkEmailWorker\([\s\S]*createdOrderId/);
  assert.match(worker, /claim_phase_1_postmark_email_notifications_for_order/);
  assert.match(migration, /notifications\.notification_type = 'seller_first_sale'/);
  assert.match(migration, /first_sale\.qualifying_order_id = orders\.id/);
  assert.match(worker, /get_seller_first_sale_context/);
  assert.match(worker, /fromEmail: sellerFirstSaleFromEmail/);
  assert.match(worker, /tag: "flockfront-seller-first-sale"/);
  assert.match(worker, /await beginNotificationDispatch[\s\S]*await sendPostmarkEmail/);
  assert.match(worker, /markNotificationDeliveryUnknown/);
});

test("first-sale Postmark metadata uses only existing compliant keys", () => {
  const metadata = worker.match(/Metadata: \{[\s\S]*?\n\s*\},\n\s*MessageStream/)?.[0] ?? "";
  for (const key of [
    "notification_id",
    "dispatch_attempt_id",
    "order_id",
    "billing_invoice_id",
    "cancel_episode_id",
    "email_type",
  ]) {
    assert.ok(key.length <= 20, `${key} must fit Postmark's metadata-key limit`);
  }
  assert.doesNotMatch(metadata, /seller_first_sale_store_id/);
});

test("first-sale slice does not touch billing, auth delivery, or existing order recipients", () => {
  const trigger = migration.match(
    /create function public\.enqueue_seller_first_sale[\s\S]*?create trigger orders_enqueue_seller_first_sale[\s\S]*?;/,
  )?.[0] ?? "";
  assert.doesNotMatch(trigger,
    /seller_billing_status|billing_subscription|stripe|order_notification_email/);
  assert.doesNotMatch(trigger, /supabase\.auth\.(?:signUp|resend)|auth\.smtp/);
  assert.match(worker, /function renderEmail[\s\S]*sellerOrderContactEmail/);
  assert.match(worker,
    /function renderSellerFirstSaleNotification[\s\S]*to: context\.recipientEmail/);
});
