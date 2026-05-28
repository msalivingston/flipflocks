type OrderSource = {
  order_source: string | null;
  payment_method: string | null;
};

export function formatOrderSource(order: OrderSource) {
  if (
    order.order_source === "storefront" &&
    order.payment_method === "pay_at_pickup"
  ) {
    return "Storefront pickup request";
  }

  return formatPlainLabel(order.order_source);
}

export function formatPaymentMethod(value: string | null) {
  if (value === "pay_at_pickup") return "Pay at pickup";

  return formatPlainLabel(value);
}

export function formatPlainLabel(value: string | null) {
  return value ? value.replaceAll("_", " ") : "Not set";
}

export function formatCurrency(value: number | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value ?? 0);
}

export function formatDateTime(value: string | null) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatInventoryLabel({
  custom_inventory_label,
  inventory_type,
}: {
  custom_inventory_label: string | null;
  inventory_type: string | null;
}) {
  return custom_inventory_label || formatPlainLabel(inventory_type);
}
