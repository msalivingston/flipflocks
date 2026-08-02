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

export function parseStripeSaasConfig(source) {
  const operationalApiKey = required(source, "STRIPE_SAAS_API_KEY");
  const platformAccountId = required(source, "STRIPE_PLATFORM_ACCOUNT_ID");
  const livemode = parseStrictBoolean(required(source, "STRIPE_SAAS_LIVEMODE"));
  const environmentId = required(source, "FLOCKFRONT_ENVIRONMENT_ID");
  const catalogReadApiKey = source.STRIPE_SAAS_CATALOG_READ_KEY?.trim() || null;
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
  validateStripeKeyMode(operationalApiKey, livemode, false);
  if (catalogReadApiKey) validateStripeKeyMode(catalogReadApiKey, livemode, true);
  return Object.freeze({
    operationalApiKey, catalogReadApiKey, platformAccountId, livemode,
    environmentId, apiVersion: STRIPE_SAAS_API_VERSION,
  });
}

export function parseCatalogApplyConfig(source) {
  const stripe = parseStripeSaasConfig(source);
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
  return Object.freeze({ ...stripe, supabaseUrl, supabaseServiceRoleKey });
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
