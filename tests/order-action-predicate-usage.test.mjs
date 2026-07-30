import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const detailPath = new URL(
  "../app/dashboard/orders/[orderId]/order-detail.tsx",
  import.meta.url,
);
const listPath = new URL(
  "../app/dashboard/orders/orders-list.tsx",
  import.meta.url,
);
const editPath = new URL(
  "../app/dashboard/orders/[orderId]/edit/edit-order.tsx",
  import.meta.url,
);

test("order detail imports shared single-order predicates", async () => {
  const source = await readFile(detailPath, "utf8");

  assert.match(source, /from "\.\.\/order-action-predicates"/);
  for (const predicate of [
    "canArchiveOrder",
    "canCancelOrder",
    "canEditOrder",
    "canMarkOrderFulfilled",
    "canMarkOrderPaid",
    "canMarkOrderUnpaid",
    "canUnarchiveOrder",
    "canUnfulfillOrder",
  ]) {
    assert.match(source, new RegExp(`${predicate}\\(orderActionSnapshot\\)`));
    assert.doesNotMatch(
      source,
      new RegExp(`function ${predicate}\\(`),
    );
  }
});

test("orders list and bulk controls use shared bulk predicates", async () => {
  const source = await readFile(listPath, "utf8");

  assert.match(source, /from "\.\/order-action-predicates"/);
  assert.match(source, /canBulkMarkOrderFulfilled\(/);
  assert.match(source, /filter\(canBulkMarkOrderPaid\)/);
  assert.match(source, /filter\(canBulkArchiveOrder\)/);
  assert.match(source, /filter\(canBulkUnarchiveOrder\)/);
  assert.doesNotMatch(source, /function isBulkFulfillmentEligible\(/);
  assert.doesNotMatch(source, /function isBulkPaymentEligible\(/);
});

test("order detail represents partial-fulfillment edit protection", async () => {
  const source = await readFile(detailPath, "utf8");

  assert.match(source, /hasAdjustedItemQuantities/);
  assert.match(source, /item\.fulfilled_quantity > 0/);
  assert.match(source, /has_adjusted_item_quantities: hasAdjustedItemQuantities/);
});

test("order editor uses the shared edit predicate and adjusted-item guard", async () => {
  const source = await readFile(editPath, "utf8");

  assert.match(source, /from "\.\.\/\.\.\/order-action-predicates"/);
  assert.match(source, /canEditOrder\(\{/);
  assert.match(
    source,
    /has_adjusted_item_quantities: data\.hasAdjustedItemQuantities/,
  );
  assert.doesNotMatch(source, /function canEditOrder\(/);
});
