export type OrderActionSnapshot = {
  archived_at?: string | null;
  canceled_at?: string | null;
  fulfilled_at?: string | null;
  has_adjusted_item_quantities?: boolean;
  order_status: string | null;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_status?: string | null;
  remaining_unfulfilled_quantity?: number | null;
};

const activeOrderStatuses = new Set(["pending", "open"]);
const paymentCorrectionOrderStatuses = new Set([
  "pending",
  "open",
  "fulfilled",
]);

export function canCancelOrder(order: OrderActionSnapshot) {
  if (!activeOrderStatuses.has(order.order_status ?? "")) return false;
  if (order.payment_method === "pay_at_pickup") return true;

  return (
    order.payment_method === "stripe_checkout" &&
    order.payment_status === "unpaid"
  );
}

export function canEditOrder(order: OrderActionSnapshot) {
  return (
    !isCanceledOrder(order) &&
    order.order_status !== "fulfilled" &&
    !order.fulfilled_at &&
    !order.has_adjusted_item_quantities &&
    !(
      order.payment_method === "stripe_checkout" &&
      order.payment_status !== "unpaid"
    )
  );
}

export function canMarkOrderFulfilled(order: OrderActionSnapshot) {
  return (
    activeOrderStatuses.has(order.order_status ?? "") &&
    (order.remaining_unfulfilled_quantity ?? 0) > 0
  );
}

export function canUnfulfillOrder(order: OrderActionSnapshot) {
  return order.order_status === "fulfilled" && !isCanceledOrder(order);
}

export function canMarkOrderPaid(order: OrderActionSnapshot) {
  return (
    order.payment_provider === "offline" &&
    order.payment_method === "pay_at_pickup" &&
    paymentCorrectionOrderStatuses.has(order.order_status ?? "") &&
    ["pay_at_pickup", "unpaid"].includes(order.payment_status ?? "")
  );
}

export function canMarkOrderUnpaid(order: OrderActionSnapshot) {
  return (
    order.payment_provider === "offline" &&
    order.payment_method === "pay_at_pickup" &&
    paymentCorrectionOrderStatuses.has(order.order_status ?? "") &&
    order.payment_status === "paid"
  );
}

export function canArchiveOrder(order: OrderActionSnapshot) {
  return !order.archived_at;
}

export function canUnarchiveOrder(order: OrderActionSnapshot) {
  return Boolean(order.archived_at);
}

export function canResendOrderConfirmation(order: OrderActionSnapshot) {
  return !isCanceledOrder(order);
}

export function canBulkMarkOrderFulfilled(order: OrderActionSnapshot) {
  return !order.archived_at && canMarkOrderFulfilled(order);
}

export function canBulkMarkOrderPaid(order: OrderActionSnapshot) {
  return !order.archived_at && canMarkOrderPaid(order);
}

export function canBulkArchiveOrder(order: OrderActionSnapshot) {
  return canArchiveOrder(order);
}

export function canBulkUnarchiveOrder(order: OrderActionSnapshot) {
  return canUnarchiveOrder(order);
}

function isCanceledOrder(order: OrderActionSnapshot) {
  return order.order_status === "canceled" || Boolean(order.canceled_at);
}
