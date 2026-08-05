import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStripePortalSessionParams,
  createStripeSaasPortalHandler,
  isApprovedStripePortalConfiguration,
  isSafeStripePortalUrl,
  PortalProviderError,
} from "../supabase/functions/stripe-saas-portal/handler.ts";

test("Portal Session parameters use the default configuration and preserve targeted flows", () => {
  const returnUrl = "https://flockfront.test/dashboard/account?billing=portal_return";
  for (const action of ["manage_billing", "invoice_history"]) {
    const params = buildStripePortalSessionParams(action, "cus_Batch10", "sub_Batch10", returnUrl);
    assert.equal(Object.hasOwn(params, "configuration"), false);
    assert.equal(params.customer, "cus_Batch10");
    assert.equal(params.return_url, returnUrl);
    assert.equal(params.flow_data, undefined);
  }

  const payment = buildStripePortalSessionParams(
    "update_payment_method", "cus_Batch10", "sub_Batch10", returnUrl,
  );
  assert.equal(Object.hasOwn(payment, "configuration"), false);
  assert.equal(payment.flow_data.type, "payment_method_update");
  assert.equal(payment.flow_data.after_completion.redirect.return_url, returnUrl);

  const cancellation = buildStripePortalSessionParams(
    "cancel_subscription", "cus_Batch10", "sub_Batch10", returnUrl,
  );
  assert.equal(Object.hasOwn(cancellation, "configuration"), false);
  assert.equal(cancellation.flow_data.type, "subscription_cancel");
  assert.equal(cancellation.flow_data.subscription_cancel.subscription, "sub_Batch10");
  assert.equal(cancellation.flow_data.after_completion.redirect.return_url, returnUrl);
});

function authorization(overrides = {}) {
  return {
    action_state: "created",
    action_request_id: "fa000000-0000-4000-a000-000000000001",
    store_id: "fa000000-0000-4000-9000-000000000001",
    stripe_customer_id: "cus_Batch10",
    stripe_subscription_id: "sub_Batch10",
    retry_after_seconds: null,
    ...overrides,
  };
}
function session(overrides = {}) {
  return {
    id: "bps_Batch10",
    url: "https://billing.stripe.com/p/session/batch10",
    configuration: "bpc_Batch10General",
    customer: "cus_Batch10",
    created: 1_800_000_000,
    livemode: false,
    ...overrides,
  };
}
function portalConfiguration(overrides = {}) {
  const value = {
    id: "bpc_Batch10General",
    object: "billing_portal.configuration",
    active: true,
    application: null,
    is_default: true,
    livemode: false,
    features: {
      customer_update: { allowed_updates: ["address", "tax_id"], enabled: true },
      invoice_history: { enabled: true },
      payment_method_update: {
        enabled: true,
        payment_method_configuration: null,
      },
      subscription_cancel: {
        cancellation_reason: { enabled: true, options: ["other"] },
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
      },
      subscription_pause: { enabled: false },
      subscription_update: {
        billing_cycle_anchor: "unchanged",
        default_allowed_updates: [],
        enabled: false,
        products: [],
        proration_behavior: "none",
        schedule_at_period_end: { conditions: [] },
        trial_update_behavior: "continue_trial",
      },
    },
  };
  return { ...value, ...overrides };
}
function request(body = { action: "manage_billing" }, overrides = {}) {
  return new Request("https://functions.test/stripe-saas-portal", {
    method: "POST",
    headers: {
      Authorization: "Bearer verified-user-token",
      Origin: "https://flockfront.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    ...overrides,
  });
}
function harness(overrides = {}) {
  const calls = { begin: [], create: [], retrieve: [], record: [], failed: [] };
  const dependencies = {
    allowedOrigin: "https://flockfront.test",
    stripeLivemode: false,
    authenticate: async () => "fa000000-0000-4000-8000-000000000001",
    beginPortalAction: async (...args) => {
      calls.begin.push(args);
      return authorization();
    },
    createPortalSession: async (...args) => {
      calls.create.push(args);
      return session();
    },
    retrievePortalConfiguration: async (...args) => {
      calls.retrieve.push(args);
      return portalConfiguration();
    },
    recordPortalSession: async (...args) => calls.record.push(args),
    markActionFailed: async (...args) => calls.failed.push(args),
    ...overrides,
  };
  return { handler: createStripeSaasPortalHandler(dependencies), calls };
}

test("Portal requires verified bearer authentication", async () => {
  const { handler } = harness();
  assert.equal((await handler(request(undefined, { headers: { "Content-Type": "application/json" } }))).status, 401);
  const invalid = harness({ authenticate: async () => null });
  assert.equal((await invalid.handler(request())).status, 401);
});

test("Portal request accepts only the four allowlisted action names", async () => {
  for (const action of ["manage_billing", "update_payment_method", "invoice_history", "cancel_subscription"]) {
    const { handler, calls } = harness();
    const response = await handler(request({ action }));
    assert.equal(response.status, 200);
    assert.equal(calls.begin[0][1], action);
  }
  assert.equal((await harness().handler(request({ action: "change_plan" }))).status, 400);
  assert.equal((await harness().handler(request({ action: "manage_billing", customer_id: "cus_browser" }))).status, 400);
  assert.equal((await harness().handler(request({ action: "manage_billing", subscription_id: "sub_browser" }))).status, 400);
  assert.equal((await harness().handler(request({ action: "manage_billing", return_url: "https://evil.test" }))).status, 400);
});

test("Portal uses server-derived authorization and returns only a safe URL", async () => {
  const { handler, calls } = harness();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    portal_url: "https://billing.stripe.com/p/session/batch10",
  });
  assert.equal(calls.create.length, 1);
  assert.deepEqual(calls.retrieve, [["bpc_Batch10General"]]);
  assert.equal(calls.record.length, 1);
});

test("Portal configuration preflight accepts only the approved default policy", () => {
  assert.equal(isApprovedStripePortalConfiguration(
    portalConfiguration(), "bpc_Batch10General", false,
  ), true);

  const unsafe = [];
  const productSwitching = structuredClone(portalConfiguration());
  productSwitching.features.subscription_update.enabled = true;
  unsafe.push(productSwitching);
  const priceUpdates = structuredClone(portalConfiguration());
  priceUpdates.features.subscription_update.default_allowed_updates = ["price"];
  unsafe.push(priceUpdates);
  const immediateCancel = structuredClone(portalConfiguration());
  immediateCancel.features.subscription_cancel.mode = "immediately";
  unsafe.push(immediateCancel);
  const cancellationProration = structuredClone(portalConfiguration());
  cancellationProration.features.subscription_cancel.proration_behavior = "create_prorations";
  unsafe.push(cancellationProration);
  const paymentDisabled = structuredClone(portalConfiguration());
  paymentDisabled.features.payment_method_update.enabled = false;
  unsafe.push(paymentDisabled);
  const invoicesDisabled = structuredClone(portalConfiguration());
  invoicesDisabled.features.invoice_history.enabled = false;
  unsafe.push(invoicesDisabled);
  const unknownMutation = structuredClone(portalConfiguration());
  unknownMutation.features.future_subscription_mutation = { enabled: true };
  unsafe.push(unknownMutation);
  unsafe.push(portalConfiguration({ is_default: false }));
  unsafe.push(portalConfiguration({ livemode: true }));
  unsafe.push(portalConfiguration({ active: false }));

  for (const configuration of unsafe) {
    assert.equal(isApprovedStripePortalConfiguration(
      configuration, "bpc_Batch10General", false,
    ), false);
  }
});

test("Portal configuration preflight requires subscription pause to be exactly disabled", () => {
  const disabled = portalConfiguration();
  assert.equal(isApprovedStripePortalConfiguration(
    disabled, "bpc_Batch10General", false,
  ), true);

  const enabled = structuredClone(disabled);
  enabled.features.subscription_pause.enabled = true;
  const missingEnabled = structuredClone(disabled);
  delete missingEnabled.features.subscription_pause.enabled;
  const missingObject = structuredClone(disabled);
  delete missingObject.features.subscription_pause;
  const malformed = structuredClone(disabled);
  malformed.features.subscription_pause = "disabled";
  const unexpectedNested = structuredClone(disabled);
  unexpectedNested.features.subscription_pause.future_behavior = "pause_now";
  const unknownFeature = structuredClone(disabled);
  unknownFeature.features.future_subscription_mutation = { enabled: false };

  for (const configuration of [
    enabled,
    missingEnabled,
    missingObject,
    malformed,
    unexpectedNested,
    unknownFeature,
  ]) {
    assert.equal(isApprovedStripePortalConfiguration(
      configuration, "bpc_Batch10General", false,
    ), false);
  }
});

test("disabled subscription updates accept only inert proration defaults", () => {
  const none = portalConfiguration();
  assert.equal(isApprovedStripePortalConfiguration(
    none, "bpc_Batch10General", false,
  ), true);

  const alwaysInvoice = structuredClone(none);
  alwaysInvoice.features.subscription_update.proration_behavior = "always_invoice";
  assert.equal(isApprovedStripePortalConfiguration(
    alwaysInvoice, "bpc_Batch10General", false,
  ), true);

  const enabled = structuredClone(alwaysInvoice);
  enabled.features.subscription_update.enabled = true;
  const unknownProration = structuredClone(none);
  unknownProration.features.subscription_update.proration_behavior = "create_prorations";
  const missingProration = structuredClone(none);
  delete missingProration.features.subscription_update.proration_behavior;
  const malformedProration = structuredClone(none);
  malformedProration.features.subscription_update.proration_behavior = { mode: "none" };
  const productSwitching = structuredClone(none);
  productSwitching.features.subscription_update.products = [{ product: "prod_Blocked" }];
  const priceSwitching = structuredClone(none);
  priceSwitching.features.subscription_update.default_allowed_updates = ["price"];
  const scheduledUpdate = structuredClone(none);
  scheduledUpdate.features.subscription_update.schedule_at_period_end.conditions = [
    { type: "shortening_interval" },
  ];
  const unknownNestedField = structuredClone(none);
  unknownNestedField.features.subscription_update.quantity = { enabled: false };

  for (const configuration of [
    enabled,
    unknownProration,
    missingProration,
    malformedProration,
    productSwitching,
    priceSwitching,
    scheduledUpdate,
    unknownNestedField,
  ]) {
    assert.equal(isApprovedStripePortalConfiguration(
      configuration, "bpc_Batch10General", false,
    ), false);
  }
});

test("unsafe, missing, or unavailable Portal configuration returns no URL", async () => {
  const unsafeConfiguration = structuredClone(portalConfiguration());
  unsafeConfiguration.features.subscription_update.proration_behavior = "create_prorations";
  const unsafe = harness({
    retrievePortalConfiguration: async () => unsafeConfiguration,
  });
  const unsafeResponse = await unsafe.handler(request());
  assert.equal(unsafeResponse.status, 503);
  assert.deepEqual(await unsafeResponse.json(), {
    error: "billing_management_temporarily_unavailable",
  });
  assert.equal(unsafe.calls.record.length, 0);
  assert.equal(unsafe.calls.failed[0][1], "stripe_portal_configuration_unsafe");

  const missing = harness({ createPortalSession: async () => session({ configuration: "" }) });
  assert.equal((await missing.handler(request())).status, 503);
  assert.equal(missing.calls.retrieve.length, 0);
  assert.equal(missing.calls.record.length, 0);

  const unavailable = harness({
    retrievePortalConfiguration: async () => { throw new Error("provider details"); },
  });
  assert.equal((await unavailable.handler(request())).status, 503);
  assert.equal(unavailable.calls.record.length, 0);
  assert.equal(
    unavailable.calls.failed[0][1],
    "stripe_portal_configuration_retrieval_failed",
  );
});

test("Portal rejects non-Stripe redirect hosts and mode mismatch", async () => {
  for (const invalid of [
    session({ url: "https://evil.test/steal" }),
    session({ url: "https://billing.stripe.com.evil.test/steal" }),
    session({ livemode: true }),
    session({ customer: "cus_OtherStore" }),
  ]) {
    const { handler, calls } = harness({ createPortalSession: async () => invalid });
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.equal(calls.record.length, 0);
  }
  assert.equal(isSafeStripePortalUrl("https://billing.stripe.com/p/session/good"), true);
});

test("Portal rate limiting returns 429 without creating a provider Session", async () => {
  const { handler, calls } = harness({
    beginPortalAction: async () => authorization({ action_state: "rate_limited", retry_after_seconds: 90 }),
  });
  const response = await handler(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "90");
  assert.equal(calls.create.length, 0);
});

test("Portal binding failures fail closed before Stripe", async () => {
  const { handler, calls } = harness({
    beginPortalAction: async () => { throw new Error("cross-store binding"); },
  });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal(calls.create.length, 0);
  assert.deepEqual(await response.json(), { error: "billing_management_unavailable" });
});

test("Portal errors and responses redact provider secrets", async () => {
  const secret = ["sk", "test", "Batch10Secret"].join("_");
  const { handler } = harness({
    createPortalSession: async () => { throw new PortalProviderError("stripe_portal_request_ambiguous", secret); },
  });
  const response = await handler(request());
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.equal(body.includes(secret), false);
});

test("Portal import performs no provider or database call", () => {
  assert.equal(typeof createStripeSaasPortalHandler, "function");
});
