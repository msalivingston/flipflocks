import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../../../../../..");
const moduleCache = new Map();

function loadTypeScriptModule(relativePath) {
  const filename = resolve(root, relativePath);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;

  const loadedModule = { exports: {} };
  moduleCache.set(filename, loadedModule);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;

  function localRequire(specifier) {
    if (!specifier.startsWith(".")) return {};
    const candidate = resolve(dirname(filename), specifier);
    const resolved = extname(candidate) ? candidate : `${candidate}.ts`;
    return loadTypeScriptModule(resolved.slice(root.length + 1));
  }

  new Function("require", "module", "exports", "__filename", "__dirname", output)(
    localRequire,
    loadedModule,
    loadedModule.exports,
    filename,
    dirname(filename),
  );
  return loadedModule.exports;
}

const domain = loadTypeScriptModule(
  "app/dashboard/inventory/add-v2/live-birds/batch/batchDomain.ts",
);
const constants = loadTypeScriptModule(
  "app/dashboard/inventory/add-v2/live-birds/constants.ts",
);
const payload = loadTypeScriptModule(
  "app/dashboard/inventory/add-v2/live-birds/payloadPreview.ts",
);
const persistence = loadTypeScriptModule(
  "app/dashboard/inventory/add-v2/live-birds/batch/batchPersistence.ts",
);
const advancedAttributes = loadTypeScriptModule(
  "lib/live-bird-advanced-attributes.ts",
);

const chicken = { id: "species-chicken", label: "Chicken", slug: "chicken" };
const barredRock = {
  id: "profile-barred-rock",
  label: "Barred Rock",
  speciesId: chicken.id,
  breedId: "catalog-barred-rock",
  catalogImageUrl: "https://example.test/barred-rock.jpg",
  catalogDescription: null,
  sellerPhotoUrl: null,
  sellerDescription: "Calm dual-purpose birds.",
  source: "seller_profile",
};

function completeRow(id, overrides = {}) {
  return {
    ...domain.createBatchRow(id),
    species: chicken,
    hatchDate: "2026-05-15",
    availableDate: "2026-06-15",
    breed: barredRock,
    soldAs: "Female",
    quantity: "20",
    price: "16.00",
    ...overrides,
  };
}

test("Batch Add route exists and normal Add exposes a create-only entry point", () => {
  const batchPage = readFileSync(
    resolve(
      root,
      "app/dashboard/inventory/add-v2/live-birds/batch/page.tsx",
    ),
    "utf8",
  );
  const normalPage = readFileSync(
    resolve(root, "app/dashboard/inventory/add-v2/live-birds/page.tsx"),
    "utf8",
  );

  assert.match(batchPage, /Batch Add Live Birds/);
  assert.match(batchPage, /Each row will become its own Live Birds inventory entry/);
  assert.doesNotMatch(
    batchPage,
    /seller_create_listing_batch_with_inventory|seller_create_inventory_item/,
  );
  assert.match(normalPage, /!isEditMode \? <BatchAddEntryPoint \/> : null/);
  assert.match(
    normalPage,
    /href="\/dashboard\/inventory\/add-v2\/live-birds\/batch"/,
  );
});

test("Add Row inherits only species and dates and keeps stable row IDs", () => {
  const source = completeRow("row-a", {
    barnLocation: "Barn 2",
    quantity: "75",
  });
  const rows = domain.addBatchRow([source], "row-b");

  assert.equal(rows[0].id, "row-a");
  assert.equal(rows[1].id, "row-b");
  assert.deepEqual(rows[1].species, chicken);
  assert.equal(rows[1].hatchDate, source.hatchDate);
  assert.equal(rows[1].availableDate, source.availableDate);
  assert.equal(rows[1].breed, null);
  assert.equal(rows[1].soldAs, "");
  assert.equal(rows[1].quantity, "");
  assert.equal(rows[1].price, "");
  assert.equal(rows[1].barnLocation, "");
});

test("Remove Row removes only the requested stable row", () => {
  const rows = [completeRow("row-a"), completeRow("row-b")];
  const remaining = domain.removeBatchRow(rows, "row-a");

  assert.deepEqual(remaining.map((row) => row.id), ["row-b"]);
});

test("Duplicate Row copies the allowed values and clears quantity and barn", () => {
  const source = completeRow("row-a", {
    barnLocation: "Barn A",
    breedingHistory: "breeder",
    featherCondition: "good",
    quantity: "5",
    price: "19.50",
  });
  const rows = domain.duplicateBatchRow([source], "row-a", "row-b");
  const duplicate = rows[1];

  assert.equal(duplicate.id, "row-b");
  assert.deepEqual(duplicate.species, source.species);
  assert.equal(duplicate.hatchDate, source.hatchDate);
  assert.equal(duplicate.availableDate, source.availableDate);
  assert.deepEqual(duplicate.breed, source.breed);
  assert.equal(duplicate.soldAs, source.soldAs);
  assert.equal(duplicate.price, source.price);
  assert.equal(duplicate.breedingHistory, "breeder");
  assert.equal(duplicate.featherCondition, "good");
  assert.equal(duplicate.quantity, "");
  assert.equal(duplicate.barnLocation, "");
});

test("semantic duplicate Breed and Sold As rows remain valid and separate", () => {
  const rows = [
    completeRow("row-a", { quantity: "5", barnLocation: "Barn A" }),
    completeRow("row-b", { quantity: "20", barnLocation: "Barn B" }),
  ];

  assert.equal(domain.isBatchRowValid(rows[0]), true);
  assert.equal(domain.isBatchRowValid(rows[1]), true);
  const groups = domain.groupBatchRows(rows);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rows.map((row) => row.id), ["row-a", "row-b"]);
  assert.equal(groups[0].totalQuantity, 25);
});

test("rows group by species, hatch date, and available date", () => {
  const rows = [
    completeRow("row-a"),
    completeRow("row-b", { hatchDate: "2026-05-01" }),
    completeRow("row-c", { availableDate: "2026-06-20" }),
  ];
  const groups = domain.groupBatchRows(rows);

  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((group) => group.rows[0].id).sort(),
    ["row-a", "row-b", "row-c"],
  );
});

test("controlled Sold As values map through the existing Live Birds mapping", () => {
  assert.ok(constants.soldAsOptions.length > 0);
  constants.soldAsOptions.forEach((soldAs) => {
    assert.notEqual(payload.mapSoldAsToInventoryType(soldAs), "unknown");
  });
});

test("row validation covers dates, quantity, price, and Barn Location", () => {
  const errors = domain.validateBatchRow(
    completeRow("row-a", {
      availableDate: "2026-05-01",
      hatchDate: "2026-05-15",
      quantity: "2.5",
      price: "12.999",
      barnLocation: "x".repeat(201),
    }),
  );

  assert.match(errors.availableDate, /on or after/i);
  assert.match(errors.quantity, /whole number/i);
  assert.match(errors.price, /up to 2 decimals/i);
  assert.match(errors.barnLocation, /200 characters/i);
});

test("advanced attribute controls use only allowed values and reject unknown state", () => {
  assert.deepEqual(
    advancedAttributes.breedingHistoryOptions.map((option) => option.value),
    ["", "never_bred", "breeder"],
  );
  assert.deepEqual(
    advancedAttributes.featherConditionOptions.map((option) => option.value),
    ["", "excellent", "good", "rough", "very_rough"],
  );

  const errors = domain.validateBatchRow(
    completeRow("row-a", {
      breedingHistory: "unknown",
      featherCondition: "damaged",
    }),
  );
  assert.match(errors.breedingHistory, /valid Breeding History/i);
  assert.match(errors.featherCondition, /valid Feather Condition/i);
});

test("buyer details preserve Sex when empty and render every natural combination", () => {
  assert.equal(advancedAttributes.getLiveBirdDetailsColumnLabel([{}]), "Sex");
  assert.equal(
    advancedAttributes.getLiveBirdDetailsColumnLabel([
      { breedingHistory: "breeder" },
    ]),
    "Bird details",
  );
  assert.equal(
    advancedAttributes.formatLiveBirdAdvancedDetails({
      breedingHistory: "never_bred",
      featherCondition: "excellent",
    }),
    "Never Bred · Excellent feathers",
  );
  assert.equal(
    advancedAttributes.formatLiveBirdAdvancedDetails({
      breedingHistory: "breeder",
      featherCondition: "good",
    }),
    "Breeder · Good feathers",
  );
  assert.equal(
    advancedAttributes.formatLiveBirdAdvancedDetails({
      featherCondition: "very_rough",
    }),
    "Very rough feathers",
  );
  assert.equal(
    advancedAttributes.formatLiveBirdAdvancedDetails({
      featherCondition: "rough",
    }),
    "Rough feathers",
  );
  assert.equal(
    advancedAttributes.formatLiveBirdAdvancedDetails({
      breedingHistory: "never_bred",
    }),
    "Never Bred",
  );
});

test("desktop and mobile purchase options share Bird details presentation", () => {
  const source = readFileSync(
    resolve(
      root,
      "app/store/[slug]/products/[productId]/product-order-options.tsx",
    ),
    "utf8",
  );
  assert.ok((source.match(/<BirdDetails option=\{option\} \/>/g) ?? []).length >= 2);
  assert.match(source, /showAdvancedBirdDetails/);
});

test("normal Add and Batch Add share breed search and catalog profile creation", () => {
  const normalPage = readFileSync(
    resolve(root, "app/dashboard/inventory/add-v2/live-birds/page.tsx"),
    "utf8",
  );
  const batchPage = readFileSync(
    resolve(
      root,
      "app/dashboard/inventory/add-v2/live-birds/batch/page.tsx",
    ),
    "utf8",
  );
  const offeringsCard = readFileSync(
    resolve(
      root,
      "app/dashboard/inventory/add-v2/live-birds/BirdOfferingsCard.tsx",
    ),
    "utf8",
  );

  assert.match(offeringsCard, /from "\.\/BreedCombobox"/);
  assert.match(batchPage, /from "\.\.\/BreedCombobox"/);
  assert.match(normalPage, /createSellerBreedProfileFromCatalogBreed/);
  assert.match(batchPage, /createSellerBreedProfileFromCatalogBreed/);
});

test("review summary reports totals across hatch groups", () => {
  const rows = [
    completeRow("row-a", { quantity: "5", price: "18.00", barnLocation: "Barn A" }),
    completeRow("row-b", { quantity: "20", price: "8.00" }),
    completeRow("row-c", {
      hatchDate: "2026-05-20",
      availableDate: "2026-06-20",
      quantity: "10",
      price: "17.00",
    }),
  ];
  const groups = domain.groupBatchRows(rows);
  const summary = persistence.getBatchReviewSummary({
    groups,
    priceAdjustments: {
      [groups[0].id]: { enabled: true },
    },
  });

  assert.deepEqual(summary, {
    entryCount: 3,
    hatchGroupCount: 2,
    totalBirds: 35,
    breedCount: 1,
    minimumPrice: 8,
    maximumPrice: 18,
    barnLocationCount: 1,
    automaticPricingGroupCount: 1,
  });
});

test("atomic payload keeps row tokens and derives the lowest group base price", () => {
  const rows = [
    completeRow("row-a", {
      quantity: "5",
      price: "18.00",
      barnLocation: " Barn A ",
      breedingHistory: "never_bred",
      featherCondition: "excellent",
    }),
    completeRow("row-b", { quantity: "20", price: "8.00", barnLocation: "Barn B" }),
  ];
  const groups = domain.groupBatchRows(rows);
  const request = persistence.buildBatchCreatePayload({
    groups,
    priceAdjustments: {},
  });

  assert.equal(request.length, 1);
  assert.equal(request[0].base_price, 8);
  assert.deepEqual(
    request[0].breed_groups[0].inventory_items.map((item) => item.client_row_token),
    ["row-a", "row-b"],
  );
  assert.deepEqual(
    request[0].breed_groups[0].inventory_items.map((item) => item.barn_location),
    ["Barn A", "Barn B"],
  );
  assert.deepEqual(
    request[0].breed_groups[0].inventory_items.map((item) => [
      item.breeding_history,
      item.feather_condition,
    ]),
    [["never_bred", "excellent"], [null, null]],
  );
});

test("Batch Add submits one atomic RPC and exposes review, failure, and success states", () => {
  const batchPage = readFileSync(
    resolve(root, "app/dashboard/inventory/add-v2/live-birds/batch/page.tsx"),
    "utf8",
  );

  assert.equal(
    (batchPage.match(/supabase\.rpc\(\s*"seller_create_live_bird_batches"/g) ?? []).length,
    1,
  );
  assert.match(batchPage, /submissionStatus === "submitting"/);
  assert.match(batchPage, /setReviewState\(null\)/);
  assert.match(batchPage, /Inventory added/);
  assert.match(batchPage, /Add More Live Birds/);
  assert.match(batchPage, /href="\/dashboard\/inventory\?tab=live_poultry"/);
  assert.match(batchPage, /error_row_token/);
  assert.match(batchPage, /error_group_token/);
});
