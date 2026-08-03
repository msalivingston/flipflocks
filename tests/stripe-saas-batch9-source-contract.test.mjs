import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260802104000_seller_saas_billing_status_read_model.sql");
const returnPage = read("app/onboarding/billing/return/page.tsx");
const returnClient = read("app/onboarding/billing/return/stripe-return-status.tsx");
const onboarding = read("app/onboarding/_components/step-5-plan-access-form.tsx");
const accountPanel = read("app/dashboard/account/subscription-billing-panel.tsx");
const banner = read("app/dashboard/_components/seller-billing-banner.tsx");
const billingHelpers = read("lib/saas-billing-status.ts");
const checkoutIndex = read("supabase/functions/stripe-saas-checkout/index.ts");
const ui = [returnPage, returnClient, onboarding, accountPanel, banner, billingHelpers].join("\n");

test("billing status is an owner-only read model over canonical entitlement", () => {
  assert.match(migration, /stores\.owner_user_id = v_user_id/);
  assert.match(migration, /resolve_store_entitlement\(v_store\.id\)/);
  assert.match(migration, /language plpgsql\s+stable\s+security definer/);
  assert.match(migration, /grant execute[\s\S]+to authenticated/);
  assert.doesNotMatch(migration, /or public\.is_admin\(\)/);
  const returnedFields = migration.split("returns table (")[1].split(")\nlanguage")[0];
  assert.doesNotMatch(returnedFields, /stripe_(?:customer|subscription|price|checkout_session)_id|provider_event_id|payload_hash/);
});

test("return parameters remain presentation-only and never reach billing writes", () => {
  assert.match(returnPage, /hasSessionHint=\{Boolean\(sessionId\)\}/);
  assert.doesNotMatch(returnPage, /sessionId=|rpc\(/);
  assert.match(returnClient, /seller_get_saas_billing_status/);
  assert.doesNotMatch(returnClient, /seller_save_onboarding|apply_verified|billing_complete|stripe_customer_id|stripe_subscription_id/);
  assert.doesNotMatch(returnClient, /localStorage|sessionStorage|console\./);
});

test("return polling is bounded, sequential, and cleaned up", () => {
  assert.match(returnClient, /POLL_TIMEOUT_MS = 30_000/);
  assert.match(returnClient, /POLL_INTERVAL_MS = 2_000/);
  assert.match(returnClient, /timer = setTimeout\(\(\) => void poll\(\)/);
  assert.match(returnClient, /if \(timer\) clearTimeout\(timer\)/);
  assert.doesNotMatch(returnClient, /setInterval/);
});

test("server-generated return URL includes only an untrusted Stripe template hint", () => {
  assert.match(checkoutIndex, /onboarding\/billing\/return\?checkout=success&session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.doesNotMatch(checkoutIndex, /billing_complete|grant_entitlement/);
});

test("onboarding preserves local trial mode and gates secure Checkout", () => {
  assert.match(onboarding, /seller_save_onboarding_plan_access/);
  assert.match(onboarding, /checkoutRequired/);
  assert.match(onboarding, /seller_save_onboarding[\s\S]+stripe-saas-checkout/);
  assert.match(onboarding, /Continue to secure checkout/);
  assert.match(onboarding, /7-day free trial/);
  assert.match(onboarding, /trialAlreadyUsed/);
  assert.match(onboarding, /body:\s*\{\s*billing_cadence: selectedBillingPlan,\s*plan_key: selectedPlan/);
  assert.doesNotMatch(onboarding, /price_[A-Za-z0-9]+|stripe_price_id|customer_id|subscription_id/);
});

test("unsafe Checkout redirects are refused", () => {
  assert.match(billingHelpers, /url\.protocol === "https:"/);
  assert.match(billingHelpers, /url\.hostname === "checkout\.stripe\.com"/);
  assert.match(onboarding, /!isSafeStripeCheckoutUrl\(checkoutUrl\)/);
});

test("account UI translates every approved seller lifecycle without raw codes", () => {
  for (const state of [
    "trial_active", "active_paid", "payment_failed_paid_through",
    "payment_grace", "suspended_nonpayment", "canceling_at_period_end",
    "complimentary_access", "administrative_hold", "unknown",
  ]) assert.match(accountPanel, new RegExp(state));
  assert.match(accountPanel, /Plan &amp; billing/);
  assert.match(billingHelpers, /small_flock[\s\S]+full_flock/);
  assert.doesNotMatch(accountPanel, /stripe_customer|stripe_subscription|provider_event|payload_hash/);
  assert.match(accountPanel, /Manage billing/);
  assert.match(accountPanel, /Update payment method/);
  assert.match(accountPanel, /Cancel subscription/);
  assert.match(accountPanel, /Keep my subscription/);
});

test("dashboard emits at most one prioritized billing banner", () => {
  assert.match(banner, /const banner = status \? getBillingBanner\(status\) : null/);
  const hold = billingHelpers.indexOf('lifecycle_state === "administrative_hold"');
  const suspended = billingHelpers.indexOf('lifecycle_state === "suspended_nonpayment"');
  const grace = billingHelpers.indexOf('lifecycle_state === "payment_grace"');
  const failed = billingHelpers.indexOf('lifecycle_state === "payment_failed_paid_through"');
  const canceling = billingHelpers.indexOf('lifecycle_state === "canceling_at_period_end"');
  assert.ok(hold < suspended && suspended < grace && grace < failed && failed < canceling);
});

test("billing UI is accessible, mobile-first, and avoids color-only state", () => {
  assert.match(returnClient, /aria-live="polite"/);
  assert.match(returnClient, /motion-reduce:animate-none/);
  assert.match(returnClient, /tabIndex=\{-1\}/);
  assert.match(banner, /aria-label="Billing notice"/);
  assert.match(accountPanel, /<h2[\s\S]+Plan &amp; billing/);
  assert.match(accountPanel, /sm:grid-cols-2/);
});

test("browser code contains no provider authority, secrets, Portal, Connect, or buyer payments", () => {
  assert.doesNotMatch(ui, /STRIPE_(?:SECRET|API|WEBHOOK)|SUPABASE_SERVICE_ROLE|NEXT_PUBLIC_STRIPE/);
  assert.doesNotMatch(ui, /price_1Tzp|prod_Uzo|acct_1CTO/);
  assert.doesNotMatch(ui, /portal\.sessions|billingPortal|accountLinks|application_fee_amount/);
  assert.doesNotMatch(ui, /mark_order_paid|order_refunds|pay_at_pickup/);
  assert.doesNotMatch(ui, /apply_verified_saas|record_saas_checkout_session/);
});

test("both billing feature flags remain disabled", () => {
  assert.match(migration, /saas_subscription_checkout_enabled'[\s\S]+saas_billing_portal_enabled'/);
  assert.doesNotMatch(migration, /boolean_value\s*=\s*true/);
});
