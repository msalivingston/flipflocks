import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

function loadModule(path) {
  const file = resolve(import.meta.dirname, path);
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name) => name === "@/lib/bird-age"
      ? { formatBirdAgeInDays: (days) => `${Math.floor(days / 7)} weeks old` }
      : {},
    loaded, loaded.exports,
  );
  return loaded.exports;
}

const { groupLiveBirdPurchaseOptions } = loadModule("storefront-data.ts");
const cart = loadModule("_components/storefront-cart-client.ts");

const base = {
  store_id: "store-1", species_id: "species-1", seller_breed_profile_id: "breed-1",
  listing_batch_id: "batch-1", listing_batch_breed_id: "batch-breed-1",
  batch_type: "live_animals", inventory_type: "female", custom_inventory_label: null,
  origin_date: "2026-05-01", available_date: "2026-10-01", age_at_availability_days: 153,
  buyer_availability_code: "ready_now", buyer_availability_label: "Ready now",
  can_checkout: true, unit_price: 16, breeding_history: "never_bred",
  feather_condition: "excellent", featured_image_url: "/bird.jpg",
  featured_image_alt_text: "Bird", entry_photo_url: "/lot.jpg", entry_photo_alt: "Lot",
  inventory_sort_order: 0, quantity_available: 46, inventory_item_id: "barn-1",
};

test("identical records display one 98-bird option", () => {
  const options = groupLiveBirdPurchaseOptions([
    base, { ...base, inventory_item_id: "barn-2", inventory_sort_order: 1, quantity_available: 52 },
  ]);
  assert.equal(options.length, 1);
  assert.equal(options[0].quantityAvailable, 98);
  assert.equal(options[0].unitPrice, 16);
  assert.deepEqual(options[0].sourceInventoryItemIds, ["barn-1", "barn-2"]);
});

for (const [name, change] of Object.entries({
  photo: { entry_photo_url: "/other.jpg" },
  featuredPhoto: { featured_image_url: "/other.jpg" },
  price: { unit_price: 17 },
  hatchDate: { origin_date: "2026-05-02" },
  availableDate: { available_date: "2026-10-02" },
  sex: { inventory_type: "male" },
  availability: { buyer_availability_code: "reserve_now" },
  breeding: { breeding_history: "previously_bred" },
  feathers: { feather_condition: "good" },
  batch: { listing_batch_id: "batch-2" },
  batchBreed: { listing_batch_breed_id: "batch-breed-2" },
  label: { custom_inventory_label: "Special" },
})) {
  test(`${name} difference prevents grouping`, () => {
    assert.equal(groupLiveBirdPurchaseOptions([
      base, { ...base, ...change, inventory_item_id: "other" },
    ]).length, 2);
  });
}

test("group cart stays one line and respects the combined displayed limit", () => {
  const saved = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
    dispatchEvent: () => {},
  };
  globalThis.CustomEvent = class {};
  const item = {
    itemType: "listing_inventory_group", itemId: "barn-1", inventoryItemId: "barn-1",
    productId: "breed-1", productName: "Layers", speciesName: "Chicken",
    optionLabel: "Female", ageLabel: "25 weeks old", typeLabel: "Female",
    availableDate: "2026-10-01", quantityAvailable: 98, unitPrice: 16,
    imageUrl: null, quantity: 60,
  };
  cart.addItemsToStorefrontCart("test", [item]);
  const result = cart.addItemsToStorefrontCart("test", [{ ...item, quantity: 50 }]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].itemType, "listing_inventory_group");
  assert.equal(result.items[0].quantity, 98);
  delete globalThis.window;
  delete globalThis.CustomEvent;
});
