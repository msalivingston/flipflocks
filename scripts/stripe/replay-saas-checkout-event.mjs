import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { pathToFileURL } from "node:url";

import {
  checkoutCompletionRpcArguments,
  enrollmentRpcError,
  reconcileClaimedCheckoutCompletion,
  SaasWebhookDomainError,
} from "../../supabase/functions/stripe-saas-webhook/handler.ts";
import {
  parseStripeSaasConfig,
  StripeSaasError,
} from "../../supabase/functions/_shared/stripe-saas-runtime.mjs";

class CheckoutReplayError extends Error {
  constructor(code) {
    super("Verified Checkout replay could not be completed.");
    this.name = "CheckoutReplayError";
    this.code = code;
  }
}

function required(source, name) {
  const value = source[name]?.trim();
  if (!value) throw new CheckoutReplayError(`CHECKOUT_REPLAY_${name}_MISSING`);
  return value;
}

function parseArguments(argv) {
  if (argv.length !== 1) {
    throw new CheckoutReplayError("CHECKOUT_REPLAY_ARGUMENT_INVALID");
  }
  const match = /^--event-id=(evt_[A-Za-z0-9]+)$/.exec(argv[0]);
  if (!match) throw new CheckoutReplayError("CHECKOUT_REPLAY_EVENT_ID_INVALID");
  return { eventId: match[1] };
}

function firstRow(data, code) {
  if (!Array.isArray(data) || !data[0]) throw new CheckoutReplayError(code);
  return data[0];
}

function expandableId(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function isoFromStripeSeconds(value) {
  return Number.isInteger(value) && value > 0
    ? new Date(value * 1_000).toISOString()
    : null;
}

function metadata(value) {
  return {
    checkoutAttemptId: value?.checkout_attempt_id ?? "",
    storeId: value?.store_id ?? "",
    environmentId: value?.environment_id ?? "",
    planKey: value?.plan_key ?? "",
    billingCadence: value?.billing_cadence ?? "",
    schemaVersion: value?.schema_version ?? "",
  };
}

function createEvidenceRetriever(stripe) {
  return async (checkoutSessionId) => {
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
      !price.recurring || price.unit_amount == null || !product || product.deleted) {
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
        taxBehavior: price.tax_behavior,
        productTaxCode: expandableId(product.tax_code) ?? product.tax_code ?? "",
      },
    };
  };
}

async function rpc(client, name, args, code) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new CheckoutReplayError(code);
  return data;
}

function safeResultLines(state, result, conflictCode) {
  return [
    `Result: ${result}`,
    `Conflict code: ${conflictCode ?? "none"}`,
    `Customer binding exists: ${state.customer_binding_exists ? "yes" : "no"}`,
    `Subscription enrollment exists: ${state.subscription_enrollment_exists ? "yes" : "no"}`,
    `Trial claim exists: ${state.trial_claim_exists ? "yes" : "no"}`,
    `Lifecycle state: ${state.lifecycle_state ?? "unknown"}`,
  ];
}

export async function runVerifiedCheckoutReplay({
  argv,
  env,
  createSupabase = (url, key) => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  createStripe = (config) => new Stripe(config.operationalApiKey, {
    apiVersion: config.apiVersion,
    maxNetworkRetries: 2,
    timeout: 20_000,
  }),
  write = (line) => process.stdout.write(`${line}\n`),
}) {
  const { eventId } = parseArguments(argv);
  const config = parseStripeSaasConfig(env);
  if (config.livemode) {
    throw new CheckoutReplayError("CHECKOUT_REPLAY_LIVE_MODE_REFUSED");
  }
  const supabase = createSupabase(
    required(env, "SUPABASE_URL"),
    required(env, "SUPABASE_SERVICE_ROLE_KEY"),
  );
  const readState = async () => firstRow(await rpc(
    supabase,
    "get_failed_saas_checkout_completion_replay_state",
    { p_provider_event_id: eventId },
    "CHECKOUT_REPLAY_STATE_READ_FAILED",
  ), "CHECKOUT_REPLAY_EVENT_NOT_FOUND");
  const before = await readState();
  const identity = {
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
  const claim = firstRow(await rpc(
    supabase,
    "claim_failed_saas_checkout_completion_replay",
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
    "CHECKOUT_REPLAY_CLAIM_FAILED",
  ), "CHECKOUT_REPLAY_CLAIM_EMPTY");
  if (claim.replay_state !== "claimed") {
    for (const line of safeResultLines(
      before,
      claim.replay_state,
      claim.conflict_code,
    )) write(line);
    return { result: claim.replay_state, conflictCode: claim.conflict_code };
  }

  const stripe = createStripe(config);
  const dependencies = {
    stripeAccountId: config.platformAccountId,
    stripeLivemode: config.livemode,
    environmentId: config.environmentId,
    retrieveCheckoutCompletionEvidence: createEvidenceRetriever(stripe),
    async applyCheckoutCompletion(eventIdentity, leaseToken, evidence) {
      const { data, error } = await supabase.rpc(
        "apply_verified_saas_checkout_completion",
        checkoutCompletionRpcArguments(eventIdentity, leaseToken, evidence),
      );
      if (error) throw enrollmentRpcError(error);
      return firstRow(data, "CHECKOUT_REPLAY_APPLICATION_EMPTY");
    },
    async markFailed(eventIdentity, leaseToken, errorCode, retryable) {
      await rpc(supabase, "mark_saas_billing_provider_event_failed", {
        p_provider_event_id: eventIdentity.providerEventId,
        p_payload_hash: eventIdentity.payloadHash,
        p_stripe_account_id: eventIdentity.stripeAccountId,
        p_stripe_livemode: eventIdentity.stripeLivemode,
        p_processing_lease_token: leaseToken,
        p_error_code: errorCode,
        p_error_message: null,
        p_retryable: retryable,
      }, "CHECKOUT_REPLAY_FAILURE_RECORDING_FAILED");
    },
  };
  const response = await reconcileClaimedCheckoutCompletion(
    dependencies,
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
  const after = await readState();
  const result = typeof body.result === "string" ? body.result : "failed";
  const conflictCode = typeof body.code === "string" ? body.code : null;
  for (const line of safeResultLines(after, result, conflictCode)) write(line);
  if (response.status >= 400 || result === "permanent_conflict") {
    throw new CheckoutReplayError(
      conflictCode ?? "CHECKOUT_REPLAY_PROCESSING_FAILED",
    );
  }
  return { result, conflictCode };
}

async function main() {
  try {
    await runVerifiedCheckoutReplay({
      argv: process.argv.slice(2),
      env: process.env,
    });
  } catch (error) {
    const code = error instanceof CheckoutReplayError || error instanceof StripeSaasError
      ? error.code
      : "CHECKOUT_REPLAY_UNEXPECTED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
