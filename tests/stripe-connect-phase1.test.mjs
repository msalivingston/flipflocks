import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260820100000_sunshine_mesa_stripe_connect_phase1.sql");
const checkout = read("supabase/functions/stripe-connect-checkout/index.ts");
const webhook = read("supabase/functions/stripe-connect-webhook/index.ts");
const account = read("supabase/functions/stripe-connect-account/index.ts");
const emailWorker = read("supabase/functions/postmark-email-worker/index.ts");
const payAtPickup = read("supabase/functions/pay-at-pickup-order/handler.ts");
const saasCheckout = read("supabase/functions/stripe-saas-checkout/index.ts");
const saasWebhook = read("supabase/functions/stripe-saas-webhook/handler.ts");

test("connected accounts use full Dashboard with account fees and Stripe losses", () => {
  assert.match(account, /fees:\s*\{\s*payer:\s*"account"\s*\}/);
  assert.match(account, /losses:\s*\{\s*payments:\s*"stripe"\s*\}/);
  assert.match(account, /requirement_collection:\s*"stripe"/);
  assert.match(account, /stripe_dashboard:\s*\{\s*type:\s*"full"\s*\}/);
});

test("direct-charge Checkout is scoped to the connected account without platform fund movement", () => {
  assert.match(checkout, /checkout\.sessions\.create\([\s\S]*?stripeAccount:\s*accountId/);
  assert.match(checkout, /mode:\s*"payment"/);
  assert.match(checkout, /payment_method_types:\s*\["card"\]/);
  assert.doesNotMatch(checkout, /application_fee_amount|transfer_data|on_behalf_of|destination/);
  assert.match(checkout, /expiresAt\s*=\s*Math\.floor\(Date\.now\(\)\s*\/\s*1000\)\s*\+\s*30\s*\*\s*60/);
});

test("inventory is held only after Session creation and URL stays private until reservation succeeds", () => {
  const createPosition = checkout.indexOf("stripe.checkout.sessions.create");
  const reservePosition = checkout.indexOf('service.rpc("reserve_storefront_card_checkout"');
  const exposePosition = checkout.indexOf("{ checkout_url: session.url }");
  assert.ok(createPosition > 0 && reservePosition > createPosition && exposePosition > reservePosition);
  assert.match(checkout, /if \(reserveError\)[\s\S]*checkout\.sessions\.expire\(session\.id, \{ stripeAccount: accountId \}\)/);
});

test("reservation covers every inventory type and expiration restores each one", () => {
  for (const type of ["listing_inventory", "equipment_inventory", "processed_poultry_inventory", "hatching_egg_inventory"]) {
    assert.match(migration, new RegExp(`item_type='${type}'`));
  }
  assert.match(migration, /for update of ii/);
  assert.match(migration, /for update of items/g);
  const expired = migration.slice(migration.indexOf("if p_outcome='expired'"), migration.indexOf("if nullif(trim(p_stripe_payment_intent_id)"));
  assert.match(expired, /update public\.inventory_items/);
  assert.match(expired, /update public\.equipment_inventory_items/);
  assert.match(expired, /update public\.processed_poultry_inventory_items/);
  assert.match(expired, /update public\.hatching_egg_inventory_items/);
});

test("settlement is idempotent for duplicate webhook and browser/webhook races", () => {
  assert.match(migration, /if v_reservation\.id is null then[\s\S]*stripe_checkout_sessions[\s\S]*return query select 'paid'/);
  assert.match(webhook, /duplicate:\s*true/);
  assert.match(checkout, /body\.action === "status"[\s\S]*settle\(session, reservation\.stripe_account_id, "paid"\)/);
  assert.match(webhook, /settle_storefront_card_checkout/);
});

test("successful card settlement invokes the existing order-scoped email worker", () => {
  for (const [source, sourceName] of [
    [checkout, "stripe-connect-checkout"],
    [webhook, "stripe-connect-webhook"],
  ]) {
    assert.match(source, /POSTMARK_WORKER_SECRET/);
    assert.match(source, /\/functions\/v1\/postmark-email-worker/);
    assert.match(source, /order_id:\s*orderId/);
    assert.match(source, new RegExp(`source: "${sourceName}"`));
    assert.match(source, /outcome === "paid"[\s\S]*await triggerPostmarkEmailWorker\(orderId\)/);
    assert.doesNotMatch(source, /enqueue_email_notification/);
  }

  assert.match(checkout, /if \(error\) throw error;[\s\S]*const result = first\(data\);[\s\S]*await triggerPostmarkEmailWorker\(orderId\)/);
  assert.match(webhook, /if \(error \|\| !Array\.isArray\(data\) \|\| !data\[0\]\)[\s\S]*await triggerPostmarkEmailWorker\(orderId\)/);
  assert.match(migration, /if v_reservation\.id is null then[\s\S]*return query select 'paid'::text,v_existing_order\.id/);
  assert.match(emailWorker, /orderScope[\s\S]*claim_phase_1_postmark_email_notifications_for_order/);
  assert.match(emailWorker, /orderScope[\s\S]*p_order_id:\s*orderScope/);
});

test("restricted connected accounts fail closed while pickup remains available", () => {
  assert.match(checkout, /card_payments === "active"[\s\S]*charges_enabled === true[\s\S]*payouts_enabled === true/);
  assert.match(account, /return account\.details_submitted \? "restricted" : "incomplete"/);
  assert.match(payAtPickup, /create_pay_at_pickup_order_v2/);
  assert.doesNotMatch(payAtPickup, /stripe-connect|storefront_card_checkout_reservations/);
});

test("existing SaaS Stripe paths remain platform-scoped and separate", () => {
  assert.match(saasCheckout, /mode:\s*"subscription"/);
  assert.doesNotMatch(saasCheckout, /stripeAccount\s*:|store_stripe_connections|reserve_storefront_card_checkout/);
  assert.match(saasWebhook, /event\.account/);
  assert.doesNotMatch(saasWebhook, /storefront_card_checkout_reservations|settle_storefront_card_checkout/);
});

test("pilot schema stores only the approved connection fields", () => {
  const table = migration.match(/create table public\.store_stripe_connections \(([\s\S]*?)\n\);/)?.[1] ?? "";
  assert.match(table, /store_id uuid/);
  assert.match(table, /stripe_livemode boolean/);
  assert.match(table, /stripe_account_id text/);
  assert.doesNotMatch(table, /charges_enabled|payouts_enabled|requirements|capabilit|status|created_at|updated_at/);
  assert.match(migration, /store_slug = 'sunshine-mesa-farm'/);
});
