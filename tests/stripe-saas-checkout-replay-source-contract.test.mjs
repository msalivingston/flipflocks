import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(root,
  "supabase/migrations/20260803101000_saas_checkout_conflict_diagnostics_and_replay.sql");
const handlerPath = path.join(root,
  "supabase/functions/stripe-saas-webhook/handler.ts");
const scriptPath = path.join(root,
  "scripts/stripe/replay-saas-checkout-event.mjs");

test("Checkout replay is narrow, service-only, fenced, and authority-empty", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const replay = migration.match(
    /create function public\.claim_failed_saas_checkout_completion_replay[\s\S]*?\$function\$;/,
  )?.[0] ?? "";
  assert.match(replay, /event_type is distinct from btrim\(p_event_type\)/);
  assert.match(replay, /'checkout\.session\.completed'/);
  assert.match(replay, /provider_object_type.*'checkout\.session'/s);
  assert.match(replay, /payload_hash is distinct from lower/);
  assert.match(replay, /processing_environment_id is distinct/);
  assert.match(replay, /processing_lease_token = v_token/);
  assert.match(replay, /attempt_count = events\.attempt_count \+ 1/);
  assert.match(replay, /billing_customer_bindings/);
  assert.match(replay, /billing_subscription_enrollments/);
  assert.match(replay, /billing_trial_claims/);
  assert.doesNotMatch(replay, /raw_payload|jsonb_to_record|delete from/i);
  assert.match(migration,
    /grant execute on function public\.claim_failed_saas_checkout_completion_replay\([\s\S]*?\) to service_role/);
  assert.doesNotMatch(migration,
    /grant execute on function public\.claim_failed_saas_checkout_completion_replay\([\s\S]*?\) to (?:authenticated|anon|public)/);
});

test("known conflicts never use the legacy generic runtime code", async () => {
  const [handler, script] = await Promise.all([
    readFile(handlerPath, "utf8"),
    readFile(scriptPath, "utf8"),
  ]);
  assert.match(handler, /ENROLLMENT_RPC_CONFLICT_CODES/);
  assert.match(handler, /permanentConflictResponse/);
  assert.match(handler, /X-FlockFront-Error-Code/);
  assert.doesNotMatch(handler, /"checkout_completion_binding_conflict"/);
  assert.doesNotMatch(script, /console\.(?:log|error)|process\.env\s*=/);
  assert.match(script, /get_failed_saas_checkout_completion_replay_state/);
  assert.match(script, /claim_failed_saas_checkout_completion_replay/);
  assert.match(script, /reconcileClaimedCheckoutCompletion/);
});
