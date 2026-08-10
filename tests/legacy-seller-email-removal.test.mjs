import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const migration = read(
  "supabase/migrations/20260816100000_remove_legacy_seller_email_fields.sql",
);
const worker = read("supabase/functions/postmark-email-worker/index.ts");
const sellerTypes = read("app/dashboard/_lib/seller-types.ts");
const sellerContext = read("app/dashboard/_components/seller-context.tsx");
const storeAdmin = read("app/dashboard/store-admin/store-admin.tsx");
const testStoreSeed = read("scripts/create-test-seller-store.sql");
const realisticSeed = read("scripts/seed-realistic-test-data.sql");

test("forward migration removes only the two private legacy seller email columns", () => {
  assert.match(migration, /drop column communication_email/);
  assert.match(migration, /drop column order_notification_email/);
  assert.doesNotMatch(migration, /drop column (?:public_email|show_public_email)/);
  assert.match(migration, /create view public\.seller_store_defaults/);
  assert.match(migration, /public\.get_seller_context\(\)'::regprocedure/);
  assert.match(
    migration,
    /public\.seller_update_store_settings\(uuid,jsonb\)'::regprocedure/,
  );
  assert.match(
    migration,
    /public\.seller_update_store_defaults\(uuid,jsonb\)'::regprocedure/,
  );
});

test("active dashboard contracts and state no longer carry either legacy field", () => {
  for (const source of [sellerTypes, sellerContext, storeAdmin]) {
    assert.doesNotMatch(
      source,
      /communication_email|order_notification_email/,
    );
  }

  assert.doesNotMatch(storeAdmin, /Contact email|accountEmail/);
});

test("worker uses the owner account email and contains no removed store field", () => {
  assert.doesNotMatch(
    worker,
    /communication_email|order_notification_email|sellerOrderContactEmail/,
  );
  assert.match(worker, /sellerContactEmail: ownerEmail/);
  assert.match(worker, /sellerContactEmail: emailContext\.recipientEmail/);
  assert.match(worker, /recipientType === "buyer" \? ownerEmail : buyerEmail/);
});

test("development seeds no longer write either removed column", () => {
  for (const source of [testStoreSeed, realisticSeed]) {
    assert.doesNotMatch(
      source,
      /communication_email|order_notification_email/,
    );
  }
});

test("public storefront contact fields remain in Store Admin", () => {
  assert.match(storeAdmin, /public_email: string/);
  assert.match(storeAdmin, /show_public_email: boolean/);
  assert.match(storeAdmin, /public_email: form\.public_email/);
  assert.match(storeAdmin, /show_public_email: form\.show_public_email/);
});
