import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const foundationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260801100000_saas_billing_enrollment_foundation.sql",
);
const hardeningPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260801101000_payment_provider_authority_hardening.sql",
);
const previousMigrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260730213000_fix_public_storefront_plan_resolution.sql",
);
const payAtPickupAuthorityPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260717113000_order_detail_fulfillment_payment_actions.sql",
);

async function walkSource(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkSource(target)));
    else if (/\.(?:[cm]?[jt]sx?|json)$/.test(entry.name)) files.push(target);
  }

  return files;
}

async function readActiveApplicationSource() {
  const roots = ["app", "lib"];
  const files = [];

  for (const root of roots) {
    files.push(...(await walkSource(path.join(repositoryRoot, root))));
  }

  const contents = await Promise.all(
    files.map(async (file) => `${file}\n${await readFile(file, "utf8")}`),
  );
  return contents.join("\n");
}

test("the two Batch 1 migrations are append-only and ordered", async () => {
  const foundation = await readFile(foundationPath, "utf8");
  const hardening = await readFile(hardeningPath, "utf8");

  assert.ok(path.basename(previousMigrationPath) < path.basename(foundationPath));
  assert.ok(path.basename(foundationPath) < path.basename(hardeningPath));
  assert.match(foundation, /begin;[\s\S]*commit;/);
  assert.match(hardening, /begin;[\s\S]*commit;/);
  assert.doesNotMatch(foundation, /drop table|truncate table/i);
  assert.doesNotMatch(hardening, /drop table|truncate table/i);
});

test("the authority schema is present without enabling billing behavior", async () => {
  const foundation = await readFile(foundationPath, "utf8");

  for (const table of [
    "billing_customer_bindings",
    "billing_checkout_attempts",
    "billing_subscription_enrollments",
    "billing_trial_claims",
  ]) {
    assert.match(foundation, new RegExp(`create table public\\.${table}`));
    assert.match(
      foundation,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  }

  assert.match(
    foundation,
    /'saas_subscription_checkout_enabled', false/,
  );
  assert.match(foundation, /'saas_billing_portal_enabled', false/);
  assert.doesNotMatch(
    foundation,
    /create (?:or replace )?function public\.(?:create|begin|open)_.*checkout/i,
  );
  assert.doesNotMatch(foundation, /create.*webhook|billing portal session/i);
});

test("the trusted Price catalog fields are nullable and no Stripe IDs are seeded", async () => {
  const foundation = await readFile(foundationPath, "utf8");

  assert.match(foundation, /add column if not exists stripe_product_id text/);
  assert.match(foundation, /add column if not exists unit_amount_cents bigint/);
  assert.match(foundation, /add column if not exists currency text/);
  assert.match(foundation, /add column if not exists recurring_interval text/);
  assert.match(
    foundation,
    /add column if not exists recurring_interval_count integer/,
  );
  assert.doesNotMatch(
    foundation,
    /insert into public\.billing_provider_price_catalog/i,
  );
  assert.doesNotMatch(foundation, /'(?:price|prod|cus|sub|cs|evt)_[^']+'/);
});

test("new provider ledgers are browser-inaccessible and minimally service-writable", async () => {
  const foundation = await readFile(foundationPath, "utf8");

  for (const table of [
    "billing_customer_bindings",
    "billing_checkout_attempts",
    "billing_subscription_enrollments",
    "billing_trial_claims",
  ]) {
    assert.match(
      foundation,
      new RegExp(
        `revoke all on table public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`,
      ),
    );
  }

  assert.doesNotMatch(
    foundation,
    /grant (?:select|insert|update|delete)[^;]*billing_(?:customer_bindings|checkout_attempts|subscription_enrollments|trial_claims)[^;]*authenticated/i,
  );
  assert.match(
    foundation,
    /grant select, insert on table public\.billing_customer_bindings to service_role/,
  );
  assert.match(
    foundation,
    /grant select, insert on table public\.billing_trial_claims to service_role/,
  );
});

test("provider-truth RPC grants are removed from authenticated and retained for service role", async () => {
  const hardening = await readFile(hardeningPath, "utf8");

  for (const functionName of [
    "record_payment_provider_event",
    "mark_payment_provider_event_processed",
    "mark_payment_provider_event_failed",
    "record_stripe_checkout_session_for_order",
    "record_stripe_payment_succeeded",
    "record_stripe_payment_failed",
    "record_stripe_refund_result",
    "retry_payment_provider_event",
    "ignore_payment_provider_event",
    "record_integration_worker_started",
    "mark_integration_worker_completed",
    "mark_integration_worker_failed",
  ]) {
    assert.match(
      hardening,
      new RegExp(
        `revoke all on function public\\.${functionName}\\([\\s\\S]*?\\) from public, anon, authenticated, service_role`,
      ),
    );
    assert.match(
      hardening,
      new RegExp(
        `grant execute on function public\\.${functionName}\\([\\s\\S]*?\\) to service_role`,
      ),
    );
  }

  assert.doesNotMatch(
    hardening,
    /grant execute on function public\.[^;]+ to (?:[^;]*,\s*)?authenticated/i,
  );
});

test("platform admin is removed from internal provider authority assertions", async () => {
  const hardening = await readFile(hardeningPath, "utf8");
  const providerGuard = hardening.slice(
    hardening.indexOf(
      "create or replace function public.can_process_payment_provider_events()",
    ),
    hardening.indexOf(
      "comment on function public.can_process_payment_provider_events()",
    ),
  );
  const workerGuard = hardening.slice(
    hardening.indexOf(
      "create or replace function public.can_manage_integration_operations()",
    ),
    hardening.indexOf(
      "comment on function public.can_manage_integration_operations()",
    ),
  );

  for (const guard of [providerGuard, workerGuard]) {
    assert.match(guard, /auth\.role\(\)[\s\S]*= 'service_role'/);
    assert.doesNotMatch(guard, /is_admin|is_platform_admin/);
    assert.match(guard, /set search_path = pg_catalog, public/);
  }
});

test("Pay at Pickup remains a separate authenticated offline authority", async () => {
  const payAtPickup = await readFile(payAtPickupAuthorityPath, "utf8");
  const hardening = await readFile(hardeningPath, "utf8");
  const markPaid = payAtPickup.slice(
    payAtPickup.indexOf("create or replace function public.mark_order_paid("),
    payAtPickup.indexOf("create or replace function public.mark_order_pay_at_pickup("),
  );

  assert.match(markPaid, /v_order\.payment_provider <> 'offline'/);
  assert.match(markPaid, /v_order\.payment_method <> 'pay_at_pickup'/);
  assert.match(
    payAtPickup,
    /grant execute on function public\.mark_order_paid\(uuid, text\) to authenticated/,
  );
  assert.doesNotMatch(
    hardening,
    /(?:revoke|grant)[^;]*public\.mark_order_paid\(/i,
  );
});

test("Batch 1 introduced no Stripe API call, public variable, or application wiring", async () => {
  const activeSource = await readActiveApplicationSource();
  assert.doesNotMatch(activeSource, /from\s+["']stripe["']/);
  assert.doesNotMatch(activeSource, /import\(["']stripe["']\)/);
  assert.doesNotMatch(activeSource, /https:\/\/api\.stripe\.com/i);
  assert.doesNotMatch(activeSource, /NEXT_PUBLIC_[A-Z0-9_]*STRIPE/);
  assert.doesNotMatch(
    activeSource,
    /saas_subscription_checkout_enabled|saas_billing_portal_enabled/,
  );
  assert.doesNotMatch(
    activeSource,
    /billing_customer_bindings|billing_checkout_attempts|billing_subscription_enrollments|billing_trial_claims/,
  );
});

test("Batch 1 does not alter onboarding trial or entitlement resolution functions", async () => {
  const foundation = await readFile(foundationPath, "utf8");
  const hardening = await readFile(hardeningPath, "utf8");
  const combined = `${foundation}\n${hardening}`;

  assert.doesNotMatch(combined, /seller_save_onboarding_plan_access/);
  assert.doesNotMatch(combined, /resolve_store_entitlement\s*\(/);
  assert.doesNotMatch(combined, /evaluate_store_launch_readiness\s*\(/);
  assert.doesNotMatch(combined, /create_pay_at_pickup_order/);
});
