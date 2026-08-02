import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { createStripeSaasWebhookVerifier } from "../_shared/stripe-saas-client.ts";
import { parseStripeSaasWebhookConfig } from "../_shared/stripe-saas-runtime.mjs";
import {
  createStripeSaasWebhookHandler,
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
if (stripeConfig.livemode) {
  throw new Error("Live SaaS webhook processing is not enabled in this batch.");
}

const serviceClient = createClient(
  requiredEnvironment("SUPABASE_URL"),
  requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const verifySignature = createStripeSaasWebhookVerifier(stripeConfig, 300);

function firstRow<T>(data: unknown): T {
  if (!Array.isArray(data) || !data[0]) {
    throw new Error("Trusted database contract returned no row.");
  }
  return data[0] as T;
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
