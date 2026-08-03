import assert from "node:assert/strict";
import test from "node:test";

import {
  SaasWebhookDomainError,
  STRIPE_SAAS_WEBHOOK_EVENT_TYPES,
  STRIPE_SAAS_WEBHOOK_MAX_BODY_BYTES,
  createStripeSaasWebhookConfigurationErrorHandler,
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
          : objectType === "subscription"
          ? { customer: "cus_Batch8" }
          : {
            customer: "cus_Batch8",
            parent: {
              subscription_details: { subscription: "sub_Batch6" },
            },
          }),
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

function recurringPriceEvidence(overrides = {}) {
  return {
    priceId: "price_Batch8",
    productId: "prod_Batch8",
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
    ...overrides,
  };
}

function invoiceEvidence(overrides = {}) {
  const base = {
    invoice: {
      id: "in_Batch6",
      livemode: false,
      customerId: "cus_Batch8",
      subscriptionId: "sub_Batch6",
      billingReason: "subscription_cycle",
      collectionMethod: "charge_automatically",
      status: "paid",
      currency: "usd",
      amountDueCents: 500,
      amountPaidCents: 500,
      amountRemainingCents: 0,
      recurringLineAmountCents: 500,
      servicePeriodStart: "2026-08-02T16:00:00.000Z",
      servicePeriodEnd: "2026-09-02T16:00:00.000Z",
      paidAt: "2026-08-02T16:00:00.000Z",
      nextPaymentAttemptAt: null,
      failureCode: null,
    },
    lineItem: recurringPriceEvidence(),
  };
  return { ...base, ...overrides };
}

function subscriptionEvidence(overrides = {}) {
  const base = {
    subscription: {
      id: "sub_Batch6",
      livemode: false,
      customerId: "cus_Batch8",
      status: "active",
      currentPeriodStart: "2026-08-02T16:00:00.000Z",
      currentPeriodEnd: "2026-09-02T16:00:00.000Z",
      cancelAtPeriodEnd: false,
      createdAt: "2026-08-01T16:00:00.000Z",
      canceledAt: null,
      endedAt: null,
    },
    lineItem: recurringPriceEvidence(),
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
    retrieveInvoice: [],
    applyInvoice: [],
    retrieveSubscription: [],
    applySubscription: [],
    deferSubscriptionUntilEnrollment: [],
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
    retrieveInvoiceLifecycleEvidence: async (...args) => {
      calls.retrieveInvoice.push(args);
      return invoiceEvidence();
    },
    applyInvoiceLifecycle: async (...args) => {
      calls.applyInvoice.push(args);
      return {
        application_state: "paid_through_extended",
        store_id: STORE_ID,
        invoice_id: "d7000000-0000-4000-8000-000000000005",
        paid_through_at: "2026-09-02T16:00:00.000Z",
        grace_ends_at: null,
        billing_complete: true,
      };
    },
    retrieveSubscriptionLifecycleEvidence: async (...args) => {
      calls.retrieveSubscription.push(args);
      return subscriptionEvidence();
    },
    applySubscriptionLifecycle: async (...args) => {
      calls.applySubscription.push(args);
      return {
        application_state: "snapshot_applied",
        store_id: STORE_ID,
        subscription_status: "active",
        paid_through_at: "2026-09-02T16:00:00.000Z",
        grace_ends_at: null,
      };
    },
    deferSubscriptionUntilEnrollment: async (...args) => {
      calls.deferSubscriptionUntilEnrollment.push(args);
    },
    safeLog: (record) => calls.logs.push(record),
    ...overrides,
  };
  return { handler: createStripeSaasWebhookHandler(dependencies), calls };
}

async function assertProcessingFailure(response, expectedCode) {
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "webhook_processing_failed",
    code: expectedCode,
  });
  assert.equal(
    response.headers.get("X-FlockFront-Error-Code"),
    expectedCode,
  );
}

function assertDiagnosticLog(logs, expectedCode, expectedStage, hasIdentity = true) {
  const matches = logs.filter((record) => record.code === expectedCode);
  assert.equal(matches.length, 1);
  const record = matches[0];
  assert.equal(record.stage, expectedStage);
  assert.equal(typeof record.duration_ms, "number");
  assert.ok(record.duration_ms >= 0);
  assert.deepEqual(
    Object.keys(record).sort(),
    (hasIdentity
      ? ["code", "duration_ms", "event_id", "event_type", "stage"]
      : ["code", "duration_ms", "stage"]).sort(),
  );
  if (hasIdentity) {
    assert.equal(record.event_id, "evt_Batch6Handler");
    assert.equal(typeof record.event_type, "string");
  }
}

test("valid signed completion is deferred, fenced, retrieved, and applied", async () => {
  const fixture = harness();
  const response = await fixture.handler(webhookRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    received: true,
    result: "processed",
  });
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
  const missingResponse = await missing.handler(webhookRequest({ signature: null }));
  assert.equal(missingResponse.status, 400);
  assert.deepEqual(await missingResponse.json(), { error: "invalid_webhook_signature" });
  assert.equal(missing.calls.verify.length, 0);
  assertDiagnosticLog(
    missing.calls.logs,
    "webhook_signature_invalid",
    "signature_verification",
    false,
  );

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
    assertDiagnosticLog(
      fixture.calls.logs,
      "webhook_signature_invalid",
      "signature_verification",
      false,
    );
  }
});

test("configuration failures return a stable redacted diagnostic", async () => {
  const logs = [];
  const handler = createStripeSaasWebhookConfigurationErrorHandler({
    now: () => 100,
    safeLog: (record) => logs.push(record),
  });
  await assertProcessingFailure(
    await handler(webhookRequest()),
    "webhook_config_invalid",
  );
  assertDiagnosticLog(logs, "webhook_config_invalid", "configuration", false);
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
  await assertProcessingFailure(
    await claimFailure.handler(webhookRequest()),
    "webhook_event_claim_failed",
  );
  assertDiagnosticLog(
    claimFailure.calls.logs,
    "webhook_event_claim_failed",
    "event_claim",
  );

  const terminalFailure = harness({
    markDeferred: async () => {
      throw new Error("database details");
    },
  });
  const response = await terminalFailure.handler(webhookRequest());
  await assertProcessingFailure(response, "webhook_event_finalization_failed");
  assertDiagnosticLog(
    terminalFailure.calls.logs,
    "webhook_event_finalization_failed",
    "event_finalization",
  );
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
  await assertProcessingFailure(
    await retrieval.handler(webhookRequest()),
    "webhook_stripe_retrieval_failed",
  );
  assertDiagnosticLog(
    retrieval.calls.logs,
    "webhook_stripe_retrieval_failed",
    "stripe_retrieval",
  );
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
  await assertProcessingFailure(
    await database.handler(webhookRequest()),
    "webhook_enrollment_binding_failed",
  );
  assertDiagnosticLog(
    database.calls.logs,
    "webhook_enrollment_binding_failed",
    "enrollment_binding",
  );
  assert.deepEqual(database.calls.failed[0].slice(2), [
    "checkout_completion_apply_failed",
    true,
  ]);
});

test("each remaining major webhook failure stage has a stable diagnostic", async () => {
  const deferredClaim = harness({
    claimDeferredEvent: async () => {
      throw new Error("sensitive deferred database detail");
    },
  });
  await assertProcessingFailure(
    await deferredClaim.handler(webhookRequest()),
    "webhook_deferred_claim_failed",
  );
  assertDiagnosticLog(
    deferredClaim.calls.logs,
    "webhook_deferred_claim_failed",
    "deferred_claim",
  );

  const invoiceApplication = harness({
    verifySignature: async () => event("invoice.payment_succeeded"),
    applyInvoiceLifecycle: async () => {
      throw new Error("sensitive invoice database detail");
    },
  });
  await assertProcessingFailure(
    await invoiceApplication.handler(webhookRequest()),
    "webhook_invoice_application_failed",
  );
  assertDiagnosticLog(
    invoiceApplication.calls.logs,
    "webhook_invoice_application_failed",
    "invoice_application",
  );

  const subscriptionSnapshot = harness({
    verifySignature: async () => event("customer.subscription.updated"),
    applySubscriptionLifecycle: async () => {
      throw new Error("sensitive subscription database detail");
    },
  });
  await assertProcessingFailure(
    await subscriptionSnapshot.handler(webhookRequest()),
    "webhook_subscription_snapshot_failed",
  );
  assertDiagnosticLog(
    subscriptionSnapshot.calls.logs,
    "webhook_subscription_snapshot_failed",
    "subscription_snapshot",
  );

  const unexpected = harness({
    hashPayload: async () => {
      throw new Error("sensitive hashing detail");
    },
  });
  await assertProcessingFailure(
    await unexpected.handler(webhookRequest()),
    "webhook_unexpected_error",
  );
  assertDiagnosticLog(
    unexpected.calls.logs,
    "webhook_unexpected_error",
    "payload_hash",
    false,
  );

  const topLevelUnexpected = harness({
    claimEvent: async () => ({
      claim_state: "terminal_duplicate",
      processing_status: "processed",
      attempt_count: 2,
      processing_lease_token: null,
      lease_expires_at: null,
    }),
    safeLog: () => {
      throw new Error("sensitive logger detail");
    },
  });
  await assertProcessingFailure(
    await topLevelUnexpected.handler(webhookRequest()),
    "webhook_unexpected_error",
  );
});

test("permanent binding conflicts preserve a safe precise code without a retry storm", async () => {
  const fixture = harness({
    applyCheckoutCompletion: async () => {
      throw new SaasWebhookDomainError(
        "checkout_customer_binding_conflict",
        false,
      );
    },
  });
  const response = await fixture.handler(webhookRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    received: true,
    result: "permanent_conflict",
    code: "checkout_customer_binding_conflict",
  });
  assert.equal(
    response.headers.get("X-FlockFront-Error-Code"),
    "checkout_customer_binding_conflict",
  );
  assert.deepEqual(fixture.calls.failed[0].slice(2), [
    "checkout_customer_binding_conflict",
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

test("all four verified invoice lifecycle events retrieve and apply through one fenced path", async () => {
  const cases = [
    ["invoice.payment_succeeded", "paid", 500, 0, null],
    ["invoice.payment_failed", "open", 0, 500, "payment_failed"],
    [
      "invoice.payment_action_required",
      "open",
      0,
      500,
      "payment_action_required",
    ],
    [
      "invoice.finalization_failed",
      "draft",
      0,
      500,
      "provider_configuration_failure",
    ],
  ];
  for (const [eventType, status, paid, remaining, failureCode] of cases) {
    const evidence = invoiceEvidence();
    evidence.invoice.status = status;
    evidence.invoice.amountPaidCents = paid;
    evidence.invoice.amountRemainingCents = remaining;
    evidence.invoice.paidAt = eventType === "invoice.payment_succeeded"
      ? evidence.invoice.paidAt
      : null;
    evidence.invoice.failureCode = failureCode;
    const fixture = harness({
      verifySignature: async () => event(eventType),
      retrieveInvoiceLifecycleEvidence: async (...args) => {
        fixture.calls.retrieveInvoice.push(args);
        return evidence;
      },
    });
    const response = await fixture.handler(webhookRequest());
    assert.equal(response.status, 200, eventType);
    assert.equal(fixture.calls.deferred.length, 1, eventType);
    assert.equal(fixture.calls.deferredClaim.length, 1, eventType);
    assert.equal(fixture.calls.retrieveInvoice.length, 1, eventType);
    assert.equal(fixture.calls.applyInvoice.length, 1, eventType);
    assert.equal(fixture.calls.applySubscription.length, 0, eventType);
  }
});

test("verified Subscription created, updated, and deleted events apply snapshots only", async () => {
  for (const eventType of [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]) {
    const evidence = subscriptionEvidence();
    if (eventType === "customer.subscription.deleted") {
      evidence.subscription.status = "canceled";
      evidence.subscription.cancelAtPeriodEnd = true;
      evidence.subscription.canceledAt = "2026-08-02T16:00:00.000Z";
      evidence.subscription.endedAt = "2026-08-02T16:00:00.000Z";
    }
    const fixture = harness({
      verifySignature: async () => event(eventType),
      retrieveSubscriptionLifecycleEvidence: async (...args) => {
        fixture.calls.retrieveSubscription.push(args);
        return evidence;
      },
    });
    const response = await fixture.handler(webhookRequest());
    assert.equal(response.status, 200, eventType);
    assert.equal(fixture.calls.retrieveSubscription.length, 1, eventType);
    assert.equal(fixture.calls.applySubscription.length, 1, eventType);
    assert.equal(fixture.calls.applyInvoice.length, 0, eventType);
  }
});

test("Subscription creation before Checkout enrollment stays deferred and reconciles once", async () => {
  let currentEvent = event("customer.subscription.created", {
    id: "evt_SubscriptionBeforeCheckout",
  });
  let subscriptionReceived = false;
  let enrollmentAvailable = false;
  let subscriptionProcessed = false;
  const fixture = harness({
    verifySignature: async () => currentEvent,
    claimEvent: async (identity) => {
      fixture.calls.claim.push([identity]);
      if (identity.eventType === "checkout.session.completed") {
        return {
          claim_state: "claimed",
          processing_status: "processing",
          attempt_count: 1,
          processing_lease_token: "d6000000-0000-4000-8000-000000000010",
          lease_expires_at: "2026-08-02T12:05:00.000Z",
        };
      }
      if (subscriptionProcessed) {
        return {
          claim_state: "terminal_duplicate",
          processing_status: "processed",
          attempt_count: 3,
          processing_lease_token: null,
          lease_expires_at: null,
        };
      }
      const claimState = subscriptionReceived ? "deferred_duplicate" : "claimed";
      subscriptionReceived = true;
      return {
        claim_state: claimState,
        processing_status: claimState === "claimed" ? "processing" : "deferred",
        attempt_count: claimState === "claimed" ? 1 : 2,
        processing_lease_token: claimState === "claimed"
          ? "d6000000-0000-4000-8000-000000000011"
          : null,
        lease_expires_at: claimState === "claimed"
          ? "2026-08-02T12:05:00.000Z"
          : null,
      };
    },
    applySubscriptionLifecycle: async (...args) => {
      fixture.calls.applySubscription.push(args);
      if (!enrollmentAvailable) {
        throw new SaasWebhookDomainError(
          "immutable_enrollment_not_ready",
          true,
        );
      }
      subscriptionProcessed = true;
      return {
        application_state: "snapshot_applied",
        store_id: STORE_ID,
        subscription_status: "trialing",
        paid_through_at: null,
        grace_ends_at: null,
      };
    },
    deferSubscriptionUntilEnrollment: async (...args) => {
      fixture.calls.deferSubscriptionUntilEnrollment.push(args);
    },
    applyCheckoutCompletion: async (...args) => {
      fixture.calls.apply.push(args);
      enrollmentAvailable = true;
      return {
        application_state: "trial_enrolled",
        store_id: STORE_ID,
        customer_binding_id: "d7000000-0000-4000-8000-000000000003",
        subscription_enrollment_id: "d7000000-0000-4000-8000-000000000004",
        trial_claimed: true,
        billing_complete: true,
      };
    },
  });

  const earlyResponse = await fixture.handler(webhookRequest());
  assert.equal(earlyResponse.status, 200);
  assert.deepEqual(await earlyResponse.json(), {
    received: true,
    result: "deferred_awaiting_enrollment",
  });
  assert.equal(fixture.calls.deferSubscriptionUntilEnrollment.length, 1);
  assert.equal(fixture.calls.failed.length, 0);
  assert.equal(fixture.calls.apply.length, 0);
  assert.equal(fixture.calls.applyInvoice.length, 0);

  currentEvent = event("checkout.session.completed", {
    id: "evt_CheckoutAfterSubscription",
  });
  assert.equal((await fixture.handler(webhookRequest())).status, 200);
  assert.equal(fixture.calls.apply.length, 1);

  currentEvent = event("customer.subscription.created", {
    id: "evt_SubscriptionBeforeCheckout",
  });
  assert.equal((await fixture.handler(webhookRequest())).status, 200);
  assert.equal(fixture.calls.applySubscription.length, 2);
  assert.equal(subscriptionProcessed, true);

  assert.equal((await fixture.handler(webhookRequest())).status, 200);
  assert.equal(fixture.calls.applySubscription.length, 2);
  assert.equal(fixture.calls.deferSubscriptionUntilEnrollment.length, 1);
});

test("Subscription binding conflict stays permanent while database failure stays retryable", async () => {
  const conflict = harness({
    verifySignature: async () => event("customer.subscription.updated"),
    applySubscriptionLifecycle: async () => {
      throw new SaasWebhookDomainError("immutable_binding_conflict", false);
    },
  });
  const conflictResponse = await conflict.handler(webhookRequest());
  assert.equal(conflictResponse.status, 200);
  assert.deepEqual(conflict.calls.failed[0].slice(2), [
    "immutable_binding_conflict",
    false,
  ]);
  assert.equal(conflict.calls.deferSubscriptionUntilEnrollment.length, 0);

  const transient = harness({
    verifySignature: async () => event("customer.subscription.updated"),
    applySubscriptionLifecycle: async () => {
      throw new Error("database unavailable");
    },
  });
  await assertProcessingFailure(
    await transient.handler(webhookRequest()),
    "webhook_subscription_snapshot_failed",
  );
  assert.deepEqual(transient.calls.failed[0].slice(2), [
    "subscription_application_failed",
    true,
  ]);
  assert.equal(transient.calls.deferSubscriptionUntilEnrollment.length, 0);
});

test("failure to release an early Subscription event back to deferred is retryable", async () => {
  const fixture = harness({
    verifySignature: async () => event("customer.subscription.created"),
    applySubscriptionLifecycle: async () => {
      throw new SaasWebhookDomainError(
        "immutable_enrollment_not_ready",
        true,
      );
    },
    deferSubscriptionUntilEnrollment: async () => {
      throw new Error("database unavailable");
    },
  });
  await assertProcessingFailure(
    await fixture.handler(webhookRequest()),
    "webhook_event_finalization_failed",
  );
  assert.equal(fixture.calls.failed.length, 0);
});

test("invoice identity, binding evidence, Price, Product, and mode mismatches fail closed", async () => {
  const mutations = [
    (value) => value.invoice.id = "in_Wrong",
    (value) => value.invoice.customerId = "cus_Wrong",
    (value) => value.invoice.subscriptionId = "sub_Wrong",
    (value) => value.lineItem.priceId = "wrong",
    (value) => value.lineItem.productId = "wrong",
    (value) => value.invoice.livemode = true,
    (value) => value.invoice.currency = "eur",
    (value) => value.invoice.recurringLineAmountCents = 499,
  ];
  for (const mutate of mutations) {
    const evidence = structuredClone(invoiceEvidence());
    mutate(evidence);
    const fixture = harness({
      verifySignature: async () => event("invoice.payment_succeeded"),
      retrieveInvoiceLifecycleEvidence: async () => evidence,
    });
    const response = await fixture.handler(webhookRequest());
    assert.equal(response.status, 200);
    assert.equal(fixture.calls.applyInvoice.length, 0);
    assert.equal(fixture.calls.failed[0][3], false);
  }
});

test("invoice enrollment and invoice or Subscription retrieval failures remain retryable", async () => {
  const invoiceRetrieval = harness({
    verifySignature: async () => event("invoice.payment_succeeded"),
    retrieveInvoiceLifecycleEvidence: async () => {
      throw new Error("provider details");
    },
  });
  assert.equal((await invoiceRetrieval.handler(webhookRequest())).status, 500);
  assert.deepEqual(invoiceRetrieval.calls.failed[0].slice(2), [
    "invoice_retrieval_failed",
    true,
  ]);

  const unbound = harness({
    verifySignature: async () => event("invoice.payment_succeeded"),
    applyInvoiceLifecycle: async () => {
      throw new SaasWebhookDomainError(
        "immutable_enrollment_not_ready",
        true,
      );
    },
  });
  assert.equal((await unbound.handler(webhookRequest())).status, 500);
  assert.deepEqual(unbound.calls.failed[0].slice(2), [
    "immutable_enrollment_not_ready",
    true,
  ]);

  const subscriptionRetrieval = harness({
    verifySignature: async () => event("customer.subscription.updated"),
    retrieveSubscriptionLifecycleEvidence: async () => {
      throw new Error("provider details");
    },
  });
  assert.equal(
    (await subscriptionRetrieval.handler(webhookRequest())).status,
    500,
  );
});

test("zero-dollar success is routed without claiming paid-through authority in the handler", async () => {
  const evidence = invoiceEvidence();
  evidence.invoice.amountDueCents = 0;
  evidence.invoice.amountPaidCents = 0;
  evidence.invoice.amountRemainingCents = 0;
  const fixture = harness({
    verifySignature: async () => event("invoice.payment_succeeded"),
    retrieveInvoiceLifecycleEvidence: async () => evidence,
    applyInvoiceLifecycle: async (...args) => {
      fixture.calls.applyInvoice.push(args);
      return {
        application_state: "non_authoritative_payment_recorded",
        store_id: STORE_ID,
        invoice_id: "d7000000-0000-4000-8000-000000000005",
        paid_through_at: null,
        grace_ends_at: null,
        billing_complete: false,
      };
    },
  });
  assert.equal((await fixture.handler(webhookRequest())).status, 200);
  assert.equal(fixture.calls.applyInvoice.length, 1);
  assert.equal(fixture.calls.applyInvoice[0][2].invoice.amountDueCents, 0);
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

test("diagnostic failures never expose source errors, secrets, or provider objects", async () => {
  const sensitiveValues = [
    "sensitive-webhook-secret",
    "sensitive-service-role-key",
    "private@example.test",
    "select private billing query",
    "raw-provider-object",
  ];
  const fixture = harness({
    claimEvent: async () => {
      throw new Error(sensitiveValues.join(" "));
    },
  });
  const response = await fixture.handler(webhookRequest({
    body: JSON.stringify({ sensitive: "raw-provider-object" }),
  }));
  assert.equal(response.status, 500);
  const emitted = JSON.stringify({
    body: await response.json(),
    header: response.headers.get("X-FlockFront-Error-Code"),
    logs: fixture.calls.logs,
  });
  for (const sensitive of sensitiveValues) {
    assert.doesNotMatch(emitted, new RegExp(sensitive.replaceAll("-", "\\-"), "i"));
  }
  assert.doesNotMatch(emitted, /stack|query|signature|customer|service.role/i);
});

test("webhook requires no Supabase user JWT and has no browser CORS contract", async () => {
  const fixture = harness();
  const response = await fixture.handler(webhookRequest());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});
