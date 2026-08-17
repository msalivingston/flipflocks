import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL(
    "../app/dashboard/inventory/add-v2/live-birds/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

function sourceBetween(start, end) {
  const startIndex = page.indexOf(start);
  const endIndex = page.indexOf(end, startIndex);

  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);

  return page.slice(startIndex, endIndex);
}

const saveEditedListing = sourceBetween(
  "async function saveEditedListing",
  "async function saveCurrentHiddenDraft",
);
const editBlockingValidation = sourceBetween(
  "function getEditSaveBlockingIssues",
  "function getDuplicateEditOfferingIssues",
);
const currentRowsValidation = sourceBetween(
  "function getEditCurrentRowsValidationIssue",
  "async function syncExistingEditOfferings",
);
const offeringSync = sourceBetween(
  "async function syncExistingEditOfferings",
  "function getActiveInventoryRows",
);

test("Edit save does not compare available inventory with active reservations", () => {
  assert.doesNotMatch(saveEditedListing, /loadActiveReservationMap/);
  assert.doesNotMatch(currentRowsValidation, /reservationMap|reservedQuantity/);
  assert.doesNotMatch(
    page,
    /Quantity cannot be lower than the number already reserved in active orders/,
  );
});

test("zero and positive available quantities remain valid while negative quantities fail", () => {
  assert.match(
    editBlockingValidation,
    /!Number\.isInteger\(quantity\) \|\| quantity < 0/,
  );
  assert.doesNotMatch(editBlockingValidation, /quantity <= 0/);
  assert.doesNotMatch(editBlockingValidation, /reserved/i);
});

test("persisted, unreserved, and newly added entries share available-quantity semantics", () => {
  assert.doesNotMatch(currentRowsValidation, /reserved/i);
  assert.match(offeringSync, /if \(!offering\.inventoryItemId\)/);
  assert.match(offeringSync, /seller_create_inventory_item/);
  assert.match(offeringSync, /seller_adjust_inventory_quantity/);
});

test("Edit save does not mutate reservations or existing orders", () => {
  assert.doesNotMatch(saveEditedListing, /seller_order_item_detail/);
  assert.doesNotMatch(offeringSync, /seller_order_item_detail/);
  assert.doesNotMatch(offeringSync, /seller_(?:edit|cancel|fulfill).*order/i);
  assert.match(
    offeringSync,
    /getNumberInputValue\(offering\.quantity\) !== currentRow\.quantity_available/,
  );
  assert.match(
    offeringSync,
    /p_quantity_available: getNumberInputValue\(offering\.quantity\)/,
  );
});

test("sold-history removal protection remains separate and intact", () => {
  assert.match(page, /loadInventoryRemovalBlockedIds/);
  assert.match(page, /seller_order_item_detail/);
  assert.match(page, /seller_order_management/);
  assert.match(page, /orderStatus !== "canceled"/);
});
