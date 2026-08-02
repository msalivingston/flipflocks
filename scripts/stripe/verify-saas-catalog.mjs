import { pathToFileURL } from "node:url";

import {
  createLocalSupabaseAdminClient,
  createLocalStripeReadClient,
  LOCAL_CATALOG_DEFAULTS,
  verifySaasPrice,
} from "./register-saas-price.mjs";
import {
  runLocalCatalogVerificationForm,
  validateSupabaseProjectUrl,
} from "./local-catalog-key-form.mjs";
import {
  StripeSaasError,
  parseCatalogApplyConfig,
  parseStripeSaasCatalogConfig,
} from "../../supabase/functions/_shared/stripe-saas-runtime.mjs";

const REGISTER_VERIFIED_SAAS_PRICE_RPC = "register_verified_saas_price";
const REGISTRATION_STATUSES = new Set(["registered", "already_registered"]);

export function parseCatalogVerifierArguments(argv) {
  const values = new Map();
  let apply = false;
  for (const argument of argv) {
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    const match = /^--(confirm-environment|confirm-account)=(.+)$/.exec(argument);
    if (!match) {
      throw new StripeSaasError(
        "STRIPE_SAAS_CATALOG_ARGUMENT_INVALID",
        "Catalog verifier arguments are invalid.",
      );
    }
    values.set(match[1], match[2].trim());
  }
  const result = Object.freeze({
    apply,
    confirmationEnvironmentId: values.get("confirm-environment") ?? null,
    confirmationAccountId: values.get("confirm-account") ?? null,
  });
  if (apply && result.confirmationEnvironmentId !== LOCAL_CATALOG_DEFAULTS.FLOCKFRONT_ENVIRONMENT_ID) {
    throw new StripeSaasError(
      "STRIPE_SAAS_UTILITY_ENVIRONMENT_CONFIRMATION_REQUIRED",
      "Apply requires --confirm-environment=local.",
    );
  }
  if (apply && result.confirmationAccountId !== LOCAL_CATALOG_DEFAULTS.STRIPE_PLATFORM_ACCOUNT_ID) {
    throw new StripeSaasError(
      "STRIPE_SAAS_UTILITY_ACCOUNT_CONFIRMATION_REQUIRED",
      "Apply requires the approved --confirm-account value.",
    );
  }
  return result;
}

export const APPROVED_SAAS_CATALOG_MANIFEST = Object.freeze([
  Object.freeze({
    label: "Coop monthly",
    planKey: "small_flock",
    cadence: "monthly",
    stripePriceId: "price_1TzpKSL1R5g4hhXtWhItRai3",
    stripeProductId: "prod_UzoyVYb4UGqW3m",
  }),
  Object.freeze({
    label: "Coop yearly",
    planKey: "small_flock",
    cadence: "yearly",
    stripePriceId: "price_1TzpKSL1R5g4hhXtv4yG6PWt",
    stripeProductId: "prod_UzoyVYb4UGqW3m",
  }),
  Object.freeze({
    label: "Market monthly",
    planKey: "full_flock",
    cadence: "monthly",
    stripePriceId: "price_1TzpLxL1R5g4hhXtHn9Vg6Qd",
    stripeProductId: "prod_Uzoz8CeVMRC3zQ",
  }),
  Object.freeze({
    label: "Market yearly",
    planKey: "full_flock",
    cadence: "yearly",
    stripePriceId: "price_1TzpMhL1R5g4hhXt266qwLn5",
    stripeProductId: "prod_Uzoz8CeVMRC3zQ",
  }),
]);

function providerProductId(price) {
  return typeof price?.product === "string" ? price.product : price?.product?.id;
}

function safeFailureCode(error) {
  return error instanceof StripeSaasError
    ? error.code
    : "STRIPE_SAAS_CATALOG_VERIFY_UNEXPECTED";
}

function writeSummary(results, write) {
  const labelWidth = Math.max("Catalog entry".length, ...results.map(({ label }) => label.length));
  const priceWidth = Math.max("Stripe Price".length, ...results.map(({ stripePriceId }) => stripePriceId.length));
  write("FlockFront SaaS sandbox catalog verification");
  write(`${"Catalog entry".padEnd(labelWidth)}  ${"Stripe Price".padEnd(priceWidth)}  Result`);
  for (const result of results) {
    const status = result.status === "PASS" ? "PASS" : `FAIL (${result.failureCode})`;
    write(`${result.label.padEnd(labelWidth)}  ${result.stripePriceId.padEnd(priceWidth)}  ${status}`);
  }
}

function writeRegistrationSummary(results, write) {
  const labelWidth = Math.max("Catalog entry".length, ...results.map(({ label }) => label.length));
  const priceWidth = Math.max("Stripe Price".length, ...results.map(({ stripePriceId }) => stripePriceId.length));
  write("FlockFront SaaS sandbox catalog registration");
  write(`${"Catalog entry".padEnd(labelWidth)}  ${"Stripe Price".padEnd(priceWidth)}  Result`);
  for (const result of results) {
    write(`${result.label.padEnd(labelWidth)}  ${result.stripePriceId.padEnd(priceWidth)}  ${result.status}`);
  }
}

function validateApplyConfiguration(config, args) {
  if (!args.apply) return;
  if (config.environmentId !== LOCAL_CATALOG_DEFAULTS.FLOCKFRONT_ENVIRONMENT_ID) {
    throw new StripeSaasError(
      "STRIPE_SAAS_UTILITY_APPLY_ENVIRONMENT_REFUSED",
      "Catalog apply is restricted to the local environment.",
    );
  }
  if (config.platformAccountId !== LOCAL_CATALOG_DEFAULTS.STRIPE_PLATFORM_ACCOUNT_ID) {
    throw new StripeSaasError(
      "STRIPE_SAAS_UTILITY_APPLY_ACCOUNT_REFUSED",
      "Catalog apply is restricted to the approved platform account.",
    );
  }
}

export async function verifyApprovedSaasCatalogWithKey({
  catalogReadKey,
  env,
  args = Object.freeze({ apply: false }),
  createStripeClient = createLocalStripeReadClient,
  onResult = () => {},
  write = (line) => process.stdout.write(`${line}\n`),
}) {
  const configSource = {
    STRIPE_PLATFORM_ACCOUNT_ID: env?.STRIPE_PLATFORM_ACCOUNT_ID
      ?? LOCAL_CATALOG_DEFAULTS.STRIPE_PLATFORM_ACCOUNT_ID,
    STRIPE_SAAS_LIVEMODE: env?.STRIPE_SAAS_LIVEMODE
      ?? LOCAL_CATALOG_DEFAULTS.STRIPE_SAAS_LIVEMODE,
    FLOCKFRONT_ENVIRONMENT_ID: env?.FLOCKFRONT_ENVIRONMENT_ID
      ?? LOCAL_CATALOG_DEFAULTS.FLOCKFRONT_ENVIRONMENT_ID,
    STRIPE_SAAS_CATALOG_READ_KEY: catalogReadKey,
  };
  const config = parseStripeSaasCatalogConfig(configSource);
  if (config.livemode) {
    throw new StripeSaasError(
      "STRIPE_SAAS_UTILITY_LIVE_MODE_REFUSED",
      "SaaS catalog verification is sandbox-only.",
    );
  }
  validateApplyConfiguration(config, args);

  const stripe = createStripeClient(config.catalogReadApiKey);
  const products = new Map();
  const results = [];
  const registrations = [];

  for (const entry of APPROVED_SAAS_CATALOG_MANIFEST) {
    try {
      const price = await stripe.prices.retrieve(entry.stripePriceId);
      if (providerProductId(price) !== entry.stripeProductId) {
        throw new StripeSaasError(
          "STRIPE_SAAS_VERIFY_APPROVED_PRODUCT_MISMATCH",
          "Stripe Price does not use the approved FlockFront Product.",
        );
      }
      let product = products.get(entry.stripeProductId);
      if (!product) {
        product = await stripe.products.retrieve(entry.stripeProductId);
        products.set(entry.stripeProductId, product);
      }
      const registration = verifySaasPrice({ price, product, config, selection: entry });
      registrations.push(registration);
      const result = Object.freeze({ ...entry, status: "PASS", failureCode: null });
      results.push(result);
      write(`Checking ${entry.label}... PASS`);
      onResult(result);
    } catch (error) {
      const result = Object.freeze({
        ...entry,
        status: "FAIL",
        failureCode: safeFailureCode(error),
      });
      results.push(result);
      write(`Checking ${entry.label}... FAIL (${result.failureCode})`);
      onResult(result);
    }
  }

  writeSummary(results, write);
  return Object.freeze({
    passed: results.every(({ status }) => status === "PASS"),
    results: Object.freeze(results),
    registrations: Object.freeze(registrations),
  });
}

async function registerApprovedSaasCatalog({
  verification,
  credentialSource,
  createSupabaseClient,
  write,
}) {
  const applyConfig = parseCatalogApplyConfig(credentialSource);
  const supabaseUrl = validateSupabaseProjectUrl(applyConfig.supabaseUrl);
  const supabase = createSupabaseClient(
    supabaseUrl,
    applyConfig.supabaseServiceRoleKey,
  );
  const registrationResults = [];
  for (const [index, registration] of verification.registrations.entries()) {
    const { data, error } = await supabase.rpc(
      REGISTER_VERIFIED_SAAS_PRICE_RPC,
      registration,
    );
    if (error) {
      throw new StripeSaasError(
        "STRIPE_SAAS_UTILITY_REGISTRATION_FAILED",
        "Trusted catalog registration failed.",
      );
    }
    const row = Array.isArray(data) ? data[0] : data;
    const status = row?.registration_status;
    const expectedPriceId = registration.p_stripe_price_id;
    if (!REGISTRATION_STATUSES.has(status)
      || row?.registered_stripe_price_id !== expectedPriceId) {
      throw new StripeSaasError(
        "STRIPE_SAAS_UTILITY_REGISTRATION_RESPONSE_INVALID",
        "Trusted catalog registration returned an invalid result.",
      );
    }
    registrationResults.push(Object.freeze({
      label: APPROVED_SAAS_CATALOG_MANIFEST[index].label,
      stripePriceId: expectedPriceId,
      status,
    }));
  }
  writeRegistrationSummary(registrationResults, write);
  return Object.freeze(registrationResults);
}

export async function verifyApprovedSaasCatalog({
  argv = [],
  env,
  createStripeClient = createLocalStripeReadClient,
  createSupabaseClient = createLocalSupabaseAdminClient,
  runLocalForm = runLocalCatalogVerificationForm,
  write = (line) => process.stdout.write(`${line}\n`),
}) {
  const args = parseCatalogVerifierArguments(argv);
  const configuredKey = env?.STRIPE_SAAS_CATALOG_READ_KEY?.trim();
  const configuredSupabaseUrl = env?.SUPABASE_URL?.trim();
  const configuredSupabaseServiceRoleKey = env?.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const runOperation = async (credentials, reportBrowserProgress = () => {}) => {
    const verification = await verifyApprovedSaasCatalogWithKey({
      catalogReadKey: credentials.catalogReadKey,
      env,
      args,
      createStripeClient,
      onResult: reportBrowserProgress,
      write,
    });
    if (!args.apply || !verification.passed) return verification;

    const registrationResults = await registerApprovedSaasCatalog({
      verification,
      credentialSource: {
        SUPABASE_URL: credentials.supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: credentials.supabaseServiceRoleKey,
      },
      createSupabaseClient,
      write,
    });
    return Object.freeze({ ...verification, applied: true, registrationResults });
  };

  const automationConfigured = configuredKey
    && (!args.apply || (configuredSupabaseUrl && configuredSupabaseServiceRoleKey));
  if (automationConfigured) {
    return runOperation({
      catalogReadKey: configuredKey,
      supabaseUrl: configuredSupabaseUrl,
      supabaseServiceRoleKey: configuredSupabaseServiceRoleKey,
    });
  }
  return runLocalForm({
    apply: args.apply,
    runOperation,
  });
}

async function main() {
  try {
    const result = await verifyApprovedSaasCatalog({
      argv: process.argv.slice(2),
      env: process.env,
    });
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    const code = error instanceof StripeSaasError
      ? error.code
      : "STRIPE_SAAS_CATALOG_VERIFY_UNEXPECTED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
