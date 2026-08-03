import type { SellerBillingStatus } from "./saas-billing-status";

export type BillingManagementAvailability = {
  manageBilling: boolean;
  updatePaymentMethod: boolean;
  viewInvoices: boolean;
  cancelSubscription: boolean;
  resumeSubscription: boolean;
};

export function getBillingManagementAvailability(
  status: Pick<
    SellerBillingStatus,
    | "portal_enabled"
    | "current_enrollment_exists"
    | "customer_binding_exists"
    | "lifecycle_state"
    | "cancel_at_period_end"
  >,
): BillingManagementAvailability {
  const verifiedStripeManagement = status.portal_enabled &&
    status.current_enrollment_exists && status.customer_binding_exists &&
    !["complimentary_access", "administrative_hold", "unknown", "fully_canceled"].includes(
      status.lifecycle_state,
    );
  const updatePaymentMethod = verifiedStripeManagement && [
    "trial_active", "trial_payment_problem", "active_paid",
    "payment_failed_paid_through", "payment_grace", "canceling_at_period_end",
  ].includes(status.lifecycle_state);
  return {
    manageBilling: verifiedStripeManagement,
    updatePaymentMethod,
    viewInvoices: verifiedStripeManagement,
    cancelSubscription: verifiedStripeManagement && !status.cancel_at_period_end && [
      "trial_active", "trial_payment_problem", "active_paid",
      "payment_failed_paid_through", "payment_grace",
    ].includes(status.lifecycle_state),
    resumeSubscription: verifiedStripeManagement && status.cancel_at_period_end &&
      status.lifecycle_state === "canceling_at_period_end",
  };
}
