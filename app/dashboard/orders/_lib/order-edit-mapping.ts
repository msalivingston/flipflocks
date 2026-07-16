import { formatMoneyInput } from "./order-form-calculations";
import type {
  InventoryCategory,
  InventoryItemType,
  OrderLine,
} from "./order-form-types";

export type EditableOrderItemRow = {
  order_item_id: string;
  inventory_item_id: string | null;
  equipment_inventory_item_id: string | null;
  processed_poultry_inventory_item_id: string | null;
  breed_display_name_snapshot: string | null;
  inventory_type_snapshot: string | null;
  custom_inventory_label_snapshot: string | null;
  order_item_source: string | null;
  custom_item_name_snapshot: string | null;
  product_type_snapshot: string | null;
  item_name_snapshot: string | null;
  item_category_snapshot: string | null;
  unit_price_snapshot: number | null;
  quantity: number;
};

export type OrderItemMappingGap = {
  orderItemId: string;
  reason: string;
};

export function mapEditableOrderItemsToLines(items: EditableOrderItemRow[]) {
  const gaps: OrderItemMappingGap[] = [];
  const lines: OrderLine[] = [];

  for (const item of items) {
    const line = mapEditableOrderItemToLine(item);

    if (!line) {
      gaps.push({
        orderItemId: item.order_item_id,
        reason: `Unsupported order item source: ${item.order_item_source ?? "missing"}`,
      });
      continue;
    }

    lines.push(line);
  }

  return { gaps, lines };
}

function mapEditableOrderItemToLine(item: EditableOrderItemRow): OrderLine | null {
  const quantity = String(item.quantity);
  const unitPrice = formatMoneyInput(item.unit_price_snapshot ?? 0);

  if (item.order_item_source === "custom") {
    return {
      type: "custom",
      id: item.order_item_id,
      orderItemId: item.order_item_id,
      customItemName: item.custom_item_name_snapshot ?? item.item_name_snapshot ?? "",
      customItemDescription: "",
      inventoryItemId: "",
      inventoryItemType: "",
      quantity,
      search: item.custom_item_name_snapshot ?? "",
      unitPrice,
    };
  }

  const inventoryItemType = getInventoryItemType(item);
  const inventoryItemId = getInventoryItemId(item);

  if (!inventoryItemType || !inventoryItemId) return null;

  const savedItemName = getSavedItemName(item);
  const savedItemDetail = getSavedItemDetail(item);

  return {
    type: "inventory",
    id: item.order_item_id,
    orderItemId: item.order_item_id,
    customItemName: "",
    customItemDescription: "",
    inventoryItemId,
    inventoryItemType,
    quantity,
    savedItemCategory: getSavedItemCategory(item),
    savedItemDetail,
    savedItemName,
    search: [savedItemName, savedItemDetail].filter(Boolean).join(" - "),
    unitPrice,
  };
}

function getInventoryItemType(
  item: EditableOrderItemRow,
): InventoryItemType | null {
  if (item.order_item_source === "equipment_inventory") {
    return "equipment_inventory";
  }

  if (item.order_item_source === "processed_poultry_inventory") {
    return "processed_poultry_inventory";
  }

  if (
    item.order_item_source === "listing_inventory" ||
    item.order_item_source == null
  ) {
    return "listing_inventory";
  }

  return null;
}

function getInventoryItemId(item: EditableOrderItemRow) {
  if (item.order_item_source === "equipment_inventory") {
    return item.equipment_inventory_item_id;
  }

  if (item.order_item_source === "processed_poultry_inventory") {
    return item.processed_poultry_inventory_item_id;
  }

  return item.inventory_item_id;
}

function getSavedItemCategory(item: EditableOrderItemRow): InventoryCategory {
  if (item.order_item_source === "equipment_inventory") return "equipment";
  if (item.order_item_source === "processed_poultry_inventory") {
    return "processed_poultry";
  }
  if (
    item.inventory_type_snapshot === "hatching_eggs" ||
    item.item_category_snapshot === "hatching_eggs"
  ) {
    return "hatching_eggs";
  }

  return "poultry";
}

function getSavedItemName(item: EditableOrderItemRow) {
  return (
    item.item_name_snapshot ||
    item.custom_item_name_snapshot ||
    item.breed_display_name_snapshot ||
    "Inventory item"
  );
}

function getSavedItemDetail(item: EditableOrderItemRow) {
  const category = getSavedItemCategoryLabel(getSavedItemCategory(item));

  if (item.order_item_source === "equipment_inventory") {
    return [item.item_category_snapshot, item.custom_inventory_label_snapshot, category]
      .filter(Boolean)
      .join(" - ");
  }

  if (item.order_item_source === "processed_poultry_inventory") {
    return [item.item_category_snapshot, item.custom_inventory_label_snapshot, category]
      .filter(Boolean)
      .join(" - ");
  }

  return [
    item.custom_inventory_label_snapshot || item.inventory_type_snapshot,
    category,
  ]
    .filter(Boolean)
    .join(" - ");
}

function getSavedItemCategoryLabel(category: InventoryCategory) {
  if (category === "poultry") return "Live poultry";
  if (category === "hatching_eggs") return "Hatching eggs";
  if (category === "processed_poultry") return "Poultry product";
  if (category === "equipment") return "Equipment";

  return "Inventory";
}
