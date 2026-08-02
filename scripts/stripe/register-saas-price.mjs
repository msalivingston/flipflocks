import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { pathToFileURL } from "node:url";

import {
  STRIPE_SAAS_API_VERSION,
  StripeSaasError,
  getApprovedSaasPrice,
  parseCatalogApplyConfig,
  parseStripeSaasConfig,
  redactStripeSaasConfig,
} from "../../supabase/functions/_shared/stripe-saas-runtime.mjs";

export function parseCatalogArguments(argv) {
  const values = new Map();
  let apply = false;
  for (const argument of argv) {
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match) {
      throw new StripeSaasError(
        "STRIPE_SAAS_UTILITY_ARGUMENT_INVALID",
        "Arguments must use --name=value; apply additionally requires --apply.",
      );
    }
    values.set(match[1], match[2].trim());
  }
  const planKey = values.get("plan");
  const cadence = values.get("cadence");
  const stripePriceId = values.get("price-id");
  if (!planKey || !cadence || !stripePriceId) {
    throw new StripeSaasError(
      "STRIPE_SAAS_UTILITY_ARGUMENT_MISSING",
      "--plan, --cadence, and --price-id are required.",
    );
  }
  if (!/^price_[A-Za-z0-9]+$/.test(stripePriceId)) {
    throw new StripeSaasError(
      "STRIPE_SAAS_UTILITY_PRICE_ID_INVALID",
      "--price-id must be a Stripe price_ identifier.",
    );
  }
  return Object.freeze({
    planKey,
    cadence,
    stripePriceId,
    apply,
    confirmationEnvironmentId: values.get("confirm-environment") ?? null,
  });
}

function taxCodeId(taxCode) {
  if (typeof taxCode === "string") return taxCode;
  if (taxCode && typeof taxCode === "object" && "id" in taxCode) return taxCode.id;
  return null;
}

// Converts only approved typed provider attributes. Raw Stripe objects never cross
// the database boundary.
export function verifySaasPrice({ account, price, product, config, selection }) {
  const expected = getApprovedSaasPrice(selection.planKey, selection.cadence);
  const requireMatch = (condition, code, message) => {
    if (!condition) throw new StripeSaasError(code, message);
  };

  requireMatch(account?.id === config.platformAccountId, "STRIPE_SAAS_VERIFY_ACCOUNT_MISMATCH", "Stripe platform account does not match configuration.");
  requireMatch(price?.id === selection.stripePriceId, "STRIPE_SAAS_VERIFY_PRICE_ID_MISMATCH", "Retrieved Price does not match the requested identifier.");
  requireMatch(Boolean(price?.livemode) === config.livemode && Boolean(product?.livemode) === config.livemode, "STRIPE_SAAS_VERIFY_MODE_MISMATCH", "Stripe object mode does not match configuration.");
  requireMatch(price?.active === true, "STRIPE_SAAS_VERIFY_PRICE_INACTIVE", "Stripe Price must be active.");
  requireMatch(product?.active === true, "STRIPE_SAAS_VERIFY_PRODUCT_INACTIVE", "Stripe Product must be active.");
  requireMatch(typeof price?.product === "string" && price.product === product?.id, "STRIPE_SAAS_VERIFY_PRODUCT_MISMATCH", "Stripe Price Product does not match the retrieved Product.");
  requireMatch(product?.name === expected.productName, "STRIPE_SAAS_VERIFY_PRODUCT_NAME_MISMATCH", "Stripe Product name does not match the approved plan.");
  requireMatch(price?.type === expected.priceType, "STRIPE_SAAS_VERIFY_PRICE_TYPE_MISMATCH", "Stripe Price must be recurring.");
  requireMatch(price?.billing_scheme === expected.billingScheme && price?.tiers_mode == null, "STRIPE_SAAS_VERIFY_BILLING_SCHEME_MISMATCH", "Stripe Price must use fixed per-unit billing.");
  requireMatch(price?.recurring?.usage_type === expected.recurringUsageType, "STRIPE_SAAS_VERIFY_USAGE_TYPE_MISMATCH", "Stripe Price must use licensed recurring usage.");
  requireMatch(price?.unit_amount === expected.unitAmount, "STRIPE_SAAS_VERIFY_AMOUNT_MISMATCH", "Stripe Price amount does not match the approved catalog.");
  requireMatch(price?.currency === expected.currency, "STRIPE_SAAS_VERIFY_CURRENCY_MISMATCH", "Stripe Price currency must be lowercase usd.");
  requireMatch(price?.recurring?.interval === expected.recurringInterval, "STRIPE_SAAS_VERIFY_INTERVAL_MISMATCH", "Stripe recurring interval does not match the approved cadence.");
  requireMatch(price?.recurring?.interval_count === expected.recurringIntervalCount, "STRIPE_SAAS_VERIFY_INTERVAL_COUNT_MISMATCH", "Stripe recurring interval count must be one.");
  requireMatch(price?.tax_behavior === expected.taxBehavior, "STRIPE_SAAS_VERIFY_TAX_BEHAVIOR_MISMATCH", "Stripe Price tax behavior must be exclusive.");
  requireMatch(taxCodeId(product?.tax_code) === expected.productTaxCode, "STRIPE_SAAS_VERIFY_TAX_CODE_MISMATCH", "Stripe Product tax code does not match the approved SaaS code.");
  requireMatch(Number.isInteger(price?.created) && price.created > 0 && Number.isInteger(product?.created) && product.created > 0, "STRIPE_SAAS_VERIFY_CREATED_AT_INVALID", "Stripe provider creation timestamps are invalid.");

  return Object.freeze({
    p_stripe_price_id: price.id,
    p_stripe_product_id: product.id,
    p_stripe_account_id: account.id,
    p_stripe_livemode: config.livemode,
    p_plan_key: expected.planKey,
    p_billing_cadence: expected.cadence,
    p_unit_amount_cents: expected.unitAmount,
    p_currency: expected.currency,
    p_recurring_interval: expected.recurringInterval,
    p_recurring_interval_count: expected.recurringIntervalCount,
    p_stripe_price_type: expected.priceType,
    p_billing_scheme: expected.billingScheme,
    p_recurring_usage_type: expected.recurringUsageType,
    p_tax_behavior: expected.taxBehavior,
    p_stripe_product_tax_code: expected.productTaxCode,
    p_stripe_price_active: true,
    p_stripe_product_active: true,
    p_stripe_price_created_at: new Date(price.created * 1000).toISOString(),
    p_stripe_product_created_at: new Date(product.created * 1000).toISOString(),
    p_verification_api_version: STRIPE_SAAS_API_VERSION,
  });
}

export function createLocalStripeReadClient(apiKey) {
  return new Stripe(apiKey, {
    apiVersion: STRIPE_SAAS_API_VERSION,
    maxNetworkRetries: 2,
  });
}

export function createLocalSupabaseAdminClient(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function runCatalogRegistration({
  argv,
  env,
  createStripeClient = createLocalStripeReadClient,
  createSupabaseClient = createLocalSupabaseAdminClient,
  write = (line) => process.stdout.write(`${line}\n`),
}) {
  const args = parseCatalogArguments(argv);
  const config = args.apply ? parseCatalogApplyConfig(env) : parseStripeSaasConfig(env);
  getApprovedSaasPrice(args.planKey, args.cadence);
  if (config.livemode) {
    throw new StripeSaasError(
      "STRIPE_SAAS_UTILITY_LIVE_MODE_REFUSED",
      "Batch 4 catalog registration is test-mode only.",
    );
  }
  if (args.apply && args.confirmationEnvironmentId !== config.environmentId) {
    throw new StripeSaasError(
      "STRIPE_SAAS_UTILITY_CONFIRMATION_REQUIRED",
      "Apply requires --confirm-environment matching FLOCKFRONT_ENVIRONMENT_ID.",
    );
  }

  const stripe = createStripeClient(config.catalogReadApiKey ?? config.operationalApiKey);
  const account = await stripe.accounts.retrieve();
  const price = await stripe.prices.retrieve(args.stripePriceId);
  const productId = typeof price.product === "string" ? price.product : price.product?.id;
  if (!productId) {
    throw new StripeSaasError(
      "STRIPE_SAAS_VERIFY_PRODUCT_ID_MISSING", "Stripe Price has no Product identifier.",
    );
  }
  const product = await stripe.products.retrieve(productId);
  const registration = verifySaasPrice({ account, price, product, config, selection: args });
  const summary = {
    mode: "test",
    action: args.apply ? "apply" : "dry-run",
    configuration: redactStripeSaasConfig(config),
    planKey: registration.p_plan_key,
    cadence: registration.p_billing_cadence,
    stripePriceId: registration.p_stripe_price_id,
    stripeProductId: registration.p_stripe_product_id,
    unitAmountCents: registration.p_unit_amount_cents,
    currency: registration.p_currency,
    verified: true,
  };
  if (!args.apply) {
    write(JSON.stringify(summary));
    return Object.freeze({ status: "dry_run_verified", registration, summary });
  }

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const { data, error } = await supabase.rpc("register_verified_saas_price", registration);
  if (error) {
    throw new StripeSaasError(
      "STRIPE_SAAS_UTILITY_REGISTRATION_FAILED", "Trusted catalog registration failed.",
    );
  }
  const result = Array.isArray(data) ? data[0] : data;
  const narrowResult = {
    status: result?.registration_status ?? "unknown",
    stripePriceId: result?.registered_stripe_price_id ?? registration.p_stripe_price_id,
  };
  write(JSON.stringify(narrowResult));
  return Object.freeze({ ...narrowResult, registration });
}

async function main() {
  try {
    await runCatalogRegistration({ argv: process.argv.slice(2), env: process.env });
  } catch (error) {
    const code = error instanceof StripeSaasError
      ? error.code
      : "STRIPE_SAAS_UTILITY_UNEXPECTED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
