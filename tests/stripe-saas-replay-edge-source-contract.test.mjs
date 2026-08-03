import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const indexPath = path.join(root,
  "supabase/functions/stripe-saas-replay-checkout-event/index.ts");
const handlerPath = path.join(root,
  "supabase/functions/stripe-saas-replay-checkout-event/handler.ts");
const configPath = path.join(root, "supabase/config.toml");
const formPath = path.join(root,
  "app/admin/stripe-replay/stripe-checkout-replay-form.tsx");
const replayTestPath = path.join(root,
  "supabase/tests/saas_checkout_conflict_replay_test.sql");

test("temporary endpoint uses runtime secrets and exact operator authorization", async () => {
  const [index, config] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(configPath, "utf8"),
  ]);
  assert.match(config,
    /\[functions\.stripe-saas-replay-checkout-event\]\s*verify_jwt = true/);
  assert.match(index, /STRIPE_SAAS_API_KEY/);
  assert.match(index, /SUPABASE_URL/);
  assert.match(index, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(index, /STRIPE_SAAS_REPLAY_OPERATOR_USER_ID/);
  assert.match(index, /STRIPE_SAAS_REPLAY_ALLOWED_EVENT_ID/);
  assert.match(index, /user\.id !== operatorUserId/);
  assert.match(index, /\.eq\("role", "admin"\)/);
  assert.match(index, /\.is\("store_id", null\)/);
  assert.doesNotMatch(index, /console\.|request\.json\(|raw payload/i);
});

test("browser supplies only event ID while provider identity comes from the ledger", async () => {
  const [index, handler, form] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(handlerPath, "utf8"),
    readFile(formPath, "utf8"),
  ]);
  assert.match(handler, /Object\.keys\(value\)\.length !== 1/);
  assert.match(handler, /value\.event_id/);
  assert.match(index, /get_failed_saas_checkout_completion_replay_state/);
  assert.match(index, /claim_failed_saas_checkout_completion_replay/);
  assert.match(index, /before\.payload_hash/);
  assert.match(index, /before\.stripe_account_id/);
  assert.match(index, /before\.provider_object_id/);
  assert.match(index, /reconcileClaimedCheckoutCompletion/);
  assert.match(index, /apply_verified_saas_checkout_completion/);
  assert.doesNotMatch(form,
    /payload_hash|customer_id|subscription_id|checkout_session_id|store_id|stripe_account|service.role|api.key/i);
  assert.match(form, /body: \{ event_id: normalized \}/);
});

test("existing audited replay contract retains allowlist, authority, and fencing safeguards", async () => {
  const source = await readFile(replayTestPath, "utf8");
  assert.match(source, /unsupported permanent failure code cannot be reopened/i);
  assert.match(source, /replay refuses a store that already has any immutable billing authority/i);
  assert.match(source, /stale replay fencing token cannot finalize/i);
  assert.match(source, /processed replay cannot be opened again/i);
  assert.match(source, /one Customer binding/i);
  assert.match(source, /one Subscription enrollment/i);
  assert.match(source, /one durable trial claim/i);
});

test("endpoint is one-purpose and exposes only the safe result contract", async () => {
  const [index, handler] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(handlerPath, "utf8"),
  ]);
  assert.match(index, /checkout\.session\.completed/);
  assert.match(index, /checkout\.session/);
  assert.doesNotMatch(index,
    /invoice\.payment|customer\.subscription\.(?:created|updated|deleted)|reset_failed|generic_replay/i);
  assert.doesNotMatch(handler,
    /provider_event_id|payload_hash|stripe_customer|stripe_subscription|checkout_session|email|raw_/i);
  for (const field of [
    "result",
    "conflict_code",
    "customer_binding_exists",
    "subscription_enrollment_exists",
    "trial_claim_exists",
    "lifecycle_state",
  ]) assert.match(handler, new RegExp(field));
});
