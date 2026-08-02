import { pathToFileURL } from "node:url";

import {
  createLocalStripeReadClient,
  LOCAL_CATALOG_DEFAULTS,
  verifySaasPrice,
} from "./register-saas-price.mjs";
import { runLocalCatalogVerificationForm } from "./local-catalog-key-form.mjs";
import {
  StripeSaasError,
  parseStripeSaasCatalogConfig,
} from "../../supabase/functions/_shared/stripe-saas-runtime.mjs";

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

export async function verifyApprovedSaasCatalogWithKey({
  catalogReadKey,
  env,
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

  const stripe = createStripeClient(config.catalogReadApiKey);
  const products = new Map();
  const results = [];

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
      verifySaasPrice({ price, product, config, selection: entry });
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
  });
}

export async function verifyApprovedSaasCatalog({
  env,
  createStripeClient = createLocalStripeReadClient,
  runLocalForm = runLocalCatalogVerificationForm,
  write = (line) => process.stdout.write(`${line}\n`),
}) {
  const configuredKey = env?.STRIPE_SAAS_CATALOG_READ_KEY?.trim();
  if (configuredKey) {
    return verifyApprovedSaasCatalogWithKey({
      catalogReadKey: configuredKey,
      env,
      createStripeClient,
      write,
    });
  }
  return runLocalForm({
    verifyKey: (catalogReadKey, reportBrowserProgress) => verifyApprovedSaasCatalogWithKey({
      catalogReadKey,
      env,
      createStripeClient,
      onResult: reportBrowserProgress,
      write,
    }),
  });
}

async function main() {
  try {
    const result = await verifyApprovedSaasCatalog({ env: process.env });
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
