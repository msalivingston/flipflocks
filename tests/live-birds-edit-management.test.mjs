import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../app/dashboard/inventory/add-v2/live-birds/page.tsx", import.meta.url),
  "utf8",
);
const offerings = await readFile(
  new URL("../app/dashboard/inventory/add-v2/live-birds/BirdOfferingsCard.tsx", import.meta.url),
  "utf8",
);
const entryPhoto = await readFile(
  new URL("../app/dashboard/inventory/add-v2/live-birds/EntryPhotoControl.tsx", import.meta.url),
  "utf8",
);

test("Edit queues permanent removal and uses the historically safe delete RPC on Save", () => {
  assert.match(page, /pendingRemovedOfferings/);
  assert.match(offerings, /Will be permanently removed when you save/);
  assert.match(page, /undoPendingRemoval/);
  assert.match(page, /seller_delete_inventory_entries/);
  assert.match(page, /p_inventory_item_ids: inventoryItemIdsToDelete/);
  assert.match(page, /p_equipment_inventory_item_ids: \[\]/);
});

test("sold out remains distinct from permanent removal", () => {
  assert.doesNotMatch(offerings, /Mark sold out/);
  assert.match(offerings, /soldOut \? "Sold Out"/);
  assert.match(offerings, /allowSoldOut/);
  assert.match(offerings, />\s*Remove\s*</);
  assert.match(page, /allowZeroQuantity: isEditMode/);
  assert.match(page, /quantity < \(allowZeroQuantity \? 0 : 1\)/);
});

test("Edit shows live and pending age and storefront price context", () => {
  assert.match(page, /Current age today/);
  assert.match(page, /After saving/);
  assert.match(page, /calculateCurrentListingPrice/);
  assert.match(page, /getEditChangeSummaries/);
  assert.match(page, /unsaved change/);
});

test("pending removal stays inline and mobile Edit retains its prior flow", () => {
  assert.match(offerings, /function RemovedOfferingRow/);
  assert.match(offerings, /Will be permanently removed when you save/);
  assert.doesNotMatch(page, /Pending permanent removal/);
  assert.match(page, /if \(isEditMode\) return null/);
  assert.doesNotMatch(page, /Manage live listing/);
});

test("successful save installs a fresh baseline and clears completed pending media", () => {
  assert.match(page, /updateSnapshot: true/);
  assert.match(page, /setSavedFormSnapshot/);
  assert.match(page, /setEditBaseline/);
  assert.match(page, /pendingEntryPhotosRef\.current = \{\}/);
  assert.match(page, /setPendingEntryPhotos\(\{\}\)/);
});

test("sticky Save reuses the dashboard bottom bar and follows the actual dirty state", () => {
  assert.match(page, /isEditMode && hasMeaningfulUnsavedChanges \? \(/);
  assert.match(page, /function EditStickySaveBar/);
  assert.match(page, /fixed inset-x-0 bottom-0 z-40 border-t border-amber-200/);
  assert.match(page, /pb-32 sm:pb-28/);
  assert.match(page, /onUndo=\{undoEditChanges\}/);
  assert.match(page, />\s*Undo Changes\s*</);
  assert.match(page, /hasUnsavedSavedEntryPhotoChanges/);
  assert.match(page, /setHasUnsavedSavedEntryPhotoChanges\(true\)/);
  assert.match(page, /setHasUnsavedSavedEntryPhotoChanges\(false\)/);
});

test("Undo Changes restores the saved Edit baseline", () => {
  assert.match(page, /function undoEditChanges\(\)/);
  assert.match(page, /setOfferings\(editBaseline\.offerings\)/);
  assert.match(page, /setPendingRemovedOfferings\(\[\]\)/);
  assert.match(page, /setHatchDate\(editBaseline\.hatchDate\)/);
  assert.match(page, /setPriceAdjustment\(editBaseline\.priceAdjustment\)/);
  assert.match(page, /URL\.revokeObjectURL\(photo\.previewUrl\)/);
});

test("bird entry current state uses compact labeled metrics", () => {
  assert.match(offerings, /<dl className="grid gap-2/);
  assert.match(offerings, /label="Current age"/);
  assert.match(offerings, /label="Starting price"/);
  assert.match(offerings, /label="Storefront price"/);
  assert.match(offerings, /now \\u2192 \$\{editPriceSummary\.after\} after save/);
  assert.match(
    offerings,
    /editPriceSummary\.after !== editPriceSummary\.current/,
  );
  assert.doesNotMatch(offerings, /Current starting price:/);
  assert.doesNotMatch(offerings, /Current storefront price:/);
});

test("collapsed mobile bird entry gives breed and sex content the full row", () => {
  assert.match(offerings, /basis-full items-start gap-3 text-left sm:flex-1 sm:basis-auto/);
  assert.match(offerings, /flex min-w-0 flex-1 flex-col gap-0\.5/);
  assert.match(offerings, /ml-auto flex items-center gap-2 sm:hidden/);
  assert.doesNotMatch(offerings, /mobileSummary\.lineOne/);
  assert.doesNotMatch(offerings, /\$\{breed\} - \$\{soldAs\}/);
  assert.doesNotMatch(offerings, /return \[\s*breed,\s*soldAs,/);
});

test("sold history disables Remove while retaining the database guard", () => {
  assert.match(page, /loadInventoryRemovalBlockedIds/);
  assert.match(page, /seller_order_item_detail/);
  assert.match(page, /seller_order_management/);
  assert.match(page, /orderStatus !== "canceled"/);
  assert.match(offerings, /removeBlockedInventoryItemIds/);
  assert.match(offerings, /Why this entry cannot be removed/);
  assert.match(offerings, /This entry can’t be removed because birds from it have already been sold/);
  assert.match(page, /seller_delete_inventory_entries/);
});

test("mobile entry-photo guidance is compact and disclosed accessibly", () => {
  assert.match(entryPhoto, /className="sm:hidden"/);
  assert.match(entryPhoto, /Photo of These Birds/);
  assert.match(entryPhoto, />Optional</);
  assert.match(entryPhoto, /aria-label="About entry photos"/);
  assert.match(
    entryPhoto,
    /product details representing the bird or birds in this specific entry/,
  );
  assert.match(entryPhoto, /hidden text-lg font-semibold text-stone-900 sm:block/);
});

test("desktop entry-photo explanation is hidden behind an accessible disclosure", () => {
  assert.match(entryPhoto, /<details className="group mt-1 hidden sm:block">/);
  assert.match(entryPhoto, /More information about listing photos\./);
  assert.equal(
    (entryPhoto.match(/Your storefront automatically groups all birds/g) ?? [])
      .length,
    2,
    "desktop and mobile disclosures should use the same explanation",
  );
  assert.doesNotMatch(
    entryPhoto,
    /<p className="hidden text-sm leading-5 text-stone-500 sm:block">/,
  );
});

test("Edit separates configured Starting Price from calculated storefront price", () => {
  assert.match(offerings, /label=\{isEditMode \? "Starting price"/);
  assert.doesNotMatch(offerings, /Starting\/base price/);
  assert.doesNotMatch(page, /function EditPricingContext/);
  assert.match(page, /calculateCurrentListingPrice/);
  assert.match(page, /row\.price_override \?\? row\.base_price/);
});

test("Edit Automatic Price Changes omits the range helper bar", () => {
  assert.doesNotMatch(page, /function EditPricingContext/);
  assert.doesNotMatch(page, /Current adjustment:/);
  assert.doesNotMatch(page, /Next adjustment:/);
});

test("Edit retains the shared entry-photo component for all stores", () => {
  assert.doesNotMatch(page, /sunshineMesaFarmStoreId|entryPhotoPilotEnabled/);
  assert.doesNotMatch(offerings, /Sunshine Mesa Farm|entryPhotoPilotEnabled/);
  assert.match(offerings, /<EntryPhotoControl/);
  assert.match(page, /uploadPendingEntryPhotos/);
});

test("Edit introduction explains saving and returning to inventory", () => {
  assert.match(page, /Update your listing details below\./);
  assert.match(page, /Each time you save, your storefront listing updates automatically\./);
  assert.match(page, /When you’re finished, click Return to Inventory\./);
  assert.equal((page.match(/Return to Inventory/g) ?? []).length, 3);
});
