// Seller direct-charge Stripe client. Never use this client for FlockFront SaaS billing.
import Stripe from "npm:stripe@22.3.2";
import { STRIPE_SAAS_API_VERSION } from "./stripe-saas-runtime.mjs";

export function createStripeConnectClient(apiKey: string): Stripe {
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(apiKey)) {
    throw new Error("STRIPE_CONNECT_API_KEY_INVALID");
  }
  return new Stripe(apiKey, {
    apiVersion: STRIPE_SAAS_API_VERSION,
    maxNetworkRetries: 2,
  });
}

