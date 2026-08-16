import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const migrationPath =
  "supabase/migrations/20260729230000_remove_live_bird_batch_media_owners.sql";
const legacyOwnerPattern = /["']listing_batch(?:_breed)?["']/;

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

test("Live Birds v2 keeps breed photos on profiles and option photos on inventory rows", () => {
  const page = read("app/dashboard/inventory/add-v2/live-birds/page.tsx");
  const photoControls = read(
    "app/dashboard/inventory/add-v2/live-birds/BirdOfferingsCard.tsx",
  );

  assert.doesNotMatch(page, legacyOwnerPattern);
  assert.doesNotMatch(photoControls, legacyOwnerPattern);
  assert.match(page, /\.eq\("entity_type", "seller_breed_profile"\)/);
  assert.match(page, /\.eq\("entity_type", "inventory_item"\)/);
  assert.match(photoControls, /entityType="seller_breed_profile"/);
  assert.match(photoControls, /EntryPhotoControl/);
});

test("public Live Birds product detail uses only the breed profile gallery", () => {
  const source = read("app/store/[slug]/products/[productId]/page.tsx");

  assert.doesNotMatch(source, legacyOwnerPattern);
  assert.match(source, /entityType: "seller_breed_profile"/);
  assert.match(source, /entity_type: "resolved_product"/);
  assert.match(source, /public_url: product\.imageUrl/);
});

test("seller order detail retains inventory then breed profile media fallback", () => {
  const source = read("app/dashboard/orders/[orderId]/order-detail.tsx");
  const fallback = source.slice(source.indexOf("function getItemMediaEntityKeys"));

  assert.doesNotMatch(source, legacyOwnerPattern);
  assert.ok(
    fallback.indexOf('{ type: "inventory_item"') <
      fallback.indexOf('{ type: "seller_breed_profile"'),
  );
});

test("ListingPhotosSection requires an explicit retained owner", () => {
  const source = read(
    "app/dashboard/listings/[listingBatchId]/listing-photos-section.tsx",
  );

  assert.doesNotMatch(source, legacyOwnerPattern);
  assert.match(source, /entityType: PhotoEntityType;/);
  assert.doesNotMatch(source, /entityType\s*=\s*"/);
  for (const owner of [
    "inventory_item",
    "seller_breed_profile",
    "equipment_inventory_item",
    "processed_poultry_inventory_item",
    "hatching_egg_inventory_item",
  ]) {
    assert.match(source, new RegExp(`\\| "${owner}"`));
  }
});

test("every ListingPhotosSection caller supplies an explicit retained owner", () => {
  const callerSources = [
    "app/dashboard/_components/processed-poultry-photos.tsx",
    "app/dashboard/_components/equipment-photos.tsx",
    "app/dashboard/breeds/breed-detail.tsx",
    "app/dashboard/inventory/add-v2/live-birds/BirdOfferingsCard.tsx",
    "app/dashboard/listings/new/processed-poultry/poultry-products-one-page-form.tsx",
    "app/dashboard/listings/new/equipment-supplies/equipment-supplies-one-page-form.tsx",
    "app/dashboard/listings/new/birds/hatching-eggs-standalone/hatching-eggs-standalone-one-page-form.tsx",
  ].map(read);

  for (const source of callerSources) {
    assert.match(source, /<ListingPhotosSection[\s\S]*?entityType=/);
    assert.doesNotMatch(source, legacyOwnerPattern);
  }
});

test("upload boundary rejects legacy owners before storage or database activity", () => {
  const source = read("supabase/functions/seller-media-upload/index.ts");
  const rejectionIndex = source.indexOf("if (!ALLOWED_ENTITY_TYPES.has(entityType))");
  const storageIndex = source.indexOf(".upload(storagePath, bytes");
  const rpcIndex = source.indexOf('.rpc("seller_create_uploaded_media"');

  assert.ok(rejectionIndex > 0);
  assert.ok(rejectionIndex < storageIndex);
  assert.ok(rejectionIndex < rpcIndex);
  assert.doesNotMatch(
    source.slice(
      source.indexOf("const ALLOWED_ENTITY_TYPES"),
      source.indexOf("type PublicErrorCode"),
    ),
    legacyOwnerPattern,
  );
  for (const owner of [
    "store",
    "seller_breed_profile",
    "inventory_item",
    "equipment_inventory_item",
    "processed_poultry_inventory_item",
    "hatching_egg_inventory_item",
  ]) {
    assert.match(source, new RegExp(`"${owner}"`));
  }
});

test("forward migration removes legacy links and owner authorization", () => {
  const migration = read(migrationPath);
  const constraintSection = migration.slice(
    migration.indexOf("add constraint media_links_entity_type_check"),
    migration.indexOf("create or replace function public.validate_seller_media_entity"),
  );
  const validatorSection = migration.slice(
    migration.indexOf("create or replace function public.validate_seller_media_entity"),
    migration.indexOf("create or replace view public.public_storefront_breed_inventory"),
  );

  assert.match(
    migration,
    /delete from public\.media_links\s+where media_links\.entity_type in \('listing_batch', 'listing_batch_breed'\)/,
  );
  assert.doesNotMatch(constraintSection, legacyOwnerPattern);
  assert.doesNotMatch(validatorSection, legacyOwnerPattern);
  assert.doesNotMatch(migration, /delete from public\.media_assets/);
});

test("storefront migration uses retained precedence and gallery branches", () => {
  const migration = read(migrationPath);
  const inventoryView = migration.slice(
    migration.indexOf("create or replace view public.public_storefront_breed_inventory"),
    migration.indexOf("create or replace view public.public_storefront_media_gallery"),
  );
  const galleryView = migration.slice(
    migration.indexOf("create or replace view public.public_storefront_media_gallery"),
  );

  assert.match(
    inventoryView,
    /coalesce\(\s*inventory_media\.image_url,\s*breed_profile_media\.image_url,\s*store_media\.image_url\s*\)/,
  );
  assert.doesNotMatch(inventoryView, /batch_(?:breed_)?media/);
  assert.doesNotMatch(galleryView, legacyOwnerPattern);
  for (const owner of [
    "store",
    "seller_breed_profile",
    "inventory_item",
    "equipment_inventory_item",
    "hatching_egg_inventory_item",
  ]) {
    assert.match(galleryView, new RegExp(`'${owner}'`));
  }
});

test("Breed Library photo management remains on seller breed profiles", () => {
  const detail = read("app/dashboard/breeds/breed-detail.tsx");
  const management = read("app/dashboard/breeds/breeds-management.tsx");

  assert.match(detail, /entityType="seller_breed_profile"/);
  assert.match(
    management,
    /entityType: "seller_breed_profile"/,
  );
  assert.match(
    management,
    /p_entity_type: "seller_breed_profile"/,
  );
});

test("storefront cards continue to prefer seller breed profile media", () => {
  const source = read("app/store/[slug]/storefront-data.ts");

  assert.match(source, /\.eq\("entity_type", "seller_breed_profile"\)/);
  assert.match(
    source,
    /imageUrl: profileImage\?\.imageUrl \?\? first\.featured_image_url/,
  );
});

test("realistic local seed data uses retained media owners", () => {
  const source = read("scripts/seed-realistic-test-data.sql");

  assert.doesNotMatch(source, legacyOwnerPattern);
  assert.match(source, /'seller_breed_profile'/);
  assert.match(source, /'inventory_item'/);
});
