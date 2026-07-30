import assert from "node:assert/strict";
import test from "node:test";

import { canCancelOrder } from "./order-action-predicates.ts";

const matrix = [
  {
    expected: true,
    label: "pending pay-at-pickup",
    order_status: "pending",
    payment_method: "pay_at_pickup",
    payment_status: "pay_at_pickup",
  },
  {
    expected: true,
    label: "open paid pay-at-pickup",
    order_status: "open",
    payment_method: "pay_at_pickup",
    payment_status: "paid",
  },
  {
    expected: true,
    label: "pending unpaid online",
    order_status: "pending",
    payment_method: "stripe_checkout",
    payment_status: "unpaid",
  },
  {
    expected: true,
    label: "open unpaid online",
    order_status: "open",
    payment_method: "stripe_checkout",
    payment_status: "unpaid",
  },
  {
    expected: false,
    label: "pending paid online",
    order_status: "pending",
    payment_method: "stripe_checkout",
    payment_status: "paid",
  },
  {
    expected: false,
    label: "open partially refunded online",
    order_status: "open",
    payment_method: "stripe_checkout",
    payment_status: "partially_refunded",
  },
  {
    expected: false,
    label: "open refunded online",
    order_status: "open",
    payment_method: "stripe_checkout",
    payment_status: "refunded",
  },
  {
    expected: false,
    label: "fulfilled pay-at-pickup",
    order_status: "fulfilled",
    payment_method: "pay_at_pickup",
    payment_status: "pay_at_pickup",
  },
  {
    expected: false,
    label: "canceled pay-at-pickup",
    order_status: "canceled",
    payment_method: "pay_at_pickup",
    payment_status: "canceled",
  },
];

for (const {
  expected,
  label,
  order_status,
  payment_method,
  payment_status,
} of matrix) {
  test(`cancellation eligibility rejects or allows ${label}`, () => {
    assert.equal(
      canCancelOrder({ order_status, payment_method, payment_status }),
      expected,
    );
  });
}
