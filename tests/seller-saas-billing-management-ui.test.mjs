import assert from "node:assert/strict";
import test from "node:test";

import { getBillingManagementAvailability } from "../lib/saas-billing-management.ts";

function status(overrides = {}) {
  return {
    portal_enabled: true,
    current_enrollment_exists: true,
    customer_binding_exists: true,
    lifecycle_state: "active_paid",
    cancel_at_period_end: false,
    ...overrides,
  };
}

test("Portal controls are all hidden while the feature flag is false", () => {
  assert.deepEqual(getBillingManagementAvailability(status({ portal_enabled: false })), {
    manageBilling: false,
    updatePaymentMethod: false,
    viewInvoices: false,
    cancelSubscription: false,
    resumeSubscription: false,
  });
});

test("verified active Stripe enrollment exposes standard billing actions", () => {
  assert.deepEqual(getBillingManagementAvailability(status()), {
    manageBilling: true,
    updatePaymentMethod: true,
    viewInvoices: true,
    cancelSubscription: true,
    resumeSubscription: false,
  });
});

test("payment recovery states retain payment-method management", () => {
  for (const lifecycle_state of [
    "trial_active", "trial_payment_problem", "payment_failed_paid_through", "payment_grace",
  ]) {
    const value = getBillingManagementAvailability(status({ lifecycle_state }));
    assert.equal(value.updatePaymentMethod, true, lifecycle_state);
    assert.equal(value.cancelSubscription, true, lifecycle_state);
  }
});

test("canceling subscription exposes resume but not a second cancel action", () => {
  const value = getBillingManagementAvailability(status({
    lifecycle_state: "canceling_at_period_end",
    cancel_at_period_end: true,
  }));
  assert.equal(value.updatePaymentMethod, true);
  assert.equal(value.cancelSubscription, false);
  assert.equal(value.resumeSubscription, true);
});

test("complimentary, held, unknown, canceled, local, and unbound states expose no actions", () => {
  for (const lifecycle_state of [
    "complimentary_access", "administrative_hold", "unknown", "fully_canceled",
  ]) {
    assert.equal(getBillingManagementAvailability(status({ lifecycle_state })).manageBilling, false);
  }
  assert.equal(getBillingManagementAvailability(status({ current_enrollment_exists: false })).manageBilling, false);
  assert.equal(getBillingManagementAvailability(status({ customer_binding_exists: false })).manageBilling, false);
});
