import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const repositoryRoot = new URL("../", import.meta.url);
const cartClientPath =
  "app/store/[slug]/_components/storefront-cart-client.ts";

test("an embedded cart survives iframe destruction and recreation in the same browser storage partition", async () => {
  const cartClient = await loadTypeScriptModule(cartClientPath);
  const partitionedStorage = createMemoryStorage();
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;

  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.detail = init.detail;
      this.type = type;
    }
  };

  try {
    globalThis.window = createEmbedWindow(partitionedStorage);

    const finalAvailableUnit = {
      ageLabel: "18 weeks",
      availableDate: "2026-08-13",
      imageUrl: null,
      inventoryItemId: "inventory-final-unit",
      itemId: "inventory-final-unit",
      itemType: "listing_inventory",
      optionLabel: "Female",
      productId: "ancona",
      productName: "Ancona",
      quantity: 1,
      quantityAvailable: 1,
      speciesName: "Chicken",
      typeLabel: "Live Birds",
      unitPrice: 12,
    };

    const created = cartClient.addItemsToStorefrontCart(
      "sunshine-mesa-farm",
      [finalAvailableUnit],
    );
    assert.equal(created.items.length, 1);
    assert.equal(created.items[0].quantity, 1);

    delete globalThis.window;
    globalThis.window = createEmbedWindow(partitionedStorage);

    const restored = cartClient.readStorefrontCart("sunshine-mesa-farm");
    assert.deepEqual(restored.items, [finalAvailableUnit]);
    assert.equal(partitionedStorage.length, 1, "one seller cart is persisted");

    const reread = cartClient.readStorefrontCart("sunshine-mesa-farm");
    assert.deepEqual(reread, restored, "restoring does not create another cart");
    assert.equal(partitionedStorage.length, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;

    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  }
});

test("embedded product navigation stays inside the iframe while the seller return exits at the top level", async () => {
  const [listingTabs, shell] = await Promise.all([
    read("app/store/[slug]/storefront-listing-tabs.tsx"),
    read("app/store/[slug]/storefront-shell-components.tsx"),
  ]);
  const listingCard = listingTabs.slice(
    listingTabs.indexOf("function ListingCard"),
  );

  assert.match(listingCard, /const href = buildEmbeddedOrderModeHref\(card\.href, orderMode\)/);
  assert.doesNotMatch(listingCard, /target=\{isEmbed \? "_top"/);
  assert.match(
    shell,
    /href=\{orderMode\.returnUrl\}[\s\S]*?target="_top"[\s\S]*?Back to \{store\.store_name\}/,
  );
});

function createEmbedWindow(localStorage) {
  return {
    dispatchEvent() {},
    localStorage,
  };
}

function createMemoryStorage() {
  const values = new Map();

  return {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

async function read(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), "utf8");
}

async function loadTypeScriptModule(relativePath) {
  const source = await read(relativePath);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: relativePath,
  }).outputText;
  const loadedModule = { exports: {} };

  new Function("module", "exports", compiled)(
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}
