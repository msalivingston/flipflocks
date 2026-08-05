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
const promptPath = path.join(root, "scripts/stripe/secure-secret-prompt.mjs");
const clipboardPath = path.join(root, "scripts/stripe/windows-clipboard-secret.mjs");
const verifierPath = path.join(root, "scripts/stripe/verify-saas-catalog.mjs");
const localFormPath = path.join(root, "scripts/stripe/local-catalog-key-form.mjs");

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
  assert.equal(
    packageJson.scripts["stripe:verify-saas-catalog"],
    "node scripts/stripe/verify-saas-catalog.mjs",
  );
});

test("catalog utility is read-only toward Stripe and defaults to dry-run", async () => {
  const utility = await readFile(utilityPath, "utf8");
  const prompt = await readFile(promptPath, "utf8");
  const clipboard = await readFile(clipboardPath, "utf8");
  const runtime = await readFile(runtimePath, "utf8");
  const verifier = await readFile(verifierPath, "utf8");
  const localForm = await readFile(localFormPath, "utf8");
  assert.match(utility, /let apply = false/);
  assert.match(utility, /parseStripeSaasCatalogConfig\(configSource\)/);
  assert.doesNotMatch(utility, /\boperationalApiKey\b|STRIPE_SAAS_API_KEY/);
  assert.doesNotMatch(`${utility}\n${prompt}\n${clipboard}`, /node:fs|writeFile|appendFile|createWriteStream/);
  assert.doesNotMatch(utility, /--(?:catalog-read-key|stripe-key|api-key)(?:=|\b)/);
  assert.doesNotMatch(`${utility}\n${clipboard}`, /process\.env\s*\.|Object\.assign\(process\.env/);
  assert.match(clipboard, /execFile/);
  assert.match(clipboard, /Get-Clipboard -Raw/);
  assert.match(clipboard, /Set-Clipboard -Value \(\[string\]::Empty\)/);
  assert.doesNotMatch(clipboard, /shell\s*:\s*true/);
  assert.match(prompt, /input\.setRawMode\(true\)/);
  assert.match(prompt, /input\.setRawMode\(priorRawMode\)/);
  assert.doesNotMatch(prompt, /output\.write\([^)]*(?:value|character|chunk)/);
  assert.match(runtime, /export function parseStripeSaasConfig\(source\)[\s\S]*?required\(source, "STRIPE_SAAS_API_KEY"\)/);
  assert.match(runtime, /export function parseStripeSaasCatalogConfig\(source\)[\s\S]*?required\(source, "STRIPE_SAAS_CATALOG_READ_KEY"\)/);
  assert.doesNotMatch(utility, /accounts\s*\.\s*retrieve|stripe\s*\.\s*accounts/);
  assert.match(utility, /stripe\.prices\.retrieve\(args\.stripePriceId\)/);
  assert.match(utility, /stripe\.products\.retrieve\(productId\)/);
  assert.doesNotMatch(utility, /stripe\.(?:products|prices)\.(?:create|update|del|archive)\s*\(/);
  assert.doesNotMatch(utility, /https:\/\/api\.stripe\.com/);
  assert.match(utility, /STRIPE_SAAS_UTILITY_LIVE_MODE_REFUSED/);
  assert.match(verifier, /parseCatalogVerifierArguments\(argv\)/);
  assert.match(verifier, /parseCatalogApplyConfig\(credentialSource\)/);
  assert.match(verifier, /const REGISTER_VERIFIED_SAAS_PRICE_RPC = "register_verified_saas_price"/);
  assert.match(verifier, /if \(!args\.apply \|\| !verification\.passed\) return verification/);
  assert.match(verifier, /const supabase = createSupabaseClient/);
  assert.match(verifier, /await supabase\.rpc\(\s*REGISTER_VERIFIED_SAAS_PRICE_RPC/);
  assert.doesNotMatch(verifier, /deactivate_verified_saas_price|resolve_verified_saas_price/);
  assert.doesNotMatch(verifier, /saas_subscription_checkout_enabled|saas_billing_portal_enabled/);
  assert.doesNotMatch(verifier, /\.(?:create|update|del|archive)\s*\(/);
  assert.match(verifier, /const stripe = createStripeClient\(config\.catalogReadApiKey\)/);
  assert.match(verifier, /const manifest = config\.livemode[\s\S]*APPROVED_LIVE_SAAS_CATALOG_MANIFEST[\s\S]*APPROVED_SAAS_CATALOG_MANIFEST/);
  assert.match(verifier, /for \(const entry of manifest\)/);
  assert.match(verifier, /if \(!result\.passed\) process\.exitCode = 1/);
  assert.doesNotMatch(verifier, /process\.env\s*\.|Object\.assign\(process\.env/);
  assert.doesNotMatch(verifier, /promptFor|readHidden|rawMode|clipboard|key-from-clipboard/i);
  assert.doesNotMatch(`${verifier}\n${localForm}`, /node:fs|writeFile|appendFile|createWriteStream/);
  assert.match(localForm, /server\.listen\(0, LOOPBACK_HOST/);
  assert.match(localForm, /const LOOPBACK_HOST = "127\.0\.0\.1"/);
  assert.match(localForm, /randomBytesFn\(32\)/);
  assert.match(localForm, /type=\"password\"/);
  assert.match(localForm, /name=\"supabase_url\" type=\"url\"/);
  assert.match(localForm, /name=\"supabase_service_role_key\" type=\"password\"/);
  assert.match(localForm, /parsed\.protocol !== \"https:\"/);
  assert.match(localForm, /credentials\.supabaseServiceRoleKey = null/);
  assert.doesNotMatch(localForm, /process\.env\s*\.|Object\.assign\(process\.env/);
  for (const header of ["Cache-Control", "Referrer-Policy", "Content-Security-Policy", "X-Content-Type-Options"]) {
    assert.match(localForm, new RegExp(header));
  }
  assert.doesNotMatch(localForm, /<script|console\.(?:log|error)|request body/i);
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

test("post-Batch-4 billing work adds only approved SaaS server endpoints and no browser Stripe SDK surface", async () => {
  const functionEntries = await readdir(path.join(root, "supabase/functions"), { withFileTypes: true });
  const names = functionEntries.filter((entry) => entry.isDirectory() && entry.name !== "_shared").map((entry) => entry.name);
  assert.deepEqual(
    names.filter((name) => /(?:checkout|webhook|portal|subscription)/i.test(name)).sort(),
    [
      "stripe-saas-checkout",
      "stripe-saas-portal",
      "stripe-saas-subscription-action",
      "stripe-saas-webhook",
    ],
  );
  const files = [];
  for (const directory of ["app", "lib", "supabase/functions"]) {
    files.push(...await walk(path.join(root, directory)));
  }
  const relevant = files.filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));
  const source = (await Promise.all(relevant.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /NEXT_PUBLIC_[A-Z0-9_]*STRIPE/);
  assert.doesNotMatch(source, /(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}/);
});

test("catalog files contain no provider object identifiers outside the approved manifests", async () => {
  const files = [
    migrationPath, runtimePath, clientPath, utilityPath, promptPath, clipboardPath,
    verifierPath, localFormPath,
    path.join(root, "docs/stripe-saas-catalog-registration.md"),
  ];
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8"))))
    .join("\n")
    .replaceAll("acct_1CTOghL1R5g4hhXt", "approved-safe-account-id")
    .replaceAll("price_1TzpKSL1R5g4hhXtWhItRai3", "approved-price")
    .replaceAll("price_1TzpKSL1R5g4hhXtv4yG6PWt", "approved-price")
    .replaceAll("price_1TzpLxL1R5g4hhXtHn9Vg6Qd", "approved-price")
    .replaceAll("price_1TzpMhL1R5g4hhXt266qwLn5", "approved-price")
    .replaceAll("prod_UzoyVYb4UGqW3m", "approved-product")
    .replaceAll("prod_Uzoz8CeVMRC3zQ", "approved-product")
    .replaceAll("price_1U1A6TL1R5g4hhXttRzdEkpO", "approved-live-price")
    .replaceAll("price_1U1A6TL1R5g4hhXtXV8oONZy", "approved-live-price")
    .replaceAll("price_1U1A6PL1R5g4hhXtsuBhV0pk", "approved-live-price")
    .replaceAll("price_1U1A6PL1R5g4hhXtandGNw8C", "approved-live-price")
    .replaceAll("prod_V1CV3zEif7505x", "approved-live-product")
    .replaceAll("prod_V1CVBoupdvIdFd", "approved-live-product");
  assert.doesNotMatch(source, /["'](?:price|prod|acct)_[A-Za-z0-9]{12,}["']/);
});

test("documentation requires only Product and Price read permissions for catalog verification", async () => {
  const documentation = await readFile(path.join(root, "docs/stripe-saas-catalog-registration.md"), "utf8");
  assert.match(documentation, /Products: Read/);
  assert.match(documentation, /Prices: Read/);
  assert.match(documentation, /Everything else: None/);
  assert.match(documentation, /No Accounts permission is required/);
  assert.match(documentation, /does not call the Stripe Accounts API/);
  assert.match(documentation, /validated operator configuration, not provider-retrieved evidence/);
  assert.match(documentation, /--confirm-environment=<environment-id>[\s\S]*--confirm-account=acct_1CTOghL1R5g4hhXt/);
  assert.match(documentation, /npm run stripe:verify-saas-catalog/);
  assert.match(documentation, /npm run stripe:verify-saas-catalog -- --apply --confirm-environment=local --confirm-account=acct_1CTOghL1R5g4hhXt/);
  assert.match(documentation, /SUPABASE_URL/);
  assert.match(documentation, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(documentation, /none are registered/);
  assert.match(documentation, /temporary local browser form/);
  assert.match(documentation, /127\.0\.0\.1/);
  assert.match(documentation, /never uses terminal raw-mode input, clipboard acquisition, a key file/);
  assert.doesNotMatch(documentation, /PowerShell|SecureString|clipboard script|text file/i);
  assert.doesNotMatch(documentation, /STRIPE_SAAS_CATALOG_READ_KEY\s*=/);
});

test("current SaaS billing batch changes no Pay at Pickup, refund, or Connect application file", async () => {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], { cwd: root });
  const changed = stdout.split(/\r?\n/).filter((line) => line.trim()).map((line) => line.slice(3));
  assert.ok(changed.every((file) => !/(pay-at-pickup|refund|connect)/i.test(file)));
  const batch9Ui = /^app\/(?:dashboard\/(?:_components\/seller-(?:app-shell|billing-banner|billing-context)|account\/(?:seller-account|subscription-billing-panel))|onboarding\/(?:page|_components\/(?:onboarding-flow|step-5-plan-access-form)|billing\/return\/(?:page|stripe-return-status)))\.tsx$/;
  assert.ok(changed.every((file) => batch9Ui.test(file)
    || /^app\/admin\/[^/]+\/(?:page|[^/]+-form)\.tsx$/.test(file)
    || /^app\/admin\/stripe-subscription-resync\/(?:page|stripe-subscription-resync-form)\.tsx$/.test(file)
    || /^(?:package\.json|scripts\/stripe\/[^/]+\.mjs|lib\/saas-billing-(?:status|management)\.ts|docs\/stripe-saas-|supabase\/(?:config\.toml|functions\/(?:_shared\/stripe-saas-|stripe-saas-)|migrations\/(?:20260802|2026080310(?:0000|1000|2000|3000|4000|5000|6000)_saas_)|tests\/(?:seller_saas_|verified_saas_|saas_))|tests\/(?:authoritative-entitlements|seller-saas-|stripe-saas-))/.test(file)));
});
