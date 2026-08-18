import { mapSoldAsToInventoryType } from "../payloadPreview";
import type { BreedOption, SpeciesOption } from "../types";
import {
  isBreedingHistory,
  isFeatherCondition,
} from "../../../../../../lib/live-bird-advanced-attributes";

export type BatchRowField =
  | "species"
  | "hatchDate"
  | "availableDate"
  | "breed"
  | "soldAs"
  | "quantity"
  | "price"
  | "breedingHistory"
  | "featherCondition"
  | "barnLocation";

export type BatchBreedResolution = "idle" | "resolving" | "error";

export type BatchBirdRow = {
  id: string;
  species: SpeciesOption;
  hatchDate: string;
  availableDate: string;
  breed: BreedOption | null;
  soldAs: string;
  quantity: string;
  price: string;
  breedingHistory: string;
  featherCondition: string;
  barnLocation: string;
  breedResolution: BatchBreedResolution;
  breedResolutionMessage: string | null;
};

export type BatchRowErrors = Partial<Record<BatchRowField, string>>;

export type BatchHatchGroup = {
  id: string;
  species: SpeciesOption;
  hatchDate: string;
  availableDate: string;
  rows: BatchBirdRow[];
  totalQuantity: number;
  minimumPrice: number | null;
  maximumPrice: number | null;
};

export function createBatchRow(
  id: string,
  previous?: BatchBirdRow | null,
): BatchBirdRow {
  return {
    id,
    species: previous?.species ?? { id: null, label: "", slug: null },
    hatchDate: previous?.hatchDate ?? "",
    availableDate: previous?.availableDate ?? "",
    breed: null,
    soldAs: "",
    quantity: "",
    price: "",
    breedingHistory: "",
    featherCondition: "",
    barnLocation: "",
    breedResolution: "idle",
    breedResolutionMessage: null,
  };
}

export function addBatchRow(rows: BatchBirdRow[], id: string) {
  return [...rows, createBatchRow(id, rows.at(-1))];
}

export function duplicateBatchRow(
  rows: BatchBirdRow[],
  sourceId: string,
  duplicateId: string,
) {
  const sourceIndex = rows.findIndex((row) => row.id === sourceId);

  if (sourceIndex === -1) return rows;

  const source = rows[sourceIndex];
  const duplicate: BatchBirdRow = {
    ...source,
    id: duplicateId,
    quantity: "",
    barnLocation: "",
    breedResolutionMessage: null,
  };

  return [
    ...rows.slice(0, sourceIndex + 1),
    duplicate,
    ...rows.slice(sourceIndex + 1),
  ];
}

export function removeBatchRow(rows: BatchBirdRow[], rowId: string) {
  if (rows.length <= 1) return rows;

  return rows.filter((row) => row.id !== rowId);
}

export function validateBatchRow(row: BatchBirdRow): BatchRowErrors {
  const errors: BatchRowErrors = {};
  const hatchDate = parseDate(row.hatchDate);
  const availableDate = parseDate(row.availableDate);
  const quantity = Number(row.quantity);
  const price = Number(row.price);

  if (!row.species.id) errors.species = "Choose a species.";
  if (!hatchDate) errors.hatchDate = "Enter a valid hatch date.";
  if (!availableDate) {
    errors.availableDate = "Enter a valid available date.";
  } else if (hatchDate && availableDate.getTime() < hatchDate.getTime()) {
    errors.availableDate = "Must be on or after the hatch date.";
  }

  if (!row.breed) {
    errors.breed = "Choose a breed.";
  } else if (row.breedResolution === "resolving") {
    errors.breed = "Breed is still being added to your library.";
  } else if (row.breedResolution === "error") {
    errors.breed =
      row.breedResolutionMessage ?? "Breed could not be added to your library.";
  } else if (!row.breed.id) {
    errors.breed = "Choose a breed from your Breed Library or catalog.";
  } else if (
    !row.breed.sellerDescription?.trim() &&
    !row.breed.catalogDescription?.trim()
  ) {
    errors.breed = "Add a description to this breed in your Breed Library first.";
  } else if (
    !row.breed.sellerPhotoUrl?.trim() &&
    !row.breed.catalogImageUrl?.trim()
  ) {
    errors.breed = "Add a photo to this breed in your Breed Library first.";
  }

  if (
    !row.soldAs ||
    mapSoldAsToInventoryType(row.soldAs) === "unknown"
  ) {
    errors.soldAs = "Choose how these birds are sold.";
  }

  if (
    !row.quantity.trim() ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    errors.quantity = "Enter a positive whole number.";
  }

  if (
    !row.price.trim() ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !/^\d+(\.\d{1,2})?$/.test(row.price.trim())
  ) {
    errors.price = "Enter a positive price with up to 2 decimals.";
  }

  if (row.barnLocation.trim().length > 200) {
    errors.barnLocation = "Barn Location must be 200 characters or fewer.";
  }

  if (!isBreedingHistory(row.breedingHistory)) {
    errors.breedingHistory = "Choose a valid Breeding History value.";
  }

  if (!isFeatherCondition(row.featherCondition)) {
    errors.featherCondition = "Choose a valid Feather Condition value.";
  }

  return errors;
}

export function isBatchRowValid(row: BatchBirdRow) {
  return Object.keys(validateBatchRow(row)).length === 0;
}

export function isBatchRowUntouched(row: BatchBirdRow) {
  return (
    !row.species.id &&
    !row.hatchDate &&
    !row.availableDate &&
    !row.breed &&
    !row.soldAs &&
    !row.quantity &&
    !row.price &&
    !row.breedingHistory &&
    !row.featherCondition &&
    !row.barnLocation
  );
}

export function groupBatchRows(rows: BatchBirdRow[]): BatchHatchGroup[] {
  const groups = new Map<string, BatchHatchGroup>();

  for (const row of rows) {
    if (!isBatchRowValid(row) || !row.species.id) continue;

    const groupId = [row.species.id, row.hatchDate, row.availableDate].join("|");
    const existing = groups.get(groupId);

    if (existing) {
      existing.rows.push(row);
      continue;
    }

    groups.set(groupId, {
      id: groupId,
      species: row.species,
      hatchDate: row.hatchDate,
      availableDate: row.availableDate,
      rows: [row],
      totalQuantity: 0,
      minimumPrice: null,
      maximumPrice: null,
    });
  }

  return Array.from(groups.values()).map((group) => {
    const quantities = group.rows
      .map((row) => Number(row.quantity))
      .filter((quantity) => Number.isInteger(quantity) && quantity > 0);
    const prices = group.rows
      .map((row) => Number(row.price))
      .filter((price) => Number.isFinite(price) && price > 0);

    return {
      ...group,
      totalQuantity: quantities.reduce((total, quantity) => total + quantity, 0),
      minimumPrice: prices.length > 0 ? Math.min(...prices) : null,
      maximumPrice: prices.length > 0 ? Math.max(...prices) : null,
    };
  });
}

function parseDate(value: string) {
  const parts = value.split("-").map(Number);

  if (parts.length !== 3) return null;

  const [year, month, day] = parts;
  if (!year || !month || !day) return null;

  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}
