import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(root, "supabase/migrations/20260802100000_saas_checkout_attempt_contracts.sql");
const indexPath = path.join(root, "supabase/functions/stripe-saas-checkout/index.ts");
const handlerPath = path.join(root, "supabase/functions/stripe-saas-checkout/handler.ts");
const concurrencyPath = path.join(root, "supabase/tests/saas_checkout_attempt_concurrency_test.sql");

test("Checkout endpoint is JWT-authenticated, feature-gated, and service bounded", async () => {
  const [config, migration, index, handler] = await Promise.all([
    readFile(path.join(root, "supabase/config.toml"), "utf8"),
    readFile(migrationPath, "utf8"),
    readFile(indexPath, "utf8"),
    readFile(handlerPath, "utf8"),
  ]);

  assert.match(config, /\[functions\.stripe-saas-checkout\]\s*verify_jwt = true/);
  assert.match(index, /\.auth\.getUser\(\)/);
  assert.doesNotMatch(index, /jwtDecode|atob\(|getSession\(/);
  assert.match(migration, /saas_subscription_checkout_enabled[\s\S]*?SAAS_CHECKOUT_DISABLED/);
  assert.match(migration, /grant execute on function public\.begin_saas_subscription_checkout\([\s\S]*?to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.(?:begin|record|mark|get_resumable)_saas_checkout[\s\S]*?to authenticated/);
  assert.match(handler, /allowedBodyKeys = new Set\(\["plan_key", "billing_cadence"\]\)/);
});

test("all SaaS function entrypoints use the shared production runtime safeguard", async () => {
  const entrypoints = await Promise.all([
    "stripe-saas-checkout",
    "stripe-saas-webhook",
    "stripe-saas-portal",
    "stripe-saas-subscription-action",
  ].map((name) => readFile(
    path.join(root, `supabase/functions/${name}/index.ts`),
    "utf8",
  )));

  for (const source of entrypoints) {
    assert.match(source, /assertStripeSaasRuntimeEnvironment\(/);
    assert.doesNotMatch(source, /Live SaaS .*not enabled in this batch/);
  }
});

test("Stripe parameters are server-owned, subscription-only, and trial decision is trusted", async () => {
  const [index, handler] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(handlerPath, "utf8"),
  ]);
  assert.match(index, /mode: "subscription"/);
  assert.match(index, /payment_method_types: \["card"\]/);
  assert.match(index, /payment_method_collection: "always"/);
  assert.match(index, /wallet_options: \{ link: \{ display: "never" \} \}/);
  assert.doesNotMatch(index, /automatic_payment_methods|excluded_payment_method_types/);
  assert.doesNotMatch(
    index,
    /payment_method_types:\s*\[[^\]]*(?:cashapp|us_bank_account|link|customer_balance|pay_by_bank|ach)/,
  );
  assert.match(index, /line_items: \[\{ price: attempt\.stripe_price_id!, quantity: 1 \}\]/);
  assert.match(index, /attempt\.trial_eligibility === "trial_eligible"[\s\S]*?trial_period_days: 7/);
  assert.match(index, /success_url:[\s\S]*?publicSiteOrigin/);
  assert.match(index, /cancel_url:[\s\S]*?publicSiteOrigin/);
  assert.match(index, /idempotencyKey: attempt\.stripe_idempotency_key!/);
  assert.match(index, /user\.email/);
  assert.match(index, /checkoutCustomerParameters\(attempt, authenticatedEmail\)/);
  assert.doesNotMatch(handler, /allowedBodyKeys[^\n]*email/);
  assert.doesNotMatch(index, /price_1Tzp|prod_Uzo/);
  assert.doesNotMatch(index, /success_url.*request|cancel_url.*request/i);
  assert.doesNotMatch(index, /NEXT_PUBLIC_[A-Z0-9_]*STRIPE|publishable/i);
});

test("database attempt history is trial-neutral and no authority is granted", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /v_trial_used := v_billing\.trial_started_at is not null[\s\S]*?billing_trial_claims[\s\S]*?billing_subscription_enrollments/);
  assert.doesNotMatch(migration.match(/v_trial_used :=[\s\S]*?v_trial_state :=/)?.[0] ?? "", /billing_checkout_attempts/);
  assert.doesNotMatch(migration, /insert into public\.billing_trial_claims/);
  assert.doesNotMatch(migration, /insert into public\.billing_subscription_enrollments/);
  assert.doesNotMatch(migration, /update public\.seller_onboarding_state/);
  assert.doesNotMatch(migration, /update public\.seller_billing_status/);
  assert.doesNotMatch(migration, /resolve_store_entitlement/);
  assert.match(migration, /update public\.platform_settings[\s\S]*?boolean_value = false/);
});

test("provider identifiers and trusted Price cannot come from the request", async () => {
  const [migration, handler] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(handlerPath, "utf8"),
  ]);
  assert.match(migration, /resolve_verified_saas_price\(/);
  assert.match(migration, /stripe_price_id is distinct from old\.stripe_price_id/);
  assert.match(migration, /stripe_product_id is distinct from old\.stripe_product_id/);
  assert.doesNotMatch(handler, /record\.stripe_(?:price|product|customer|subscription|checkout|account)/);
  assert.doesNotMatch(handler, /record\.(?:trial|livemode|store_id|environment_id)/);
});

test("same-store creation is serialized and concurrent calls converge", async () => {
  const [migration, concurrency] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(concurrencyPath, "utf8"),
  ]);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(concurrency, /dblink_send_query/g);
  assert.match(concurrency, /concurrent identical requests persist one attempt/);
  assert.match(concurrency, /concurrent attempts consume no trial claim/);
  assert.match(concurrency, /concurrent attempts grant no entitlement/);
});

test("Checkout response and logs expose no provider authority or secrets", async () => {
  const [index, handler] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(handlerPath, "utf8"),
  ]);
  assert.match(handler, /checkout_url: session\.url/);
  assert.doesNotMatch(handler, /console\.(?:log|warn|error)/);
  assert.doesNotMatch(index, /console\.(?:log|warn|error)/);
  assert.doesNotMatch(`${index}\n${handler}`, /JSON\.stringify\((?:error|session|attempt)/);
  assert.doesNotMatch(`${index}\n${handler}`, /(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{12,}|service-role/i);
});
