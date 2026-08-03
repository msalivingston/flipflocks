import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import {
  createStripeSaasClient,
  createStripeSaasWebhookVerifier,
} from "../_shared/stripe-saas-client.ts";
import {
  parseStripeSaasConfig,
  parseStripeSaasWebhookConfig,
} from "../_shared/stripe-saas-runtime.mjs";
import {
  createStripeSaasWebhookHandler,
  SaasWebhookDomainError,
  type ProviderEventIdentity,
  type SaasCheckoutApplicationResult,
  type SaasCheckoutCompletionEvidence,
  type SaasCheckoutMetadata,
  type SaasDeferredEventClaim,
  type SaasProviderEventClaim,
} from "./handler.ts";

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Missing required server configuration.");
  return value;
}

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
if (stripeConfig.livemode) {
  throw new Error("Live SaaS webhook processing is not enabled in this batch.");
}

const serviceClient = createClient(
  requiredEnvironment("SUPABASE_URL"),
  requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const verifySignature = createStripeSaasWebhookVerifier(stripeConfig, 300);
const stripe = createStripeSaasClient(operationalConfig);

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

function isPermanentEnrollmentError(error: { message?: string | null }): boolean {
  return /^SAAS_ENROLLMENT_(?:EVIDENCE_INVALID|PROVIDER_SHAPE_INVALID|EVENT_CLAIM_INVALID|ATTEMPT_NOT_FOUND|ATTEMPT_CONFLICT|BILLING_STATE_CONFLICT|METADATA_CONFLICT|CATALOG_CONFLICT|TRIAL_DECISION_INVALID|TRIAL_CONFLICT|TRIAL_USED_CONFLICT|CUSTOMER_CONFLICT|SUBSCRIPTION_CONFLICT|EVENT_FINALIZATION_FAILED)$/.test(
    error.message ?? "",
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
    const session = evidence.session;
    const customer = evidence.customer;
    const subscription = evidence.subscription;
    const line = evidence.lineItem;
    const { data, error } = await serviceClient.rpc(
      "apply_verified_saas_checkout_completion",
      {
        p_provider_event_id: identity.providerEventId,
        p_payload_hash: identity.payloadHash,
        p_processing_lease_token: processingLeaseToken,
        p_stripe_account_id: identity.stripeAccountId,
        p_stripe_livemode: identity.stripeLivemode,
        p_environment_id: identity.environmentId,
        p_provider_event_created_at: identity.providerEventCreatedAt,
        p_checkout_session_id: session.id,
        p_session_created_at: session.createdAt,
        p_session_expires_at: session.expiresAt,
        p_session_status: session.status,
        p_session_mode: session.mode,
        p_session_payment_status: session.paymentStatus,
        p_session_payment_method_collection: session.paymentMethodCollection,
        p_session_client_reference_id: session.clientReferenceId,
        p_session_livemode: session.livemode,
        p_attempt_id: session.metadata.checkoutAttemptId,
        p_session_metadata_attempt_id: session.metadata.checkoutAttemptId,
        p_session_metadata_store_id: session.metadata.storeId,
        p_session_metadata_environment_id: session.metadata.environmentId,
        p_session_metadata_plan_key: session.metadata.planKey,
        p_session_metadata_billing_cadence: session.metadata.billingCadence,
        p_session_metadata_schema_version: session.metadata.schemaVersion,
        p_stripe_customer_id: customer.id,
        p_customer_created_at: customer.createdAt,
        p_customer_livemode: customer.livemode,
        p_stripe_subscription_id: subscription.id,
        p_subscription_status: subscription.status,
        p_subscription_created_at: subscription.createdAt,
        p_subscription_trial_start: subscription.trialStart,
        p_subscription_trial_end: subscription.trialEnd,
        p_subscription_current_period_start: subscription.currentPeriodStart,
        p_subscription_current_period_end: subscription.currentPeriodEnd,
        p_subscription_cancel_at_period_end: subscription.cancelAtPeriodEnd,
        p_subscription_livemode: subscription.livemode,
        p_subscription_collection_method: subscription.collectionMethod,
        p_payment_method_ready: subscription.paymentMethodReady,
        p_subscription_metadata_attempt_id:
          subscription.metadata.checkoutAttemptId,
        p_subscription_metadata_store_id: subscription.metadata.storeId,
        p_subscription_metadata_environment_id:
          subscription.metadata.environmentId,
        p_subscription_metadata_plan_key: subscription.metadata.planKey,
        p_subscription_metadata_billing_cadence:
          subscription.metadata.billingCadence,
        p_subscription_metadata_schema_version:
          subscription.metadata.schemaVersion,
        p_stripe_price_id: line.priceId,
        p_stripe_product_id: line.productId,
        p_line_item_quantity: line.quantity,
        p_price_livemode: line.priceLivemode,
        p_product_livemode: line.productLivemode,
        p_price_active: line.priceActive,
        p_product_active: line.productActive,
        p_unit_amount_cents: line.unitAmountCents,
        p_currency: line.currency,
        p_recurring_interval: line.recurringInterval,
        p_recurring_interval_count: line.recurringIntervalCount,
        p_stripe_price_type: line.priceType,
        p_billing_scheme: line.billingScheme,
        p_recurring_usage_type: line.recurringUsageType,
        p_tax_behavior: line.taxBehavior,
        p_stripe_product_tax_code: line.productTaxCode,
      },
    );
    if (error) {
      throw new SaasWebhookDomainError(
        isPermanentEnrollmentError(error)
          ? "checkout_completion_binding_conflict"
          : "checkout_completion_apply_failed",
        !isPermanentEnrollmentError(error),
      );
    }
    return firstRow<SaasCheckoutApplicationResult>(data);
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

Deno.serve(handler);
