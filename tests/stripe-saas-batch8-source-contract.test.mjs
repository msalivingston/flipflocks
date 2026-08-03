import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root,
  "supabase/migrations/20260802103000_saas_invoice_lifecycle_application.sql");
const handlerPath = path.join(root,
  "supabase/functions/stripe-saas-webhook/handler.ts");
const indexPath = path.join(root,
  "supabase/functions/stripe-saas-webhook/index.ts");
const migration = readFileSync(migrationPath, "utf8");
const handler = readFileSync(handlerPath, "utf8");
const index = readFileSync(indexPath, "utf8");

test("Batch 8 invoice authority requires a deferred claim and fencing token", () => {
  assert.match(migration, /p_processing_lease_token uuid/);
  assert.match(migration,
    /deferred_reason is distinct from 'awaiting_immutable_enrollment_binding'/);
  assert.match(migration,
    /processing_lease_token is distinct from p_processing_lease_token/);
  assert.match(migration, /processing_lease_expires_at <= v_now/);
  assert.match(migration, /mark_saas_billing_provider_event_processed/);
  assert.match(migration, /SAAS_INVOICE_EVENT_FENCE_INVALID/);
});

test("only the verified payment-succeeded branch may extend paid-through", () => {
  assert.match(migration,
    /v_extends := v_outcome = 'payment_succeeded'/);
  assert.match(migration,
    /paid_through_at = greatest\(status\.paid_through_at, p_service_period_end\)/);
  const subscriptionFunction = migration.split(
    "create function public.apply_verified_stripe_subscription_event(",
  )[1].split("create or replace function public.resolve_store_entitlement")[0];
  assert.doesNotMatch(subscriptionFunction, /set\s+paid_through_at\s*=/i);
  assert.doesNotMatch(subscriptionFunction,
    /paid_through_at\s*=\s*p_current_period_end/i);
});

test("Invoice paid boolean and Subscription scheduling are never payment authority", () => {
  assert.doesNotMatch(index, /invoice\.paid\b/);
  assert.doesNotMatch(handler, /invoice\.paid\b/);
  assert.doesNotMatch(migration,
    /paid_through_at\s*=\s*(?:p_)?current_period_end/i);
  assert.match(migration, /p_amount_due_cents > 0/);
  assert.match(migration, /p_amount_paid_cents > 0/);
  assert.match(migration, /p_amount_remaining_cents = 0/);
});

test("grace is exactly three days from verified trial or paid-through evidence", () => {
  assert.match(migration, /v_grace_end := v_grace_anchor \+ interval '3 days'/);
  assert.match(migration, /v_grace_anchor := v_enrollment\.trial_ends_at/);
  assert.match(migration, /v_grace_anchor := v_billing\.paid_through_at/);
  assert.match(migration, /v_reason = 'subscription_cycle'/);
  assert.doesNotMatch(migration, /next_payment_attempt_at\s*\+\s*interval/i);
});

test("operational Stripe access is read-only and stores no provider objects", () => {
  assert.match(index, /stripe\.invoices\.retrieve/);
  assert.match(index, /stripe\.subscriptions\.retrieve/);
  assert.match(index, /stripe\.products\.retrieve/);
  assert.doesNotMatch(index,
    /stripe\.(?:invoices|subscriptions|products)\.(?:create|update|del|voidInvoice|pay|finalizeInvoice)/);
  assert.doesNotMatch(migration, /raw_payload|request_headers|payment_intent_details/i);
  assert.doesNotMatch(handler, /console\.(?:log|error).*evidence/i);
});

test("Subscription lifecycle cannot shorten paid access or create grace", () => {
  assert.match(migration, /provider_status = p_subscription_status/);
  assert.match(migration, /is_current = case when v_event_type = 'customer\.subscription\.deleted'/);
  assert.match(migration,
    /v_enrollment\.provider_status = 'canceled'[\s\S]+v_enrollment\.ended_at is not null/);
  const subscriptionFunction = migration.split(
    "create function public.apply_verified_stripe_subscription_event(",
  )[1].split("create or replace function public.resolve_store_entitlement")[0];
  assert.doesNotMatch(subscriptionFunction, /set\s+grace_ends_at\s*=/i);
  assert.doesNotMatch(subscriptionFunction, /storefront_enabled/i);
});

test("browser, Portal, Connect, buyer-payment, and refund authority are absent", () => {
  const source = `${migration}\n${handler}\n${index}`;
  assert.doesNotMatch(source, /Authorization:\s*Bearer|request\.headers\.get\(["']authorization/i);
  assert.doesNotMatch(source, /billingPortal|portal\.sessions|accountLinks|transfers\.create/i);
  assert.doesNotMatch(source, /application_fee_amount|stripeAccount:/i);
  assert.doesNotMatch(source, /order_refunds|record_stripe_refund|pay_at_pickup/i);
  assert.doesNotMatch(source, /boolean_value\s*=\s*true/i);
});

test("Batch 8 changes remain confined to SaaS server, migration, docs, and tests", () => {
  const changed = execFileSync("git", ["status", "--short"], {
    cwd: root,
    encoding: "utf8",
  }).split(/\r?\n/).filter(Boolean).map((line) =>
    line.slice(3).replaceAll("\\", "/")
  );
  const allowed = [
    /^supabase\/migrations\/2026080210(?:3000_saas_invoice_lifecycle_application|4000_seller_saas_billing_status_read_model)\.sql$/,
    /^supabase\/tests\/saas_invoice_lifecycle_(?:application|concurrency)_test\.sql$/,
    /^supabase\/functions\/stripe-saas-webhook\/(?:handler|index)\.ts$/,
    /^tests\/stripe-saas-(?:webhook-handler|webhook-source-contract|batch8-source-contract)\.test\.mjs$/,
    /^tests\/stripe-saas-batch7-source-contract\.test\.mjs$/,
    /^tests\/stripe-saas-batch4-source-contract\.test\.mjs$/,
    /^docs\/stripe-saas-webhook-deployment\.md$/,
    /^supabase\/tests\/seller_saas_billing_status_test\.sql$/,
    /^supabase\/functions\/stripe-saas-checkout\/index\.ts$/,
    /^app\/(?:dashboard\/(?:_components\/seller-(?:app-shell|billing-banner|billing-context)|account\/(?:seller-account|subscription-billing-panel))|onboarding\/(?:page|_components\/(?:onboarding-flow|step-5-plan-access-form)|billing\/return\/(?:page|stripe-return-status)))\.tsx$/,
    /^app\/onboarding\/billing\/$/,
    /^lib\/saas-billing-status\.ts$/,
    /^tests\/stripe-saas-batch9-source-contract\.test\.mjs$/,
    /^tests\/authoritative-entitlements\.test\.mjs$/,
  ];
  for (const file of changed) {
    assert.ok(allowed.some((pattern) => pattern.test(file)),
      `unexpected Batch 8 path: ${file}`);
  }
});
