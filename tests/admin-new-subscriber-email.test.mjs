import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  adminNewSubscriberNotificationType,
  adminNewSubscriberRecipientEmail,
  parseAdminNewSubscriberContext,
  parseAdminNewSubscriberPayload,
  renderAdminNewSubscriberEmail,
} from "../supabase/functions/postmark-email-worker/admin-new-subscriber.ts";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260819100000_admin_new_subscriber_email.sql",
  ),
  "utf8",
);
const worker = readFileSync(
  resolve(root, "supabase/functions/postmark-email-worker/index.ts"),
  "utf8",
);
const webhookIndex = readFileSync(
  resolve(root, "supabase/functions/stripe-saas-webhook/index.ts"),
  "utf8",
);

function context(overrides = {}) {
  return parseAdminNewSubscriberContext({
    recipient_email: "hello@flockfront.com",
    store_name: "Mesa & Meadow <Farm>",
    seller_email: "seller@example.test",
    public_plan_name: "Market",
    billing_cadence_label: "Annual",
    subscription_status: "trialing",
    trial_ends_at: "2026-08-20T12:00:00.000Z",
    stripe_customer_id: "cus_TestCustomer123",
    stripe_subscription_id: "sub_TestSubscription123",
    signup_at: "2026-08-13T12:00:00.000Z",
    ...overrides,
  });
}

test("admin subscriber payload accepts only the enrollment identity", () => {
  assert.deepEqual(
    parseAdminNewSubscriberPayload({
      schema_version: "admin_new_subscriber_v1",
      subscription_enrollment_id: "E7000000-0000-4000-8000-000000000004",
    }),
    {
      schema_version: "admin_new_subscriber_v1",
      subscription_enrollment_id: "e7000000-0000-4000-8000-000000000004",
    },
  );
  assert.throws(
    () => parseAdminNewSubscriberPayload({
      schema_version: "admin_new_subscriber_v1",
      subscription_enrollment_id: "not-a-uuid",
      recipient_email: "browser@example.test",
    }),
    /payload is invalid/,
  );
});

test("internal email renders the required authoritative subscription details", () => {
  const email = renderAdminNewSubscriberEmail(context());
  assert.equal(
    email.subject,
    "New FlockFront subscriber: Mesa & Meadow <Farm>",
  );
  for (const value of [
    "Store name: Mesa & Meadow <Farm>",
    "Seller/login email: seller@example.test",
    "Plan: Market",
    "Billing interval: Annual",
    "Subscription status: trialing",
    "Trial end:",
    "Stripe customer ID: cus_TestCustomer123",
    "Stripe subscription ID: sub_TestSubscription123",
    "Signup date/time:",
  ]) {
    assert.ok(email.text.includes(value));
  }
  assert.doesNotMatch(email.html, /<Farm>/);
  assert.match(email.html, /&lt;Farm&gt;/);
});

test("optional plan and seller details are omitted when unavailable", () => {
  const email = renderAdminNewSubscriberEmail(context({
    seller_email: null,
    public_plan_name: null,
    billing_cadence_label: null,
    subscription_status: "active",
    trial_ends_at: null,
  }));
  assert.doesNotMatch(email.text, /Seller\/login email|Plan:|Billing interval|Trial end/);
  assert.match(email.text, /Subscription status: active/);
});

test("each future verified Stripe subscription is enqueued once, including resubscriptions", () => {
  assert.equal(adminNewSubscriberNotificationType, "admin_new_subscriber");
  assert.equal(adminNewSubscriberRecipientEmail, "hello@flockfront.com");
  assert.match(
    migration,
    /after insert on public\.billing_subscription_enrollments[\s\S]*enqueue_admin_new_subscriber_notification/,
  );
  assert.match(migration, /new\.provider_status not in \('active', 'trialing'\)/);
  assert.doesNotMatch(migration, /prior\.store_id = new\.store_id|prior\.id <> new\.id/);
  assert.match(
    migration,
    /admin_new_subscriber:subscription:' \|\| new\.stripe_subscription_id/,
  );
  assert.match(
    migration,
    /email_notifications_one_admin_new_subscriber_per_subscription_idx/,
  );
  assert.doesNotMatch(
    migration,
    /insert into public\.email_notifications\s*\([^;]+\)\s*select/i,
  );
});

test("existing webhook kick reuses the enrollment-scoped Postmark outbox", () => {
  assert.match(
    webhookIndex,
    /await kickSellerWelcomeWorker\(result\.subscription_enrollment_id\)/,
  );
  assert.match(worker, /claim_subscription_enrollment_emails/);
  assert.match(worker, /get_admin_new_subscriber_context/);
  assert.match(worker, /renderAdminNewSubscriberNotification/);
  assert.match(worker, /flockfront-admin-new-subscriber/);
  assert.match(worker, /await beginNotificationDispatch[\s\S]*await sendPostmarkEmail/);
  assert.match(migration, /admin_new_subscriber_v1/);
  assert.match(migration, /hello@flockfront\.com/);
});
