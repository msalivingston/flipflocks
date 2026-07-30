import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function source(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("New Order inventory labels delegate to the canonical formatter", () => {
  const inventory = source(
    "app/dashboard/orders/_lib/order-form-inventory.ts",
  );
  const editor = source(
    "app/dashboard/orders/_components/order-items-editor.tsx",
  );

  assert.match(inventory, /formatOrderItemCategoryLabel/);
  assert.match(editor, /formatInventoryCategoryLabel\("poultry"\)/);
  assert.doesNotMatch(editor, /label: "Live poultry"/);
});

test("saved-order edit mapping uses the shared classifier and formatter", () => {
  const editMapping = source(
    "app/dashboard/orders/_lib/order-edit-mapping.ts",
  );

  assert.match(editMapping, /classifyOrderItemCategory\(item\)/);
  assert.match(editMapping, /formatOrderItemCategoryLabel\(orderCategory\)/);
  assert.doesNotMatch(editMapping, /return "Live poultry"/);
  assert.doesNotMatch(editMapping, /return "Poultry product"/);
});

test("order detail and list summaries use shared category rules", () => {
  const detail = source(
    "app/dashboard/orders/[orderId]/order-detail.tsx",
  );
  const list = source("app/dashboard/orders/orders-list.tsx");

  for (const currentSource of [detail, list]) {
    assert.match(currentSource, /classifyOrderItemCategory\(item\)/);
    assert.match(currentSource, /formatOrderItemCategoryLabel\(category\)/);
    assert.doesNotMatch(currentSource, /\|\| "Processed Poultry"/);
  }

  assert.match(
    list,
    /return classifyOrderItemCategory\(item\) === "live_birds"/,
  );
});

test("reports load structured category fields and do not infer from broad text", () => {
  const reports = source("app/dashboard/reports/reports-dashboard.tsx");

  assert.match(
    reports,
    /hatching_egg_inventory_item_id, order_item_source, species_name_snapshot/,
  );
  assert.match(
    reports,
    /formatOrderItemCategoryLabel\(classifyOrderItemCategory\(item\)\)/,
  );
  assert.doesNotMatch(reports, /raw\.includes\("egg"\)/);
  assert.doesNotMatch(reports, /raw\.includes\("product"\)/);
  assert.match(reports, /"Equipment & Supplies"/);
  assert.match(reports, /"Custom \/ Other"/);
});
