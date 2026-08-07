import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStorefrontPreviewHref,
  getSafeStorefrontPreviewReturnTo,
  getStorefrontPreviewReturnHref,
  storefrontPreviewFallbackHref,
} from "../lib/storefront-preview-routing.ts";

test("accepts only internal seller dashboard return paths", () => {
  assert.equal(
    getSafeStorefrontPreviewReturnTo("/dashboard/store-admin"),
    "/dashboard/store-admin",
  );
  assert.equal(
    getSafeStorefrontPreviewReturnTo("/dashboard/inventory?tab=live-birds"),
    "/dashboard/inventory?tab=live-birds",
  );
  assert.equal(getSafeStorefrontPreviewReturnTo("/dashboard"), "/dashboard");
});

test("rejects external, protocol-relative, malformed, and non-dashboard return paths", () => {
  for (const value of [
    "https://example.com",
    "//example.com",
    "javascript:alert(1)",
    "/store/another-farm",
    "/dashboard\\example.com",
    "/dashboard/../store/another-farm",
  ]) {
    assert.equal(getSafeStorefrontPreviewReturnTo(value), null, value);
  }
});

test("falls back to Store Setup and encodes a validated Preview launch URL", () => {
  assert.equal(
    getStorefrontPreviewReturnHref("https://example.com"),
    storefrontPreviewFallbackHref,
  );
  assert.equal(
    buildStorefrontPreviewHref("sunshine-mesa-farm", "/dashboard/breeds"),
    "/store/sunshine-mesa-farm?preview=1&returnTo=%2Fdashboard%2Fbreeds",
  );
});
