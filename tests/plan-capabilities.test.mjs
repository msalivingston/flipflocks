import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");

function loadPlanCapabilities() {
  const filename = resolve(root, "lib/plan-capabilities.ts");
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };

  new Function("module", "exports", output)(
    loadedModule,
    loadedModule.exports,
  );

  return loadedModule.exports;
}

const plans = loadPlanCapabilities();

const capabilityMatrix = [
  {
    categories: ["live_birds"],
    input: "small_flock",
    normalized: "small_flock",
    offerings: ["female", "male", "straight_run", "unsexed", "pair", "trio"],
  },
  {
    categories: [
      "live_birds",
      "hatching_eggs",
      "equipment_supplies",
      "processed_poultry",
    ],
    input: "full_flock",
    normalized: "full_flock",
    offerings: [
      "female",
      "male",
      "straight_run",
      "unsexed",
      "pair",
      "trio",
      "flock",
    ],
  },
];

test("recognized plans expose the approved category capability matrix", () => {
  for (const row of capabilityMatrix) {
    assert.equal(plans.normalizePlanId(row.input), row.normalized);
    assert.deepEqual(
      plans.getPlanCapabilities(row.input).allowedSaleCategories,
      row.categories,
    );

    for (const category of [
      "live_birds",
      "hatching_eggs",
      "equipment_supplies",
      "processed_poultry",
    ]) {
      assert.equal(
        plans.isSaleCategoryAllowed(row.input, category),
        row.categories.includes(category),
        `${row.input} category ${category}`,
      );
    }
  }
});

test("recognized plans expose the approved Live Birds offering matrix", () => {
  for (const row of capabilityMatrix) {
    for (const offering of [
      "female",
      "male",
      "straight_run",
      "unsexed",
      "pair",
      "trio",
      "flock",
    ]) {
      assert.equal(
        plans.isLiveBirdOfferingAllowed(row.input, offering),
        row.offerings.includes(offering),
        `${row.input} offering ${offering}`,
      );
    }
  }
});

test("only an exact Market key receives Market capabilities", () => {
  for (const value of [
    null,
    undefined,
    "",
    " ",
    "FULL_FLOCK",
    "market",
    "future_market_plan",
    "not-a-plan",
  ]) {
    assert.equal(plans.normalizePlanId(value), "small_flock");
    assert.equal(plans.getPlanCapabilities(value).id, "small_flock");
  }

  assert.equal(plans.getPlanCapabilities("full_flock").id, "full_flock");
  assert.equal(plans.getPlanCapabilities("small_flock").id, "small_flock");
});

test("Coop retains the five-bird limit while Market remains unlimited", () => {
  assert.equal(plans.getPlanCapabilities("small_flock").activeBirdLimit, 5);
  assert.equal(plans.getPlanCapabilities(null).activeBirdLimit, 5);
  assert.equal(plans.getPlanCapabilities("full_flock").activeBirdLimit, null);
});

test("active plan-sensitive UI consumes the shared capability authority", () => {
  const categoryStep = readFileSync(
    resolve(
      root,
      "app/onboarding/_components/step-3-selling-categories-form.tsx",
    ),
    "utf8",
  );
  const reviewStep = readFileSync(
    resolve(root, "app/onboarding/_components/step-6-review-setup.tsx"),
    "utf8",
  );

  assert.match(categoryStep, /getPlanCapabilities\(planKey\)/);
  assert.doesNotMatch(categoryStep, /planKey\s*[!=]==?\s*["']full_flock/);
  assert.match(
    reviewStep,
    /getPlanCapabilities\(billing\.requested_plan_key\)/,
  );
  assert.match(
    reviewStep,
    /getPlanCapabilities\(billing\.effective_plan_key\)/,
  );
  assert.doesNotMatch(reviewStep, /PLAN_CAPABILITIES\[normalizePlanId/);
});
