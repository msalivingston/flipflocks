export type PhotoPlaceholder = {
  id: string;
  label: string;
  isFeatured: boolean;
};

export type BirdOffering = {
  id: string;
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
