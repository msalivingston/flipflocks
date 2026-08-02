import assert from "node:assert/strict";
import test from "node:test";

import {
  CheckoutProviderError,
  createStripeSaasCheckoutHandler,
} from "../supabase/functions/stripe-saas-checkout/handler.ts";

const ATTEMPT_ID = "d5000000-0000-4000-8000-000000000001";
const STORE_ID = "d5000000-0000-4000-9000-000000000001";
const SESSION_ID = "cs_test_Batch5Session";

function attempt(overrides = {}) {
  return {
    checkout_state: "created",
    attempt_id: ATTEMPT_ID,
    store_id: STORE_ID,
    attempt_status: "creating",
    stripe_price_id: "price_Batch5Trusted",
    stripe_product_id: "prod_Batch5Trusted",
    stripe_customer_id: null,
    stripe_checkout_session_id: null,
    stripe_idempotency_key: `ff:saas_checkout:local:${ATTEMPT_ID}:v1`,
    session_created_at: null,
    session_expires_at: null,
    trial_eligibility: "trial_eligible",
    retry_after_seconds: null,
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    id: SESSION_ID,
    url: "https://checkout.stripe.com/c/pay/batch5",
    mode: "subscription",
    status: "open",
    livemode: false,
    created: 1_800_000_000,
    expires_at: 1_800_086_400,
    customer: null,
    metadata: { checkout_attempt_id: ATTEMPT_ID },
    ...overrides,
  };
}

function checkoutRequest(body = {
  plan_key: "small_flock",
  billing_cadence: "monthly",
}, overrides = {}) {
  return new Request("https://functions.test/stripe-saas-checkout", {
    method: "POST",
    headers: {
      Authorization: "Bearer verified-user-token",
      Origin: "https://flockfront.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    ...overrides,
  });
}

function harness(overrides = {}) {
  const calls = { begin: [], create: [], retrieve: [], record: [], failed: [] };
  const dependencies = {
    allowedOrigin: "https://flockfront.test",
    stripeLivemode: false,
    stripeAccountId: "acct_Batch5Platform",
    authenticate: async () => "d5000000-0000-4000-8000-000000000001",
    beginCheckout: async (...args) => {
      calls.begin.push(args);
      return attempt();
    },
    createCheckoutSession: async (value) => {
      calls.create.push(value);
      return session();
    },
    retrieveCheckoutSession: async (sessionId) => {
      calls.retrieve.push(sessionId);
      return session({ id: sessionId });
    },
    recordCheckoutSession: async (...args) => {
      calls.record.push(args);
    },
    markCheckoutCreationFailed: async (...args) => {
      calls.failed.push(args);
    },
    ...overrides,
  };
  return { handler: createStripeSaasCheckoutHandler(dependencies), calls };
}

test("verified user intent creates and records one trusted Checkout Session", async () => {
  const testHarness = harness();
  const response = await testHarness.handler(checkoutRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    status: "redirect",
    checkout_url: "https://checkout.stripe.com/c/pay/batch5",
  });
  assert.deepEqual(testHarness.calls.begin, [[
    "d5000000-0000-4000-8000-000000000001",
    "small_flock",
    "monthly",
  ]]);
  assert.equal(testHarness.calls.create.length, 1);
  assert.equal(testHarness.calls.record.length, 1);
  assert.equal("stripe_price_id" in body, false);
  assert.equal("attempt_id" in body, false);
});

test("authentication, ownership contract failure, and foreign origins fail closed", async () => {
  let beginCalls = 0;
  const unauthenticated = harness({ authenticate: async () => null });
  assert.equal((await unauthenticated.handler(checkoutRequest())).status, 401);

  const databaseRejected = harness({
    beginCheckout: async () => {
      beginCalls += 1;
      throw new Error("sensitive database detail");
    },
  });
  const rejected = await databaseRejected.handler(checkoutRequest());
  assert.equal(rejected.status, 409);
  assert.deepEqual(await rejected.json(), { error: "checkout_unavailable" });
  assert.equal(beginCalls, 1);

  const foreign = harness();
  const foreignRequest = checkoutRequest(undefined, {
    headers: {
      Authorization: "Bearer verified-user-token",
      Origin: "https://attacker.test",
      "Content-Type": "application/json",
    },
  });
  assert.equal((await foreign.handler(foreignRequest)).status, 403);
  assert.equal(foreign.calls.begin.length, 0);
});

test("request accepts only canonical plan and cadence intent", async () => {
  for (const body of [
    { plan_key: "coop", billing_cadence: "monthly" },
    { plan_key: "small_flock", billing_cadence: "annual" },
    { plan_key: "small_flock", billing_cadence: "monthly", stripe_price_id: "price_browser" },
    { plan_key: "small_flock", billing_cadence: "monthly", trial_eligible: true },
  ]) {
    const testHarness = harness();
    const response = await testHarness.handler(checkoutRequest(body));
    assert.equal(response.status, 400);
    assert.equal(testHarness.calls.begin.length, 0);
  }
});

test("same open attempt retrieves rather than creates or records a second Session", async () => {
  const testHarness = harness({
    beginCheckout: async () => attempt({
      checkout_state: "resumable",
      attempt_status: "open",
      stripe_checkout_session_id: SESSION_ID,
    }),
  });
  const response = await testHarness.handler(checkoutRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(testHarness.calls.retrieve, [SESSION_ID]);
  assert.equal(testHarness.calls.create.length, 0);
  assert.equal(testHarness.calls.record.length, 0);
});

test("pending confirmation, conflicting selection, and rate limiting are explicit", async () => {
  const pending = harness({
    beginCheckout: async () => attempt({
      checkout_state: "resumable",
      attempt_status: "pending_confirmation",
    }),
  });
  const pendingResponse = await pending.handler(checkoutRequest());
  assert.equal(pendingResponse.status, 202);
  assert.deepEqual(await pendingResponse.json(), { status: "pending_confirmation" });

  const conflict = harness({
    beginCheckout: async () => attempt({ checkout_state: "selection_conflict" }),
  });
  assert.equal((await conflict.handler(checkoutRequest())).status, 409);

  const limited = harness({
    beginCheckout: async () => attempt({
      checkout_state: "rate_limited",
      attempt_id: null,
      attempt_status: null,
      retry_after_seconds: 90,
    }),
  });
  const limitedResponse = await limited.handler(checkoutRequest());
  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedResponse.headers.get("Retry-After"), "90");
});

test("only definitive provider failures close a creating attempt", async () => {
  const definitive = harness({
    createCheckoutSession: async () => {
      throw new CheckoutProviderError("stripe_checkout_request_rejected", true);
    },
  });
  const definitiveResponse = await definitive.handler(checkoutRequest());
  assert.equal(definitiveResponse.status, 502);
  assert.deepEqual(definitive.calls.failed, [[
    ATTEMPT_ID,
    "stripe_checkout_request_rejected",
  ]]);

  const ambiguous = harness({
    createCheckoutSession: async () => {
      throw new CheckoutProviderError("stripe_checkout_request_ambiguous", false);
    },
  });
  const ambiguousResponse = await ambiguous.handler(checkoutRequest());
  assert.equal(ambiguousResponse.status, 503);
  assert.deepEqual(ambiguous.calls.failed, []);
});

test("invalid provider mode, metadata, or URL never reaches recording or browser redirect", async () => {
  for (const invalid of [
    session({ livemode: true, id: "cs_live_Batch5Session" }),
    session({ mode: "payment" }),
    session({ metadata: { checkout_attempt_id: "other" } }),
    session({ url: "https://example.test/not-stripe" }),
  ]) {
    const testHarness = harness({ createCheckoutSession: async () => invalid });
    const response = await testHarness.handler(checkoutRequest());
    assert.equal(response.status, 503);
    assert.equal(testHarness.calls.record.length, 0);
  }
});

test("database-recording failure leaves the idempotent creating attempt recoverable", async () => {
  const testHarness = harness({
    recordCheckoutSession: async () => {
      throw new Error("database unavailable");
    },
  });
  const response = await testHarness.handler(checkoutRequest());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "checkout_confirmation_pending" });
  assert.deepEqual(testHarness.calls.failed, []);
});
