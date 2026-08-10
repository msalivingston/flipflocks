import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  parseSellerNewOrderContext,
  parseSellerNewOrderRecipient,
  sellerNewOrderLogoUrl,
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

test("seller New Order keeps its approved subject and FlockFront brand asset", () => {
  assert.equal(
    sellerNewOrderSubject(context()),
    "New order from Jamie — Order #1042",
  );
  assert.equal(
    sellerNewOrderLogoUrl,
    "https://www.flockfront.com/branding/flockfront-logo-final-cropped.png",
  );
});

test("seller New Order reuses buyer order-document facts and formatting", () => {
  const renderer = worker.match(
    /function renderOrderDocumentEmail[\s\S]*?function isCanceledEmail/,
  )?.[0] ?? "";
  const sellerRenderer = worker.match(
    /async function renderSellerNewOrderNotification[\s\S]*?\n}\n\nasync function/,
  )?.[0] ?? "";

  assert.match(sellerRenderer, /renderOrderDocumentEmail\(context/);
  assert.match(sellerRenderer, /headline: "You have a new order"/);
  assert.match(sellerRenderer,
    /placed an order through your FlockFront store/);
  assert.match(sellerRenderer, /prominentDashboardLink: true/);
  assert.match(sellerRenderer,
    /Reply to this email to contact \$\{emailContext\.buyerFirstName\} directly\./);
  assert.match(sellerRenderer, /sellerNewOrderLogoUrl/);

  assert.match(renderer, /fact\("Name", buyerName\)/);
  assert.match(renderer, /fact\("Phone", order\.buyer_phone_snapshot\)/);
  assert.match(renderer, /fact\("Email", order\.buyer_email_snapshot\)/);
  assert.match(renderer, /buyerPrintItemsTable\(items, store\.currency\)/);
  assert.match(worker, /item\.unit_price_snapshot/);
  assert.match(worker, /item\.line_subtotal/);
  assert.match(renderer, /fact\("Subtotal", formatCurrency/);
  assert.match(renderer, /fact\("Total", formatCurrency/);
  assert.match(renderer, /Payment method/);
  assert.match(renderer, /Payment status/);
  assert.match(renderer, /Pickup \/ Delivery/);
  assert.match(renderer, /Pickup details/);
  assert.match(renderer, /buyer_notes/);
  assert.match(renderer, /Order date:/);
});

test("seller options omit buyer-facing policies without changing buyer confirmation", () => {
  const sellerRenderer = worker.match(
    /async function renderSellerNewOrderNotification[\s\S]*?\n}\n\nasync function/,
  )?.[0] ?? "";
  const buyerOptions = worker.match(
    /if \(notificationType === "buyer_order_confirmation"\)[\s\S]*?\n  }/,
  )?.[0] ?? "";

  assert.match(sellerRenderer, /omitBuyerFacingSections: true/);
  assert.doesNotMatch(buyerOptions, /omitBuyerFacingSections/);
  assert.match(worker,
    /options\.omitBuyerFacingSections[\s\S]*Pickup policy/);
  assert.match(worker,
    /options\.omitBuyerFacingSections[\s\S]*Farm contact information/);
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

test("worker re-resolves owner and preserves buyer Reply-To and delivery behavior", () => {
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
