import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const migrationPath =
  "supabase/migrations/20260729240000_retire_pickup_instructions.sql";
const retiredField = /pickup_instructions/;

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

test("onboarding reads, requires, reviews, and saves pickup_policy", () => {
  const flow = read("app/onboarding/_components/onboarding-flow.tsx");
  const form = read(
    "app/onboarding/_components/step-4-pickup-instructions-form.tsx",
  );
  const review = read("app/onboarding/_components/step-6-review-setup.tsx");

  assert.doesNotMatch(flow, retiredField);
  assert.doesNotMatch(form, retiredField);
  assert.doesNotMatch(review, retiredField);
  assert.match(flow, /pickup_policy/);
  assert.match(form, /pickup_policy: pickupPolicy\.trim\(\)/);
  assert.match(form, /Pickup policy is required|Enter a pickup policy/);
  assert.match(review, /pickup_policy/);
});

test("Store Admin state and payloads omit pickup_instructions", () => {
  const storeAdmin = read("app/dashboard/store-admin/store-admin.tsx");
  const sellerTypes = read("app/dashboard/_lib/seller-types.ts");

  assert.doesNotMatch(storeAdmin, retiredField);
  assert.doesNotMatch(sellerTypes, retiredField);
  assert.match(storeAdmin, /pickup_policy/);
  assert.match(storeAdmin, /pickup_location_text/);
  assert.match(storeAdmin, /pickup_address_line1/);
});

test("storefront and checkout use pickup_policy only", () => {
  const sources = [
    "app/store/[slug]/storefront-data.ts",
    "app/store/[slug]/storefront-home-content.tsx",
    "app/store/[slug]/storefront-shell-components.tsx",
    "app/store/[slug]/checkout/checkout-page.tsx",
    "app/store/[slug]/policies/page.tsx",
  ].map(read);

  for (const source of sources) {
    assert.doesNotMatch(source, retiredField);
  }

  assert.match(sources[1], /previewText\(\s*store\.pickup_policy/);
  assert.match(sources[2], /showPickup: Boolean\(store\.pickup_policy\)/);
  assert.match(
    sources[3],
    /pickupPolicy: store\.pickup_policy/,
  );
  assert.match(sources[3], /body: "Pickup details coming soon\."/);
});

test("order emails use policy and preserve order-specific notes", () => {
  const source = read("supabase/functions/postmark-email-worker/index.ts");

  assert.doesNotMatch(source, retiredField);
  assert.match(source, /pickup_policy/);
  assert.match(source, /order\.pickup_note/);
  assert.match(source, /order\.buyer_notes/);
  assert.match(source, /store\.pickup_location_text/);
});

test("forward migration backfills only blank policies before dropping the column", () => {
  const migration = read(migrationPath);
  const backfillIndex = migration.indexOf("update public.stores");
  const dropIndex = migration.indexOf("drop column pickup_instructions");

  assert.ok(backfillIndex >= 0);
  assert.ok(dropIndex > backfillIndex);
  assert.match(
    migration,
    /set pickup_policy = nullif\(trim\(stores\.pickup_instructions\), ''\)/,
  );
  assert.match(
    migration,
    /where nullif\(trim\(stores\.pickup_policy\), ''\) is null/,
  );
});

test("forward migration preserves order notes and pickup operations", () => {
  const migration = read(migrationPath);

  assert.doesNotMatch(migration, /drop column (?:pickup_note|buyer_notes)/);
  assert.doesNotMatch(migration, /drop column pickup_location_text/);
  assert.doesNotMatch(migration, /drop column pickup_address_/);
  assert.doesNotMatch(migration, /drop table public\.store_pickup_options/);
  assert.match(migration, /stores\.pickup_location_text/);
  assert.match(migration, /stores\.pickup_address_line1/);
});

test("current seed scripts populate pickup_policy only", () => {
  for (const source of [
    read("scripts/seed-realistic-test-data.sql"),
    read("scripts/create-test-seller-store.sql"),
  ]) {
    assert.doesNotMatch(source, retiredField);
    assert.match(source, /pickup_policy/);
  }
});

