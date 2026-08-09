import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const sourceUrl = new URL(`../${specifier.slice(2)}.ts`, import.meta.url);
      return nextResolve(sourceUrl.href, context);
    }

    return nextResolve(specifier, context);
  },
});

const {
  buildStoreEmbedLink,
  normalizeStorefrontVisibility,
  resolveStorefrontVisibilityDecision,
  shouldNoIndexStorefrontRoute,
} = await import("../lib/storefront-visibility.ts");

const websiteUrl = "https://www.example.com/shop/path?source=site#birds";
const focusedQuery = { orderMode: "embed", return: websiteUrl };

test("existing and new stores default to public visibility", async () => {
  assert.equal(normalizeStorefrontVisibility(undefined), "public");
  assert.equal(normalizeStorefrontVisibility("unexpected"), "public");

  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260809130000_store_visibility_and_embed_links.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    migration,
    /storefront_visibility public\.storefront_visibility not null default 'public'/,
  );
  assert.match(migration, /enum \('public', 'embed_only'\)/);
});

test("public stores allow ordinary and validated embedded ordering", () => {
  assert.deepEqual(
    resolveStorefrontVisibilityDecision({
      isPubliclyAvailable: true,
      searchParams: {},
      storeSlug: "meadow-farm",
      visibility: "public",
      websiteUrl,
    }),
    { action: "allow", orderMode: null },
  );

  const embedded = resolveStorefrontVisibilityDecision({
    isPubliclyAvailable: true,
    searchParams: focusedQuery,
    storeSlug: "meadow-farm",
    visibility: "public",
    websiteUrl,
  });
  assert.equal(embedded.action, "allow");
  assert.equal(embedded.orderMode?.returnUrl, websiteUrl);
});

test("embed-only stores allow valid focused routes and redirect ordinary visits", () => {
  const focused = resolveStorefrontVisibilityDecision({
    isPubliclyAvailable: true,
    searchParams: focusedQuery,
    storeSlug: "meadow-farm",
    visibility: "embed_only",
    websiteUrl,
  });
  assert.equal(focused.action, "allow");
  assert.equal(focused.orderMode?.storeSlug, "meadow-farm");

  assert.deepEqual(
    resolveStorefrontVisibilityDecision({
      isPubliclyAvailable: true,
      searchParams: {},
      storeSlug: "meadow-farm",
      visibility: "embed_only",
      websiteUrl,
    }),
    { action: "redirect", orderMode: null, url: websiteUrl },
  );
});

test("closed-store availability remains authoritative over every visibility mode", () => {
  for (const visibility of ["public", "embed_only"]) {
    assert.deepEqual(
      resolveStorefrontVisibilityDecision({
        isPubliclyAvailable: false,
        searchParams: focusedQuery,
        storeSlug: "meadow-farm",
        visibility,
        websiteUrl,
      }),
      { action: "deny", orderMode: null },
    );
  }
});

test("invalid, missing, altered, and cross-store context cannot bypass embed-only visibility", () => {
  for (const searchParams of [
    {},
    { orderMode: "embed" },
    { orderMode: "ordinary", return: websiteUrl },
    { orderMode: "embed", return: "https://www.example.net/other" },
    { orderMode: "embed", return: "http://www.example.com/unsafe" },
  ]) {
    const decision = resolveStorefrontVisibilityDecision({
      isPubliclyAvailable: true,
      searchParams,
      storeSlug: "meadow-farm",
      visibility: "embed_only",
      websiteUrl,
    });
    assert.notEqual(decision.action, "allow");
  }

  assert.equal(
    resolveStorefrontVisibilityDecision({
      isPubliclyAvailable: true,
      searchParams: focusedQuery,
      storeSlug: "other-store",
      visibility: "embed_only",
      websiteUrl: "https://other.example.com/store",
    }).action,
    "redirect",
  );

  assert.deepEqual(
    resolveStorefrontVisibilityDecision({
      isPubliclyAvailable: true,
      searchParams: focusedQuery,
      storeSlug: "meadow-farm",
      visibility: "embed_only",
      websiteUrl: null,
    }),
    { action: "deny", orderMode: null },
  );
});

test("embed links encode Website URL paths, queries, and fragments", () => {
  const link = buildStoreEmbedLink({
    slug: "meadow farm/unsafe",
    websiteUrl,
  });
  assert.ok(link);
  const parsed = new URL(link);
  assert.equal(parsed.origin, "https://www.flockfront.com");
  assert.equal(parsed.pathname, "/embed/store/meadow%20farm%2Funsafe");
  assert.equal(parsed.searchParams.get("orderMode"), "embed");
  assert.equal(parsed.searchParams.get("return"), websiteUrl);
  assert.match(link, /return=https%3A%2F%2Fwww\.example\.com%2Fshop%2Fpath%3Fsource%3Dsite%23birds/);
});

test("www and apex origins remain distinct", () => {
  const decision = resolveStorefrontVisibilityDecision({
    isPubliclyAvailable: true,
    searchParams: {
      orderMode: "embed",
      return: "https://example.com/shop",
    },
    storeSlug: "meadow-farm",
    visibility: "embed_only",
    websiteUrl: "https://www.example.com/shop",
  });
  assert.equal(decision.action, "redirect");
});

test("focused and embed-only routes are noindex while ordinary public routes retain SEO", () => {
  assert.equal(
    shouldNoIndexStorefrontRoute({
      searchParams: {},
      storeSlug: "meadow-farm",
      visibility: "public",
      websiteUrl,
    }),
    false,
  );
  assert.equal(
    shouldNoIndexStorefrontRoute({
      searchParams: focusedQuery,
      storeSlug: "meadow-farm",
      visibility: "public",
      websiteUrl,
    }),
    true,
  );
  assert.equal(
    shouldNoIndexStorefrontRoute({
      searchParams: {},
      storeSlug: "meadow-farm",
      visibility: "embed_only",
      websiteUrl,
    }),
    true,
  );
});

test("database and route contracts cover fail-closed configuration, status, discovery, and every listing family", async () => {
  const [migration, sitemap, embed, product, equipment, processed, cart, checkout] =
    await Promise.all([
      readFile(
        new URL(
          "../supabase/migrations/20260809130000_store_visibility_and_embed_links.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/embed/store/[slug]/page.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/store/[slug]/products/[productId]/page.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/store/[slug]/equipment/[equipmentItemId]/page.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/store/[slug]/processed-poultry/[processedPoultryItemId]/page.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../app/store/[slug]/cart/page.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../app/store/[slug]/checkout/page.tsx", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(migration, /stores_embed_only_requires_https_website_check/);
  assert.match(migration, /get_storefront_public_status/);
  assert.match(migration, /public_discoverable_storefronts/);
  assert.match(migration, /public_discoverable_inventory/);
  assert.match(sitemap, /publicStoreSlugs\.has/);
  assert.match(embed, /resolveEmbeddedOrderModeContext/);

  for (const source of [product, equipment, processed, cart, checkout]) {
    assert.match(source, /loadStorefrontAccess/);
    assert.match(source, /resolveStorefrontVisibilityDecision/);
  }

  assert.match(product, /loadStorefrontHatchingEggInventory/);
  assert.match(product, /loadStorefrontInventory/);
  assert.match(checkout, /visibilityDecision\.orderMode/);
});

test("Store Admin presents conditional Website URL guidance without changing visibility behavior", async () => {
  const source = await readFile(
    new URL("../app/dashboard/store-admin/store-admin.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Store Visibility and Embed Links/);
  assert.match(source, /Public FlockFront storefront/);
  assert.match(source, /type="radio"/);
  assert.match(
    source,
    /form\.storefront_visibility === "embed_only" &&[\s\S]*!hasValidSavedWebsite \? \([\s\S]*Add and save your Website URL before hiding your public[\s\S]*FlockFront storefront\. This gives customers a safe way to return[\s\S]*to your website after ordering\./,
  );
  assert.match(
    source,
    /form\.storefront_visibility === "embed_only"[\s\S]*\? "Website URL \(required\)"[\s\S]*: "Website URL"/,
  );
  assert.match(source, /optional=\{form\.storefront_visibility === "public"\}/);
  assert.match(
    source,
    /Enter the full address of the page where your embedded store appears, including https:\/\/\. Customers will return to this page after ordering\./,
  );
  assert.match(
    source,
    /Add this link to your website using an ‘Embed a Site,’ iframe, or custom embed tool\. Your inventory will update automatically whenever you make changes in FlockFront\./,
  );
  assert.doesNotMatch(source, /This requirement fails closed/);
  assert.doesNotMatch(source, /order-and-return embed link can be generated/);
  assert.match(source, /seller_update_store_visibility/);
  assert.doesNotMatch(source, /getPlanCapabilities[\s\S]{0,500}storefront_visibility/);
});
