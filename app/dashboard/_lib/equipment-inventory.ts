export const equipmentCategories = [
  "Feeders & Waterers",
  "Brooders & Heat",
  "Incubators & Hatching",
  "Coops & Housing",
  "Transport & Crates",
  "Fencing & Containment",
  "Miscellaneous",
] as const;

export const equipmentConditions = [
  "New",
  "Like New",
  "Good",
  "Fair",
  "For Parts",
] as const;

export type EquipmentCategory = (typeof equipmentCategories)[number];
export type EquipmentCondition = (typeof equipmentConditions)[number];

export type EquipmentInventoryRow = {
  equipment_inventory_item_id: string;
  store_id: string;
  item_name: string;
  category: EquipmentCategory | string;
  condition: EquipmentCondition | string | null;
  description: string | null;
  quantity_available: number;
  price: number;
  visibility_status: string;
  moderation_status: string;
  operational_availability_status: string;
  seller_notes: string | null;
  first_published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EquipmentDraftDeleteStatus = {
  is_draft: boolean;
  has_order_history: boolean;
  has_published_activity: boolean;
  can_delete: boolean;
};

export function formatEquipmentStatus(row: {
  operational_availability_status: string;
  visibility_status: string;
}) {
  if (row.visibility_status === "hidden") return "Draft";
  if (row.visibility_status === "archived") return "Archived";
  if (row.operational_availability_status === "sold_out") return "Sold out";
  if (row.operational_availability_status === "ready_now") {
    return "Available";
  }

  return row.operational_availability_status.replaceAll("_", " ");
}

export function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value ?? 0);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

export function validateEquipmentForm(values: {
  itemName: string;
  category: string;
  quantityAvailable: string;
  price: string;
}) {
  const errors: string[] = [];
  const quantity = Number(values.quantityAvailable);
  const price = Number(values.price);

  if (!values.itemName.trim()) errors.push("Add an item name.");
  if (!equipmentCategories.includes(values.category as EquipmentCategory)) {
    errors.push("Choose a category.");
  }
  if (
    !values.quantityAvailable.trim() ||
    !Number.isInteger(quantity) ||
    quantity < 0
  ) {
    errors.push("Quantity available must be a whole number of zero or more.");
  }
  if (!values.price.trim() || !Number.isFinite(price) || price < 0) {
    errors.push("Price must be zero or more.");
  }

  return errors;
}
