import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const migrationPath =
  "supabase/migrations/20260824100000_pickup_option_archiving.sql";

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

test("archive migration adds and backfills archived_at without a new status model", () => {
  const migration = read(migrationPath);

  assert.match(migration, /add column archived_at timestamptz/);
  assert.match(
    migration,
    /set archived_at = updated_at\s+where is_active = false\s+and archived_at is null/,
  );
  assert.doesNotMatch(migration, /create table .*pickup.*history/i);
  assert.doesNotMatch(migration, /add constraint .*archiv/i);
});

test("persisted pickup options archive while unsaved drafts can still be removed", () => {
  const admin = read("app/dashboard/store-admin/store-admin.tsx");
  const pickupTab = read(
    "app/dashboard/store-admin/pickup-delivery-tab.tsx",
  );
  const migration = read(migrationPath);

  assert.match(admin, /option\.id === optionId && option\.isNew/);
  assert.match(admin, /is_active: false,[\s\S]*archived_at: new Date\(\)\.toISOString\(\)/);
  assert.match(pickupTab, /option\.isNew \? "Remove" : "Archive"/);
  assert.match(
    migration,
    /is_active = v_is_active,[\s\S]*archived_at = case[\s\S]*coalesce\(v_option\.archived_at, now\(\)\)/,
  );
});

test("buyer checkout exposes only active non-archived pickup options", () => {
  const migration = read(migrationPath);

  assert.match(
    migration,
    /create or replace view public\.public_storefront_pickup_options[\s\S]*store_pickup_options\.is_active = true[\s\S]*store_pickup_options\.archived_at is null/,
  );
});

test("a stale buyer checkout remains protected by active-option validation", () => {
  const archiveMigration = read(migrationPath);
  const payAtPickupMigration = read(
    "supabase/migrations/20260730140000_conservative_order_customer_identity.sql",
  );
  const stripeMigration = read(
    "supabase/migrations/20260820100000_sunshine_mesa_stripe_connect_phase1.sql",
  );

  assert.match(
    archiveMigration,
    /seller_update_pickup_option[\s\S]*is_active = v_is_active/,
  );
  assert.match(
    payAtPickupMigration,
    /create or replace function public\.create_pay_at_pickup_order_v2[\s\S]*spo\.is_active = true/,
  );
  assert.match(
    stripeMigration,
    /p_pickup_option_id[\s\S]*options\.is_active = true/,
  );
});

test("manual orders continue to query only active options", () => {
  const manualOrder = read(
    "app/dashboard/orders/new/new-manual-order.tsx",
  );

  assert.match(
    manualOrder,
    /from\("store_pickup_options"\)[\s\S]*eq\("is_active", true\)/,
  );
});

test("Orders filter is derived only from open-order pickup assignments", () => {
  const ordersList = read("app/dashboard/orders/orders-list.tsx");
  const migration = read(migrationPath);

  assert.match(
    ordersList,
    /from\("seller_dashboard_attention_orders"\)[\s\S]*select\("pickup_option_id, pickup_option_label_snapshot"\)/,
  );
  assert.doesNotMatch(
    ordersList,
    /from\("store_pickup_options"\)[\s\S]*setPickupOptions/,
  );
  assert.match(
    migration,
    /create or replace view public\.seller_dashboard_attention_orders[\s\S]*orders\.order_status in \('pending', 'open'\)/,
  );
});

test("Edit Order includes active, recent archived, and the current pickup option", () => {
  const editOrder = read(
    "app/dashboard/orders/[orderId]/edit/edit-order.tsx",
  );
  const migration = read(migrationPath);

  assert.match(editOrder, /90 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(editOrder, /option\.id === order\?\.pickup_option_id/);
  assert.match(editOrder, /option\.is_active && !option\.archived_at/);
  assert.match(
    editOrder,
    /!option\.is_active[\s\S]*new Date\(option\.archived_at\)\.getTime\(\) >= archivedCutoff/,
  );
  assert.match(editOrder, /includeSavedPickupOption/);
  assert.match(
    migration,
    /create or replace function public\.seller_edit_order_strict_wrapper[\s\S]*store_pickup_options\.archived_at >= now\(\) - interval '90 days'[\s\S]*store_pickup_options\.id = v_order\.pickup_option_id/,
  );
});

test("both seller pickup assignment paths visibly share the same eligibility rule", () => {
  const migration = read(migrationPath);
  const rule = /store_pickup_options\.is_active = true[\s\S]*?store_pickup_options\.archived_at is null[\s\S]*?store_pickup_options\.is_active = false[\s\S]*?store_pickup_options\.archived_at >= now\(\) - interval '90 days'[\s\S]*?store_pickup_options\.id = v_order\.pickup_option_id/g;

  assert.equal(migration.match(rule)?.length, 2);
});

test("operational order displays prefer the current option label with snapshot fallback", () => {
  const migration = read(migrationPath);
  const emailWorker = read(
    "supabase/functions/postmark-email-worker/index.ts",
  );
  const currentLabelFallback =
    /coalesce\(store_pickup_options\.label, orders\.pickup_option_label_snapshot\) as pickup_option_label_snapshot/g;

  assert.equal(migration.match(currentLabelFallback)?.length, 2);
  assert.match(
    emailWorker,
    /context\.pickupOption\?\.label \|\|[\s\S]*order\.pickup_option_label_snapshot/,
  );
  assert.doesNotMatch(
    migration,
    /update public\.orders\s+set pickup_option_label_snapshot = store_pickup_options\.label/,
  );
});
