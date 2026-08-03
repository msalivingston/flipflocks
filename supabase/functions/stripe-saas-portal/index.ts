import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { createStripeSaasClient } from "../_shared/stripe-saas-client.ts";
import { parseStripeSaasPortalConfig } from "../_shared/stripe-saas-runtime.mjs";
import {
  buildStripePortalSessionParams,
  createStripeSaasPortalHandler,
  PortalProviderError,
  type PortalAction,
  type PortalActionAuthorization,
  type SafePortalSession,
} from "./handler.ts";

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
if (config.livemode) throw new Error("Live SaaS Billing Portal is not enabled in this batch.");

const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const anonKey = requiredEnvironment("SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const stripe = createStripeSaasClient(config);
const returnUrl = `${config.appOrigin}/dashboard/account?billing=portal_return`;

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
  if (!Array.isArray(data) || !data[0]) throw new Error("Trusted database contract returned no row.");
  return data[0] as T;
}

const actionTypes: Record<PortalAction, string> = {
  manage_billing: "portal_general",
  update_payment_method: "portal_payment_method_update",
  invoice_history: "portal_invoice_history",
  cancel_subscription: "portal_cancel_subscription",
};

function safeSession(session: {
  id: string;
  url?: string | null;
  configuration: string | { id: string };
  customer: string;
  created: number;
  livemode: boolean;
}): SafePortalSession {
  return {
    id: session.id,
    url: session.url ?? null,
    configuration: typeof session.configuration === "string"
      ? session.configuration
      : session.configuration.id,
    customer: session.customer,
    created: session.created,
    livemode: session.livemode,
  };
}

const handler = createStripeSaasPortalHandler({
  allowedOrigin: config.appOrigin,
  stripeLivemode: config.livemode,
  async authenticate(authorization) {
    const { data: { user }, error } = await authenticatedClient(authorization).auth.getUser();
    return error ? null : user?.id ?? null;
  },
  async beginPortalAction(authenticatedUserId, action) {
    const { data, error } = await serviceClient.rpc("begin_saas_billing_portal_action", {
      p_authenticated_user_id: authenticatedUserId,
      p_action_type: actionTypes[action],
      p_stripe_livemode: config.livemode,
      p_stripe_account_id: config.platformAccountId,
      p_environment_id: config.environmentId,
    });
    if (error) throw new Error("Billing management is unavailable.");
    return firstRow<PortalActionAuthorization>(data);
  },
  async createPortalSession(authorization, action) {
    try {
      const session = await stripe.billingPortal.sessions.create(
        buildStripePortalSessionParams(
          action,
          authorization.stripe_customer_id!,
          authorization.stripe_subscription_id!,
          returnUrl,
        ),
      );
      const safe = safeSession(session);
      if (safe.customer !== authorization.stripe_customer_id) {
        throw new PortalProviderError("stripe_portal_response_invalid");
      }
      return safe;
    } catch (error) {
      if (error instanceof PortalProviderError) throw error;
      const type = error && typeof error === "object" && "type" in error
        ? String(error.type)
        : "";
      throw new PortalProviderError([
        "StripeAuthenticationError", "StripePermissionError", "StripeInvalidRequestError",
      ].includes(type) ? "stripe_portal_request_rejected" : "stripe_portal_request_ambiguous");
    }
  },
  async recordPortalSession(actionRequestId, session) {
    const { error } = await serviceClient.rpc("record_saas_billing_portal_session", {
      p_action_request_id: actionRequestId,
      p_stripe_portal_session_id: session.id,
      p_stripe_portal_configuration_id: session.configuration,
      p_provider_requested_at: new Date(session.created * 1_000).toISOString(),
    });
    if (error) throw new Error("Portal request confirmation is pending.");
  },
  async markActionFailed(actionRequestId, failureCode) {
    const { error } = await serviceClient.rpc("mark_saas_billing_management_action_failed", {
      p_action_request_id: actionRequestId,
      p_failure_code: failureCode,
    });
    if (error) throw new Error("Portal failure could not be recorded.");
  },
});

Deno.serve(handler);
