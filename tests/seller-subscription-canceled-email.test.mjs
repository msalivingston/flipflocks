import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  parseSellerSubscriptionCanceledContext,
  parseSellerSubscriptionCanceledPayload,
  renderSellerSubscriptionCanceledEmail,
  sellerSubscriptionCanceledAccountUrl,
  sellerSubscriptionCanceledFromEmail,
  sellerSubscriptionCanceledSubject,
} from "../supabase/functions/postmark-email-worker/seller-subscription-canceled.ts";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(resolve(
  root,
  "supabase/migrations/20260812100000_seller_subscription_canceled_email.sql",
), "utf8");
const worker = readFileSync(resolve(
  root,
  "supabase/functions/postmark-email-worker/index.ts",
), "utf8");
const webhook = readFileSync(resolve(
  root,
  "supabase/functions/stripe-saas-webhook/index.ts",
), "utf8");

function context(overrides = {}) {
  return parseSellerSubscriptionCanceledContext({
    recipient_email: "seller@example.test",
    first_name: "Avery",
    public_plan_name: "Coop",
    billing_cadence_label: "Monthly",
    cancellation_kind: "scheduled",
    access_ends_at: "2026-09-17T18:00:00.000Z",
    access_continues: true,
    can_reactivate: true,
    ...overrides,
  });
}

test("cancellation payload accepts only the internal episode identifier", () => {
  assert.deepEqual(parseSellerSubscriptionCanceledPayload({
    schema_version: "seller_subscription_canceled_v1",
    subscription_cancellation_episode_id:
      "FA000000-0000-4000-8000-000000000001",
  }), {
    schema_version: "seller_subscription_canceled_v1",
    subscription_cancellation_episode_id:
      "fa000000-0000-4000-8000-000000000001",
  });

  for (const invalid of [
    {},
    { schema_version: "seller_subscription_canceled_v1" },
    {
      schema_version: "seller_subscription_canceled_v1",
      subscription_cancellation_episode_id: "browser-value",
    },
    {
      schema_version: "seller_subscription_canceled_v1",
      subscription_cancellation_episode_id:
        "fa000000-0000-4000-8000-000000000001",
      access_ends_at: "browser-value",
    },
  ]) {
    assert.throws(
      () => parseSellerSubscriptionCanceledPayload(invalid),
      /payload is invalid/,
    );
  }
});

test("scheduled cancellation renders verified plan, boundary, guidance, and CTA", () => {
  const email = renderSellerSubscriptionCanceledEmail(context());

  assert.equal(email.subject, sellerSubscriptionCanceledSubject);
  assert.equal(sellerSubscriptionCanceledFromEmail, "billing@flockfront.com");
  assert.match(email.html, /flockfront-logo-final-cropped\.png/);
  assert.match(email.text, /Coop — Monthly/);
  assert.match(email.text, /Access through: September 17, 2026/);
  assert.match(email.text, /scheduled to cancel/);
  assert.match(email.text, /reactivate your subscription/);
  assert.ok(email.html.includes(`href="${sellerSubscriptionCanceledAccountUrl}"`));
  assert.ok(email.text.includes(sellerSubscriptionCanceledAccountUrl));
  assert.doesNotMatch(email.text, /sorry to see you go|guilt|Stripe/i);
});

test("immediate cancellation uses terminal wording and no unsupported reactivation", () => {
  const email = renderSellerSubscriptionCanceledEmail(context({
    cancellation_kind: "immediate",
    access_ends_at: "2026-08-12T18:00:00.000Z",
    access_continues: false,
    can_reactivate: false,
  }));

  assert.match(email.text, /has been canceled/);
  assert.match(email.text, /access ended on August 12, 2026/);
  assert.doesNotMatch(email.text, /reactivate/);
});

test("terminal cancellation preserves continuing verified paid access wording", () => {
  const email = renderSellerSubscriptionCanceledEmail(context({
    cancellation_kind: "immediate",
    access_continues: true,
    can_reactivate: false,
  }));
  assert.match(email.text, /access remains available through September 17, 2026/);
  assert.match(email.text, /After that date, subscription access will end/);
});

test("dynamic HTML is escaped and incomplete context fails visibly", () => {
  const email = renderSellerSubscriptionCanceledEmail(context({
    first_name: '<img src=x onerror="alert(1)">',
  }));
  assert.doesNotMatch(email.html, /<img src=x/);
  assert.match(email.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);

  for (const overrides of [
    { recipient_email: null },
    { first_name: "" },
    { public_plan_name: "small_flock" },
    { billing_cadence_label: "yearly" },
    { cancellation_kind: "portal" },
    { access_ends_at: null },
    { access_continues: null },
    { can_reactivate: null },
  ]) {
    assert.throws(() => context(overrides), /Seller subscription-canceled/);
  }
});

test("only an applied verified subscription transition can create an episode", () => {
  assert.match(migration,
    /after update of subscription_status, cancel_at_period_end,[\s\S]*on public\.seller_billing_status/);
  assert.match(migration,
    /events\.event_type in \([\s\S]*customer\.subscription\.updated[\s\S]*customer\.subscription\.deleted/);
  assert.match(migration, /events\.processing_status = 'processing'/);
  assert.match(migration, /events\.applied/);
  assert.match(migration,
    /not old\.cancel_at_period_end[\s\S]*new\.cancel_at_period_end/);
  assert.match(migration,
    /old\.subscription_status <> 'canceled'[\s\S]*new\.subscription_status = 'canceled'/);
  assert.match(migration, /public\.resolve_store_entitlement\(new\.store_id\)/);
});

test("episode identity deduplicates a boundary and tracks verified resumption", () => {
  assert.match(migration,
    /billing_cancellation_episode_boundary_unique_idx[\s\S]*subscription_enrollment_id,[\s\S]*access_ends_at/);
  assert.match(migration,
    /billing_cancellation_episode_one_open_idx[\s\S]*where resumed_at is null/);
  assert.match(migration,
    /set resumed_at = statement_timestamp\(\),[\s\S]*resumed_by_event_id/);
  assert.match(migration,
    /seller_subscription_canceled:episode:' \|\| v_episode\.id::text/);
  assert.match(migration,
    /unique index email_notifications_one_canceled_per_episode_idx/);
});

test("cancellation claim is service-only and cannot broaden existing claims", () => {
  const claim = migration.match(
    /create function public\.claim_seller_subscription_canceled_email[\s\S]*?comment on function public\.claim_seller_subscription_canceled_email[\s\S]*?;/,
  )?.[0] ?? "";
  assert.match(claim,
    /where episode\.id = p_subscription_cancellation_episode_id/);
  assert.match(claim, /notification_type = 'seller_subscription_canceled'/);
  assert.doesNotMatch(claim,
    /buyer_order_confirmation|seller_subscription_welcome|seller_subscription_payment_failed/);
  assert.match(migration,
    /grant execute on function public\.claim_seller_subscription_canceled_email\([\s\S]*?\) to service_role/);
  assert.doesNotMatch(migration,
    /grant execute on function public\.claim_seller_subscription_canceled_email\([\s\S]*?\) to (?:anon|authenticated)/);
});

test("worker selects only the episode scope and billing sender", () => {
  assert.match(worker, /claim_seller_subscription_canceled_email/);
  assert.match(worker,
    /p_subscription_cancellation_episode_id: cancellationEpisodeScope/);
  assert.match(worker,
    /cancel_episode_id:\s*notification\.subscription_cancellation_episode_id/);
  assert.doesNotMatch(worker,
    /subscription_cancellation_episode_id:\s*notification\.subscription_cancellation_episode_id/);
  assert.match(worker, /fromEmail: sellerSubscriptionCanceledFromEmail/);
  assert.match(worker, /tag: "flockfront-seller-subscription-canceled"/);
  assert.match(worker, /claim_seller_subscription_payment_failed_email/);
  assert.match(worker, /claim_seller_subscription_welcome_email/);
  assert.match(worker, /claim_phase_1_postmark_email_notifications_for_order/);
});

test("verified subscription application performs only a best-effort episode kick", () => {
  assert.match(webhook,
    /get_seller_subscription_cancellation_episode_for_event/);
  assert.match(webhook,
    /subscription_cancellation_episode_id: data/);
  assert.match(webhook,
    /apply_verified_stripe_subscription_event[\s\S]*kickSellerSubscriptionCanceledWorker\(identity\.providerEventId\)/);
});
