import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  parseSellerWelcomeContext,
  parseSellerWelcomePayload,
  renderSellerWelcomeEmail,
  sellerWelcomeFromEmail,
  sellerWelcomeSetupUrl,
  sellerWelcomeTrialSubject,
} from "../supabase/functions/postmark-email-worker/seller-welcome.ts";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260810100000_seller_subscription_welcome_email.sql",
  ),
  "utf8",
);
const scopeMigration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260810101000_seller_welcome_worker_scope.sql",
  ),
  "utf8",
);
const worker = readFileSync(
  resolve(root, "supabase/functions/postmark-email-worker/index.ts"),
  "utf8",
);
const webhook = readFileSync(
  resolve(root, "supabase/functions/stripe-saas-webhook/handler.ts"),
  "utf8",
);
const webhookIndex = readFileSync(
  resolve(root, "supabase/functions/stripe-saas-webhook/index.ts"),
  "utf8",
);
const checkoutReturn = readFileSync(
  resolve(root, "app/onboarding/billing/return/stripe-return-status.tsx"),
  "utf8",
);

function context(overrides = {}) {
  return parseSellerWelcomeContext({
    recipient_email: "seller@example.test",
    first_name: "Avery",
    public_plan_name: "Coop",
    billing_cadence_label: "Monthly",
    first_charge_amount_cents: 500,
    currency: "usd",
    first_charge_at: "2026-08-17T18:00:00.000Z",
    has_trial: true,
    ...overrides,
  });
}

test("welcome payload accepts only the narrow enrollment schema", () => {
  assert.deepEqual(
    parseSellerWelcomePayload({
      schema_version: "seller_subscription_welcome_v1",
      subscription_enrollment_id: "E7000000-0000-4000-8000-000000000004",
    }),
    {
      schema_version: "seller_subscription_welcome_v1",
      subscription_enrollment_id: "e7000000-0000-4000-8000-000000000004",
    },
  );

  for (const invalid of [
    {},
    { schema_version: "seller_subscription_welcome_v1" },
    {
      schema_version: "seller_subscription_welcome_v1",
      subscription_enrollment_id: "not-an-id",
    },
    {
      schema_version: "seller_subscription_welcome_v1",
      subscription_enrollment_id: "e7000000-0000-4000-8000-000000000004",
      recipient_email: "browser@example.test",
    },
  ]) {
    assert.throws(() => parseSellerWelcomePayload(invalid), /payload is invalid/);
  }
});

test("Coop and Market, both cadences, and all four verified prices render", () => {
  const cases = [
    ["Coop", "Monthly", 500, "$5.00"],
    ["Coop", "Annual", 5000, "$50.00"],
    ["Market", "Monthly", 2900, "$29.00"],
    ["Market", "Annual", 27000, "$270.00"],
  ];

  for (const [plan, cadence, amount, price] of cases) {
    const email = renderSellerWelcomeEmail(context({
      public_plan_name: plan,
      billing_cadence_label: cadence,
      first_charge_amount_cents: amount,
    }));

    assert.match(email.html, new RegExp(`${plan} — ${cadence}`));
    assert.ok(email.html.includes(price));
    assert.ok(email.text.includes(`${plan} — ${cadence}`));
    assert.ok(email.text.includes(`Your first charge: ${price}`));
  }
});

test("trial welcome contains the required subject, date, CTA, and disclosures", () => {
  const email = renderSellerWelcomeEmail(context());

  assert.equal(email.subject, sellerWelcomeTrialSubject);
  assert.match(email.html, /August 17, 2026/);
  assert.match(email.text, /August 17, 2026/);
  assert.ok(email.html.includes(`href="${sellerWelcomeSetupUrl}"`));
  assert.ok(email.text.includes(sellerWelcomeSetupUrl));
  for (const disclosure of [
    "You won’t be charged today",
    "Unless you cancel before your trial ends",
    "Account → Manage billing & invoices",
    "If you cancel during the trial, you will not be charged",
    "support@flockfront.com",
  ]) {
    assert.ok(email.html.includes(disclosure.replace("&", "&amp;")) || email.html.includes(disclosure));
    assert.ok(email.text.includes(disclosure));
  }
  assert.doesNotMatch(email.html, /unsubscribe|tracking pixel/i);
  assert.doesNotMatch(email.text, /unsubscribe/i);
});

test("no-trial enrollment uses accurate active-subscription wording", () => {
  const email = renderSellerWelcomeEmail(context({ has_trial: false }));

  assert.equal(
    email.subject,
    "Welcome to FlockFront — your subscription is active",
  );
  assert.match(email.text, /subscription is set up and active/);
  assert.match(email.text, /Future charges will follow the billing cadence/);
  assert.doesNotMatch(email.text, /free trial|won’t be charged today/i);
});

test("dynamic HTML is escaped and missing authoritative data fails visibly", () => {
  const email = renderSellerWelcomeEmail(context({
    first_name: '<img src=x onerror="alert(1)">',
  }));
  assert.doesNotMatch(email.html, /<img src=x/);
  assert.match(email.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);

  for (const overrides of [
    { recipient_email: null },
    { first_name: "" },
    { public_plan_name: "small_flock" },
    { billing_cadence_label: "yearly" },
    { first_charge_amount_cents: null },
    { currency: "cad" },
    { first_charge_at: null },
  ]) {
    assert.throws(() => context(overrides), /Seller welcome/);
  }
});

test("verified enrollment is the sole trigger with durable store and subscription dedupe", () => {
  assert.match(
    migration,
    /after insert on public\.billing_subscription_enrollments[\s\S]*enqueue_first_seller_subscription_welcome/,
  );
  assert.match(
    migration,
    /seller_subscription_welcome:subscription:' \|\| new\.stripe_subscription_id/,
  );
  assert.match(
    migration,
    /unique index email_notifications_one_seller_welcome_per_store_idx/,
  );
  assert.match(migration, /prior\.store_id = new\.store_id[\s\S]*prior\.id <> new\.id/);
  assert.doesNotMatch(webhook, /seller_subscription_welcome|welcome@flockfront\.com/);
  assert.doesNotMatch(checkoutReturn, /seller_subscription_welcome|welcome@flockfront\.com/);
  assert.match(webhookIndex, /await kickSellerWelcomeWorker\(result\.subscription_enrollment_id\)/);
  assert.match(webhookIndex, /subscription_enrollment_id: subscriptionEnrollmentId/);
  assert.match(webhookIndex, /catch \{[\s\S]*seller_welcome_worker_kick_failed/);
});

test("worker preserves order sender behavior and selects the welcome alias narrowly", () => {
  assert.equal(sellerWelcomeFromEmail, "welcome@flockfront.com");
  assert.match(worker, /fromEmail: sellerWelcomeFromEmail/);
  assert.match(worker, /fromEmail,\s*siteOrigin/);
  assert.match(worker, /tag: "flockfront-seller-welcome"/);
  assert.match(worker, /tag: "flockfront-order-notification"/);
  assert.match(worker, /get_seller_subscription_welcome_context/);
  assert.match(worker, /claim_subscription_enrollment_emails/);
  assert.match(scopeMigration, /where enrollment\.id = p_subscription_enrollment_id/);
  assert.doesNotMatch(scopeMigration, /buyer_order_confirmation|seller_new_order/);
  assert.match(worker, /await beginNotificationDispatch[\s\S]*await sendPostmarkEmail/);
  assert.match(worker, /markNotificationFailed/);
  assert.match(worker, /markNotificationDeliveryUnknown/);
});

test("migration keeps seller billing valid when notification enqueueing fails", () => {
  assert.match(
    migration,
    /exception[\s\S]*when others then[\s\S]*raise warning[\s\S]*return new/,
  );
  assert.doesNotMatch(migration, /update public\.seller_billing_status[\s\S]*notification_status/);
});
