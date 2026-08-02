import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(root, "supabase/migrations/20260801105000_trusted_saas_price_catalog_registration.sql");
const runtimePath = path.join(root, "supabase/functions/_shared/stripe-saas-runtime.mjs");
const clientPath = path.join(root, "supabase/functions/_shared/stripe-saas-client.ts");
const utilityPath = path.join(root, "scripts/stripe/register-saas-price.mjs");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(target));
    else result.push(target);
  }
  return result;
}

test("official server SDK and API version are exactly pinned across runtimes", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const runtime = await readFile(runtimePath, "utf8");
  const client = await readFile(clientPath, "utf8");
  assert.equal(packageJson.dependencies.stripe, "22.3.2");
  assert.match(runtime, /STRIPE_SAAS_SDK_VERSION = "22\.3\.2"/);
  assert.match(runtime, /STRIPE_SAAS_API_VERSION = "2026-06-24\.dahlia"/);
  assert.match(client, /from "npm:stripe@22\.3\.2"/);
  assert.match(client, /apiVersion: STRIPE_SAAS_API_VERSION/);
  assert.ok(!("@stripe/stripe-js" in packageJson.dependencies));
});

test("catalog utility is read-only toward Stripe and defaults to dry-run", async () => {
  const utility = await readFile(utilityPath, "utf8");
  assert.match(utility, /let apply = false/);
  assert.doesNotMatch(utility, /accounts\s*\.\s*retrieve|stripe\s*\.\s*accounts/);
  assert.match(utility, /stripe\.prices\.retrieve\(args\.stripePriceId\)/);
  assert.match(utility, /stripe\.products\.retrieve\(productId\)/);
  assert.doesNotMatch(utility, /stripe\.(?:products|prices)\.(?:create|update|del|archive)\s*\(/);
  assert.doesNotMatch(utility, /https:\/\/api\.stripe\.com/);
  assert.match(utility, /STRIPE_SAAS_UTILITY_LIVE_MODE_REFUSED/);
});

test("migration exposes only service-role catalog contracts and seeds no IDs", async () => {
  const migration = await readFile(migrationPath, "utf8");
  for (const name of ["register_verified_saas_price", "deactivate_verified_saas_price", "resolve_verified_saas_price"]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated, service_role`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`));
  }
  assert.doesNotMatch(migration, /insert into public\.billing_provider_price_catalog\s*\([^)]*\)\s*values\s*\(\s*'price_/i);
  assert.doesNotMatch(migration, /saas_(?:subscription_checkout|billing_portal)_enabled[^;]*true/i);
});

test("Batch 4 adds no billing endpoint, browser variable, or browser Stripe package", async () => {
  const functionEntries = await readdir(path.join(root, "supabase/functions"), { withFileTypes: true });
  const names = functionEntries.filter((entry) => entry.isDirectory() && entry.name !== "_shared").map((entry) => entry.name);
  assert.ok(names.every((name) => !/(?:checkout|webhook|portal|subscription)/i.test(name)));
  const files = [];
  for (const directory of ["app", "lib", "supabase/functions"]) {
    files.push(...await walk(path.join(root, directory)));
  }
  const relevant = files.filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));
  const source = (await Promise.all(relevant.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /NEXT_PUBLIC_[A-Z0-9_]*STRIPE/);
  assert.doesNotMatch(source, /(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}/);
});

test("production Batch 4 files contain no committed provider object identifiers", async () => {
  const files = [migrationPath, runtimePath, clientPath, utilityPath, path.join(root, "docs/stripe-saas-catalog-registration.md")];
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8"))))
    .join("\n")
    .replaceAll("acct_1CTOghL1R5g4hhXt", "approved-safe-account-id");
  assert.doesNotMatch(source, /["'](?:price|prod|acct)_[A-Za-z0-9]{12,}["']/);
});

test("documentation requires only sandbox Product and Price read permissions", async () => {
  const documentation = await readFile(path.join(root, "docs/stripe-saas-catalog-registration.md"), "utf8");
  assert.match(documentation, /Products: Read/);
  assert.match(documentation, /Prices: Read/);
  assert.match(documentation, /Everything else: None/);
  assert.match(documentation, /No Accounts permission is required/);
  assert.match(documentation, /does not call the Stripe Accounts API/);
  assert.match(documentation, /validated operator configuration, not provider-retrieved evidence/);
  assert.match(documentation, /--confirm-environment=<environment-id>[\s\S]*--confirm-account=acct_1CTOghL1R5g4hhXt/);
});

test("no onboarding, entitlement, Pay at Pickup, refund, or Connect application file changed", async () => {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], { cwd: root });
  const changed = stdout.split(/\r?\n/).filter((line) => line.trim()).map((line) => line.slice(3));
  const allowed = [
    "docs/stripe-saas-catalog-registration.md",
    "scripts/stripe/register-saas-price.mjs",
    "supabase/functions/_shared/stripe-saas-runtime.mjs",
    "tests/stripe-saas-runtime.test.mjs",
    "tests/stripe-saas-batch4-source-contract.test.mjs",
  ];
  assert.deepEqual(changed.sort(), allowed.sort());
  assert.ok(changed.every((file) => !file.startsWith("app/") && !file.startsWith("lib/")));
  assert.ok(changed.every((file) => !/(pay-at-pickup|refund|connect)/i.test(file)));
});
