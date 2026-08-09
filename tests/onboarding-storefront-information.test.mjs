import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const migrationPath =
  "supabase/migrations/20260809140000_simplify_onboarding_steps.sql";

test("Step 2 contains Farm Basics only and keeps billing separate from pickup", async () => {
  const source = await read(
    "app/onboarding/_components/step-2-farm-basics-form.tsx",
  );

  for (const field of [
    "phone",
    "store_name",
    "billing_address_line1",
    "billing_city",
    "billing_state",
    "billing_postal_code",
    'billing_country: "US"',
  ]) {
    assert.match(source, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.doesNotMatch(source, /store_tagline|hero_subheading|about_text/);
  assert.doesNotMatch(source, /pickup_address|pickup_city|pickup_state/);
  assert.doesNotMatch(source, /logo|location_display_preference/);
  assert.match(source, /not used as your pickup address/);
});

test("Farm Basics creates the checkout-ready private draft without a pickup address", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /seller_bootstrap_store_from_onboarding/);
  assert.match(migration, /store_status, storefront_mode/);
  assert.match(migration, /'draft', 'hosted'/);
  assert.match(migration, /storefront_enabled[\s\S]*false/);
  assert.match(migration, /user_roles[\s\S]*'seller'/);
  assert.match(
    migration,
    /profile_complete[\s\S]*v_store\.id, true, v_legacy_combined_profile/,
  );
  assert.match(migration, /v_legacy_combined_profile boolean := false/);
  assert.match(
    migration,
    /case when v_legacy_combined_profile\s+then v_legacy_pickup_country else null end/,
  );
});

test("fresh stores receive real starter storefront copy and existing stores preserve saved copy", async () => {
  const [migration, copy] = await Promise.all([
    read(migrationPath),
    read("lib/storefront-hero-copy.ts"),
  ]);

  for (const text of [
    "Local poultry, raised with care.",
    "Quality birds and farm goods for backyard flock owners, homesteaders, and small farms.",
  ]) {
    assert.match(migration, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(copy, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(copy, /starterFarmDescription/);

  assert.match(
    migration,
    /store_tagline = case when v_legacy_combined_profile[\s\S]*else stores\.store_tagline end/,
  );
});

test("annual is the fresh default while a saved monthly cadence remains monthly", async () => {
  const source = await read(
    "app/onboarding/_components/step-5-plan-access-form.tsx",
  );

  assert.match(
    source,
    /return value === "monthly" \? "monthly" : "yearly"/,
  );
  assert.match(source, /label="Monthly"/);
  assert.match(source, /label="Annual"/);
});

test("the existing Stripe Checkout request and billing authority contract remain intact", async () => {
  const source = await read(
    "app/onboarding/_components/step-5-plan-access-form.tsx",
  );

  assert.match(source, /seller_save_onboarding_plan_access/);
  assert.match(source, /seller_get_saas_billing_status/);
  assert.match(source, /"stripe-saas-checkout"/);
  assert.match(source, /billing_cadence: selectedBillingPlan/);
  assert.match(source, /plan_key: selectedPlan/);
  assert.match(source, /isSafeStripeCheckoutUrl/);
  assert.match(source, /window\.location\.assign\(checkoutUrl\)/);
});

test("Stripe success remains transitional and cancellation returns to Plan and payment", async () => {
  const [page, returnStatus, flow] = await Promise.all([
    read("app/onboarding/page.tsx"),
    read("app/onboarding/billing/return/stripe-return-status.tsx"),
    read("app/onboarding/_components/onboarding-flow.tsx"),
  ]);

  assert.match(page, /billing === "checkout_canceled"/);
  assert.match(flow, /checkoutCanceled \? \(/);
  assert.match(flow, /currentStep=\{3\}[\s\S]*Plan and payment/);
  assert.match(returnStatus, /router\.replace\("\/onboarding"\)/);
  assert.doesNotMatch(returnStatus, /currentStep=\{/);
});

test("Step 4 restores controlled saved values and saves only storefront details", async () => {
  const [source, migration] = await Promise.all([
    read("app/onboarding/_components/step-4-storefront-details-form.tsx"),
    read(migrationPath),
  ]);

  assert.match(source, /initialValues\?\.heroTagline \?\? starterHeroTagline/);
  assert.match(source, /initialValues\?\.heroSubheading \?\? starterHeroSubheading/);
  assert.match(source, /value=\{heroTagline\}/);
  assert.match(source, /value=\{heroSubheading\}/);
  assert.match(source, /seller_save_onboarding_storefront_details/);
  assert.match(source, /location_display_preference: "city_state"/);
  assert.match(source, /locationDisplayPreference: "city_state"/);
  assert.match(source, /Your main storefront headline\. Keep it short and welcoming\./);
  assert.match(source, /A brief line telling customers what you offer and who it.s for\. You can change this anytime\./);
  assert.match(
    source,
    /Your storefront shows your city and state\. Your street and pickup\s+addresses stay private\./,
  );
  assert.doesNotMatch(
    source,
    /Public location preference|Show city \+ state only|Saved full-address preference|Manage precise location manually|type="radio"|RadioOption/,
  );

  const detailsFunction = migration.slice(
    migration.indexOf("seller_save_onboarding_storefront_details"),
    migration.indexOf("seller_save_onboarding_pickup"),
  );
  assert.match(detailsFunction, /storefront_details_complete = true/);
  assert.doesNotMatch(
    detailsFunction,
    /billing_address_line1\s*=|requested_plan_key\s*=|pickup_address_line1\s*=|store_slug\s*=/,
  );
});

test("public storefront location is limited to city and state", async () => {
  const [storefrontUi, storefrontHome, storefrontData] = await Promise.all([
    read("app/store/[slug]/storefront-ui.tsx"),
    read("app/store/[slug]/storefront-home-content.tsx"),
    read("app/store/[slug]/storefront-data.ts"),
  ]);

  assert.match(
    storefrontUi,
    /\[item\.public_city, item\.public_state\]\.filter\(Boolean\)\.join\(", "\)/,
  );
  assert.match(
    storefrontHome,
    /store: \{ public_city: string \| null; public_state: string \| null \}/,
  );
  assert.match(storefrontData, /public_city: string \| null/);
  assert.match(storefrontData, /public_state: string \| null/);

  for (const source of [storefrontUi, storefrontHome, storefrontData]) {
    assert.doesNotMatch(
      source,
      /billing_address_line1|pickup_address_line1|location_display_preference/,
    );
  }
});

test("fresh Market defaults all modules on, saved choices win, and Coop stays locked false", async () => {
  const source = await read(
    "app/onboarding/_components/step-3-selling-categories-form.tsx",
  );

  assert.match(source, /categoriesComplete\s*\? Boolean\(initialValues\?\.equipmentSuppliesEnabled\)\s*: true/);
  assert.match(source, /categoriesComplete\s*\? Boolean\(initialValues\?\.hatchingEggsEnabled\)\s*: true/);
  assert.match(source, /categoriesComplete\s*\? Boolean\(initialValues\?\.processedPoultryEnabled\)\s*: true/);
  assert.match(source, /equipment_supplies: isSmallFlock\s*\? false/);
  assert.match(source, /hatching_eggs: isSmallFlock \? false/);
  assert.match(source, /poultry_products: isSmallFlock\s*\? false/);
  assert.match(source, /isLocked=\{isSmallFlock\}/);
  assert.match(source, /Available on Market/);
  for (const label of [
    "Live birds",
    "Hatching eggs",
    "Equipment/supplies",
    "Processed poultry",
  ]) {
    assert.match(source, new RegExp(label.replace("/", "\\/")));
  }
  assert.doesNotMatch(source, /seller_save_onboarding_plan_access/);
});

test("Step 6 saves a distinct pickup address with the pickup policy", async () => {
  const [source, migration] = await Promise.all([
    read("app/onboarding/_components/step-4-pickup-instructions-form.tsx"),
    read(migrationPath),
  ]);

  for (const field of [
    "pickup_address_line1",
    "pickup_address_line2",
    "pickup_city",
    "pickup_state",
    "pickup_postal_code",
    "pickup_policy",
  ]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  assert.match(source, /not shown on your public storefront/);
  assert.doesNotMatch(source, /billingAddress|billing_address/);
  assert.match(migration, /set pickup_address_line1 = v_address_line1/);
  assert.match(migration, /pickup_policy = v_pickup_policy/);
});

test("resume routing uses every authoritative seven-step discriminator", async () => {
  const [flow, shell] = await Promise.all([
    read("app/onboarding/_components/onboarding-flow.tsx"),
    read("app/onboarding/_components/onboarding-shell.tsx"),
  ]);

  assert.match(flow, /if \(progress\?\.onboarding_complete\)/);
  assert.match(flow, /else if \(!primarySeller\.profile_complete\)/);
  assert.match(flow, /else if \(!progress\?\.billing_complete\)/);
  assert.match(flow, /else if \(!progress\.storefront_details_complete\)/);
  assert.match(flow, /else if \(!progress\.categories_complete\)/);
  assert.match(flow, /else if \(!progress\.pickup_complete\)/);
  for (const step of [2, 3, 4, 5, 6, 7]) {
    assert.match(flow, new RegExp(`currentStep=\\{${step}\\}`));
  }
  assert.match(shell, /const totalSteps = 7/);
  assert.match(shell, /Step \{currentStep\} of \{totalSteps\}/);
  assert.match(shell, /Array\.from\(\{ length: totalSteps \}/);
});

test("review edit links target Farm Basics, Storefront, Categories, and Pickup", async () => {
  const [flow, review] = await Promise.all([
    read("app/onboarding/_components/onboarding-flow.tsx"),
    read("app/onboarding/_components/step-6-review-setup.tsx"),
  ]);

  for (const step of [2, 4, 5, 6]) {
    assert.match(review, new RegExp(`onEditStep\\(${step}\\)`));
  }
  assert.match(flow, /setReturnToReview\(true\)/);
  assert.match(flow, /setView\(`step\$\{step\}` as OnboardingView\)/);
});

test("final completion requires storefront, billing, categories, pickup, and current terms", async () => {
  const migration = await read(migrationPath);
  const completeFunction = migration.slice(
    migration.indexOf("create or replace function public.seller_complete_onboarding"),
  );

  for (const prerequisite of [
    "profile_complete",
    "billing_complete",
    "storefront_details_complete",
    "categories_complete",
    "pickup_complete",
  ]) {
    assert.match(completeFunction, new RegExp(`onboarding\\.${prerequisite}`));
  }
  assert.match(
    completeFunction,
    /acceptances\.terms_version = public\.current_seller_terms_version\(\)/,
  );
});

test("historical profiles are compatible and completed sellers remain complete", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /set storefront_details_complete = true\s+where profile_complete = true/,
  );
  assert.match(
    migration,
    /v_existing_store\.store_status <> 'draft'[\s\S]*onboarding\.onboarding_complete/,
  );
  assert.match(
    migration,
    /on conflict on constraint seller_onboarding_state_store_id_key do update\s+set profile_complete = true/,
  );
  assert.doesNotMatch(
    migration,
    /on conflict on constraint seller_onboarding_state_store_id_key do update[\s\S]{0,180}billing_complete = false/,
  );
});
