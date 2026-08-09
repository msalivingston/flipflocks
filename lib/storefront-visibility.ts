import { resolveEmbeddedOrderModeContext, validateSellerWebsiteUrl, type EmbeddedOrderModeContext, type EmbeddedOrderModeSearchParams } from "@/lib/embedded-order-mode";
import { absoluteUrl } from "@/lib/seo-config";

export const storefrontVisibilityValues = ["public", "embed_only"] as const;

export type StorefrontVisibility = (typeof storefrontVisibilityValues)[number];

export type StorefrontVisibilityDecision =
  | { action: "allow"; orderMode: EmbeddedOrderModeContext | null }
  | { action: "deny"; orderMode: null }
  | { action: "redirect"; orderMode: null; url: string };

export function normalizeStorefrontVisibility(
  value: unknown,
): StorefrontVisibility {
  return value === "embed_only" ? "embed_only" : "public";
}

export function buildStoreEmbedLink({
  slug,
  websiteUrl,
}: {
  slug: string;
  websiteUrl: unknown;
}) {
  const website = validateSellerWebsiteUrl(websiteUrl);

  if (!website.ok || !website.value) return null;

  const embedUrl = new URL(
    `/embed/store/${encodeURIComponent(slug)}`,
    absoluteUrl("/"),
  );
  embedUrl.searchParams.set("orderMode", "embed");
  embedUrl.searchParams.set("return", website.value);

  return embedUrl.toString();
}

export function resolveStorefrontVisibilityDecision({
  isPubliclyAvailable,
  searchParams,
  storeSlug,
  visibility,
  websiteUrl,
}: {
  isPubliclyAvailable: boolean;
  searchParams: EmbeddedOrderModeSearchParams;
  storeSlug: string;
  visibility: unknown;
  websiteUrl: unknown;
}): StorefrontVisibilityDecision {
  if (!isPubliclyAvailable) return { action: "deny", orderMode: null };

  const orderMode = resolveEmbeddedOrderModeContext({
    searchParams,
    storeSlug,
    websiteUrl,
  });

  if (normalizeStorefrontVisibility(visibility) === "public") {
    return { action: "allow", orderMode };
  }

  if (orderMode) return { action: "allow", orderMode };

  const website = validateSellerWebsiteUrl(websiteUrl);

  if (!website.ok || !website.value) {
    return { action: "deny", orderMode: null };
  }

  return { action: "redirect", orderMode: null, url: website.value };
}

export function shouldNoIndexStorefrontRoute({
  searchParams,
  storeSlug,
  visibility,
  websiteUrl,
}: {
  searchParams: EmbeddedOrderModeSearchParams;
  storeSlug: string;
  visibility: unknown;
  websiteUrl: unknown;
}) {
  if (normalizeStorefrontVisibility(visibility) === "embed_only") return true;

  return Boolean(
    resolveEmbeddedOrderModeContext({ searchParams, storeSlug, websiteUrl }),
  );
}
