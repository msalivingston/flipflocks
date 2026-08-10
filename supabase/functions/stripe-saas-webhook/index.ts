import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import type Stripe from "npm:stripe@22.3.2";
import {
  createStripeSaasClient,
  createStripeSaasWebhookVerifier,
} from "../_shared/stripe-saas-client.ts";
import {
  assertStripeSaasRuntimeEnvironment,
  parseStripeSaasConfig,
  parseStripeSaasWebhookConfig,
} from "../_shared/stripe-saas-runtime.mjs";
import {
  createStripeSaasWebhookConfigurationErrorHandler,
  createStripeSaasWebhookHandler,
  checkoutCompletionRpcArguments,
  enrollmentRpcError,
  hasAuthorizedImmediatePlanChangeForInvoice,
  SaasWebhookDomainError,
  type OpenSaasPlanChange,
  type ProviderEventIdentity,
  type SaasCheckoutApplicationResult,
  type SaasCheckoutCompletionEvidence,
  type SaasCheckoutMetadata,
  type SaasDeferredEventClaim,
  type SaasInvoiceApplicationResult,
  type SaasInvoiceLifecycleEvidence,
  type SaasProviderEventClaim,
  type SaasRecurringPriceEvidence,
  type SaasSubscriptionApplicationResult,
  type SaasSubscriptionLifecycleEvidence,
} from "./handler.ts";

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Missing required server configuration.");
  return value;
}

let configuredHandler: (request: Request) => Promise<Response>;
try {
const stripeConfig = parseStripeSaasWebhookConfig({
  STRIPE_SAAS_WEBHOOK_SECRET: Deno.env.get("STRIPE_SAAS_WEBHOOK_SECRET"),
  STRIPE_PLATFORM_ACCOUNT_ID: Deno.env.get("STRIPE_PLATFORM_ACCOUNT_ID"),
  STRIPE_SAAS_LIVEMODE: Deno.env.get("STRIPE_SAAS_LIVEMODE"),
  FLOCKFRONT_ENVIRONMENT_ID: Deno.env.get("FLOCKFRONT_ENVIRONMENT_ID"),
});
const operationalConfig = parseStripeSaasConfig({
  STRIPE_SAAS_API_KEY: Deno.env.get("STRIPE_SAAS_API_KEY"),
  STRIPE_PLATFORM_ACCOUNT_ID: Deno.env.get("STRIPE_PLATFORM_ACCOUNT_ID"),
  STRIPE_SAAS_LIVEMODE: Deno.env.get("STRIPE_SAAS_LIVEMODE"),
  FLOCKFRONT_ENVIRONMENT_ID: Deno.env.get("FLOCKFRONT_ENVIRONMENT_ID"),
});
assertStripeSaasRuntimeEnvironment(stripeConfig);
assertStripeSaasRuntimeEnvironment(operationalConfig);

const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const serviceClient = createClient(
  supabaseUrl,
  requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const verifySignature = createStripeSaasWebhookVerifier(stripeConfig, 300);
const stripe = createStripeSaasClient(operationalConfig);

async function kickSellerWelcomeWorker(
  subscriptionEnrollmentId: string,
): Promise<void> {
  const workerSecret = Deno.env.get("POSTMARK_WORKER_SECRET")?.trim();
  if (!workerSecret) {
    console.info(JSON.stringify({
      event: "seller_welcome_worker_kick_skipped",
      reason: "worker_not_configured",
    }));
    return;
  }

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/postmark-email-worker`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-flockfront-worker-secret": workerSecret,
        },
        body: JSON.stringify({
          subscription_enrollment_id: subscriptionEnrollmentId,
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (!response.ok) {
      console.info(JSON.stringify({
        event: "seller_welcome_worker_kick_failed",
        reason: "worker_rejected",
      }));
    }
  } catch {
    console.info(JSON.stringify({
      event: "seller_welcome_worker_kick_failed",
      reason: "worker_unavailable",
    }));
  }
}

function firstRow<T>(data: unknown): T {
  if (!Array.isArray(data) || !data[0]) {
    throw new Error("Trusted database contract returned no row.");
  }
  return data[0] as T;
}

function isoFromStripeSeconds(value: number | null | undefined): string | null {
  return Number.isInteger(value) && (value ?? 0) > 0
    ? new Date((value as number) * 1_000).toISOString()
    : null;
}

function expandableId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value &&
    typeof value.id === "string") return value.id;
  return null;
}

function checkoutMetadata(value: Record<string, string> | null): SaasCheckoutMetadata {
  return {
    checkoutAttemptId: value?.checkout_attempt_id ?? "",
    storeId: value?.store_id ?? "",
    environmentId: value?.environment_id ?? "",
    planKey: value?.plan_key ?? "",
    billingCadence: value?.billing_cadence ?? "",
    schemaVersion: value?.schema_version ?? "",
  };
}

async function retrieveCheckoutCompletionEvidence(
  checkoutSessionId: string,
): Promise<SaasCheckoutCompletionEvidence> {
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
  const customerId = expandableId(session.customer);
  const subscriptionId = expandableId(session.subscription);
  if (!customerId || !subscriptionId) {
    throw new SaasWebhookDomainError(
      "checkout_completion_provider_shape_conflict",
      false,
    );
  }

  const [customerResult, subscription] = await Promise.all([
    stripe.customers.retrieve(customerId),
    stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["default_payment_method", "items.data.price.product"],
    }),
  ]);
  if (customerResult.deleted || subscription.items.data.length !== 1) {
    throw new SaasWebhookDomainError(
      "checkout_completion_provider_shape_conflict",
      false,
    );
  }
  const item = subscription.items.data[0];
  const price = item.price;
  const product = typeof price.product === "string"
    ? await stripe.products.retrieve(price.product)
    : price.product;
  const currentPeriodStart = isoFromStripeSeconds(item.current_period_start);
  const currentPeriodEnd = isoFromStripeSeconds(item.current_period_end);
  const sessionCreatedAt = isoFromStripeSeconds(session.created);
  const sessionExpiresAt = isoFromStripeSeconds(session.expires_at);
  const customerCreatedAt = isoFromStripeSeconds(customerResult.created);
  const subscriptionCreatedAt = isoFromStripeSeconds(subscription.created);
  if (!currentPeriodStart || !currentPeriodEnd || !sessionCreatedAt ||
    !sessionExpiresAt || !customerCreatedAt || !subscriptionCreatedAt ||
    !price.recurring || price.unit_amount == null || !product ||
    product.deleted) {
    throw new SaasWebhookDomainError(
      "checkout_completion_provider_shape_conflict",
      false,
    );
  }

  return {
    session: {
      id: session.id,
      createdAt: sessionCreatedAt,
      expiresAt: sessionExpiresAt,
      status: session.status,
      mode: session.mode,
      paymentStatus: session.payment_status,
      paymentMethodCollection: session.payment_method_collection,
      clientReferenceId: session.client_reference_id,
      livemode: session.livemode,
      customerId,
      subscriptionId,
      metadata: checkoutMetadata(session.metadata),
    },
    customer: {
      id: customerResult.id,
      createdAt: customerCreatedAt,
      livemode: customerResult.livemode,
    },
    subscription: {
      id: subscription.id,
      customerId: expandableId(subscription.customer) ?? "",
      status: subscription.status,
      createdAt: subscriptionCreatedAt,
      trialStart: isoFromStripeSeconds(subscription.trial_start),
      trialEnd: isoFromStripeSeconds(subscription.trial_end),
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      livemode: subscription.livemode,
      collectionMethod: subscription.collection_method,
      paymentMethodReady: subscription.default_payment_method != null,
      metadata: checkoutMetadata(subscription.metadata),
    },
    lineItem: {
      priceId: price.id,
      productId: product.id,
      quantity: item.quantity ?? 0,
      priceLivemode: price.livemode,
      productLivemode: product.livemode,
      priceActive: price.active,
      productActive: product.active,
      unitAmountCents: price.unit_amount,
      currency: price.currency,
      recurringInterval: price.recurring.interval,
      recurringIntervalCount: price.recurring.interval_count,
      priceType: price.type,
      billingScheme: price.billing_scheme,
      recurringUsageType: price.recurring.usage_type,
      taxBehavior: price.tax_behavior ?? "unspecified",
      productTaxCode: expandableId(product.tax_code) ?? "",
    },
  };
}

async function retrieveProductForPrice(
  price: Stripe.Price,
): Promise<Stripe.Product> {
  const product = typeof price.product === "string"
    ? await stripe.products.retrieve(price.product)
    : price.product;
  if (!product || product.deleted) {
    throw new SaasWebhookDomainError(
      "recurring_product_shape_conflict",
      false,
    );
  }
  return product;
}

function recurringPriceEvidence(
  price: Stripe.Price,
  product: Stripe.Product,
  quantity: number,
): SaasRecurringPriceEvidence {
  if (!price.recurring || price.unit_amount == null) {
    throw new SaasWebhookDomainError(
      "recurring_price_shape_conflict",
      false,
    );
  }
  return {
    priceId: price.id,
    productId: product.id,
    quantity,
    priceLivemode: price.livemode,
    productLivemode: product.livemode,
    priceActive: price.active,
    productActive: product.active,
    unitAmountCents: price.unit_amount,
    currency: price.currency,
    recurringInterval: price.recurring.interval,
    recurringIntervalCount: price.recurring.interval_count,
    priceType: price.type,
    billingScheme: price.billing_scheme,
    recurringUsageType: price.recurring.usage_type,
    taxBehavior: price.tax_behavior ?? "unspecified",
    productTaxCode: expandableId(product.tax_code) ?? "",
  };
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return expandableId(invoice.parent?.subscription_details?.subscription);
}

function classifyFinalizationFailure(invoice: Stripe.Invoice): string {
  const code = invoice.last_finalization_error?.code ?? "";
  if ([
    "account_country_invalid_address", "customer_tax_location_invalid",
    "invalid_tax_location", "tax_id_invalid",
    "payment_method_billing_details_address_missing", "postal_code_invalid",
    "incorrect_address",
  ].includes(code)) return "seller_billing_information_required";
  if (code.startsWith("payment_method_") || [
    "invoice_no_payment_method_types", "invoice_payment_intent_requires_action",
    "payment_intent_action_required",
  ].includes(code)) return "payment_configuration_required";
  return "provider_configuration_failure";
}

async function retrieveInvoiceLifecycleEvidence(
  invoiceId: string,
  eventType: string,
): Promise<SaasInvoiceLifecycleEvidence> {
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: [
      "lines.data.pricing.price_details.price.product",
      "parent.subscription_details.subscription",
    ],
  });
  const customerId = expandableId(invoice.customer);
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!customerId || !subscriptionId || !invoice.billing_reason ||
    !invoice.status) {
    throw new SaasWebhookDomainError(
      "invoice_provider_shape_conflict",
      false,
    );
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product"],
  });
  if (subscription.items.data.length !== 1) {
    throw new SaasWebhookDomainError(
      "invoice_subscription_shape_conflict",
      false,
    );
  }
  const item = subscription.items.data[0];
  const currentPrice = item.price;
  const { data: openChanges, error: openChangeError } = await serviceClient.rpc(
    "get_open_saas_plan_change_for_subscription",
    {
      p_stripe_subscription_id: subscriptionId,
      p_stripe_account_id: stripeConfig.platformAccountId,
      p_stripe_livemode: stripeConfig.livemode,
    },
  );
  if (openChangeError) {
    throw new SaasWebhookDomainError("plan_change_lookup_failed", true);
  }
  const openChange = (Array.isArray(openChanges) ? openChanges[0] : null) as
    OpenSaasPlanChange | null;
  const usePlanChangeValidation = hasAuthorizedImmediatePlanChangeForInvoice(
    invoice.billing_reason,
    invoice.id,
    openChange,
  );
  const subscriptionLines = invoice.lines.data.filter((line) => {
    const details = line.parent?.subscription_item_details;
    return details != null && details.subscription === subscriptionId &&
      expandableId(line.pricing?.price_details?.price) != null;
  });
  const candidateLines = usePlanChangeValidation
    ? subscriptionLines.filter((line) => line.amount > 0)
    : invoice.billing_reason === "subscription_update"
    ? subscriptionLines.filter((line) =>
      line.amount > 0 &&
      expandableId(line.pricing?.price_details?.price) === currentPrice.id
    )
    : subscriptionLines.filter((line) =>
      !line.parent?.subscription_item_details?.proration &&
      expandableId(line.pricing?.price_details?.price) === currentPrice.id
    );
  if (candidateLines.length !== 1) {
    throw new SaasWebhookDomainError(
      "invoice_recurring_line_conflict",
      false,
    );
  }
  const line = candidateLines[0];
  const targetPriceId = expandableId(line.pricing?.price_details?.price);
  const involvedPriceIds = new Set(subscriptionLines.map((candidate) =>
    expandableId(candidate.pricing?.price_details?.price)
  ));
  if (!targetPriceId || involvedPriceIds.has(null) || involvedPriceIds.size > 2 ||
    (involvedPriceIds.size === 2 && !involvedPriceIds.has(currentPrice.id))) {
    throw new SaasWebhookDomainError(
      "invoice_recurring_line_conflict",
      false,
    );
  }
  const price = targetPriceId === currentPrice.id
    ? currentPrice
    : await stripe.prices.retrieve(targetPriceId, { expand: ["product"] });
  const product = await retrieveProductForPrice(price);
  if (line.pricing?.price_details?.product !== product.id) {
    throw new SaasWebhookDomainError(
      "invoice_recurring_line_conflict",
      false,
    );
  }
  const servicePeriodStart = isoFromStripeSeconds(line.period.start);
  const servicePeriodEnd = isoFromStripeSeconds(line.period.end);
  const currentPeriodStart = isoFromStripeSeconds(item.current_period_start);
  const currentPeriodEnd = isoFromStripeSeconds(item.current_period_end);
  if (!servicePeriodStart || !servicePeriodEnd || line.quantity !== 1 ||
    !currentPeriodStart || !currentPeriodEnd || item.quantity !== 1 ||
    !Number.isSafeInteger(line.amount) || line.amount < 0) {
    throw new SaasWebhookDomainError(
      "invoice_recurring_line_conflict",
      false,
    );
  }

  const paidAt = isoFromStripeSeconds(invoice.status_transitions.paid_at);
  const nextPaymentAttemptAt = isoFromStripeSeconds(
    invoice.next_payment_attempt,
  );
  const failureCode = eventType === "invoice.payment_failed"
    ? "payment_failed"
    : eventType === "invoice.payment_action_required"
    ? "payment_action_required"
    : eventType === "invoice.finalization_failed"
    ? classifyFinalizationFailure(invoice)
    : null;

  return {
    invoice: {
      id: invoice.id,
      livemode: invoice.livemode,
      customerId,
      subscriptionId,
      billingReason: invoice.billing_reason,
      collectionMethod: invoice.collection_method,
      status: invoice.status,
      currency: invoice.currency,
      amountDueCents: invoice.amount_due,
      amountPaidCents: invoice.amount_paid,
      amountRemainingCents: invoice.amount_remaining,
      recurringLineAmountCents: line.amount,
      servicePeriodStart,
      servicePeriodEnd,
      paidAt,
      nextPaymentAttemptAt,
      failureCode,
      currentSubscriptionPriceId: currentPrice.id,
      currentSubscriptionQuantity: item.quantity ?? 0,
      currentPeriodStart,
      currentPeriodEnd,
      targetLineIsProration:
        line.parent?.subscription_item_details?.proration ?? false,
    },
    lineItem: recurringPriceEvidence(price, product, item.quantity ?? 0),
  };
}

async function retrieveSubscriptionLifecycleEvidence(
  subscriptionId: string,
): Promise<SaasSubscriptionLifecycleEvidence> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product"],
  });
  const customerId = expandableId(subscription.customer);
  if (!customerId || subscription.items.data.length !== 1) {
    throw new SaasWebhookDomainError(
      "subscription_provider_shape_conflict",
      false,
    );
  }
  const item = subscription.items.data[0];
  const product = await retrieveProductForPrice(item.price);
  const createdAt = isoFromStripeSeconds(subscription.created);
  if (!createdAt) {
    throw new SaasWebhookDomainError(
      "subscription_provider_shape_conflict",
      false,
    );
  }
  return {
    subscription: {
      id: subscription.id,
      livemode: subscription.livemode,
      customerId,
      status: subscription.status,
      currentPeriodStart: isoFromStripeSeconds(item.current_period_start),
      currentPeriodEnd: isoFromStripeSeconds(item.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: isoFromStripeSeconds(subscription.cancel_at),
      trialEnd: isoFromStripeSeconds(subscription.trial_end),
      createdAt,
      canceledAt: isoFromStripeSeconds(subscription.canceled_at),
      endedAt: isoFromStripeSeconds(subscription.ended_at),
    },
    lineItem: recurringPriceEvidence(
      item.price,
      product,
      item.quantity ?? 0,
    ),
  };
}

function lifecycleRpcError(
  error: { message?: string | null },
  domain: "invoice" | "subscription",
): SaasWebhookDomainError {
  const message = error.message ?? "";
  const enrollmentMissing = message ===
      `SAAS_${domain.toUpperCase()}_ENROLLMENT_NOT_FOUND`;
  const permanent = /^SAAS_(?:INVOICE|SUBSCRIPTION)_(?:EVIDENCE_INVALID|SHAPE_INVALID|PROVIDER_SHAPE_INVALID|SUCCESS_INVALID|FAILURE_STATUS_INVALID|ACTION_STATUS_INVALID|FINALIZATION_STATUS_INVALID|FAILURE_CODE_INVALID|EVENT_CLAIM_INVALID|EVENT_FENCE_INVALID|STORE_NOT_FOUND|BINDING_CONFLICT|CATALOG_CONFLICT|IDENTITY_CONFLICT|SERVICE_PERIOD_INVALID|TERMINAL_STATE_INVALID|TERMINAL_CONFLICT|TRIAL_CONFLICT|EVENT_FINALIZATION_FAILED)$/.test(
    message,
  ) || /^SAAS_PLAN_CHANGE_(?:EVENT_INVALID|EVIDENCE_INVALID|BINDING_CONFLICT|CATALOG_CONFLICT|SERVICE_PERIOD_INVALID|INVOICE_CONFLICT|STATE_CONFLICT)$/.test(message);
  return new SaasWebhookDomainError(
    enrollmentMissing
      ? "immutable_enrollment_not_ready"
      : permanent
      ? domain === "subscription"
        ? "immutable_binding_conflict"
        : "invoice_binding_conflict"
      : `${domain}_application_failed`,
    !permanent,
  );
}

const handler = createStripeSaasWebhookHandler({
  stripeAccountId: stripeConfig.platformAccountId,
  stripeLivemode: stripeConfig.livemode,
  environmentId: stripeConfig.environmentId,
  verifySignature,
  async hashPayload(rawBody) {
    const digest = await crypto.subtle.digest("SHA-256", rawBody);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  },
  async claimEvent(identity) {
    const { data, error } = await serviceClient.rpc(
      "claim_saas_billing_provider_event",
      {
        p_provider_event_id: identity.providerEventId,
        p_event_type: identity.eventType,
        p_provider_event_created_at: identity.providerEventCreatedAt,
        p_payload_hash: identity.payloadHash,
        p_stripe_account_id: identity.stripeAccountId,
        p_stripe_livemode: identity.stripeLivemode,
        p_environment_id: identity.environmentId,
        p_provider_object_type: identity.providerObjectType,
        p_provider_object_id: identity.providerObjectId,
      },
    );
    if (error) throw new Error("Provider event claim failed.");
    return firstRow<SaasProviderEventClaim>(data);
  },
  async claimDeferredEvent(identity) {
    const { data, error } = await serviceClient.rpc(
      "claim_deferred_saas_billing_provider_event",
      {
        p_provider_event_id: identity.providerEventId,
        p_payload_hash: identity.payloadHash,
        p_stripe_account_id: identity.stripeAccountId,
        p_stripe_livemode: identity.stripeLivemode,
        p_environment_id: identity.environmentId,
        p_event_type: identity.eventType,
        p_provider_object_type: identity.providerObjectType,
        p_provider_object_id: identity.providerObjectId,
      },
    );
    if (error) throw new Error("Deferred provider event claim failed.");
    return firstRow<SaasDeferredEventClaim>(data);
  },
  retrieveCheckoutCompletionEvidence,
  async applyCheckoutCompletion(
    identity: ProviderEventIdentity,
    processingLeaseToken: string,
    evidence: SaasCheckoutCompletionEvidence,
  ) {
    const { data, error } = await serviceClient.rpc(
      "apply_verified_saas_checkout_completion",
      checkoutCompletionRpcArguments(
        identity,
        processingLeaseToken,
        evidence,
      ),
    );
    if (error) {
      throw enrollmentRpcError(error);
    }
    const result = firstRow<SaasCheckoutApplicationResult>(data);
    await kickSellerWelcomeWorker(result.subscription_enrollment_id);
    return result;
  },
  retrieveInvoiceLifecycleEvidence,
  async applyInvoiceLifecycle(
    identity: ProviderEventIdentity,
    processingLeaseToken: string,
    evidence: SaasInvoiceLifecycleEvidence,
  ) {
    const invoice = evidence.invoice;
    const line = evidence.lineItem;
    const { data: openChanges, error: openChangeError } = await serviceClient.rpc(
      "get_open_saas_plan_change_for_subscription",
      {
        p_stripe_subscription_id: invoice.subscriptionId,
        p_stripe_account_id: identity.stripeAccountId,
        p_stripe_livemode: identity.stripeLivemode,
      },
    );
    if (openChangeError) throw new SaasWebhookDomainError("plan_change_lookup_failed", true);
    const openChange = Array.isArray(openChanges) ? openChanges[0] : null;
    if (openChange && openChange.target_stripe_price_id === line.priceId &&
      (!openChange.stripe_invoice_id || openChange.stripe_invoice_id === invoice.id)) {
      const outcome = {
        "invoice.payment_succeeded": "payment_succeeded",
        "invoice.payment_failed": "payment_failed",
        "invoice.payment_action_required": "payment_action_required",
      }[identity.eventType];
      if (!outcome) throw new SaasWebhookDomainError("invoice_event_type_invalid", false);
      const { data, error } = await serviceClient.rpc(
        "apply_verified_saas_plan_change_invoice_event",
        {
          p_outcome: outcome,
          p_provider_event_id: identity.providerEventId,
          p_payload_hash: identity.payloadHash,
          p_processing_lease_token: processingLeaseToken,
          p_stripe_account_id: identity.stripeAccountId,
          p_stripe_livemode: identity.stripeLivemode,
          p_environment_id: identity.environmentId,
          p_provider_event_created_at: identity.providerEventCreatedAt,
          p_stripe_invoice_id: invoice.id,
          p_invoice_livemode: invoice.livemode,
          p_stripe_customer_id: invoice.customerId,
          p_stripe_subscription_id: invoice.subscriptionId,
          p_target_stripe_price_id: line.priceId,
          p_target_stripe_product_id: line.productId,
          p_current_subscription_price_id: invoice.currentSubscriptionPriceId,
          p_current_subscription_quantity: invoice.currentSubscriptionQuantity,
          p_current_period_start: invoice.currentPeriodStart,
          p_current_period_end: invoice.currentPeriodEnd,
          p_billing_reason: invoice.billingReason,
          p_collection_method: invoice.collectionMethod,
          p_invoice_status: invoice.status,
          p_currency: invoice.currency,
          p_amount_due_cents: invoice.amountDueCents,
          p_amount_paid_cents: invoice.amountPaidCents,
          p_amount_remaining_cents: invoice.amountRemainingCents,
          p_target_line_amount_cents: invoice.recurringLineAmountCents,
          p_service_period_start: invoice.servicePeriodStart,
          p_service_period_end: invoice.servicePeriodEnd,
          p_observed_at: identity.eventType === "invoice.payment_succeeded"
            ? invoice.paidAt
            : identity.providerEventCreatedAt,
          p_next_payment_attempt_at: invoice.nextPaymentAttemptAt,
          p_line_quantity: line.quantity,
          p_price_livemode: line.priceLivemode,
          p_product_livemode: line.productLivemode,
          p_price_active: line.priceActive,
          p_product_active: line.productActive,
          p_unit_amount_cents: line.unitAmountCents,
          p_price_currency: line.currency,
          p_recurring_interval: line.recurringInterval,
          p_recurring_interval_count: line.recurringIntervalCount,
          p_price_type: line.priceType,
          p_billing_scheme: line.billingScheme,
          p_recurring_usage_type: line.recurringUsageType,
          p_tax_behavior: line.taxBehavior,
          p_product_tax_code: line.productTaxCode,
        },
      );
      if (error) throw lifecycleRpcError(error, "invoice");
      return firstRow<SaasInvoiceApplicationResult>(data);
    }
    const rpcName = {
      "invoice.payment_succeeded":
        "apply_verified_saas_invoice_payment_succeeded",
      "invoice.payment_failed": "apply_verified_saas_invoice_payment_failed",
      "invoice.payment_action_required":
        "apply_verified_saas_invoice_payment_action_required",
      "invoice.finalization_failed":
        "apply_verified_saas_invoice_finalization_failed",
    }[identity.eventType];
    if (!rpcName) {
      throw new SaasWebhookDomainError("invoice_event_type_invalid", false);
    }
    const observedParameter = identity.eventType === "invoice.payment_succeeded"
      ? "p_paid_at"
      : identity.eventType === "invoice.payment_failed"
      ? "p_failure_at"
      : identity.eventType === "invoice.payment_action_required"
      ? "p_action_required_at"
      : "p_finalization_failed_at";
    const { data, error } = await serviceClient.rpc(rpcName, {
      p_provider_event_id: identity.providerEventId,
      p_payload_hash: identity.payloadHash,
      p_processing_lease_token: processingLeaseToken,
      p_stripe_account_id: identity.stripeAccountId,
      p_stripe_livemode: identity.stripeLivemode,
      p_environment_id: identity.environmentId,
      p_provider_event_created_at: identity.providerEventCreatedAt,
      p_stripe_invoice_id: invoice.id,
      p_invoice_livemode: invoice.livemode,
      p_stripe_customer_id: invoice.customerId,
      p_stripe_subscription_id: invoice.subscriptionId,
      p_stripe_price_id: line.priceId,
      p_stripe_product_id: line.productId,
      p_billing_reason: invoice.billingReason,
      p_collection_method: invoice.collectionMethod,
      p_invoice_status: invoice.status,
      p_currency: invoice.currency,
      p_amount_due_cents: invoice.amountDueCents,
      p_amount_paid_cents: invoice.amountPaidCents,
      p_amount_remaining_cents: invoice.amountRemainingCents,
      p_recurring_line_amount_cents: invoice.recurringLineAmountCents,
      p_service_period_start: invoice.servicePeriodStart,
      p_service_period_end: invoice.servicePeriodEnd,
      [observedParameter]: identity.eventType === "invoice.payment_succeeded"
        ? invoice.paidAt
        : identity.providerEventCreatedAt,
      p_next_payment_attempt_at: invoice.nextPaymentAttemptAt,
      p_failure_code: invoice.failureCode,
      p_line_quantity: line.quantity,
      p_price_livemode: line.priceLivemode,
      p_product_livemode: line.productLivemode,
      p_price_active: line.priceActive,
      p_product_active: line.productActive,
      p_unit_amount_cents: line.unitAmountCents,
      p_price_currency: line.currency,
      p_recurring_interval: line.recurringInterval,
      p_recurring_interval_count: line.recurringIntervalCount,
      p_price_type: line.priceType,
      p_billing_scheme: line.billingScheme,
      p_recurring_usage_type: line.recurringUsageType,
      p_tax_behavior: line.taxBehavior,
      p_product_tax_code: line.productTaxCode,
    });
    if (error) throw lifecycleRpcError(error, "invoice");
    return firstRow<SaasInvoiceApplicationResult>(data);
  },
  retrieveSubscriptionLifecycleEvidence,
  async applySubscriptionLifecycle(
    identity: ProviderEventIdentity,
    processingLeaseToken: string,
    evidence: SaasSubscriptionLifecycleEvidence,
  ) {
    const subscription = evidence.subscription;
    const line = evidence.lineItem;
    const { data: openChanges, error: openChangeError } = await serviceClient.rpc(
      "get_open_saas_plan_change_for_subscription",
      {
        p_stripe_subscription_id: subscription.id,
        p_stripe_account_id: identity.stripeAccountId,
        p_stripe_livemode: identity.stripeLivemode,
      },
    );
    if (openChangeError) throw new SaasWebhookDomainError("plan_change_lookup_failed", true);
    const openChange = Array.isArray(openChanges) ? openChanges[0] : null;
    if (openChange && [
      openChange.source_stripe_price_id,
      openChange.target_stripe_price_id,
    ].includes(line.priceId)) {
      const { data, error } = await serviceClient.rpc(
        "apply_verified_saas_plan_change_subscription_event",
        {
          p_provider_event_id: identity.providerEventId,
          p_payload_hash: identity.payloadHash,
          p_processing_lease_token: processingLeaseToken,
          p_stripe_account_id: identity.stripeAccountId,
          p_stripe_livemode: identity.stripeLivemode,
          p_environment_id: identity.environmentId,
          p_provider_event_created_at: identity.providerEventCreatedAt,
          p_event_type: identity.eventType,
          p_stripe_subscription_id: subscription.id,
          p_subscription_livemode: subscription.livemode,
          p_stripe_customer_id: subscription.customerId,
          p_stripe_price_id: line.priceId,
          p_stripe_product_id: line.productId,
          p_subscription_status: subscription.status,
          p_current_period_start: subscription.currentPeriodStart,
          p_current_period_end: subscription.currentPeriodEnd,
          p_cancel_at_period_end: subscription.cancelAtPeriodEnd,
          p_line_quantity: line.quantity,
          p_price_livemode: line.priceLivemode,
          p_product_livemode: line.productLivemode,
          p_price_active: line.priceActive,
          p_product_active: line.productActive,
          p_unit_amount_cents: line.unitAmountCents,
          p_currency: line.currency,
          p_recurring_interval: line.recurringInterval,
          p_recurring_interval_count: line.recurringIntervalCount,
          p_price_type: line.priceType,
          p_billing_scheme: line.billingScheme,
          p_recurring_usage_type: line.recurringUsageType,
          p_tax_behavior: line.taxBehavior,
          p_product_tax_code: line.productTaxCode,
        },
      );
      if (error) throw lifecycleRpcError(error, "subscription");
      return firstRow<SaasSubscriptionApplicationResult>(data);
    }
    const { data, error } = await serviceClient.rpc(
      "apply_verified_stripe_subscription_event",
      {
        p_provider_event_id: identity.providerEventId,
        p_payload_hash: identity.payloadHash,
        p_processing_lease_token: processingLeaseToken,
        p_stripe_account_id: identity.stripeAccountId,
        p_stripe_livemode: identity.stripeLivemode,
        p_environment_id: identity.environmentId,
        p_provider_event_created_at: identity.providerEventCreatedAt,
        p_event_type: identity.eventType,
        p_stripe_subscription_id: subscription.id,
        p_subscription_livemode: subscription.livemode,
        p_stripe_customer_id: subscription.customerId,
        p_stripe_price_id: line.priceId,
        p_stripe_product_id: line.productId,
        p_subscription_status: subscription.status,
        p_current_period_start: subscription.currentPeriodStart,
        p_current_period_end: subscription.currentPeriodEnd,
        p_cancel_at_period_end: subscription.cancelAtPeriodEnd,
        p_subscription_cancel_at: subscription.cancelAt,
        p_subscription_created_at: subscription.createdAt,
        p_subscription_canceled_at: subscription.canceledAt,
        p_subscription_ended_at: subscription.endedAt,
        p_line_quantity: line.quantity,
        p_price_livemode: line.priceLivemode,
        p_product_livemode: line.productLivemode,
        p_price_active: line.priceActive,
        p_product_active: line.productActive,
        p_unit_amount_cents: line.unitAmountCents,
        p_currency: line.currency,
        p_recurring_interval: line.recurringInterval,
        p_recurring_interval_count: line.recurringIntervalCount,
        p_price_type: line.priceType,
        p_billing_scheme: line.billingScheme,
        p_recurring_usage_type: line.recurringUsageType,
        p_tax_behavior: line.taxBehavior,
        p_product_tax_code: line.productTaxCode,
      },
    );
    if (error) throw lifecycleRpcError(error, "subscription");
    return firstRow<SaasSubscriptionApplicationResult>(data);
  },
  async deferSubscriptionUntilEnrollment(
    identity,
    processingLeaseToken,
  ) {
    const { error } = await serviceClient.rpc(
      "defer_saas_subscription_event_until_enrollment",
      {
        p_provider_event_id: identity.providerEventId,
        p_payload_hash: identity.payloadHash,
        p_stripe_account_id: identity.stripeAccountId,
        p_stripe_livemode: identity.stripeLivemode,
        p_environment_id: identity.environmentId,
        p_event_type: identity.eventType,
        p_provider_object_type: identity.providerObjectType,
        p_provider_object_id: identity.providerObjectId,
        p_processing_lease_token: processingLeaseToken,
      },
    );
    if (error) {
      throw new Error("Subscription event enrollment deferral failed.");
    }
  },
  async markDeferred(identity, processingLeaseToken, reasonCode) {
    const { error } = await serviceClient.rpc(
      "mark_saas_billing_provider_event_deferred",
      {
        p_provider_event_id: identity.providerEventId,
        p_payload_hash: identity.payloadHash,
        p_stripe_account_id: identity.stripeAccountId,
        p_stripe_livemode: identity.stripeLivemode,
        p_processing_lease_token: processingLeaseToken,
        p_reason_code: reasonCode,
      },
    );
    if (error) throw new Error("Provider event deferred state failed.");
  },
  async markIgnored(identity, processingLeaseToken, reasonCode) {
    const { error } = await serviceClient.rpc(
      "mark_saas_billing_provider_event_ignored",
      {
        p_provider_event_id: identity.providerEventId,
        p_payload_hash: identity.payloadHash,
        p_stripe_account_id: identity.stripeAccountId,
        p_stripe_livemode: identity.stripeLivemode,
        p_processing_lease_token: processingLeaseToken,
        p_reason_code: reasonCode,
      },
    );
    if (error) throw new Error("Provider event terminal state failed.");
  },
  async markFailed(identity, processingLeaseToken, errorCode, retryable) {
    const { error } = await serviceClient.rpc(
      "mark_saas_billing_provider_event_failed",
      {
        p_provider_event_id: identity.providerEventId,
        p_payload_hash: identity.payloadHash,
        p_stripe_account_id: identity.stripeAccountId,
        p_stripe_livemode: identity.stripeLivemode,
        p_processing_lease_token: processingLeaseToken,
        p_error_code: errorCode,
        p_error_message: null,
        p_retryable: retryable,
      },
    );
    if (error) throw new Error("Provider event failure state failed.");
  },
  safeLog(record) {
    console.info(JSON.stringify(record));
  },
});

configuredHandler = handler;
} catch {
  configuredHandler = createStripeSaasWebhookConfigurationErrorHandler({
    safeLog(record) {
      console.info(JSON.stringify(record));
    },
  });
}

Deno.serve(configuredHandler);
