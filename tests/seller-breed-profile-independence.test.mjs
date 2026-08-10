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
    /bird_type = coalesce\(seller_profiles\.bird_type, breeds\.bird_type\)/,
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
    migration,
    /v_breed\.breed_name,[\s\S]*v_breed\.description[\s\S]*v_breed\.bird_type,[\s\S]*v_breed\.egg_color,[\s\S]*v_breed\.annual_egg_production/,
  );
  assert.match(
    migration,
    /on conflict do nothing/,
  );
  assert.match(
    migration,
    /if v_profile\.visibility_status = 'archived' then[\s\S]*set visibility_status = 'active'/,
  );
});

test("seller-facing storefront facts no longer coalesce from platform breeds", () => {
  const viewStart = migration.indexOf(
    "create or replace view public.public_storefront_inventory",
  );
  const previewStart = migration.indexOf("do $preview_patch$");
  const viewDefinition = migration.slice(viewStart, previewStart);

  assert.match(
    viewDefinition,
    /seller_breed_profiles\.bird_type as breed_bird_type/,
  );
  assert.match(
    viewDefinition,
    /seller_breed_profiles\.egg_color as breed_egg_color/,
  );
  assert.match(
    viewDefinition,
    /seller_breed_profiles\.annual_egg_production[\s\S]*as breed_annual_egg_production/,
  );
  assert.doesNotMatch(viewDefinition, /join public\.breeds/);
  assert.doesNotMatch(viewDefinition, /seller_notes/);
  assert.match(
    migration,
    /pg_get_functiondef[\s\S]*get_seller_storefront_preview_data/,
  );
});

test("Breed Catalog and inventory copy paths share the same complete mapping", () => {
  assert.match(
    breedData,
    /export function getCatalogBreedSnapshotRpcArgs[\s\S]*p_annual_egg_production:[\s\S]*p_bird_type:[\s\S]*p_breed_id:[\s\S]*p_display_name:[\s\S]*p_egg_color:[\s\S]*p_seller_description:/,
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
  assert.match(
    breedDetail,
    /restoredBirdType[\s\S]*catalogBreed\.bird_type/,
  );
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
