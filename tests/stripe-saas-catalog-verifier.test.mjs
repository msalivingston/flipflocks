import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_LIVE_SAAS_CATALOG_MANIFEST,
  APPROVED_SAAS_CATALOG_MANIFEST,
  parseCatalogVerifierArguments,
  verifyApprovedSaasCatalog,
} from "../scripts/stripe/verify-saas-catalog.mjs";

const restrictedKey = ["rk", "test", "CatalogVerifierFixture"].join("_");
const liveRestrictedKey = ["rk", "live", "CatalogVerifierFixture"].join("_");
const serviceRoleKey = ["service", "role", "fixture"].join("-");
const applyArguments = [
  "--apply",
  "--confirm-environment=local",
  "--confirm-account=acct_1CTOghL1R5g4hhXt",
];
const liveApplyArguments = [
  "--live",
  "--apply",
  "--confirm-environment=production",
  "--confirm-account=acct_1CTOghL1R5g4hhXt",
];

const expectedManifest = [
  ["small_flock", "monthly", "price_1TzpKSL1R5g4hhXtWhItRai3", "prod_UzoyVYb4UGqW3m"],
  ["small_flock", "yearly", "price_1TzpKSL1R5g4hhXtv4yG6PWt", "prod_UzoyVYb4UGqW3m"],
  ["full_flock", "monthly", "price_1TzpLxL1R5g4hhXtHn9Vg6Qd", "prod_Uzoz8CeVMRC3zQ"],
  ["full_flock", "yearly", "price_1TzpMhL1R5g4hhXt266qwLn5", "prod_Uzoz8CeVMRC3zQ"],
];

const expectedLiveManifest = [
  ["small_flock", "monthly", "price_1U1A6TL1R5g4hhXttRzdEkpO", "prod_V1CV3zEif7505x"],
  ["small_flock", "yearly", "price_1U1A6TL1R5g4hhXtXV8oONZy", "prod_V1CV3zEif7505x"],
  ["full_flock", "monthly", "price_1U1A6PL1R5g4hhXtsuBhV0pk", "prod_V1CVBoupdvIdFd"],
  ["full_flock", "yearly", "price_1U1A6PL1R5g4hhXtandGNw8C", "prod_V1CVBoupdvIdFd"],
];

const approvedValues = new Map([
  ["small_flock:monthly", { amount: 500, interval: "month", productName: "FlockFront Coop" }],
  ["small_flock:yearly", { amount: 5000, interval: "year", productName: "FlockFront Coop" }],
  ["full_flock:monthly", { amount: 2900, interval: "month", productName: "FlockFront Market" }],
  ["full_flock:yearly", { amount: 27000, interval: "year", productName: "FlockFront Market" }],
]);

function fixtures(manifest = APPROVED_SAAS_CATALOG_MANIFEST, livemode = false) {
  const products = new Map();
  const prices = new Map();
  for (const entry of manifest) {
    const approved = approvedValues.get(`${entry.planKey}:${entry.cadence}`);
    products.set(entry.stripeProductId, {
      id: entry.stripeProductId,
      object: "product",
      livemode,
      active: true,
      name: approved.productName,
      tax_code: "txcd_10103001",
      created: 1767225600,
    });
    prices.set(entry.stripePriceId, {
      id: entry.stripePriceId,
      object: "price",
      livemode,
      active: true,
      product: entry.stripeProductId,
      type: "recurring",
      billing_scheme: "per_unit",
      tiers_mode: null,
      recurring: { usage_type: "licensed", interval: approved.interval, interval_count: 1 },
      unit_amount: approved.amount,
      currency: "usd",
      tax_behavior: "exclusive",
      created: 1767225600,
    });
  }
  return { prices, products };
}

function mockedClient(values, calls) {
  return {
    prices: {
      retrieve: async (id) => {
        calls.push(["price", id]);
        const price = values.prices.get(id);
        if (!price) throw new Error("missing fixture");
        return price;
      },
    },
    products: {
      retrieve: async (id) => {
        calls.push(["product", id]);
        const product = values.products.get(id);
        if (!product) throw new Error("missing fixture");
        return product;
      },
    },
  };
}

function localFormWithKey(key, onAcquire = () => {}) {
  return async ({ runOperation }) => {
    onAcquire();
    return runOperation({ catalogReadKey: key }, () => {});
  };
}

test("approved verifier manifest binds all four exact Prices to two exact Products", () => {
  assert.deepEqual(
    APPROVED_SAAS_CATALOG_MANIFEST.map((entry) => [
      entry.planKey, entry.cadence, entry.stripePriceId, entry.stripeProductId,
    ]),
    expectedManifest,
  );
  assert.equal(new Set(APPROVED_SAAS_CATALOG_MANIFEST
    .filter(({ planKey }) => planKey === "small_flock")
    .map(({ stripeProductId }) => stripeProductId)).size, 1);
  assert.equal(new Set(APPROVED_SAAS_CATALOG_MANIFEST
    .filter(({ planKey }) => planKey === "full_flock")
    .map(({ stripeProductId }) => stripeProductId)).size, 1);
});

test("approved live manifest binds four exact live Prices to the existing internal plans", () => {
  assert.deepEqual(
    APPROVED_LIVE_SAAS_CATALOG_MANIFEST.map((entry) => [
      entry.planKey, entry.cadence, entry.stripePriceId, entry.stripeProductId,
    ]),
    expectedLiveManifest,
  );
  assert.equal(new Set(APPROVED_LIVE_SAAS_CATALOG_MANIFEST
    .filter(({ planKey }) => planKey === "small_flock")
    .map(({ stripeProductId }) => stripeProductId)).size, 1);
  assert.equal(new Set(APPROVED_LIVE_SAAS_CATALOG_MANIFEST
    .filter(({ planKey }) => planKey === "full_flock")
    .map(({ stripeProductId }) => stripeProductId)).size, 1);
  assert.ok(APPROVED_LIVE_SAAS_CATALOG_MANIFEST.every(
    ({ planKey }) => planKey !== "market",
  ));
});

test("one key acquisition and one Stripe client verify all four Prices", async () => {
  const values = fixtures();
  const calls = [];
  const output = [];
  let keyAcquisitions = 0;
  let clientCreations = 0;
  let supabaseClientCreations = 0;
  const inputEnvironment = {};
  const result = await verifyApprovedSaasCatalog({
    env: inputEnvironment,
    runLocalForm: localFormWithKey(restrictedKey, () => { keyAcquisitions += 1; }),
    createStripeClient: (key) => {
      clientCreations += 1;
      assert.equal(key, restrictedKey);
      return mockedClient(values, calls);
    },
    createSupabaseClient: () => {
      supabaseClientCreations += 1;
      throw new Error("dry-run must not create a Supabase client");
    },
    write: (line) => output.push(line),
  });

  assert.equal(result.passed, true);
  assert.equal(keyAcquisitions, 1);
  assert.equal(clientCreations, 1);
  assert.equal(supabaseClientCreations, 0);
  assert.deepEqual(calls.filter(([type]) => type === "price").map(([, id]) => id),
    APPROVED_SAAS_CATALOG_MANIFEST.map(({ stripePriceId }) => stripePriceId));
  assert.deepEqual(calls.filter(([type]) => type === "product").map(([, id]) => id),
    ["prod_UzoyVYb4UGqW3m", "prod_Uzoz8CeVMRC3zQ"]);
  assert.equal(result.results.filter(({ status }) => status === "PASS").length, 4);
  assert.equal(output.filter((line) => /\bPASS$/.test(line)).length, 8);
  assert.doesNotMatch(output.join("\n"), new RegExp(restrictedKey));
  assert.deepEqual(inputEnvironment, {});
});

test("apply confirmations are exact and validated before provider or Supabase clients", async () => {
  let stripeClientCreations = 0;
  let supabaseClientCreations = 0;
  await assert.rejects(
    verifyApprovedSaasCatalog({
      argv: ["--apply", "--confirm-environment=local"],
      env: { STRIPE_SAAS_CATALOG_READ_KEY: restrictedKey },
      createStripeClient: () => { stripeClientCreations += 1; },
      createSupabaseClient: () => { supabaseClientCreations += 1; },
      write: () => {},
    }),
    (error) => error.code === "STRIPE_SAAS_UTILITY_ACCOUNT_CONFIRMATION_REQUIRED",
  );
  assert.equal(stripeClientCreations, 0);
  assert.equal(supabaseClientCreations, 0);
  assert.deepEqual(parseCatalogVerifierArguments(applyArguments), {
    apply: true,
    live: false,
    confirmationEnvironmentId: "local",
    confirmationAccountId: "acct_1CTOghL1R5g4hhXt",
  });
});

test("live apply verifies all four provider objects before four live registrations", async () => {
  const values = fixtures(APPROVED_LIVE_SAAS_CATALOG_MANIFEST, true);
  const stripeCalls = [];
  const rpcCalls = [];
  let suppliedKeyMode = null;
  const result = await verifyApprovedSaasCatalog({
    argv: liveApplyArguments,
    env: {},
    runLocalForm: async ({ apply, keyMode, runOperation }) => {
      assert.equal(apply, true);
      suppliedKeyMode = keyMode;
      return runOperation({
        catalogReadKey: liveRestrictedKey,
        supabaseUrl: "https://project.supabase.co",
        supabaseServiceRoleKey: serviceRoleKey,
      }, () => {});
    },
    createStripeClient: (key) => {
      assert.equal(key, liveRestrictedKey);
      return mockedClient(values, stripeCalls);
    },
    createSupabaseClient: () => ({
      rpc: async (name, request) => {
        rpcCalls.push({ name, request });
        return {
          data: [{
            registration_status: "registered",
            registered_stripe_price_id: request.p_stripe_price_id,
          }],
          error: null,
        };
      },
    }),
    write: () => {},
  });

  assert.equal(suppliedKeyMode, "live");
  assert.equal(result.passed, true);
  assert.equal(result.applied, true);
  assert.equal(stripeCalls.filter(([type]) => type === "price").length, 4);
  assert.equal(stripeCalls.filter(([type]) => type === "product").length, 2);
  assert.deepEqual(rpcCalls.map(({ name }) => name),
    Array(4).fill("register_verified_saas_price"));
  assert.deepEqual(rpcCalls.map(({ request }) => request.p_stripe_price_id),
    APPROVED_LIVE_SAAS_CATALOG_MANIFEST.map(({ stripePriceId }) => stripePriceId));
  assert.ok(rpcCalls.every(({ request }) => request.p_stripe_livemode === true));
  assert.ok(rpcCalls.every(({ request }) =>
    request.p_stripe_account_id === "acct_1CTOghL1R5g4hhXt"));
});

test("live apply requires the explicit production confirmation before clients", async () => {
  let stripeClientCreations = 0;
  let supabaseClientCreations = 0;
  await assert.rejects(verifyApprovedSaasCatalog({
    argv: [
      "--live", "--apply", "--confirm-environment=local",
      "--confirm-account=acct_1CTOghL1R5g4hhXt",
    ],
    env: { STRIPE_SAAS_CATALOG_READ_KEY: liveRestrictedKey },
    createStripeClient: () => { stripeClientCreations += 1; },
    createSupabaseClient: () => { supabaseClientCreations += 1; },
    write: () => {},
  }), (error) =>
    error.code === "STRIPE_SAAS_UTILITY_ENVIRONMENT_CONFIRMATION_REQUIRED");
  assert.equal(stripeClientCreations, 0);
  assert.equal(supabaseClientCreations, 0);
});

test("explicit live mode rejects conflicting environment mode before provider access", async () => {
  let stripeClientCreations = 0;
  await assert.rejects(verifyApprovedSaasCatalog({
    argv: ["--live"],
    env: {
      STRIPE_SAAS_CATALOG_READ_KEY: liveRestrictedKey,
      STRIPE_SAAS_LIVEMODE: "false",
      FLOCKFRONT_ENVIRONMENT_ID: "production",
    },
    createStripeClient: () => { stripeClientCreations += 1; },
    write: () => {},
  }), (error) => error.code === "STRIPE_SAAS_CONFIG_KEY_MODE_MISMATCH");
  assert.equal(stripeClientCreations, 0);
});

test("apply without terminal variables uses browser-submitted credentials", async () => {
  const values = fixtures();
  const stripeCalls = [];
  let formCalls = 0;
  let supabaseClientCreations = 0;
  let rpcCalls = 0;
  const result = await verifyApprovedSaasCatalog({
    argv: applyArguments,
    env: {},
    runLocalForm: async ({ apply, runOperation }) => {
      formCalls += 1;
      assert.equal(apply, true);
      return runOperation({
        catalogReadKey: restrictedKey,
        supabaseUrl: "https://project.supabase.co",
        supabaseServiceRoleKey: serviceRoleKey,
      }, () => {});
    },
    createStripeClient: () => mockedClient(values, stripeCalls),
    createSupabaseClient: () => {
      supabaseClientCreations += 1;
      return {
        rpc: async (_name, request) => {
          rpcCalls += 1;
          return {
            data: [{
              registration_status: "registered",
              registered_stripe_price_id: request.p_stripe_price_id,
            }],
            error: null,
          };
        },
      };
    },
    write: () => {},
  });
  assert.equal(result.applied, true);
  assert.equal(formCalls, 1);
  assert.equal(stripeCalls.filter(([type]) => type === "price").length, 4);
  assert.equal(supabaseClientCreations, 1);
  assert.equal(rpcCalls, 4);
});

test("partially configured apply automation falls back to the complete browser form", async () => {
  let formOpened = false;
  await assert.rejects(verifyApprovedSaasCatalog({
    argv: applyArguments,
    env: {
      STRIPE_SAAS_CATALOG_READ_KEY: restrictedKey,
      SUPABASE_URL: "https://project.supabase.co",
    },
    runLocalForm: async ({ apply }) => {
      formOpened = true;
      assert.equal(apply, true);
      throw Object.assign(new Error("form stopped for test"), { code: "FORM_TEST_STOP" });
    },
    write: () => {},
  }), (error) => error.code === "FORM_TEST_STOP");
  assert.equal(formOpened, true);
});

test("one failed Price does not prevent the other three checks", async () => {
  const values = fixtures();
  values.prices.get("price_1TzpKSL1R5g4hhXtv4yG6PWt").unit_amount = 5001;
  const calls = [];
  const output = [];
  const result = await verifyApprovedSaasCatalog({
    env: {},
    runLocalForm: localFormWithKey(restrictedKey),
    createStripeClient: () => mockedClient(values, calls),
    write: (line) => output.push(line),
  });

  assert.equal(result.passed, false);
  assert.equal(result.results.length, 4);
  assert.deepEqual(result.results.map(({ status }) => status), ["PASS", "FAIL", "PASS", "PASS"]);
  assert.equal(result.results[1].failureCode, "STRIPE_SAAS_VERIFY_AMOUNT_MISMATCH");
  assert.equal(calls.filter(([type]) => type === "price").length, 4);
  assert.equal(output.filter((line) => /\bPASS$/.test(line)).length, 6);
  assert.equal(output.filter((line) => /\bFAIL \(/.test(line)).length, 2);
});

test("one failed Price makes zero registration calls in apply mode", async () => {
  const values = fixtures();
  values.prices.get("price_1TzpKSL1R5g4hhXtv4yG6PWt").unit_amount = 5001;
  const output = [];
  let supabaseClientCreations = 0;
  let rpcCalls = 0;
  const result = await verifyApprovedSaasCatalog({
    argv: applyArguments,
    env: {},
    runLocalForm: async ({ apply, runOperation }) => {
      assert.equal(apply, true);
      return runOperation({
        catalogReadKey: restrictedKey,
        supabaseUrl: "https://project.supabase.co",
        supabaseServiceRoleKey: serviceRoleKey,
      }, () => {});
    },
    createStripeClient: () => mockedClient(values, []),
    createSupabaseClient: () => {
      supabaseClientCreations += 1;
      return { rpc: async () => { rpcCalls += 1; } };
    },
    write: (line) => output.push(line),
  });
  assert.equal(result.passed, false);
  assert.equal(supabaseClientCreations, 0);
  assert.equal(rpcCalls, 0);
  assert.equal(output.filter((line) => /\bPASS$/.test(line)).length, 6);
  assert.equal(output.filter((line) => /\bFAIL \(/.test(line)).length, 2);
});

test("four passing Prices use one Supabase client and only four typed registration RPCs", async () => {
  const values = fixtures();
  const rpcCalls = [];
  const output = [];
  let clientCreations = 0;
  const result = await verifyApprovedSaasCatalog({
    argv: applyArguments,
    env: {
      STRIPE_SAAS_CATALOG_READ_KEY: restrictedKey,
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
    createStripeClient: () => mockedClient(values, []),
    createSupabaseClient: (url, key) => {
      clientCreations += 1;
      assert.equal(url, "https://project.supabase.co");
      assert.equal(key, serviceRoleKey);
      return {
        rpc: async (name, request) => {
          rpcCalls.push({ name, request });
          return {
            data: [{
              registration_status: "registered",
              registered_stripe_price_id: request.p_stripe_price_id,
            }],
            error: null,
          };
        },
      };
    },
    write: (line) => output.push(line),
  });
  assert.equal(result.applied, true);
  assert.equal(clientCreations, 1);
  assert.equal(rpcCalls.length, 4);
  assert.ok(rpcCalls.every(({ name }) => name === "register_verified_saas_price"));
  assert.deepEqual(rpcCalls.map(({ request }) => request.p_stripe_price_id),
    APPROVED_SAAS_CATALOG_MANIFEST.map(({ stripePriceId }) => stripePriceId));
  assert.ok(rpcCalls.every(({ request }) => request.p_stripe_account_id === "acct_1CTOghL1R5g4hhXt"));
  assert.ok(rpcCalls.every(({ request }) => request.p_stripe_livemode === false));
  assert.deepEqual(result.registrationResults.map(({ status }) => status),
    ["registered", "registered", "registered", "registered"]);
  assert.equal(output.filter((line) => /\sregistered$/.test(line)).length, 4);
  assert.doesNotMatch(output.join("\n"), new RegExp(restrictedKey));
  assert.doesNotMatch(output.join("\n"), new RegExp(serviceRoleKey));
});

test("exact replay safely reports already_registered for all four Prices", async () => {
  const values = fixtures();
  const rpcNames = [];
  const result = await verifyApprovedSaasCatalog({
    argv: applyArguments,
    env: {
      STRIPE_SAAS_CATALOG_READ_KEY: restrictedKey,
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
    createStripeClient: () => mockedClient(values, []),
    createSupabaseClient: () => ({
      rpc: async (name, request) => {
        rpcNames.push(name);
        return {
          data: [{
            registration_status: "already_registered",
            registered_stripe_price_id: request.p_stripe_price_id,
          }],
          error: null,
        };
      },
    }),
    write: () => {},
  });
  assert.deepEqual(rpcNames, Array(4).fill("register_verified_saas_price"));
  assert.deepEqual(result.registrationResults.map(({ status }) => status),
    Array(4).fill("already_registered"));
});

test("unexpected provider errors are redacted and remaining Prices continue", async () => {
  const values = fixtures();
  const calls = [];
  const output = [];
  const client = mockedClient(values, calls);
  const retrieve = client.prices.retrieve;
  client.prices.retrieve = async (id) => {
    if (id === APPROVED_SAAS_CATALOG_MANIFEST[0].stripePriceId) {
      calls.push(["price", id]);
      throw new Error(restrictedKey);
    }
    return retrieve(id);
  };
  const result = await verifyApprovedSaasCatalog({
    env: {},
    runLocalForm: localFormWithKey(restrictedKey),
    createStripeClient: () => client,
    write: (line) => output.push(line),
  });
  assert.equal(result.passed, false);
  assert.equal(calls.filter(([type]) => type === "price").length, 4);
  assert.equal(result.results[0].failureCode, "STRIPE_SAAS_CATALOG_VERIFY_UNEXPECTED");
  assert.doesNotMatch(output.join("\n"), new RegExp(restrictedKey));
});

test("automation environment key bypasses the local browser form", async () => {
  const values = fixtures();
  let formOpened = false;
  const result = await verifyApprovedSaasCatalog({
    env: { STRIPE_SAAS_CATALOG_READ_KEY: restrictedKey },
    runLocalForm: async () => { formOpened = true; throw new Error("unexpected browser form"); },
    createStripeClient: () => mockedClient(values, []),
    write: () => {},
  });
  assert.equal(result.passed, true);
  assert.equal(formOpened, false);
});
