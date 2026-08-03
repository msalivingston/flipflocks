/** Server-only FlockFront SaaS Stripe constants and validation. No import-time I/O. */
export const STRIPE_SAAS_SDK_VERSION = "22.3.2";
export const STRIPE_SAAS_API_VERSION = "2026-06-24.dahlia";
export const STRIPE_SAAS_PLATFORM_ACCOUNT_ID = "acct_1CTOghL1R5g4hhXt";
export const STRIPE_SAAS_ENVIRONMENT_IDS = Object.freeze([
  "local", "development", "test", "preview", "staging", "production",
]);
export const STRIPE_SAAS_CATALOG = Object.freeze({
  small_flock: Object.freeze({
    productName: "FlockFront Coop",
    monthly: Object.freeze({ amount: 500, interval: "month" }),
    yearly: Object.freeze({ amount: 5000, interval: "year" }),
  }),
  full_flock: Object.freeze({
    productName: "FlockFront Market",
    monthly: Object.freeze({ amount: 2900, interval: "month" }),
    yearly: Object.freeze({ amount: 27000, interval: "year" }),
  }),
});
export const STRIPE_SAAS_CURRENCY = "usd";
export const STRIPE_SAAS_PRODUCT_TAX_CODE = "txcd_10103001";

export class StripeSaasError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StripeSaasError";
    this.code = code;
  }
}

function required(source, name) {
  const value = source[name]?.trim();
  if (!value) {
    throw new StripeSaasError(
      `STRIPE_SAAS_CONFIG_${name}_MISSING`,
      `Required server configuration ${name} is missing.`,
    );
  }
  return value;
}

function parseStrictBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new StripeSaasError(
    "STRIPE_SAAS_CONFIG_LIVEMODE_INVALID",
    "STRIPE_SAAS_LIVEMODE must be exactly true or false.",
  );
}

function validateStripeKeyMode(value, livemode, restrictedAllowed) {
  const match = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.exec(value);
  if (!match || (!restrictedAllowed && match[1] !== "sk")) {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_API_KEY_INVALID",
      "A Stripe server key has an invalid type or format.",
    );
  }
  if ((match[2] === "live") !== livemode) {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_KEY_MODE_MISMATCH",
      "Stripe key mode does not match STRIPE_SAAS_LIVEMODE.",
    );
  }
}

function parseStripeSaasContext(source) {
  const platformAccountId = required(source, "STRIPE_PLATFORM_ACCOUNT_ID");
  const livemode = parseStrictBoolean(required(source, "STRIPE_SAAS_LIVEMODE"));
  const environmentId = required(source, "FLOCKFRONT_ENVIRONMENT_ID");
  if (!/^acct_[A-Za-z0-9]+$/.test(platformAccountId)) {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_ACCOUNT_INVALID",
      "STRIPE_PLATFORM_ACCOUNT_ID must be a Stripe acct_ identifier.",
    );
  }
  if (platformAccountId !== STRIPE_SAAS_PLATFORM_ACCOUNT_ID) {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_ACCOUNT_MISMATCH",
      "STRIPE_PLATFORM_ACCOUNT_ID does not match the approved FlockFront platform account.",
    );
  }
  if (!STRIPE_SAAS_ENVIRONMENT_IDS.includes(environmentId)) {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_ENVIRONMENT_INVALID",
      "FLOCKFRONT_ENVIRONMENT_ID is not recognized.",
    );
  }
  return Object.freeze({
    platformAccountId, livemode, environmentId, apiVersion: STRIPE_SAAS_API_VERSION,
  });
}

export function parseStripeSaasConfig(source) {
  const operationalApiKey = required(source, "STRIPE_SAAS_API_KEY");
  const context = parseStripeSaasContext(source);
  const catalogReadApiKey = source.STRIPE_SAAS_CATALOG_READ_KEY?.trim() || null;
  validateStripeKeyMode(operationalApiKey, context.livemode, false);
  if (catalogReadApiKey) validateStripeKeyMode(catalogReadApiKey, context.livemode, true);
  return Object.freeze({
    ...context, operationalApiKey, catalogReadApiKey,
  });
}

export function parseStripeSaasCatalogConfig(source) {
  const catalogReadApiKey = required(source, "STRIPE_SAAS_CATALOG_READ_KEY");
  const context = parseStripeSaasContext(source);
  validateStripeKeyMode(catalogReadApiKey, context.livemode, true);
  if (!catalogReadApiKey.startsWith("rk_")) {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_API_KEY_INVALID",
      "The catalog verification key must be a Stripe restricted server key.",
    );
  }
  return Object.freeze({ ...context, catalogReadApiKey });
}

export function parseStripeSaasWebhookConfig(source) {
  const webhookSecret = required(source, "STRIPE_SAAS_WEBHOOK_SECRET");
  const context = parseStripeSaasContext(source);
  if (!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret)) {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_WEBHOOK_SECRET_INVALID",
      "The Stripe webhook secret has an invalid format.",
    );
  }
  return Object.freeze({ ...context, webhookSecret });
}

function parseApplicationOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_APP_ORIGIN_INVALID",
      "FLOCKFRONT_APP_ORIGIN must be a valid application origin.",
    );
  }
  const localHttp = parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if ((!localHttp && parsed.protocol !== "https:") ||
      parsed.username || parsed.password || parsed.pathname !== "/" ||
      parsed.search || parsed.hash) {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_APP_ORIGIN_INVALID",
      "FLOCKFRONT_APP_ORIGIN must be an HTTPS origin outside local development.",
    );
  }
  return parsed.origin;
}

function parsePortalConfigurationId(value, name) {
  if (!/^bpc_[A-Za-z0-9]+$/.test(value)) {
    throw new StripeSaasError(
      `STRIPE_SAAS_CONFIG_${name}_INVALID`,
      `${name} must be a Stripe Billing Portal configuration identifier.`,
    );
  }
  return value;
}

export function parseStripeSaasPortalConfig(source) {
  const operational = parseStripeSaasConfig(source);
  const appOrigin = parseApplicationOrigin(required(source, "FLOCKFRONT_APP_ORIGIN"));
  const generalPortalConfigurationId = parsePortalConfigurationId(
    required(source, "STRIPE_GENERAL_PORTAL_CONFIGURATION_ID"),
    "STRIPE_GENERAL_PORTAL_CONFIGURATION_ID",
  );
  const cancelPortalConfigurationId = parsePortalConfigurationId(
    required(source, "STRIPE_CANCEL_PORTAL_CONFIGURATION_ID"),
    "STRIPE_CANCEL_PORTAL_CONFIGURATION_ID",
  );
  return Object.freeze({
    ...operational,
    appOrigin,
    generalPortalConfigurationId,
    cancelPortalConfigurationId,
  });
}

export function assertStripeWebhookTimestampWithinTolerance(
  signatureHeader,
  toleranceSeconds,
  receivedAtMilliseconds = Date.now(),
) {
  if (!Number.isInteger(toleranceSeconds) || toleranceSeconds < 1) {
    throw new StripeSaasError(
      "STRIPE_SAAS_WEBHOOK_TOLERANCE_INVALID",
      "Stripe webhook timestamp tolerance is invalid.",
    );
  }
  const timestamps = String(signatureHeader).split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("t="))
    .map((part) => part.slice(2));
  if (timestamps.length !== 1 || !/^[0-9]+$/.test(timestamps[0])) {
    throw new StripeSaasError(
      "STRIPE_SAAS_WEBHOOK_TIMESTAMP_INVALID",
      "Stripe webhook signature timestamp is invalid.",
    );
  }
  const timestamp = Number(timestamps[0]);
  const receivedAtSeconds = Math.floor(receivedAtMilliseconds / 1_000);
  if (!Number.isSafeInteger(timestamp) ||
    Math.abs(receivedAtSeconds - timestamp) > toleranceSeconds) {
    throw new StripeSaasError(
      "STRIPE_SAAS_WEBHOOK_TIMESTAMP_OUTSIDE_TOLERANCE",
      "Stripe webhook signature timestamp is outside the allowed tolerance.",
    );
  }
}

export function parseCatalogApplyConfig(source) {
  const supabaseUrl = required(source, "SUPABASE_URL");
  const supabaseServiceRoleKey = required(source, "SUPABASE_SERVICE_ROLE_KEY");
  let parsedUrl;
  try { parsedUrl = new URL(supabaseUrl); } catch {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_SUPABASE_URL_INVALID", "SUPABASE_URL must be a valid URL.",
    );
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new StripeSaasError(
      "STRIPE_SAAS_CONFIG_SUPABASE_URL_INVALID", "SUPABASE_URL must use HTTP or HTTPS.",
    );
  }
  return Object.freeze({ supabaseUrl, supabaseServiceRoleKey });
}

export function redactStripeSaasConfig(config) {
  return Object.freeze({
    environmentId: config.environmentId,
    livemode: config.livemode,
    platformAccountId: config.platformAccountId,
    apiVersion: config.apiVersion,
    catalogReadKeyConfigured: Boolean(config.catalogReadApiKey),
  });
}

export function getApprovedSaasPrice(planKey, cadence) {
  const plan = STRIPE_SAAS_CATALOG[planKey];
  const price = plan?.[cadence];
  if (!plan || !price) {
    throw new StripeSaasError(
      "STRIPE_SAAS_CATALOG_SELECTION_INVALID",
      "Plan and cadence must identify an approved FlockFront SaaS Price.",
    );
  }
  return Object.freeze({
    planKey, cadence, productName: plan.productName,
    unitAmount: price.amount, currency: STRIPE_SAAS_CURRENCY,
    recurringInterval: price.interval, recurringIntervalCount: 1,
    priceType: "recurring", billingScheme: "per_unit",
    recurringUsageType: "licensed", taxBehavior: "exclusive",
    productTaxCode: STRIPE_SAAS_PRODUCT_TAX_CODE,
  });
}
