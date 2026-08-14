import {
  StorefrontListingTabs,
  type StorefrontListingSection,
} from "@/app/store/[slug]/storefront-listing-tabs";
import { StorefrontFocusedOrderActions } from "@/app/store/[slug]/storefront-header-cart-link";
import type { EmbeddedOrderModeContext } from "@/lib/embedded-order-mode";
import { buildEmbeddedOrderModeHref } from "@/lib/embedded-order-mode";

export function EmbedInventoryGallery({
  orderMode,
  sections,
  storeSlug,
}: {
  orderMode: EmbeddedOrderModeContext | null;
  sections: StorefrontListingSection[];
  storeSlug: string;
}) {
  const cartHref = buildEmbeddedOrderModeHref(
    `/store/${storeSlug}/cart`,
    orderMode,
  );

  if (sections.length === 0) {
    return (
      <div className="grid gap-3">
        <div className="flex justify-end">
          <StorefrontFocusedOrderActions
            cartHref={cartHref}
            storeSlug={storeSlug}
          />
        </div>
        <div className="rounded-lg border border-dashed border-stone-300 bg-white px-5 py-8 text-center">
          <p className="text-sm font-semibold text-stone-700">
            No inventory is publicly available right now.
          </p>
        </div>
      </div>
    );
  }

  return (
    <StorefrontListingTabs
      cartHref={cartHref}
      cartStoreSlug={storeSlug}
      orderMode={orderMode}
      sections={sections}
      variant="embed"
    />
  );
}
