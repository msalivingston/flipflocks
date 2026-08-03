import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { createStripeSaasClient } from "../_shared/stripe-saas-client.ts";
import { parseStripeSaasPortalConfig } from "../_shared/stripe-saas-runtime.mjs";
import {
  createStripeSaasSubscriptionActionHandler,
  ResumeProviderError,
  type ResumeAuthorization,
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
  STRIPE_GENERAL_PORTAL_CONFIGURATION_ID: Deno.env.get("STRIPE_GENERAL_PORTAL_CONFIGURATION_ID"),
  STRIPE_CANCEL_PORTAL_CONFIGURATION_ID: Deno.env.get("STRIPE_CANCEL_PORTAL_CONFIGURATION_ID"),
});
if (config.livemode) throw new Error("Live SaaS subscription actions are not enabled in this batch.");

const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const anonKey = requiredEnvironment("SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const stripe = createStripeSaasClient(config);
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function authenticatedClient(authorization: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function firstRow<T>(data: unknown): T {
  if (!Array.isArray(data) || !data[0]) throw new Error("Trusted database contract returned no row.");
  return data[0] as T;
}

const handler = createStripeSaasSubscriptionActionHandler({
  allowedOrigin: config.appOrigin,
  async authenticate(authorization) {
    const { data: { user }, error } = await authenticatedClient(authorization).auth.getUser();
    return error ? null : user?.id ?? null;
  },
  async beginResume(authenticatedUserId) {
    const { data, error } = await serviceClient.rpc("begin_saas_subscription_resume", {
      p_authenticated_user_id: authenticatedUserId,
      p_stripe_livemode: config.livemode,
      p_stripe_account_id: config.platformAccountId,
      p_environment_id: config.environmentId,
    });
    if (error) throw new Error("Resume is unavailable.");
    return firstRow<ResumeAuthorization>(data);
  },
  async requestResume(authorization) {
    try {
      await stripe.subscriptions.update(
        authorization.stripe_subscription_id!,
        { cancel_at_period_end: false },
        { idempotencyKey: authorization.stripe_idempotency_key! },
      );
    } catch (error) {
      const type = error && typeof error === "object" && "type" in error
        ? String(error.type)
        : "";
      const definitive = [
        "StripeAuthenticationError", "StripePermissionError", "StripeInvalidRequestError",
      ].includes(type);
      throw new ResumeProviderError(
        definitive ? "stripe_resume_request_rejected" : "stripe_resume_request_ambiguous",
        definitive,
      );
    }
  },
  async recordResumeRequested(actionRequestId) {
    const { error } = await serviceClient.rpc("record_saas_subscription_resume_requested", {
      p_action_request_id: actionRequestId,
      p_provider_requested_at: new Date().toISOString(),
    });
    if (error) throw new Error("Resume request confirmation is pending.");
  },
  async markActionFailed(actionRequestId, failureCode) {
    const { error } = await serviceClient.rpc("mark_saas_billing_management_action_failed", {
      p_action_request_id: actionRequestId,
      p_failure_code: failureCode,
    });
    if (error) throw new Error("Resume failure could not be recorded.");
  },
});

Deno.serve(handler);
