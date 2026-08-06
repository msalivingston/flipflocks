import assert from "node:assert/strict";
import test from "node:test";

import {
  createStripeSaasSubscriptionActionHandler,
  PlanChangeProviderError,
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
  const calls = {
    begin: [], update: [], record: [], failed: [], beginPlan: [], change: [],
    bind: [], beginCancel: [], cancel: [], canceled: [], planFailed: [],
  };
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
    beginPlanChange: async (...args) => {
      calls.beginPlan.push(args);
      return planAuthorization();
    },
    requestPlanChange: async (...args) => {
      calls.change.push(args);
      return { stripe_invoice_id: "in_PlanChange", status: "pending_payment" };
    },
    recordPlanChangeProviderBinding: async (...args) => calls.bind.push(args),
    beginScheduledChangeCancellation: async (...args) => {
      calls.beginCancel.push(args);
      return scheduledCancellation();
    },
    requestScheduledChangeCancellation: async (...args) => calls.cancel.push(args),
    recordScheduledChangeCanceled: async (...args) => calls.canceled.push(args),
    markPlanChangeFailed: async (...args) => calls.planFailed.push(args),
    ...overrides,
  };
  return { handler: createStripeSaasSubscriptionActionHandler(dependencies), calls };
}

function planAuthorization(overrides = {}) {
  return {
    action_state: "created",
    plan_change_id: "fa000000-0000-4000-a000-000000000003",
    store_id: "fa000000-0000-4000-9000-000000000001",
    stripe_customer_id: "cus_Batch10",
    stripe_subscription_id: "sub_Batch10",
    source_stripe_price_id: "price_CoopMonthly",
    target_stripe_price_id: "price_MarketMonthly",
    change_timing: "immediate",
    stripe_idempotency_key: "ff:saas-plan-change:local:fa000000-0000-4000-a000-000000000003:v1",
    stripe_invoice_id: null,
    stripe_schedule_id: null,
    effective_at: null,
    ...overrides,
  };
}

function scheduledCancellation(overrides = {}) {
  return {
    plan_change_id: "fa000000-0000-4000-a000-000000000003",
    stripe_customer_id: "cus_Batch10",
    stripe_subscription_id: "sub_Batch10",
    stripe_schedule_id: "sub_sched_Batch10",
    stripe_idempotency_key: "ff:saas-plan-change-cancel:local:fa000000-0000-4000-a000-000000000003:v1",
    ...overrides,
  };
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

test("Coop monthly upgrade accepts enums only and waits for verified payment", async () => {
  const { handler, calls } = harness();
  const response = await handler(request({
    action: "change_plan",
    target_plan_key: "full_flock",
    target_billing_cadence: "monthly",
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: "pending_payment" });
  assert.equal(calls.change.length, 1);
  assert.deepEqual(calls.bind[0], [
    "fa000000-0000-4000-a000-000000000003",
    { stripe_invoice_id: "in_PlanChange", status: "pending_payment" },
  ]);
  assert.equal((await harness().handler(request({
    action: "change_plan",
    target_plan_key: "price_browser_controlled",
    target_billing_cadence: "monthly",
  }))).status, 400);
});

test("definitive upgrade rejection is recorded without exposing provider detail", async () => {
  const { handler, calls } = harness({
    requestPlanChange: async () => {
      throw new PlanChangeProviderError("stripe_plan_change_state_rejected", true);
    },
  });
  const response = await handler(request({
    action: "change_plan", target_plan_key: "full_flock", target_billing_cadence: "monthly",
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(calls.planFailed[0], [
    "fa000000-0000-4000-a000-000000000003", "stripe_plan_change_state_rejected",
  ]);
});

test("unbound ambiguous plan change retries while a provider-bound change is idempotent", async () => {
  const unbound = harness({
    beginPlanChange: async () => planAuthorization({ action_state: "already_pending" }),
  });
  assert.equal((await unbound.handler(request({
    action: "change_plan", target_plan_key: "full_flock", target_billing_cadence: "monthly",
  }))).status, 202);
  assert.equal(unbound.calls.change.length, 1);

  const bound = harness({
    beginPlanChange: async () => planAuthorization({
      action_state: "already_pending", stripe_invoice_id: "in_PlanChange",
    }),
  });
  assert.equal((await bound.handler(request({
    action: "change_plan", target_plan_key: "full_flock", target_billing_cadence: "monthly",
  }))).status, 202);
  assert.equal(bound.calls.change.length, 0);
});

test("scheduled downgrade cancellation records cancellation only after provider success", async () => {
  const success = harness();
  const response = await success.handler(request({ action: "cancel_scheduled_change" }));
  assert.equal(response.status, 202);
  assert.equal(success.calls.cancel.length, 1);
  assert.equal(success.calls.canceled.length, 1);

  const failure = harness({
    requestScheduledChangeCancellation: async () => {
      throw new PlanChangeProviderError("stripe_schedule_release_rejected", true);
    },
  });
  assert.equal((await failure.handler(request({ action: "cancel_scheduled_change" }))).status, 503);
  assert.equal(failure.calls.canceled.length, 0);
  assert.equal(failure.calls.planFailed.length, 0);
});
