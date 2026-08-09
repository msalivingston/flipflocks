import {
  StorefrontListingTabs,
  type StorefrontListingSection,
} from "@/app/store/[slug]/storefront-listing-tabs";

export function EmbedInventoryGallery({
  sections,
}: {
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

  return <StorefrontListingTabs sections={sections} variant="embed" />;
}
