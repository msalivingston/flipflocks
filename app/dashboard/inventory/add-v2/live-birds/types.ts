export type BirdOffering = {
  id: string;
  inventoryItemId?: string | null;
  listingBatchBreedId?: string | null;
  sellerBreedProfileId: string | null;
  breedId?: string | null;
  breed: string;
  soldAs: string;
  quantity: string;
  price: string;
  description: string;
  expanded: boolean;
};

export type ReadinessChecks = {
  hatchInformationComplete: boolean;
  birdOfferingsAdded: boolean;
  birdQuantitiesEntered: boolean;
  pricingEntered: boolean;
  buyerContentComplete: boolean;
};

export type PriceAdjustmentDirection = "increase" | "decrease";

export type PriceAdjustmentState = {
  enabled: boolean;
  direction: PriceAdjustmentDirection;
  amount: string;
  intervalWeeks: string;
  maxPrice: string;
  minPrice: string;
};

export type AgeAtAvailabilityResult = {
  message: string;
  status: "ready" | "warning";
};

export type SpeciesOption = {
  id: string | null;
  label: string;
  slug: string | null;
};

export type BreedOption = {
  id: string | null;
  label: string;
  speciesId: string | null;
  breedId: string | null;
  catalogImageUrl: string | null;
  catalogDescription: string | null;
  sellerPhotoUrl: string | null;
  sellerDescription: string | null;
  source: "seller_profile" | "catalog_breed" | "fallback";
};
