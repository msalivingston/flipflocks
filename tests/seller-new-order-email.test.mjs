import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  parseSellerNewOrderContext,
  parseSellerNewOrderRecipient,
  renderSellerNewOrderEmail,
  sellerNewOrderSubject,
} from "../supabase/functions/postmark-email-worker/seller-new-order.ts";

const root = resolve(import.meta.dirname, "..");
const worker = readFileSync(resolve(
  root,
  "supabase/functions/postmark-email-worker/index.ts",
), "utf8");
const migration = readFileSync(resolve(
  root,
  "supabase/migrations/20260814100000_seller_new_order_owner_email.sql",
), "utf8");

function context(overrides = {}) {
  return parseSellerNewOrderContext({
    recipient_email: "owner@example.test",
    buyer_first_name: "Jamie",
    order_id: "f1400000-0000-4000-8000-000000000001",
    order_number: "1042",
    order_total: "127.50",
    currency: "USD",
    fulfillment_method: "pickup",
    dashboard_url:
      "https://www.flockfront.com/dashboard/orders/f1400000-0000-4000-8000-000000000001",
    ...overrides,
  });
}

test("seller New Order renders the concise branded order alert", () => {
  const parsed = context();
  const email = renderSellerNewOrderEmail(parsed);

  assert.equal(
    sellerNewOrderSubject(parsed),
    "New order from Jamie — Order #1042",
  );
  assert.equal(email.subject, "New order from Jamie — Order #1042");
  assert.match(email.html, /flockfront-logo-final-cropped\.png/);
  assert.match(email.text, /^You have a new order/m);
  assert.match(email.text,
    /Jamie placed an order through your FlockFront store\./);
  assert.match(email.text, /Order number: #1042/);
  assert.match(email.text, /Order total: \$127\.50/);
  assert.match(email.text, /Method: Pickup/);
  assert.match(email.html, />View order<\/a>/);
  assert.match(email.text, /Reply to this email to contact Jamie directly\./);
  assert.doesNotMatch(`${email.html}\n${email.text}`,
    /buyer@example|phone|items:|first sale|upgrade|unsubscribe/i);
});

test("delivery wording and all dynamic HTML are safe", () => {
  const email = renderSellerNewOrderEmail(context({
    buyer_first_name: '<img src=x onerror="alert(1)">',
    order_number: "<1042>",
    fulfillment_method: "delivery",
  }));
  assert.match(email.text, /Method: Delivery/);
  assert.doesNotMatch(email.html, /<img src=x/);
  assert.match(email.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(email.html, /#&lt;1042&gt;/);
});

test("owner recipient and required authoritative context fail closed", () => {
  assert.equal(
    parseSellerNewOrderRecipient({ recipient_email: "OWNER@EXAMPLE.TEST" }),
    "owner@example.test",
  );
  for (const value of [null, {}, { recipient_email: "not-an-email" }]) {
    assert.throws(() => parseSellerNewOrderRecipient(value), /Seller New Order/);
  }
  for (const overrides of [
    { recipient_email: null },
    { buyer_first_name: "" },
    { order_id: "not-a-uuid" },
    { order_number: "" },
    { order_total: -1 },
    { currency: "" },
    { fulfillment_method: "shipping" },
    { dashboard_url: "https://example.test/dashboard/orders/f1400000-0000-4000-8000-000000000001" },
  ]) {
    assert.throws(() => context(overrides), /Seller New Order/);
  }
});

test("enqueue and claim use only the current authenticated owner for seller New Order", () => {
  assert.match(migration,
    /v_notification_type = 'seller_new_order'[\s\S]*from auth\.users as users[\s\S]*users\.id = v_store\.owner_user_id/);
  assert.match(migration,
    /notifications\.notification_type = 'seller_new_order'[\s\S]*owners\.email/);
  assert.doesNotMatch(
    migration.match(/when v_notification_type = 'seller_new_order'[\s\S]*?\n\s*else/)?.[0] ?? "",
    /order_notification_email|communication_email|public_email/,
  );
  assert.doesNotMatch(migration, /get_seller_new_order_recipient/);
});

test("worker re-resolves owner, preserves buyer Reply-To, sender, stream, and order scope", () => {
  const renderer = worker.match(
    /async function renderSellerNewOrderNotification[\s\S]*?\n}\n\nasync function/,
  )?.[0] ?? "";
  assert.match(renderer,
    /supabase\.auth\.admin[\s\S]*getUserById\(context\.store\.owner_user_id\)/);
  assert.match(renderer, /context\.order\.buyer_email_snapshot/);
  assert.match(renderer, /replyTo: buyerEmail/);
  assert.match(renderer, /fromEmail/);
  assert.match(renderer, /tag: "flockfront-order-notification"/);
  assert.match(worker, /claim_phase_1_postmark_email_notifications_for_order/);
  assert.match(worker,
    /notification\.notification_type === sellerNewOrderNotificationType[\s\S]*renderSellerNewOrderNotification/);
  assert.match(worker, /MessageStream: messageStream/);
});

test("buyer confirmation and First Sale retain separate render paths", () => {
  assert.match(worker,
    /notification\.notification_type === sellerFirstSaleNotificationType[\s\S]*renderSellerFirstSaleNotification/);
  assert.match(worker,
    /renderEmail\([\s\S]*await fetchEmailContext/);
  assert.doesNotMatch(migration,
    /seller_first_sale[\s\S]*get_seller_new_order_recipient/);
});
