import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("live-bird entry photo migration limits only live inventory image gallery links", () => {
  const migration = read(
    "supabase/migrations/20260821090000_live_bird_inventory_entry_photos.sql",
  );

  assert.match(migration, /batch_type = 'live_animals'/);
  assert.match(migration, /entity_type <> 'inventory_item'/);
  assert.match(migration, /display_context <> 'gallery'/);
  assert.match(migration, /content_type like 'image\/%'/);
  assert.match(migration, /visibility_status = 'archived'/);
  assert.doesNotMatch(migration, /unique \(entity_type, entity_id\)/);
});

test("entry photo projection is inventory-only and preserves general fallback", () => {
  const migration = read(
    "supabase/migrations/20260821090000_live_bird_inventory_entry_photos.sql",
  );

  assert.match(migration, /inventory_media\.image_url as entry_photo_url/);
  assert.match(migration, /inventory_media\.alt_text as entry_photo_alt/);
  assert.match(migration, /seller_breed_profiles\.breed_category/);
  assert.doesNotMatch(migration, /seller_breed_profiles\.bird_type/);
  assert.match(
    migration,
    /coalesce\(inventory_media\.image_url, breed_profile_media\.image_url, store_media\.image_url\) as featured_image_url/,
  );
  assert.doesNotMatch(migration, /coalesce\([^)]*entry_photo_url/);
});

test("seller entry cards retain pending photos locally until the matching inventory row exists", () => {
  const page = read("app/dashboard/inventory/add-v2/live-birds/page.tsx");
  const card = read(
    "app/dashboard/inventory/add-v2/live-birds/BirdOfferingsCard.tsx",
  );
  const control = read(
    "app/dashboard/inventory/add-v2/live-birds/EntryPhotoControl.tsx",
  );

  assert.match(card, /entryMediaItemsByInventoryItemId/);
  assert.match(control, /entityType: "inventory_item"/);
  assert.match(control, /onPendingPhotoChange/);
  assert.match(control, /onPendingPhotoRemove/);
  assert.match(page, /pendingEntryPhotos/);
  assert.match(page, /URL\.createObjectURL/);
  assert.match(page, /URL\.revokeObjectURL/);
  assert.match(page, /uploadPendingEntryPhotos/);
  assert.match(page, /getOfferingPersistenceKey/);
  assert.match(control, /archiveSellerPhoto/);
});

test("pending entry photos can match rows after either draft save or direct publish", () => {
  const page = read("app/dashboard/inventory/add-v2/live-birds/page.tsx");
  const uploadPendingStart = page.indexOf("async function uploadPendingEntryPhotos");
  const saveDraftStart = page.indexOf("async function saveDraftFromCurrentForm");
  const uploadPendingSource = page.slice(uploadPendingStart, saveDraftStart);

  assert.ok(uploadPendingStart >= 0);
  assert.ok(saveDraftStart > uploadPendingStart);
  assert.match(uploadPendingSource, /loadListingRows\(\{[\s\S]*?mode: "edit"/);
  assert.doesNotMatch(uploadPendingSource, /mode: "create"/);
});

test("only Sunshine Mesa Farm receives the seller entry-photo pilot control", () => {
  const page = read("app/dashboard/inventory/add-v2/live-birds/page.tsx");
  const card = read(
    "app/dashboard/inventory/add-v2/live-birds/BirdOfferingsCard.tsx",
  );

  assert.match(page, /sunshineMesaFarmStoreId = "3017ade8-686d-42de-a802-4208ed7ff6f7"/);
  assert.match(page, /seller\?\.store_id === sunshineMesaFarmStoreId/);
  assert.match(card, /entryPhotoPilotEnabled \? \(/);
  assert.match(card, /Sunshine Mesa Farm production pilot/);
  assert.match(card, /Remove this gate to enable it for all sellers/);
});

test("purchase details conditionally renders inventory-entry photos without affecting eggs", () => {
  const source = read(
    "app/store/[slug]/products/[productId]/product-order-options.tsx",
  );
  const data = read("app/store/[slug]/storefront-data.ts");

  assert.match(source, /!isHatchingEggProduct && visibleOptions\.some/);
  assert.match(source, /showEntryPhotoColumn/);
  assert.match(source, /entryPhotoUrl/);
  assert.match(source, /toPublicImageUrl\(option\.entryPhotoUrl\)/);
  assert.match(source, /src=\{entryPhotoUrl\}/);
  assert.match(source, /url: entryPhotoUrl/);
  assert.doesNotMatch(source, /sunshineMesaFarmStoreId|Sunshine Mesa Farm/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(data, /entryPhotoUrl: item\.entry_photo_url/);
  assert.match(data, /entryPhotoUrl: null/);
});
