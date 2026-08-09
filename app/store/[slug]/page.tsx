import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import {
  EmptyStorefront,
  StorefrontShell,
  toPublicImageUrl,
} from "./storefront-ui";
import {
  loadStorefrontHome,
  loadStorefrontAccess,
  loadPublicStorefrontListingData,
} from "./storefront-data";
import { StorefrontHomeContent } from "./storefront-home-content";
import { StorefrontPreviewClient } from "./storefront-preview-client";
import { getStorefrontPreviewReturnHref } from "@/lib/storefront-preview-routing";
import { NOINDEX_ROBOTS } from "@/lib/seo-config";
import {
  buildPublicMetadata,
  cleanMetadataText,
  truncateMetadataText,
  withFlockFrontBrand,
} from "@/lib/public-metadata";
import {
  resolveStorefrontVisibilityDecision,
  shouldNoIndexStorefrontRoute,
} from "@/lib/storefront-visibility";

const loadStorefrontHomeCached = cache(loadStorefrontHome);

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ preview?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const query = searchParams ? await searchParams : {};

  if (query.preview === "1") return { robots: NOINDEX_ROBOTS };

  const [{ data: store, error }, accessResult] = await Promise.all([
    loadStorefrontHomeCached(slug),
    loadStorefrontAccess(slug),
  ]);
  const canonicalPath = `/store/${encodeURIComponent(slug)}`;

  if (error || accessResult.error || !store || !accessResult.data) {
    return {
      ...buildPublicMetadata({
        canonicalPath,
        title: "Storefront Not Found | FlockFront",
        description: "This storefront is not publicly available on FlockFront.",
      }),
      robots: NOINDEX_ROBOTS,
    };
  }

  if (
    shouldNoIndexStorefrontRoute({
      searchParams: {},
      storeSlug: slug,
      visibility: accessResult.data.storefront_visibility,
      websiteUrl: accessResult.data.website_url,
    })
  ) {
    return { robots: NOINDEX_ROBOTS };
  }

  const tagline = cleanMetadataText(store.store_tagline);
  const description = truncateMetadataText(
    tagline || `View the public storefront for ${store.store_name} on FlockFront.`,
  );
  const imageUrl = store.hero_image_url
    ? toPublicImageUrl(store.hero_image_url)
    : null;

  return buildPublicMetadata({
    canonicalPath,
    title: withFlockFrontBrand(store.store_name),
    description,
    image: imageUrl
      ? {
          alt: store.hero_image_alt_text || undefined,
          url: imageUrl,
        }
      : null,
  });
}

export default async function StorefrontHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ preview?: string; returnTo?: string }>;
}) {
  const { slug } = await params;
  const query = searchParams ? await searchParams : {};

  if (query.preview === "1") {
    return (
      <StorefrontPreviewClient
        returnTo={getStorefrontPreviewReturnHref(query.returnTo)}
        slug={slug}
      />
    );
  }

  const [homeResult, listingResult, accessResult] = await Promise.all([
    loadStorefrontHomeCached(slug),
    loadPublicStorefrontListingData(slug),
    loadStorefrontAccess(slug),
  ]);
  const error = homeResult.error ?? listingResult.error ?? accessResult.error;

  if (error) {
    return (
      <StorefrontShell>
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="This storefront could not load"
            description="Please refresh the page. If this keeps happening, the seller may need to check their storefront settings."
          />
        </main>
      </StorefrontShell>
    );
  }

  const store = homeResult.data;

  if (!store) {
    return (
      <StorefrontShell>
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="Storefront not found"
            description="This storefront is not public right now."
          />
        </main>
      </StorefrontShell>
    );
  }

  if (!accessResult.data) notFound();

  const visibilityDecision = resolveStorefrontVisibilityDecision({
    isPubliclyAvailable: accessResult.data.is_publicly_available,
    searchParams: {},
    storeSlug: store.store_slug,
    visibility: accessResult.data.storefront_visibility,
    websiteUrl: accessResult.data.website_url,
  });

  if (visibilityDecision.action === "redirect") {
    redirect(visibilityDecision.url);
  }

  if (visibilityDecision.action === "deny") notFound();

  return (
    <StorefrontHomeContent
      equipment={listingResult.data.equipment}
      hatchingEggs={listingResult.data.hatchingEggs}
      inventory={listingResult.data.inventory}
      livePoultryProfileImages={listingResult.data.livePoultryProfileImages}
      processedPoultry={listingResult.data.processedPoultry}
      store={store}
    />
  );
}
