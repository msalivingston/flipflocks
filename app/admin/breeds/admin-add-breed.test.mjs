import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listPath = new URL("../_components/admin-breeds-list.tsx", import.meta.url);
const modalPath = new URL("../_components/admin-add-breed-modal.tsx", import.meta.url);
const sharedFormPath = new URL(
  "../../dashboard/breeds/custom-breed-form.tsx",
  import.meta.url,
);
const migrationPath = new URL(
  "../../../supabase/migrations/20260821140000_admin_create_catalog_breed.sql",
  import.meta.url,
);
const sellerBreedsPath = new URL(
  "../../dashboard/breeds/breeds-management.tsx",
  import.meta.url,
);
const normalLiveBirdsPath = new URL(
  "../../dashboard/inventory/add-v2/live-birds/page.tsx",
  import.meta.url,
);
const batchLiveBirdsPath = new URL(
  "../../dashboard/inventory/add-v2/live-birds/batch/page.tsx",
  import.meta.url,
);
const workbenchPath = new URL(
  "../../../supabase/functions/admin-breed-image-workbench/index.ts",
  import.meta.url,
);

const [
  listSource,
  modalSource,
  sharedFormSource,
  migrationSource,
  sellerBreedsSource,
  normalLiveBirdsSource,
  batchLiveBirdsSource,
  workbenchSource,
] = await Promise.all([
  readFile(listPath, "utf8"),
  readFile(modalPath, "utf8"),
  readFile(sharedFormPath, "utf8"),
  readFile(migrationPath, "utf8"),
  readFile(sellerBreedsPath, "utf8"),
  readFile(normalLiveBirdsPath, "utf8"),
  readFile(batchLiveBirdsPath, "utf8"),
  readFile(workbenchPath, "utf8"),
]);

test("Admin Breed Catalog exposes one header action for Add Breed", () => {
  assert.match(listSource, /<AdminPageHeader[\s\S]*?action=\{/);
  assert.match(listSource, />\s*Add Breed\s*<\/button>/);
  assert.match(listSource, /<AdminAddBreedModal/);
});

test("Admin modal reuses the shared form with catalog-specific copy", () => {
  assert.match(modalSource, /<CustomBreedForm/);
  assert.match(modalSource, /descriptionLabel="Catalog description"/);
  assert.match(modalSource, /chickenBreedCategoryRequired/);
  assert.match(modalSource, /requireChickenBreedCategory: true/);
  assert.match(modalSource, />\s*Create Breed\s*</);
  assert.doesNotMatch(modalSource, /Choose from Breed Library|Add to My Breeds|seller-media/);
});

test("shared validation respects catalog limits without requiring seller chicken categories", () => {
  assert.match(sharedFormSource, /export const breedVarietyMaxLength = 120/);
  assert.match(sharedFormSource, /requireChickenBreedCategory = false/);
  assert.match(sharedFormSource, /Variety must be.*characters or less/);
  assert.match(sharedFormSource, /Choose a Breed Category for this chicken breed/);
});

test("Admin creation uses only the narrow global catalog RPC and opens detail", () => {
  assert.match(modalSource, /"admin_create_catalog_breed"/);
  assert.match(modalSource, /router\.push\(`\/admin\/breeds\/\$\{createdBreed\.breed_id\}`\)/);
  assert.doesNotMatch(modalSource, /seller_upsert_breed_profile|seller_breed_profiles|uploadSellerPhoto/);
});

test("catalog create RPC is admin-only, canonical, and duplicate-safe", () => {
  assert.match(migrationSource, /auth\.uid\(\) is null or not public\.is_admin\(\)/);
  assert.match(migrationSource, /species\.is_active = true/);
  assert.match(migrationSource, /is_active,[\s\S]*?is_custom[\s\S]*?true,[\s\S]*?false/);
  assert.match(migrationSource, /errcode = '23505'/);
  assert.match(migrationSource, /when unique_violation/);
  assert.match(migrationSource, /grant execute[\s\S]*?to authenticated/);
  assert.doesNotMatch(migrationSource, /insert into public\.(seller_breed_profiles|breed_aliases|media_assets|media_links)/);
});

test("existing downstream selectors continue to load active global breeds directly", () => {
  for (const source of [sellerBreedsSource, normalLiveBirdsSource, batchLiveBirdsSource]) {
    assert.match(source, /\.from\("breeds"\)[\s\S]*?\.eq\("is_active", true\)/);
  }
  assert.match(workbenchSource, /\.from\("breeds"\)[\s\S]*?\.eq\("is_active", true\)[\s\S]*?\.eq\("is_custom", false\)/);
});
