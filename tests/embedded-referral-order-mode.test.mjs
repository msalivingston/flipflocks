import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildEmbeddedOrderModeHref,
  embeddedOrderModeWebsiteUrlMaxLength,
  resolveEmbeddedOrderModeContext,
  validateSellerWebsiteUrl,
} from "../lib/embedded-order-mode.ts";

const repositoryRoot = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, repositoryRoot), "utf8");
const safeWebsite = "https://www.sunshinemesafarm.com/our-farm";
const safeReturn =
  "https://www.sunshinemesafarm.com/purchase-chickens?source=flockfront#inventory";

test("the seller Website URL accepts, normalizes, and preserves safe HTTPS URLs", () => {
  assert.deepEqual(validateSellerWebsiteUrl(""), { ok: true, value: null });
  assert.deepEqual(validateSellerWebsiteUrl("   "), { ok: true, value: null });
  assert.deepEqual(validateSellerWebsiteUrl("  https://Example.com/farm  "), {
    ok: true,
    value: "https://example.com/farm",
  });
  assert.equal(
    validateSellerWebsiteUrl("https://www.example.com").value,
    "https://www.example.com/",
  );
  assert.equal(
    validateSellerWebsiteUrl("https://example.com").value,
    "https://example.com/",
  );
});

test("the seller Website URL rejects unsafe or malformed values", () => {
  const invalidValues = [
    "http://example.com",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://user:secret@example.com",
    "//example.com/path",
    "https://[",
    "https://example.com\\redirect",
    "https://example.com/\nredirect",
    `https://example.com/${"a".repeat(embeddedOrderModeWebsiteUrlMaxLength)}`,
  ];

  for (const value of invalidValues) {
    assert.equal(validateSellerWebsiteUrl(value).ok, false, value);
  }
});

test("matching configured and return origins produce validated order mode", () => {
  assert.deepEqual(
    resolveEmbeddedOrderModeContext({
      searchParams: { orderMode: "embed", return: safeReturn },
      storeSlug: "sunshine-mesa-farm",
      websiteUrl: safeWebsite,
    }),
    {
      mode: "embed",
      returnUrl: safeReturn,
      storeSlug: "sunshine-mesa-farm",
    },
  );
});

test("missing, invalid, or mismatched website configuration fails closed", () => {
  for (const websiteUrl of [
    null,
    "",
    "http://www.sunshinemesafarm.com",
    "https://user:secret@www.sunshinemesafarm.com",
    "not a URL",
  ]) {
    assert.equal(
      resolveEmbeddedOrderModeContext({
        searchParams: { orderMode: "embed", return: safeReturn },
        storeSlug: "sunshine-mesa-farm",
        websiteUrl,
      }),
      null,
      String(websiteUrl),
    );
  }
});

test("unsafe return candidates and mode flags fail closed", () => {
  const candidates = [
    "https://attacker.example/purchase-chickens",
    "https://sunshinemesafarm.com/purchase-chickens",
    "http://www.sunshinemesafarm.com/purchase-chickens",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://user:secret@www.sunshinemesafarm.com/path",
    "//www.sunshinemesafarm.com/path",
    "https://[",
    "https://www.sunshinemesafarm.com\\redirect",
    "https://www.sunshinemesafarm.com/\u0000redirect",
    "https://www.sunshinemesafarm.com:8443/path",
    `https://www.sunshinemesafarm.com/${"a".repeat(
      embeddedOrderModeWebsiteUrlMaxLength,
    )}`,
  ];

  for (const candidate of candidates) {
    assert.equal(
      resolveEmbeddedOrderModeContext({
        searchParams: { orderMode: "embed", return: candidate },
        storeSlug: "sunshine-mesa-farm",
        websiteUrl: safeWebsite,
      }),
      null,
      candidate,
    );
  }

  assert.equal(
    resolveEmbeddedOrderModeContext({
      searchParams: { orderMode: "ordinary", return: safeReturn },
      storeSlug: "sunshine-mesa-farm",
      websiteUrl: safeWebsite,
    }),
    null,
  );
});

test("validated context is appended to every embedded listing route family", () => {
  const context = resolveEmbeddedOrderModeContext({
    searchParams: { orderMode: "embed", return: safeReturn },
    storeSlug: "sunshine-mesa-farm",
    websiteUrl: safeWebsite,
  });
  const listingPaths = [
    "/store/sunshine-mesa-farm/products/product-1",
    "/store/sunshine-mesa-farm/equipment/equipment-1",
    "/store/sunshine-mesa-farm/processed-poultry/poultry-1",
  ];

  for (const path of listingPaths) {
    const href = buildEmbeddedOrderModeHref(path, context);
    const parsed = new URL(href, "https://www.flockfront.com");

    assert.equal(parsed.pathname, path);
    assert.equal(parsed.searchParams.get("orderMode"), "embed");
    assert.equal(parsed.searchParams.get("return"), safeReturn);
  }

  assert.equal(
    buildEmbeddedOrderModeHref(
      "/store/another-farm/products/product-1",
      context,
    ),
    "/store/another-farm/products/product-1",
  );
  assert.equal(buildEmbeddedOrderModeHref(listingPaths[0], null), listingPaths[0]);
});

test("Store Admin renders and validates the existing Website URL field", async () => {
  const source = await read("app/dashboard/store-admin/store-admin.tsx");

  assert.match(source, /\? "Website URL \(required\)"[\s\S]*: "Website URL"/);
  assert.match(
    source,
    /Enter the full address of the page where your embedded store appears, including https:\/\/\. Customers will return to this page after ordering\./,
  );
  assert.match(source, /onUpdateField\("website_url", value\)/);
  assert.match(source, /type="url"/);
  assert.match(source, /p_website_url: websiteUrlResult\.value/);
  assert.match(source, /website_url: websiteUrlResult\.value \?\? ""/);
  assert.match(source, /validateSellerWebsiteUrl\(form\.website_url\)/);
});

test("each public server route independently reconstructs validated context", async () => {
  const routePaths = [
    "app/embed/store/[slug]/page.tsx",
    "app/store/[slug]/products/[productId]/page.tsx",
    "app/store/[slug]/equipment/[equipmentItemId]/page.tsx",
    "app/store/[slug]/processed-poultry/[processedPoultryItemId]/page.tsx",
    "app/store/[slug]/cart/page.tsx",
    "app/store/[slug]/checkout/page.tsx",
  ];

  for (const routePath of routePaths) {
    const source = await read(routePath);

    assert.match(
      source,
      /searchParams: Promise<EmbeddedOrderModeSearchParams(?:\s*&|>)/,
      routePath,
    );
    if (routePath.startsWith("app/embed/")) {
      assert.match(source, /resolveEmbeddedOrderModeContext\(\{/, routePath);
      assert.match(source, /websiteUrl: storeResult\.data\.website_url/, routePath);
    } else {
      assert.match(source, /resolveStorefrontVisibilityDecision\(\{/, routePath);
      assert.match(source, /websiteUrl: accessResult\.data\.website_url/, routePath);
    }
  }
});

test("focused detail routes cover all listing families while ordinary chrome remains the default", async () => {
  const routePaths = [
    "app/store/[slug]/products/[productId]/page.tsx",
    "app/store/[slug]/equipment/[equipmentItemId]/page.tsx",
    "app/store/[slug]/processed-poultry/[processedPoultryItemId]/page.tsx",
  ];
  const optionPaths = [
    "app/store/[slug]/products/[productId]/product-order-options.tsx",
    "app/store/[slug]/equipment/[equipmentItemId]/equipment-order-options.tsx",
    "app/store/[slug]/processed-poultry/[processedPoultryItemId]/processed-poultry-order-options.tsx",
  ];

  for (const routePath of routePaths) {
    const source = await read(routePath);

    assert.match(source, /orderMode=\{orderMode\}/, routePath);
    assert.match(source, /\{!orderMode \? \(/, routePath);
    assert.match(source, /orderMode=\{orderMode\}[^>]*\/>/, routePath);
  }

  for (const optionPath of optionPaths) {
    const source = await read(optionPath);

    assert.match(source, /buildEmbeddedOrderModeHref\(/, optionPath);
    assert.match(source, /\/cart`[\s\S]*orderMode/, optionPath);
    assert.match(source, /\/checkout`[\s\S]*orderMode/, optionPath);
  }
});

test("the post-add confirmation explicitly returns each listing type to its storefront root", async () => {
  const optionPaths = [
    "app/store/[slug]/products/[productId]/product-order-options.tsx",
    "app/store/[slug]/equipment/[equipmentItemId]/equipment-order-options.tsx",
    "app/store/[slug]/processed-poultry/[processedPoultryItemId]/processed-poultry-order-options.tsx",
  ];

  for (const optionPath of optionPaths) {
    const source = await read(optionPath);
    const confirmation = source.slice(
      source.indexOf('<h3 className="font-semibold text-emerald-950">Added to cart</h3>'),
      source.indexOf("View cart", source.indexOf('<h3 className="font-semibold text-emerald-950">Added to cart</h3>')),
    );

    assert.match(confirmation, /Continue shopping/);
    assert.match(confirmation, /buildEmbeddedOrderModeHref\(/);
    assert.match(confirmation, /`\/store\/\$\{(?:product\.storeSlug|item\.store_slug)\}`/);
    assert.match(confirmation, /orderMode/);
    assert.doesNotMatch(confirmation, /setAddedItem\(null\)|setAddedItems\(null\)/);
  }
});

test("focused chrome is compact and omits ordinary navigation and footer", async () => {
  const [source, cartLink] = await Promise.all([
    read("app/store/[slug]/storefront-shell-components.tsx"),
    read("app/store/[slug]/storefront-header-cart-link.tsx"),
  ]);
  const focusedBranch = source.slice(
    source.indexOf("if (orderMode)"),
    source.indexOf("return (", source.indexOf("if (orderMode)") + 20),
  );

  assert.match(source, /if \(orderMode\)[\s\S]*StorefrontFocusedOrderHeader/);
  assert.match(source, /Back to \{store\.store_name\}/);
  assert.match(source, /href=\{orderMode\.returnUrl\}/);
  assert.match(source, /<StorefrontFocusedOrderActions/);
  assert.match(source, /buildEmbeddedOrderModeHref\([\s\S]*?\/cart/);
  assert.match(cartLink, /StorefrontFocusedOrderActions/);
  assert.match(cartLink, /aria-label=\{`Cart, \$\{count\} item/);
  assert.match(cartLink, /storefrontCartChangedEvent/);
  assert.doesNotMatch(focusedBranch, /StorefrontFooter|StorefrontHeaderCartLink|StorefrontMobileMenu/);
});

test("cart, checkout, and confirmation preserve focused context without changing order creation", async () => {
  const [cartPage, checkoutPage] = await Promise.all([
    read("app/store/[slug]/cart/cart-page.tsx"),
    read("app/store/[slug]/checkout/checkout-page.tsx"),
  ]);

  assert.match(cartPage, /const checkoutHref = buildEmbeddedOrderModeHref\(/);
  assert.match(
    cartPage,
    /const continueHref = buildEmbeddedOrderModeHref\([\s\S]*?`\/store\/\$\{store\.store_slug\}`,[\s\S]*?orderMode/,
  );
  assert.match(cartPage, /orderMode \? "Continue Shopping" : "Continue shopping"/);
  assert.match(checkoutPage, /const cartHref = buildEmbeddedOrderModeHref\(/);
  assert.match(checkoutPage, /orderMode\?\.returnUrl/);
  assert.match(checkoutPage, /if \(success\)[\s\S]*\{continueLabel\}/);
  assert.match(checkoutPage, /"pay-at-pickup-order"/);

  const payload = checkoutPage.slice(
    checkoutPage.indexOf("const payload ="),
    checkoutPage.indexOf("try {", checkoutPage.indexOf("const payload =")),
  );
  assert.doesNotMatch(payload, /orderMode|returnUrl|website_url/);
});

test("focused metadata is noindex while public canonical metadata remains available", async () => {
  for (const path of [
    "app/store/[slug]/products/[productId]/page.tsx",
    "app/store/[slug]/equipment/[equipmentItemId]/page.tsx",
    "app/store/[slug]/processed-poultry/[processedPoultryItemId]/page.tsx",
  ]) {
    const source = await read(path);
    const metadataSource = source.slice(
      source.indexOf("export async function generateMetadata"),
      source.indexOf("export default async function"),
    );

    assert.match(metadataSource, /buildCanonical/);
    assert.match(metadataSource, /shouldNoIndexStorefrontRoute/);
    assert.match(metadataSource, /robots: NOINDEX_ROBOTS/);
  }
});
