import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Farm Information collects the existing hero copy and canonical pickup address", async () => {
  const source = await read("app/onboarding/_components/step-2-farm-basics-form.tsx");

  assert.match(source, /store_tagline: heroTagline\.trim\(\)/);
  assert.match(source, /hero_subheading: heroSubheading\.trim\(\)/);
  for (const field of [
    "pickup_address_line1",
    "pickup_address_line2",
    "pickup_city",
    "pickup_state",
    "pickup_postal_code",
    "pickup_country",
  ]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  assert.match(source, /Billing address/);
  assert.match(source, /Pickup address/);
  assert.match(
    source,
    /not shown on your public storefront\. Buyers receive it in their order confirmation after purchase/,
  );
});

test("Farm Information and Store Admin use one hero-copy length contract", async () => {
  const [onboarding, storeAdmin, limits] = await Promise.all([
    read("app/onboarding/_components/step-2-farm-basics-form.tsx"),
    read("app/dashboard/store-admin/store-admin.tsx"),
    read("lib/storefront-hero-copy.ts"),
  ]);

  assert.match(limits, /heroHeadlineMaxLength = 45/);
  assert.match(limits, /heroSubheadingMaxLength = 90/);
  assert.match(onboarding, /from "@\/lib\/storefront-hero-copy"/);
  assert.match(storeAdmin, /from "@\/lib\/storefront-hero-copy"/);
});

test("onboarding bootstrap validates and saves storefront information through the owner-only draft-store path", async () => {
  const migration = await read(
    "supabase/migrations/20260807140000_onboarding_storefront_information.sql",
  );

  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /v_existing_store\.store_status <> 'draft'/);
  assert.match(migration, /Hero tagline must be 45 characters or fewer/);
  assert.match(migration, /Hero subline must be 90 characters or fewer/);
  assert.match(migration, /Pickup address is required/);
  assert.match(migration, /pickup_address_line1 = v_pickup_address_line1/);
  assert.match(migration, /revoke all on function public\.seller_bootstrap_store_from_onboarding\(jsonb\) from public/);
  assert.match(migration, /grant execute on function public\.seller_bootstrap_store_from_onboarding\(jsonb\) to authenticated/);
});
