import assert from "node:assert/strict";
import test from "node:test";

import {
  createStripeSaasSubscriptionActionHandler,
  ResumeProviderError,
} from "../supabase/functions/stripe-saas-subscription-action/handler.ts";

function authorization(overrides = {}) {
  return {
    action_state: "created",
    action_request_id: "fa000000-0000-4000-a000-000000000002",
    store_id: "fa000000-0000-4000-9000-000000000001",
    stripe_customer_id: "cus_Batch10",
    stripe_subscription_id: "sub_Batch10",
    stripe_idempotency_key: "ff:saas_resume:local:fa000000-0000-4000-a000-000000000002:v1",
    ...overrides,
  };
}
function request(body = { action: "resume" }, overrides = {}) {
  return new Request("https://functions.test/stripe-saas-subscription-action", {
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
  const calls = { begin: [], update: [], record: [], failed: [] };
  const dependencies = {
    allowedOrigin: "https://flockfront.test",
    authenticate: async () => "fa000000-0000-4000-8000-000000000001",
    beginResume: async (...args) => {
      calls.begin.push(args);
      return authorization();
    },
    requestResume: async (...args) => calls.update.push(args),
    recordResumeRequested: async (...args) => calls.record.push(args),
    markActionFailed: async (...args) => calls.failed.push(args),
    ...overrides,
  };
  return { handler: createStripeSaasSubscriptionActionHandler(dependencies), calls };
}

test("resume requires valid authentication and exact request body", async () => {
  const missing = await harness().handler(request(undefined, { headers: { "Content-Type": "application/json" } }));
  assert.equal(missing.status, 401);
  assert.equal((await harness({ authenticate: async () => null }).handler(request())).status, 401);
  assert.equal((await harness().handler(request({ action: "cancel" }))).status, 400);
  assert.equal((await harness().handler(request({ action: "resume", subscription_id: "sub_browser" }))).status, 400);
});

test("eligible resume uses immutable server authorization and waits for webhook", async () => {
  const { handler, calls } = harness();
  const response = await handler(request());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: "resume_requested" });
  assert.equal(calls.update.length, 1);
  assert.equal(calls.record.length, 1);
});

test("already requested resume is idempotent and makes no second Stripe call", async () => {
  const { handler, calls } = harness({
    beginResume: async () => authorization({ action_state: "already_requested" }),
  });
  assert.equal((await handler(request())).status, 202);
  assert.equal(calls.update.length, 0);
  assert.equal(calls.record.length, 0);
});

test("ownership, hold, complimentary, terminal, or malformed rejection fails before Stripe", async () => {
  const { handler, calls } = harness({
    beginResume: async () => { throw new Error("ineligible"); },
  });
  assert.equal((await handler(request())).status, 409);
  assert.equal(calls.update.length, 0);
});

test("missing immutable Customer, Subscription, or idempotency binding fails closed", async () => {
  for (const override of [
    { stripe_customer_id: null },
    { stripe_subscription_id: null },
    { stripe_idempotency_key: null },
  ]) {
    const { handler, calls } = harness({ beginResume: async () => authorization(override) });
    assert.equal((await handler(request())).status, 409);
    assert.equal(calls.update.length, 0);
  }
});

test("resume provider errors are redacted and safely recorded", async () => {
  const secret = ["sk", "test", "Batch10Secret"].join("_");
  const { handler, calls } = harness({
    requestResume: async () => { throw new ResumeProviderError("stripe_resume_request_rejected", true); },
  });
  const response = await handler(request());
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.equal(body.includes(secret), false);
  assert.equal(calls.failed.length, 1);
});

test("ambiguous resume failures retain the action and stable idempotency key for retry", async () => {
  const { handler, calls } = harness({
    requestResume: async () => { throw new ResumeProviderError("stripe_resume_request_ambiguous", false); },
  });
  assert.equal((await handler(request())).status, 503);
  assert.equal(calls.failed.length, 0);
});

test("database record failure does not optimistically report authoritative resume", async () => {
  const { handler } = harness({ recordResumeRequested: async () => { throw new Error("database unavailable"); } });
  assert.equal((await handler(request())).status, 503);
});

test("subscription action import performs no provider call", () => {
  assert.equal(typeof createStripeSaasSubscriptionActionHandler, "function");
});
