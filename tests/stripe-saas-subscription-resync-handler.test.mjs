import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createStripeSaasSubscriptionResyncHandler } from
  "../supabase/functions/stripe-saas-resync-subscription/handler.ts";

function request(body = { action: "resync" }, overrides = {}) {
  return new Request("https://functions.test/stripe-saas-resync-subscription", {
    method: "POST",
    headers: {
      Authorization: "Bearer operator-token",
      Origin: "https://flockfront.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    ...overrides,
  });
}

function harness(overrides = {}) {
  const calls = { authorize: 0, resync: 0 };
  const handler = createStripeSaasSubscriptionResyncHandler({
    allowedOrigin: "https://flockfront.test",
    authorizeOperator: async () => { calls.authorize += 1; return true; },
    resync: async () => {
      calls.resync += 1;
      return { status: "applied", scheduled_cancellation: true };
    },
    ...overrides,
  });
  return { handler, calls };
}

test("approved-origin preflight succeeds before authentication or resync", async () => {
  const fixture = harness({
    authorizeOperator: async () => {
      throw new Error("authentication must not run during preflight");
    },
    resync: async () => {
      throw new Error("resync must not run during preflight");
    },
  });
  const response = await fixture.handler(new Request(
    "https://functions.test/stripe-saas-resync-subscription",
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://flockfront.test",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, apikey, content-type, x-client-info",
      },
    },
  ));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://flockfront.test");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(
    response.headers.get("Access-Control-Allow-Headers"),
    "authorization, x-client-info, apikey, content-type",
  );
  assert.deepEqual(fixture.calls, { authorize: 0, resync: 0 });
});

test("preflight from any origin other than the configured application fails closed", async () => {
  for (const origin of ["https://attacker.test", null]) {
    const fixture = harness();
    const requestHeaders = origin ? { Origin: origin } : undefined;
    const response = await fixture.handler(new Request(
      "https://functions.test/stripe-saas-resync-subscription",
      { method: "OPTIONS", headers: requestHeaders },
    ));

    assert.equal(response.status, 403);
    assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
    assert.deepEqual(fixture.calls, { authorize: 0, resync: 0 });
  }
});

test("one-purpose authenticated resync accepts no store or provider identity", async () => {
  const fixture = harness();
  const response = await fixture.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "applied",
    scheduled_cancellation: true,
  });
  assert.equal(fixture.calls.resync, 1);
  for (const body of [
    { action: "resync", store_id: "browser" },
    { action: "resync", subscription_id: "sub_browser" },
    { action: "other" },
  ]) {
    assert.equal((await harness().handler(request(body))).status, 400);
  }
});

test("ordinary or missing authentication cannot invoke resync", async () => {
  const denied = harness({ authorizeOperator: async () => false });
  assert.equal((await denied.handler(request())).status, 403);
  assert.equal(denied.calls.resync, 0);
  const missing = harness();
  const response = await missing.handler(request(undefined, {
    headers: { Origin: "https://flockfront.test", "Content-Type": "application/json" },
  }));
  assert.equal(response.status, 401);
  assert.equal(missing.calls.resync, 0);
});

test("resync failures are redacted and never return provider evidence", async () => {
  const secret = "sk_test_do_not_expose";
  const fixture = harness({ resync: async () => { throw new Error(secret); } });
  const response = await fixture.handler(request());
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.equal(body.includes(secret), false);
  assert.equal(/(?:cus|sub|price|prod)_[A-Za-z0-9]+|store_id/.test(body), false);
});

test("temporary admin UI sends only the fixed resync action", () => {
  const source = fs.readFileSync(path.join(
    process.cwd(), "app/admin/stripe-subscription-resync/stripe-subscription-resync-form.tsx",
  ), "utf8");
  assert.match(source, /body: \{ action: "resync" \}/);
  assert.doesNotMatch(source, /customer_id|subscription_id|store_id|price_id|product_id|account_id|livemode/);
});
