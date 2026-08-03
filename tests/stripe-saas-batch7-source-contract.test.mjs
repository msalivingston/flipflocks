import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(root,
  "supabase/migrations/20260802102000_verified_saas_trial_enrollment.sql");
const webhookIndexPath = path.join(root,
  "supabase/functions/stripe-saas-webhook/index.ts");
const webhookHandlerPath = path.join(root,
  "supabase/functions/stripe-saas-webhook/handler.ts");
const checkoutIndexPath = path.join(root,
  "supabase/functions/stripe-saas-checkout/index.ts");

async function sources() {
  return await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(webhookIndexPath, "utf8"),
    readFile(webhookHandlerPath, "utf8"),
    readFile(checkoutIndexPath, "utf8"),
  ]);
}

test("verified completion application is fenced, typed, transactional, and service-only", async () => {
  const [migration] = await sources();
  const applyFunction = migration.match(
    /create function public\.apply_verified_saas_checkout_completion[\s\S]*?\$function\$;/,
  )?.[0] ?? "";
  assert.match(applyFunction, /p_processing_lease_token uuid/);
  assert.match(applyFunction, /processing_lease_token is distinct from p_processing_lease_token/);
  assert.match(applyFunction, /processing_lease_expires_at <= v_now/);
  assert.match(applyFunction, /event_type is distinct from 'checkout\.session\.completed'/);
  assert.match(applyFunction, /payload_hash is distinct from v_hash/);
  assert.match(applyFunction, /processing_environment_id is distinct from v_environment/);
  assert.match(applyFunction, /insert into public\.billing_customer_bindings/);
  assert.match(applyFunction, /insert into public\.billing_subscription_enrollments/);
  assert.match(applyFunction, /insert into public\.billing_trial_claims/);
  assert.match(applyFunction, /mark_saas_billing_provider_event_processed/);
  assert.match(migration,
    /grant execute on function public\.apply_verified_saas_checkout_completion\([\s\S]*?\) to service_role/);
  assert.doesNotMatch(migration,
    /grant execute on function public\.apply_verified_saas_checkout_completion\([\s\S]*?\) to (?:authenticated|anon|public)/);
  assert.doesNotMatch(applyFunction, /jsonb(?:_to_record|_populate_record)|p_payload json|raw_payload/i);
});

test("trial access requires immutable bindings, verified Price, claim provenance, and matching dates", async () => {
  const [migration] = await sources();
  assert.match(migration, /v_price\.is_active/);
  assert.match(migration, /v_price\.is_verified/);
  assert.match(migration, /v_trial\.provider_event_id = v_enrollment\.bound_by_event_id/);
  assert.match(migration, /v_trial\.trial_started_at = v_enrollment\.trial_started_at/);
  assert.match(migration, /v_trial\.trial_ends_at = v_enrollment\.trial_ends_at/);
  assert.match(migration, /v_billing\.storefront_access_until = v_enrollment\.trial_ends_at/);
  assert.match(migration, /v_reason := 'stripe_trial'/);
  assert.match(migration, /interval '7 days 5 minutes'/);
});

test("Checkout completion never creates paid-through authority or treats trial payment status as payment", async () => {
  const [migration, webhookIndex, webhookHandler] = await sources();
  const applyFunction = migration.match(
    /create function public\.apply_verified_saas_checkout_completion[\s\S]*?\$function\$;/,
  )?.[0] ?? "";
  assert.doesNotMatch(applyFunction, /paid_through_at\s*=/);
  assert.doesNotMatch(applyFunction, /last_paid_stripe_invoice_id\s*=/);
  assert.match(applyFunction, /p_session_payment_status is distinct from 'no_payment_required'/);
  assert.match(applyFunction, /p_session_payment_status is distinct from 'paid'/);
  assert.match(applyFunction, /verified_paid_enrollment_pending_invoice/);
  assert.doesNotMatch(`${webhookIndex}\n${webhookHandler}`,
    /apply_verified_saas_invoice|paid_through_at\s*:/);
});

test("webhook retrieves read-only provider evidence and validates signed correlation", async () => {
  const [, index, handler] = await sources();
  assert.match(index, /checkout\.sessions\.retrieve/);
  assert.match(index, /customers\.retrieve/);
  assert.match(index, /subscriptions\.retrieve/);
  assert.match(index, /products\.retrieve/);
  assert.doesNotMatch(index, /(?:checkout\.sessions|customers|subscriptions|products)\.(?:create|update|del|cancel)\(/);
  assert.match(handler, /signedCustomerId !== session\.customerId/);
  assert.match(handler, /signedSubscriptionId !== session\.subscriptionId/);
  assert.match(handler, /claimDeferredEvent/);
  assert.match(handler, /applyCheckoutCompletion/);
  assert.match(handler, /deferred_duplicate/);
  assert.doesNotMatch(`${index}\n${handler}`, /request\.json\(\)|raw_payload/);
});

test("browser return state has no enrollment authority and Checkout metadata is correlation-only", async () => {
  const [, , , checkout] = await sources();
  assert.match(checkout, /schema_version: "ff_saas_checkout_v1"/);
  assert.match(checkout, /plan_key: planKey/);
  assert.match(checkout, /billing_cadence: cadence/);
  assert.doesNotMatch(checkout,
    /apply_verified_saas_checkout_completion|billing_customer_bindings|billing_subscription_enrollments|billing_trial_claims/);

  const changed = execFileSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(changed.some((file) => /^(?:app|pages|src\/app|src\/pages)\//.test(file)), false);
  assert.equal(changed.some((file) => /(?:success|return).*\.(?:tsx|ts|jsx|js)$/.test(file)), false);
});

test("Batch 7 does not activate flags or introduce Portal, Connect, buyer-payment, or refund behavior", async () => {
  const [migration, index, handler] = await sources();
  assert.match(migration,
    /set boolean_value = false[\s\S]*?'saas_subscription_checkout_enabled', 'saas_billing_portal_enabled'/);
  const applyFunction = migration.match(
    /create function public\.apply_verified_saas_checkout_completion[\s\S]*?\$function\$;/,
  )?.[0] ?? "";
  const combined = `${applyFunction}\n${index}\n${handler}`;
  assert.doesNotMatch(combined, /billing_portal|portal\.sessions|stripe_account_link|application_fee|transfer_data/);
  assert.doesNotMatch(combined, /payment_intent|charge\.|refund|dispute|connected_account/i);
});
