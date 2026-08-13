import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  parseSellerPaymentFailedContext,
  parseSellerPaymentFailedPayload,
  renderSellerPaymentFailedEmail,
  sellerPaymentFailedAccountUrl,
  sellerPaymentFailedFromEmail,
  sellerPaymentFailedSubject,
} from "../supabase/functions/postmark-email-worker/seller-payment-failed.ts";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(resolve(
  root,
  "supabase/migrations/20260811100000_seller_subscription_payment_failed_email.sql",
), "utf8");
const worker = readFileSync(resolve(
  root,
  "supabase/functions/postmark-email-worker/index.ts",
), "utf8");
const paymentTemplate = readFileSync(resolve(
  root,
  "supabase/functions/postmark-email-worker/seller-payment-failed.ts",
), "utf8");
const webhookIndex = readFileSync(resolve(
  root,
  "supabase/functions/stripe-saas-webhook/index.ts",
), "utf8");
const welcomeScope = readFileSync(resolve(
  root,
  "supabase/migrations/20260810101000_seller_welcome_worker_scope.sql",
), "utf8");

function context(overrides = {}) {
  return parseSellerPaymentFailedContext({
    recipient_email: "seller@example.test",
    first_name: "Avery",
    public_plan_name: "Coop",
    billing_cadence_label: "Monthly",
    amount_due_cents: 500,
    currency: "usd",
    next_payment_attempt_at: "2026-08-17T18:00:00.000Z",
    failure_at: "2026-08-14T18:00:00.000Z",
    grace_ends_at: "2026-08-20T18:00:00.000Z",
    has_active_access: true,
    access_until: "2026-08-20T18:00:00.000Z",
    ...overrides,
  });
}

test("payment-failed payload accepts only the internal invoice identifier", () => {
  assert.deepEqual(parseSellerPaymentFailedPayload({
    schema_version: "seller_subscription_payment_failed_v1",
    subscription_invoice_id: "F9000000-0000-4000-8000-000000000001",
  }), {
    schema_version: "seller_subscription_payment_failed_v1",
    subscription_invoice_id: "f9000000-0000-4000-8000-000000000001",
  });

  for (const invalid of [
    {},
    { schema_version: "seller_subscription_payment_failed_v1" },
    {
      schema_version: "seller_subscription_payment_failed_v1",
      subscription_invoice_id: "in_browser_claim",
    },
    {
      schema_version: "seller_subscription_payment_failed_v1",
      subscription_invoice_id: "f9000000-0000-4000-8000-000000000001",
      recipient_email: "browser@example.test",
    },
  ]) {
    assert.throws(() => parseSellerPaymentFailedPayload(invalid), /payload is invalid/);
  }
});

test("payment-failed email renders verified details, branding, grace, and account CTA", () => {
  const email = renderSellerPaymentFailedEmail(context());

  assert.equal(email.subject, sellerPaymentFailedSubject);
  assert.match(email.html, /flockfront-logo-final-cropped\.png/);
  assert.match(email.html, /Coop — Monthly/);
  assert.match(email.text, /Amount due: \$5\.00/);
  assert.match(email.text, /Next payment attempt: August 17, 2026/);
  assert.match(email.text, /billing grace period through August 20, 2026/);
  assert.ok(email.html.includes(`href="${sellerPaymentFailedAccountUrl}"`));
  assert.ok(email.text.includes(sellerPaymentFailedAccountUrl));
  assert.doesNotMatch(`${email.html}\n${email.text}`, /failure_code|payment_failed|stripe_invoice|unsubscribe/i);
});

test("null next attempt omits retry-date language without guessing", () => {
  const email = renderSellerPaymentFailedEmail(context({
    next_payment_attempt_at: null,
    grace_ends_at: null,
    access_until: null,
    has_active_access: false,
  }));

  assert.doesNotMatch(email.html, /Next payment attempt/);
  assert.doesNotMatch(email.text, /Next payment attempt/);
  assert.doesNotMatch(email.text, /try the payment again/);
  assert.doesNotMatch(email.text, /grace period|remains available through/);
});

test("active paid access is described only when the resolver supplies a boundary", () => {
  const email = renderSellerPaymentFailedEmail(context({
    grace_ends_at: null,
    access_until: "2026-09-01T18:00:00.000Z",
  }));
  assert.match(email.text, /existing store access remains available through September 1, 2026/);
});

test("dynamic content is escaped and missing authoritative context fails visibly", () => {
  const email = renderSellerPaymentFailedEmail(context({
    first_name: '<img src=x onerror="alert(1)">',
  }));
  assert.doesNotMatch(email.html, /<img src=x/);
  assert.match(email.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);

  for (const overrides of [
    { recipient_email: null },
    { first_name: "" },
    { public_plan_name: "small_flock" },
    { billing_cadence_label: "yearly" },
    { amount_due_cents: null },
    { currency: "cad" },
    { failure_at: null },
    { has_active_access: null },
  ]) {
    assert.throws(() => context(overrides), /Seller payment-failed/);
  }
});

test("first verified invoice failure transition is the sole enqueue trigger", () => {
  assert.match(migration,
    /after insert or update of failure_at on public\.billing_subscription_invoices/);
  assert.match(migration,
    /new\.failure_at is null[\s\S]*old\.failure_at is not null[\s\S]*return new/);
  assert.match(migration,
    /events\.event_type = 'invoice\.payment_failed'/);
  assert.match(migration,
    /events\.provider_object_id = new\.stripe_invoice_id/);
  assert.match(migration,
    /seller_subscription_payment_failed:invoice:' \|\| new\.id::text/);
  assert.match(migration,
    /unique index email_notifications_one_payment_failed_per_invoice_idx/);
  assert.match(migration, /on conflict do nothing/);
});

test("invoice claim is service-only and cannot claim order or welcome rows", () => {
  const claim = migration.match(
    /create function public\.claim_seller_subscription_payment_failed_email[\s\S]*?comment on function public\.claim_seller_subscription_payment_failed_email[\s\S]*?;/,
  )?.[0] ?? "";
  assert.match(claim, /where invoice\.id = p_subscription_invoice_id/);
  assert.match(claim, /notification_type = 'seller_subscription_payment_failed'/);
  assert.doesNotMatch(claim, /buyer_order_confirmation|seller_subscription_welcome/);
  assert.match(migration,
    /grant execute on function public\.claim_seller_subscription_payment_failed_email\([\s\S]*?\) to service_role/);
  assert.doesNotMatch(migration,
    /grant execute on function public\.claim_seller_subscription_payment_failed_email\([\s\S]*?\) to (?:anon|authenticated)/);
  assert.doesNotMatch(welcomeScope, /seller_subscription_payment_failed/);
});

test("worker selects the invoice scope and sender without broadening existing scopes", () => {
  assert.equal(sellerPaymentFailedFromEmail, "billing@flockfront.com");
  assert.match(worker, /claim_seller_subscription_payment_failed_email/);
  assert.match(worker, /p_subscription_invoice_id: invoiceScope/);
  assert.match(worker,
    /billing_invoice_id: notification\.subscription_invoice_id/);
  assert.doesNotMatch(worker,
    /\? \{ subscription_invoice_id: notification\.subscription_invoice_id \}/);
  assert.match(worker, /fromEmail: sellerPaymentFailedFromEmail/);
  assert.match(worker, /tag: "flockfront-seller-payment-failed"/);
  assert.match(worker, /claim_subscription_enrollment_emails/);
  assert.match(worker, /claim_phase_1_postmark_email_notifications_for_order/);
  assert.match(worker, /await beginNotificationDispatch[\s\S]*await sendPostmarkEmail/);
  assert.match(worker, /markNotificationDeliveryUnknown/);
});

test("verified ordinary and plan-change failure applications kick only the invoice scope", () => {
  assert.match(webhookIndex,
    /async function kickSellerPaymentFailedWorker\([\s\S]*subscription_invoice_id: subscriptionInvoiceId/);
  assert.equal(
    (webhookIndex.match(/await kickSellerPaymentFailedWorker\(result\.invoice_id\)/g) ?? []).length,
    2,
  );
  assert.match(webhookIndex,
    /apply_verified_saas_plan_change_invoice_event[\s\S]*identity\.eventType === "invoice\.payment_failed"[\s\S]*kickSellerPaymentFailedWorker/);
  assert.match(webhookIndex,
    /identity\.eventType === "invoice\.payment_failed"[\s\S]*bind_verified_saas_payment_failed_plan_change_event[\s\S]*apply_verified_saas_plan_change_invoice_event/);
  assert.match(migration,
    /bind_verified_saas_payment_failed_plan_change_event[\s\S]*deferred_reason <> 'awaiting_immutable_enrollment_binding'[\s\S]*changes\.target_stripe_price_id/);
  assert.match(webhookIndex,
    /apply_verified_saas_invoice_payment_failed[\s\S]*identity\.eventType === "invoice\.payment_failed"[\s\S]*kickSellerPaymentFailedWorker/);
});

test("payment-failed slice does not reference auth delivery or order recipient configuration", () => {
  const combined = `${migration}\n${paymentTemplate}`;
  assert.doesNotMatch(combined, /supabase\.auth\.(?:signUp|resend)|auth\.smtp|order_notification_email/);
});
