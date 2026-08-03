import assert from "node:assert/strict";
import test from "node:test";

import { createStripeSaasReplayCheckoutEventHandler } from
  "../supabase/functions/stripe-saas-replay-checkout-event/handler.ts";

const ORIGIN = "https://sandbox.flockfront.test";
const EVENT_ID = "evt_ReplayEndpointFixture";

function request(body, options = {}) {
  return new Request("https://fixture.functions/replay", {
    method: options.method ?? "POST",
    headers: {
      Authorization: options.authorization ?? "Bearer fixture-user-jwt",
      "Content-Type": "application/json",
      Origin: options.origin ?? ORIGIN,
    },
    body: options.method === "GET" ? undefined : JSON.stringify(body),
  });
}

function result(overrides = {}) {
  return {
    result: "processed",
    conflict_code: null,
    customer_binding_exists: true,
    subscription_enrollment_exists: true,
    trial_claim_exists: true,
    lifecycle_state: "stripe_trial",
    ...overrides,
  };
}

function harness({ authorized = true, replayResult = result() } = {}) {
  const calls = [];
  const handler = createStripeSaasReplayCheckoutEventHandler({
    allowedOrigin: ORIGIN,
    async authorizeOperator(authorization) {
      calls.push({ type: "authorize", authorization });
      return authorized;
    },
    async replayVerifiedEvent(eventId) {
      calls.push({ type: "replay", eventId });
      return replayResult;
    },
  });
  return { handler, calls };
}

test("authorized operator supplies only the event ID and receives safe state", async () => {
  const fixture = harness();
  const response = await fixture.handler(request({ event_id: EVENT_ID }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result());
  assert.deepEqual(fixture.calls.map(({ type }) => type), ["authorize", "replay"]);
  assert.equal(fixture.calls[1].eventId, EVENT_ID);
});

test("ordinary authenticated users and foreign origins cannot reach replay", async () => {
  for (const [authorized, origin, expectedStatus] of [
    [false, ORIGIN, 403],
    [true, "https://not-flockfront.test", 403],
  ]) {
    const fixture = harness({ authorized });
    const response = await fixture.handler(request(
      { event_id: EVENT_ID },
      { origin },
    ));
    assert.equal(response.status, expectedStatus);
    assert.equal(fixture.calls.some(({ type }) => type === "replay"), false);
    assert.deepEqual(Object.keys(await response.json()).sort(), [
      "conflict_code",
      "customer_binding_exists",
      "lifecycle_state",
      "result",
      "subscription_enrollment_exists",
      "trial_claim_exists",
    ]);
  }
});

test("unknown fields and browser-supplied provider evidence are rejected", async () => {
  for (const body of [
    { event_id: EVENT_ID, payload_hash: "a".repeat(64) },
    { event_id: EVENT_ID, customer_id: "cus_Browser" },
    { event_id: EVENT_ID, subscription_id: "sub_Browser" },
    { event_id: EVENT_ID, checkout_session_id: "cs_test_Browser" },
    { event_id: EVENT_ID, store_id: "00000000-0000-4000-8000-000000000001" },
    { event_id: EVENT_ID, event_type: "invoice.payment_succeeded" },
  ]) {
    const fixture = harness();
    const response = await fixture.handler(request(body));
    assert.equal(response.status, 400);
    assert.equal(fixture.calls.some(({ type }) => type === "replay"), false);
  }
});

test("unsupported and authority-conflicted events fail closed", async () => {
  for (const replayResult of [
    result({
      result: "not_replayable",
      conflict_code: "checkout_replay_not_allowlisted",
      customer_binding_exists: false,
      subscription_enrollment_exists: false,
      trial_claim_exists: false,
      lifecycle_state: "inactive",
    }),
    result({
      result: "authority_already_exists",
      conflict_code: "checkout_replay_authority_conflict",
    }),
  ]) {
    const fixture = harness({ replayResult });
    const response = await fixture.handler(request({ event_id: EVENT_ID }));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), replayResult);
  }
});

test("exact replay reports processed once and then already processed", async () => {
  let applications = 0;
  const handler = createStripeSaasReplayCheckoutEventHandler({
    allowedOrigin: ORIGIN,
    authorizeOperator: async () => true,
    replayVerifiedEvent: async () => {
      applications += 1;
      return applications === 1
        ? result()
        : result({ result: "already_processed" });
    },
  });
  const first = await handler(request({ event_id: EVENT_ID }));
  const duplicate = await handler(request({ event_id: EVENT_ID }));
  assert.equal((await first.json()).result, "processed");
  assert.equal((await duplicate.json()).result, "already_processed");
});

test("untrusted response values are reduced to the safe response contract", async () => {
  const secret = "sk_test_MustNeverEscape";
  const fixture = harness({
    replayResult: result({
      result: secret,
      conflict_code: `raw_${secret}!`,
      lifecycle_state: "customer@example.test",
    }),
  });
  const response = await fixture.handler(request({ event_id: EVENT_ID }));
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.doesNotMatch(body, /sk_test|customer@/);
});
