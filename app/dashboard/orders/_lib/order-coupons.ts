import type { OrderLine } from "./order-form-types";
export function couponOrderItems(lines: OrderLine[]) {
  return lines.filter(line => Number(line.quantity) > 0 && (line.type === "custom" ? line.customItemName.trim() : line.inventoryItemId)).map(line => ({
    item_type: line.type === "custom" ? "custom" : line.inventoryItemType,
    item_id: line.type === "inventory" ? line.inventoryItemId : null,
    quantity: Number(line.quantity), unit_price: Number(line.unitPrice || 0),
  }));
}
