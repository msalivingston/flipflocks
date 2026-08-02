// FlockFront platform SaaS billing only. This is not a Connect client.
import Stripe from "npm:stripe@22.3.2";
import {
  STRIPE_SAAS_API_VERSION,
  assertStripeWebhookTimestampWithinTolerance,
  parseStripeSaasConfig,
  parseStripeSaasWebhookConfig,
} from "./stripe-saas-runtime.mjs";

type StripeSaasConfig = ReturnType<typeof parseStripeSaasConfig>;
type StripeSaasWebhookConfig = ReturnType<typeof parseStripeSaasWebhookConfig>;

export function createStripeSaasClient(
  config: StripeSaasConfig,
  apiKey = config.operationalApiKey,
): Stripe {
  if (!apiKey) throw new Error("STRIPE_SAAS_CLIENT_KEY_MISSING");
  return new Stripe(apiKey, {
    apiVersion: STRIPE_SAAS_API_VERSION,
    maxNetworkRetries: 2,
  });
}

export function createStripeSaasCatalogReadClient(config: StripeSaasConfig): Stripe {
  return createStripeSaasClient(
    config,
    config.catalogReadApiKey ?? config.operationalApiKey,
  );
}

export function createStripeSaasWebhookVerifier(
  config: StripeSaasWebhookConfig,
  toleranceSeconds = 300,
) {
  if (!Number.isInteger(toleranceSeconds) || toleranceSeconds < 1) {
    throw new Error("STRIPE_SAAS_WEBHOOK_TOLERANCE_INVALID");
  }
  return async (rawBody: Uint8Array, signature: string): Promise<Stripe.Event> => {
    const event = await Stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      config.webhookSecret,
      toleranceSeconds,
    );
    // The pinned SDK rejects old signatures but intentionally permits future
    // timestamps. Apply the symmetric bound only after cryptographic verification.
    assertStripeWebhookTimestampWithinTolerance(signature, toleranceSeconds);
    return event;
  };
}
