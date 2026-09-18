export const FLOCKFRONT_CANCELLATION_SCHEMA_VERSION =
  "ff_connect_cancellation_v1";
export const FLOCKFRONT_CANCELLATION_WORKFLOW = "paid_order_cancellation";
export const STRIPE_REFUND_ORIGIN_PROOF =
  "stripe_event_request_idempotency";
export const STRIPE_API_RESPONSE_ORIGIN_PROOF = "stripe_api_response";

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
  refund_status?: string;
  provider_refund_id: string | null;
  provider_status?: string | null;
  processed_at?: string | null;
  payment_provider_event_id?: string | null;
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
  if (!action) return false;
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

  // This marker is written only by the service-only RPC after the cancellation
  // orchestrator receives this exact Refund from Stripe. The preflight still
  // verifies the current Refund object and every immutable provider binding.
  if (
    actionMetadata.origin_classification === "flockfront" &&
    actionMetadata.origin_proof === STRIPE_API_RESPONSE_ORIGIN_PROOF
  ) {
    return true;
  }

  if (!proofEvent) return false;

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

export type CancellationItemSnapshot = {
  id: string;
  quantity: number;
  fulfilled_quantity: number;
  canceled_quantity: number;
  restored_quantity: number;
  inventory_debited_quantity: number | null;
  order_item_source: string;
};

// 23 hours leaves a margin below Stripe API v1's at-least-24-hour key retention.
export const REFUND_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

export async function isRetryableUnobservedCancellationAction({
  action,
  binding,
  items,
  paidAmountCents,
  nowMs = Date.now(),
}: {
  action: RefundActionSnapshot;
  binding: TrustedPaymentBinding;
  items: CancellationItemSnapshot[];
  paidAmountCents: number;
  nowMs?: number;
}): Promise<boolean> {
  const metadata = action.metadata ?? {};
  const createdMs = Date.parse(action.created_at);
  if (
    !Number.isFinite(createdMs) || createdMs > nowMs ||
    nowMs - createdMs >= REFUND_RETRY_WINDOW_MS ||
    action.refund_method !== "stripe" || action.refund_status !== "pending" ||
    action.provider_refund_id != null || action.provider_status != null ||
    action.processed_at != null || action.payment_provider_event_id != null ||
    action.store_id !== binding.storeId || action.order_id !== binding.orderId ||
    action.stripe_checkout_session_id !== binding.checkoutSessionId ||
    action.stripe_payment_intent_id !== binding.paymentIntentId ||
    action.stripe_account_id !== binding.stripeAccountId ||
    action.stripe_livemode !== binding.livemode ||
    action.currency_code?.toLowerCase() !== binding.currency.toLowerCase() ||
    majorAmountToCents(action.refund_amount) !== paidAmountCents ||
    metadata.schema_version !== FLOCKFRONT_CANCELLATION_SCHEMA_VERSION ||
    metadata.ff_schema_version !== FLOCKFRONT_CANCELLATION_SCHEMA_VERSION ||
    metadata.workflow_type !== FLOCKFRONT_CANCELLATION_WORKFLOW ||
    metadata.cancellation_type !== "full" ||
    !["refund_pending", "refund_start_rejected"].includes(String(metadata.workflow_state)) ||
    metadata.origin_proof != null || metadata.cancellation_applied_at != null ||
    metadata.request_hash !== action.request_hash ||
    !/^[0-9a-f]{64}$/.test(action.request_hash) ||
    !Array.isArray(metadata.remaining_active_quantities) ||
    metadata.restoration_intent !== "all_eligible_remaining_inventory"
  ) return false;

  const expectedKey = "ff-full-cancel-v1:" + await sha256Hex(
    [binding.orderId, binding.paymentIntentId, paidAmountCents, binding.currency.toUpperCase()].join(":"),
  );
  if (action.idempotency_key !== expectedKey) return false;

  const lines = metadata.remaining_active_quantities as Record<string, unknown>[];
  if (lines.length !== items.length || !lines.length) return false;
  const lineById = new Map(lines.map((line) => [line.order_item_id, line]));
  if (lineById.size !== lines.length) return false;
  return items.every((item) => {
    const line = lineById.get(item.id);
    const eligible = item.order_item_source === "custom" ? 0
      : Math.max((item.inventory_debited_quantity ?? 0) - item.fulfilled_quantity - item.restored_quantity, 0);
    return line?.quantity === item.quantity &&
      line.remaining_active_quantity === item.quantity - item.fulfilled_quantity - item.canceled_quantity &&
      line.eligible_restoration_quantity === eligible;
  });
}

export async function decideZeroRefundActionRecovery({
  actions,
  linkedProviderEventCount,
  binding,
  items,
  paidAmountCents,
  nowMs = Date.now(),
}: {
  actions: RefundActionSnapshot[];
  linkedProviderEventCount: number;
  binding: TrustedPaymentBinding;
  items: CancellationItemSnapshot[];
  paidAmountCents: number;
  nowMs?: number;
}): Promise<{ decision: "eligible" | "resume_flockfront_action" | "support_required"; action?: RefundActionSnapshot }> {
  if (actions.length === 0) return { decision: "eligible" };
  if (actions.length !== 1 || linkedProviderEventCount !== 0 ||
      !await isRetryableUnobservedCancellationAction({
        action: actions[0], binding, items, paidAmountCents, nowMs,
      })) return { decision: "support_required" };
  return { decision: "resume_flockfront_action", action: actions[0] };
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
