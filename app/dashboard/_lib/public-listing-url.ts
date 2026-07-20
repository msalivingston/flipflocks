export type PublicListingUrlInput =
  | {
      listingType: "live_poultry";
      productId: string | null | undefined;
      storeSlug: string | null | undefined;
    }
  | {
      listingType: "hatching_eggs";
      productId: string | null | undefined;
      storeSlug: string | null | undefined;
    }
  | {
      listingType: "poultry_products";
      processedPoultryItemId: string | null | undefined;
      storeSlug: string | null | undefined;
    }
  | {
      listingType: "equipment_supplies";
      equipmentItemId: string | null | undefined;
      storeSlug: string | null | undefined;
    };

export function buildPublicListingPath(input: PublicListingUrlInput) {
  const storeSlug = normalizePathSegment(input.storeSlug);

  if (!storeSlug) return null;

  switch (input.listingType) {
    case "live_poultry": {
      const productId = normalizePathSegment(input.productId);
      return productId ? `/store/${storeSlug}/products/${productId}` : null;
    }
    case "hatching_eggs": {
      const productId = normalizePathSegment(input.productId);
      return productId ? `/store/${storeSlug}/products/${productId}` : null;
    }
    case "poultry_products": {
      const itemId = normalizePathSegment(input.processedPoultryItemId);
      return itemId ? `/store/${storeSlug}/processed-poultry/${itemId}` : null;
    }
    case "equipment_supplies": {
      const itemId = normalizePathSegment(input.equipmentItemId);
      return itemId ? `/store/${storeSlug}/equipment/${itemId}` : null;
    }
    default:
      return assertNever(input);
  }
}

function normalizePathSegment(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? encodeURIComponent(trimmed) : null;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported public listing type: ${JSON.stringify(value)}`);
}
