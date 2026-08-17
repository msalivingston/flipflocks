import type { BirdOffering } from "./types";

export type InventoryIdentity = {
  inventoryItemId: string;
  listingBatchBreedId: string;
};

export type InventoryIdentityMap = Record<string, InventoryIdentity>;

export type DraftIdentityRow = {
  custom_inventory_label: string | null;
  inventory_item_id: string;
  inventory_type: string;
  seller_breed_profile_id: string;
};

type DraftRowResolution<Row extends DraftIdentityRow> =
  | { kind: "exact" | "semantic"; row: Row }
  | { kind: "ambiguous" | "none"; row: null };

type CreationInventoryItem = {
  client_row_token?: unknown;
  id?: unknown;
  listing_batch_breed_id?: unknown;
};

type CreationBreedGroup = {
  inventory_items?: unknown;
  listing_batch_breed?: { id?: unknown } | null;
};

export function getCreationInventoryIdentityMap(
  breedGroups: unknown,
): InventoryIdentityMap {
  if (!Array.isArray(breedGroups)) return {};

  const identities: InventoryIdentityMap = {};

  for (const rawGroup of breedGroups) {
    const group = rawGroup as CreationBreedGroup;
    if (!Array.isArray(group?.inventory_items)) continue;

    const groupId =
      typeof group.listing_batch_breed?.id === "string"
        ? group.listing_batch_breed.id
        : null;

    for (const rawItem of group.inventory_items) {
      const item = rawItem as CreationInventoryItem;
      const clientRowToken =
        typeof item?.client_row_token === "string"
          ? item.client_row_token.trim()
          : "";
      const inventoryItemId = typeof item?.id === "string" ? item.id : "";
      const listingBatchBreedId =
        typeof item?.listing_batch_breed_id === "string"
          ? item.listing_batch_breed_id
          : groupId ?? "";

      if (!clientRowToken || !inventoryItemId || !listingBatchBreedId) continue;

      identities[clientRowToken] = {
        inventoryItemId,
        listingBatchBreedId,
      };
    }
  }

  return identities;
}

export function applyInventoryIdentityMap(
  offerings: BirdOffering[],
  identities: InventoryIdentityMap,
) {
  return offerings.map((offering) => {
    const identity = identities[offering.id];
    return identity
      ? {
          ...offering,
          inventoryItemId: identity.inventoryItemId,
          listingBatchBreedId: identity.listingBatchBreedId,
        }
      : offering;
  });
}

export function resolveDraftInventoryRow<Row extends DraftIdentityRow>({
  customInventoryLabel,
  inventoryItemId,
  inventoryType,
  rows,
  sellerBreedProfileId,
  unavailableInventoryIds,
}: {
  customInventoryLabel: string | null;
  inventoryItemId: string | null | undefined;
  inventoryType: string;
  rows: Row[];
  sellerBreedProfileId: string;
  unavailableInventoryIds: Set<string>;
}): DraftRowResolution<Row> {
  if (inventoryItemId) {
    const exactRow = rows.find(
      (row) => row.inventory_item_id === inventoryItemId,
    );
    return exactRow
      ? { kind: "exact", row: exactRow }
      : { kind: "none", row: null };
  }

  const normalizedLabel = customInventoryLabel?.trim() || null;
  const candidates = rows.filter(
    (row) =>
      !unavailableInventoryIds.has(row.inventory_item_id) &&
      row.seller_breed_profile_id === sellerBreedProfileId &&
      row.inventory_type === inventoryType &&
      (row.custom_inventory_label?.trim() || null) === normalizedLabel,
  );

  if (candidates.length === 1) {
    return { kind: "semantic", row: candidates[0] };
  }

  return candidates.length > 1
    ? { kind: "ambiguous", row: null }
    : { kind: "none", row: null };
}
