import {
  StorefrontListingTabs,
  type StorefrontListingSection,
} from "@/app/store/[slug]/storefront-listing-tabs";
import type { EmbeddedOrderModeContext } from "@/lib/embedded-order-mode";

export function EmbedInventoryGallery({
  orderMode,
  sections,
}: {
  orderMode: EmbeddedOrderModeContext | null;
  sections: StorefrontListingSection[];
}) {
  if (sections.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white px-5 py-8 text-center">
        <p className="text-sm font-semibold text-stone-700">
          No inventory is publicly available right now.
        </p>
      </div>
    );
  }

  return (
    <StorefrontListingTabs
      orderMode={orderMode}
      sections={sections}
      variant="embed"
    />
  );
}
