import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const priorMigrationPath = resolve(
  root,
  "supabase/migrations/20260730212000_fix_provider_subscription_event_ambiguity.sql",
);
const migrationPath = resolve(
  root,
  "supabase/migrations/20260730213000_fix_public_storefront_plan_resolution.sql",
);
const storefrontForwardFixPath = resolve(
  root,
  "supabase/migrations/20260818121000_restore_public_storefront_entitlement_predicate.sql",
);
const sqlTestPath = resolve(
  root,
  "supabase/tests/public_storefront_entitlement_plan_resolution_test.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const storefrontForwardFix = readFileSync(storefrontForwardFixPath, "utf8");
const sqlTest = readFileSync(sqlTestPath, "utf8");

const directViews = [
  "public_storefront_inventory",
  "public_storefront_equipment_inventory",
  "public_storefront_processed_poultry_inventory",
  "public_storefront_hatching_egg_inventory",
  "public_storefront_media_gallery",
];

const affectedViews = [
  "public_storefront_equipment_inventory",
  "public_storefront_hatching_egg_inventory",
  "public_storefront_home",
  "public_storefront_inventory",
  "public_storefront_item_detail",
  "public_storefront_media_gallery",
  "public_storefront_processed_poultry_inventory",
];

const allPublicViews = [
  "public_storefronts",
  "public_listing_batches",
  "public_inventory_items",
  "public_storefront_breed_inventory",
  "public_discoverable_storefronts",
  "public_discoverable_inventory",
  "public_storefront_home",
  "public_storefront_item_detail",
  "public_storefront_pickup_options",
  "public_storefront_inventory",
  "public_storefront_equipment_inventory",
  "public_storefront_processed_poultry_inventory",
  "public_storefront_hatching_egg_inventory",
  "public_storefront_media_gallery",
  "public_storefront_processed_poultry_media_gallery",
];

test("the emergency correction is append-only and follows the provider correction", () => {
  assert.ok(basename(priorMigrationPath) < basename(migrationPath));
  assert.match(migration, /^-- Emergency Batch C forward fix:/);
  assert.match(migration, /begin;[\s\S]*commit;/);
});

test("the public helper returns only a boolean for a public active Market entitlement", () => {
  assert.match(
    migration,
    /create or replace function public\.store_has_public_market_entitlement\([\s\S]*returns boolean/,
  );
  assert.match(migration, /security definer\s*set search_path = pg_catalog, public/);
  assert.match(migration, /public\.resolve_store_entitlement\(stores\.id\)/);
  assert.match(migration, /stores\.storefront_enabled = true/);
  assert.match(migration, /stores\.store_status = 'live'/);
  assert.match(migration, /stores\.admin_hold_reason is null/);
  assert.match(migration, /entitlement\.has_active_access = true/);
  assert.match(migration, /entitlement\.held = false/);
  assert.match(migration, /entitlement\.effective_plan_key = 'full_flock'/);
});

test("the private scalar plan helper remains unavailable to every API role", () => {
  assert.match(
    migration,
    /revoke all on function public\.get_store_plan_key\(uuid\)[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.get_store_plan_key\(uuid\)/,
  );
});

test("only the five direct views are redefined and both indirect views are verified", () => {
  for (const view of directViews) {
    assert.match(migration, new RegExp(`'${view}'`));
  }
  assert.match(migration, /'public_storefront_home'/);
  assert.match(migration, /'public_storefront_item_detail'/);
  assert.match(migration, /strpos\(v_definition, 'public_storefront_inventory'\) = 0/);
  assert.match(
    migration,
    /public\.store_has_public_market_entitlement\(stores\.id\)/,
  );
});

test("view replacement fails closed on definition drift and preserves public metadata", () => {
  assert.match(migration, /v_expected_calls := case/);
  assert.match(migration, /v_actual_calls <> v_expected_calls/);
  assert.match(migration, /create or replace view public\.%I with \(security_barrier = true\)/);
  assert.match(migration, /views\.relowner is distinct from v_owner/);
  assert.match(migration, /views\.relacl is distinct from v_acl/);
  assert.match(migration, /obj_description\(views\.oid, 'pg_class'\) is distinct from v_comment/);
  assert.match(migration, /views\.reloptions is distinct from v_options/);
  assert.match(migration, /columns\.attname/);
  assert.match(migration, /columns\.atttypid/);
  assert.match(migration, /columns\.atttypmod/);
});

test("SQL coverage exercises all public views and every reported outage surface", () => {
  for (const view of allPublicViews) {
    assert.match(sqlTest, new RegExp(`'${view}'`));
  }
  for (const view of affectedViews) {
    assert.match(sqlTest, new RegExp(`Green Acres query succeeds through public\\.%s`));
    assert.match(sqlTest, new RegExp(`'${view}'`));
  }
  assert.match(sqlTest, /inactive store remains absent from public\.%s/);
  assert.match(sqlTest, /permission denied for function get_store_plan_key/);
});

test("the seller snapshot regression is repaired without changing the view contract", () => {
  assert.match(storefrontForwardFix, /begin;[\s\S]*commit;/);
  assert.match(
    storefrontForwardFix,
    /v_actual_calls <> 1[\s\S]*get_store_plan_key call/,
  );
  assert.match(
    storefrontForwardFix,
    /public\.store_has_public_market_entitlement\(stores\.id\)/,
  );
  assert.match(
    storefrontForwardFix,
    /views\.relowner is distinct from v_owner/,
  );
  assert.match(storefrontForwardFix, /views\.relacl is distinct from v_acl/);
  assert.match(
    storefrontForwardFix,
    /obj_description\(views\.oid, 'pg_class'\) is distinct from v_comment/,
  );
  assert.match(
    storefrontForwardFix,
    /views\.reloptions is distinct from v_options/,
  );
  assert.match(storefrontForwardFix, /columns\.attname/);
  assert.match(storefrontForwardFix, /columns\.atttypid/);
  assert.match(storefrontForwardFix, /columns\.atttypmod/);
  assert.match(
    storefrontForwardFix,
    /seller_breed_profiles\.bird_type[\s\S]*seller_breed_profiles\.egg_color[\s\S]*seller_breed_profiles\.annual_egg_production/,
  );
  assert.doesNotMatch(
    storefrontForwardFix,
    /grant execute on function public\.get_store_plan_key/,
  );
});
