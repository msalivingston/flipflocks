import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(root,
  "supabase/migrations/20260805120000_saas_plan_change_first_slice.sql");
const actionIndexPath = path.join(root,
  "supabase/functions/stripe-saas-subscription-action/index.ts");
const actionHandlerPath = path.join(root,
  "supabase/functions/stripe-saas-subscription-action/handler.ts");
const webhookIndexPath = path.join(root,
  "supabase/functions/stripe-saas-webhook/index.ts");
const panelPath = path.join(root,
  "app/dashboard/account/subscription-billing-panel.tsx");

async function sources() {
  return Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(actionIndexPath, "utf8"),
    readFile(actionHandlerPath, "utf8"),
    readFile(webhookIndexPath, "utf8"),
    readFile(panelPath, "utf8"),
  ]);
}

test("browser accepts only the two monthly plan enums and never a Price ID", async () => {
  const [migration, , handler] = await sources();
  const parser = handler.match(/async function parseAction[\s\S]*?^}/m)?.[0] ?? "";
  assert.match(handler, /targetPlanKey: "small_flock" \| "full_flock"/);
  assert.match(handler, /value\.target_billing_cadence === "monthly"/);
  assert.doesNotMatch(parser, /target_price|price_id|customer_id|subscription_id/);
  assert.match(migration, /billing_provider_price_catalog[\s\S]*?p_target_plan_key/);
  assert.match(migration, /saas_billing_portal_store_cohort/);
  assert.match(migration, /owner_user_id = p_authenticated_user_id/);
});

test("immediate upgrade uses the existing item and exact safe Stripe options", async () => {
  const [, index] = await sources();
  assert.match(index, /items:\s*\[\{[\s\S]*?id: item\.id[\s\S]*?price: authorization\.target_stripe_price_id[\s\S]*?quantity: 1/);
  assert.match(index, /payment_behavior: "pending_if_incomplete"/);
  assert.match(index, /proration_behavior: "always_invoice"/);
  assert.match(index, /subscription\.items\.data\.length !== 1/);
  assert.match(index, /item\.quantity !== 1/);
  for (const binding of [
    "subscription.livemode", "subscription.customer", "item.price.id",
    "subscription.status", "subscription.collection_method",
  ]) assert.match(index, new RegExp(binding.replaceAll(".", "\\.")));
});

test("period-end downgrade creates and configures one release schedule", async () => {
  const [, index] = await sources();
  assert.match(index, /subscriptionSchedules\.create\([\s\S]*?from_subscription: subscription\.id/);
  assert.match(index, /subscriptionSchedules\.update\([\s\S]*?end_behavior: "release"/);
  assert.match(index, /start_date: currentPhase\.start_date[\s\S]*?end_date: boundary[\s\S]*?price: authorization\.source_stripe_price_id/);
  assert.match(index, /start_date: boundary[\s\S]*?price: authorization\.target_stripe_price_id/);
  assert.match(index, /subscriptionSchedules\.release/);
});

test("invoice and Subscription event order converges before entitlement changes", async () => {
  const [migration, , , webhook] = await sources();
  assert.match(webhook, /get_open_saas_plan_change_for_subscription/);
  assert.match(webhook, /hasAuthorizedImmediatePlanChangeForInvoice/);
  assert.match(webhook, /const candidateLines = usePlanChangeValidation/);
  assert.match(webhook, /apply_verified_saas_plan_change_invoice_event/);
  assert.match(webhook, /apply_verified_saas_plan_change_subscription_event/);
  assert.match(migration, /p_outcome = 'payment_succeeded'[\s\S]*?p_current_subscription_price_id = v_change\.target_stripe_price_id[\s\S]*?complete_verified_saas_plan_change/);
  assert.match(migration, /p_stripe_price_id = v_change\.target_stripe_price_id[\s\S]*?invoice_status = 'paid'[\s\S]*?complete_verified_saas_plan_change/);
  assert.match(migration, /if v_change\.status = 'completed' then return 'already_completed'/);
});

test("downgrade reset mutates quantities only and logs exact before and after", async () => {
  const [migration, , , , panel] = await sources();
  assert.match(migration, /listing_batches\.batch_type = 'live_animals'/);
  assert.match(migration, /set quantity_available = 0/);
  assert.doesNotMatch(migration, /delete from public\.inventory_items/);
  assert.match(migration, /'inventory_quantity_adjusted'[\s\S]*?v_item\.quantity_available, 0/);
  assert.match(panel, /seller_get_saas_downgrade_inventory_preview/);
  assert.match(panel, /Download inventory CSV/);
  assert.match(panel, /scheduled_change_cancelable/);
});
