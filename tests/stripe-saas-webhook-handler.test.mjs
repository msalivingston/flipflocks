import assert from "node:assert/strict";
import test from "node:test";

import {
  SaasWebhookDomainError,
  STRIPE_SAAS_WEBHOOK_EVENT_TYPES,
  STRIPE_SAAS_WEBHOOK_MAX_BODY_BYTES,
  createStripeSaasWebhookHandler,
} from "../supabase/functions/stripe-saas-webhook/handler.ts";

const ACCOUNT_ID = "acct_Batch6Platform";
const SIGNATURE = "mock-signature-not-a-secret";
const RAW_BODY = JSON.stringify({ fixture: "not-provider-payload" });
const ATTEMPT_ID = "d7000000-0000-4000-8000-000000000001";
const STORE_ID = "d7000000-0000-4000-8000-000000000002";

function event(type = "checkout.session.completed", overrides = {}) {
  const objectType = type.startsWith("checkout.")
    ? "checkout.session"
    : type.startsWith("customer.subscription.")
    ? "subscription"
    : "invoice";
  const objectId = objectType === "checkout.session"
    ? "cs_test_Batch6"
    : objectType === "subscription"
    ? "sub_Batch6"
    : "in_Batch6";
  return {
    id: "evt_Batch6Handler",
    type,
    created: 1_785_686_400,
    livemode: false,
    data: {
      object: {
        object: objectType,
        id: objectId,
        ...(objectType === "checkout.session"
          ? { customer: "cus_Batch7", subscription: "sub_Batch7" }
          : {}),
      },
    },
    ...overrides,
  };
}

function checkoutEvidence(overrides = {}) {
  const metadata = {
    checkoutAttemptId: ATTEMPT_ID,
    storeId: STORE_ID,
    environmentId: "local",
    planKey: "small_flock",
    billingCadence: "monthly",
    schemaVersion: "ff_saas_checkout_v1",
  };
  const base = {
    session: {
      id: "cs_test_Batch6",
      createdAt: "2026-08-02T15:55:00.000Z",
      expiresAt: "2026-08-03T15:55:00.000Z",
      status: "complete",
      mode: "subscription",
      paymentStatus: "no_payment_required",
      paymentMethodCollection: "always",
      clientReferenceId: ATTEMPT_ID,
      livemode: false,
      customerId: "cus_Batch7",
      subscriptionId: "sub_Batch7",
      metadata,
    },
    customer: {
      id: "cus_Batch7",
      createdAt: "2026-08-02T15:55:01.000Z",
      livemode: false,
    },
    subscription: {
      id: "sub_Batch7",
      customerId: "cus_Batch7",
      status: "trialing",
      createdAt: "2026-08-02T15:55:01.000Z",
      trialStart: "2026-08-02T15:55:01.000Z",
      trialEnd: "2026-08-09T15:55:01.000Z",
      currentPeriodStart: "2026-08-02T15:55:01.000Z",
      currentPeriodEnd: "2026-08-09T15:55:01.000Z",
      cancelAtPeriodEnd: false,
      livemode: false,
      collectionMethod: "charge_automatically",
      paymentMethodReady: true,
      metadata: { ...metadata },
    },
    lineItem: {
      priceId: "price_Batch7",
      productId: "prod_Batch7",
      quantity: 1,
      priceLivemode: false,
      productLivemode: false,
      priceActive: true,
      productActive: true,
      unitAmountCents: 500,
      currency: "usd",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      priceType: "recurring",
      billingScheme: "per_unit",
      recurringUsageType: "licensed",
      taxBehavior: "exclusive",
      productTaxCode: "txcd_10103001",
    },
  };
  return { ...base, ...overrides };
}

function webhookRequest({
  body = RAW_BODY,
  signature = SIGNATURE,
  method = "POST",
  contentType = "application/json",
  headers = {},
} = {}) {
  return new Request("https://functions.test/stripe-saas-webhook", {
    method,
    headers: {
      ...(contentType ? { "Content-Type": contentType } : {}),
      ...(signature ? { "Stripe-Signature": signature } : {}),
      ...headers,
    },
    body: method === "POST" ? body : undefined,
  });
}

function harness(overrides = {}) {
  const calls = {
    verify: [],
    hash: [],
    claim: [],
    deferred: [],
    ignored: [],
    failed: [],
    deferredClaim: [],
    retrieve: [],
    apply: [],
    logs: [],
  };
  const dependencies = {
    stripeAccountId: ACCOUNT_ID,
    stripeLivemode: false,
    environmentId: "local",
    verifySignature: async (...args) => {
      calls.verify.push(args);
      return event();
    },
    hashPayload: async (...args) => {
      calls.hash.push(args);
      return "a".repeat(64);
    },
    claimEvent: async (...args) => {
      calls.claim.push(args);
      return {
        claim_state: "claimed",
        processing_status: "processing",
        attempt_count: 1,
        processing_lease_token: "d6000000-0000-4000-8000-000000000001",
        lease_expires_at: "2026-08-02T12:05:00.000Z",
      };
    },
    markDeferred: async (...args) => {
      calls.deferred.push(args);
    },
    markIgnored: async (...args) => {
      calls.ignored.push(args);
    },
    markFailed: async (...args) => {
      calls.failed.push(args);
    },
    claimDeferredEvent: async (...args) => {
      calls.deferredClaim.push(args);
      return {
        reconciliation_state: "claimed",
        processing_status: "processing",
        attempt_count: 2,
        processing_lease_token: "d6000000-0000-4000-8000-000000000099",
        lease_expires_at: "2026-08-02T16:05:00.000Z",
        deferred_reason: "awaiting_verified_enrollment_batch",
      };
    },
    retrieveCheckoutCompletionEvidence: async (...args) => {
      calls.retrieve.push(args);
      return checkoutEvidence();
    },
    applyCheckoutCompletion: async (...args) => {
      calls.apply.push(args);
      return {
        application_state: "trial_enrolled",
        store_id: STORE_ID,
        customer_binding_id: "d7000000-0000-4000-8000-000000000003",
        subscription_enrollment_id: "d7000000-0000-4000-8000-000000000004",
        trial_claimed: true,
        billing_complete: true,
      };
    },
    safeLog: (record) => calls.logs.push(record),
    ...overrides,
  };
  return { handler: createStripeSaasWebhookHandler(dependencies), calls };
}

test("valid signed completion is deferred, fenced, retrieved, and applied", async () => {
  const fixture = harness();
  const response = await fixture.handler(webhookRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(fixture.calls.verify.length, 1);
  assert.equal(fixture.calls.hash.length, 1);
  assert.equal(fixture.calls.claim.length, 1);
  assert.equal(fixture.calls.deferred.length, 1);
  assert.equal(fixture.calls.ignored.length, 0);
  assert.equal(
    fixture.calls.deferred[0][2],
    "awaiting_verified_enrollment_batch",
  );
  assert.equal(fixture.calls.failed.length, 0);
  assert.equal(fixture.calls.deferredClaim.length, 1);
  assert.deepEqual(fixture.calls.retrieve[0], ["cs_test_Batch6"]);
  assert.equal(fixture.calls.apply.length, 1);
});

test("raw body is read exactly once and verification precedes hashing and database work", async () => {
  const order = [];
  let reads = 0;
  const fixture = harness({
    verifySignature: async (raw, signature) => {
      order.push("verify");
      assert.equal(new TextDecoder().decode(raw), RAW_BODY);
      assert.equal(signature, SIGNATURE);
      return event();
    },
    hashPayload: async () => {
      order.push("hash");
      return "b".repeat(64);
    },
    claimEvent: async () => {
      order.push("claim");
      return {
        claim_state: "claimed",
        processing_status: "processing",
        attempt_count: 1,
        processing_lease_token: "d6000000-0000-4000-8000-000000000002",
        lease_expires_at: null,
      };
    },
    markDeferred: async () => order.push("deferred"),
    claimDeferredEvent: async () => {
      order.push("reclaim");
      return {
        reconciliation_state: "claimed",
        processing_status: "processing",
        attempt_count: 2,
        processing_lease_token: "d6000000-0000-4000-8000-000000000098",
        lease_expires_at: null,
        deferred_reason: "awaiting_verified_enrollment_batch",
      };
    },
    retrieveCheckoutCompletionEvidence: async () => {
      order.push("retrieve");
      return checkoutEvidence();
    },
    applyCheckoutCompletion: async () => {
      order.push("apply");
      return {};
    },
  });
  const request = {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json",
      "Stripe-Signature": SIGNATURE,
    }),
    async arrayBuffer() {
      reads += 1;
      return new TextEncoder().encode(RAW_BODY).buffer;
    },
  };
  assert.equal((await fixture.handler(request)).status, 200);
  assert.equal(reads, 1);
  assert.deepEqual(order, [
    "verify", "hash", "claim", "deferred", "reclaim", "retrieve", "apply",
  ]);
});

test("missing, malformed, wrong, altered, old, or future signatures fail before trust", async () => {
  const missing = harness();
  assert.equal((await missing.handler(webhookRequest({ signature: null }))).status, 400);
  assert.equal(missing.calls.verify.length, 0);

  for (const failure of [
    "malformed_signature",
    "wrong_secret",
    "altered_body",
    "malformed_json_after_valid_signature",
    "timestamp_too_old",
    "timestamp_in_future",
  ]) {
    const fixture = harness({
      verifySignature: async () => {
        throw new Error(failure);
      },
    });
    const response = await fixture.handler(webhookRequest());
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_webhook_signature" });
    assert.equal(fixture.calls.claim.length, 0);
  }
});

test("oversized request is rejected before signature verification", async () => {
  const fixture = harness();
  const response = await fixture.handler(webhookRequest({
    body: "x",
    headers: { "Content-Length": String(STRIPE_SAAS_WEBHOOK_MAX_BODY_BYTES + 1) },
  }));
  assert.equal(response.status, 413);
  assert.equal(fixture.calls.verify.length, 0);

  const undeclared = harness();
  const largeResponse = await undeclared.handler(webhookRequest({
    body: "x".repeat(STRIPE_SAAS_WEBHOOK_MAX_BODY_BYTES + 1),
  }));
  assert.equal(largeResponse.status, 413);
  assert.equal(undeclared.calls.claim.length, 0);
});

test("live mode, mismatched account, and malformed event identity fail closed", async () => {
  for (const invalidEvent of [
    event(undefined, { livemode: true }),
    event(undefined, { account: "acct_WrongBatch6" }),
    event(undefined, { id: "" }),
    event(undefined, { type: "" }),
    event(undefined, { data: { object: { object: "invoice" } } }),
  ]) {
    const fixture = harness({ verifySignature: async () => invalidEvent });
    const response = await fixture.handler(webhookRequest());
    assert.equal(response.status, 400);
    assert.equal(fixture.calls.claim.length, 0);
  }
  assert.throws(
    () => harness({ stripeAccountId: "not-an-account" }),
    /STRIPE_SAAS_WEBHOOK_ACCOUNT_INVALID/,
  );
});

test("terminal duplicates and permanent conflicts return stable safe 200 responses", async () => {
  for (const claimState of [
    "terminal_duplicate", "in_progress", "permanent_failure", "conflict",
  ]) {
    const fixture = harness({
      claimEvent: async () => ({
        claim_state: claimState,
        processing_status: "ignored",
        attempt_count: 2,
        processing_lease_token: null,
        lease_expires_at: null,
      }),
    });
    const response = await fixture.handler(webhookRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
    assert.equal(fixture.calls.deferred.length, 0);
    assert.equal(fixture.calls.ignored.length, 0);
  }
});

test("deferred duplicate completion resumes reconciliation exactly once", async () => {
  const fixture = harness({
    claimEvent: async () => ({
      claim_state: "deferred_duplicate",
      processing_status: "deferred",
      attempt_count: 1,
      processing_lease_token: null,
      lease_expires_at: null,
    }),
  });
  assert.equal((await fixture.handler(webhookRequest())).status, 200);
  assert.equal(fixture.calls.deferred.length, 0);
  assert.equal(fixture.calls.deferredClaim.length, 1);
  assert.equal(fixture.calls.apply.length, 1);
});

test("transient database failures return 500 so Stripe can retry", async () => {
  const claimFailure = harness({
    claimEvent: async () => {
      throw new Error("database details");
    },
  });
  assert.equal((await claimFailure.handler(webhookRequest())).status, 500);

  const terminalFailure = harness({
    markDeferred: async () => {
      throw new Error("database details");
    },
  });
  const response = await terminalFailure.handler(webhookRequest());
  assert.equal(response.status, 500);
  assert.deepEqual(terminalFailure.calls.failed[0].slice(2), [
    "deferred_recording_failed",
    true,
  ]);
});

test("transient Stripe retrieval and database application failures return 500", async () => {
  const retrieval = harness({
    retrieveCheckoutCompletionEvidence: async () => {
      throw new Error("provider details");
    },
  });
  assert.equal((await retrieval.handler(webhookRequest())).status, 500);
  assert.deepEqual(retrieval.calls.failed[0].slice(2), [
    "stripe_retrieval_failed",
    true,
  ]);
  assert.equal(retrieval.calls.apply.length, 0);

  const database = harness({
    applyCheckoutCompletion: async () => {
      throw new Error("database details");
    },
  });
  assert.equal((await database.handler(webhookRequest())).status, 500);
  assert.deepEqual(database.calls.failed[0].slice(2), [
    "checkout_completion_apply_failed",
    true,
  ]);
});

test("permanent binding conflicts are recorded without a retry storm", async () => {
  const fixture = harness({
    applyCheckoutCompletion: async () => {
      throw new SaasWebhookDomainError(
        "checkout_completion_binding_conflict",
        false,
      );
    },
  });
  const response = await fixture.handler(webhookRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.deepEqual(fixture.calls.failed[0].slice(2), [
    "checkout_completion_binding_conflict",
    false,
  ]);
});

test("retrieved Session, Customer, Subscription, Price, Product, mode, metadata, and readiness must agree", async () => {
  const mutations = [
    (value) => value.session.id = "cs_test_Wrong",
    (value) => value.customer.id = "cus_Wrong",
    (value) => value.subscription.id = "sub_Wrong",
    (value) => value.lineItem.priceId = "wrong",
    (value) => value.lineItem.productId = "wrong",
    (value) => value.session.livemode = true,
    (value) => value.session.metadata.storeId =
      "d7000000-0000-4000-8000-000000000099",
    (value) => value.subscription.paymentMethodReady = false,
  ];
  for (const mutate of mutations) {
    const evidence = structuredClone(checkoutEvidence());
    mutate(evidence);
    const fixture = harness({
      retrieveCheckoutCompletionEvidence: async () => evidence,
    });
    const response = await fixture.handler(webhookRequest());
    assert.equal(response.status, 200);
    assert.equal(fixture.calls.apply.length, 0);
    assert.equal(fixture.calls.failed[0][3], false);
  }
});

test("trial-used completion can bind without claiming browser or paid-through authority", async () => {
  const evidence = checkoutEvidence();
  evidence.session.paymentStatus = "paid";
  evidence.subscription.status = "active";
  evidence.subscription.trialStart = null;
  evidence.subscription.trialEnd = null;
  const fixture = harness({
    retrieveCheckoutCompletionEvidence: async () => evidence,
    applyCheckoutCompletion: async (...args) => {
      fixture.calls.apply.push(args);
      return {
        application_state: "paid_enrollment_pending_invoice",
        store_id: STORE_ID,
        customer_binding_id: "d7000000-0000-4000-8000-000000000003",
        subscription_enrollment_id: "d7000000-0000-4000-8000-000000000004",
        trial_claimed: false,
        billing_complete: false,
      };
    },
  });
  assert.equal((await fixture.handler(webhookRequest())).status, 200);
  assert.equal(fixture.calls.apply.length, 1);
  assert.doesNotMatch(JSON.stringify(fixture.calls), /paid_through/i);
});

test("approved application events are deferred while trial notice is informational", async () => {
  const reasons = new Map();
  for (const eventType of STRIPE_SAAS_WEBHOOK_EVENT_TYPES) {
    const fixture = harness({ verifySignature: async () => event(eventType) });
    const response = await fixture.handler(webhookRequest());
    assert.equal(response.status, 200, eventType);
    const call = fixture.calls.deferred[0] ?? fixture.calls.ignored[0];
    reasons.set(eventType, call[2]);
    if (eventType === "customer.subscription.trial_will_end") {
      assert.equal(fixture.calls.deferred.length, 0);
      assert.equal(fixture.calls.ignored.length, 1);
    } else {
      assert.equal(fixture.calls.deferred.length, 1);
      assert.equal(fixture.calls.ignored.length, 0);
    }
  }
  assert.equal(reasons.get("checkout.session.expired"), "awaiting_checkout_expiration_batch");
  assert.equal(reasons.get("invoice.payment_succeeded"), "awaiting_immutable_enrollment_binding");
  assert.equal(reasons.get("customer.subscription.trial_will_end"), "informational_trial_will_end");
  assert.equal(reasons.get("customer.subscription.created"), "awaiting_verified_enrollment_batch");
});

test("authenticated unsupported event is safely recorded and acknowledged", async () => {
  const fixture = harness({
    verifySignature: async () => event("product.updated", {
      data: { object: { object: "product", id: "prod_Batch6" } },
    }),
  });
  const response = await fixture.handler(webhookRequest());
  assert.equal(response.status, 200);
  assert.equal(fixture.calls.deferred.length, 0);
  assert.equal(fixture.calls.ignored[0][2], "unsupported_event_type");
});

test("safe logs and responses exclude raw body, signature, and provider data", async () => {
  const sensitiveBody = JSON.stringify({
    id: "evt_do_not_log",
    customer_email: "private@example.test",
    signature: SIGNATURE,
  });
  const fixture = harness();
  const response = await fixture.handler(webhookRequest({ body: sensitiveBody }));
  const emitted = JSON.stringify({
    logs: fixture.calls.logs,
    response: await response.json(),
  });
  assert.doesNotMatch(emitted, /private@example\.test|mock-signature|do_not_log/);
  assert.doesNotMatch(emitted, /checkout_url|authorization|raw/i);
});

test("webhook requires no Supabase user JWT and has no browser CORS contract", async () => {
  const fixture = harness();
  const response = await fixture.handler(webhookRequest());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});
