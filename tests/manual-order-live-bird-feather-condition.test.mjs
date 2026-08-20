import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatLiveBirdAdvancedDetails } from "../lib/live-bird-advanced-attributes.ts";

test("manual-order search and selected rows use shared Live Bird detail labels", async () => {
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

  assert.equal(
    formatLiveBirdAdvancedDetails({
      breedingHistory: "breeder",
      featherCondition: "good",
    }),
    "Breeder · Good feathers",
  );
  assert.match(
    orderSource,
    /custom_inventory_label, breeding_history, feather_condition, origin_date/,
  );
  assert.match(inventorySource, /formatLiveBirdAdvancedDetails\(\{/);
  assert.match(inventorySource, /item\.liveBirdAdvancedDetailsLabel/);
  assert.match(editorSource, /\{formatInventoryMetadata\(item\)\} &middot;/);
  assert.match(editorSource, /selectedItem\s*\? formatInventoryMetadata\(selectedItem\)/);
});

test("the shared Live Bird details formatter omits blank values", () => {
  assert.equal(
    formatLiveBirdAdvancedDetails({
      breedingHistory: null,
      featherCondition: null,
    }),
    "",
  );
});
