import { liveBirdsV2DraftMarker } from "./constants";
import { mapSoldAsToInventoryType } from "./payloadPreview";
import type { BirdOffering, SpeciesOption } from "./types";

export type CreateLiveBirdsDraftPayload = {
  p_store_id: string;
  p_species_id: string;
  p_batch_type: "live_animals";
  p_origin_date: string;
  p_available_date: string;
  p_base_price: number;
  p_breed_groups: Array<{
    seller_breed_profile_id: string;
    sort_order: number;
    visibility_status: "active";
    seller_notes: null;
    inventory_items: Array<{
      inventory_type: Exclude<
        ReturnType<typeof mapSoldAsToInventoryType>,
        "unknown"
      >;
      custom_inventory_label: null;
      quantity_available: number;
      price_override: number | null;
      sort_order: number;
      visibility_status: "active";
      seller_notes: null;
    }>;
  }>;
  p_auto_price_increase_enabled: false;
  p_auto_price_increase_amount: null;
  p_auto_price_increase_max_price: null;
  p_internal_batch_label: typeof liveBirdsV2DraftMarker;
  p_seller_notes: null;
  p_visibility_status: "hidden";
};

export function buildCreateLiveBirdsDraftPayload({
  availableDate,
  hatchDate,
  offerings,
  species,
  storeId,
}: {
  availableDate: string;
  hatchDate: string;
  offerings: BirdOffering[];
  species: SpeciesOption;
  storeId: string;
}): CreateLiveBirdsDraftPayload | null {
  if (!species.id) return null;

  const basePrice = getBasePrice(offerings);

  return {
    p_store_id: storeId,
    p_species_id: species.id,
    p_batch_type: "live_animals",
    p_origin_date: hatchDate,
    p_available_date: availableDate,
    p_base_price: basePrice,
    p_breed_groups: getBreedGroups({ basePrice, offerings }),
    p_auto_price_increase_enabled: false,
    p_auto_price_increase_amount: null,
    p_auto_price_increase_max_price: null,
    p_internal_batch_label: liveBirdsV2DraftMarker,
    p_seller_notes: null,
    p_visibility_status: "hidden",
  };
}

function getBreedGroups({
  basePrice,
  offerings,
}: {
  basePrice: number;
  offerings: BirdOffering[];
}): CreateLiveBirdsDraftPayload["p_breed_groups"] {
  const groupsByBreedProfileId = new Map<
    string,
    CreateLiveBirdsDraftPayload["p_breed_groups"][number]
  >();

  offerings.forEach((offering) => {
    if (!offering.sellerBreedProfileId) return;

    if (!groupsByBreedProfileId.has(offering.sellerBreedProfileId)) {
      groupsByBreedProfileId.set(offering.sellerBreedProfileId, {
        seller_breed_profile_id: offering.sellerBreedProfileId,
        sort_order: groupsByBreedProfileId.size,
        visibility_status: "active",
        seller_notes: null,
        inventory_items: [],
      });
    }

    const group = groupsByBreedProfileId.get(offering.sellerBreedProfileId);
    const inventoryType = mapSoldAsToInventoryType(offering.soldAs);

    if (!group || inventoryType === "unknown") return;

    const price = getNumberValue(offering.price);

    group.inventory_items.push({
      inventory_type: inventoryType,
      custom_inventory_label: null,
      quantity_available: getNumberValue(offering.quantity),
      price_override: price === basePrice ? null : price,
      sort_order: group.inventory_items.length,
      visibility_status: "active",
      seller_notes: null,
    });
  });

  return Array.from(groupsByBreedProfileId.values());
}

function getBasePrice(offerings: BirdOffering[]) {
  const firstNonNegativePrice = offerings
    .map((offering) => getNumberValue(offering.price))
    .find((price) => price >= 0);

  return firstNonNegativePrice ?? 0;
}

function getNumberValue(value: string) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) return 0;

  return numberValue;
}
