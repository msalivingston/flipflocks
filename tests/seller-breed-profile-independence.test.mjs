import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../supabase/migrations/20260818120000_seller_breed_profile_independent_snapshots.sql",
  ),
  "utf8",
);
const birdTypeRemovalMigration = readFileSync(
  resolve(
    import.meta.dirname,
    "../supabase/migrations/20260818132000_remove_legacy_bird_type.sql",
  ),
  "utf8",
);
const breedData = readFileSync(
  resolve(import.meta.dirname, "../app/dashboard/breeds/breed-data.ts"),
  "utf8",
);
const breedManagement = readFileSync(
  resolve(import.meta.dirname, "../app/dashboard/breeds/breeds-management.tsx"),
  "utf8",
);
const inventoryForm = readFileSync(
  resolve(
    import.meta.dirname,
    "../app/dashboard/inventory/add-v2/live-birds/page.tsx",
  ),
  "utf8",
);
const breedDetail = readFileSync(
  resolve(import.meta.dirname, "../app/dashboard/breeds/breed-detail.tsx"),
  "utf8",
);
const storefrontData = readFileSync(
  resolve(import.meta.dirname, "../app/store/[slug]/storefront-data.ts"),
  "utf8",
);
const storefrontProductPage = readFileSync(
  resolve(import.meta.dirname, "../app/store/[slug]/products/[productId]/page.tsx"),
  "utf8",
);

test("migration snapshots only missing platform-derived seller values", () => {
  assert.match(
    migration,
    /update public\.seller_breed_profiles as seller_profiles[\s\S]*seller_profiles\.breed_id is not null/,
  );
  assert.match(
    migration,
    /nullif\(btrim\(seller_profiles\.seller_description\), ''\) is null[\s\S]*then breeds\.description/,
  );
  assert.match(
    migration,
    /egg_color = coalesce\(seller_profiles\.egg_color, breeds\.egg_color\)/,
  );
  assert.match(
    migration,
    /annual_egg_production = coalesce\([\s\S]*seller_profiles\.annual_egg_production,[\s\S]*breeds\.annual_egg_production/,
  );
  assert.doesNotMatch(migration, /update public\.breeds\b/i);
  assert.doesNotMatch(migration, /update public\.order_items\b/i);
  assert.doesNotMatch(migration, /display_name\s*=\s*breeds\.breed_name/);
});

test("platform auto-add snapshots every supported catalog fact centrally", () => {
  assert.match(
    birdTypeRemovalMigration,
    /v_breed\.breed_name[\s\S]*v_breed\.variety[\s\S]*v_breed\.category[\s\S]*v_breed\.description[\s\S]*v_breed\.egg_color[\s\S]*v_breed\.annual_egg_production/,
  );
  assert.match(
    birdTypeRemovalMigration,
    /on conflict do nothing/,
  );
  assert.match(
    birdTypeRemovalMigration,
    /if v_profile\.visibility_status = 'archived' then[\s\S]*set visibility_status = 'active'/,
  );
});

test("seller-facing storefront facts no longer coalesce from platform breeds", () => {
  assert.match(
    birdTypeRemovalMigration,
    /rename column breed_bird_type to breed_category/,
  );
  assert.match(
    birdTypeRemovalMigration,
    /seller_breed_profiles\.bird_type[\s\S]*seller_breed_profiles\.breed_category/,
  );
  assert.match(
    birdTypeRemovalMigration,
    /pg_get_viewdef[\s\S]*public_storefront_inventory/,
  );
  assert.match(
    birdTypeRemovalMigration,
    /pg_get_functiondef[\s\S]*get_seller_storefront_preview_data/,
  );
});

test("Breed Catalog and inventory copy paths share the same complete mapping", () => {
  assert.match(
    breedData,
    /export function getCatalogBreedSnapshotRpcArgs[\s\S]*p_annual_egg_production:[\s\S]*p_breed_id:[\s\S]*p_display_name:[\s\S]*p_egg_color:[\s\S]*p_variety:[\s\S]*p_breed_category:[\s\S]*p_seller_description:/,
  );
  assert.match(
    breedManagement,
    /\.\.\.getCatalogBreedSnapshotRpcArgs\(breed\)/,
  );
  assert.match(
    inventoryForm,
    /\.\.\.getCatalogBreedSnapshotRpcArgs\(catalogBreed\)/,
  );
});

test("existing seller profiles no longer borrow catalog descriptions in the app", () => {
  assert.match(
    breedData,
    /getProfileDescription\(profile: SellerBreedProfile\)[\s\S]*profile\.seller_description\?\.trim\(\) \?\? ""/,
  );
  assert.doesNotMatch(
    breedData,
    /getProfileDescription[\s\S]*libraryByBreedId\.get/,
  );
  assert.match(
    inventoryForm,
    /label: profile\.display_name,[\s\S]*catalogDescription: null,[\s\S]*sellerDescription: profile\.seller_description/,
  );
});

test("Restore Defaults remains the only catalog-to-existing-profile refresh", () => {
  assert.match(
    breedDetail,
    /restoreCatalogDefaults[\s\S]*catalogBreed\.description/,
  );
  assert.match(breedDetail, /restoredBreedCategory[\s\S]*catalogBreed\.category/);
  assert.match(
    breedDetail,
    /restoredEggColor[\s\S]*catalogBreed\.egg_color/,
  );
  assert.match(
    breedDetail,
    /restoredAnnualEggProduction[\s\S]*catalogBreed\.annual_egg_production/,
  );
  assert.match(breedDetail, /restoreCatalogPhoto/);
});

test("legacy Bird Type is removed from active breed tables and RPC contracts", () => {
  assert.match(
    birdTypeRemovalMigration,
    /alter table public\.breeds[\s\S]*drop column bird_type/,
  );
  assert.match(
    birdTypeRemovalMigration,
    /alter table public\.seller_breed_profiles[\s\S]*drop column bird_type/,
  );
  assert.doesNotMatch(breedData, /bird_type/);
  assert.doesNotMatch(breedDetail, /bird_type/);
});

test("buyer-facing Purpose retains its label and reads seller Breed Category", () => {
  assert.match(storefrontData, /purpose: first\.breed_category/);
  assert.match(storefrontData, /formatEggColor\(first\.breed_egg_color\)/);
  assert.match(
    storefrontData,
    /formatAnnualEggProduction\([\s\S]*first\.breed_annual_egg_production/,
  );
  assert.match(storefrontProductPage, /\["Purpose", product\.purpose \|\| "Not listed"\]/);
  assert.doesNotMatch(storefrontData, /breed_bird_type|bird_type/);
});
