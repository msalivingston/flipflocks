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
const listingTabsPath =
  "app/store/[slug]/storefront-listing-tabs.tsx";

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
      getNonEmptyStorefrontListingSections: () => [],
    },
    "@/lib/seo-config": { NOINDEX_ROBOTS: { index: false } },
    "@/lib/embedded-order-mode": {
      resolveEmbeddedOrderModeContext: () => null,
    },
    "./embed-inventory-gallery": {
      EmbedInventoryGallery: function EmbedInventoryGallery() {},
    },
    "next/navigation": { notFound: () => assert.fail("unexpected 404") },
    "react/jsx-runtime": jsxRuntime,
  });

  const rendered = await page.default({
    params: Promise.resolve({ slug: "sunshine-mesa-farm" }),
    searchParams: Promise.resolve({}),
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
      getNonEmptyStorefrontListingSections: () => [],
    },
    "@/lib/seo-config": { NOINDEX_ROBOTS: { index: false } },
    "@/lib/embedded-order-mode": {
      resolveEmbeddedOrderModeContext: () => null,
    },
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
    page.default({
      params: Promise.resolve({ slug: "not-a-public-store" }),
      searchParams: Promise.resolve({}),
    }),
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
  const listingCards = await loadListingCardsModule();
  const sections = buildListingFixture(listingCards);
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

test("the embed category list keeps storefront ordering and removes empty public categories", async () => {
  const listingCards = await loadListingCardsModule();
  const sections = buildListingFixture(listingCards, {
    hatchingEggProducts: [],
    processedPoultry: [],
  });
  const visibleSections =
    listingCards.getNonEmptyStorefrontListingSections(sections);

  assert.deepEqual(
    visibleSections.map((section) => [section.id, section.label]),
    [
      ["live-poultry", "Live Birds"],
      ["equipment-supplies", "Equipment & Supplies"],
    ],
  );
  assert.ok(visibleSections.every((section) => section.cards.length > 0));
});

test("category selection and the existing search and filters limit embed listings", async () => {
  const listingCards = await loadListingCardsModule();
  const listingTabs = await loadListingTabsModule();
  const liveCards = [
    filterCard({
      ageFilterDays: [56],
      batchFilters: [{ ageFilterDays: 56, availabilityCode: "ready_now" }],
      breedFilter: "Production Red",
      href: "/store/sunshine-mesa-farm/products/red",
      price: "From $21.00",
      title: "Production Red",
    }),
    filterCard({
      ageFilterDays: [140],
      availabilityCode: "reserve_now",
      batchFilters: [{ ageFilterDays: 140, availabilityCode: "reserve_now" }],
      breedFilter: "Barred Rock",
      href: "/store/sunshine-mesa-farm/products/rock",
      price: "$15.00",
      title: "Barred Rock",
    }),
  ];
  const sections = [
    storefrontSection("live-poultry", "Live Birds", liveCards),
    storefrontSection("equipment-supplies", "Equipment & Supplies", [
      filterCard({
        categoryFilter: "Feeders",
        conditionFilter: "Used",
        href: "/store/sunshine-mesa-farm/equipment/feeder",
        meta: "Feeders - Used",
        price: "$5.00",
        speciesFilter: null,
        title: "Feeder",
      }),
    ]),
  ];
  const visibleSections =
    listingCards.getNonEmptyStorefrontListingSections(sections);
  const equipmentSection = visibleSections.find(
    (section) => section.id === "equipment-supplies",
  );
  const allFilters = clearedFilters();

  assert.deepEqual(
    listingTabs
      .filterStorefrontListingCards(equipmentSection.cards, allFilters)
      .map((card) => card.title),
    ["Feeder"],
  );
  assert.deepEqual(
    listingTabs
      .filterStorefrontListingCards(liveCards, {
        ...allFilters,
        age: "2-12-weeks",
        availability: "ready_now",
        breed: "Production Red",
        price: "10-25",
        query: "red",
        species: "Chicken",
      })
      .map((card) => card.title),
    ["Production Red"],
  );
});

test("clearing embed filters restores every listing in the selected category", async () => {
  const listingTabs = await loadListingTabsModule();
  const cards = [
    filterCard({ href: "/store/example/products/one", title: "One" }),
    filterCard({ href: "/store/example/products/two", title: "Two" }),
  ];

  assert.equal(
    listingTabs.filterStorefrontListingCards(cards, {
      ...clearedFilters(),
      query: "one",
    }).length,
    1,
  );
  assert.deepEqual(
    listingTabs
      .filterStorefrontListingCards(cards, clearedFilters())
      .map((card) => card.title),
    ["One", "Two"],
  );
});

test("the embed reuses storefront controls while omitting storefront chrome and private seller fields", async () => {
  const [route, gallery, listingTabs] = await Promise.all([
    read(routePath),
    read(galleryPath),
    read(listingTabsPath),
  ]);
  const source = `${route}\n${gallery}`;

  for (const forbidden of [
    "StorefrontChrome",
    "StorefrontHero",
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
  assert.match(
    gallery,
    /<StorefrontListingTabs[\s\S]*orderMode=\{orderMode\}[\s\S]*sections=\{sections\}[\s\S]*variant="embed"/,
  );
  assert.match(listingTabs, /target=\{isEmbed \? "_blank" : undefined\}/);
  assert.match(listingTabs, /rel=\{isEmbed \? "noopener noreferrer" : undefined\}/);
  assert.match(listingTabs, /isEmbed \? "View & order" : "View"/);
  assert.match(route, /Powered by FlockFront/);
  assert.doesNotMatch(gallery, /[a-z]+_(?:id|at)\b/);
});

test("mobile category and filter controls stay compact and contain horizontal overflow", async () => {
  const [route, gallery, listingTabs] = await Promise.all([
    read(routePath),
    read(galleryPath),
    read(listingTabsPath),
  ]);

  assert.match(route, /w-full max-w-full overflow-x-hidden/);
  assert.match(gallery, /variant="embed"/);
  assert.match(listingTabs, /isEmbed[\s\S]*?lg:flex lg:flex-wrap/);
  assert.match(listingTabs, /className="lg:hidden"/);
  assert.match(listingTabs, /<MobileSheet[\s\S]*label="Choose department"/);
  assert.match(listingTabs, /<MobileSheet[\s\S]*label="Filter listings"/);
  assert.match(listingTabs, /max-h-\[82vh\]/);
  assert.match(listingTabs, /overflow-y-auto/);
  assert.match(listingTabs, /min-w-0/);
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
  assert.doesNotMatch(homeContent, /variant="embed"/);
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

async function loadListingCardsModule() {
  return loadTypeScriptModule(listingCardsPath, {
    "@/lib/public-listing-url": { buildPublicListingPath },
    "./storefront-data": {
      formatCurrency: (value) => `$${Number(value).toFixed(2)}`,
      groupHatchingEggInventoryByProduct: (items) => items,
      groupInventoryByProduct: (items) => items,
    },
  });
}

async function loadListingTabsModule() {
  return loadTypeScriptModule(listingTabsPath, {
    "./storefront-category-symbols": {},
    "./storefront-fonts": {},
    "./storefront-ui": {},
    "@/lib/embedded-order-mode": {
      buildEmbeddedOrderModeHref: (href) => href,
    },
    "lucide-react": {},
    "next/link": {},
    react: {},
    "react/jsx-runtime": jsxRuntime,
  });
}

function buildListingFixture(
  listingCards,
  overrides = {},
) {
  return listingCards.buildStorefrontListingSections({
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
    ...overrides,
  });
}

function storefrontSection(id, label, cards) {
  return {
    cards,
    description: "",
    emptyDescription: "",
    emptyTitle: "",
    id,
    label,
  };
}

function filterCard(overrides) {
  return {
    ageFilterDays: [56],
    availabilityCode: "ready_now",
    availabilityLabel: "Available",
    batchFilters: undefined,
    breedFilter: "Example Breed",
    categoryFilter: null,
    conditionFilter: null,
    description: "Public listing",
    detail: "1 available",
    href: "/store/example/products/example",
    imageAlt: "Example",
    imageUrl: null,
    meta: "Chicken",
    price: "$12.00",
    speciesFilter: "Chicken",
    title: "Example",
    typeLabel: "Live Birds",
    ...overrides,
  };
}

function clearedFilters() {
  return {
    age: "all",
    availability: "all",
    breed: "all",
    category: "all",
    condition: "all",
    price: "all",
    query: "",
    species: "all",
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
