import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../../../../..");
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

const payload = loadTypeScriptModule(
  "app/dashboard/inventory/add-v2/live-birds/createDraftPayload.ts",
);
const identity = loadTypeScriptModule(
  "app/dashboard/inventory/add-v2/live-birds/inventoryIdentity.ts",
);
const preflight = loadTypeScriptModule(
  "app/dashboard/inventory/add-v2/live-birds/saveDraftPreflight.ts",
);
const cart = loadTypeScriptModule(
  "app/store/[slug]/_components/storefront-cart-client.ts",
);

function offering(id, quantity, price = "18") {
  return {
    breed: "Barred Rock",
    description: "Barred Rock",
    expanded: false,
    id,
    price,
    quantity: String(quantity),
    sellerBreedProfileId: "profile-1",
    soldAs: "Female",
  };
}

const duplicateOfferings = [offering("row-a", 5), offering("row-b", 10, "16")];
const species = { id: "species-1", label: "Chicken", slug: "chicken" };

test("normal Add validation permits duplicate Breed and Sold As rows", () => {
  const result = preflight.getSaveDraftPreflight({
    availableDate: "2026-06-01",
    hatchDate: "2026-05-01",
    offerings: duplicateOfferings,
    priceAdjustment: {
      amount: "",
      direction: "increase",
      enabled: false,
      intervalWeeks: "",
      maxPrice: "",
      minPrice: "",
    },
    species,
    usingFallbackBreeds: false,
    usingFallbackSpecies: false,
  });

  assert.equal(result.canSaveDraft, true);
  assert.equal(
    result.blockingIssues.some((issue) => /same breed|duplicate/i.test(issue)),
    false,
  );
});

test("creation payload preserves semantic duplicates and stable row tokens", () => {
  const result = payload.buildCreateLiveBirdsDraftPayload({
    availableDate: "2026-06-01",
    hatchDate: "2026-05-01",
    offerings: duplicateOfferings,
    species,
    storeId: "store-1",
  });

  assert.ok(result);
  assert.equal(result.p_breed_groups.length, 1);
  assert.deepEqual(
    result.p_breed_groups[0].inventory_items.map((item) => ({
      clientRowToken: item.client_row_token,
      inventoryType: item.inventory_type,
      quantity: item.quantity_available,
    })),
    [
      { clientRowToken: "row-a", inventoryType: "female", quantity: 5 },
      { clientRowToken: "row-b", inventoryType: "female", quantity: 10 },
    ],
  );
});

test("returned row tokens map duplicate rows and pending photos to distinct UUIDs", () => {
  const identities = identity.getCreationInventoryIdentityMap([
    {
      listing_batch_breed: { id: "batch-breed-1" },
      inventory_items: [
        { client_row_token: "row-a", id: "inventory-a" },
        { client_row_token: "row-b", id: "inventory-b" },
      ],
    },
  ]);
  const persisted = identity.applyInventoryIdentityMap(
    duplicateOfferings,
    identities,
  );

  assert.deepEqual(
    persisted.map((row) => [row.id, row.inventoryItemId]),
    [
      ["row-a", "inventory-a"],
      ["row-b", "inventory-b"],
    ],
  );

  const pendingPhotos = { "row-a": "photo-a", "row-b": "photo-b" };
  const photoTargets = persisted.map((row) => [
    pendingPhotos[row.id],
    row.inventoryItemId,
  ]);
  assert.deepEqual(photoTargets, [
    ["photo-a", "inventory-a"],
    ["photo-b", "inventory-b"],
  ]);
});

test("saved-draft reconciliation uses an exact UUID before semantic fields", () => {
  const rows = [
    {
      custom_inventory_label: null,
      inventory_item_id: "inventory-a",
      inventory_type: "female",
      seller_breed_profile_id: "profile-1",
    },
    {
      custom_inventory_label: null,
      inventory_item_id: "inventory-b",
      inventory_type: "female",
      seller_breed_profile_id: "profile-1",
    },
  ];

  const exact = identity.resolveDraftInventoryRow({
    customInventoryLabel: null,
    inventoryItemId: "inventory-b",
    inventoryType: "female",
    rows,
    sellerBreedProfileId: "profile-1",
    unavailableInventoryIds: new Set(["inventory-a", "inventory-b"]),
  });
  assert.equal(exact.kind, "exact");
  assert.equal(exact.row.inventory_item_id, "inventory-b");

  const missingExact = identity.resolveDraftInventoryRow({
    customInventoryLabel: null,
    inventoryItemId: "inventory-missing",
    inventoryType: "female",
    rows,
    sellerBreedProfileId: "profile-1",
    unavailableInventoryIds: new Set(),
  });
  assert.equal(missingExact.kind, "none");
  assert.equal(missingExact.row, null);

  const ambiguous = identity.resolveDraftInventoryRow({
    customInventoryLabel: null,
    inventoryItemId: null,
    inventoryType: "female",
    rows,
    sellerBreedProfileId: "profile-1",
    unavailableInventoryIds: new Set(),
  });
  assert.equal(ambiguous.kind, "ambiguous");
  assert.equal(ambiguous.row, null);
});

test("cart identity remains inventory UUID based for semantic duplicates", () => {
  assert.notEqual(
    cart.cartItemKey({ itemId: "inventory-a", itemType: "listing_inventory" }),
    cart.cartItemKey({ itemId: "inventory-b", itemType: "listing_inventory" }),
  );
});

test("normal Edit keeps persisted writes and removal keyed by inventory UUID", () => {
  const source = readFileSync(
    resolve(root, "app/dashboard/inventory/add-v2/live-birds/page.tsx"),
    "utf8",
  );

  assert.match(source, /p_inventory_item_id: currentRow\.inventory_item_id/);
  assert.match(source, /p_inventory_item_ids: inventoryItemIdsToDelete/);
  assert.match(source, /entityId: offering\.inventoryItemId/);
  assert.match(source, /p_inventory_item_id: rowToUpdate\.inventory_item_id/);
  assert.doesNotMatch(source, /getOfferingPersistenceKey|getDraftRowOfferingKey/);
});
