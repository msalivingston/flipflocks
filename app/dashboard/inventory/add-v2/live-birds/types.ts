export type PhotoPlaceholder = {
  id: string;
  label: string;
  isFeatured: boolean;
};

export type BirdOffering = {
  id: string;
  inventoryItemId?: string | null;
  listingBatchBreedId?: string | null;
  sellerBreedProfileId: string | null;
  breed: string;
  soldAs: string;
  quantity: string;
  price: string;
  description: string;
  expanded: boolean;
  photos: PhotoPlaceholder[];
};

export type ReadinessChecks = {
  hatchInformationComplete: boolean;
  birdOfferingsAdded: boolean;
  birdQuantitiesEntered: boolean;
  pricingEntered: boolean;
  buyerContentComplete: boolean;
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
};
