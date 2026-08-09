import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { buildPublicListingPath } from "../lib/public-listing-url.ts";

const repositoryRoot = new URL("../", import.meta.url);

const routePath = "app/embed/store/[slug]/page.tsx";
const galleryPath =
  "app/embed/store/[slug]/embed-inventory-gallery.tsx";
const listingCardsPath =
  "app/store/[slug]/storefront-listing-cards.ts";

test("the embed route loads a valid public store through the shared public data path", async () => {
  const calls = [];
  const page = await loadTypeScriptModule(routePath, {
    "@/app/store/[slug]/storefront-data": {
      async loadPublicStorefrontListingData(slug) {
        calls.push(["listings", slug]);
        return { data: emptyListingData(), error: null };
      },
      async loadStorefrontHome(slug) {
        calls.push(["store", slug]);
        return {
          data: { store_slug: slug, store_name: "Public Farm" },
          error: null,
        };
      },
    },
    "@/app/store/[slug]/storefront-listing-cards": {
      buildStorefrontListingSectionsFromPublicData: () => [],
      flattenStorefrontListingSections: () => [],
    },
    "@/lib/seo-config": { NOINDEX_ROBOTS: { index: false } },
    "./embed-inventory-gallery": {
      EmbedInventoryGallery: function EmbedInventoryGallery() {},
    },
    "next/navigation": { notFound: () => assert.fail("unexpected 404") },
    "react/jsx-runtime": jsxRuntime,
  });

  const rendered = await page.default({
    params: Promise.resolve({ slug: "sunshine-mesa-farm" }),
  });

  assert.ok(rendered);
  assert.deepEqual(calls.sort(), [
    ["listings", "sunshine-mesa-farm"],
    ["store", "sunshine-mesa-farm"],
  ]);
});

test("an invalid or unavailable public store slug terminates with a safe 404", async () => {
  const notFoundError = new Error("NOT_FOUND");
  const page = await loadTypeScriptModule(routePath, {
    "@/app/store/[slug]/storefront-data": {
      async loadPublicStorefrontListingData() {
        return { data: emptyListingData(), error: null };
      },
      async loadStorefrontHome() {
        return { data: null, error: null };
      },
    },
    "@/app/store/[slug]/storefront-listing-cards": {
      buildStorefrontListingSectionsFromPublicData: () => [],
      flattenStorefrontListingSections: () => [],
    },
    "@/lib/seo-config": { NOINDEX_ROBOTS: { index: false } },
    "./embed-inventory-gallery": {
      EmbedInventoryGallery: function EmbedInventoryGallery() {},
    },
    "next/navigation": {
      notFound() {
        throw notFoundError;
      },
    },
    "react/jsx-runtime": jsxRuntime,
  });

  await assert.rejects(
    page.default({ params: Promise.resolve({ slug: "not-a-public-store" }) }),
    (error) => error === notFoundError,
  );
});

test("draft, archived, moderated, and otherwise non-public inventory stays behind the existing public projections", async () => {
  const [route, data, projection] = await Promise.all([
    read(routePath),
    read("app/store/[slug]/storefront-data.ts"),
    read(
      "supabase/migrations/20260730120000_fail_safe_store_plan_capabilities.sql",
    ),
  ]);

  assert.match(route, /loadPublicStorefrontListingData\(slug\)/);
  assert.doesNotMatch(route, /publicSupabase|supabase|dashboard|auth\./i);

  for (const loader of [
    "loadStorefrontInventory",
    "loadStorefrontEquipment",
    "loadStorefrontHatchingEggInventory",
    "loadStorefrontProcessedPoultry",
    "loadStorefrontProfileImages",
  ]) {
    assert.match(data, new RegExp(`${loader}\\([\\s\\S]{0,30}slug`));
  }

  for (const predicate of [
    "listing_batches.visibility_status in ('active', 'sold_out')",
    "listing_batch_breeds.visibility_status = 'active'",
    "seller_breed_profiles.visibility_status = 'active'",
    "inventory_items.visibility_status = 'active'",
    "equipment_inventory_items.visibility_status = 'active'",
    "processed_items.visibility_status = 'active'",
    "hatching_items.visibility_status = 'active'",
    "hatching_items.archived_at is null",
    "moderation_status = 'normal'",
  ]) {
    assert.ok(projection.includes(predicate), predicate);
  }
});

test("embed cards use the exact canonical hosted listing paths for every public listing type", async () => {
  const listingCards = await loadTypeScriptModule(listingCardsPath, {
    "@/lib/public-listing-url": { buildPublicListingPath },
    "./storefront-data": {
      formatCurrency: (value) => `$${Number(value).toFixed(2)}`,
      groupHatchingEggInventoryByProduct: (items) => items,
      groupInventoryByProduct: (items) => items,
    },
  });
  const sections = listingCards.buildStorefrontListingSections({
    equipment: [
      {
        buyer_availability_code: "ready_now",
        category: "Coops",
        condition: "Used",
        description: null,
        equipment_inventory_item_id: "equipment-1",
        featured_image_alt_text: null,
        featured_image_url: null,
        item_name: "Small coop",
        quantity_available: 1,
        store_slug: "sunshine-mesa-farm",
        unit_price: 125,
      },
    ],
    hatchingEggProducts: [product("eggs-1", "hatching_egg_inventory")],
    livePoultryProducts: [product("breed-1", "listing_inventory")],
    processedPoultry: [
      {
        buyer_availability_code: "ready_now",
        description: null,
        featured_image_alt_text: null,
        featured_image_url: null,
        package_size: "Whole bird",
        poultry_type: "Chicken",
        processed_poultry_inventory_item_id: "processed-1",
        product_name: "Whole chicken",
        product_type: "Whole",
        quantity_available: 2,
        store_slug: "sunshine-mesa-farm",
        unit_price: 30,
      },
    ],
  });
  const cards = listingCards.flattenStorefrontListingSections(sections);

  assert.deepEqual(
    cards.map((card) => card.href),
    [
      "/store/sunshine-mesa-farm/products/breed-1",
      "/store/sunshine-mesa-farm/products/eggs-1",
      "/store/sunshine-mesa-farm/processed-poultry/processed-1",
      "/store/sunshine-mesa-farm/equipment/equipment-1",
    ],
  );
});

test("the embed omits ordinary storefront chrome and private seller fields", async () => {
  const [route, gallery] = await Promise.all([read(routePath), read(galleryPath)]);
  const source = `${route}\n${gallery}`;

  for (const forbidden of [
    "StorefrontChrome",
    "StorefrontHero",
    "StorefrontListingTabs",
    "public_email",
    "public_phone",
    "pickup_policy",
    "about_text",
    "Dashboard",
    "Login",
    "Cart",
    "<header",
    "<nav",
    "<footer",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "i"), forbidden);
  }
  assert.match(gallery, /target="_blank"/);
  assert.match(gallery, /rel="noopener noreferrer"/);
  assert.match(gallery, /View &amp; order/);
  assert.match(route, /Powered by FlockFront/);
  assert.doesNotMatch(gallery, /[a-z]+_(?:id|at)\b/);
});

test("the gallery uses fluid breakpoints and explicitly contains horizontal overflow", async () => {
  const [route, gallery] = await Promise.all([read(routePath), read(galleryPath)]);

  assert.match(route, /w-full max-w-full overflow-x-hidden/);
  assert.match(gallery, /grid-cols-1/);
  assert.match(gallery, /min-\[440px\]:grid-cols-2/);
  assert.match(gallery, /min-\[820px\]:grid-cols-3/);
  assert.match(gallery, /min-w-0/);
  assert.doesNotMatch(gallery, /(?:^|\s)w-\[\d+(?:px|rem)\]/);
});

test("framing is same-origin by default and HTTPS-only for the embed route", async () => {
  const launched = await loadTypeScriptModule("next.config.ts", {
    "./lib/seo-config": { INDEXING_ENABLED: true },
  });
  const headers = await launched.default.headers();

  assert.deepEqual(headers[0], {
    headers: [
      {
        key: "Content-Security-Policy",
        value: "frame-ancestors 'self'",
      },
    ],
    source: "/:path*",
  });
  assert.deepEqual(headers.at(-1), {
    headers: [
      {
        key: "Content-Security-Policy",
        value: "frame-ancestors https:",
      },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ],
    source: "/embed/store/:slug",
  });
});

test("the ordinary storefront consumes the same listing data and card builder", async () => {
  const [page, homeContent] = await Promise.all([
    read("app/store/[slug]/page.tsx"),
    read("app/store/[slug]/storefront-home-content.tsx"),
  ]);

  assert.match(page, /loadPublicStorefrontListingData\(slug\)/);
  assert.match(
    homeContent,
    /buildStorefrontListingSectionsFromPublicData\(\{/,
  );
  assert.match(homeContent, /<StorefrontChrome/);
  assert.match(homeContent, /<StorefrontListingTabs sections=\{listingSections\}/);
});

function product(productId, productSource) {
  return {
    availabilityCode: "ready_now",
    batchType:
      productSource === "hatching_egg_inventory" ? "hatching_eggs" : "live",
    description: null,
    imageAlt: null,
    imageUrl: null,
    name: productId,
    options: [
      {
        ageFilterDays: 56,
        buyerAvailabilityCode: "ready_now",
        canCheckout: true,
        quantityAvailable: 2,
      },
    ],
    pricingLabel: "$12.00",
    productId,
    productSource,
    quantityLabel: "2 available",
    speciesName: "Chicken",
    storeSlug: "sunshine-mesa-farm",
    totalQuantityAvailable: 2,
  };
}

function emptyListingData() {
  return {
    equipment: [],
    hatchingEggs: [],
    inventory: [],
    livePoultryProfileImages: {},
    processedPoultry: [],
  };
}

const jsxRuntime = {
  Fragment: Symbol("Fragment"),
  jsx(type, props, key) {
    return { key, props, type };
  },
  jsxs(type, props, key) {
    return { key, props, type };
  },
};

async function read(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), "utf8");
}

async function loadTypeScriptModule(relativePath, stubs) {
  const source = await read(relativePath);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: relativePath,
  }).outputText;
  const loadedModule = { exports: {} };
  const require = (specifier) => {
    if (specifier in stubs) return stubs[specifier];
    throw new Error(`Unexpected test import: ${specifier}`);
  };

  new Function("require", "module", "exports", compiled)(
    require,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}
