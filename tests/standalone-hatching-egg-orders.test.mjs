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
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
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

const inventoryModule = loadTypeScriptModule(
  "app/dashboard/orders/_lib/order-form-inventory.ts",
);
const editMappingModule = loadTypeScriptModule(
  "app/dashboard/orders/_lib/order-edit-mapping.ts",
);
const storefrontModule = loadTypeScriptModule(
  "app/store/[slug]/storefront-data.ts",
);

const standaloneEgg = {
  hatching_egg_inventory_item_id: "egg-1",
  item_name: "Blue Ameraucana Eggs",
  species_name: "Chicken",
  description: "Blue-shell hatching eggs",
  quantity_available: 12,
  price: 6.5,
  available_date: "2026-08-15",
  minimum_order_quantity: 6,
  visibility_status: "hidden",
  moderation_status: "normal",
  operational_availability_status: "coming_soon",
};

test("normalizes standalone hatching eggs to the shared inventory shape", () => {
  const row = inventoryModule.normalizeHatchingEggInventoryRow(standaloneEgg);

  assert.equal(row.itemType, "hatching_egg_inventory");
  assert.equal(row.category, "hatching_eggs");
  assert.equal(row.id, "egg-1");
  assert.equal(row.title, standaloneEgg.item_name);
  assert.match(row.detailLabel, /Chicken/);
  assert.doesNotMatch(row.detailLabel, /Blue-shell hatching eggs/);
  assert.equal(row.quantity_available, 12);
  assert.equal(row.effective_unit_price, 6.5);
  assert.equal(row.operational_availability_status, "coming_soon");
  assert.equal(row.available_date, "2026-08-15");
  assert.equal(row.minimum_order_quantity, 6);
});

test("shows standalone eggs only in All and Hatching eggs", () => {
  const row = inventoryModule.normalizeHatchingEggInventoryRow(standaloneEgg);

  assert.deepEqual(
    inventoryModule.getBrowseInventoryRows([row], "all", "").map((item) => item.id),
    ["egg-1"],
  );
  assert.deepEqual(
    inventoryModule
      .getBrowseInventoryRows([row], "hatching_eggs", "")
      .map((item) => item.id),
    ["egg-1"],
  );
  for (const category of ["poultry", "processed_poultry", "equipment"]) {
    assert.deepEqual(
      inventoryModule.getBrowseInventoryRows([row], category, ""),
      [],
    );
  }
});

test("does not offer zero-quantity standalone eggs", () => {
  const row = inventoryModule.normalizeHatchingEggInventoryRow({
    ...standaloneEgg,
    quantity_available: 0,
  });
  assert.deepEqual(inventoryModule.getBrowseInventoryRows([row], "all", ""), []);
});

test("storefront purchase options preserve the public view can_checkout value", () => {
  const storefrontEgg = {
    store_id: "store-1",
    store_slug: "test-store",
    hatching_egg_inventory_item_id: "egg-1",
    item_type: "hatching_egg_inventory",
    hatching_egg_product_id: "he-1",
    normalized_item_name: "blue ameraucana eggs",
    item_name: "Blue Ameraucana Eggs",
    species_id: "species-1",
    species_name: "Chicken",
    species_slug: "chicken",
    description: "Blue-shell hatching eggs",
    quantity_available: 12,
    buyer_availability_code: "ready_now",
    buyer_availability_label: "Ready now",
    available_date: "2026-08-15",
    is_available_now: true,
    can_checkout: false,
    unit_price: 6.5,
    minimum_order_quantity: 6,
    featured_image_url: null,
    featured_image_alt_text: null,
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z",
  };

  assert.equal(
    storefrontModule.toHatchingEggPurchaseOption(storefrontEgg).canCheckout,
    false,
  );
  assert.equal(
    storefrontModule.toHatchingEggPurchaseOption({
      ...storefrontEgg,
      can_checkout: true,
      quantity_available: 6,
    }).canCheckout,
    true,
  );
});

test("uses the standalone hatching egg payload type", () => {
  assert.equal(
    inventoryModule.getManualOrderPayloadItemType({
      inventoryItemType: "hatching_egg_inventory",
    }),
    "hatching_egg_inventory",
  );
});

test("maps saved standalone egg lines back to the standalone reference", () => {
  const result = editMappingModule.mapEditableOrderItemsToLines([
    {
      order_item_id: "line-1",
      inventory_item_id: null,
      equipment_inventory_item_id: null,
      processed_poultry_inventory_item_id: null,
      hatching_egg_inventory_item_id: "egg-1",
      species_name_snapshot: "Chicken",
      breed_description_snapshot: "Blue-shell hatching eggs",
      breed_display_name_snapshot: "Blue Ameraucana Eggs",
      inventory_type_snapshot: "hatching_eggs",
      custom_inventory_label_snapshot: null,
      order_item_source: "hatching_egg_inventory",
      custom_item_name_snapshot: null,
      product_type_snapshot: "hatching_eggs",
      item_name_snapshot: "Blue Ameraucana Eggs",
      item_category_snapshot: "Chicken",
      unit_price_snapshot: 6.5,
      quantity: 6,
    },
  ]);

  assert.deepEqual(result.gaps, []);
  assert.equal(result.lines[0].inventoryItemType, "hatching_egg_inventory");
  assert.equal(result.lines[0].inventoryItemId, "egg-1");
  assert.equal(result.lines[0].savedItemCategory, "hatching_eggs");
});

test("seller loaders enforce store, archive, and moderation filters", () => {
  for (const relativePath of [
    "app/dashboard/orders/new/new-manual-order.tsx",
    "app/dashboard/orders/[orderId]/edit/edit-order.tsx",
  ]) {
    const source = readFileSync(resolve(root, relativePath), "utf8");
    assert.match(source, /\.from\("seller_hatching_egg_inventory_management"\)/);
    assert.match(source, /\.eq\("store_id", seller\.store_id\)/);
    assert.match(source, /\.neq\("visibility_status", "archived"\)/);
    assert.match(source, /\.eq\("moderation_status", "normal"\)/);
  }
});

test("create RPC locks, validates, snapshots, and deducts standalone eggs", () => {
  const source = readFileSync(
    resolve(
      root,
      "supabase/migrations/20260728220000_manual_order_standalone_hatching_eggs.sql",
    ),
    "utf8",
  );
  assert.match(source, /for update of hatching_items/);
  assert.match(source, /hatching_items\.store_id = p_store_id/);
  assert.match(source, /hatching_items\.visibility_status = 'archived'/);
  assert.match(source, /hatching_items\.moderation_status <> 'normal'/);
  assert.match(source, /requested_quantity > locked\.quantity_available/);
  assert.match(source, /minimum_order_quantity/);
  assert.match(source, /hatching_egg_inventory_item_id/);
  assert.match(source, /update public\.hatching_egg_inventory_items/);
});

test("edit RPC uses standalone references for deduction and restoration", () => {
  const source = readFileSync(
    resolve(
      root,
      "supabase/migrations/20260728221000_edit_order_standalone_hatching_eggs.sql",
    ),
    "utf8",
  );
  assert.match(
    source,
    /order_items\.hatching_egg_inventory_item_id/,
  );
  assert.match(source, /for update/);
  assert.match(source, /v_new_quantity := v_old_quantity - v_record\.quantity_delta/);
  assert.match(source, /update public\.hatching_egg_inventory_items/);
  assert.match(source, /Insufficient hatching egg quantity available/);
});
