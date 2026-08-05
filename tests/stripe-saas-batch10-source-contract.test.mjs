import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (value) => fs.readFileSync(path.join(root, value), "utf8");
const migration = read("supabase/migrations/20260802105000_saas_billing_management_actions.sql");
const safetyMigration = read("supabase/migrations/20260803103000_saas_billing_portal_controlled_rollout.sql");
const portalIndex = read("supabase/functions/stripe-saas-portal/index.ts");
const portalHandler = read("supabase/functions/stripe-saas-portal/handler.ts");
const resumeIndex = read("supabase/functions/stripe-saas-subscription-action/index.ts");
const resumeHandler = read("supabase/functions/stripe-saas-subscription-action/handler.ts");
const panel = read("app/dashboard/account/subscription-billing-panel.tsx");
const management = read("lib/saas-billing-management.ts");
const config = read("supabase/config.toml");
const documentation = read("docs/stripe-saas-billing-management.md");
const runtime = read("supabase/functions/_shared/stripe-saas-runtime.mjs");

test("Batch 10 functions are authenticated and registered but remain undeployed by source", () => {
  assert.match(config, /\[functions\.stripe-saas-portal\]\s*verify_jwt = true/);
  assert.match(config, /\[functions\.stripe-saas-subscription-action\]\s*verify_jwt = true/);
  assert.doesNotMatch(config, /saas_billing_portal_enabled\s*=\s*true/);
});

test("browser inputs cannot supply provider or tenant authority", () => {
  assert.match(portalHandler, /allowedBodyKeys = new Set\(\["action"\]\)/);
  assert.match(resumeHandler, /Object\.keys\(value\)\.length === 1/);
  for (const source of [panel]) {
    assert.doesNotMatch(source, /customer_id|subscription_id|store_id|price_id|product_id/);
  }
  assert.match(panel, /body: \{ action \}/);
  assert.match(panel, /body: \{ action: "resume" \}/);
});

test("Portal uses fixed server configuration and host validation", () => {
  assert.match(portalIndex, /FLOCKFRONT_APP_ORIGIN/);
  for (const name of [
    "STRIPE_GENERAL_PORTAL_CONFIGURATION_ID",
    "STRIPE_CANCEL_PORTAL_CONFIGURATION_ID",
  ]) {
    assert.doesNotMatch(portalIndex, new RegExp(name));
    assert.doesNotMatch(resumeIndex, new RegExp(name));
    assert.doesNotMatch(runtime, new RegExp(name));
  }
  assert.match(portalIndex, /dashboard\/account\?billing=portal_return/);
  assert.match(portalHandler, /url\.hostname === "billing\.stripe\.com"/);
  assert.match(portalIndex, /billingPortal\.sessions\.create/);
  assert.match(portalIndex, /billingPortal\.configurations\.retrieve/);
  assert.match(portalHandler, /type: "payment_method_update"/);
  assert.match(portalHandler, /type: "subscription_cancel"/);
  assert.match(portalHandler, /subscription_cancel:\s*\{\s*subscription:/);
  assert.match(portalIndex, /buildStripePortalSessionParams/);
  assert.match(portalIndex, /safe\.customer !== authorization\.stripe_customer_id/);
  assert.doesNotMatch(portalHandler, /type:\s*["']subscription_update["']/);
  assert.match(portalHandler, /subscriptionUpdate\.enabled !== false/);
  assert.match(portalHandler, /"subscription_cancel", "subscription_pause", "subscription_update"/);
  assert.match(portalHandler, /hasKeys\(subscriptionPause, \["enabled"\]\)/);
  assert.match(portalHandler, /subscriptionPause\.enabled !== false/);
  assert.match(portalHandler, /\["none", "always_invoice"\]\.includes\([\s\S]*subscriptionUpdate\.proration_behavior/);
  assert.match(portalHandler, /!Array\.isArray\(conditions\) \|\| conditions\.length !== 0/);
  assert.match(portalHandler, /subscriptionCancel\.mode !== "at_period_end"/);
  assert.match(portalHandler, /subscriptionCancel\.proration_behavior !== "none"/);
});

test("resume updates only provider cancellation scheduling with stable idempotency", () => {
  assert.match(resumeIndex, /subscriptions\.update\([\s\S]*\{ cancel_at_period_end: false \}[\s\S]*idempotencyKey/);
  assert.doesNotMatch(resumeIndex, /price:|trial_end|billing_cycle_anchor|default_payment_method|collection_method|metadata:/);
  assert.match(migration, /ff:saas_resume:' \|\| p_environment_id \|\| ':' \|\| v_action_id::text \|\| ':v1'/);
  assert.doesNotMatch(migration, /set\s+cancel_at_period_end\s*=\s*false/i);
  assert.doesNotMatch(migration, /set\s+paid_through_at|set\s+plan_key|set\s+storefront_enabled/i);
});

test("action contracts are service-only and same-store bound", () => {
  assert.match(migration, /billing_management_actions_enrollment_context_fk foreign key[\s\S]*subscription_enrollment_id, store_id, stripe_subscription_id,[\s\S]*stripe_livemode, stripe_account_id/);
  assert.match(migration, /revoke all on table public\.billing_management_action_requests[\s\S]*public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table public\.billing_management_action_requests[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,180}to authenticated/);
  assert.match(migration, /saas_billing_portal_enabled'\), false/);
  assert.match(safetyMigration, /create table public\.saas_billing_portal_store_cohort/);
  assert.match(safetyMigration, /alter table public\.saas_billing_portal_store_cohort enable row level security/);
  assert.match(safetyMigration, /revoke all on table public\.saas_billing_portal_store_cohort[\s\S]*public, anon, authenticated/);
  assert.match(safetyMigration, /SAAS_BILLING_PORTAL_COHORT_REQUIRED/);
  assert.doesNotMatch(
    safetyMigration,
    /insert into public\.saas_billing_portal_store_cohort\s*\(store_id\)\s*values\s*\(\s*'[0-9a-f-]{36}'/i,
  );
  assert.match(safetyMigration, /begin_saas_billing_portal_action_unscoped_v1[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(safetyMigration, /begin_saas_subscription_resume_unscoped_v1[\s\S]*from public, anon, authenticated, service_role/);
});

test("verified Subscription processing completes only matching pending resume audit", () => {
  assert.match(safetyMigration, /new\.event_type is distinct from 'customer\.subscription\.updated'/);
  assert.match(safetyMigration, /new\.processing_environment_id/);
  assert.match(safetyMigration, /enrollment\.last_subscription_event_id = new\.provider_event_id/);
  assert.match(safetyMigration, /action\.request_status = 'provider_requested'/);
  assert.match(safetyMigration, /set request_status = 'completed'/);
  assert.doesNotMatch(safetyMigration, /set\s+paid_through_at|set\s+trial_ends_at|set\s+storefront_access_until/i);
});

test("seller controls are authoritative-state gated and Portal-return is presentation only", () => {
  assert.match(panel, /getBillingManagementAvailability\(status\)/);
  assert.match(management, /status\.portal_enabled/);
  assert.match(management, /current_enrollment_exists/);
  assert.match(management, /customer_binding_exists/);
  assert.match(panel, /Canceling stops your next renewal/);
  assert.match(panel, /Stripe is confirming that your subscription will continue/);
  assert.match(panel, /billing.*portal_return/);
  assert.match(panel, /setPortalReturnPending\(false\)/);
  assert.match(panel, /Stripe changes may take a moment to appear/);
  assert.match(panel, /No billing change is assumed/);
  assert.match(panel, /trial_canceling_at_period_end/);
  assert.doesNotMatch(panel, /cancel_at_period_end\s*:/);
  assert.doesNotMatch(panel, /paid_through_at\s*:/);
  assert.doesNotMatch(panel, /resolve_store_entitlement|billing_complete\s*:/);
});

test("deployment documentation keeps all secrets server-only and plan changes disabled", () => {
  assert.match(documentation, /STRIPE_SAAS_API_KEY/);
  assert.doesNotMatch(documentation, /STRIPE_GENERAL_PORTAL_CONFIGURATION_ID/);
  assert.doesNotMatch(documentation, /STRIPE_CANCEL_PORTAL_CONFIGURATION_ID/);
  assert.match(documentation, /saved default sandbox Portal configuration/);
  assert.match(documentation, /Product and Price switching[\s\S]*must remain disabled/);
  assert.match(documentation, /temporary[\s\S]*STRIPE_SAAS_CATALOG_READ_KEY[\s\S]*is unrelated/i);
  assert.doesNotMatch(documentation, /(sk|rk)_(test|live)_[A-Za-z0-9]{8,}/);
});

test("Batch 10 introduces no Connect, buyer-payment, refund, or Pay at Pickup behavior", () => {
  const combined = [migration, portalIndex, portalHandler, resumeIndex, resumeHandler, panel].join("\n");
  assert.doesNotMatch(combined, /connected_account|application_fee|destination:/i);
  assert.doesNotMatch(combined, /payment_intent|chargeback|order_refund|pay_at_pickup/i);
});
