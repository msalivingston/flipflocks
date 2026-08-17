import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const migrationPath =
  "supabase/migrations/20260821100000_admin_comp_completes_onboarding_billing.sql";

test("an administrative comp completes only the billing checkpoint after its audited entitlement grant", async () => {
  const migration = await read(migrationPath);
  const grant = migration.slice(
    migration.indexOf("create function public.admin_grant_store_comp("),
    migration.indexOf("comment on function public.admin_grant_store_comp("),
  );

  assert.match(
    migration,
    /rename to admin_grant_store_comp_entitlement_v1/,
  );
  assert.match(
    grant,
    /perform public\.admin_grant_store_comp_entitlement_v1\([\s\S]*p_store_id,[\s\S]*p_plan_key,[\s\S]*p_reason,[\s\S]*p_expires_at/,
  );
  assert.match(
    grant,
    /update public\.seller_onboarding_state\s+set billing_complete = true\s+where store_id = p_store_id\s+and billing_complete = false/,
  );
  assert.doesNotMatch(
    grant,
    /(?:profile_complete|storefront_details_complete|categories_complete|pickup_complete|onboarding_complete)\s*=/,
  );
  assert.doesNotMatch(grant, /stripe_|trial_|billing_checkout_attempts/i);
});

test("currently active administrative comps are repaired through the authoritative entitlement resolver", async () => {
  const migration = await read(migrationPath);
  const backfill = migration.slice(
    migration.indexOf("update public.seller_onboarding_state as onboarding"),
    migration.indexOf("commit;"),
  );

  assert.match(backfill, /from lateral public\.resolve_store_entitlement\(onboarding\.store_id\) as entitlement/);
  assert.match(backfill, /onboarding\.billing_complete = false/);
  assert.match(backfill, /entitlement\.has_active_access/);
  assert.match(backfill, /entitlement\.access_reason = 'admin_comp'/);
  assert.doesNotMatch(
    backfill,
    /(?:profile_complete|storefront_details_complete|categories_complete|pickup_complete|onboarding_complete)\s*=/,
  );
});

test("the existing onboarding router advances a billing-complete seller to the next incomplete setup step without Stripe", async () => {
  const [flow, planForm, migration] = await Promise.all([
    read("app/onboarding/_components/onboarding-flow.tsx"),
    read("app/onboarding/_components/step-5-plan-access-form.tsx"),
    read(migrationPath),
  ]);

  assert.match(
    flow,
    /else if \(!progress\?\.billing_complete\)[\s\S]*setView\("step3"\)[\s\S]*else if \(!progress\.storefront_details_complete\)[\s\S]*setView\("step4"\)/,
  );
  assert.match(planForm, /supabase\.functions\.invoke\(\s*"stripe-saas-checkout"/);
  assert.doesNotMatch(migration, /stripe_|trial_|billing_checkout_attempts/i);
});
