import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260803106000_saas_early_trial_conversion_invoice_authority.sql",
    import.meta.url,
  ),
  "utf8",
);
const invoiceFoundation = readFileSync(
  new URL(
    "../supabase/migrations/20260802103000_saas_invoice_lifecycle_application.sql",
    import.meta.url,
  ),
  "utf8",
);
const prorationCorrection = readFileSync(
  new URL(
    "../supabase/migrations/20260806100000_saas_prorated_early_trial_conversion_invoice.sql",
    import.meta.url,
  ),
  "utf8",
);
const webhook = readFileSync(
  new URL("../supabase/functions/stripe-saas-webhook/index.ts", import.meta.url),
  "utf8",
);

test("early trial conversion authority is narrow and invoice-backed", () => {
  assert.match(migration, /v_reason = 'subscription_update'/);
  assert.match(migration, /v_enrollment\.provider_status = 'active'/);
  assert.match(migration, /v_billing\.subscription_status = 'active'/);
  assert.match(migration, /billing_trial_claims as conversion_claim/);
  assert.match(migration, /v_billing\.paid_through_at is null/);
  assert.match(migration, /v_billing\.last_paid_stripe_invoice_id is null/);
  assert.match(migration, /v_invoice\.paid_through_applied_at is null/);
  assert.match(migration, /p_service_period_start = v_billing\.current_period_start/);
  assert.match(migration, /p_service_period_end = v_billing\.current_period_end/);
  assert.match(migration, /p_amount_paid_cents = p_amount_due_cents/);
  assert.match(migration, /p_amount_due_cents >= p_recurring_line_amount_cents/);
  assert.match(invoiceFoundation, /p_line_quantity <> 1/);
});

test("existing recurring invoice authority remains intact", () => {
  assert.match(
    migration,
    /v_reason in \('subscription_create', 'subscription_cycle'\)/,
  );
});

test("verified early conversion accepts a positive current-Price proration", () => {
  assert.match(
    webhook,
    /invoice\.billing_reason === "subscription_update"[\s\S]*?line\.amount > 0[\s\S]*?currentPrice\.id/,
  );
  assert.match(prorationCorrection, /v_reason = 'subscription_update'/);
  assert.match(prorationCorrection, /billing_trial_claims as conversion_claim/);
  assert.match(
    prorationCorrection,
    /p_service_period_start = v_billing\.current_period_start/,
  );
  assert.match(
    prorationCorrection,
    /p_service_period_end = v_billing\.current_period_end/,
  );
  assert.match(
    prorationCorrection,
    /unit_amount_cents is distinct from p_recurring_line_amount_cents/,
  );
});

test("recorded-invoice repair is identity-bound and contains no owner fixture", () => {
  assert.match(migration, /billing_subscription_enrollments as enrollment/);
  assert.match(migration, /billing_customer_bindings as binding/);
  assert.match(migration, /billing_provider_price_catalog as catalog/);
  assert.match(migration, /billing_provider_events as provider_event/);
  assert.match(migration, /provider_event\.processing_status = 'processed'/);
  assert.match(migration, /provider_event\.applied/);
  assert.match(migration, /invoice\.paid_through_applied_at is null/);
  assert.doesNotMatch(migration, /owner-3/i);
  assert.doesNotMatch(
    migration,
    /00f2f76c-fdaa-422f-8fbf-094a7bd492b4/i,
  );
  assert.doesNotMatch(migration, /evt_1U18|in_1U18|sub_1U0Q|cus_V0Qy/);
});

test("migration adds no replay, resync, repair endpoint, or admin authority", () => {
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function[^;]*(?:replay|resync)/i);
  assert.doesNotMatch(migration, /grant\s+execute[^;]*(?:authenticated|anon)/i);
  assert.doesNotMatch(migration, /edge function|admin page|diagnostic endpoint/i);
});
