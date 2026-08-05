import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { getBillingManagementAvailability } from "../lib/saas-billing-management.ts";

const panel = fs.readFileSync(
  path.join(process.cwd(), "app/dashboard/account/subscription-billing-panel.tsx"),
  "utf8",
);

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

test("canceling verified trial stays manageable and exposes resume", () => {
  const value = getBillingManagementAvailability(status({
    lifecycle_state: "trial_canceling_at_period_end",
    cancel_at_period_end: true,
  }));
  assert.equal(value.manageBilling, true);
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

test("billing controls expose accessible busy styling and prevent duplicate requests", () => {
  assert.match(panel, /enabled:cursor-pointer/);
  assert.match(panel, /disabled:cursor-not-allowed/);
  assert.match(panel, /disabled:opacity-50/);
  assert.match(panel, /const actionInFlight = useRef\(false\)/);
  assert.equal((panel.match(/if \(actionInFlight\.current\) return;/g) ?? []).length, 2);
  assert.equal((panel.match(/"Opening…"/g) ?? []).length, 5);
  assert.match(panel, /setActionError\(true\);[\s\S]{0,100}setActiveAction\(null\);/);
});

test("Portal return messaging is presentation-only and does not claim a change occurred", () => {
  assert.match(panel, /billing.*portal_return/);
  assert.match(panel, /Checking for billing updates…/);
  assert.doesNotMatch(panel, /Your billing changes are being confirmed\./);
  assert.match(panel, /Stripe changes may take a moment to appear/);
  assert.match(panel, /No billing change is assumed/);
});
