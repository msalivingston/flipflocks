export const PLAN_IDS = ["small_flock", "full_flock"] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export type SaleCategory =
  | "live_birds"
  | "hatching_eggs"
  | "equipment_supplies"
  | "processed_poultry";

export type LiveBirdOfferingType =
  | "female"
  | "male"
  | "straight_run"
  | "unsexed"
  | "pair"
  | "trio"
  | "flock";

export type LockedPlanFeature =
  | "flock_group"
  | "group_listing"
  | "hatching_eggs"
  | "equipment_supplies"
  | "processed_poultry"
  | "age_based_pricing"
  | "active_bird_limit";

export type PlanCapabilities = {
  id: PlanId;
  displayName: string;
  monthlyPrice: number;
  yearlyPrice: number | null;
  activeBirdLimit: number | null;
  allowedSaleCategories: SaleCategory[];
  allowedLiveBirdOfferingTypes: LiveBirdOfferingType[];
  lockedFeatures: LockedPlanFeature[];
  flockGroupListingsEnabled: boolean;
  groupListingRouteEnabled: boolean;
  hatchingEggsEnabled: boolean;
  equipmentSuppliesEnabled: boolean;
  processedPoultryEnabled: boolean;
  ageBasedPricingEnabled: boolean;
};

export const PLAN_CAPABILITIES: Record<PlanId, PlanCapabilities> = {
  small_flock: {
    id: "small_flock",
    displayName: "Coop",
    monthlyPrice: 5,
    yearlyPrice: 50,
    activeBirdLimit: 5,
    allowedSaleCategories: ["live_birds"],
    allowedLiveBirdOfferingTypes: [
      "female",
      "male",
      "straight_run",
      "unsexed",
      "pair",
      "trio",
    ],
    lockedFeatures: [
      "flock_group",
      "group_listing",
      "hatching_eggs",
      "equipment_supplies",
      "processed_poultry",
      "age_based_pricing",
      "active_bird_limit",
    ],
    flockGroupListingsEnabled: false,
    groupListingRouteEnabled: false,
    hatchingEggsEnabled: false,
    equipmentSuppliesEnabled: false,
    processedPoultryEnabled: false,
    ageBasedPricingEnabled: false,
  },
  full_flock: {
    id: "full_flock",
    displayName: "Market",
    monthlyPrice: 29,
    yearlyPrice: 270,
    activeBirdLimit: null,
    allowedSaleCategories: [
      "live_birds",
      "hatching_eggs",
      "equipment_supplies",
      "processed_poultry",
    ],
    allowedLiveBirdOfferingTypes: [
      "female",
      "male",
      "straight_run",
      "unsexed",
      "pair",
      "trio",
      "flock",
    ],
    lockedFeatures: [],
    flockGroupListingsEnabled: true,
    groupListingRouteEnabled: true,
    hatchingEggsEnabled: true,
    equipmentSuppliesEnabled: true,
    processedPoultryEnabled: true,
    ageBasedPricingEnabled: true,
  },
};

export function normalizePlanId(value: string | null | undefined): PlanId {
  return value === "small_flock" ? "small_flock" : "full_flock";
}

export function getPlanCapabilities(
  planId: string | null | undefined,
): PlanCapabilities {
  return PLAN_CAPABILITIES[normalizePlanId(planId)];
}

export function isSaleCategoryAllowed(
  planId: string | null | undefined,
  category: SaleCategory,
) {
  return getPlanCapabilities(planId).allowedSaleCategories.includes(category);
}

export function isLiveBirdOfferingAllowed(
  planId: string | null | undefined,
  offeringType: LiveBirdOfferingType,
) {
  return getPlanCapabilities(planId).allowedLiveBirdOfferingTypes.includes(
    offeringType,
  );
}

export const LOCKED_PLAN_MESSAGES: Record<LockedPlanFeature, string> = {
  flock_group:
    "Flock and group listings are included with Market. Coop is designed for occasional live bird sales of single birds, pairs, and trios.",
  group_listing:
    "Group listings are included with Market. Coop keeps live bird selling simple with single birds, pairs, and trios.",
  hatching_eggs: "Hatching egg listings are included with Market.",
  equipment_supplies:
    "Equipment and supply listings are included with Market.",
  processed_poultry: "Processed poultry listings are included with Market.",
  age_based_pricing:
    "Age-Based Pricing is included with Market. List growing birds once and let pricing adjust as they age.",
  active_bird_limit:
    "Coop includes up to 5 active birds for sale at one time. Upgrade to Market for unlimited live bird quantities.",
};
