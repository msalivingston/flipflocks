import {
  formatAgeAtAvailabilityFromDates,
  formatInventoryTypeLabel,
} from "../../_lib/listing-formatters";
import { formatCurrency } from "../order-formatters";
import { isPositiveWholeNumber } from "./order-form-calculations";
import type {
  BrowseInventoryFilter,
  EquipmentInventoryRow,
  InventorySearchRow,
  ListingInventoryRow,
  OrderLine,
  ProcessedPoultryInventoryRow,
} from "./order-form-types";

export function normalizeSellableInventoryRows({
  equipmentRows,
  listingRows,
  processedPoultryRows,
}: {
  equipmentRows: EquipmentInventoryRow[];
  listingRows: ListingInventoryRow[];
  processedPoultryRows: ProcessedPoultryInventoryRow[];
}): InventorySearchRow[] {
  return [
    ...listingRows.map(normalizeListingInventoryRow),
    ...processedPoultryRows.map(normalizeProcessedPoultryInventoryRow),
    ...equipmentRows.map(normalizeEquipmentInventoryRow),
  ].sort((firstItem, secondItem) => {
    const categorySort =
      getInventoryCategorySort(firstItem.category) -
      getInventoryCategorySort(secondItem.category);

    return categorySort || firstItem.title.localeCompare(secondItem.title);
  });
}

export function normalizeListingInventoryRow(
  row: ListingInventoryRow,
): InventorySearchRow {
  const category =
    row.batch_type === "hatching_eggs" || row.inventory_type === "hatching_eggs"
      ? "hatching_eggs"
      : "poultry";
  const inventoryType =
    row.custom_inventory_label || formatInventoryTypeLabel(row.inventory_type);
  const age = formatAgeAtAvailabilityFromDates(row.origin_date, row.available_date);

  return {
    allowInventoryOverride: true,
    category,
    detailLabel: [inventoryType, age].filter(Boolean).join(" - "),
    effective_unit_price: row.effective_unit_price ?? 0,
    id: row.inventory_item_id,
    itemType: "listing_inventory",
    operational_availability_status: row.operational_availability_status,
    quantity_available: row.quantity_available ?? 0,
    title: row.breed_display_name,
  };
}

export function normalizeEquipmentInventoryRow(
  row: EquipmentInventoryRow,
): InventorySearchRow {
  return {
    allowInventoryOverride: false,
    category: "equipment",
    detailLabel: [row.category, row.condition].filter(Boolean).join(" - "),
    effective_unit_price: row.price ?? 0,
    id: row.equipment_inventory_item_id,
    itemType: "equipment_inventory",
    operational_availability_status: row.operational_availability_status,
    quantity_available: row.quantity_available ?? 0,
    title: row.item_name,
  };
}

export function normalizeProcessedPoultryInventoryRow(
  row: ProcessedPoultryInventoryRow,
): InventorySearchRow {
  return {
    allowInventoryOverride: false,
    category: "processed_poultry",
    detailLabel: [row.poultry_type, row.product_type, row.package_size]
      .filter(Boolean)
      .join(" - "),
    effective_unit_price: row.price ?? 0,
    id: row.processed_poultry_inventory_item_id,
    itemType: "processed_poultry_inventory",
    operational_availability_status: row.operational_availability_status,
    quantity_available: row.quantity_available ?? 0,
    title: row.product_name,
  };
}

export function filterInventory(inventory: InventorySearchRow[], query: string) {
  const normalized = query.trim().toLowerCase();

  return inventory.filter((item) => {
    if ((item.quantity_available ?? 0) <= 0) return false;
    if (!normalized) return false;

    return [
      item.title,
      item.detailLabel,
      formatInventoryCategoryLabel(item.category),
      item.operational_availability_status,
    ].some((value) => value.toLowerCase().includes(normalized));
  });
}

export function getBrowseInventoryRows(
  inventory: InventorySearchRow[],
  filter: BrowseInventoryFilter,
  query: string,
) {
  const normalized = query.trim().toLowerCase();

  return inventory
    .filter((item) => {
      if ((item.quantity_available ?? 0) <= 0) return false;
      if (filter !== "all" && getBrowseInventoryCategory(item) !== filter) {
        return false;
      }
      if (!normalized) return true;

      return [
        item.title,
        item.detailLabel,
        formatInventoryCategoryLabel(item.category),
        item.operational_availability_status,
      ].some((value) => value.toLowerCase().includes(normalized));
    })
    .sort((firstItem, secondItem) =>
      firstItem.title.localeCompare(secondItem.title),
    );
}

export function getBrowseInventoryCategory(
  item: InventorySearchRow,
): Exclude<BrowseInventoryFilter, "all"> {
  return item.category;
}

export function getInventoryCategorySort(category: BrowseInventoryFilter) {
  if (category === "poultry") return 1;
  if (category === "hatching_eggs") return 2;
  if (category === "processed_poultry") return 3;
  if (category === "equipment") return 4;

  return 0;
}

export function formatInventoryCategoryLabel(category: BrowseInventoryFilter) {
  if (category === "poultry") return "Live poultry";
  if (category === "hatching_eggs") return "Hatching eggs";
  if (category === "processed_poultry") return "Poultry product";
  if (category === "equipment") return "Equipment";

  return "Inventory";
}

export function quantityExceedsAvailable(
  line: OrderLine,
  inventory: InventorySearchRow[],
) {
  if (line.type !== "inventory") return false;
  if (!isPositiveWholeNumber(line.quantity)) return false;

  const item = inventory.find((row) => row.id === line.inventoryItemId);

  if (!item) return false;
  if (!item.allowInventoryOverride) return false;

  return Number(line.quantity) > (item.quantity_available ?? 0);
}

export function formatInventorySearchLabel(item: InventorySearchRow) {
  return `${item.title} ${item.detailLabel} - ${item.quantity_available} available - ${formatCurrency(
    item.effective_unit_price,
  )}`;
}

export function getManualOrderPayloadItemType(line: OrderLine) {
  if (line.inventoryItemType === "equipment_inventory") {
    return "equipment_inventory";
  }

  if (line.inventoryItemType === "processed_poultry_inventory") {
    return "processed_poultry_inventory";
  }

  return "inventory";
}

export function formatInventoryMetadata(item: InventorySearchRow) {
  return `${item.detailLabel} - ${formatInventoryCategoryLabel(item.category)}`;
}

export function formatBrowseInventoryMetadata(item: InventorySearchRow) {
  return `${item.detailLabel} - ${formatInventoryCategoryLabel(item.category)}`;
}
