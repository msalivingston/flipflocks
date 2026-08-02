import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const authorityPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260801102000_saas_invoice_authority_foundation.sql",
);
const resolverPath = path.join(
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

test("Batch 2 migrations are ordered, forward-only, and leave feature flags untouched", async () => {
  const authority = await readFile(authorityPath, "utf8");
  const resolver = await readFile(resolverPath, "utf8");

  assert.ok(path.basename(authorityPath) < path.basename(resolverPath));
  assert.match(authority, /begin;[\s\S]*commit;/);
  assert.match(resolver, /begin;[\s\S]*commit;/);
  assert.doesNotMatch(`${authority}\n${resolver}`, /drop table|truncate table/i);
  assert.doesNotMatch(
    `${authority}\n${resolver}`,
    /saas_subscription_checkout_enabled[\s\S]*true|saas_billing_portal_enabled[\s\S]*true/i,
  );
});

test("typed invoice evidence has exact composite bindings and service-only storage", async () => {
  const authority = await readFile(authorityPath, "utf8");

  assert.match(authority, /create table public\.billing_subscription_invoices/);
  assert.match(
    authority,
    /foreign key \(\s*subscription_enrollment_id,\s*store_id,\s*customer_binding_id,\s*stripe_subscription_id,\s*stripe_livemode,\s*stripe_account_id\s*\)/,
  );
  assert.match(
    authority,
    /foreign key \(\s*customer_binding_id,\s*store_id,\s*stripe_customer_id,\s*stripe_livemode,\s*stripe_account_id\s*\)/,
  );
  assert.match(
    authority,
    /alter table public\.billing_subscription_invoices enable row level security/,
  );
  assert.match(
    authority,
    /revoke all on table public\.billing_subscription_invoices\s+from public, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(authority, /grant[^;]+billing_subscription_invoices[^;]+authenticated/i);
  assert.doesNotMatch(authority, /jsonb\s+(?:payload|invoice|provider_payload)/i);
});

test("only the successful verified invoice sink writes paid-through authority", async () => {
  const authority = await readFile(authorityPath, "utf8");
  const successStart = authority.indexOf(
    "create or replace function public.apply_verified_saas_invoice_payment_succeeded(",
  );
  const wrapperStart = authority.indexOf(
    "create or replace function public.apply_verified_saas_invoice_payment_failed(",
  );
  const beforeSuccess = authority.slice(0, successStart);
  const success = authority.slice(successStart, wrapperStart);
  const afterSuccess = authority.slice(wrapperStart);

  assert.match(success, /set[\s\S]*paid_through_at\s*=\s*greatest/);
  assert.match(success, /last_paid_stripe_invoice_id\s*=/);
  assert.doesNotMatch(
    beforeSuccess,
    /update public\.seller_billing_status[\s\S]{0,2500}?set[\s\S]{0,1500}?paid_through_at\s*=/i,
  );
  assert.doesNotMatch(
    afterSuccess,
    /update public\.seller_billing_status[\s\S]{0,2500}?set[\s\S]{0,1500}?paid_through_at\s*=/i,
  );
  assert.doesNotMatch(afterSuccess, /last_paid_stripe_invoice_id\s*=/);
});

test("invoice.paid and Subscription period snapshots cannot become enrollment-backed payment authority", async () => {
  const authority = await readFile(authorityPath, "utf8");
  const resolver = await readFile(resolverPath, "utf8");

  assert.match(authority, /'invoice\.payment_succeeded'/);
  assert.doesNotMatch(authority, /'invoice\.paid'/);
  assert.match(
    resolver,
    /current_subscription_enrollment_id is not null[\s\S]*last_paid_stripe_invoice_id[\s\S]*paid_through_at/,
  );
  const enrollmentBranch = resolver.slice(
    resolver.indexOf("if v_billing.current_subscription_enrollment_id is not null"),
    resolver.indexOf("else\n    -- Compatibility branch"),
  );
  assert.doesNotMatch(
    enrollmentBranch,
    /storefront_access_until\s*=\s*v_billing\.current_period_end/,
  );
  assert.match(
    resolver,
    /Subscription current_period_end is scheduling only/,
  );
});

test("all four public invoice sinks are fixed-path service-role contracts", async () => {
  const authority = await readFile(authorityPath, "utf8");
  for (const functionName of [
    "apply_verified_saas_invoice_payment_succeeded",
    "apply_verified_saas_invoice_payment_failed",
    "apply_verified_saas_invoice_payment_action_required",
    "apply_verified_saas_invoice_finalization_failed",
  ]) {
    assert.match(
      authority,
      new RegExp(`create or replace function public\\.${functionName}\\(`),
    );
    assert.match(
      authority,
      new RegExp(
        `revoke all on function public\\.${functionName}\\([\\s\\S]*?\\) from public, anon, authenticated, service_role`,
      ),
    );
    assert.match(
      authority,
      new RegExp(
        `grant execute on function public\\.${functionName}\\([\\s\\S]*?\\) to service_role`,
      ),
    );
  }
  assert.doesNotMatch(
    authority,
    /grant execute on function public\.apply_verified_saas_invoice_[^;]+authenticated/i,
  );
  assert.match(authority, /set search_path = pg_catalog, public/g);
});

test("Subscription snapshots retain scheduling value without writing invoice authority", async () => {
  const resolver = await readFile(resolverPath, "utf8");
  const subscriptionStart = resolver.indexOf(
    "create or replace function public.apply_verified_stripe_subscription_event(",
  );
  const subscriptionFunction = resolver.slice(subscriptionStart);

  assert.match(subscriptionFunction, /current_period_start = p_current_period_start/);
  assert.match(subscriptionFunction, /current_period_end = p_current_period_end/);
  assert.doesNotMatch(subscriptionFunction, /paid_through_at\s*=/);
  assert.doesNotMatch(subscriptionFunction, /last_paid_stripe_invoice_id\s*=/);
  assert.doesNotMatch(subscriptionFunction, /update public\.stores[\s\S]*storefront_enabled/);
  assert.match(
    subscriptionFunction,
    /apply_verified_stripe_subscription_event_legacy_compat/,
  );
});

test("Batch 2 introduced no Stripe API, secret, public variable, or Edge Function", async () => {
  const source = await readApplicationSource();
  assert.doesNotMatch(source, /from\s+["']stripe["']/);
  assert.doesNotMatch(source, /https:\/\/api\.stripe\.com/i);
  assert.doesNotMatch(source, /NEXT_PUBLIC_[A-Z0-9_]*STRIPE/);
  assert.doesNotMatch(source, /apply_verified_saas_invoice_/);
  assert.doesNotMatch(source, /billing_subscription_invoices/);
});

test("Batch 2 does not wire onboarding, Checkout, Portal, refunds, or Pay at Pickup", async () => {
  const authority = await readFile(authorityPath, "utf8");
  const resolver = await readFile(resolverPath, "utf8");
  const combined = `${authority}\n${resolver}`;

  assert.doesNotMatch(combined, /seller_save_onboarding_plan_access/);
  assert.doesNotMatch(combined, /create_pay_at_pickup_order|mark_order_paid/);
  assert.doesNotMatch(combined, /order_refunds|record_stripe_refund_result/);
  assert.doesNotMatch(
    combined,
    /create (?:or replace )?function public\.[^(]*(?:checkout|portal|webhook)/i,
  );
});
