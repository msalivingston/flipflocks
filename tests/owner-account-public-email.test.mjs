import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const migration = read(
  "supabase/migrations/20260817100000_owner_account_public_email.sql",
);
const storeAdmin = read("app/dashboard/store-admin/store-admin.tsx");
const sellerTypes = read("app/dashboard/_lib/seller-types.ts");
const storefrontData = read("app/store/[slug]/storefront-data.ts");
const storefrontShell = read(
  "app/store/[slug]/storefront-shell-components.tsx",
);
const policiesPage = read("app/store/[slug]/policies/page.tsx");
const worker = read("supabase/functions/postmark-email-worker/index.ts");

test("forward migration removes only the address and preserves its visibility preference", () => {
  assert.match(migration, /drop column public_email/);
  assert.doesNotMatch(migration, /drop column show_public_email/);
  assert.match(migration, /owner_users\.id = stores\.owner_user_id/);
  assert.match(migration, /owner_users\.id = target_store\.owner_user_id/);
  assert.match(migration, /show_public_email remains in both contracts/);
  assert.match(migration, /When true[\s\S]*when false, no email is exposed/);
});

test("seller contracts and Store Admin carry visibility but no editable public address", () => {
  for (const source of [sellerTypes, storeAdmin]) {
    assert.doesNotMatch(source, /public_email: string/);
  }

  assert.match(storeAdmin, /show_public_email: boolean/);
  assert.match(storeAdmin, /Show my account email on my storefront/);
  assert.match(storeAdmin, /email address itself is managed from the/);
  assert.match(storeAdmin, /href="\/dashboard\/account"/);
  assert.doesNotMatch(storeAdmin, /public_email: form\.public_email/);
  assert.doesNotMatch(storeAdmin, /public-email/);
});

test("public contract and UI retain the derived public_email output", () => {
  assert.match(storefrontData, /public_email: string \| null/);
  assert.match(storefrontShell, /mailto:\$\{store\.public_email\}/);
  assert.match(policiesPage, /mailto:\$\{store\.public_email\}/);
  assert.match(migration, /create or replace view public\.public_storefronts/);
  assert.match(
    migration,
    /public\.get_public_storefront_home\(text\)'::regprocedure/,
  );
  assert.match(
    migration,
    /public\.get_seller_storefront_home_preview\(text\)'::regprocedure/,
  );
});

test("launch readiness loses only the obsolete public-email warning", () => {
  assert.match(migration, /'public_email_present'/);
  assert.match(migration, /v_inventory_item_start/);
  assert.doesNotMatch(storeAdmin, /case "public-email"/);
});

test("migration does not alter transactional routing or delivery code", () => {
  assert.doesNotMatch(migration, /email_notifications/);
  assert.doesNotMatch(
    migration,
    /seller_new_order|seller_first_sale|seller_order_updated_copy|seller_order_canceled_copy|seller_subscription/,
  );
  assert.match(worker, /sellerContactEmail: ownerEmail/);
  assert.match(worker, /recipientType === "buyer" \? ownerEmail : buyerEmail/);
});
