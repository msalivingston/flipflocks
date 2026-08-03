import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(root,
  "supabase/migrations/20260802101000_saas_webhook_event_ledger_contracts.sql");
const indexPath = path.join(root, "supabase/functions/stripe-saas-webhook/index.ts");
const handlerPath = path.join(root, "supabase/functions/stripe-saas-webhook/handler.ts");

async function sources() {
  return await Promise.all([
    readFile(path.join(root, "supabase/config.toml"), "utf8"),
    readFile(migrationPath, "utf8"),
    readFile(indexPath, "utf8"),
    readFile(handlerPath, "utf8"),
    readFile(path.join(root, "supabase/functions/_shared/stripe-saas-client.ts"), "utf8"),
    readFile(path.join(root, "supabase/functions/_shared/stripe-saas-runtime.mjs"), "utf8"),
  ]);
}

test("webhook gateway is public while authority comes only from Stripe verification", async () => {
  const [config, , index, handler, client] = await sources();
  assert.match(config, /\[functions\.stripe-saas-webhook\]\s*verify_jwt = false/);
  assert.match(index, /createStripeSaasWebhookVerifier\(stripeConfig, 300\)/);
  assert.match(client, /Stripe\.webhooks\.constructEventAsync/);
  assert.match(client, /constructEventAsync[\s\S]*?assertStripeWebhookTimestampWithinTolerance/);
  assert.match(handler, /verifySignature\(rawBody, signature\)/);
  assert.doesNotMatch(`${index}\n${handler}`, /auth\.getUser|getSession|Authorization|Bearer/);
  assert.doesNotMatch(handler, /Access-Control-Allow-Origin|\*\s*['"]/);
});

test("exact raw bytes are read once and verified before any event field is trusted", async () => {
  const [, , , handler] = await sources();
  assert.equal((handler.match(/request\.arrayBuffer\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(handler, /request\.json\(\)|request\.text\(\)/);
  assert.match(handler, /verifySignature\(rawBody, signature\)[\s\S]*?validateVerifiedEvent/);
  assert.match(handler, /STRIPE_SAAS_WEBHOOK_MAX_BODY_BYTES = 1_048_576/);
  assert.doesNotMatch(handler, /console\.(?:log|warn|error)/);
});

test("signature verification remains key-independent while Batch 7 retrieval uses the operational client", async () => {
  const [, , index, , client, runtime] = await sources();
  assert.match(runtime, /parseStripeSaasWebhookConfig/);
  const parser = runtime.match(/export function parseStripeSaasWebhookConfig[\s\S]*?^}/m)?.[0] ?? "";
  assert.match(parser, /STRIPE_SAAS_WEBHOOK_SECRET/);
  assert.doesNotMatch(parser, /STRIPE_SAAS_API_KEY|STRIPE_SAAS_CATALOG_READ_KEY/);
  assert.match(index, /STRIPE_SAAS_API_KEY/);
  assert.match(index, /createStripeSaasClient\(operationalConfig\)/);
  assert.match(index, /checkout\.sessions\.retrieve/);
  assert.match(index, /subscriptions\.retrieve/);
  assert.doesNotMatch(client.match(/createStripeSaasWebhookVerifier[\s\S]*?^}/m)?.[0] ?? "", /new Stripe|checkout|invoices|subscriptions/);
});

test("ledger functions are service-only with global identity and lease protection", async () => {
  const [, migration] = await sources();
  for (const name of [
    "claim_saas_billing_provider_event",
    "claim_deferred_saas_billing_provider_event",
    "mark_saas_billing_provider_event_processed",
    "mark_saas_billing_provider_event_deferred",
    "mark_saas_billing_provider_event_failed",
    "mark_saas_billing_provider_event_ignored",
    "get_saas_billing_provider_event_state",
  ]) {
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?\\) to service_role`));
    assert.doesNotMatch(migration, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?\\) to authenticated`));
  }
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /processing_lease_expires_at/);
  assert.match(migration, /processing_lease_token/);
  assert.match(migration, /processing_status in \([\s\S]*?'deferred'/);
  assert.match(migration, /provider_event_reconciliation_claimed/);
  assert.match(migration, /provider_event_conflict/);
  assert.match(migration, /payload_hash.*\^\[0-9a-f\]\{64\}\$/s);
});

test("Batch 6 ledger stores no raw payload or billing-domain application", async () => {
  const [, migration, index, handler] = await sources();
  assert.doesNotMatch(migration, /add column[^;]*(?:raw_payload|request_body|request_headers)|jsonb/i);
  assert.doesNotMatch(migration, /insert into public\.(?:billing_customer_bindings|billing_subscription_enrollments|billing_trial_claims)/i);
  assert.doesNotMatch(migration, /update public\.seller_billing_status|update public\.seller_onboarding_state/i);
  assert.doesNotMatch(`${index}\n${handler}`, /raw_payload|request_body|request_headers/);
});

test("routing is SaaS-only, deferred, and independent of Checkout flags", async () => {
  const [, migration, index, handler] = await sources();
  for (const eventType of [
    "checkout.session.completed", "checkout.session.expired",
    "customer.subscription.created", "customer.subscription.updated",
    "customer.subscription.deleted", "customer.subscription.trial_will_end",
    "invoice.payment_succeeded", "invoice.payment_failed",
    "invoice.payment_action_required", "invoice.finalization_failed",
  ]) assert.match(handler, new RegExp(eventType.replaceAll(".", "\\.")));
  assert.doesNotMatch(handler, /charge\.|payment_intent\.|refund\.|dispute\.|account\./);
  assert.doesNotMatch(`${index}\n${handler}`, /saas_subscription_checkout_enabled|saas_billing_portal_enabled/);
  assert.match(handler, /awaiting_verified_enrollment_batch/);
  assert.match(handler, /awaiting_immutable_enrollment_binding/);
  assert.match(handler, /awaiting_checkout_expiration_batch/);
  assert.match(handler, /informational_trial_will_end/);
  assert.match(handler, /markDeferred/);
  assert.match(migration, /unsupported_event_type/);
  assert.match(migration, /not_deferred/);
  assert.match(migration, /claim_deferred_saas_billing_provider_event/);
});

test("no webhook secret, live key, or sensitive payload logging is present in source", async () => {
  const [, migration, index, handler, client, runtime] = await sources();
  const combined = `${migration}\n${index}\n${handler}\n${client}\n${runtime}`;
  assert.doesNotMatch(combined, /whsec_[A-Za-z0-9]{12,}/);
  assert.doesNotMatch(combined, /(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{12,}/);
  assert.doesNotMatch(`${index}\n${handler}`, /signature_header|raw_payload|customer_email|billing_address|checkout_url/);
  assert.match(index, /console\.info\(JSON\.stringify\(record\)\)/);
});

test("webhook failures expose only stable stage diagnostics", async () => {
  const [, , index, handler] = await sources();
  for (const code of [
    "webhook_config_invalid",
    "webhook_signature_invalid",
    "webhook_event_claim_failed",
    "webhook_deferred_claim_failed",
    "webhook_stripe_retrieval_failed",
    "webhook_enrollment_binding_failed",
    "webhook_subscription_snapshot_failed",
    "webhook_invoice_application_failed",
    "webhook_event_finalization_failed",
    "webhook_unexpected_error",
  ]) {
    assert.match(handler, new RegExp(`\\"${code}\\"`));
  }
  assert.match(handler, /X-FlockFront-Error-Code/);
  assert.match(handler, /error:\s*"webhook_processing_failed",\s*code/s);
  assert.match(index, /createStripeSaasWebhookConfigurationErrorHandler/);
  assert.match(index, /catch\s*\{[\s\S]*?configuredHandler\s*=\s*createStripeSaasWebhookConfigurationErrorHandler/);
  assert.doesNotMatch(`${index}\n${handler}`, /console\.(?:error|warn)\s*\(/);
  assert.doesNotMatch(handler, /(?:error|exception)\.(?:message|stack)|JSON\.stringify\((?:error|exception)\)/i);
});

test("deployment documentation keeps webhook, catalog, and operational secrets separate", async () => {
  const documentation = await readFile(
    path.join(root, "docs/stripe-saas-webhook-deployment.md"), "utf8");
  assert.match(documentation, /STRIPE_SAAS_WEBHOOK_SECRET/);
  assert.match(documentation, /restricted key used by the catalog-registration utility is unrelated/i);
  assert.match(documentation, /operational Stripe API key is not used for signature\s+verification/i);
  assert.match(documentation, /Test and live webhook secrets must never be mixed/i);
});
