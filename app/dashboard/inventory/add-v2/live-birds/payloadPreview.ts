import { liveBirdsV2DraftMarker } from "./constants";
import type { BirdOffering, SpeciesOption } from "./types";

export type InventoryTypePreview =
  | "female"
  | "male"
  | "straight_run"
  | "pair"
  | "trio"
  | "other"
  | "unknown";

export type SavePayloadPreview = {
  listingBatch: {
    speciesId: string | null;
    speciesLabel: string;
    batchType: "live_animals";
    originDate: string;
    availableDate: string;
    visibilityStatus: "hidden";
    internalBatchLabel: typeof liveBirdsV2DraftMarker;
    recommendedBasePrice: number | null;
  };
  listingBatchBreeds: Array<{
    sellerBreedProfileId: string;
    displayLabel: string;
  }>;
  inventoryItems: Array<{
    localOfferingId: string;
    sellerBreedProfileId: string | null;
    breedLabel: string;
    soldAs: string;
    inventoryType: InventoryTypePreview;
    customInventoryLabel: string | null;
    quantityAvailable: number;
    priceOverride: number | null;
  }>;
  warnings: string[];
};

export function buildLiveBirdsSavePayloadPreview({
  availableDate,
  hatchDate,
  offerings,
  species,
}: {
  availableDate: string;
  hatchDate: string;
  offerings: BirdOffering[];
  species: SpeciesOption;
}): SavePayloadPreview {
  const recommendedBasePrice = getRecommendedBasePrice(offerings);
  const duplicateCombinationWarnings =
    getDuplicateInventoryCombinationWarnings(offerings);

  return {
    listingBatch: {
      speciesId: species.id,
      speciesLabel: species.label,
      batchType: "live_animals",
      originDate: hatchDate,
      availableDate,
      visibilityStatus: "hidden",
      internalBatchLabel: liveBirdsV2DraftMarker,
      recommendedBasePrice,
    },
    listingBatchBreeds: getListingBatchBreedsPreview(offerings),
    inventoryItems: offerings.map((offering) => {
      const offeringPrice = getPositiveNumberValue(offering.price);

      return {
        localOfferingId: offering.id,
        sellerBreedProfileId: offering.sellerBreedProfileId,
        breedLabel: offering.breed,
        soldAs: offering.soldAs,
        inventoryType: mapSoldAsToInventoryType(offering.soldAs),
        customInventoryLabel: getCustomInventoryLabelForSoldAs(offering.soldAs),
        quantityAvailable: getNumberValue(offering.quantity),
        priceOverride:
          recommendedBasePrice !== null &&
          offeringPrice !== null &&
          offeringPrice !== recommendedBasePrice
            ? offeringPrice
            : null,
      };
    }),
    warnings: [
      "Breed photos are managed through seller_breed_profiles and are not saved on draft groups or stock records.",
      ...getMissingBackendIdWarnings({ offerings, species }),
      ...duplicateCombinationWarnings,
    ],
  };
}

export function mapSoldAsToInventoryType(soldAs: string): InventoryTypePreview {
  switch (soldAs) {
    case "Female":
      return "female";
    case "Male":
      return "male";
    case "Straight run":
      return "straight_run";
    case "Pair":
      return "pair";
    case "Trio":
      return "trio";
    case "Flock":
      return "other";
    default:
      return "unknown";
  }
}

export function getCustomInventoryLabelForSoldAs(soldAs: string) {
  return soldAs === "Flock" ? "Flock" : null;
}

export function mapInventoryTypeToSoldAs(
  inventoryType: string,
  customInventoryLabel?: string | null,
) {
  switch (inventoryType) {
    case "female":
      return "Female";
    case "male":
      return "Male";
    case "straight_run":
      return "Straight run";
    case "pair":
      return "Pair";
    case "trio":
      return "Trio";
    case "other":
      return customInventoryLabel?.trim() ?? "";
    default:
      return "";
  }
}

function getListingBatchBreedsPreview(offerings: BirdOffering[]) {
  const rowsByProfileId = new Map<
    string,
    { sellerBreedProfileId: string; displayLabel: string }
  >();

  offerings.forEach((offering) => {
    if (!offering.sellerBreedProfileId) return;

    if (!rowsByProfileId.has(offering.sellerBreedProfileId)) {
      rowsByProfileId.set(offering.sellerBreedProfileId, {
        sellerBreedProfileId: offering.sellerBreedProfileId,
        displayLabel: offering.breed,
      });
    }
  });

  return Array.from(rowsByProfileId.values());
}

function getRecommendedBasePrice(offerings: BirdOffering[]) {
  for (const offering of offerings) {
    const price = getPositiveNumberValue(offering.price);

    if (price !== null) return price;
  }

  return null;
}

function getDuplicateInventoryCombinationWarnings(offerings: BirdOffering[]) {
  const offeringIdsByCombination = new Map<string, string[]>();

  offerings.forEach((offering) => {
    if (!offering.sellerBreedProfileId) return;

    const inventoryType = mapSoldAsToInventoryType(offering.soldAs);
    const combinationKey = `${offering.sellerBreedProfileId}:${inventoryType}`;
    offeringIdsByCombination.set(combinationKey, [
      ...(offeringIdsByCombination.get(combinationKey) ?? []),
      offering.id,
    ]);
  });

  return Array.from(offeringIdsByCombination.entries())
    .filter(([, offeringIds]) => offeringIds.length > 1)
    .map(
      ([combinationKey, offeringIds]) =>
        `Duplicate sellerBreedProfileId + inventoryType combination (${combinationKey}) appears in local groups: ${offeringIds.join(", ")}.`,
    );
}

function getMissingBackendIdWarnings({
  offerings,
  species,
}: {
  offerings: BirdOffering[];
  species: SpeciesOption;
}) {
  const warnings: string[] = [];

  if (!species.id) {
    warnings.push("Selected species is using a local fallback and has no speciesId yet.");
  }

  const offeringsMissingBreedProfile = offerings
    .filter((offering) => !offering.sellerBreedProfileId)
    .map((offering) => offering.id);

  if (offeringsMissingBreedProfile.length > 0) {
    warnings.push(
      `Some groups are using local fallback breed labels and have no sellerBreedProfileId yet: ${offeringsMissingBreedProfile.join(", ")}.`,
    );
  }

  return warnings;
}

function getNumberValue(value: string) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) return 0;

  return numberValue;
}

function getPositiveNumberValue(value: string) {
  const numberValue = getNumberValue(value);

  return numberValue > 0 ? numberValue : null;
}
