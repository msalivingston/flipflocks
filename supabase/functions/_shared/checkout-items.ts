export type CheckoutItem = {
  item_type: "listing_inventory" | "equipment_inventory" | "processed_poultry_inventory" | "hatching_egg_inventory";
  item_id: string;
  quantity: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const itemTypes = new Set(["listing_inventory", "equipment_inventory", "processed_poultry_inventory", "hatching_egg_inventory"]);

// Both public payment paths pass this exact, alias-free result to summary and
// creation/reservation. Never silently give one supplied identifier priority.
export function normalizeCheckoutItems(value: unknown): CheckoutItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("At least one checkout item is required.");
  }
  if (value.length > 50) throw new Error("Too many checkout items.");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each checkout item must be an object.");
    }
    const record = item as Record<string, unknown>;
    const legacyId = record.inventory_item_id;
    const currentId = record.item_id;
    const hasLegacyId = legacyId != null;
    const hasCurrentId = currentId != null;
    for (const id of [legacyId, currentId]) {
      if (id != null && (typeof id !== "string" || !uuid.test(id))) {
        throw new Error("Each checkout item must include a valid item type, item ID, and positive quantity.");
      }
    }
    const itemType = record.item_type ?? (hasLegacyId ? "listing_inventory" : undefined);
    if (
      (hasLegacyId && itemType !== "listing_inventory") ||
      (hasLegacyId && hasCurrentId && String(legacyId).toLowerCase() !== String(currentId).toLowerCase()) ||
      (record.inventory_item_type != null && record.inventory_item_type !== itemType)
    ) {
      throw new Error("Conflicting or ambiguous inventory identifiers.");
    }
    if (typeof itemType !== "string" || !itemTypes.has(itemType) || (!hasCurrentId && !hasLegacyId)) {
      throw new Error("Each checkout item must include a valid item type, item ID, and positive quantity.");
    }
    if (typeof record.quantity !== "number" || !Number.isSafeInteger(record.quantity) ||
        record.quantity <= 0 || record.quantity > 2147483647) {
      throw new Error("Each checkout item quantity must be a positive integer.");
    }
    return {
      item_type: itemType as CheckoutItem["item_type"],
      item_id: String(currentId ?? legacyId).toLowerCase(),
      quantity: record.quantity,
    };
  });
}
