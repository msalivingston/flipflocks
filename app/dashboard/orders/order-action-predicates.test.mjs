import assert from "node:assert/strict";
import test from "node:test";

import {
  canArchiveOrder,
  canBulkArchiveOrder,
  canBulkMarkOrderFulfilled,
  canBulkMarkOrderPaid,
  canBulkUnarchiveOrder,
  canCancelOrder,
  canEditOrder,
  canMarkOrderFulfilled,
  canMarkOrderPaid,
  canMarkOrderUnpaid,
  canUnarchiveOrder,
  canUnfulfillOrder,
} from "./order-action-predicates.ts";

const baseOrder = {
  archived_at: null,
  canceled_at: null,
  fulfilled_at: null,
  has_adjusted_item_quantities: false,
  order_status: "open",
  payment_method: "pay_at_pickup",
  payment_provider: "offline",
  payment_status: "pay_at_pickup",
  remaining_unfulfilled_quantity: 2,
};

function actionsFor(overrides = {}) {
  const order = { ...baseOrder, ...overrides };

  return {
    archive: canArchiveOrder(order),
    bulkArchive: canBulkArchiveOrder(order),
    bulkFulfill: canBulkMarkOrderFulfilled(order),
    bulkMarkPaid: canBulkMarkOrderPaid(order),
    bulkUnarchive: canBulkUnarchiveOrder(order),
    cancel: canCancelOrder(order),
    edit: canEditOrder(order),
    fulfill: canMarkOrderFulfilled(order),
    markPaid: canMarkOrderPaid(order),
    markUnpaid: canMarkOrderUnpaid(order),
    unarchive: canUnarchiveOrder(order),
    unfulfill: canUnfulfillOrder(order),
  };
}

const stateMatrix = [
  {
    name: "open offline pay-at-pickup",
    overrides: {},
    expected: {
      archive: true,
      bulkArchive: true,
      bulkFulfill: true,
      bulkMarkPaid: true,
      bulkUnarchive: false,
      cancel: true,
      edit: true,
      fulfill: true,
      markPaid: true,
      markUnpaid: false,
      unarchive: false,
      unfulfill: false,
    },
  },
  {
    name: "pending unpaid Stripe",
    overrides: {
      order_status: "pending",
      payment_method: "stripe_checkout",
      payment_provider: "stripe",
      payment_status: "unpaid",
    },
    expected: {
      archive: true,
      bulkArchive: true,
      bulkFulfill: true,
      bulkMarkPaid: false,
      bulkUnarchive: false,
      cancel: true,
      edit: true,
      fulfill: true,
      markPaid: false,
      markUnpaid: false,
      unarchive: false,
      unfulfill: false,
    },
  },
  ...["paid", "partially_refunded", "refunded"].map((paymentStatus) => ({
    name: `open Stripe ${paymentStatus}`,
    overrides: {
      payment_method: "stripe_checkout",
      payment_provider: "stripe",
      payment_status: paymentStatus,
    },
    expected: {
      archive: true,
      bulkArchive: true,
      bulkFulfill: true,
      bulkMarkPaid: false,
      bulkUnarchive: false,
      cancel: false,
      edit: false,
      fulfill: true,
      markPaid: false,
      markUnpaid: false,
      unarchive: false,
      unfulfill: false,
    },
  })),
  {
    name: "fulfilled paid offline",
    overrides: {
      fulfilled_at: "2026-07-30T12:00:00.000Z",
      order_status: "fulfilled",
      payment_status: "paid",
      remaining_unfulfilled_quantity: 0,
    },
    expected: {
      archive: true,
      bulkArchive: true,
      bulkFulfill: false,
      bulkMarkPaid: false,
      bulkUnarchive: false,
      cancel: false,
      edit: false,
      fulfill: false,
      markPaid: false,
      markUnpaid: true,
      unarchive: false,
      unfulfill: true,
    },
  },
  {
    name: "fulfilled unpaid offline",
    overrides: {
      fulfilled_at: "2026-07-30T12:00:00.000Z",
      order_status: "fulfilled",
      payment_status: "unpaid",
      remaining_unfulfilled_quantity: 0,
    },
    expected: {
      archive: true,
      bulkArchive: true,
      bulkFulfill: false,
      bulkMarkPaid: true,
      bulkUnarchive: false,
      cancel: false,
      edit: false,
      fulfill: false,
      markPaid: true,
      markUnpaid: false,
      unarchive: false,
      unfulfill: true,
    },
  },
  {
    name: "canceled order",
    overrides: {
      canceled_at: "2026-07-30T12:00:00.000Z",
      order_status: "canceled",
      payment_status: "canceled",
      remaining_unfulfilled_quantity: 0,
    },
    expected: {
      archive: true,
      bulkArchive: true,
      bulkFulfill: false,
      bulkMarkPaid: false,
      bulkUnarchive: false,
      cancel: false,
      edit: false,
      fulfill: false,
      markPaid: false,
      markUnpaid: false,
      unarchive: false,
      unfulfill: false,
    },
  },
  {
    name: "archived open offline order",
    overrides: {
      archived_at: "2026-07-30T12:00:00.000Z",
    },
    expected: {
      archive: false,
      bulkArchive: false,
      bulkFulfill: false,
      bulkMarkPaid: false,
      bulkUnarchive: true,
      cancel: true,
      edit: true,
      fulfill: true,
      markPaid: true,
      markUnpaid: false,
      unarchive: true,
      unfulfill: false,
    },
  },
  {
    name: "partially fulfilled open order",
    overrides: {
      has_adjusted_item_quantities: true,
      remaining_unfulfilled_quantity: 1,
    },
    expected: {
      archive: true,
      bulkArchive: true,
      bulkFulfill: true,
      bulkMarkPaid: true,
      bulkUnarchive: false,
      cancel: true,
      edit: false,
      fulfill: true,
      markPaid: true,
      markUnpaid: false,
      unarchive: false,
      unfulfill: false,
    },
  },
];

for (const state of stateMatrix) {
  test(`order action matrix: ${state.name}`, () => {
    assert.deepEqual(actionsFor(state.overrides), state.expected);
  });
}

test("mixed bulk selections retain only rows eligible for each action", () => {
  const eligible = { ...baseOrder };
  const archived = {
    ...baseOrder,
    archived_at: "2026-07-30T12:00:00.000Z",
  };
  const canceled = {
    ...baseOrder,
    canceled_at: "2026-07-30T12:00:00.000Z",
    order_status: "canceled",
    payment_status: "canceled",
  };
  const selected = [eligible, archived, canceled];

  assert.deepEqual(
    selected.filter(canBulkMarkOrderFulfilled),
    [eligible],
  );
  assert.deepEqual(selected.filter(canBulkMarkOrderPaid), [eligible]);
  assert.deepEqual(selected.filter(canBulkArchiveOrder), [eligible, canceled]);
  assert.deepEqual(selected.filter(canBulkUnarchiveOrder), [archived]);
});
