import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
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

const inventory = loadTypeScriptModule(
  "app/dashboard/orders/_lib/order-form-inventory.ts",
);

test("uses the four canonical inventory category labels", () => {
  assert.equal(inventory.formatInventoryCategoryLabel("poultry"), "Live Birds");
  assert.equal(
    inventory.formatInventoryCategoryLabel("hatching_eggs"),
    "Hatching Eggs",
  );
  assert.equal(
    inventory.formatInventoryCategoryLabel("processed_poultry"),
    "Poultry Products",
  );
  assert.equal(
    inventory.formatInventoryCategoryLabel("equipment"),
    "Equipment & Supplies",
  );
});

test("New Order and Browse Inventory metadata are category-first", () => {
  const item = inventory.normalizeHatchingEggInventoryRow({
    hatching_egg_inventory_item_id: "egg-1",
    item_name: "Blue Eggs",
    species_name: "Chickens",
    description: "A deliberately long description",
    quantity_available: 12,
    price: 6,
    available_date: "2026-08-15",
    minimum_order_quantity: 6,
    visibility_status: "active",
    moderation_status: "normal",
    operational_availability_status: "coming_soon",
  });

  const expected = "Hatching Eggs · Chickens · Available Aug 15, 2026";
  assert.equal(inventory.formatInventoryMetadata(item), expected);
  assert.equal(inventory.formatBrowseInventoryMetadata(item), expected);
  assert.doesNotMatch(expected, /deliberately long description/);
});

test("Poultry Products put product type before species metadata", () => {
  const item = inventory.normalizeProcessedPoultryInventoryRow({
    processed_poultry_inventory_item_id: "product-1",
    product_name: "Farm Fresh Chicken Eggs",
    poultry_type: "Chicken",
    product_type: "Eating Eggs",
    package_size: "1 dozen carton",
    quantity_available: 18,
    price: 4,
    visibility_status: "active",
    moderation_status: "normal",
    operational_availability_status: "ready_now",
  });

  assert.equal(
    inventory.formatInventoryMetadata(item),
    "Poultry Products · Eating Eggs · Chicken · 1 dozen carton",
  );
});

test("storefront cards use canonical eyebrows and preserve secondary metadata", () => {
  const mapperSource = readFileSync(
    resolve(root, "app/store/[slug]/storefront-listing-cards.ts"),
    "utf8",
  );
  const cardSource = readFileSync(
    resolve(root, "app/store/[slug]/storefront-listing-tabs.tsx"),
    "utf8",
  );

  assert.match(mapperSource, /typeLabel: "Poultry Products"/);
  assert.match(mapperSource, /typeLabel: "Equipment & Supplies"/);
  assert.match(mapperSource, /\? "Hatching Eggs"\s*: "Live Birds"/);
  assert.match(cardSource, /\{card\.typeLabel\}/);
  assert.match(cardSource, /\{card\.meta\}/);
  assert.match(cardSource, /\[card\.title, card\.description, card\.meta\]/);
  assert.match(cardSource, /card\.speciesFilter \?\? card\.meta/);
});

test("product details use canonical primary labels and retain secondary metadata", () => {
  const sharedProduct = readFileSync(
    resolve(root, "app/store/[slug]/products/[productId]/page.tsx"),
    "utf8",
  );
  const processedProduct = readFileSync(
    resolve(
      root,
      "app/store/[slug]/processed-poultry/[processedPoultryItemId]/page.tsx",
    ),
    "utf8",
  );
  const equipmentProduct = readFileSync(
    resolve(root, "app/store/[slug]/equipment/[equipmentItemId]/page.tsx"),
    "utf8",
  );

  assert.match(
    sharedProduct,
    /isHatchingEggProduct \? "Hatching Eggs" : "Live Birds"/,
  );
  assert.match(sharedProduct, /\{product\.speciesName\}/);
  assert.match(processedProduct, /Poultry Products/);
  assert.match(
    processedProduct,
    /\[item\.product_type, item\.poultry_type, item\.package_size\]/,
  );
  assert.match(equipmentProduct, /Equipment & Supplies/);
  assert.match(equipmentProduct, /\[item\.category, item\.condition/);
});

test("seller mobile Hatching Eggs subtitle is category-first", () => {
  const source = readFileSync(
    resolve(root, "app/dashboard/inventory/inventory-management.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /return \[item\.typeSex, item\.species\]\.filter\(Boolean\)\.join\(" · "\)/,
  );
});
