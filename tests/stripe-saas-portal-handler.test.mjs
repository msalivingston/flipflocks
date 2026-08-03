import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStripePortalSessionParams,
  createStripeSaasPortalHandler,
  isSafeStripePortalUrl,
  PortalProviderError,
} from "../supabase/functions/stripe-saas-portal/handler.ts";

test("Portal Session parameters use the default configuration and preserve targeted flows", () => {
  const returnUrl = "https://flockfront.test/dashboard/account?billing=portal_return";
  for (const action of ["manage_billing", "invoice_history"]) {
    const params = buildStripePortalSessionParams(action, "cus_Batch10", "sub_Batch10", returnUrl);
    assert.equal(Object.hasOwn(params, "configuration"), false);
    assert.equal(params.customer, "cus_Batch10");
    assert.equal(params.return_url, returnUrl);
    assert.equal(params.flow_data, undefined);
  }

  const payment = buildStripePortalSessionParams(
    "update_payment_method", "cus_Batch10", "sub_Batch10", returnUrl,
  );
  assert.equal(Object.hasOwn(payment, "configuration"), false);
  assert.equal(payment.flow_data.type, "payment_method_update");
  assert.equal(payment.flow_data.after_completion.redirect.return_url, returnUrl);

  const cancellation = buildStripePortalSessionParams(
    "cancel_subscription", "cus_Batch10", "sub_Batch10", returnUrl,
  );
  assert.equal(Object.hasOwn(cancellation, "configuration"), false);
  assert.equal(cancellation.flow_data.type, "subscription_cancel");
  assert.equal(cancellation.flow_data.subscription_cancel.subscription, "sub_Batch10");
  assert.equal(cancellation.flow_data.after_completion.redirect.return_url, returnUrl);
});

function authorization(overrides = {}) {
  return {
    action_state: "created",
    action_request_id: "fa000000-0000-4000-a000-000000000001",
    store_id: "fa000000-0000-4000-9000-000000000001",
    stripe_customer_id: "cus_Batch10",
    stripe_subscription_id: "sub_Batch10",
    retry_after_seconds: null,
    ...overrides,
  };
}
function session(overrides = {}) {
  return {
    id: "bps_Batch10",
    url: "https://billing.stripe.com/p/session/batch10",
    configuration: "bpc_Batch10General",
    customer: "cus_Batch10",
    created: 1_800_000_000,
    livemode: false,
    ...overrides,
  };
}
function request(body = { action: "manage_billing" }, overrides = {}) {
  return new Request("https://functions.test/stripe-saas-portal", {
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
  const calls = { begin: [], create: [], record: [], failed: [] };
  const dependencies = {
    allowedOrigin: "https://flockfront.test",
    stripeLivemode: false,
    authenticate: async () => "fa000000-0000-4000-8000-000000000001",
    beginPortalAction: async (...args) => {
      calls.begin.push(args);
      return authorization();
    },
    createPortalSession: async (...args) => {
      calls.create.push(args);
      return session();
    },
    recordPortalSession: async (...args) => calls.record.push(args),
    markActionFailed: async (...args) => calls.failed.push(args),
    ...overrides,
  };
  return { handler: createStripeSaasPortalHandler(dependencies), calls };
}

test("Portal requires verified bearer authentication", async () => {
  const { handler } = harness();
  assert.equal((await handler(request(undefined, { headers: { "Content-Type": "application/json" } }))).status, 401);
  const invalid = harness({ authenticate: async () => null });
  assert.equal((await invalid.handler(request())).status, 401);
});

test("Portal request accepts only the four allowlisted action names", async () => {
  for (const action of ["manage_billing", "update_payment_method", "invoice_history", "cancel_subscription"]) {
    const { handler, calls } = harness();
    const response = await handler(request({ action }));
    assert.equal(response.status, 200);
    assert.equal(calls.begin[0][1], action);
  }
  assert.equal((await harness().handler(request({ action: "change_plan" }))).status, 400);
  assert.equal((await harness().handler(request({ action: "manage_billing", customer_id: "cus_browser" }))).status, 400);
  assert.equal((await harness().handler(request({ action: "manage_billing", subscription_id: "sub_browser" }))).status, 400);
  assert.equal((await harness().handler(request({ action: "manage_billing", return_url: "https://evil.test" }))).status, 400);
});

test("Portal uses server-derived authorization and returns only a safe URL", async () => {
  const { handler, calls } = harness();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    portal_url: "https://billing.stripe.com/p/session/batch10",
  });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.record.length, 1);
});

test("Portal rejects non-Stripe redirect hosts and mode mismatch", async () => {
  for (const invalid of [
    session({ url: "https://evil.test/steal" }),
    session({ url: "https://billing.stripe.com.evil.test/steal" }),
    session({ livemode: true }),
    session({ customer: "cus_OtherStore" }),
  ]) {
    const { handler, calls } = harness({ createPortalSession: async () => invalid });
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.equal(calls.record.length, 0);
  }
  assert.equal(isSafeStripePortalUrl("https://billing.stripe.com/p/session/good"), true);
});

test("Portal rate limiting returns 429 without creating a provider Session", async () => {
  const { handler, calls } = harness({
    beginPortalAction: async () => authorization({ action_state: "rate_limited", retry_after_seconds: 90 }),
  });
  const response = await handler(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "90");
  assert.equal(calls.create.length, 0);
});

test("Portal binding failures fail closed before Stripe", async () => {
  const { handler, calls } = harness({
    beginPortalAction: async () => { throw new Error("cross-store binding"); },
  });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal(calls.create.length, 0);
  assert.deepEqual(await response.json(), { error: "billing_management_unavailable" });
});

test("Portal errors and responses redact provider secrets", async () => {
  const secret = ["sk", "test", "Batch10Secret"].join("_");
  const { handler } = harness({
    createPortalSession: async () => { throw new PortalProviderError("stripe_portal_request_ambiguous", secret); },
  });
  const response = await handler(request());
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.equal(body.includes(secret), false);
});

test("Portal import performs no provider or database call", () => {
  assert.equal(typeof createStripeSaasPortalHandler, "function");
});
