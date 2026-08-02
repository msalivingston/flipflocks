import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_SAAS_CATALOG_MANIFEST,
  verifyApprovedSaasCatalog,
} from "../scripts/stripe/verify-saas-catalog.mjs";

const restrictedKey = ["rk", "test", "CatalogVerifierFixture"].join("_");

const expectedManifest = [
  ["small_flock", "monthly", "price_1TzpKSL1R5g4hhXtWhItRai3", "prod_UzoyVYb4UGqW3m"],
  ["small_flock", "yearly", "price_1TzpKSL1R5g4hhXtv4yG6PWt", "prod_UzoyVYb4UGqW3m"],
  ["full_flock", "monthly", "price_1TzpLxL1R5g4hhXtHn9Vg6Qd", "prod_Uzoz8CeVMRC3zQ"],
  ["full_flock", "yearly", "price_1TzpMhL1R5g4hhXt266qwLn5", "prod_Uzoz8CeVMRC3zQ"],
];

const approvedValues = new Map([
  ["small_flock:monthly", { amount: 500, interval: "month", productName: "FlockFront Coop" }],
  ["small_flock:yearly", { amount: 5000, interval: "year", productName: "FlockFront Coop" }],
  ["full_flock:monthly", { amount: 2900, interval: "month", productName: "FlockFront Market" }],
  ["full_flock:yearly", { amount: 27000, interval: "year", productName: "FlockFront Market" }],
]);

function fixtures() {
  const products = new Map();
  const prices = new Map();
  for (const entry of APPROVED_SAAS_CATALOG_MANIFEST) {
    const approved = approvedValues.get(`${entry.planKey}:${entry.cadence}`);
    products.set(entry.stripeProductId, {
      id: entry.stripeProductId,
      object: "product",
      livemode: false,
      active: true,
      name: approved.productName,
      tax_code: "txcd_10103001",
      created: 1767225600,
    });
    prices.set(entry.stripePriceId, {
      id: entry.stripePriceId,
      object: "price",
      livemode: false,
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
  return async ({ verifyKey }) => {
    onAcquire();
    return verifyKey(key, () => {});
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

test("one key acquisition and one Stripe client verify all four Prices", async () => {
  const values = fixtures();
  const calls = [];
  const output = [];
  let keyAcquisitions = 0;
  let clientCreations = 0;
  const inputEnvironment = {};
  const result = await verifyApprovedSaasCatalog({
    env: inputEnvironment,
    runLocalForm: localFormWithKey(restrictedKey, () => { keyAcquisitions += 1; }),
    createStripeClient: (key) => {
      clientCreations += 1;
      assert.equal(key, restrictedKey);
      return mockedClient(values, calls);
    },
    write: (line) => output.push(line),
  });

  assert.equal(result.passed, true);
  assert.equal(keyAcquisitions, 1);
  assert.equal(clientCreations, 1);
  assert.deepEqual(calls.filter(([type]) => type === "price").map(([, id]) => id),
    APPROVED_SAAS_CATALOG_MANIFEST.map(({ stripePriceId }) => stripePriceId));
  assert.deepEqual(calls.filter(([type]) => type === "product").map(([, id]) => id),
    ["prod_UzoyVYb4UGqW3m", "prod_Uzoz8CeVMRC3zQ"]);
  assert.equal(result.results.filter(({ status }) => status === "PASS").length, 4);
  assert.equal(output.filter((line) => /\bPASS$/.test(line)).length, 8);
  assert.doesNotMatch(output.join("\n"), new RegExp(restrictedKey));
  assert.deepEqual(inputEnvironment, {});
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
