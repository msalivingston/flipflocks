import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFullCancellationRefundResponseArgs,
  isValidConnectedRefundEvent,
} from "../supabase/functions/_shared/stripe-connect-refund-validation.ts";

const refund = {
  id: "re_live_refund",
  amount: 100,
  currency: "usd",
  created: 1790272800,
  payment_intent: "pi_3UH5xRLWseysRjWK0tLufKqC",
  metadata: {
    ff_cancellation_schema_version: "ff_connect_cancellation_v1",
    ff_refund_action_id: "51000000-0000-4000-8000-000000000001",
    ff_order_id: "51000000-0000-4000-8000-000000000002",
    ff_request_hash: "a".repeat(64),
  },
  status: "succeeded",
};

test("trusted response recording uses binding livemode when a realistic Refund has no livemode", () => {
  assert.equal("livemode" in refund, false);
  const args = buildFullCancellationRefundResponseArgs({
    actionId: "51000000-0000-4000-8000-000000000001",
    binding: {
      paymentIntentId: "pi_3UH5xRLWseysRjWK0tLufKqC",
      stripeAccountId: "acct_live_connected",
      livemode: true,
    },
    refund,
  });
  assert.equal(args.p_stripe_livemode, true);
  assert.equal(args.p_provider_refund_id, refund.id);
  assert.equal(args.p_provider_status, "succeeded");
  assert.equal(args.p_stripe_payment_intent_id, refund.payment_intent);
});

test("valid refund webhook uses Event and PaymentIntent livemode, not Refund livemode", () => {
  const paymentIntent = {
    id: "pi_3UH5xRLWseysRjWK0tLufKqC",
    livemode: true,
    currency: "usd",
    amount_received: 100,
  };
  const validStatuses = new Set(["pending", "requires_action", "succeeded", "failed", "canceled"]);
  assert.equal("livemode" in refund, false);
  assert.equal(isValidConnectedRefundEvent({
    eventLivemode: true,
    expectedLivemode: true,
    paymentIntent,
    refund,
    validStatuses,
  }), true);
  assert.equal(isValidConnectedRefundEvent({
    eventLivemode: false,
    expectedLivemode: true,
    paymentIntent,
    refund,
    validStatuses,
  }), false);
  assert.equal(isValidConnectedRefundEvent({
    eventLivemode: true,
    expectedLivemode: true,
    paymentIntent: { ...paymentIntent, livemode: false },
    refund,
    validStatuses,
  }), false);
});
