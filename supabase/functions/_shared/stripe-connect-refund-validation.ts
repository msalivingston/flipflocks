export type StripeRefundLike = {
  id: string;
  amount: number;
  currency: string;
  created: number;
  payment_intent: string | { id: string } | null;
  metadata: Record<string, string> | null;
  status: string | null;
};

export type StripePaymentIntentLike = {
  id: string;
  livemode: boolean;
  currency: string;
  amount_received: number;
};

export function refundPaymentIntentId(refund: StripeRefundLike): string | null {
  return typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
}

export function isValidConnectedRefundEvent({
  eventLivemode,
  expectedLivemode,
  paymentIntent,
  refund,
  validStatuses,
}: {
  eventLivemode: boolean;
  expectedLivemode: boolean;
  paymentIntent: StripePaymentIntentLike;
  refund: StripeRefundLike;
  validStatuses: ReadonlySet<string>;
}): boolean {
  const paymentIntentId = refundPaymentIntentId(refund);
  return eventLivemode === expectedLivemode &&
    paymentIntentId !== null && /^pi_[A-Za-z0-9]+$/.test(paymentIntentId) &&
    Number.isSafeInteger(refund.amount) && refund.amount > 0 &&
    /^[a-z]{3}$/.test(refund.currency) &&
    refund.status !== null && validStatuses.has(refund.status) &&
    paymentIntent.id === paymentIntentId &&
    paymentIntent.livemode === expectedLivemode &&
    paymentIntent.currency === refund.currency &&
    paymentIntent.amount_received >= refund.amount;
}

export function buildFullCancellationRefundResponseArgs({
  actionId,
  binding,
  refund,
}: {
  actionId: string;
  binding: {
    paymentIntentId: string;
    stripeAccountId: string;
    livemode: boolean;
  };
  refund: StripeRefundLike;
}) {
  if (refundPaymentIntentId(refund) !== binding.paymentIntentId) {
    throw new Error("stripe_refund_response_binding_invalid");
  }
  return {
    p_refund_action_id: actionId,
    p_provider_refund_id: refund.id,
    p_provider_status: refund.status ?? "pending",
    p_refund_amount_cents: refund.amount,
    p_currency: refund.currency,
    p_stripe_payment_intent_id: binding.paymentIntentId,
    p_stripe_account_id: binding.stripeAccountId,
    p_stripe_livemode: binding.livemode,
    p_stripe_metadata: refund.metadata ?? {},
    p_refund_created_at: new Date(refund.created * 1000).toISOString(),
  };
}
