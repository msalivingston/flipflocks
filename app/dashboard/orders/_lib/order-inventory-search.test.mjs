import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperUrl = new URL("./order-inventory-search.ts", import.meta.url);
const editorUrl = new URL(
  "../_components/order-items-editor.tsx",
  import.meta.url,
);
const newOrderUrl = new URL("../new/new-manual-order.tsx", import.meta.url);
const editOrderUrl = new URL(
  "../[orderId]/edit/edit-order.tsx",
  import.meta.url,
);

test("order inventory search is bounded after full-dataset database filters", async () => {
  const source = await readFile(helperUrl, "utf8");

  assert.match(source, /ORDER_INVENTORY_QUICK_RESULT_LIMIT = 12/);
  assert.match(source, /ORDER_INVENTORY_BROWSE_RESULT_LIMIT = 20/);
  assert.match(source, /\.or\(searchFilter\)/);
  assert.match(source, /\.limit\(limit\)/);
  assert.match(source, /boundedLimit[\s\S]*\.slice\(0, boundedLimit\)/);

  for (const view of [
    "seller_inventory_management",
    "seller_equipment_inventory_management",
    "seller_hatching_egg_inventory_management",
    "seller_processed_poultry_inventory_management",
  ]) {
    assert.match(source, new RegExp(`\\.from\\("${view}"\\)`));
  }

  assert.ok(
    source.match(/\.eq\("store_id", storeId\)/g)?.length >= 8,
    "every search and explicit-ID source is store scoped",
  );
});

test("all supported categories and legacy hatching eggs have server filters", async () => {
  const source = await readFile(helperUrl, "utf8");

  for (const category of [
    "poultry",
    "hatching_eggs",
    "processed_poultry",
    "equipment",
  ]) {
    assert.match(source, new RegExp(`"${category}"`));
  }

  assert.match(
    source,
    /batch_type\.eq\.hatching_eggs,inventory_type\.eq\.hatching_eggs/,
  );
  assert.match(source, /breed_display_name/);
  assert.match(source, /species_name/);
  assert.match(source, /internal_batch_label/);
  assert.match(source, /item_name/);
  assert.match(source, /product_name/);
  assert.match(source, /age_at_availability_days/);
});

test("New and Edit Order no longer load complete inventory snapshots", async () => {
  const [newSource, editSource] = await Promise.all([
    readFile(newOrderUrl, "utf8"),
    readFile(editOrderUrl, "utf8"),
  ]);

  for (const source of [newSource, editSource]) {
    assert.match(source, /useOrderInventorySearch/);
    assert.doesNotMatch(source, /\.from\("seller_inventory_management"\)/);
    assert.doesNotMatch(
      source,
      /\.from\("seller_equipment_inventory_management"\)/,
    );
    assert.doesNotMatch(
      source,
      /\.from\("seller_hatching_egg_inventory_management"\)/,
    );
    assert.doesNotMatch(
      source,
      /\.from\("seller_processed_poultry_inventory_management"\)/,
    );
  }
});

test("existing and restored lines use explicit bounded ID loading", async () => {
  const [helperSource, newSource, editSource] = await Promise.all([
    readFile(helperUrl, "utf8"),
    readFile(newOrderUrl, "utf8"),
    readFile(editOrderUrl, "utf8"),
  ]);

  assert.match(editSource, /loadOrderInventoryForLines/);
  assert.match(newSource, /loadOrderInventoryByReferences/);
  assert.match(helperSource, /\{ includeHistorical: true \}/);
  assert.match(
    helperSource,
    /if \(!includeHistorical\)[\s\S]*\.neq\("inventory_visibility_status", "archived"\)/,
  );
  assert.match(
    helperSource,
    /if \(!includeHistorical\)[\s\S]*\.neq\("visibility_status", "archived"\)/,
  );
  assert.match(helperSource, /\.in\("inventory_item_id", idChunk\)/);
  assert.match(
    helperSource,
    /\.in\("equipment_inventory_item_id", idChunk\)/,
  );
  assert.match(
    helperSource,
    /\.in\("hatching_egg_inventory_item_id", idChunk\)/,
  );
  assert.match(
    helperSource,
    /\.in\("processed_poultry_inventory_item_id", idChunk\)/,
  );
  assert.match(helperSource, /index \+= 200/);
});

test("the editor presents server results instead of filtering its cache", async () => {
  const source = await readFile(editorUrl, "utf8");

  assert.match(source, /inventorySearchResults/);
  assert.match(source, /browseInventory/);
  assert.doesNotMatch(source, /filterInventory\(/);
  assert.doesNotMatch(source, /getBrowseInventoryRows\(/);
});
