import assert from "node:assert/strict";
import test from "node:test";

import {
  STRIPE_SAAS_API_VERSION,
  STRIPE_SAAS_SDK_VERSION,
  StripeSaasError,
  parseStripeSaasConfig,
  redactStripeSaasConfig,
} from "../supabase/functions/_shared/stripe-saas-runtime.mjs";
import {
  runCatalogRegistration,
  verifySaasPrice,
} from "../scripts/stripe/register-saas-price.mjs";

const testSecret = ["sk", "test", "Batch4FixtureKey"].join("_");
const testRestricted = ["rk", "test", "Batch4ReadFixture"].join("_");
const liveSecret = ["sk", "live", "Batch4FixtureKey"].join("_");
const serviceSecret = ["service", "role", "Batch4Fixture"].join("_");
const accountId = ["acct", "Batch4Fixture"].join("_");

function environment(overrides = {}) {
  return {
    STRIPE_SAAS_API_KEY: testSecret,
    STRIPE_SAAS_CATALOG_READ_KEY: testRestricted,
    STRIPE_PLATFORM_ACCOUNT_ID: accountId,
    STRIPE_SAAS_LIVEMODE: "false",
    FLOCKFRONT_ENVIRONMENT_ID: "local",
    ...overrides,
  };
}

const approved = {
  small_flock: {
    monthly: [500, "month", "FlockFront Coop"],
    yearly: [5000, "year", "FlockFront Coop"],
  },
  full_flock: {
    monthly: [2900, "month", "FlockFront Market"],
    yearly: [27000, "year", "FlockFront Market"],
  },
};

function fixture(planKey = "small_flock", cadence = "monthly") {
  const [amount, interval, productName] = approved[planKey][cadence];
  const priceId = `price_Batch4${planKey.replaceAll("_", "")}${cadence}`;
  const productId = `prod_Batch4${planKey.replaceAll("_", "")}`;
  return {
    account: { id: accountId, object: "account", email: "must-not-print@example.test" },
    price: {
      id: priceId,
      object: "price",
      livemode: false,
      active: true,
      product: productId,
      type: "recurring",
      billing_scheme: "per_unit",
      tiers_mode: null,
      recurring: { usage_type: "licensed", interval, interval_count: 1 },
      unit_amount: amount,
      currency: "usd",
      tax_behavior: "exclusive",
      created: 1767225600,
      metadata: { forbidden: "raw-price-data" },
    },
    product: {
      id: productId,
      object: "product",
      livemode: false,
      active: true,
      name: productName,
      tax_code: "txcd_10103001",
      created: 1767225600,
      description: "must-not-print-product",
    },
    selection: { planKey, cadence, stripePriceId: priceId },
    config: parseStripeSaasConfig(environment()),
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof StripeSaasError && error.code === code);
}

test("SDK and API versions are explicit constants", () => {
  assert.equal(STRIPE_SAAS_SDK_VERSION, "22.3.2");
  assert.equal(STRIPE_SAAS_API_VERSION, "2026-06-24.dahlia");
});

test("configuration fails closed and strictly binds keys, mode, account, and environment", () => {
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_SAAS_API_KEY: "" })), "STRIPE_SAAS_CONFIG_STRIPE_SAAS_API_KEY_MISSING");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_PLATFORM_ACCOUNT_ID: "" })), "STRIPE_SAAS_CONFIG_STRIPE_PLATFORM_ACCOUNT_ID_MISSING");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_PLATFORM_ACCOUNT_ID: "platform" })), "STRIPE_SAAS_CONFIG_ACCOUNT_INVALID");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_SAAS_LIVEMODE: "yes" })), "STRIPE_SAAS_CONFIG_LIVEMODE_INVALID");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_SAAS_LIVEMODE: "true" })), "STRIPE_SAAS_CONFIG_KEY_MODE_MISMATCH");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_SAAS_API_KEY: liveSecret })), "STRIPE_SAAS_CONFIG_KEY_MODE_MISMATCH");
  expectCode(() => parseStripeSaasConfig(environment({ FLOCKFRONT_ENVIRONMENT_ID: "arbitrary" })), "STRIPE_SAAS_CONFIG_ENVIRONMENT_INVALID");
  assert.equal(parseStripeSaasConfig(environment()).catalogReadApiKey, testRestricted);
  assert.equal(parseStripeSaasConfig(environment({ STRIPE_SAAS_CATALOG_READ_KEY: "" })).catalogReadApiKey, null);
});

test("configuration errors and redacted diagnostics omit all secrets", () => {
  const config = parseStripeSaasConfig(environment());
  const serialized = JSON.stringify(redactStripeSaasConfig(config));
  assert.doesNotMatch(serialized, new RegExp(testSecret));
  assert.doesNotMatch(serialized, new RegExp(testRestricted));
  try {
    parseStripeSaasConfig(environment({ STRIPE_SAAS_API_KEY: `${testSecret}!` }));
    assert.fail("invalid key should throw");
  } catch (error) {
    assert.doesNotMatch(`${error.message} ${error.code}`, new RegExp(testSecret));
  }
});

for (const [planKey, cadences] of Object.entries(approved)) {
  for (const cadence of Object.keys(cadences)) {
    test(`approved ${planKey} ${cadence} fixture produces only typed registration fields`, () => {
      const registration = verifySaasPrice(fixture(planKey, cadence));
      assert.equal(registration.p_plan_key, planKey);
      assert.equal(registration.p_billing_cadence, cadence);
      assert.equal(registration.p_verification_api_version, STRIPE_SAAS_API_VERSION);
      assert.deepEqual(Object.keys(registration).sort(), [
        "p_billing_cadence", "p_billing_scheme", "p_currency",
        "p_plan_key", "p_recurring_interval", "p_recurring_interval_count",
        "p_recurring_usage_type", "p_stripe_account_id", "p_stripe_livemode",
        "p_stripe_price_active", "p_stripe_price_created_at", "p_stripe_price_id",
        "p_stripe_price_type", "p_stripe_product_active", "p_stripe_product_created_at",
        "p_stripe_product_id", "p_stripe_product_tax_code", "p_tax_behavior",
        "p_unit_amount_cents", "p_verification_api_version",
      ].sort());
      assert.ok(!("metadata" in registration));
      assert.ok(!("name" in registration));
    });
  }
}

const mismatches = [
  ["STRIPE_SAAS_VERIFY_AMOUNT_MISMATCH", (f) => { f.price.unit_amount += 1; }],
  ["STRIPE_SAAS_VERIFY_CURRENCY_MISMATCH", (f) => { f.price.currency = "eur"; }],
  ["STRIPE_SAAS_VERIFY_INTERVAL_MISMATCH", (f) => { f.price.recurring.interval = "year"; }],
  ["STRIPE_SAAS_VERIFY_INTERVAL_COUNT_MISMATCH", (f) => { f.price.recurring.interval_count = 2; }],
  ["STRIPE_SAAS_VERIFY_PRODUCT_MISMATCH", (f) => { f.price.product = "prod_Batch4Other"; }],
  ["STRIPE_SAAS_VERIFY_PRODUCT_NAME_MISMATCH", (f) => { f.product.name = "Other"; }],
  ["STRIPE_SAAS_VERIFY_TAX_CODE_MISMATCH", (f) => { f.product.tax_code = "txcd_other"; }],
  ["STRIPE_SAAS_VERIFY_TAX_BEHAVIOR_MISMATCH", (f) => { f.price.tax_behavior = "inclusive"; }],
  ["STRIPE_SAAS_VERIFY_PRODUCT_INACTIVE", (f) => { f.product.active = false; }],
  ["STRIPE_SAAS_VERIFY_PRICE_INACTIVE", (f) => { f.price.active = false; }],
  ["STRIPE_SAAS_VERIFY_PRICE_TYPE_MISMATCH", (f) => { f.price.type = "one_time"; }],
  ["STRIPE_SAAS_VERIFY_USAGE_TYPE_MISMATCH", (f) => { f.price.recurring.usage_type = "metered"; }],
  ["STRIPE_SAAS_VERIFY_BILLING_SCHEME_MISMATCH", (f) => { f.price.billing_scheme = "tiered"; }],
  ["STRIPE_SAAS_VERIFY_ACCOUNT_MISMATCH", (f) => { f.account.id = "acct_Batch4Other"; }],
  ["STRIPE_SAAS_VERIFY_MODE_MISMATCH", (f) => { f.price.livemode = true; }],
];

for (const [code, mutate] of mismatches) {
  test(`provider mismatch fails with ${code}`, () => {
    const value = fixture();
    mutate(value);
    expectCode(() => verifySaasPrice(value), code);
  });
}

function mockedStripe(value, calls) {
  return {
    accounts: { retrieve: async () => { calls.push("account.retrieve"); return value.account; } },
    prices: { retrieve: async () => { calls.push("price.retrieve"); return value.price; } },
    products: { retrieve: async () => { calls.push("product.retrieve"); return value.product; } },
  };
}

test("dry-run performs mock reads, emits redacted output, and makes no Supabase mutation", async () => {
  const value = fixture();
  const calls = [];
  const output = [];
  let supabaseCreated = false;
  const result = await runCatalogRegistration({
    argv: [`--plan=${value.selection.planKey}`, `--cadence=${value.selection.cadence}`, `--price-id=${value.selection.stripePriceId}`],
    env: environment(),
    createStripeClient: () => mockedStripe(value, calls),
    createSupabaseClient: () => { supabaseCreated = true; throw new Error("unexpected"); },
    write: (line) => output.push(line),
  });
  assert.equal(result.status, "dry_run_verified");
  assert.deepEqual(calls, ["account.retrieve", "price.retrieve", "product.retrieve"]);
  assert.equal(supabaseCreated, false);
  const printed = output.join("\n");
  assert.doesNotMatch(printed, /raw-price-data|must-not-print|example\.test/);
  assert.doesNotMatch(printed, new RegExp(`${testSecret}|${testRestricted}|${serviceSecret}`));
});

test("apply requires explicit flag plus matching environment confirmation", async () => {
  const value = fixture();
  let stripeCreated = false;
  await assert.rejects(
    runCatalogRegistration({
      argv: [`--plan=small_flock`, `--cadence=monthly`, `--price-id=${value.selection.stripePriceId}`, "--apply"],
      env: environment({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: serviceSecret }),
      createStripeClient: () => { stripeCreated = true; return mockedStripe(value, []); },
    }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_CONFIRMATION_REQUIRED",
  );
  assert.equal(stripeCreated, false);
});

test("live mode is refused before any provider client is created", async () => {
  let clientCreated = false;
  await assert.rejects(
    runCatalogRegistration({
      argv: ["--plan=small_flock", "--cadence=monthly", "--price-id=price_Batch4Live"],
      env: environment({
        STRIPE_SAAS_API_KEY: liveSecret,
        STRIPE_SAAS_CATALOG_READ_KEY: "",
        STRIPE_SAAS_LIVEMODE: "true",
      }),
      createStripeClient: () => { clientCreated = true; throw new Error("unexpected"); },
    }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_LIVE_MODE_REFUSED",
  );
  assert.equal(clientCreated, false);
});

test("apply calls only the registration RPC with the allowlisted typed request", async () => {
  const value = fixture();
  const rpcCalls = [];
  const result = await runCatalogRegistration({
    argv: [
      "--plan=small_flock", "--cadence=monthly",
      `--price-id=${value.selection.stripePriceId}`,
      "--apply", "--confirm-environment=local",
    ],
    env: environment({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: serviceSecret }),
    createStripeClient: () => mockedStripe(value, []),
    createSupabaseClient: () => ({
      rpc: async (name, request) => {
        rpcCalls.push({ name, request });
        return { data: [{ registration_status: "registered", registered_stripe_price_id: request.p_stripe_price_id }], error: null };
      },
    }),
    write: () => {},
  });
  assert.equal(result.status, "registered");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "register_verified_saas_price");
  assert.ok(!("metadata" in rpcCalls[0].request));
  assert.ok(!("object" in rpcCalls[0].request));
});
