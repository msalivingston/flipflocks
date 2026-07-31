import assert from "node:assert/strict";
import test from "node:test";

import {
  createManualOrderEmailKickHandler,
} from "../supabase/functions/manual-order-email-kick/handler.ts";

const ORDER_ID = "50000000-0000-4000-8000-000000000001";
const FOREIGN_ORDER_ID = "50000000-0000-4000-8000-000000000002";

function request({
  authorization = "Bearer owner-token",
  body = { order_id: ORDER_ID },
  method = "POST",
} = {}) {
  return new Request("https://functions.test/manual-order-email-kick", {
    method,
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function harness({
  authenticate = async () => true,
  authorizeOrderKick = async (_authorization, orderId) => ({
    orderId,
    queuedNotificationCount: 2,
  }),
  invokeWorker = async () => true,
  resolveRecentOrderId = async () => null,
} = {}) {
  const workerOrderIds = [];
  const handler = createManualOrderEmailKickHandler({
    authenticate,
    authorizeOrderKick,
    resolveRecentOrderId,
    async invokeWorker(orderId) {
      workerOrderIds.push(orderId);
      return invokeWorker(orderId);
    },
    corsHeaders: {
      "Access-Control-Allow-Origin": "https://flockfront.test",
    },
  });

  return { handler, workerOrderIds };
}

test("an authenticated owner can kick only the authorized order scope", async () => {
  const testHarness = harness();
  const response = await testHarness.handler(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.processing_started, true);
  assert.equal(body.order_id, ORDER_ID);
  assert.deepEqual(testHarness.workerOrderIds, [ORDER_ID]);
});

test("missing or invalid authentication cannot reach authorization or worker code", async () => {
  for (const testRequest of [
    request({ authorization: "" }),
    request({ authorization: "Bearer invalid" }),
  ]) {
    let authorizationCalls = 0;
    const testHarness = harness({
      authenticate: async (authorization) => authorization !== "Bearer invalid",
      authorizeOrderKick: async () => {
        authorizationCalls += 1;
        throw new Error("should not run");
      },
    });
    const response = await testHarness.handler(testRequest);

    assert.equal(response.status, 401);
    assert.equal(authorizationCalls, 0);
    assert.deepEqual(testHarness.workerOrderIds, []);
  }
});

test("foreign orders and rate-limited orders fail without invoking the worker", async () => {
  const foreignHarness = harness({
    authorizeOrderKick: async () => {
      throw new Error("Order is not available.");
    },
  });
  const foreignResponse = await foreignHarness.handler(
    request({ body: { order_id: FOREIGN_ORDER_ID } }),
  );

  assert.equal(foreignResponse.status, 403);
  assert.deepEqual(foreignHarness.workerOrderIds, []);

  const limitedHarness = harness({
    authorizeOrderKick: async () => {
      throw new Error("Email processing request limit reached.");
    },
  });
  const limitedResponse = await limitedHarness.handler(request());

  assert.equal(limitedResponse.status, 429);
  assert.deepEqual(limitedHarness.workerOrderIds, []);
});

test("a kick with no due rows is successful but does not start a worker", async () => {
  const testHarness = harness({
    authorizeOrderKick: async (_authorization, orderId) => ({
      orderId,
      queuedNotificationCount: 0,
    }),
  });
  const response = await testHarness.handler(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.processing_started, false);
  assert.deepEqual(testHarness.workerOrderIds, []);
});

test("the deployment compatibility path fails closed on ambiguous recent orders", async () => {
  const compatibleHarness = harness({
    resolveRecentOrderId: async () => ORDER_ID,
  });
  const compatibleResponse = await compatibleHarness.handler(
    request({ body: null }),
  );

  assert.equal(compatibleResponse.status, 200);
  assert.deepEqual(compatibleHarness.workerOrderIds, [ORDER_ID]);

  const ambiguousHarness = harness({
    resolveRecentOrderId: async () => null,
  });
  const ambiguousResponse = await ambiguousHarness.handler(
    request({ body: null }),
  );

  assert.equal(ambiguousResponse.status, 400);
  assert.deepEqual(ambiguousHarness.workerOrderIds, []);
});

test("malformed order scope is rejected before database authorization", async () => {
  let authorizationCalls = 0;
  const testHarness = harness({
    authorizeOrderKick: async () => {
      authorizationCalls += 1;
      throw new Error("should not run");
    },
  });
  const response = await testHarness.handler(
    request({ body: { order_id: "not-a-uuid" } }),
  );

  assert.equal(response.status, 400);
  assert.equal(authorizationCalls, 0);
  assert.deepEqual(testHarness.workerOrderIds, []);
});

test("an oversized body is rejected even without a Content-Length header", async () => {
  let authorizationCalls = 0;
  const testHarness = harness({
    authorizeOrderKick: async () => {
      authorizationCalls += 1;
      throw new Error("should not run");
    },
  });
  const oversizedRequest = new Request(
    "https://functions.test/manual-order-email-kick",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer owner-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order_id: ORDER_ID,
        padding: "x".repeat(5_000),
      }),
    },
  );

  assert.equal(oversizedRequest.headers.has("content-length"), false);

  const response = await testHarness.handler(oversizedRequest);

  assert.equal(response.status, 413);
  assert.equal(authorizationCalls, 0);
  assert.deepEqual(testHarness.workerOrderIds, []);
});
