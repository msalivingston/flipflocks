import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260801104000_requested_only_onboarding_transition.sql",
);
const batch2ResolverPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260801103000_invoice_backed_entitlement_resolution.sql",
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else if (/\.(?:[cm]?[jt]sx?|json)$/.test(entry.name)) files.push(target);
  }
  return files;
}

async function readApplicationSource() {
  const files = [];
  for (const root of ["app", "lib"]) {
    files.push(...(await walk(path.join(repositoryRoot, root))));
  }
  return (
    await Promise.all(files.map(async (file) => await readFile(file, "utf8")))
  ).join("\n");
}

test("Batch 3 is one ordered forward-only migration and leaves Checkout disabled", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.ok(path.basename(batch2ResolverPath) < path.basename(migrationPath));
  assert.match(migration, /begin;[\s\S]*commit;/);
  assert.doesNotMatch(migration, /drop table|truncate table/i);
  assert.match(
    migration,
    /values \('saas_subscription_checkout_enabled', false\)/,
  );
  assert.doesNotMatch(
    migration,
    /saas_subscription_checkout_enabled[^;]{0,500}(?:=|values?)[^;]{0,100}true/i,
  );
});

test("pending Checkout is requested-only and structurally excludes all access authority", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const constraint = migration.slice(
    migration.indexOf(
      "add constraint seller_billing_status_pending_checkout_consistency_check",
    ),
    migration.indexOf(
      "comment on constraint seller_billing_status_pending_checkout_consistency_check",
    ),
  );

  assert.match(constraint, /requested_plan_key in \('small_flock', 'full_flock'\)/);
  assert.match(constraint, /requested_billing_cadence in \('monthly', 'yearly'\)/);
  assert.match(constraint, /plan_key is null/);
  assert.match(constraint, /billing_plan is null/);
  assert.match(constraint, /subscription_status = 'dormant'/);
  for (const field of [
    "trial_started_at",
    "trial_ends_at",
    "current_period_start",
    "current_period_end",
    "storefront_access_until",
    "paid_through_at",
    "grace_ends_at",
    "stripe_customer_id",
    "stripe_subscription_id",
    "stripe_price_id",
    "stripe_livemode",
    "stripe_account_id",
    "current_subscription_enrollment_id",
    "latest_stripe_invoice_id",
    "last_paid_stripe_invoice_id",
    "last_provider_event_id",
  ]) {
    assert.match(constraint, new RegExp(`${field} is null`));
  }
  assert.match(constraint, /cancel_at_period_end = false/);
});

test("disabled mode retains an isolated private copy of the local-trial implementation", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const helperStart = migration.indexOf(
    "create function public.seller_save_onboarding_plan_access_local_trial_compat(",
  );
  const wrapperStart = migration.indexOf(
    "create or replace function public.seller_save_onboarding_plan_access(p_plan jsonb)",
  );
  const helper = migration.slice(helperStart, wrapperStart);
  const wrapper = migration.slice(wrapperStart);

  assert.match(helper, /v_now \+ interval '7 days'/);
  assert.match(helper, /billing_state_authority,[\s\S]*'trial'/);
  assert.match(helper, /billing_complete = true/);
  assert.match(helper, /'trial_started' else 'trial_selection_changed'/);
  assert.match(
    migration,
    /revoke all on function public\.seller_save_onboarding_plan_access_local_trial_compat\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    wrapper,
    /if not coalesce\(v_checkout_enabled, false\) then[\s\S]*seller_save_onboarding_plan_access_local_trial_compat\(p_plan\)/,
  );
});

test("requested-only branch writes only requested intent and cannot complete billing", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const wrapper = migration.slice(
    migration.indexOf(
      "create or replace function public.seller_save_onboarding_plan_access(p_plan jsonb)",
    ),
  );
  const pendingInsert = wrapper.slice(
    wrapper.indexOf("insert into public.seller_billing_status ("),
    wrapper.indexOf("if v_created or v_changed then"),
  );
  const pendingUpdate = pendingInsert.slice(
    pendingInsert.indexOf("update public.seller_billing_status as status"),
  );

  assert.match(pendingInsert, /plan_key,[\s\S]*billing_plan/);
  assert.match(
    pendingInsert,
    /v_requested_plan,[\s\S]*v_requested_cadence,[\s\S]*null,[\s\S]*null,[\s\S]*'dormant',[\s\S]*'pending_checkout'/,
  );
  assert.match(pendingUpdate, /requested_plan_key = v_requested_plan/);
  assert.match(
    pendingUpdate,
    /requested_billing_cadence = v_requested_cadence/,
  );
  assert.doesNotMatch(pendingUpdate, /trial_(?:started|ends)_at\s*=/);
  assert.doesNotMatch(pendingUpdate, /stripe_(?:customer|subscription|price)_id\s*=/);
  assert.doesNotMatch(wrapper, /billing_complete\s*=\s*true/);
  assert.match(
    wrapper,
    /null::text,[\s\S]*null::text,[\s\S]*'dormant'::text,[\s\S]*false,[\s\S]*4/,
  );
});

test("one-trial guards use verified evidence and standalone Checkout attempts remain neutral", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const wrapper = migration.slice(
    migration.indexOf(
      "create or replace function public.seller_save_onboarding_plan_access(p_plan jsonb)",
    ),
  );
  const insertAt = wrapper.indexOf("insert into public.seller_billing_status (");

  assert.ok(wrapper.indexOf("billing_trial_claims") < insertAt);
  assert.ok(wrapper.indexOf("billing_subscription_enrollments") < insertAt);
  assert.ok(wrapper.indexOf("billing_customer_bindings") < insertAt);
  assert.doesNotMatch(
    wrapper.slice(0, insertAt),
    /from public\.billing_checkout_attempts/,
  );
  assert.match(
    wrapper,
    /Checkout-attempt history is deliberately absent from the eligibility[\s\S]*does not prove that a trial began/,
  );
  assert.match(wrapper, /Trial already used; a paid subscription is required\./);
  assert.match(
    wrapper,
    /billing_state_authority <> 'pending_checkout'[\s\S]*Plan access is already established/,
  );
  assert.match(wrapper, /admin_hold_reason is not null/);
});

test("public RPC accepts seller intent only and preserves owner and grant boundaries", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const wrapper = migration.slice(
    migration.indexOf(
      "create or replace function public.seller_save_onboarding_plan_access(p_plan jsonb)",
    ),
  );

  assert.match(wrapper, /set search_path = pg_catalog, public/);
  assert.match(wrapper, /where stores.owner_user_id = v_user_id/);
  assert.match(
    wrapper,
    /supplied\.key not in \([\s\S]*'requested_plan_key',[\s\S]*'requested_billing_cadence'[\s\S]*\)/,
  );
  assert.match(
    wrapper,
    /revoke all on function public\.seller_save_onboarding_plan_access\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    wrapper,
    /grant execute on function public\.seller_save_onboarding_plan_access\(jsonb\)[\s\S]*to authenticated/,
  );
  assert.doesNotMatch(migration, /grant (?:insert|update)[^;]+seller_billing_status[^;]+authenticated/i);
});

test("Batch 3 introduced no Stripe API, secret, public variable, or payment endpoint", async () => {
  const source = await readApplicationSource();
  assert.doesNotMatch(source, /from\s+["']stripe["']/);
  assert.doesNotMatch(source, /https:\/\/api\.stripe\.com/i);
  assert.doesNotMatch(source, /NEXT_PUBLIC_[A-Z0-9_]*STRIPE/);
  assert.doesNotMatch(source, /saas_subscription_checkout_enabled/);
  assert.doesNotMatch(source, /pending_checkout/);
  assert.doesNotMatch(source, /apply_verified_saas_invoice_/);
});

test("Batch 3 changes no React, Next.js, Pay at Pickup, refund, or provider application file", async () => {
  const { stdout } = await execFileAsync("git", ["diff", "4627418..52897d8", "--name-only"], {
    cwd: repositoryRoot,
  });
  const changed = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.trim());

  assert.ok(changed.length >= 1);
  assert.ok(
    changed.every(
      (file) =>
        file ===
          "supabase/migrations/20260801104000_requested_only_onboarding_transition.sql" ||
        file ===
          "supabase/tests/requested_only_onboarding_transition_test.sql" ||
        file ===
          "supabase/tests/requested_only_onboarding_concurrency_test.sql" ||
        file === "tests/requested-only-onboarding-transition.test.mjs",
    ),
  );
  assert.ok(changed.every((file) => !/\.(?:tsx?|jsx?)$/.test(file)));
  assert.ok(changed.every((file) => !file.startsWith("supabase/functions/")));
});

test("invoice-backed authority remains in Batch 2 and is not redefined by Batch 3", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const batch2Resolver = await readFile(batch2ResolverPath, "utf8");

  assert.match(
    batch2Resolver,
    /last_paid_stripe_invoice_id[\s\S]*paid_through_at/,
  );
  assert.match(batch2Resolver, /payment_grace/);
  assert.doesNotMatch(migration, /apply_verified_saas_invoice_/);
  assert.doesNotMatch(migration, /create or replace function public\.resolve_store_entitlement/);
  assert.doesNotMatch(migration, /create or replace function public\.get_seller_context/);
  assert.doesNotMatch(migration, /create or replace function public\.get_store_plan_key/);
});

test("Batch 3 introduces no Pay at Pickup, refund, Connect, Checkout, Portal, or webhook behavior", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.doesNotMatch(migration, /create_pay_at_pickup_order|mark_order_paid/);
  assert.doesNotMatch(migration, /order_refunds|record_stripe_refund_result/);
  assert.doesNotMatch(migration, /connected_account|account_link|application_fee/i);
  assert.doesNotMatch(
    migration,
    /create (?:or replace )?function public\.[^(]*(?:checkout_session|portal|webhook)/i,
  );
  assert.doesNotMatch(migration, /https:\/\/api\.stripe\.com/i);
});
