import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../../supabase/migrations/20260818130000_admin_delete_default_catalog_breed.sql",
  import.meta.url,
);
const edgePath = new URL(
  "../../../supabase/functions/admin-catalog-breed-delete/index.ts",
  import.meta.url,
);
const uiPath = new URL("../_components/admin-breed-image-manager.tsx", import.meta.url);
const listUiPath = new URL("../_components/admin-breeds-list.tsx", import.meta.url);
const workbenchPath = new URL(
  "../../../supabase/functions/admin-breed-image-workbench/index.ts",
  import.meta.url,
);

const [migrationSource, edgeSource, uiSource, listUiSource, workbenchSource] = await Promise.all([
  readFile(migrationPath, "utf8"),
  readFile(edgePath, "utf8"),
  readFile(uiPath, "utf8"),
  readFile(listUiPath, "utf8"),
  readFile(workbenchPath, "utf8"),
]);
const executableMigrationSource = migrationSource
  .replace(/^\s*--.*$/gm, "")
  .replace(/comment on function[\s\S]*?;\s*/gi, "");

test("delete is a real default-breed delete guarded by platform admin access", () => {
  assert.match(migrationSource, /if not public\.is_admin\(\)/);
  assert.match(migrationSource, /if v_breed\.is_custom/);
  assert.match(migrationSource, /delete from public\.breeds as breeds/);
  assert.doesNotMatch(migrationSource, /set\s+is_active\s*=\s*false/i);
  assert.match(edgeSource, /Platform admin access required/);
});

test("seller profiles and media are detached rather than deleted", () => {
  assert.match(migrationSource, /update public\.seller_breed_profiles/);
  assert.match(migrationSource, /breed_id = null/);
  assert.match(migrationSource, /update public\.media_assets/);
  assert.match(migrationSource, /source_breed_id = null/);
  assert.doesNotMatch(executableMigrationSource, /delete from public\.seller_breed_profiles|delete from public\.media_assets/);
  assert.doesNotMatch(executableMigrationSource, /listing_batches|hatching_egg_inventory_items|orders|order_items/);
});

test("workbench state is removed before the restricted breed row", () => {
  const reviewDelete = migrationSource.indexOf("delete from public.admin_breed_image_reviews");
  const breedDelete = migrationSource.indexOf("delete from public.breeds");
  assert.ok(reviewDelete >= 0 && breedDelete > reviewDelete);
  assert.match(edgeSource, /from\(WORKBENCH_BUCKET\)[\s\S]*?remove\(\[result\.candidate_storage_path\]\)/);
});

test("approved catalog image is deleted only when no current breed shares its storage path", () => {
  assert.match(edgeSource, /const isStillUsed = \(remainingBreeds \?\? \[\]\)\.some/);
  assert.match(edgeSource, /if \(!isStillUsed\)/);
  assert.match(edgeSource, /from\(CATALOG_BUCKET\)[\s\S]*?remove\(\[approvedPath\]\)/);
  assert.doesNotMatch(edgeSource, /seller-media|media_links/);
});

test("UI requires exact-name confirmation and invokes only the delete Edge Function", () => {
  assert.match(uiSource, /Delete Breed/);
  assert.match(uiSource, /deleteConfirmation !== breed\.breed_name/);
  assert.match(uiSource, /Permanently Delete Breed/);
  assert.match(uiSource, /"admin-catalog-breed-delete"/);
  assert.match(uiSource, /body: \{ breed_id: breed\.breed_id \}/);
  assert.match(listUiSource, /Type the exact breed name to confirm/);
  assert.match(listUiSource, /confirmation !== breed\.breed_name/);
  assert.match(listUiSource, /"admin-catalog-breed-delete"/);
  assert.match(listUiSource, /body: \{ breed_id: breed\.breed_id \}/);
});

test("stale deleted entries in the static image plan no longer break workbench listing", () => {
  assert.doesNotMatch(workbenchSource, /breeds\.length !== plan\.length/);
  assert.match(workbenchSource, /const record = planById\.get\(breed\.id\)/);
});
