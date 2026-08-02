import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import {
  createStripeSaasClient,
} from "../_shared/stripe-saas-client.ts";
import { parseStripeSaasConfig } from "../_shared/stripe-saas-runtime.mjs";
import {
  CheckoutProviderError,
  createStripeSaasCheckoutHandler,
  type SaasCheckoutAttempt,
  type SafeCheckoutSession,
} from "./handler.ts";

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Missing required server configuration.");
  return value;
}

function configuredOrigin(name: string): string {
  const raw = requiredEnvironment(name);
  const url = new URL(raw);
  if (url.pathname !== "/" || url.search || url.hash ||
    !(url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new Error("Invalid server origin configuration.");
  }
  return url.origin;
}

const stripeConfig = parseStripeSaasConfig({
  STRIPE_SAAS_API_KEY: Deno.env.get("STRIPE_SAAS_API_KEY"),
  STRIPE_SAAS_CATALOG_READ_KEY: Deno.env.get("STRIPE_SAAS_CATALOG_READ_KEY"),
  STRIPE_PLATFORM_ACCOUNT_ID: Deno.env.get("STRIPE_PLATFORM_ACCOUNT_ID"),
  STRIPE_SAAS_LIVEMODE: Deno.env.get("STRIPE_SAAS_LIVEMODE"),
  FLOCKFRONT_ENVIRONMENT_ID: Deno.env.get("FLOCKFRONT_ENVIRONMENT_ID"),
});
if (stripeConfig.livemode) {
  throw new Error("Live SaaS Checkout is not enabled in this batch.");
}

const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const anonKey = requiredEnvironment("SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigin = configuredOrigin("FLIPFLOCKS_PUBLIC_API_ORIGIN");
const publicSiteOrigin = configuredOrigin("FLOCKFRONT_PUBLIC_SITE_URL");
const stripe = createStripeSaasClient(stripeConfig);

function authenticatedClient(authorization: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function firstRow<T>(data: unknown): T {
  if (!Array.isArray(data) || !data[0]) {
    throw new Error("Trusted database contract returned no row.");
  }
  return data[0] as T;
}

function safeSession(session: {
  id: string;
  url?: string | null;
  mode?: string | null;
  status?: string | null;
  livemode: boolean;
  created: number;
  expires_at: number;
  customer?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
}): SafeCheckoutSession {
  return {
    id: session.id,
    url: session.url ?? null,
    mode: session.mode ?? null,
    status: session.status ?? null,
    livemode: session.livemode,
    created: session.created,
    expires_at: session.expires_at,
    customer: typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null,
    metadata: session.metadata ?? {},
  };
}

const handler = createStripeSaasCheckoutHandler({
  allowedOrigin,
  stripeLivemode: stripeConfig.livemode,
  stripeAccountId: stripeConfig.platformAccountId,
  async authenticate(authorization) {
    const { data: { user }, error } = await authenticatedClient(authorization)
      .auth.getUser();
    return error ? null : user?.id ?? null;
  },
  async beginCheckout(authenticatedUserId, planKey, cadence) {
    const { data, error } = await serviceClient.rpc(
      "begin_saas_subscription_checkout",
      {
        p_authenticated_user_id: authenticatedUserId,
        p_requested_plan_key: planKey,
        p_requested_billing_cadence: cadence,
        p_stripe_livemode: stripeConfig.livemode,
        p_stripe_account_id: stripeConfig.platformAccountId,
        p_environment_id: stripeConfig.environmentId,
      },
    );
    if (error) throw new Error("Checkout is unavailable.");
    return firstRow<SaasCheckoutAttempt>(data);
  },
  async createCheckoutSession(attempt) {
    const metadata = {
      checkout_attempt_id: attempt.attempt_id!,
      store_id: attempt.store_id,
      environment_id: stripeConfig.environmentId,
    };
    const subscriptionMetadata = {
      checkout_attempt_id: attempt.attempt_id!,
      store_id: attempt.store_id,
      environment_id: stripeConfig.environmentId,
    };
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: attempt.stripe_price_id!, quantity: 1 }],
        payment_method_collection: "always",
        success_url:
          `${publicSiteOrigin}/onboarding?billing=checkout_return`,
        cancel_url:
          `${publicSiteOrigin}/onboarding?billing=checkout_canceled`,
        client_reference_id: attempt.attempt_id!,
        customer: attempt.stripe_customer_id ?? undefined,
        allow_promotion_codes: false,
        metadata,
        subscription_data: {
          metadata: subscriptionMetadata,
          ...(attempt.trial_eligibility === "trial_eligible"
            ? { trial_period_days: 7 }
            : {}),
        },
      }, { idempotencyKey: attempt.stripe_idempotency_key! });
      return safeSession(session);
    } catch (error) {
      const type = error && typeof error === "object" && "type" in error
        ? String(error.type)
        : "";
      const definitive = [
        "StripeAuthenticationError",
        "StripePermissionError",
        "StripeInvalidRequestError",
      ].includes(type);
      throw new CheckoutProviderError(
        definitive
          ? "stripe_checkout_request_rejected"
          : "stripe_checkout_request_ambiguous",
        definitive,
      );
    }
  },
  async retrieveCheckoutSession(sessionId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return safeSession(session);
  },
  async recordCheckoutSession(attempt, session) {
    const { error } = await serviceClient.rpc("record_saas_checkout_session", {
      p_attempt_id: attempt.attempt_id,
      p_stripe_checkout_session_id: session.id,
      p_session_created_at: new Date(session.created * 1_000).toISOString(),
      p_session_expires_at: new Date(session.expires_at * 1_000).toISOString(),
      p_stripe_livemode: stripeConfig.livemode,
      p_stripe_account_id: stripeConfig.platformAccountId,
      p_stripe_customer_id: session.customer,
    });
    if (error) throw new Error("Checkout confirmation is pending.");
  },
  async markCheckoutCreationFailed(attemptId, failureCode) {
    const { error } = await serviceClient.rpc(
      "mark_saas_checkout_creation_failed",
      { p_attempt_id: attemptId, p_failure_code: failureCode },
    );
    if (error) throw new Error("Checkout failure could not be recorded.");
  },
});

Deno.serve(handler);
