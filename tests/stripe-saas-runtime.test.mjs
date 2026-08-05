import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  STRIPE_SAAS_API_VERSION,
  STRIPE_SAAS_PLATFORM_ACCOUNT_ID,
  STRIPE_SAAS_SDK_VERSION,
  StripeSaasError,
  assertStripeSaasRuntimeEnvironment,
  assertStripeWebhookTimestampWithinTolerance,
  parseStripeSaasCatalogConfig,
  parseStripeSaasConfig,
  parseStripeSaasPortalConfig,
  parseStripeSaasWebhookConfig,
  redactStripeSaasConfig,
} from "../supabase/functions/_shared/stripe-saas-runtime.mjs";
import {
  LOCAL_CATALOG_DEFAULTS,
  resolveCatalogUtilityEnvironment,
  runCatalogRegistration,
  verifySaasPrice,
} from "../scripts/stripe/register-saas-price.mjs";
import { readHiddenTerminalLine } from "../scripts/stripe/secure-secret-prompt.mjs";
import { readWindowsClipboardRestrictedTestKey } from "../scripts/stripe/windows-clipboard-secret.mjs";

const testSecret = ["sk", "test", "Batch4FixtureKey"].join("_");
const testRestricted = ["rk", "test", "Batch4ReadFixture"].join("_");
const liveSecret = ["sk", "live", "Batch4FixtureKey"].join("_");
const liveRestricted = ["rk", "live", "Batch4ReadFixture"].join("_");
const serviceSecret = ["service", "role", "Batch4Fixture"].join("_");
const webhookSecret = ["whsec", "Batch6Fixture"].join("_");
const accountId = STRIPE_SAAS_PLATFORM_ACCOUNT_ID;

test("Portal configuration remains operational-key-only and validates fixed server values", () => {
  const config = parseStripeSaasPortalConfig({
    STRIPE_SAAS_API_KEY: testSecret,
    STRIPE_PLATFORM_ACCOUNT_ID: accountId,
    STRIPE_SAAS_LIVEMODE: "false",
    FLOCKFRONT_ENVIRONMENT_ID: "local",
    FLOCKFRONT_APP_ORIGIN: "http://127.0.0.1:3000",
    STRIPE_SAAS_PORTAL_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_Batch10CardOnly",
  });
  assert.equal(config.appOrigin, "http://127.0.0.1:3000");
  assert.equal(
    config.portalPaymentMethodConfigurationId,
    "pmc_Batch10CardOnly",
  );
  assert.equal("generalPortalConfigurationId" in config, false);
  assert.equal("cancelPortalConfigurationId" in config, false);
  assert.equal(config.operationalApiKey, testSecret);
  assert.equal("catalogReadApiKey" in config, true);

  expectCode(() => parseStripeSaasPortalConfig({
    STRIPE_PLATFORM_ACCOUNT_ID: accountId,
    STRIPE_SAAS_LIVEMODE: "false",
    FLOCKFRONT_ENVIRONMENT_ID: "local",
    FLOCKFRONT_APP_ORIGIN: "https://flockfront.test",
  }), "STRIPE_SAAS_CONFIG_STRIPE_SAAS_API_KEY_MISSING");
  expectCode(() => parseStripeSaasPortalConfig({
    ...environment(),
    FLOCKFRONT_APP_ORIGIN: "https://flockfront.test/path",
    STRIPE_SAAS_PORTAL_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_Batch10CardOnly",
  }), "STRIPE_SAAS_CONFIG_APP_ORIGIN_INVALID");
  expectCode(() => parseStripeSaasPortalConfig({
    ...environment(),
    FLOCKFRONT_APP_ORIGIN: "https://flockfront.test",
  }), "STRIPE_SAAS_CONFIG_STRIPE_SAAS_PORTAL_PAYMENT_METHOD_CONFIGURATION_ID_MISSING");
  expectCode(() => parseStripeSaasPortalConfig({
    ...environment(),
    FLOCKFRONT_APP_ORIGIN: "https://flockfront.test",
    STRIPE_SAAS_PORTAL_PAYMENT_METHOD_CONFIGURATION_ID: "not-a-pmc-id",
  }), "STRIPE_SAAS_CONFIG_PORTAL_PAYMENT_METHOD_CONFIGURATION_INVALID");
  expectCode(() => parseStripeSaasPortalConfig({
    ...environment({ STRIPE_PLATFORM_ACCOUNT_ID: "acct_WrongPlatform" }),
    FLOCKFRONT_APP_ORIGIN: "https://flockfront.test",
    STRIPE_SAAS_PORTAL_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_Batch10CardOnly",
  }), "STRIPE_SAAS_CONFIG_ACCOUNT_MISMATCH");
});

function environment(overrides = {}) {
  return {
    STRIPE_SAAS_API_KEY: testSecret,
    ...catalogEnvironment(),
    ...overrides,
  };
}

function catalogEnvironment(overrides = {}) {
  return {
    STRIPE_SAAS_CATALOG_READ_KEY: testRestricted,
    STRIPE_PLATFORM_ACCOUNT_ID: accountId,
    STRIPE_SAAS_LIVEMODE: "false",
    FLOCKFRONT_ENVIRONMENT_ID: "local",
    ...overrides,
  };
}

test("webhook configuration requires only signature context, not a Stripe API key", () => {
  const config = parseStripeSaasWebhookConfig({
    STRIPE_SAAS_WEBHOOK_SECRET: webhookSecret,
    STRIPE_PLATFORM_ACCOUNT_ID: accountId,
    STRIPE_SAAS_LIVEMODE: "false",
    FLOCKFRONT_ENVIRONMENT_ID: "local",
  });
  assert.equal(config.webhookSecret, webhookSecret);
  assert.equal(config.livemode, false);
  assert.equal("operationalApiKey" in config, false);
  assert.equal("catalogReadApiKey" in config, false);

  expectCode(() => parseStripeSaasWebhookConfig({
    STRIPE_PLATFORM_ACCOUNT_ID: accountId,
    STRIPE_SAAS_LIVEMODE: "false",
    FLOCKFRONT_ENVIRONMENT_ID: "local",
  }), "STRIPE_SAAS_CONFIG_STRIPE_SAAS_WEBHOOK_SECRET_MISSING");
  expectCode(() => parseStripeSaasWebhookConfig({
    STRIPE_SAAS_WEBHOOK_SECRET: "not-a-webhook-secret",
    STRIPE_PLATFORM_ACCOUNT_ID: accountId,
    STRIPE_SAAS_LIVEMODE: "false",
    FLOCKFRONT_ENVIRONMENT_ID: "local",
  }), "STRIPE_SAAS_CONFIG_WEBHOOK_SECRET_INVALID");
});

test("webhook signature timestamps have a symmetric bounded tolerance", () => {
  const receivedAt = 1_800_000_000_000;
  assert.doesNotThrow(() => assertStripeWebhookTimestampWithinTolerance(
    "t=1800000000,v1=fixture", 300, receivedAt));
  assert.doesNotThrow(() => assertStripeWebhookTimestampWithinTolerance(
    "t=1799999700,v1=fixture", 300, receivedAt));
  assert.doesNotThrow(() => assertStripeWebhookTimestampWithinTolerance(
    "t=1800000300,v1=fixture", 300, receivedAt));
  expectCode(() => assertStripeWebhookTimestampWithinTolerance(
    "t=1799999699,v1=fixture", 300, receivedAt),
  "STRIPE_SAAS_WEBHOOK_TIMESTAMP_OUTSIDE_TOLERANCE");
  expectCode(() => assertStripeWebhookTimestampWithinTolerance(
    "t=1800000301,v1=fixture", 300, receivedAt),
  "STRIPE_SAAS_WEBHOOK_TIMESTAMP_OUTSIDE_TOLERANCE");
  expectCode(() => assertStripeWebhookTimestampWithinTolerance(
    "v1=fixture", 300, receivedAt),
  "STRIPE_SAAS_WEBHOOK_TIMESTAMP_INVALID");
});

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
    config: parseStripeSaasCatalogConfig(catalogEnvironment()),
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof StripeSaasError && error.code === code);
}

class MockTTYInput extends EventEmitter {
  constructor({ tty = true } = {}) {
    super();
    this.isTTY = tty;
    this.isRaw = false;
    this.paused = true;
    this.rawModes = [];
  }

  setRawMode(value) {
    this.rawModes.push(value);
    this.isRaw = value;
  }

  isPaused() { return this.paused; }
  resume() { this.paused = false; }
  pause() { this.paused = true; }
}

class MockTTYOutput {
  constructor({ tty = true } = {}) {
    this.isTTY = tty;
    this.value = "";
  }

  write(chunk) {
    this.value += String(chunk);
    return true;
  }
}

test("SDK and API versions are explicit constants", () => {
  assert.equal(STRIPE_SAAS_SDK_VERSION, "22.3.2");
  assert.equal(STRIPE_SAAS_API_VERSION, "2026-06-24.dahlia");
});

test("configuration fails closed and strictly binds keys, mode, account, and environment", () => {
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_SAAS_API_KEY: "" })), "STRIPE_SAAS_CONFIG_STRIPE_SAAS_API_KEY_MISSING");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_PLATFORM_ACCOUNT_ID: "" })), "STRIPE_SAAS_CONFIG_STRIPE_PLATFORM_ACCOUNT_ID_MISSING");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_PLATFORM_ACCOUNT_ID: "platform" })), "STRIPE_SAAS_CONFIG_ACCOUNT_INVALID");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_PLATFORM_ACCOUNT_ID: "acct_DifferentPlatform" })), "STRIPE_SAAS_CONFIG_ACCOUNT_MISMATCH");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_SAAS_LIVEMODE: "yes" })), "STRIPE_SAAS_CONFIG_LIVEMODE_INVALID");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_SAAS_LIVEMODE: "true" })), "STRIPE_SAAS_CONFIG_KEY_MODE_MISMATCH");
  expectCode(() => parseStripeSaasConfig(environment({ STRIPE_SAAS_API_KEY: liveSecret })), "STRIPE_SAAS_CONFIG_KEY_MODE_MISMATCH");
  expectCode(() => parseStripeSaasConfig(environment({ FLOCKFRONT_ENVIRONMENT_ID: "arbitrary" })), "STRIPE_SAAS_CONFIG_ENVIRONMENT_INVALID");
  assert.equal(parseStripeSaasConfig(environment()).catalogReadApiKey, testRestricted);
  assert.equal(parseStripeSaasConfig(environment({ STRIPE_SAAS_CATALOG_READ_KEY: "" })).catalogReadApiKey, null);
});

test("runtime environment safeguard permits sandbox and approved live production only", () => {
  const sandbox = parseStripeSaasConfig(environment());
  assert.equal(assertStripeSaasRuntimeEnvironment(sandbox), sandbox);

  const liveProduction = parseStripeSaasConfig(environment({
    STRIPE_SAAS_API_KEY: liveSecret,
    STRIPE_SAAS_CATALOG_READ_KEY: "",
    STRIPE_SAAS_LIVEMODE: "true",
    FLOCKFRONT_ENVIRONMENT_ID: "production",
  }));
  assert.equal(assertStripeSaasRuntimeEnvironment(liveProduction), liveProduction);

  expectCode(
    () => assertStripeSaasRuntimeEnvironment(parseStripeSaasConfig(environment({
      STRIPE_SAAS_API_KEY: liveSecret,
      STRIPE_SAAS_CATALOG_READ_KEY: "",
      STRIPE_SAAS_LIVEMODE: "true",
      FLOCKFRONT_ENVIRONMENT_ID: "staging",
    }))),
    "STRIPE_SAAS_CONFIG_LIVE_ENVIRONMENT_MISMATCH",
  );
});

test("catalog configuration is independent of the required operational configuration", () => {
  const catalog = parseStripeSaasCatalogConfig(catalogEnvironment());
  assert.equal(catalog.catalogReadApiKey, testRestricted);
  assert.ok(!("operationalApiKey" in catalog));
  expectCode(
    () => parseStripeSaasCatalogConfig(catalogEnvironment({ STRIPE_SAAS_CATALOG_READ_KEY: "" })),
    "STRIPE_SAAS_CONFIG_STRIPE_SAAS_CATALOG_READ_KEY_MISSING",
  );
  expectCode(
    () => parseStripeSaasCatalogConfig(catalogEnvironment({ STRIPE_SAAS_CATALOG_READ_KEY: testSecret })),
    "STRIPE_SAAS_CONFIG_API_KEY_INVALID",
  );
  expectCode(
    () => parseStripeSaasConfig(catalogEnvironment()),
    "STRIPE_SAAS_CONFIG_STRIPE_SAAS_API_KEY_MISSING",
  );
  expectCode(
    () => parseStripeSaasCatalogConfig({ STRIPE_SAAS_CATALOG_READ_KEY: testRestricted }),
    "STRIPE_SAAS_CONFIG_STRIPE_PLATFORM_ACCOUNT_ID_MISSING",
  );
});

test("local catalog defaults are isolated to the utility", async () => {
  assert.deepEqual(LOCAL_CATALOG_DEFAULTS, {
    STRIPE_PLATFORM_ACCOUNT_ID: accountId,
    STRIPE_SAAS_LIVEMODE: "false",
    FLOCKFRONT_ENVIRONMENT_ID: "local",
  });
  const source = await resolveCatalogUtilityEnvironment({
    env: { STRIPE_SAAS_CATALOG_READ_KEY: testRestricted },
    promptForCatalogKey: () => { throw new Error("environment key must avoid prompt"); },
  });
  assert.equal(source.STRIPE_PLATFORM_ACCOUNT_ID, accountId);
  assert.equal(source.STRIPE_SAAS_LIVEMODE, "false");
  assert.equal(source.FLOCKFRONT_ENVIRONMENT_ID, "local");
  assert.ok(!("STRIPE_SAAS_API_KEY" in source));
});

test("environment catalog key takes precedence without prompting", async () => {
  let prompted = false;
  let clipboardRead = false;
  const source = await resolveCatalogUtilityEnvironment({
    env: { STRIPE_SAAS_CATALOG_READ_KEY: testRestricted },
    keyFromClipboard: true,
    readClipboardKey: async () => { clipboardRead = true; return "must-not-be-used"; },
    promptForCatalogKey: async () => { prompted = true; return "must-not-be-used"; },
  });
  assert.equal(prompted, false);
  assert.equal(clipboardRead, false);
  assert.equal(source.STRIPE_SAAS_CATALOG_READ_KEY, testRestricted);
});

test("missing catalog key is accepted only from a valid hidden prompt result", async () => {
  let prompted = 0;
  let clipboardRead = false;
  const source = await resolveCatalogUtilityEnvironment({
    env: {},
    readClipboardKey: async () => { clipboardRead = true; return "must-not-be-used"; },
    promptForCatalogKey: async () => { prompted += 1; return `${testRestricted}\r\n`; },
  });
  assert.equal(prompted, 1);
  assert.equal(clipboardRead, false);
  assert.equal(source.STRIPE_SAAS_CATALOG_READ_KEY, testRestricted);
});

test("explicit clipboard selection takes precedence over the prompt", async () => {
  let clipboardRead = 0;
  let prompted = false;
  const source = await resolveCatalogUtilityEnvironment({
    env: {},
    keyFromClipboard: true,
    readClipboardKey: async () => { clipboardRead += 1; return testRestricted; },
    promptForCatalogKey: async () => { prompted = true; return "must-not-be-used"; },
  });
  assert.equal(clipboardRead, 1);
  assert.equal(prompted, false);
  assert.equal(source.STRIPE_SAAS_CATALOG_READ_KEY, testRestricted);
});

test("Windows clipboard capture joins lines, clears immediately, and exposes no key in arguments", async () => {
  const calls = [];
  const key = await readWindowsClipboardRestrictedTestKey({
    platform: "win32",
    runPowerShell: async (argumentsList) => {
      calls.push([...argumentsList]);
      if (argumentsList.at(-1) === "Get-Clipboard -Raw") {
        return { stdout: "  rk_test_Multi\r\nLineFixture  \r\n" };
      }
      return { stdout: "" };
    },
  });
  assert.equal(key, "rk_test_MultiLineFixture");
  assert.deepEqual(calls.map((call) => call.at(-1)), [
    "Get-Clipboard -Raw",
    "Set-Clipboard -Value ([string]::Empty)",
  ]);
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(key));
});

test("empty and malformed clipboard values fail after the clipboard is cleared", async () => {
  for (const [stdout, code] of [
    [" \r\n ", "STRIPE_SAAS_UTILITY_CLIPBOARD_EMPTY"],
    [["sk", "test", "ClipboardFixture"].join("_"), "STRIPE_SAAS_UTILITY_CLIPBOARD_KEY_INVALID"],
  ]) {
    const calls = [];
    await assert.rejects(
      readWindowsClipboardRestrictedTestKey({
        platform: "win32",
        runPowerShell: async (argumentsList) => {
          calls.push(argumentsList.at(-1));
          return argumentsList.at(-1) === "Get-Clipboard -Raw" ? { stdout } : { stdout: "" };
        },
      }),
      (error) => {
        assert.equal(error.code, code);
        assert.doesNotMatch(`${error.code} ${error.message}`, new RegExp(String(stdout).trim() || "never-match"));
        return true;
      },
    );
    assert.deepEqual(calls, ["Get-Clipboard -Raw", "Set-Clipboard -Value ([string]::Empty)"]);
  }
});

test("clipboard read and clear failures return stable secret-free errors", async () => {
  await assert.rejects(
    readWindowsClipboardRestrictedTestKey({
      platform: "win32",
      runPowerShell: async () => { throw new Error("provider output must stay hidden"); },
    }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_CLIPBOARD_READ_FAILED"
      && !error.message.includes("provider output"),
  );

  let callCount = 0;
  await assert.rejects(
    readWindowsClipboardRestrictedTestKey({
      platform: "win32",
      runPowerShell: async () => {
        callCount += 1;
        if (callCount === 1) return { stdout: testRestricted };
        throw new Error(testRestricted);
      },
    }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_CLIPBOARD_CLEAR_FAILED"
      && !error.message.includes(testRestricted),
  );
});

test("blank and malformed prompted keys fail without disclosing input", async () => {
  await assert.rejects(
    resolveCatalogUtilityEnvironment({ env: {}, promptForCatalogKey: async () => "\r\n" }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_CATALOG_READ_KEY_BLANK",
  );
  const malformed = ["sk", "test", "PromptMustStaySecret"].join("_");
  await assert.rejects(
    resolveCatalogUtilityEnvironment({ env: {}, promptForCatalogKey: async () => malformed }),
    (error) => {
      assert.equal(error.code, "STRIPE_SAAS_UTILITY_CATALOG_READ_KEY_INVALID");
      assert.doesNotMatch(`${error.code} ${error.message}`, new RegExp(malformed));
      return true;
    },
  );
});

test("hidden prompt suppresses pasted input and restores terminal state", async () => {
  const input = new MockTTYInput();
  const output = new MockTTYOutput();
  const resultPromise = readHiddenTerminalLine({ input, output });
  input.emit("data", Buffer.from(`${testRestricted}\r\n`));
  assert.equal(await resultPromise, testRestricted);
  assert.equal(output.value, "Paste Stripe restricted test key: \n");
  assert.doesNotMatch(output.value, new RegExp(testRestricted));
  assert.deepEqual(input.rawModes, [true, false]);
  assert.equal(input.isRaw, false);
  assert.equal(input.paused, true);
});

test("hidden prompt restores terminal state after failure and interruption", async () => {
  for (const [event, value, code] of [
    ["error", new Error("fixture stream failure"), "STRIPE_SAAS_UTILITY_SECRET_INPUT_FAILED"],
    ["data", "\u0003", "STRIPE_SAAS_UTILITY_SECRET_INPUT_INTERRUPTED"],
  ]) {
    const input = new MockTTYInput();
    const output = new MockTTYOutput();
    const resultPromise = readHiddenTerminalLine({ input, output });
    input.emit(event, value);
    await assert.rejects(resultPromise, (error) => error.code === code);
    assert.deepEqual(input.rawModes, [true, false]);
    assert.equal(input.isRaw, false);
    assert.equal(input.paused, true);
    assert.equal(output.value, "Paste Stripe restricted test key: \n");
  }
});

test("missing key fails clearly when no interactive terminal is available", async () => {
  const input = new MockTTYInput({ tty: false });
  const output = new MockTTYOutput();
  await assert.rejects(
    readHiddenTerminalLine({ input, output }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_INTERACTIVE_KEY_REQUIRED",
  );
  assert.equal(output.value, "");
  assert.deepEqual(input.rawModes, []);
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
  try {
    parseStripeSaasCatalogConfig(catalogEnvironment({
      STRIPE_SAAS_CATALOG_READ_KEY: `${testRestricted}!`,
    }));
    assert.fail("invalid catalog key should throw");
  } catch (error) {
    assert.doesNotMatch(`${error.message} ${error.code}`, new RegExp(testRestricted));
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
  ["STRIPE_SAAS_VERIFY_PRICE_LIVE_MODE", (f) => { f.price.livemode = true; }],
  ["STRIPE_SAAS_VERIFY_PRODUCT_LIVE_MODE", (f) => { f.product.livemode = true; }],
];

for (const [code, mutate] of mismatches) {
  test(`provider mismatch fails with ${code}`, () => {
    const value = fixture();
    mutate(value);
    expectCode(() => verifySaasPrice(value), code);
  });
}

test("Price and Product mode disagreement is rejected", () => {
  const value = fixture();
  value.product.livemode = true;
  expectCode(() => verifySaasPrice(value), "STRIPE_SAAS_VERIFY_PRODUCT_LIVE_MODE");
});

function mockedStripe(value, calls) {
  return {
    prices: { retrieve: async () => { calls.push("price.retrieve"); return value.price; } },
    products: { retrieve: async () => { calls.push("product.retrieve"); return value.product; } },
  };
}

for (const [planKey, cadences] of Object.entries(approved)) {
  for (const cadence of Object.keys(cadences)) {
    test(`approved ${planKey} ${cadence} sandbox dry-run succeeds with Product and Price reads only`, async () => {
      const value = fixture(planKey, cadence);
      const calls = [];
      const result = await runCatalogRegistration({
        argv: [`--plan=${planKey}`, `--cadence=${cadence}`, `--price-id=${value.selection.stripePriceId}`],
        env: catalogEnvironment(),
        createStripeClient: () => mockedStripe(value, calls),
        createSupabaseClient: () => { throw new Error("dry-run must not create Supabase client"); },
        write: () => {},
      });
      assert.equal(result.status, "dry_run_verified");
      assert.deepEqual(calls, ["price.retrieve", "product.retrieve"]);
      assert.equal(result.registration.p_stripe_account_id, accountId);
      assert.equal(result.registration.p_stripe_livemode, false);
    });
  }
}

test("catalog utility runs from plan, cadence, and Price ID arguments with a prompted key", async () => {
  const value = fixture();
  let prompted = 0;
  const calls = [];
  const result = await runCatalogRegistration({
    argv: ["--plan=small_flock", "--cadence=monthly", `--price-id=${value.selection.stripePriceId}`],
    env: {},
    promptForCatalogKey: async () => { prompted += 1; return testRestricted; },
    createStripeClient: () => mockedStripe(value, calls),
    createSupabaseClient: () => { throw new Error("dry-run must not create Supabase client"); },
    write: () => {},
  });
  assert.equal(result.status, "dry_run_verified");
  assert.equal(prompted, 1);
  assert.deepEqual(calls, ["price.retrieve", "product.retrieve"]);
  assert.equal(result.registration.p_stripe_account_id, accountId);
  assert.equal(result.registration.p_stripe_livemode, false);
});

test("catalog utility uses the clipboard only when explicitly requested and never prints the key", async () => {
  const value = fixture();
  const output = [];
  let clipboardRead = 0;
  let prompted = false;
  const result = await runCatalogRegistration({
    argv: [
      "--plan=small_flock", "--cadence=monthly",
      `--price-id=${value.selection.stripePriceId}`,
      "--key-from-clipboard",
    ],
    env: {},
    readClipboardKey: async () => { clipboardRead += 1; return testRestricted; },
    promptForCatalogKey: async () => { prompted = true; return "must-not-be-used"; },
    createStripeClient: () => mockedStripe(value, []),
    createSupabaseClient: () => { throw new Error("dry-run must not create Supabase client"); },
    write: (line) => output.push(line),
  });
  assert.equal(result.status, "dry_run_verified");
  assert.equal(clipboardRead, 1);
  assert.equal(prompted, false);
  assert.doesNotMatch(output.join("\n"), new RegExp(testRestricted));
});

test("an Accounts client that throws is never touched", async () => {
  const value = fixture();
  let accountTouched = false;
  const stripe = {
    ...mockedStripe(value, []),
    accounts: {
      retrieve: async () => {
        accountTouched = true;
        throw new Error("Accounts API must not be called");
      },
    },
  };
  const result = await runCatalogRegistration({
    argv: ["--plan=small_flock", "--cadence=monthly", `--price-id=${value.selection.stripePriceId}`],
    env: catalogEnvironment(),
    createStripeClient: () => stripe,
    write: () => {},
  });
  assert.equal(result.status, "dry_run_verified");
  assert.equal(accountTouched, false);
});

test("dry-run performs mock reads, emits redacted output, and makes no Supabase mutation", async () => {
  const value = fixture();
  const calls = [];
  const output = [];
  let supabaseCreated = false;
  const result = await runCatalogRegistration({
    argv: [`--plan=${value.selection.planKey}`, `--cadence=${value.selection.cadence}`, `--price-id=${value.selection.stripePriceId}`],
    env: catalogEnvironment(),
    createStripeClient: () => mockedStripe(value, calls),
    createSupabaseClient: () => { supabaseCreated = true; throw new Error("unexpected"); },
    write: (line) => output.push(line),
  });
  assert.equal(result.status, "dry_run_verified");
  assert.deepEqual(calls, ["price.retrieve", "product.retrieve"]);
  assert.equal(supabaseCreated, false);
  const printed = output.join("\n");
  assert.doesNotMatch(printed, /raw-price-data|must-not-print|example\.test/);
  assert.doesNotMatch(printed, new RegExp(`${testSecret}|${testRestricted}|${serviceSecret}`));
  assert.match(printed, /"stripeMode":"sandbox"/);
  assert.match(printed, /"accountBindingSource":"validated configuration"/);
  assert.doesNotMatch(printed, /retrieved account|provider-verified account/i);
});

test("apply requires matching environment confirmation before any client creation", async () => {
  const value = fixture();
  let stripeCreated = false;
  let supabaseCreated = false;
  await assert.rejects(
    runCatalogRegistration({
      argv: [`--plan=small_flock`, `--cadence=monthly`, `--price-id=${value.selection.stripePriceId}`, "--apply"],
      env: catalogEnvironment({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: serviceSecret }),
      createStripeClient: () => { stripeCreated = true; return mockedStripe(value, []); },
      createSupabaseClient: () => { supabaseCreated = true; throw new Error("unexpected"); },
    }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_ENVIRONMENT_CONFIRMATION_REQUIRED",
  );
  assert.equal(stripeCreated, false);
  assert.equal(supabaseCreated, false);
});

test("apply without account confirmation fails before Stripe or Supabase client creation", async () => {
  const value = fixture();
  let stripeCreated = false;
  let supabaseCreated = false;
  await assert.rejects(
    runCatalogRegistration({
      argv: ["--plan=small_flock", "--cadence=monthly", `--price-id=${value.selection.stripePriceId}`, "--apply", "--confirm-environment=local"],
      env: catalogEnvironment({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: serviceSecret }),
      createStripeClient: () => { stripeCreated = true; return mockedStripe(value, []); },
      createSupabaseClient: () => { supabaseCreated = true; throw new Error("unexpected"); },
    }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_ACCOUNT_CONFIRMATION_REQUIRED",
  );
  assert.equal(stripeCreated, false);
  assert.equal(supabaseCreated, false);
});

test("apply with wrong account confirmation fails before Stripe or Supabase client creation", async () => {
  const value = fixture();
  let stripeCreated = false;
  let supabaseCreated = false;
  await assert.rejects(
    runCatalogRegistration({
      argv: ["--plan=small_flock", "--cadence=monthly", `--price-id=${value.selection.stripePriceId}`, "--apply", "--confirm-environment=local", "--confirm-account=acct_WrongPlatform"],
      env: catalogEnvironment({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: serviceSecret }),
      createStripeClient: () => { stripeCreated = true; return mockedStripe(value, []); },
      createSupabaseClient: () => { supabaseCreated = true; throw new Error("unexpected"); },
    }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_ACCOUNT_CONFIRMATION_REQUIRED",
  );
  assert.equal(stripeCreated, false);
  assert.equal(supabaseCreated, false);
});

test("blank prompted catalog key is rejected before client creation", async () => {
  const value = fixture();
  let stripeCreated = false;
  let supabaseCreated = false;
  await assert.rejects(
    runCatalogRegistration({
      argv: ["--plan=small_flock", "--cadence=monthly", `--price-id=${value.selection.stripePriceId}`],
      env: catalogEnvironment({ STRIPE_SAAS_CATALOG_READ_KEY: "" }),
      promptForCatalogKey: async () => "\r\n",
      createStripeClient: () => { stripeCreated = true; return mockedStripe(value, []); },
      createSupabaseClient: () => { supabaseCreated = true; throw new Error("unexpected"); },
    }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_CATALOG_READ_KEY_BLANK",
  );
  assert.equal(stripeCreated, false);
  assert.equal(supabaseCreated, false);
});

test("live mode is refused before any provider client is created", async () => {
  let clientCreated = false;
  await assert.rejects(
    runCatalogRegistration({
      argv: ["--plan=small_flock", "--cadence=monthly", "--price-id=price_Batch4Live"],
      env: catalogEnvironment({
        STRIPE_SAAS_CATALOG_READ_KEY: liveRestricted,
        STRIPE_SAAS_LIVEMODE: "true",
      }),
      createStripeClient: () => { clientCreated = true; throw new Error("unexpected"); },
    }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_LIVE_MODE_REFUSED",
  );
  assert.equal(clientCreated, false);
});

test("apply requires Supabase URL only after Stripe verification", async () => {
  const value = fixture();
  const stripeCalls = [];
  let supabaseCreated = false;
  await assert.rejects(
    runCatalogRegistration({
      argv: [
        "--plan=small_flock", "--cadence=monthly",
        `--price-id=${value.selection.stripePriceId}`,
        "--apply", "--confirm-environment=local", `--confirm-account=${accountId}`,
      ],
      env: catalogEnvironment(),
      createStripeClient: () => mockedStripe(value, stripeCalls),
      createSupabaseClient: () => { supabaseCreated = true; throw new Error("unexpected"); },
    }),
    (error) => error.code === "STRIPE_SAAS_CONFIG_SUPABASE_URL_MISSING",
  );
  assert.deepEqual(stripeCalls, ["price.retrieve", "product.retrieve"]);
  assert.equal(supabaseCreated, false);
});

test("apply requires Supabase service-role key only after Stripe verification", async () => {
  const value = fixture();
  const stripeCalls = [];
  let supabaseCreated = false;
  await assert.rejects(
    runCatalogRegistration({
      argv: [
        "--plan=small_flock", "--cadence=monthly",
        `--price-id=${value.selection.stripePriceId}`,
        "--apply", "--confirm-environment=local", `--confirm-account=${accountId}`,
      ],
      env: catalogEnvironment({ SUPABASE_URL: "http://127.0.0.1:54321" }),
      createStripeClient: () => mockedStripe(value, stripeCalls),
      createSupabaseClient: () => { supabaseCreated = true; throw new Error("unexpected"); },
    }),
    (error) => error.code === "STRIPE_SAAS_CONFIG_SUPABASE_SERVICE_ROLE_KEY_MISSING",
  );
  assert.deepEqual(stripeCalls, ["price.retrieve", "product.retrieve"]);
  assert.equal(supabaseCreated, false);
});

test("apply calls only the registration RPC with the allowlisted typed request", async () => {
  const value = fixture();
  const rpcCalls = [];
  const result = await runCatalogRegistration({
    argv: [
      "--plan=small_flock", "--cadence=monthly",
      `--price-id=${value.selection.stripePriceId}`,
      "--apply", "--confirm-environment=local", `--confirm-account=${accountId}`,
    ],
    env: catalogEnvironment({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: serviceSecret }),
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
  assert.equal(rpcCalls[0].request.p_stripe_account_id, accountId);
  assert.equal(rpcCalls[0].request.p_stripe_livemode, false);
  assert.ok(!("metadata" in rpcCalls[0].request));
  assert.ok(!("object" in rpcCalls[0].request));
});
