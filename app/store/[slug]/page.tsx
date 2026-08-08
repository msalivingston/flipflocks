import type { Metadata } from "next";
import { cache } from "react";
import {
  EmptyStorefront,
  StorefrontShell,
  toPublicImageUrl,
} from "./storefront-ui";
import {
  loadStorefrontEquipment,
  loadStorefrontHatchingEggInventory,
  loadStorefrontHome,
  loadStorefrontInventory,
  loadStorefrontProfileImages,
  loadStorefrontProcessedPoultry,
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

  const { data: store, error } = await loadStorefrontHomeCached(slug);
  const canonicalPath = `/store/${encodeURIComponent(slug)}`;

  if (error || !store) {
    return {
      ...buildPublicMetadata({
        canonicalPath,
        title: "Storefront Not Found | FlockFront",
        description: "This storefront is not publicly available on FlockFront.",
      }),
      robots: NOINDEX_ROBOTS,
    };
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

  const [
    homeResult,
    inventoryResult,
    equipmentResult,
    hatchingEggResult,
    processedPoultryResult,
  ] = await Promise.all([
    loadStorefrontHomeCached(slug),
    loadStorefrontInventory(slug),
    loadStorefrontEquipment(slug),
    loadStorefrontHatchingEggInventory(slug),
    loadStorefrontProcessedPoultry(slug),
  ]);
  const error =
    homeResult.error ??
    inventoryResult.error ??
    equipmentResult.error ??
    hatchingEggResult.error ??
    processedPoultryResult.error;

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

  const livePoultryProfileImagesResult = await loadStorefrontProfileImages(
    slug,
    inventoryResult.data
      .filter(isLivePoultryItem)
      .map((item) => item.seller_breed_profile_id),
  );

  return (
    <StorefrontHomeContent
      equipment={equipmentResult.data}
      hatchingEggs={hatchingEggResult.data}
      inventory={inventoryResult.data}
      livePoultryProfileImages={
        livePoultryProfileImagesResult.error
          ? {}
          : livePoultryProfileImagesResult.data
      }
      processedPoultry={processedPoultryResult.data}
      store={store}
    />
  );
}

function isHatchingEggItem(item: {
  batch_type: string | null;
  inventory_type: string;
}) {
  return item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs";
}

function isLivePoultryItem(item: {
  batch_type: string | null;
  inventory_type: string;
}) {
  return !isHatchingEggItem(item);
}
