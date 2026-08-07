import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260807100000_secure_storefront_preview_inventory.sql",
  ),
  "utf8",
);
const previewClient = readFileSync(
  resolve(root, "app/store/[slug]/storefront-preview-client.tsx"),
  "utf8",
);
const publicData = readFileSync(
  resolve(root, "app/store/[slug]/storefront-data.ts"),
  "utf8",
);

test("preview RPC is authenticated, owner/admin authorized, and API-role scoped", () => {
  assert.match(migration, /if auth\.uid\(\) is null/);
  assert.match(
    migration,
    /public\.owns_store\(v_store_id\) or public\.is_admin\(\)/,
  );
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, public/);
  assert.match(
    migration,
    /revoke all on function public\.get_seller_storefront_preview_data\(text\)[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_seller_storefront_preview_data\(text\)[\s\S]*to authenticated/,
  );
});

test("preview retains buyer eligibility and authoritative Market capability checks", () => {
  for (const predicate of [
    "species.is_active = true",
    "seller_breed_profiles.visibility_status = 'active'",
    "seller_breed_profiles.moderation_status = 'normal'",
    "listing_batches.visibility_status in ('active', 'sold_out')",
    "listing_batches.moderation_status = 'normal'",
    "listing_batch_breeds.visibility_status = 'active'",
    "listing_batch_breeds.moderation_status = 'normal'",
    "inventory_items.visibility_status = 'active'",
    "inventory_items.moderation_status = 'normal'",
    "hatching_items.archived_at is null",
    "media_links.visibility_status = 'active'",
    "media_assets.asset_status = 'active'",
    "media_assets.moderation_status = 'approved'",
    "target_entitlement.has_active_access = true",
    "target_entitlement.held = false",
    "target_entitlement.effective_plan_key = 'full_flock'",
  ]) {
    assert.ok(migration.includes(predicate), predicate);
  }

  for (const moduleFlag of [
    "target_store.hatching_eggs_enabled = true",
    "target_store.equipment_supplies_enabled = true",
    "target_store.processed_poultry_enabled = true",
  ]) {
    assert.ok(migration.includes(moduleFlag), moduleFlag);
  }
});

test("preview payload covers all home modules, profile images, and combined counts", () => {
  for (const cte of [
    "preview_inventory",
    "preview_equipment",
    "preview_hatching_eggs",
    "preview_processed_poultry",
    "eligible_profile_media",
  ]) {
    assert.match(migration, new RegExp(`${cte} as \\(`));
  }

  assert.match(
    migration,
    /summary_rows as \([\s\S]*from preview_inventory[\s\S]*from preview_equipment[\s\S]*from preview_hatching_eggs[\s\S]*from preview_processed_poultry/,
  );
  assert.match(migration, /'public_inventory_item_count', inventory_summary\.item_count/);
  assert.match(migration, /'has_public_inventory', inventory_summary\.item_count > 0/);
});

test("preview restores the known-working authenticated home gate before inventory", () => {
  assert.match(previewClient, /supabase\.auth\.getSession\(\)/);
  assert.doesNotMatch(previewClient, /supabase\.auth\.getUser\(\)/);
  assert.match(previewClient, /\.rpc\("get_seller_storefront_home_preview"/);
  assert.match(previewClient, /\.rpc\("get_seller_storefront_preview_data"/);
  assert.doesNotMatch(previewClient, /loadStorefront(?:Inventory|Equipment|HatchingEggInventory|ProcessedPoultry|ProfileImages)/);
  assert.match(previewClient, /<StorefrontHomeContent/);
  assert.match(previewClient, /livePoultryProfileImages=/);
  assert.match(previewClient, /withPreviewInventoryCounts\(/);
});

test("public storefront loaders remain on intentionally public projections", () => {
  assert.match(publicData, /import \{ publicSupabase \}/);
  for (const projection of [
    "public_storefront_inventory",
    "public_storefront_equipment_inventory",
    "public_storefront_hatching_egg_inventory",
    "public_storefront_processed_poultry_inventory",
    "public_storefront_media_gallery",
  ]) {
    assert.match(publicData, new RegExp(`\\.from\\("${projection}"\\)`));
  }
  assert.doesNotMatch(publicData, /get_seller_storefront_preview_data/);
});
