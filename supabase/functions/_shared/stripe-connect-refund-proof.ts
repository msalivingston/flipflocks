export const FLOCKFRONT_CANCELLATION_SCHEMA_VERSION =
  "ff_connect_cancellation_v1";
export const FLOCKFRONT_CANCELLATION_WORKFLOW = "paid_order_cancellation";
export const STRIPE_REFUND_ORIGIN_PROOF =
  "stripe_event_request_idempotency";

export type StripeRefundSnapshot = {
  id: string;
  amount: number;
  currency: string;
  created: number;
  payment_intent: string;
  metadata: Record<string, string>;
};

export type RefundActionSnapshot = {
  id: string;
  store_id: string;
  order_id: string;
  idempotency_key: string;
  request_hash: string;
  refund_amount: string | number;
  refund_method: string;
  provider_refund_id: string | null;
  currency_code: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_account_id: string | null;
  stripe_livemode: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type RefundProofEventSnapshot = {
  provider: string;
  event_type: string;
  event_status: string;
  provider_refund_id: string | null;
  stripe_payment_intent_id: string | null;
  related_refund_id: string | null;
  payload_summary: Record<string, unknown> | null;
};

export type TrustedPaymentBinding = {
  storeId: string;
  orderId: string;
  checkoutSessionId: string;
  paymentIntentId: string;
  stripeAccountId: string;
  livemode: boolean;
  currency: string;
};

export function majorAmountToCents(value: string | number): number | null {
  const normalized = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function isProvenFlockFrontRefund({
  action,
  binding,
  proofEvent,
  refund,
}: {
  action: RefundActionSnapshot | null;
  binding: TrustedPaymentBinding;
  proofEvent: RefundProofEventSnapshot | null;
  refund: StripeRefundSnapshot;
}): Promise<boolean> {
  if (!action || !proofEvent) return false;
  if (action.refund_method !== "stripe") return false;
  if (action.provider_refund_id !== refund.id) return false;
  if (action.store_id !== binding.storeId || action.order_id !== binding.orderId) {
    return false;
  }
  if (
    action.stripe_checkout_session_id !== binding.checkoutSessionId ||
    action.stripe_payment_intent_id !== binding.paymentIntentId ||
    action.stripe_account_id !== binding.stripeAccountId ||
    action.stripe_livemode !== binding.livemode
  ) {
    return false;
  }
  if (
    action.currency_code?.toLowerCase() !== binding.currency.toLowerCase() ||
    refund.currency.toLowerCase() !== binding.currency.toLowerCase() ||
    refund.payment_intent !== binding.paymentIntentId ||
    majorAmountToCents(action.refund_amount) !== refund.amount
  ) {
    return false;
  }

  const actionMetadata = action.metadata ?? {};
  if (
    actionMetadata.schema_version !== FLOCKFRONT_CANCELLATION_SCHEMA_VERSION ||
    actionMetadata.workflow_type !== FLOCKFRONT_CANCELLATION_WORKFLOW ||
    refund.metadata.ff_cancellation_schema_version !==
      FLOCKFRONT_CANCELLATION_SCHEMA_VERSION ||
    refund.metadata.ff_refund_action_id !== action.id ||
    refund.metadata.ff_order_id !== action.order_id ||
    refund.metadata.ff_request_hash !== action.request_hash
  ) {
    return false;
  }

  if (Math.floor(new Date(action.created_at).getTime() / 1000) > refund.created) {
    return false;
  }

  const proofSummary = proofEvent.payload_summary ?? {};
  if (
    proofEvent.provider !== "stripe" ||
    proofEvent.event_type !== "refund.created" ||
    proofEvent.event_status !== "processed" ||
    proofEvent.provider_refund_id !== refund.id ||
    proofEvent.stripe_payment_intent_id !== binding.paymentIntentId ||
    proofEvent.related_refund_id !== action.id ||
    proofSummary.origin_proof !== STRIPE_REFUND_ORIGIN_PROOF
  ) {
    return false;
  }

  const expectedIdempotencyHash = await sha256Hex(action.idempotency_key);
  return proofSummary.request_idempotency_key_sha256 === expectedIdempotencyHash;
}

export function isUnfinishedCancellationAction(
  action: RefundActionSnapshot,
): boolean {
  const metadata = action.metadata ?? {};
  return metadata.cancellation_applied_at == null &&
    metadata.workflow_state !== "cancellation_applied";
}

export type PaidCancellationPreflightDecision =
  | "eligible"
  | "resume_flockfront_action"
  | "support_required"
  | "ineligible";

export function decidePaidCancellationPreflight({
  refundCount,
  provenRefundCount,
  unfinishedActionCount,
}: {
  refundCount: number;
  provenRefundCount: number;
  unfinishedActionCount: number;
}): PaidCancellationPreflightDecision {
  if (refundCount === 0) return "eligible";
  if (provenRefundCount !== refundCount) return "support_required";
  if (unfinishedActionCount > 0) return "resume_flockfront_action";
  return "ineligible";
}
