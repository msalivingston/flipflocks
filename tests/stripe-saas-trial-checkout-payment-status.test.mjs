import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const correctionPath = path.join(
  root,
  "supabase/migrations/20260803102000_saas_trial_checkout_payment_status.sql",
);
const replayPath = path.join(
  root,
  "supabase/migrations/20260803101000_saas_checkout_conflict_diagnostics_and_replay.sql",
);

test("trial Checkout accepts only paid or no_payment_required with null-safe checks", async () => {
  const correction = await readFile(correctionPath, "utf8");

  assert.match(
    correction,
    /p_session_payment_status is distinct from 'paid'[\s\S]*?and p_session_payment_status is distinct from 'no_payment_required'/,
  );
  assert.doesNotMatch(correction, /p_session_payment_status\s+not\s+in/i);
  assert.match(
    correction,
    /v_original_predicate[\s\S]*?SAAS_TRIAL_CHECKOUT_PAYMENT_STATUS_PREDICATE_UNEXPECTED/,
  );
  assert.match(correction, /'apply_verified_saas_checkout_completion'/);
  assert.match(
    correction,
    /'apply_verified_saas_checkout_completion_transactional_v1'/,
  );
});

test("correction is limited to the trial predicate and adds no payment authority", async () => {
  const correction = await readFile(correctionPath, "utf8");

  assert.doesNotMatch(
    correction,
    /update\s+public\.seller_billing_status|paid_through_at\s*=|last_paid_stripe_invoice_id\s*=/i,
  );
  assert.doesNotMatch(
    correction,
    /apply_verified_saas_invoice_payment_succeeded|invoice\.payment_succeeded/i,
  );
  assert.doesNotMatch(
    correction,
    /saas_subscription_checkout_enabled[\s\S]*?true|saas_billing_portal_enabled[\s\S]*?true/i,
  );
});

test("checkout_trial_state_mismatch remains an allowlisted replay conflict", async () => {
  const replay = await readFile(replayPath, "utf8");
  const replayableCodes = replay.match(
    /v_replayable_codes constant text\[\][\s\S]*?\];/,
  )?.[0] ?? "";

  assert.match(replayableCodes, /'checkout_trial_state_mismatch'/);
});
