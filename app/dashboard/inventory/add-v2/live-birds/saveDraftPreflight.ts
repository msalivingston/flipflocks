import { mapSoldAsToInventoryType } from "./payloadPreview";
import type { BirdOffering, SpeciesOption } from "./types";

export type SaveDraftPreflightResult = {
  canSaveDraft: boolean;
  blockingIssues: string[];
  warnings: string[];
};

export function getSaveDraftPreflight({
  availableDate,
  hatchDate,
  offerings,
  species,
  usingFallbackBreeds,
  usingFallbackSpecies,
}: {
  availableDate: string;
  hatchDate: string;
  offerings: BirdOffering[];
  species: SpeciesOption;
  usingFallbackBreeds: boolean;
  usingFallbackSpecies: boolean;
}): SaveDraftPreflightResult {
  const blockingIssues = [
    ...getSpeciesIssues(species),
    ...getDateIssues({ availableDate, hatchDate }),
    ...getOfferingIssues(offerings),
  ];
  const warnings = getPreflightWarnings({
    offerings,
    usingFallbackBreeds,
    usingFallbackSpecies,
  });

  return {
    canSaveDraft: blockingIssues.length === 0,
    blockingIssues,
    warnings,
  };
}

function getSpeciesIssues(species: SpeciesOption) {
  if (species.id) return [];

  return ["Choose a species with a real backend ID before draft save wiring."];
}

function getDateIssues({
  availableDate,
  hatchDate,
}: {
  availableDate: string;
  hatchDate: string;
}) {
  const issues: string[] = [];
  const parsedHatchDate = parseDateValue(hatchDate);
  const parsedAvailableDate = parseDateValue(availableDate);

  if (!parsedHatchDate) {
    issues.push("Choose a hatch date before draft save wiring.");
  }

  if (!parsedAvailableDate) {
    issues.push("Choose an available date before draft save wiring.");
  }

  if (
    parsedHatchDate &&
    parsedAvailableDate &&
    parsedAvailableDate.getTime() < parsedHatchDate.getTime()
  ) {
    issues.push("Available date cannot be before hatch date.");
  }

  return issues;
}

function getOfferingIssues(offerings: BirdOffering[]) {
  const issues: string[] = [];

  if (offerings.length === 0) {
    return ["Add at least one bird offering before draft save wiring."];
  }

  offerings.forEach((offering, index) => {
    const label = `Bird Offering ${index + 1}`;
    const quantity = Number(offering.quantity);
    const price = Number(offering.price);

    if (!offering.sellerBreedProfileId) {
      issues.push(`${label} needs a real seller breed profile ID.`);
    }

    if (!offering.soldAs.trim()) {
      issues.push(`${label} needs a sold-as type.`);
    }

    if (mapSoldAsToInventoryType(offering.soldAs) === "unknown") {
      issues.push(`${label} needs a supported sold-as type.`);
    }

    if (Number.isFinite(quantity) && quantity < 0) {
      issues.push(`${label} quantity cannot be negative.`);
    }

    if (Number.isFinite(price) && price < 0) {
      issues.push(`${label} price cannot be negative.`);
    }
  });

  return [
    ...issues,
    ...getDuplicateCombinationIssues(offerings),
  ];
}

function getDuplicateCombinationIssues(offerings: BirdOffering[]) {
  const offeringLabelsByCombination = new Map<string, string[]>();

  offerings.forEach((offering, index) => {
    if (!offering.sellerBreedProfileId) return;

    const inventoryType = mapSoldAsToInventoryType(offering.soldAs);

    if (inventoryType === "unknown") return;

    const combinationKey = `${offering.sellerBreedProfileId}:${inventoryType}`;
    offeringLabelsByCombination.set(combinationKey, [
      ...(offeringLabelsByCombination.get(combinationKey) ?? []),
      `Bird Offering ${index + 1}`,
    ]);
  });

  return Array.from(offeringLabelsByCombination.values())
    .filter((offeringLabels) => offeringLabels.length > 1)
    .map(
      (offeringLabels) =>
        `${offeringLabels.join(" and ")} use the same breed and sold-as type.`,
    );
}

function getPreflightWarnings({
  offerings,
  usingFallbackBreeds,
  usingFallbackSpecies,
}: {
  offerings: BirdOffering[];
  usingFallbackBreeds: boolean;
  usingFallbackSpecies: boolean;
}) {
  const warnings: string[] = [];

  if (offerings.some((offering) => offering.photos.length > 0)) {
    warnings.push("Photo placeholders will not be saved yet.");
  }

  if (offerings.some((offering) => offering.description.trim().length > 0)) {
    warnings.push("Descriptions will not be saved yet.");
  }

  if (offerings.some((offering) => Number(offering.quantity) === 0)) {
    warnings.push("One or more offerings have quantity 0.");
  }

  if (offerings.some((offering) => Number(offering.price) === 0)) {
    warnings.push("One or more offerings have price 0.");
  }

  if (usingFallbackSpecies) {
    warnings.push("Fallback species labels are being shown.");
  }

  if (usingFallbackBreeds) {
    warnings.push("Fallback breed labels are being shown.");
  }

  return warnings;
}

function parseDateValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) return null;

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}
