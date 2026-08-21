import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Meadowgate checkout is disabled in the UI and both order submission boundaries", async () => {
  const [checkout, payAtPickup, cardCheckout] = await Promise.all([
    read("app/store/[slug]/checkout/checkout-page.tsx"),
    read("supabase/functions/pay-at-pickup-order/handler.ts"),
    read("supabase/functions/stripe-connect-checkout/index.ts"),
  ]);

  assert.match(checkout, /const demoStoreSlug = "meadowgate-poultry"/);
  assert.match(checkout, /Demo store — orders cannot be submitted\./);
  assert.match(checkout, /const activeStepDisabled =[\s\S]*?isDemoStore/);
  assert.match(payAtPickup, /orderRequest\.store_slug === "meadowgate-poultry"/);
  assert.match(cardCheckout, /slug === "meadowgate-poultry"[\s\S]*body\.action === "start"/);
});

test("Live Bird price fields suppress only arrow-key stepping", async () => {
  const [offerings, adjustments, batch] = await Promise.all([
    read("app/dashboard/inventory/add-v2/live-birds/BirdOfferingsCard.tsx"),
    read("app/dashboard/inventory/add-v2/live-birds/AgeBasedPriceChangesCard.tsx"),
    read("app/dashboard/inventory/add-v2/live-birds/batch/page.tsx"),
  ]);

  for (const source of [offerings, adjustments, batch]) {
    assert.match(source, /event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"/);
    assert.match(source, /event\.preventDefault\(\)/);
  }
  assert.match(offerings, /if \(prefix &&/);
  assert.match(adjustments, /if \(label !== "Every" &&/);
  assert.match(batch, /if \(!suffix &&/);
});

test("Inventory age is calculated from hatch date and the Breed Library has a read-only details dialog", async () => {
  const [formatters, inventory, breeds] = await Promise.all([
    read("app/dashboard/_lib/listing-formatters.ts"),
    read("app/dashboard/inventory/inventory-management.tsx"),
    read("app/dashboard/breeds/breeds-management.tsx"),
  ]);

  assert.match(formatters, /export function calculateCurrentBirdAgeDays/);
  assert.match(inventory, /calculateCurrentBirdAgeDays\(row\.origin_date\)/);
  assert.match(inventory, /Age is calculated from the hatch date and updates daily/);
  assert.match(breeds, /function BreedLibraryDetailsDialog/);
  assert.match(breeds, /role="dialog"/);
  assert.match(breeds, /Egg production/);
  assert.match(breeds, /Egg color/);
  assert.match(breeds, /onAdd=\{\(\) => onAdd\(selectedBreed\)\}/);
  assert.match(breeds, /event\.stopPropagation\(\)/);
});

test("Live Bird save-state copy relies on the disabled button instead of an in-progress message", async () => {
  const source = await read("app/dashboard/inventory/add-v2/live-birds/page.tsx");

  assert.doesNotMatch(source, /Save is already in progress\./);
  assert.match(source, /saveStatus === "saving"\) return null/);
  assert.match(source, /saveDraftStatus === "saving"\) return null/);
});
