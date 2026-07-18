import { mapSoldAsToInventoryType } from "./payloadPreview";
import { getPriceAdjustmentIssues } from "./priceAdjustment";
import type { BirdOffering, PriceAdjustmentState, SpeciesOption } from "./types";

export type SaveDraftPreflightResult = {
  canSaveDraft: boolean;
  blockingIssues: string[];
  warnings: string[];
};

export function getSaveDraftPreflight({
  availableDate,
  hatchDate,
  offerings,
  priceAdjustment,
  species,
  usingFallbackBreeds,
  usingFallbackSpecies,
}: {
  availableDate: string;
  hatchDate: string;
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
  species: SpeciesOption;
  usingFallbackBreeds: boolean;
  usingFallbackSpecies: boolean;
}): SaveDraftPreflightResult {
  const blockingIssues = [
    ...getSpeciesIssues(species),
    ...getDateIssues({ availableDate, hatchDate }),
    ...getOfferingIssues(offerings),
    ...getPriceAdjustmentIssues({ offerings, priceAdjustment }),
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

  return ["Select a species."];
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
    issues.push("Enter the hatch date.");
  }

  if (!parsedAvailableDate) {
    issues.push("Enter the date the birds will be available.");
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
    return ["Add at least one bird group."];
  }

  offerings.forEach((offering, index) => {
    const label = `Group ${index + 1}`;
    const quantity = Number(offering.quantity);
    const price = Number(offering.price);

    if (!offering.sellerBreedProfileId) {
      issues.push(`Select a breed for ${label}.`);
    }

    if (!offering.soldAs.trim()) {
      issues.push(`Select how the birds in ${label} will be sold.`);
    } else if (mapSoldAsToInventoryType(offering.soldAs) === "unknown") {
      issues.push(`Select how the birds in ${label} will be sold.`);
    }

    if (Number.isFinite(quantity) && quantity < 0) {
      issues.push(`Enter a quantity for ${label}.`);
    }

    if (Number.isFinite(price) && price < 0) {
      issues.push(`Enter a price for ${label}.`);
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
      `Group ${index + 1}`,
    ]);
  });

  return Array.from(offeringLabelsByCombination.values())
    .filter((offeringLabels) => offeringLabels.length > 1)
    .map(
      (offeringLabels) =>
        `${offeringLabels.join(" and ")} use the same breed and sale type.`,
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

  if (offerings.some((offering) => Number(offering.quantity) === 0)) {
    warnings.push("One or more groups have quantity 0.");
  }

  if (offerings.some((offering) => Number(offering.price) === 0)) {
    warnings.push("One or more groups have price 0.");
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
