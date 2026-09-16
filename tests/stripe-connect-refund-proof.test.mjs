import assert from "node:assert/strict";
import test from "node:test";

import {
  decidePaidCancellationPreflight,
  isProvenFlockFrontRefund,
  isUnfinishedCancellationAction,
  majorAmountToCents,
  sha256Hex,
} from "../supabase/functions/_shared/stripe-connect-refund-proof.ts";

test("paid cancellation preflight fails closed on unproven refund activity", () => {
  assert.equal(decidePaidCancellationPreflight({
    refundCount: 0,
    provenRefundCount: 0,
    unfinishedActionCount: 0,
  }), "eligible");
  assert.equal(decidePaidCancellationPreflight({
    refundCount: 1,
    provenRefundCount: 0,
    unfinishedActionCount: 0,
  }), "support_required");
  assert.equal(decidePaidCancellationPreflight({
    refundCount: 2,
    provenRefundCount: 1,
    unfinishedActionCount: 1,
  }), "support_required");
  assert.equal(decidePaidCancellationPreflight({
    refundCount: 1,
    provenRefundCount: 1,
    unfinishedActionCount: 1,
  }), "resume_flockfront_action");
  assert.equal(decidePaidCancellationPreflight({
    refundCount: 1,
    provenRefundCount: 1,
    unfinishedActionCount: 0,
  }), "ineligible");
});

const action = {
  id: "11000000-0000-4000-8000-000000000001",
  store_id: "11000000-0000-4000-8000-000000000002",
  order_id: "11000000-0000-4000-8000-000000000003",
  idempotency_key: "ff-connect-cancel:test:action-one",
  request_hash: "request-hash-one",
  refund_amount: "12.50",
  refund_method: "stripe",
  provider_refund_id: "re_test_one",
  currency_code: "USD",
  stripe_checkout_session_id: "cs_test_one",
  stripe_payment_intent_id: "pi_test_one",
  stripe_account_id: "acct_test_one",
  stripe_livemode: false,
  metadata: {
    schema_version: "ff_connect_cancellation_v1",
    workflow_type: "paid_order_cancellation",
    workflow_state: "refund_succeeded",
  },
  created_at: "2026-09-04T12:00:00.250Z",
};

const binding = {
  storeId: action.store_id,
  orderId: action.order_id,
  checkoutSessionId: action.stripe_checkout_session_id,
  paymentIntentId: action.stripe_payment_intent_id,
  stripeAccountId: action.stripe_account_id,
  livemode: false,
  currency: "usd",
};

const refund = {
  id: action.provider_refund_id,
  amount: 1250,
  currency: "usd",
  created: 1788523200,
  payment_intent: action.stripe_payment_intent_id,
  metadata: {
    ff_cancellation_schema_version: "ff_connect_cancellation_v1",
    ff_refund_action_id: action.id,
    ff_order_id: action.order_id,
    ff_request_hash: action.request_hash,
  },
};

test("major-unit ledger amounts convert exactly to Stripe cents", () => {
  assert.equal(majorAmountToCents("12.50"), 1250);
  assert.equal(majorAmountToCents(12.5), 1250);
  assert.equal(majorAmountToCents("12.345"), null);
});

test("full trusted provider correlation proves a FlockFront refund", async () => {
  const proofEvent = {
    provider: "stripe",
    event_type: "refund.created",
    event_status: "processed",
    provider_refund_id: refund.id,
    stripe_payment_intent_id: refund.payment_intent,
    related_refund_id: action.id,
    payload_summary: {
      origin_proof: "stripe_event_request_idempotency",
      request_idempotency_key_sha256: await sha256Hex(action.idempotency_key),
    },
  };

  assert.equal(
    await isProvenFlockFrontRefund({ action, binding, proofEvent, refund }),
    true,
  );
});

test("editable Stripe metadata alone never proves FlockFront origin", async () => {
  assert.equal(
    await isProvenFlockFrontRefund({
      action,
      binding,
      proofEvent: null,
      refund,
    }),
    false,
  );
});

test("a trusted API-response provider binding proves the current Stripe Refund", async () => {
  const apiProvenAction = {
    ...action,
    metadata: {
      ...action.metadata,
      origin_classification: "flockfront",
      origin_proof: "stripe_api_response",
    },
  };

  assert.equal(
    await isProvenFlockFrontRefund({
      action: apiProvenAction,
      binding,
      proofEvent: null,
      refund,
    }),
    true,
  );
  assert.equal(
    await isProvenFlockFrontRefund({
      action: apiProvenAction,
      binding,
      proofEvent: null,
      refund: { ...refund, id: "re_different" },
    }),
    false,
  );
});

test("a mismatched provider idempotency proof fails closed", async () => {
  const proofEvent = {
    provider: "stripe",
    event_type: "refund.created",
    event_status: "processed",
    provider_refund_id: refund.id,
    stripe_payment_intent_id: refund.payment_intent,
    related_refund_id: action.id,
    payload_summary: {
      origin_proof: "stripe_event_request_idempotency",
      request_idempotency_key_sha256: await sha256Hex("different-key"),
    },
  };

  assert.equal(
    await isProvenFlockFrontRefund({ action, binding, proofEvent, refund }),
    false,
  );
});

test("only unapplied FlockFront cancellation actions are resumable", () => {
  assert.equal(isUnfinishedCancellationAction(action), true);
  assert.equal(isUnfinishedCancellationAction({
    ...action,
    metadata: { ...action.metadata, cancellation_applied_at: "2026-09-04T12:05:00Z" },
  }), false);
});
