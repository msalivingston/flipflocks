type OrderSource = {
  order_source: string | null;
  payment_method: string | null;
};

export type OrderLifecycleSnapshot = {
  order_status: string | null;
  ready_for_pickup_at?: string | null;
};

export type OrderLifecycleState =
  | "needs_attention"
  | "ready_for_pickup"
  | "completed"
  | "canceled";

export function getOrderLifecycleState(
  order: OrderLifecycleSnapshot,
): OrderLifecycleState {
  if (order.order_status === "canceled") return "canceled";
  if (order.order_status === "fulfilled") return "completed";
  if (
    ["pending", "open"].includes(order.order_status ?? "") &&
    order.ready_for_pickup_at
  ) {
    return "ready_for_pickup";
  }

  return "needs_attention";
}

export function formatOrderLifecycle(order: OrderLifecycleSnapshot) {
  const lifecycle = getOrderLifecycleState(order);

  if (lifecycle === "ready_for_pickup") return "Ready for pickup";
  if (lifecycle === "completed") return "Picked up / complete";
  if (lifecycle === "canceled") return "Canceled";

  return "New / open";
}

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
