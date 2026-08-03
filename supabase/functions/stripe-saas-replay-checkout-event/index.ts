import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { createStripeSaasClient } from "../_shared/stripe-saas-client.ts";
import { parseStripeSaasPortalConfig } from
  "../_shared/stripe-saas-runtime.mjs";
import {
  checkoutCompletionRpcArguments,
  enrollmentRpcError,
  reconcileClaimedCheckoutCompletion,
  SaasWebhookDomainError,
  type ProviderEventIdentity,
  type SaasCheckoutApplicationResult,
  type SaasCheckoutCompletionEvidence,
} from "../stripe-saas-webhook/handler.ts";
import {
  createStripeSaasReplayCheckoutEventHandler,
  type CheckoutReplayResult,
} from "./handler.ts";

type ReplayState = {
  provider_event_id: string;
  payload_hash: string;
  stripe_account_id: string;
  stripe_livemode: boolean;
  processing_environment_id: string;
  event_type: string;
  provider_object_type: string;
  provider_object_id: string;
  provider_event_created_at: string;
  processing_status: string;
  last_error_code: string | null;
  customer_binding_exists: boolean;
  subscription_enrollment_exists: boolean;
  trial_claim_exists: boolean;
  lifecycle_state: string;
};

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Missing required server configuration.");
  return value;
}

const config = parseStripeSaasPortalConfig({
  STRIPE_SAAS_API_KEY: Deno.env.get("STRIPE_SAAS_API_KEY"),
  STRIPE_PLATFORM_ACCOUNT_ID: Deno.env.get("STRIPE_PLATFORM_ACCOUNT_ID"),
  STRIPE_SAAS_LIVEMODE: Deno.env.get("STRIPE_SAAS_LIVEMODE"),
  FLOCKFRONT_ENVIRONMENT_ID: Deno.env.get("FLOCKFRONT_ENVIRONMENT_ID"),
  FLOCKFRONT_APP_ORIGIN: Deno.env.get("FLOCKFRONT_APP_ORIGIN"),
});
if (config.livemode) {
  throw new Error("Live Checkout replay is not enabled.");
}
const operatorUserId = requiredEnvironment(
  "STRIPE_SAAS_REPLAY_OPERATOR_USER_ID",
);
const allowedEventId = requiredEnvironment(
  "STRIPE_SAAS_REPLAY_ALLOWED_EVENT_ID",
);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  .test(operatorUserId) || !/^evt_[A-Za-z0-9]+$/.test(allowedEventId)) {
  throw new Error("Temporary Checkout replay authorization is invalid.");
}

const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const anonKey = requiredEnvironment("SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stripe = createStripeSaasClient(config);

function authenticatedClient(authorization: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data[0] ? data[0] as T : null;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await serviceClient.rpc(name, args);
  if (error) throw new Error("Trusted replay contract failed.");
  return data as T;
}

function expandableId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value &&
    typeof value.id === "string") return value.id;
  return null;
}

function isoFromStripeSeconds(value: number | null | undefined): string | null {
  return Number.isInteger(value) && (value ?? 0) > 0
    ? new Date((value as number) * 1_000).toISOString()
    : null;
}

function metadata(value: Record<string, string> | null) {
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
  const [customer, subscription] = await Promise.all([
    stripe.customers.retrieve(customerId),
    stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["default_payment_method", "items.data.price.product"],
    }),
  ]);
  if (customer.deleted || subscription.items.data.length !== 1) {
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
  const sessionCreatedAt = isoFromStripeSeconds(session.created);
  const sessionExpiresAt = isoFromStripeSeconds(session.expires_at);
  const customerCreatedAt = isoFromStripeSeconds(customer.created);
  const subscriptionCreatedAt = isoFromStripeSeconds(subscription.created);
  const currentPeriodStart = isoFromStripeSeconds(item.current_period_start);
  const currentPeriodEnd = isoFromStripeSeconds(item.current_period_end);
  if (!sessionCreatedAt || !sessionExpiresAt || !customerCreatedAt ||
    !subscriptionCreatedAt || !currentPeriodStart || !currentPeriodEnd ||
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
      metadata: metadata(session.metadata),
    },
    customer: {
      id: customer.id,
      createdAt: customerCreatedAt,
      livemode: customer.livemode,
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
      metadata: metadata(subscription.metadata),
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

function safeResult(
  state: ReplayState | null,
  result: string,
  conflictCode: string | null,
): CheckoutReplayResult {
  return {
    result,
    conflict_code: conflictCode,
    customer_binding_exists: state?.customer_binding_exists === true,
    subscription_enrollment_exists:
      state?.subscription_enrollment_exists === true,
    trial_claim_exists: state?.trial_claim_exists === true,
    lifecycle_state: state?.lifecycle_state ?? "unknown",
  };
}

async function readState(eventId: string): Promise<ReplayState | null> {
  return firstRow<ReplayState>(await rpc(
    "get_failed_saas_checkout_completion_replay_state",
    { p_provider_event_id: eventId },
  ));
}

async function replayVerifiedEvent(eventId: string): Promise<CheckoutReplayResult> {
  if (eventId !== allowedEventId) {
    return safeResult(null, "not_replayable", null);
  }
  const before = await readState(eventId);
  if (!before || before.event_type !== "checkout.session.completed" ||
    before.provider_object_type !== "checkout.session") {
    return safeResult(before, "not_replayable", before?.last_error_code ?? null);
  }
  const identity: ProviderEventIdentity = {
    providerEventId: before.provider_event_id,
    eventType: before.event_type,
    providerEventCreatedAt: before.provider_event_created_at,
    payloadHash: before.payload_hash,
    stripeAccountId: before.stripe_account_id,
    stripeLivemode: before.stripe_livemode,
    environmentId: before.processing_environment_id,
    providerObjectType: before.provider_object_type,
    providerObjectId: before.provider_object_id,
  };
  const claim = firstRow<{
    replay_state: string;
    attempt_count: number;
    processing_lease_token: string | null;
    lease_expires_at: string | null;
    conflict_code: string | null;
  }>(await rpc("claim_failed_saas_checkout_completion_replay", {
    p_provider_event_id: identity.providerEventId,
    p_payload_hash: identity.payloadHash,
    p_stripe_account_id: identity.stripeAccountId,
    p_stripe_livemode: identity.stripeLivemode,
    p_environment_id: identity.environmentId,
    p_event_type: identity.eventType,
    p_provider_object_type: identity.providerObjectType,
    p_provider_object_id: identity.providerObjectId,
  }));
  if (!claim || claim.replay_state !== "claimed") {
    return safeResult(
      await readState(eventId),
      claim?.replay_state ?? "temporarily_unavailable",
      claim?.conflict_code ?? null,
    );
  }
  const response = await reconcileClaimedCheckoutCompletion(
    {
      stripeAccountId: config.platformAccountId,
      stripeLivemode: config.livemode,
      environmentId: config.environmentId,
      retrieveCheckoutCompletionEvidence,
      async applyCheckoutCompletion(eventIdentity, leaseToken, evidence) {
        const { data, error } = await serviceClient.rpc(
          "apply_verified_saas_checkout_completion",
          checkoutCompletionRpcArguments(eventIdentity, leaseToken, evidence),
        );
        if (error) throw enrollmentRpcError(error);
        const row = firstRow<SaasCheckoutApplicationResult>(data);
        if (!row) throw new Error("Trusted enrollment result is unavailable.");
        return row;
      },
      async markFailed(eventIdentity, leaseToken, errorCode, retryable) {
        await rpc("mark_saas_billing_provider_event_failed", {
          p_provider_event_id: eventIdentity.providerEventId,
          p_payload_hash: eventIdentity.payloadHash,
          p_stripe_account_id: eventIdentity.stripeAccountId,
          p_stripe_livemode: eventIdentity.stripeLivemode,
          p_processing_lease_token: leaseToken,
          p_error_code: errorCode,
          p_error_message: null,
          p_retryable: retryable,
        });
      },
    },
    identity,
    null,
    Date.now(),
    {
      reconciliation_state: "claimed",
      processing_status: "processing",
      attempt_count: claim.attempt_count,
      processing_lease_token: claim.processing_lease_token,
      lease_expires_at: claim.lease_expires_at,
      deferred_reason: "awaiting_verified_enrollment_batch",
    },
  );
  const body = await response.json();
  const result = typeof body.result === "string"
    ? body.result
    : "temporarily_unavailable";
  const conflictCode = typeof body.code === "string" ? body.code : null;
  return safeResult(await readState(eventId), result, conflictCode);
}

const handler = createStripeSaasReplayCheckoutEventHandler({
  allowedOrigin: config.appOrigin,
  async authorizeOperator(authorization) {
    const { data: { user }, error } = await authenticatedClient(authorization)
      .auth.getUser();
    if (error || !user || user.id !== operatorUserId) return false;
    const { data, error: roleError } = await serviceClient
      .from("user_roles")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .is("store_id", null)
      .limit(1);
    return !roleError && Array.isArray(data) && data.length === 1;
  },
  replayVerifiedEvent,
});

Deno.serve(handler);
