import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyOrderItemCategory,
  formatOrderItemCategoryLabel,
} from "./order-item-category.ts";

const structuredCases = [
  {
    expected: "live_birds",
    label: "Live Birds source ignores misleading item text",
    row: {
      order_item_source: "listing_inventory",
      inventory_item_id: "live-1",
      item_name_snapshot: "Egg product equipment bundle",
      inventory_type_snapshot: "female",
    },
  },
  {
    expected: "hatching_eggs",
    label: "Hatching Eggs source ignores misleading item text",
    row: {
      order_item_source: "hatching_egg_inventory",
      hatching_egg_inventory_item_id: "eggs-1",
      item_name_snapshot: "Equipment product",
    },
  },
  {
    expected: "poultry_products",
    label: "Poultry Products source ignores misleading item text",
    row: {
      order_item_source: "processed_poultry_inventory",
      processed_poultry_inventory_item_id: "product-1",
      item_name_snapshot: "Hatching egg incubator",
    },
  },
  {
    expected: "equipment_supplies",
    label: "Equipment source ignores misleading item text",
    row: {
      order_item_source: "equipment_inventory",
      equipment_inventory_item_id: "equipment-1",
      item_name_snapshot: "Egg product carrier",
    },
  },
];

for (const { expected, label, row } of structuredCases) {
  test(label, () => {
    assert.equal(classifyOrderItemCategory(row), expected);
  });
}

test("recognized source wins over conflicting inventory IDs", () => {
  assert.equal(
    classifyOrderItemCategory({
      order_item_source: "equipment_inventory",
      hatching_egg_inventory_item_id: "conflicting-egg-id",
    }),
    "equipment_supplies",
  );
});

test("explicit inventory IDs classify rows with no source", () => {
  assert.equal(
    classifyOrderItemCategory({ inventory_item_id: "live-legacy" }),
    "live_birds",
  );
  assert.equal(
    classifyOrderItemCategory({
      inventory_item_id: "egg-legacy",
      inventory_type_snapshot: "hatching_eggs",
    }),
    "hatching_eggs",
  );
  assert.equal(
    classifyOrderItemCategory({
      hatching_egg_inventory_item_id: "egg-current",
    }),
    "hatching_eggs",
  );
  assert.equal(
    classifyOrderItemCategory({
      processed_poultry_inventory_item_id: "product-current",
    }),
    "poultry_products",
  );
  assert.equal(
    classifyOrderItemCategory({
      equipment_inventory_item_id: "equipment-current",
    }),
    "equipment_supplies",
  );
});

test("legacy inventory source remains a supported Live Birds alias", () => {
  assert.equal(
    classifyOrderItemCategory({
      order_item_source: "inventory",
      inventory_type_snapshot: "straight_run",
    }),
    "live_birds",
  );
});

test("narrow historical snapshot formats classify rows without structured references", () => {
  assert.equal(
    classifyOrderItemCategory({
      batch_type_snapshot: "live_animals",
      inventory_type_snapshot: "female",
      species_name_snapshot: "Chicken",
      breed_display_name_snapshot: "Sussex",
    }),
    "live_birds",
  );
  assert.equal(
    classifyOrderItemCategory({
      inventory_type_snapshot: "Hatching Eggs",
    }),
    "hatching_eggs",
  );
  assert.equal(
    classifyOrderItemCategory({
      product_type_snapshot: "processed_poultry",
    }),
    "poultry_products",
  );
  assert.equal(
    classifyOrderItemCategory({
      product_type_snapshot: "equipment_supplies",
    }),
    "equipment_supplies",
  );
});

test("legacy Processed Poultry label maps to Poultry Products", () => {
  assert.equal(
    classifyOrderItemCategory({
      item_category_snapshot: "Processed Poultry",
    }),
    "poultry_products",
  );
});

test("ambiguous and custom text is never classified from broad keywords", () => {
  assert.equal(
    classifyOrderItemCategory({
      custom_item_name_snapshot: "Egg product consulting",
    }),
    "custom_or_unknown",
  );
  assert.equal(
    classifyOrderItemCategory({
      order_item_source: "custom",
      custom_item_name_snapshot: "Egg carrier product",
    }),
    "custom_or_unknown",
  );
});

test("canonical category labels are shared across all four inventory types", () => {
  assert.equal(formatOrderItemCategoryLabel("live_birds"), "Live Birds");
  assert.equal(formatOrderItemCategoryLabel("hatching_eggs"), "Hatching Eggs");
  assert.equal(
    formatOrderItemCategoryLabel("poultry_products"),
    "Poultry Products",
  );
  assert.equal(
    formatOrderItemCategoryLabel("equipment_supplies"),
    "Equipment & Supplies",
  );
  assert.equal(
    formatOrderItemCategoryLabel("custom_or_unknown"),
    "Custom / Other",
  );
});

test("report-shaped rows use structured source data instead of item-name keywords", () => {
  const reportRows = structuredCases.map(({ expected, row }) => ({
    expected,
    row: {
      batch_type_snapshot: null,
      equipment_inventory_item_id: null,
      hatching_egg_inventory_item_id: null,
      inventory_item_id: null,
      item_category_snapshot: null,
      processed_poultry_inventory_item_id: null,
      product_type_snapshot: null,
      ...row,
    },
  }));

  for (const { expected, row } of reportRows) {
    assert.equal(classifyOrderItemCategory(row), expected);
  }
});
