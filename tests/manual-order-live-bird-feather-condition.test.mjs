import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatFeatherCondition } from "../lib/live-bird-advanced-attributes.ts";

test("manual-order search and selected rows use the shared feather-condition label", async () => {
  const [inventorySource, orderSource, editorSource] = await Promise.all([
    readFile(
      new URL("../app/dashboard/orders/_lib/order-form-inventory.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/dashboard/orders/new/new-manual-order.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/dashboard/orders/_components/order-items-editor.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.equal(formatFeatherCondition("good"), "Good feathers");
  assert.match(orderSource, /custom_inventory_label, feather_condition, origin_date/);
  assert.match(inventorySource, /formatFeatherCondition\(row\.feather_condition\)/);
  assert.match(inventorySource, /item\.featherConditionLabel/);
  assert.match(editorSource, /\{formatInventoryMetadata\(item\)\} &middot;/);
  assert.match(editorSource, /selectedItem\s*\? formatInventoryMetadata\(selectedItem\)/);
});

test("the shared feather formatter omits blank values", () => {
  assert.equal(formatFeatherCondition(null), null);
  assert.equal(formatFeatherCondition(""), null);
});
