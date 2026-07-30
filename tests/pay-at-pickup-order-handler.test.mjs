import assert from "node:assert/strict";
import test from "node:test";

import { createPayAtPickupHandler } from "../supabase/functions/pay-at-pickup-order/handler.ts";

const STORE_ID = "10000000-0000-4000-8000-000000000001";
const ITEM_ID = "20000000-0000-4000-8000-000000000001";

function validPayload(idempotencyKey = "checkout-key-1") {
  return {
    store_slug: "test-store",
    idempotency_key: idempotencyKey,
    buyer_email: "buyer@example.com",
    buyer_first_name: "Buyer",
    buyer_last_name: "Example",
    buyer_phone: "555-555-0100",
    delivery_address_line1: "1 Main Street",
    delivery_city: "Denver",
    delivery_state: "CO",
    delivery_postal_code: "80202",
    fulfillment_method: "pickup",
    pickup_option_id: null,
    items: [
      {
        item_type: "listing_inventory",
        item_id: ITEM_ID,
        quantity: 1,
      },
    ],
  };
}

function requestFor(
  payload,
  {
    origin = "https://flockfront.test",
    ip = "203.0.113.10",
    method = "POST",
  } = {},
) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (ip) headers.set("x-forwarded-for", ip);
  if (method === "POST") headers.set("content-type", "application/json");

  return new Request("https://functions.test/pay-at-pickup-order", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(payload) : undefined,
  });
}

function createHarness({
  rateLimit = () => ({
    allowed: true,
    authoritative_retry: false,
    retry_after_seconds: 0,
  }),
  environment = {},
} = {}) {
  const calls = [];
  let emailWorkerCalls = 0;

  const client = {
    async rpc(name, args) {
      calls.push({ name, args });

      if (name === "get_public_storefront_by_slug") {
        return {
          data: [{
            is_publicly_available: true,
            store_exists: true,
            storefront: { store_id: STORE_ID },
          }],
          error: null,
        };
      }

      if (name === "consume_public_checkout_rate_limit") {
        return { data: [rateLimit(args, calls)], error: null };
      }

      if (name === "get_public_checkout_summary") {
        return {
          data: [{
            is_checkout_available: true,
            item_count: 1,
            total_quantity: 1,
            subtotal_amount: 25,
          }],
          error: null,
        };
      }

      if (
        name === "create_pay_at_pickup_order" ||
        name === "create_pay_at_pickup_order_v2"
      ) {
        return {
          data: [{
            order_number: "1001",
            order_status: "open",
            payment_method: "pay_at_pickup",
            payment_status: "pay_at_pickup",
            subtotal_amount: 25,
            total_amount: 25,
            currency: "USD",
            created_at: "2026-07-29T20:00:00Z",
          }],
          error: null,
        };
      }

      throw new Error(`Unexpected RPC: ${name}`);
    },
  };

  const values = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    FLIPFLOCKS_PUBLIC_API_ORIGIN: "https://flockfront.test",
    POSTMARK_WORKER_SECRET: "worker-secret",
    ...environment,
  };

  const handler = createPayAtPickupHandler({
    createServiceClient: () => client,
    env: (name) => values[name],
    fetch: async () => {
      emailWorkerCalls += 1;
      return new Response(null, { status: 204 });
    },
  });

  return {
    calls,
    get emailWorkerCalls() {
      return emailWorkerCalls;
    },
    handler,
  };
}

test("normal checkout is rate checked before summary and order creation", async () => {
  const harness = createHarness();
  const response = await harness.handler(requestFor(validPayload()));

  assert.equal(response.status, 201);
  assert.deepEqual(
    harness.calls.map((call) => call.name),
    [
      "get_public_storefront_by_slug",
      "consume_public_checkout_rate_limit",
      "get_public_checkout_summary",
      "create_pay_at_pickup_order_v2",
    ],
  );

  const limiterCall = harness.calls[1];
  assert.equal(limiterCall.args.p_store_email_limit, 6);
  assert.equal(limiterCall.args.p_store_ip_limit, 30);
  assert.equal(limiterCall.args.p_store_limit, 120);
  assert.equal(limiterCall.args.p_buyer_ip, "203.0.113.10");
  assert.equal(harness.emailWorkerCalls, 1);
});

test("a complete delivery checkout reaches the existing order RPC", async () => {
  const harness = createHarness();
  const response = await harness.handler(
    requestFor({
      ...validPayload("delivery-checkout"),
      fulfillment_method: "delivery",
      delivery_option_id: "30000000-0000-4000-8000-000000000001",
    }),
  );

  assert.equal(response.status, 201);
  const orderCall = harness.calls.find(
    (call) => call.name === "create_pay_at_pickup_order_v2",
  );
  assert.equal(
    orderCall.args.p_delivery_option_id,
    "30000000-0000-4000-8000-000000000001",
  );
  assert.equal(orderCall.args.p_fulfillment_method, "delivery");
});

test("pickup and delivery reject missing required address data before database activity", async () => {
  for (const fulfillmentMethod of ["pickup", "delivery"]) {
    for (const field of [
      "delivery_address_line1",
      "delivery_city",
      "delivery_state",
      "delivery_postal_code",
    ]) {
      const harness = createHarness();
      const payload = {
        ...validPayload(`${fulfillmentMethod}-${field}`),
        fulfillment_method: fulfillmentMethod,
        ...(fulfillmentMethod === "delivery"
          ? { delivery_option_id: "30000000-0000-4000-8000-000000000001" }
          : {}),
        [field]: " ",
      };
      const response = await harness.handler(requestFor(payload));
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.error, "invalid_request");
      assert.deepEqual(harness.calls, []);
      assert.equal(harness.emailWorkerCalls, 0);
    }
  }
});

test("same idempotency key retry reaches the authoritative order RPC", async () => {
  const harness = createHarness({
    rateLimit: (_args, calls) => ({
      allowed: true,
      authoritative_retry:
        calls.filter((call) =>
          call.name === "consume_public_checkout_rate_limit"
        ).length > 1,
      retry_after_seconds: 0,
    }),
  });
  const payload = validPayload("stable-retry-key");

  const firstResponse = await harness.handler(requestFor(payload));
  const retryResponse = await harness.handler(requestFor(payload));

  assert.equal(firstResponse.status, 201);
  assert.equal(retryResponse.status, 201);
  assert.equal(
    harness.calls.filter((call) =>
      call.name === "create_pay_at_pickup_order_v2"
    ).length,
    2,
  );
  assert.deepEqual(
    harness.calls
      .filter((call) => call.name === "consume_public_checkout_rate_limit")
      .map((call) => call.args.p_idempotency_key),
    ["stable-retry-key", "stable-retry-key"],
  );
});

test("different idempotency keys above the email limit are rejected", async () => {
  let newAttemptCount = 0;
  const harness = createHarness({
    rateLimit: () => {
      newAttemptCount += 1;
      return {
        allowed: newAttemptCount <= 6,
        authoritative_retry: false,
        retry_after_seconds: newAttemptCount <= 6 ? 0 : 420,
      };
    },
  });

  for (let index = 0; index < 6; index += 1) {
    const response = await harness.handler(
      requestFor(validPayload(`new-key-${index}`)),
    );
    assert.equal(response.status, 201);
  }

  const limitedResponse = await harness.handler(
    requestFor(validPayload("new-key-6")),
  );
  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedResponse.headers.get("retry-after"), "420");
  assert.equal(
    harness.calls.filter((call) =>
      call.name === "create_pay_at_pickup_order_v2"
    ).length,
    6,
  );
});

test("rate-limited requests cause no downstream database or email effects", async () => {
  const harness = createHarness({
    rateLimit: () => ({
      allowed: false,
      authoritative_retry: false,
      retry_after_seconds: 300,
    }),
    environment: {
      POSTMARK_WORKER_SECRET: "worker-secret",
    },
  });

  const response = await harness.handler(requestFor(validPayload()));
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(body.error, "rate_limited");
  assert.deepEqual(
    harness.calls.map((call) => call.name),
    [
      "get_public_storefront_by_slug",
      "consume_public_checkout_rate_limit",
    ],
  );
  assert.equal(harness.emailWorkerCalls, 0);
});

test("configured origin is allowed and reflected exactly", async () => {
  const harness = createHarness();
  const response = await harness.handler(requestFor(validPayload()));

  assert.equal(response.status, 201);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://flockfront.test",
  );
});

test("a mismatched origin is rejected before database work", async () => {
  const harness = createHarness();
  const response = await harness.handler(
    requestFor(validPayload(), { origin: "https://attacker.test" }),
  );

  assert.equal(response.status, 403);
  assert.equal(harness.calls.length, 0);
});

test("hosted checkout fails closed when the public origin is missing", async () => {
  const harness = createHarness({
    environment: {
      FLIPFLOCKS_PUBLIC_API_ORIGIN: "",
      DENO_DEPLOYMENT_ID: "hosted-deployment",
    },
  });
  const response = await harness.handler(requestFor(validPayload()));

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(harness.calls.length, 0);
});

test("local development may use wildcard CORS without configured origin", async () => {
  const harness = createHarness({
    environment: {
      SUPABASE_URL: "http://127.0.0.1:54321",
      FLIPFLOCKS_PUBLIC_API_ORIGIN: "",
    },
  });
  const response = await harness.handler(
    requestFor(validPayload(), { origin: "http://localhost:3000" }),
  );

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("configured thresholds are passed to the limiter RPC", async () => {
  const harness = createHarness({
    environment: {
      PUBLIC_CHECKOUT_STORE_EMAIL_RATE_LIMIT: "8",
      PUBLIC_CHECKOUT_STORE_IP_RATE_LIMIT: "40",
      PUBLIC_CHECKOUT_STORE_RATE_LIMIT: "200",
    },
  });
  await harness.handler(requestFor(validPayload()));

  const limiterCall = harness.calls.find((call) =>
    call.name === "consume_public_checkout_rate_limit"
  );
  assert.equal(limiterCall.args.p_store_email_limit, 8);
  assert.equal(limiterCall.args.p_store_ip_limit, 40);
  assert.equal(limiterCall.args.p_store_limit, 200);
});
