import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../../../..");
const moduleCache = new Map();

function loadTypeScriptModule(relativePath) {
  const filename = resolve(root, relativePath);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;

  const loadedModule = { exports: {} };
  moduleCache.set(filename, loadedModule);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;

  function localRequire(specifier) {
    if (!specifier.startsWith(".")) return {};
    const candidate = resolve(dirname(filename), specifier);
    const resolved = extname(candidate) ? candidate : `${candidate}.ts`;
    return loadTypeScriptModule(resolved.slice(root.length + 1));
  }

  new Function("require", "module", "exports", "__filename", "__dirname", output)(
    localRequire,
    loadedModule,
    loadedModule.exports,
    filename,
    dirname(filename),
  );
  return loadedModule.exports;
}

const mapping = loadTypeScriptModule(
  "app/dashboard/orders/_lib/order-edit-mapping.ts",
);

function savedItem(overrides = {}) {
  return {
    batch_type_snapshot: null,
    breed_description_snapshot: null,
    breed_display_name_snapshot: "Saved item",
    custom_inventory_label_snapshot: null,
    custom_item_name_snapshot: null,
    equipment_inventory_item_id: null,
    fulfilled_quantity: 0,
    hatching_egg_inventory_item_id: null,
    inventory_item_id: null,
    inventory_type_snapshot: null,
    item_category_snapshot: null,
    item_name_snapshot: null,
    order_item_id: "order-item-1",
    order_item_source: null,
    processed_poultry_inventory_item_id: null,
    product_type_snapshot: null,
    quantity: 2,
    remaining_unfulfilled_quantity: 2,
    species_name_snapshot: null,
    unit_price_snapshot: 4,
    ...overrides,
  };
}

test("saved structured lines use canonical category labels", () => {
  const cases = [
    {
      category: "poultry",
      detail: /^Live Birds/,
      row: savedItem({
        inventory_item_id: "live-1",
        inventory_type_snapshot: "female",
        order_item_source: "listing_inventory",
      }),
    },
    {
      category: "hatching_eggs",
      detail: /^Hatching Eggs/,
      row: savedItem({
        hatching_egg_inventory_item_id: "egg-1",
        item_name_snapshot: "Chicken hatching eggs",
        order_item_source: "hatching_egg_inventory",
      }),
    },
    {
      category: "processed_poultry",
      detail: /^Poultry Products/,
      row: savedItem({
        item_name_snapshot: "Meat & Broth",
        order_item_source: "processed_poultry_inventory",
        processed_poultry_inventory_item_id: "product-1",
      }),
    },
    {
      category: "equipment",
      detail: /^Equipment & Supplies/,
      row: savedItem({
        equipment_inventory_item_id: "equipment-1",
        item_name_snapshot: "Egg basket",
        order_item_source: "equipment_inventory",
      }),
    },
  ];

  for (const { category, detail, row } of cases) {
    const result = mapping.mapEditableOrderItemsToLines([row]);
    assert.equal(result.gaps.length, 0);
    assert.equal(result.lines[0].savedItemCategory, category);
    assert.match(result.lines[0].savedItemDetail, detail);
  }
});

test("saved custom lines remain custom even when names contain category words", () => {
  const result = mapping.mapEditableOrderItemsToLines([
    savedItem({
      breed_display_name_snapshot: null,
      custom_item_name_snapshot: "Egg product consultation",
      order_item_source: "custom",
    }),
  ]);

  assert.equal(result.gaps.length, 0);
  assert.equal(result.lines[0].type, "custom");
  assert.equal(result.lines[0].customItemName, "Egg product consultation");
});

test("saved rows with missing source use explicit inventory IDs", () => {
  const result = mapping.mapEditableOrderItemsToLines([
    savedItem({
      equipment_inventory_item_id: "equipment-legacy",
      item_category_snapshot: "Brooders",
      item_name_snapshot: "Legacy brooder",
    }),
  ]);

  assert.equal(result.gaps.length, 0);
  assert.equal(result.lines[0].inventoryItemType, "equipment_inventory");
  assert.equal(result.lines[0].savedItemCategory, "equipment");
  assert.match(result.lines[0].savedItemDetail, /^Equipment & Supplies/);
});
