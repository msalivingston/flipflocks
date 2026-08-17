import {
  getCustomInventoryLabelForSoldAs,
  mapSoldAsToInventoryType,
} from "../payloadPreview";
import type { PriceAdjustmentState } from "../types";
import type { BatchBirdRow, BatchHatchGroup } from "./batchDomain";

export type BatchCreatePayload = {
  client_hatch_group_token: string;
  species_id: string;
  hatch_date: string;
  available_date: string;
  base_price: number;
  automatic_pricing: {
    enabled: boolean;
    direction: "increase" | "decrease" | null;
    amount: number | null;
    interval_weeks: number | null;
    maximum_price: number | null;
    minimum_price: number | null;
  };
  breed_groups: Array<{
    seller_breed_profile_id: string;
    inventory_items: Array<{
      client_row_token: string;
      inventory_type: string;
      custom_inventory_label: string | null;
      quantity_available: number;
      starting_price: number;
      barn_location: string | null;
    }>;
  }>;
};

export type BatchReviewSummary = {
  entryCount: number;
  hatchGroupCount: number;
  totalBirds: number;
  breedCount: number;
  minimumPrice: number;
  maximumPrice: number;
  barnLocationCount: number;
  automaticPricingGroupCount: number;
};

export type BatchCreateResult = {
  entries_created: number;
  hatch_groups_created: number;
  total_birds_added: number;
  hatch_groups: Array<{
    client_hatch_group_token: string;
    listing_batch_id: string;
  }>;
  inventory_items: Array<{
    client_row_token: string;
    inventory_item_id: string;
    listing_batch_breed_id: string;
    listing_batch_id: string;
  }>;
};

export type BatchRpcResponse = {
  ok: boolean;
  replayed: boolean;
  error_code: string | null;
  error_message: string | null;
  error_group_token: string | null;
  error_row_token: string | null;
  result: BatchCreateResult | null;
};

export function buildBatchCreatePayload({
  groups,
  priceAdjustments,
}: {
  groups: BatchHatchGroup[];
  priceAdjustments: Record<string, PriceAdjustmentState>;
}): BatchCreatePayload[] {
  return groups.map((group) => {
    const basePrice = Math.min(...group.rows.map((row) => Number(row.price)));
    const adjustment = priceAdjustments[group.id];
    const rowsByProfile = new Map<string, BatchBirdRow[]>();

    for (const row of group.rows) {
      const profileId = row.breed?.id;
      if (!profileId) continue;
      rowsByProfile.set(profileId, [...(rowsByProfile.get(profileId) ?? []), row]);
    }

    return {
      client_hatch_group_token: group.id,
      species_id: group.species.id as string,
      hatch_date: group.hatchDate,
      available_date: group.availableDate,
      base_price: basePrice,
      automatic_pricing: {
        enabled: Boolean(adjustment?.enabled),
        direction: adjustment?.enabled ? adjustment.direction : null,
        amount: adjustment?.enabled ? Number(adjustment.amount) : null,
        interval_weeks: adjustment?.enabled
          ? Number(adjustment.intervalWeeks)
          : null,
        maximum_price:
          adjustment?.enabled && adjustment.direction === "increase"
            ? Number(adjustment.maxPrice)
            : null,
        minimum_price:
          adjustment?.enabled && adjustment.direction === "decrease"
            ? Number(adjustment.minPrice)
            : null,
      },
      breed_groups: Array.from(rowsByProfile.entries()).map(
        ([sellerBreedProfileId, rows]) => ({
          seller_breed_profile_id: sellerBreedProfileId,
          inventory_items: rows.map((row) => ({
            client_row_token: row.id,
            inventory_type: mapSoldAsToInventoryType(row.soldAs),
            custom_inventory_label: getCustomInventoryLabelForSoldAs(row.soldAs),
            quantity_available: Number(row.quantity),
            starting_price: Number(row.price),
            barn_location: row.barnLocation.trim() || null,
          })),
        }),
      ),
    };
  });
}

export function getBatchReviewSummary({
  groups,
  priceAdjustments,
}: {
  groups: BatchHatchGroup[];
  priceAdjustments: Record<string, PriceAdjustmentState>;
}): BatchReviewSummary {
  const rows = groups.flatMap((group) => group.rows);
  const prices = rows.map((row) => Number(row.price));

  return {
    entryCount: rows.length,
    hatchGroupCount: groups.length,
    totalBirds: rows.reduce((total, row) => total + Number(row.quantity), 0),
    breedCount: new Set(rows.map((row) => row.breed?.id).filter(Boolean)).size,
    minimumPrice: Math.min(...prices),
    maximumPrice: Math.max(...prices),
    barnLocationCount: rows.filter((row) => row.barnLocation.trim()).length,
    automaticPricingGroupCount: groups.filter(
      (group) => priceAdjustments[group.id]?.enabled,
    ).length,
  };
}
