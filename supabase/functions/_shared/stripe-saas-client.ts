// FlockFront platform SaaS billing only. This is not a Connect client.
import Stripe from "npm:stripe@22.3.2";
import {
  STRIPE_SAAS_API_VERSION,
  parseStripeSaasConfig,
} from "./stripe-saas-runtime.mjs";

type StripeSaasConfig = ReturnType<typeof parseStripeSaasConfig>;

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
