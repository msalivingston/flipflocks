export type OrderItemCategory =
  | "live_birds"
  | "hatching_eggs"
  | "poultry_products"
  | "equipment_supplies"
  | "custom_or_unknown";

export type OrderItemCategoryInput = {
  order_item_source?: string | null;
  inventory_item_id?: string | null;
  equipment_inventory_item_id?: string | null;
  processed_poultry_inventory_item_id?: string | null;
  hatching_egg_inventory_item_id?: string | null;
  inventory_type_snapshot?: string | null;
  batch_type_snapshot?: string | null;
  product_type_snapshot?: string | null;
  item_category_snapshot?: string | null;
  species_name_snapshot?: string | null;
  breed_display_name_snapshot?: string | null;
};

const hatchingEggMarkers = new Set(["hatching_eggs", "hatching_egg"]);
const poultryProductMarkers = new Set([
  "processed_poultry",
  "poultry_products",
  "poultry_product",
]);
const equipmentMarkers = new Set([
  "equipment",
  "equipment_supplies",
  "equipment_and_supplies",
]);
const liveBirdMarkers = new Set([
  "live_birds",
  "live_bird",
  "live_poultry",
  "live_animals",
]);
const liveBirdInventoryTypes = new Set([
  "female",
  "male",
  "straight_run",
  "unsexed",
  "pair",
  "trio",
]);

export function classifyOrderItemCategory(
  item: OrderItemCategoryInput,
): OrderItemCategory {
  const sourceCategory = classifySource(item);
  if (sourceCategory) return sourceCategory;

  const inventoryCategory = classifyInventoryReference(item);
  if (inventoryCategory) return inventoryCategory;

  return classifyHistoricalSnapshots(item);
}

export function formatOrderItemCategoryLabel(category: OrderItemCategory) {
  if (category === "live_birds") return "Live Birds";
  if (category === "hatching_eggs") return "Hatching Eggs";
  if (category === "poultry_products") return "Poultry Products";
  if (category === "equipment_supplies") return "Equipment & Supplies";

  return "Custom / Other";
}

function classifySource(
  item: OrderItemCategoryInput,
): OrderItemCategory | null {
  if (item.order_item_source === "custom") return "custom_or_unknown";
  if (item.order_item_source === "equipment_inventory") {
    return "equipment_supplies";
  }
  if (item.order_item_source === "processed_poultry_inventory") {
    return "poultry_products";
  }
  if (item.order_item_source === "hatching_egg_inventory") {
    return "hatching_eggs";
  }
  if (
    item.order_item_source === "listing_inventory" ||
    item.order_item_source === "inventory"
  ) {
    return isStructuredHatchingEggListing(item)
      ? "hatching_eggs"
      : "live_birds";
  }

  return null;
}

function classifyInventoryReference(
  item: OrderItemCategoryInput,
): OrderItemCategory | null {
  if (item.hatching_egg_inventory_item_id) return "hatching_eggs";
  if (item.equipment_inventory_item_id) return "equipment_supplies";
  if (item.processed_poultry_inventory_item_id) return "poultry_products";
  if (item.inventory_item_id) {
    return isStructuredHatchingEggListing(item)
      ? "hatching_eggs"
      : "live_birds";
  }

  return null;
}

function classifyHistoricalSnapshots(
  item: OrderItemCategoryInput,
): OrderItemCategory {
  const inventoryType = normalizeMarker(item.inventory_type_snapshot);
  const batchType = normalizeMarker(item.batch_type_snapshot);
  const productType = normalizeMarker(item.product_type_snapshot);
  const itemCategory = normalizeMarker(item.item_category_snapshot);

  if (
    hatchingEggMarkers.has(inventoryType) ||
    hatchingEggMarkers.has(batchType) ||
    hatchingEggMarkers.has(itemCategory)
  ) {
    return "hatching_eggs";
  }

  if (
    poultryProductMarkers.has(productType) ||
    poultryProductMarkers.has(itemCategory)
  ) {
    return "poultry_products";
  }

  if (
    equipmentMarkers.has(productType) ||
    equipmentMarkers.has(itemCategory)
  ) {
    return "equipment_supplies";
  }

  if (
    liveBirdMarkers.has(batchType) ||
    liveBirdMarkers.has(itemCategory) ||
    liveBirdInventoryTypes.has(inventoryType) ||
    (Boolean(item.species_name_snapshot) &&
      Boolean(item.breed_display_name_snapshot) &&
      inventoryType !== "")
  ) {
    return "live_birds";
  }

  return "custom_or_unknown";
}

function isStructuredHatchingEggListing(item: OrderItemCategoryInput) {
  return (
    hatchingEggMarkers.has(normalizeMarker(item.inventory_type_snapshot)) ||
    hatchingEggMarkers.has(normalizeMarker(item.batch_type_snapshot)) ||
    hatchingEggMarkers.has(normalizeMarker(item.item_category_snapshot))
  );
}

function normalizeMarker(value: string | null | undefined) {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") ?? ""
  );
}
