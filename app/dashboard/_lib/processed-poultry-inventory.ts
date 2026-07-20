export const poultryTypes = ["Chicken", "Turkey", "Duck", "Goose", "Other"] as const;

export const processedPoultryProductTypes = [
  "Whole Bird",
  "Halves",
  "Parts",
  "Other",
] as const;

export type PoultryType = (typeof poultryTypes)[number];
export type ProcessedPoultryProductType =
  (typeof processedPoultryProductTypes)[number];

export type ProcessedPoultryInventoryRow = {
  processed_poultry_inventory_item_id: string;
  store_id: string;
  product_name: string;
  poultry_type: PoultryType | string;
  product_type: ProcessedPoultryProductType | string;
  package_size: string | null;
  description: string | null;
  available_date: string;
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

export type ProcessedPoultryDraftDeleteStatus = {
  is_draft: boolean;
  has_order_history: boolean;
  has_published_activity: boolean;
  can_delete: boolean;
};

export function formatProcessedPoultryStatus(row: {
  operational_availability_status: string;
  visibility_status: string;
}) {
  if (row.visibility_status === "hidden") return "Draft";
  if (row.visibility_status === "archived") return "Archived";
  if (row.operational_availability_status === "sold_out") return "Sold out";
  if (row.operational_availability_status === "ready_now") return "Available";

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

export function formatProcessedPoultryDescriptor(row: {
  poultry_type: string;
  product_type: string;
  package_size: string | null;
}) {
  return [row.poultry_type, row.product_type, row.package_size]
    .filter(Boolean)
    .join(" - ");
}

export function validateProcessedPoultryForm(values: {
  productName: string;
  poultryType: string;
  productType: string;
  quantityAvailable: string;
  price: string;
}) {
  const errors: string[] = [];
  const quantity = Number(values.quantityAvailable);
  const price = Number(values.price);

  if (!values.productName.trim()) errors.push("Add a product name.");
  if (!poultryTypes.includes(values.poultryType as PoultryType)) {
    errors.push("Choose a poultry type.");
  }
  if (
    !processedPoultryProductTypes.includes(
      values.productType as ProcessedPoultryProductType,
    )
  ) {
    errors.push("Choose a product type.");
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
