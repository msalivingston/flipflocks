import type {
  SellerContext,
  SellerInventoryManagementRow,
} from "../../_lib/seller-types";

export type PublishReadinessMediaSummary = {
  activeCount: number;
  totalCount: number;
};

export type PublishReadinessListing = {
  title: string;
  speciesName: string;
  breedNames: string[];
  batchType: string;
  originDate: string | null;
  availableDate: string;
  ageAtAvailabilityDays: number | null;
  basePrice: number | null;
  autoPriceAdjustmentEnabled: boolean;
  priceAdjustmentDirection: string | null;
  priceAdjustmentAmount: number | null;
  priceAdjustmentIntervalWeeks: number | null;
  priceAdjustmentMaxPrice: number | null;
  priceAdjustmentMinPrice: number | null;
  internalLabel: string | null;
  publicDescription: string | null;
  sellerNotes: string | null;
  visibilityStatus: string;
  moderationStatus: string;
  availabilityStatus: string;
  totalAvailable: number;
  rows: SellerInventoryManagementRow[];
};

export type PublishReadinessStatus = "ready" | "warning" | "missing" | "info";

export type PublishReadinessItem = {
  id: string;
  label: string;
  status: PublishReadinessStatus;
  message: string;
};

export type PublishReadinessSection = {
  id: string;
  title: string;
  items: PublishReadinessItem[];
};

export type PublishReadinessReport = {
  summary: {
    readyCount: number;
    warningCount: number;
    missingCount: number;
  };
  publishGate: {
    canPublish: boolean;
    blockers: string[];
    warnings: string[];
  };
  storefrontPreview: {
    title: string;
    speciesBreed: string;
    inventorySummary: string;
    pricingSummary: string;
    pickupSummary: string;
    deliverySummary: string;
  };
  sections: PublishReadinessSection[];
};

/**
 * Builds the hidden-listing publish checklist without changing listing state.
 *
 * The report is deliberately conservative: it can warn about missing buyer-facing
 * pieces, but it does not decide whether a listing is publishable. That final
 * decision belongs to the future publish workflow.
 */
export function buildPublishReadinessReport({
  listing,
  media,
  seller,
}: {
  listing: PublishReadinessListing;
  media: PublishReadinessMediaSummary;
  seller: SellerContext | null;
}): PublishReadinessReport {
  const activeInventoryRows = listing.rows.filter(
    (row) => row.inventory_visibility_status === "active",
  );
  const activeAvailableQuantity = activeInventoryRows.reduce(
    (total, row) => total + (row.quantity_available ?? 0),
    0,
  );
  const zeroQuantityRows = activeInventoryRows.filter(
    (row) => (row.quantity_available ?? 0) === 0,
  );
  const hasPickupNotes =
    hasText(seller?.pickup_instructions) || hasText(seller?.pickup_policy);
  const hasPublicLocation =
    hasText(seller?.public_city) && hasText(seller?.public_state);
  const hasPublicContact =
    Boolean(seller?.show_public_email && hasText(seller.public_email)) ||
    Boolean(seller?.show_public_phone && hasText(seller.public_phone));
  const publishGate = buildPublishGate({
    activeAvailableQuantity,
    activeInventoryRows,
    hasPickupNotes,
    listing,
    media,
    seller,
    zeroQuantityRows,
  });

  const sections: PublishReadinessSection[] = [
    {
      id: "storefront",
      title: "Storefront Preview",
      items: [
        {
          id: "private-status",
          label: "Private review state",
          status: listing.visibilityStatus === "hidden" ? "info" : "warning",
          message:
            listing.visibilityStatus === "hidden"
              ? "This listing is still hidden. This review does not make it live."
              : "This review is intended for hidden listings before a publish step exists.",
        },
        {
          id: "title",
          label: "Listing title",
          status: hasText(listing.title) ? "ready" : "missing",
          message: hasText(listing.title)
            ? listing.title
            : "Add a clear listing title before publishing.",
        },
        {
          id: "species-breed",
          label: "Species and breed",
          status:
            hasText(listing.speciesName) && listing.breedNames.length > 0
              ? "ready"
              : "missing",
          message:
            hasText(listing.speciesName) && listing.breedNames.length > 0
              ? `${listing.speciesName} - ${listing.breedNames.join(", ")}`
              : "Choose the species and breed buyers should see.",
        },
        {
          id: "description",
          label: "Buyer-facing description",
          status: hasText(listing.publicDescription) ? "ready" : "missing",
          message: hasText(listing.publicDescription)
            ? "A public description is ready for buyers to read."
            : "Add a public description before publishing. Seller notes stay private.",
        },
      ],
    },
    {
      id: "inventory",
      title: "Inventory and Pricing",
      items: [
        {
          id: "inventory-rows",
          label: "Bird groups",
          status:
            activeInventoryRows.length > 0
              ? zeroQuantityRows.length > 0
                ? "warning"
                : "ready"
              : "missing",
          message:
            activeInventoryRows.length > 0
              ? zeroQuantityRows.length > 0
                ? `${zeroQuantityRows.length} group${
                    zeroQuantityRows.length === 1 ? "" : "s"
                  } show quantity 0.`
                : `${activeInventoryRows.length} active bird group${
                    activeInventoryRows.length === 1 ? "" : "s"
                  } ready for review.`
              : "All bird groups are hidden or archived.",
        },
        {
          id: "quantity",
          label: "Available quantity",
          status: activeAvailableQuantity > 0 ? "ready" : "warning",
          message:
            activeAvailableQuantity > 0
              ? `${activeAvailableQuantity} total available.`
              : "This listing has no available quantity.",
        },
        {
          id: "pricing",
          label: "Buyer pricing",
          status:
            listing.basePrice != null &&
            activeInventoryRows.every((row) => row.effective_unit_price != null)
              ? "ready"
              : "missing",
          message:
            listing.basePrice != null
              ? "Base price and any custom group prices are ready to review."
              : "Add a base price before publishing.",
        },
        {
          id: "photos",
          label: "Photos",
          status: media.activeCount > 0 ? "ready" : "missing",
          message:
            media.activeCount > 0
              ? `${media.activeCount} active photo${
                  media.activeCount === 1 ? "" : "s"
                } attached.`
              : "No active listing photos are attached yet.",
        },
      ],
    },
    {
      id: "pickup",
      title: "Pickup and Buyer Details",
      items: [
        {
          id: "pickup-details",
          label: "Pickup details",
          status: hasPickupNotes ? "ready" : "missing",
          message: hasPickupNotes
            ? "Pickup notes or policy are saved for the store."
            : "Add pickup instructions or a pickup policy before publishing.",
        },
        {
          id: "public-location",
          label: "Public pickup area",
          status: hasPublicLocation ? "ready" : "warning",
          message: hasPublicLocation
            ? `${seller?.public_city}, ${seller?.public_state}`
            : "Add a public city and state so buyers know the general pickup area.",
        },
        {
          id: "public-contact",
          label: "Buyer contact",
          status: hasPublicContact ? "ready" : "warning",
          message: hasPublicContact
            ? "At least one public contact method is visible."
            : "No public email or phone is visible to buyers.",
        },
        {
          id: "delivery",
          label: "Delivery",
          status: "info",
          message:
            "Delivery and shipping are not part of this publish step. This review is focused on pickup readiness.",
        },
      ],
    },
  ];

  return {
    summary: summarizeSections(sections),
    publishGate,
    storefrontPreview: {
      title: listing.title,
      speciesBreed: `${listing.speciesName} - ${listing.breedNames.join(", ")}`,
      inventorySummary: `${listing.totalAvailable} available across ${
        listing.rows.length
      } group${listing.rows.length === 1 ? "" : "s"}`,
      pricingSummary:
        listing.basePrice == null
          ? "Base price missing"
          : `Base price ${formatCurrency(listing.basePrice)}`,
      pickupSummary: hasPickupNotes
        ? "Pickup details saved"
        : "Pickup details missing",
      deliverySummary: "Delivery not enabled in this V1 review",
    },
    sections,
  };
}

function buildPublishGate({
  activeAvailableQuantity,
  activeInventoryRows,
  hasPickupNotes,
  listing,
  media,
  seller,
  zeroQuantityRows,
}: {
  activeAvailableQuantity: number;
  activeInventoryRows: SellerInventoryManagementRow[];
  hasPickupNotes: boolean;
  listing: PublishReadinessListing;
  media: PublishReadinessMediaSummary;
  seller: SellerContext | null;
  zeroQuantityRows: SellerInventoryManagementRow[];
}) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const hasHatchingEggRows = activeInventoryRows.some(
    (row) => row.inventory_type === "hatching_eggs",
  );
  const hasLiveAnimalRows = activeInventoryRows.some(
    (row) => row.inventory_type !== "hatching_eggs",
  );

  if (!seller?.store_id) {
    blockers.push("Seller store context is missing. Refresh and try again.");
  }

  if (listing.visibilityStatus !== "hidden") {
    blockers.push("Only hidden listings can be published from this review.");
  }

  if (activeInventoryRows.length === 0) {
    blockers.push("Add at least one visible bird group.");
  }

  if (activeAvailableQuantity <= 0) {
    blockers.push("At least one bird group needs available quantity.");
  }

  if (!hasText(listing.availableDate)) {
    blockers.push("Add an available date.");
  }

  if (listing.batchType !== "hatching_eggs" && !hasText(listing.originDate)) {
    blockers.push("Add a hatch or origin date.");
  }

  if (listing.basePrice == null || listing.basePrice < 0) {
    blockers.push("Add a valid base price.");
  }

  if (
    activeInventoryRows.some(
      (row) => row.price_override != null && row.price_override < 0,
    )
  ) {
    blockers.push("Fix custom group prices before publishing.");
  }

  if (listing.batchType === "hatching_eggs" && hasLiveAnimalRows) {
    blockers.push("Hatching egg listings can only include hatching egg rows.");
  }

  if (listing.batchType !== "hatching_eggs" && hasHatchingEggRows) {
    blockers.push("Hatching eggs need their own listing.");
  }

  if (zeroQuantityRows.length > 0) {
    warnings.push(
      `${zeroQuantityRows.length} bird group${
        zeroQuantityRows.length === 1 ? "" : "s"
      } will show quantity 0.`,
    );
  }

  if (media.activeCount === 0) {
    warnings.push("No listing photos are attached.");
  }

  if (!hasText(listing.publicDescription)) {
    warnings.push("No public description is filled in.");
  }

  if (!hasPickupNotes) {
    warnings.push("Pickup details are missing.");
  }

  if (
    !Boolean(seller?.show_public_email && hasText(seller.public_email)) &&
    !Boolean(seller?.show_public_phone && hasText(seller.public_phone))
  ) {
    warnings.push("No public buyer contact method is visible.");
  }

  return {
    canPublish: blockers.length === 0,
    blockers,
    warnings,
  };
}

function summarizeSections(sections: PublishReadinessSection[]) {
  return sections.reduce(
    (summary, section) => {
      section.items.forEach((item) => {
        if (item.status === "ready") summary.readyCount += 1;
        if (item.status === "warning") summary.warningCount += 1;
        if (item.status === "missing") summary.missingCount += 1;
      });

      return summary;
    },
    { readyCount: 0, warningCount: 0, missingCount: 0 },
  );
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}
