import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NOINDEX_ROBOTS } from "@/lib/seo-config";
import {
  loadPublicStorefrontListingData,
  loadStorefrontHome,
} from "@/app/store/[slug]/storefront-data";
import {
  buildStorefrontListingSectionsFromPublicData,
  getNonEmptyStorefrontListingSections,
} from "@/app/store/[slug]/storefront-listing-cards";
import { EmbedInventoryGallery } from "./embed-inventory-gallery";
import {
  resolveEmbeddedOrderModeContext,
  type EmbeddedOrderModeSearchParams,
} from "@/lib/embedded-order-mode";

export const metadata: Metadata = {
  title: "Inventory | FlockFront",
  robots: NOINDEX_ROBOTS,
};

export default async function EmbeddedStoreInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<EmbeddedOrderModeSearchParams>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [storeResult, listingResult] = await Promise.all([
    loadStorefrontHome(slug),
    loadPublicStorefrontListingData(slug),
  ]);

  if (storeResult.error || listingResult.error) {
    return (
      <EmbedFrame>
        <div className="rounded-lg border border-stone-200 bg-white px-5 py-8 text-center">
          <p className="text-sm font-semibold text-stone-700">
            Inventory could not load. Please refresh and try again.
          </p>
        </div>
      </EmbedFrame>
    );
  }

  if (!storeResult.data) notFound();

  const sections = buildStorefrontListingSectionsFromPublicData(
    listingResult.data,
  );
  const visibleSections = getNonEmptyStorefrontListingSections(sections);
  const orderMode = resolveEmbeddedOrderModeContext({
    searchParams: query,
    storeSlug: storeResult.data.store_slug,
    websiteUrl: storeResult.data.website_url,
  });

  return (
    <EmbedFrame>
      <EmbedInventoryGallery
        orderMode={orderMode}
        sections={visibleSections}
        storeSlug={storeResult.data.store_slug}
      />
    </EmbedFrame>
  );
}

function EmbedFrame({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="w-full max-w-full overflow-x-hidden bg-[#fbf7ef] p-3 sm:p-4"
      data-flockfront-embed="inventory-gallery"
    >
      {children}
      <p className="mt-3 text-center text-[0.68rem] font-medium tracking-wide text-stone-500">
        Powered by FlockFront
      </p>
    </main>
  );
}
