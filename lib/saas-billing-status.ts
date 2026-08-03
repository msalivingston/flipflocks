import { PLAN_CAPABILITIES, type PlanId } from "@/lib/plan-capabilities";

export type SellerBillingLifecycle =
  | "selection_required"
  | "checkout_required"
  | "checkout_in_progress"
  | "checkout_canceled"
  | "awaiting_stripe_confirmation"
  | "trial_active"
  | "trial_payment_problem"
  | "trial_canceling_at_period_end"
  | "active_paid"
  | "payment_failed_paid_through"
  | "payment_grace"
  | "suspended_nonpayment"
  | "canceling_at_period_end"
  | "fully_canceled"
  | "payment_pending_no_trial"
  | "complimentary_access"
  | "administrative_hold"
  | "unknown";

export type SellerBillingStatus = {
  administrative_hold: boolean;
  billing_authority: string | null;
  billing_complete: boolean;
  cancel_at_period_end: boolean;
  checkout_attempt_expires_at: string | null;
  checkout_attempt_status: string | null;
  checkout_enabled: boolean;
  complimentary_access_ends_at: string | null;
  current_enrollment_exists: boolean;
  current_period_end: string | null;
  customer_binding_exists: boolean;
  effective_billing_cadence: string | null;
  effective_plan_key: string | null;
  entitlement_access_until: string | null;
  entitlement_reason: string | null;
  grace_ends_at: string | null;
  has_active_access: boolean;
  latest_invoice_status: string | null;
  lifecycle_state: SellerBillingLifecycle;
  malformed_or_unclassified: boolean;
  paid_through_at: string | null;
  payment_action_required_at: string | null;
  payment_failure_started_at: string | null;
  portal_enabled: boolean;
  requested_billing_cadence: string | null;
  requested_plan_key: string | null;
  resumable_checkout: boolean;
  storefront_access_until: string | null;
  subscription_status: string | null;
  trial_eligibility: "trial_eligible" | "trial_already_used" | null;
  trial_ends_at: string | null;
  trial_started_at: string | null;
};

export type BillingBanner = {
  message: string;
  tone: "attention" | "critical" | "info";
};

const lifecycleStates = new Set<SellerBillingLifecycle>([
  "selection_required",
  "checkout_required",
  "checkout_in_progress",
  "checkout_canceled",
  "awaiting_stripe_confirmation",
  "trial_active",
  "trial_payment_problem",
  "trial_canceling_at_period_end",
  "active_paid",
  "payment_failed_paid_through",
  "payment_grace",
  "suspended_nonpayment",
  "canceling_at_period_end",
  "fully_canceled",
  "payment_pending_no_trial",
  "complimentary_access",
  "administrative_hold",
  "unknown",
]);

export function parseSellerBillingStatus(value: unknown): SellerBillingStatus | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!lifecycleStates.has(row.lifecycle_state as SellerBillingLifecycle)) return null;
  return row as SellerBillingStatus;
}

export function getPlanDisplayName(planKey: string | null) {
  if (planKey !== "small_flock" && planKey !== "full_flock") return null;
  return PLAN_CAPABILITIES[planKey].displayName;
}

export function getPlanPriceLabel(
  planKey: string | null,
  cadence: string | null,
) {
  if (planKey !== "small_flock" && planKey !== "full_flock") return null;
  const plan = PLAN_CAPABILITIES[planKey];
  if (cadence === "monthly") return `$${plan.monthlyPrice} monthly`;
  if (cadence === "yearly" && plan.yearlyPrice != null) {
    return `$${plan.yearlyPrice} annually`;
  }
  return null;
}

export function getCadenceDisplayName(cadence: string | null) {
  if (cadence === "monthly") return "Monthly";
  if (cadence === "yearly") return "Annual";
  return null;
}

export function formatBillingDate(
  value: string | null,
  options: { includeTime?: boolean } = {},
) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: options.includeTime ? "numeric" : undefined,
    minute: options.includeTime ? "2-digit" : undefined,
    month: "long",
    year: "numeric",
  }).format(date);
}

export function getBillingBanner(status: SellerBillingStatus): BillingBanner | null {
  const accessDate = formatBillingDate(status.entitlement_access_until);
  const graceDate = formatBillingDate(status.grace_ends_at, { includeTime: true });
  const trialDate = formatBillingDate(status.trial_ends_at);

  if (status.lifecycle_state === "administrative_hold") {
    return {
      message: "Your account needs support before selling can continue. Your account data remains safe.",
      tone: "critical",
    };
  }
  if (status.lifecycle_state === "suspended_nonpayment") {
    return {
      message: "Your FlockFront subscription is unpaid, so selling features are paused. Your listings and account data are still safe.",
      tone: "critical",
    };
  }
  if (status.lifecycle_state === "payment_grace") {
    return {
      message: graceDate
        ? `Your payment is still unresolved. Your store will pause on ${graceDate} unless payment succeeds.`
        : "Your payment is still unresolved. Your store will pause unless payment succeeds.",
      tone: "critical",
    };
  }
  if (status.payment_action_required_at && status.has_active_access) {
    return {
      message: accessDate
        ? `Your payment needs attention. Your store remains active through ${accessDate}.`
        : "Your payment needs attention. Please review your billing status.",
      tone: "attention",
    };
  }
  if (status.lifecycle_state === "payment_failed_paid_through") {
    return {
      message: accessDate
        ? `We could not process your subscription payment. Your store remains active through ${accessDate}.`
        : "We could not process your subscription payment. Please review your billing status.",
      tone: "attention",
    };
  }
  if (status.lifecycle_state === "trial_canceling_at_period_end") {
    return {
      message: trialDate
        ? `Your trial is scheduled to end on ${trialDate}.`
        : "Your trial is scheduled to end at its verified trial boundary.",
      tone: "info",
    };
  }
  if (status.lifecycle_state === "canceling_at_period_end") {
    return {
      message: accessDate
        ? `Your subscription is scheduled to end on ${accessDate}.`
        : "Your subscription is scheduled to end at the close of the current paid period.",
      tone: "info",
    };
  }
  if (status.lifecycle_state === "trial_active" && trialDate) {
    const days = Math.ceil((new Date(status.trial_ends_at!).getTime() - Date.now()) / 86_400_000);
    if (days <= 2) {
      return { message: `Your free trial ends on ${trialDate}.`, tone: "info" };
    }
  }
  if (status.lifecycle_state === "awaiting_stripe_confirmation") {
    return { message: "Stripe is still confirming your subscription.", tone: "info" };
  }
  return null;
}

export function isPendingBillingLifecycle(state: SellerBillingLifecycle) {
  return state === "checkout_in_progress" || state === "awaiting_stripe_confirmation";
}

export function isConfirmedBillingLifecycle(state: SellerBillingLifecycle) {
  return [
    "trial_active",
    "trial_payment_problem",
    "trial_canceling_at_period_end",
    "active_paid",
    "payment_failed_paid_through",
    "payment_grace",
    "canceling_at_period_end",
  ].includes(state);
}

export function isSafeStripeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com";
  } catch {
    return false;
  }
}

export function isSafeStripePortalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "billing.stripe.com" &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isPlanId(value: string | null): value is PlanId {
  return value === "small_flock" || value === "full_flock";
}
