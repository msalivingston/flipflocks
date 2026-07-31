import assert from "node:assert/strict";
import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const foundationPath = resolve(
  root,
  "supabase/migrations/20260730180000_authoritative_store_entitlements.sql",
);
const enforcementPath = resolve(
  root,
  "supabase/migrations/20260730181000_enforce_authoritative_store_entitlements.sql",
);
const providerCorrectionPath = resolve(
  root,
  "supabase/migrations/20260730212000_fix_provider_subscription_event_ambiguity.sql",
);
const foundation = readFileSync(foundationPath, "utf8");
const enforcement = readFileSync(enforcementPath, "utf8");
const providerCorrection = readFileSync(providerCorrectionPath, "utf8");

function sourceFiles(directory) {
  const files = [];

  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if ([".js", ".mjs", ".ts", ".tsx"].includes(extname(path))) {
      files.push(path);
    }
  }

  return files;
}

test("Batch C migrations are append-only and ordered foundation before enforcement", () => {
  assert.match(foundation, /create or replace function public\.resolve_store_entitlement/);
  assert.match(enforcement, /Batch C entitlement enforcement requires classification/);
  assert.ok(foundationPath < enforcementPath);
});

test("the canonical resolver is expiry-aware, hold-aware, and not browser executable", () => {
  assert.match(foundation, /v_now timestamptz := statement_timestamp\(\)/);
  assert.match(foundation, /trial_ends_at > v_now/);
  assert.match(foundation, /storefront_access_until > v_now/);
  assert.match(foundation, /comp_access_until > v_now/);
  assert.match(foundation, /'administrative_hold'/);
  assert.match(
    foundation,
    /revoke all on function public\.resolve_store_entitlement\(uuid\)[\s\S]*from public, anon, authenticated, service_role/,
  );
});

test("seller onboarding sends requested choices only and contains no promotion authority", () => {
  const step = readFileSync(
    resolve(root, "app/onboarding/_components/step-5-plan-access-form.tsx"),
    "utf8",
  );

  assert.match(step, /requested_plan_key: selectedPlan/);
  assert.match(step, /requested_billing_cadence: selectedBillingPlan/);
  assert.doesNotMatch(step, /promo_code|subscription_status|trial_ends_at|storefront_access_until/);
  assert.match(foundation, /where stores\.owner_user_id = v_user_id/);
  assert.match(foundation, /for update/);
  assert.match(foundation, /v_billing\.trial_ends_at = v_billing\.trial_started_at \+ interval '7 days'/);
  assert.match(foundation, /promo_code is tolerated[\s\S]*deliberately ignored/);
});

test("FOUNDINGFLOCK is absent from active application and worker code", () => {
  const activeRoots = ["app", "lib", "supabase/functions"];
  const matches = [];

  for (const relativeRoot of activeRoots) {
    for (const file of sourceFiles(resolve(root, relativeRoot))) {
      if (readFileSync(file, "utf8").includes("FOUNDINGFLOCK")) {
        matches.push(file);
      }
    }
  }

  assert.deepEqual(matches, []);
});

test("requested and effective entitlement fields remain distinct in seller UI contracts", () => {
  const sellerTypes = readFileSync(
    resolve(root, "app/dashboard/_lib/seller-types.ts"),
    "utf8",
  );
  const review = readFileSync(
    resolve(root, "app/onboarding/_components/step-6-review-setup.tsx"),
    "utf8",
  );
  const account = readFileSync(
    resolve(root, "app/dashboard/account/seller-account.tsx"),
    "utf8",
  );

  for (const field of [
    "requested_plan_key",
    "requested_billing_cadence",
    "effective_plan_key",
    "effective_billing_cadence",
    "has_active_entitlement",
    "entitlement_access_until",
  ]) {
    assert.match(sellerTypes, new RegExp(field));
  }

  assert.match(review, /label="Requested plan"/);
  assert.match(review, /label="Effective plan"/);
  assert.match(account, /\["Requested plan"/);
  assert.match(account, /\["Effective plan"/);
  assert.doesNotMatch(account, /\.from\("seller_billing_status"\)/);
});

test("admin comp is an explicit audited grant and revoke workflow", () => {
  const controls = readFileSync(
    resolve(root, "app/admin/_components/admin-store-controls.tsx"),
    "utf8",
  );

  assert.match(controls, /admin_grant_store_comp/);
  assert.match(controls, /admin_revoke_store_comp/);
  assert.match(controls, /p_reason: compReason\.trim\(\)/);
  assert.match(controls, /p_expires_at: new Date\(compExpiresAt\)\.toISOString\(\)/);
  assert.doesNotMatch(controls, /admin_change_store_plan/);
  assert.match(foundation, /comp_granted_by_user_id = v_actor/);
  assert.match(foundation, /'store_comp_granted'/);
  assert.match(foundation, /'store_comp_revoked'/);
});

test("provider state has one service-only, price-mapped, ordered contract", () => {
  assert.match(foundation, /billing_provider_price_catalog/);
  assert.match(foundation, /apply_verified_stripe_subscription_event/);
  assert.match(foundation, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(foundation, /v_price_row\.plan_key/);
  assert.match(foundation, /v_billing\.last_provider_event_created_at > p_provider_event_created_at/);
  assert.match(
    foundation,
    /revoke all on function public\.apply_verified_stripe_subscription_event[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    foundation,
    /grant execute on function public\.apply_verified_stripe_subscription_event[\s\S]*to service_role/,
  );
});

test("provider correction preserves the contract and removes output-column ambiguity", () => {
  assert.match(
    providerCorrection,
    /create or replace function public\.apply_verified_stripe_subscription_event\([\s\S]*returns table \(\s*applied boolean,\s*store_id uuid,\s*subscription_status text,\s*access_until timestamptz\s*\)/,
  );
  assert.match(providerCorrection, /security definer\s*set search_path = pg_catalog, public/);
  assert.match(providerCorrection, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(
    providerCorrection,
    /on conflict on constraint seller_billing_status_store_id_key do update/,
  );
  assert.doesNotMatch(providerCorrection, /on conflict\s*\(\s*store_id\s*\)/);
  assert.match(providerCorrection, /from public\.billing_provider_events as provider_event/);
  assert.match(providerCorrection, /from public\.seller_billing_status as billing_snapshot/);
  assert.match(providerCorrection, /returning billing_snapshot\.\* into v_billing/);
  assert.match(
    providerCorrection,
    /revoke all on function public\.apply_verified_stripe_subscription_event[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    providerCorrection,
    /grant execute on function public\.apply_verified_stripe_subscription_event[\s\S]*to service_role/,
  );
});

test("public reads, launch, capabilities, and final order insertion use entitlement enforcement", () => {
  const publicViews = [
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

  for (const view of publicViews) {
    assert.match(enforcement, new RegExp(`'${view}'`));
  }

  assert.equal(
    publicViews.length,
    15,
    "all fifteen direct public PostgREST views remain covered",
  );
  assert.match(
    enforcement,
    /v_definition := regexp_replace\(v_definition, ';\[\[:space:\]\]\*\$', ''\)/,
  );
  assert.match(
    enforcement,
    /select entitlement_filtered\.\* from \(%s\) as entitlement_filtered/,
  );
  assert.match(enforcement, /store_has_active_entitlement\(entitlement_filtered\.store_id\)/);
  assert.doesNotMatch(
    enforcement,
    /from public\.%I(?:\s+as)?\s+entitlement_filtered/,
    "the replacement must wrap the captured definition, not reference itself",
  );
  assert.match(enforcement, /resolve_store_entitlement\(v_store\.id\)/);
  assert.match(
    enforcement,
    /pg_get_functiondef\([\s\S]*evaluate_store_launch_readiness\(uuid,uuid\)/,
  );
  assert.doesNotMatch(enforcement, /evaluate_store_launch_readiness_pre_entitlement/);
  assert.match(enforcement, /create trigger orders_entitlement_guard[\s\S]*before insert on public\.orders/);
  assert.match(enforcement, /perform public\.assert_store_has_active_entitlement\(new\.store_id\)/);
  assert.match(enforcement, /before insert or update on public\.inventory_items/);
  assert.match(enforcement, /before insert or update on public\.hatching_egg_inventory_items/);
});

test("browser code does not call the internal resolver or provider writer", () => {
  const matches = [];

  for (const file of sourceFiles(resolve(root, "app"))) {
    const source = readFileSync(file, "utf8");
    if (
      source.includes('rpc("resolve_store_entitlement"') ||
      source.includes('rpc("apply_verified_stripe_subscription_event"')
    ) {
      matches.push(file);
    }
  }

  assert.deepEqual(matches, []);
});
