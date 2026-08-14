import {
  formatCurrency,
  groupHatchingEggInventoryByProduct,
  groupInventoryByProduct,
  type StorefrontEquipmentItem,
  type StorefrontHatchingEggItem,
  type StorefrontInventoryItem,
  type StorefrontProfileImageMap,
  type StorefrontProcessedPoultryItem,
  type StorefrontProduct,
} from "./storefront-data";
import type {
  StorefrontListingCard,
  StorefrontListingSection,
} from "./storefront-listing-tabs";
import {
  buildPublicListingPath,
  type PublicListingUrlInput,
} from "@/lib/public-listing-url";

export function buildStorefrontListingSectionsFromPublicData({
  equipment,
  hatchingEggs,
  inventory,
  livePoultryProfileImages = {},
  processedPoultry,
}: {
  equipment: StorefrontEquipmentItem[];
  hatchingEggs: StorefrontHatchingEggItem[];
  inventory: StorefrontInventoryItem[];
  livePoultryProfileImages?: StorefrontProfileImageMap;
  processedPoultry: StorefrontProcessedPoultryItem[];
}) {
  return buildStorefrontListingSections({
    equipment,
    hatchingEggProducts: groupHatchingEggInventoryByProduct(hatchingEggs),
    livePoultryProducts: groupInventoryByProduct(
      inventory.filter(isLivePoultryItem),
      livePoultryProfileImages,
    ),
    processedPoultry,
  });
}

export function buildStorefrontListingSections({
  equipment,
  hatchingEggProducts,
  livePoultryProducts,
  processedPoultry,
}: {
  equipment: StorefrontEquipmentItem[];
  hatchingEggProducts: StorefrontProduct[];
  livePoultryProducts: StorefrontProduct[];
  processedPoultry: StorefrontProcessedPoultryItem[];
}) {
  const sections: StorefrontListingSection[] = [
    {
      cards: sortListingCardsByTitle(livePoultryProducts.map(toProductCard)),
      description: "Available birds from this storefront.",
      emptyDescription: "This seller does not have visible live poultry right now.",
      emptyTitle: "No live poultry available",
      id: "live-poultry",
      label: "Live Birds",
    },
  ];

  if (hatchingEggProducts.length > 0) {
    sections.push({
      cards: sortListingCardsByTitle(hatchingEggProducts.map(toProductCard)),
      description: "Available hatching eggs for local pickup.",
      emptyDescription: "This seller does not have visible hatching eggs right now.",
      emptyTitle: "No hatching eggs available",
      id: "hatching-eggs",
      label: "Hatching Eggs",
    });
  }

  if (processedPoultry.length > 0) {
    sections.push({
      cards: sortListingCardsByTitle(
        processedPoultry.map(toProcessedPoultryCard),
      ),
      description: "Processed poultry items available for local pickup.",
      emptyDescription:
        "This seller does not have visible processed poultry right now.",
      emptyTitle: "No processed poultry available",
      id: "processed-poultry",
      label: "Poultry Products",
    });
  }

  if (equipment.length > 0) {
    sections.push({
      cards: sortListingCardsByTitle(equipment.map(toEquipmentCard)),
      description: "Equipment and supplies available from this seller.",
      emptyDescription:
        "This seller does not have visible equipment or supplies right now.",
      emptyTitle: "No equipment or supplies available",
      id: "equipment-supplies",
      label: "Equipment & Supplies",
    });
  }

  return sections;
}

export function flattenStorefrontListingSections(
  sections: StorefrontListingSection[],
) {
  return sections.flatMap((section) => section.cards);
}

export function getNonEmptyStorefrontListingSections(
  sections: StorefrontListingSection[],
) {
  return sections.filter((section) => section.cards.length > 0);
}

function sortListingCardsByTitle(cards: StorefrontListingCard[]) {
  return [...cards].sort((first, second) =>
    first.title.localeCompare(second.title, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function toProcessedPoultryCard(
  item: StorefrontProcessedPoultryItem,
): StorefrontListingCard {
  return {
    availabilityCode: item.buyer_availability_code,
    availabilityLabel: formatAvailableBadge(item.quantity_available),
    categoryFilter: item.product_type,
    description: item.description || item.package_size,
    detail: formatQuantity(item.quantity_available),
    href: requirePublicListingPath({
      listingType: "poultry_products",
      processedPoultryItemId: item.processed_poultry_inventory_item_id,
      storeSlug: item.store_slug,
    }),
    imageAlt: item.featured_image_alt_text || item.product_name,
    imageUrl: item.featured_image_url,
    meta: [item.product_type, item.poultry_type].filter(Boolean).join(" - "),
    price: formatCurrency(item.unit_price),
    speciesFilter: item.poultry_type,
    title: item.product_name,
    typeLabel: "Poultry Products",
  };
}

function toEquipmentCard(
  item: StorefrontEquipmentItem,
): StorefrontListingCard {
  return {
    availabilityCode: item.buyer_availability_code,
    availabilityLabel: formatAvailableBadge(item.quantity_available),
    categoryFilter: item.category,
    conditionFilter: item.condition,
    description: item.description,
    detail: formatQuantity(item.quantity_available),
    href: requirePublicListingPath({
      equipmentItemId: item.equipment_inventory_item_id,
      listingType: "equipment_supplies",
      storeSlug: item.store_slug,
    }),
    imageAlt: item.featured_image_alt_text || item.item_name,
    imageUrl: item.featured_image_url,
    meta: [item.category, item.condition].filter(Boolean).join(" - "),
    price: formatCurrency(item.unit_price),
    title: item.item_name,
    typeLabel: "Equipment & Supplies",
  };
}

function toProductCard(product: StorefrontProduct): StorefrontListingCard {
  const purchasableOptions = product.options.filter(
    (option) => option.canCheckout && option.quantityAvailable > 0,
  );
  const batchFilters =
    product.productSource === "listing_inventory"
      ? purchasableOptions.map((option) => ({
          ageFilterDays: option.ageFilterDays,
          availabilityCode: option.buyerAvailabilityCode,
        }))
      : undefined;

  return {
    ageFilterDays: purchasableOptions
      .map((option) => option.ageFilterDays)
      .filter((age): age is number => age !== null),
    availabilityCode: product.availabilityCode,
    availabilityLabel: formatAvailableBadge(product.totalQuantityAvailable),
    batchFilters,
    breedFilter: product.name,
    description: product.description,
    detail: product.quantityLabel,
    href: requirePublicListingPath({
      listingType:
        product.productSource === "hatching_egg_inventory"
          ? "hatching_eggs"
          : "live_poultry",
      productId: product.productId,
      storeSlug: product.storeSlug,
    }),
    imageAlt: product.imageAlt || product.name,
    imageUrl: product.imageUrl,
    meta: product.speciesName,
    price: product.pricingLabel || "See options",
    speciesFilter: product.speciesName,
    title: product.name,
    typeLabel:
      product.productSource === "hatching_egg_inventory" ||
      product.batchType === "hatching_eggs"
        ? "Hatching Eggs"
        : "Live Birds",
  };
}

function requirePublicListingPath(input: PublicListingUrlInput) {
  const path = buildPublicListingPath(input);

  if (!path) {
    throw new Error("Public storefront data is missing a canonical listing path.");
  }

  return path;
}

function formatAvailableBadge(quantity: number) {
  if (quantity <= 0) return "Sold out";
  return `${quantity} available`;
}

function formatQuantity(quantity: number) {
  if (quantity <= 0) return "Sold out";
  if (quantity === 1) return "1 available";
  return `${quantity} available`;
}

function isLivePoultryItem(item: StorefrontInventoryItem) {
  return (
    item.batch_type !== "hatching_eggs" &&
    item.inventory_type !== "hatching_eggs"
  );
}
