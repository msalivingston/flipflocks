import assert from "node:assert/strict";
import test from "node:test";

import {
  ENROLLMENT_RPC_CONFLICT_CODES,
  enrollmentRpcError,
} from "../supabase/functions/stripe-saas-webhook/handler.ts";
import {
  runVerifiedCheckoutReplay,
} from "../scripts/stripe/replay-saas-checkout-event.mjs";

const SECRET = "sk_test_replayfixturesecret";
const SERVICE_KEY = "service-role-fixture-secret";
const EVENT_ID = "evt_ReplayFixture";
const HASH = "a".repeat(64);
const ATTEMPT_ID = "d7000000-0000-4000-8000-000000000001";
const STORE_ID = "d7000000-0000-4000-8000-000000000002";

function state(overrides = {}) {
  return {
    provider_event_id: EVENT_ID,
    payload_hash: HASH,
    stripe_account_id: "acct_1CTOghL1R5g4hhXt",
    stripe_livemode: false,
    processing_environment_id: "local",
    event_type: "checkout.session.completed",
    provider_object_type: "checkout.session",
    provider_object_id: "cs_test_ReplayFixture",
    provider_event_created_at: "2026-08-03T18:02:00.000Z",
    processing_status: "failed",
    last_error_code: "checkout_completion_binding_conflict",
    attempt_status: "open",
    customer_binding_exists: false,
    subscription_enrollment_exists: false,
    trial_claim_exists: false,
    lifecycle_state: "checkout_in_progress",
    ...overrides,
  };
}

function stripeFixture() {
  const metadata = {
    checkout_attempt_id: ATTEMPT_ID,
    store_id: STORE_ID,
    environment_id: "local",
    plan_key: "small_flock",
    billing_cadence: "monthly",
    schema_version: "ff_saas_checkout_v1",
  };
  return {
    checkout: { sessions: { retrieve: async () => ({
      id: "cs_test_ReplayFixture",
      created: 1_785_777_600,
      expires_at: 1_785_864_000,
      status: "complete",
      mode: "subscription",
      payment_status: "no_payment_required",
      payment_method_collection: "always",
      client_reference_id: ATTEMPT_ID,
      livemode: false,
      customer: "cus_ReplayFixture",
      subscription: "sub_ReplayFixture",
      metadata,
    }) } },
    customers: { retrieve: async () => ({
      id: "cus_ReplayFixture", created: 1_785_777_601,
      livemode: false, deleted: false,
    }) },
    subscriptions: { retrieve: async () => ({
      id: "sub_ReplayFixture",
      customer: "cus_ReplayFixture",
      status: "trialing",
      created: 1_785_777_601,
      trial_start: 1_785_777_601,
      trial_end: 1_786_382_401,
      cancel_at_period_end: false,
      livemode: false,
      collection_method: "charge_automatically",
      default_payment_method: "pm_ReplayFixture",
      metadata,
      items: { data: [{
        quantity: 1,
        current_period_start: 1_785_777_601,
        current_period_end: 1_786_382_401,
        price: {
          id: "price_ReplayFixture",
          product: {
            id: "prod_ReplayFixture", livemode: false, active: true,
            deleted: false, tax_code: "txcd_10103001",
          },
          livemode: false,
          active: true,
          unit_amount: 500,
          currency: "usd",
          recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
          type: "recurring",
          billing_scheme: "per_unit",
          tax_behavior: "exclusive",
        },
      }] },
    }) },
    products: { retrieve: async () => { throw new Error("not expected"); } },
  };
}

function supabaseHarness({ applicationError = null } = {}) {
  const calls = [];
  let applied = false;
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "get_failed_saas_checkout_completion_replay_state") {
        return { data: [state(applied ? {
          processing_status: "processed",
          last_error_code: null,
          attempt_status: "enrolled",
          customer_binding_exists: true,
          subscription_enrollment_exists: true,
          trial_claim_exists: true,
          lifecycle_state: "stripe_trial",
        } : {})], error: null };
      }
      if (name === "claim_failed_saas_checkout_completion_replay") {
        return { data: [{
          replay_state: "claimed",
          attempt_count: 3,
          processing_lease_token: "d6000000-0000-4000-8000-000000000099",
          lease_expires_at: "2026-08-03T18:07:00.000Z",
          conflict_code: "checkout_completion_binding_conflict",
        }], error: null };
      }
      if (name === "apply_verified_saas_checkout_completion") {
        if (applicationError) return { data: null, error: applicationError };
        applied = true;
        return { data: [{ application_state: "trial_enrolled" }], error: null };
      }
      if (name === "mark_saas_billing_provider_event_failed") {
        return { data: "failed", error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return { client, calls };
}

const environment = {
  STRIPE_SAAS_API_KEY: SECRET,
  STRIPE_PLATFORM_ACCOUNT_ID: "acct_1CTOghL1R5g4hhXt",
  STRIPE_SAAS_LIVEMODE: "false",
  FLOCKFRONT_ENVIRONMENT_ID: "local",
  SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
};

test("every allowlisted database enrollment rejection maps to a distinct safe code", () => {
  const values = Object.values(ENROLLMENT_RPC_CONFLICT_CODES);
  assert.ok(values.length >= 25);
  for (const [databaseCode, safeCode] of Object.entries(
    ENROLLMENT_RPC_CONFLICT_CODES,
  )) {
    const classified = enrollmentRpcError({ message: databaseCode });
    assert.equal(classified.errorCode, safeCode);
    assert.equal(classified.retryable, false);
    assert.doesNotMatch(classified.message, /SAAS_ENROLLMENT|database|SQL/i);
  }
  const unknown = enrollmentRpcError({
    message: "sensitive database exception with provider details",
  });
  assert.equal(unknown.errorCode, "checkout_completion_apply_failed");
  assert.equal(unknown.retryable, true);
  assert.doesNotMatch(unknown.message, /sensitive|provider details/i);
});

test("controlled replay uses original ledger identity and produces only safe output", async () => {
  const fixture = supabaseHarness();
  const output = [];
  const result = await runVerifiedCheckoutReplay({
    argv: [`--event-id=${EVENT_ID}`],
    env: environment,
    createSupabase: () => fixture.client,
    createStripe: () => stripeFixture(),
    write: (line) => output.push(line),
  });
  assert.equal(result.result, "processed");
  assert.deepEqual(fixture.calls.map(({ name }) => name), [
    "get_failed_saas_checkout_completion_replay_state",
    "claim_failed_saas_checkout_completion_replay",
    "apply_verified_saas_checkout_completion",
    "get_failed_saas_checkout_completion_replay_state",
  ]);
  const claim = fixture.calls[1].args;
  assert.equal(claim.p_provider_event_id, EVENT_ID);
  assert.equal(claim.p_payload_hash, HASH);
  assert.equal(claim.p_event_type, "checkout.session.completed");
  assert.equal(claim.p_provider_object_type, "checkout.session");
  const printed = output.join("\n");
  assert.match(printed, /Result: processed/);
  assert.match(printed, /Customer binding exists: yes/);
  assert.match(printed, /Lifecycle state: stripe_trial/);
  for (const secret of [SECRET, SERVICE_KEY, EVENT_ID, HASH,
    "cs_test_ReplayFixture", "cus_ReplayFixture", "sub_ReplayFixture"]) {
    assert.doesNotMatch(printed, new RegExp(secret));
  }
});

test("known replay conflict records and returns only its sanitized code", async () => {
  const fixture = supabaseHarness({
    applicationError: { message: "SAAS_ENROLLMENT_PRICE_MISMATCH" },
  });
  const output = [];
  await assert.rejects(
    runVerifiedCheckoutReplay({
      argv: [`--event-id=${EVENT_ID}`],
      env: environment,
      createSupabase: () => fixture.client,
      createStripe: () => stripeFixture(),
      write: (line) => output.push(line),
    }),
    (error) => error.code === "checkout_price_mismatch",
  );
  const failure = fixture.calls.find(({ name }) =>
    name === "mark_saas_billing_provider_event_failed");
  assert.equal(failure.args.p_error_code, "checkout_price_mismatch");
  const printed = output.join("\n");
  assert.doesNotMatch(printed, /SAAS_ENROLLMENT|price_ReplayFixture|sk_test|service-role/);
});
