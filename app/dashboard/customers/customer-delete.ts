export const CUSTOMER_HAS_ORDER_HISTORY_ERROR =
  "CUSTOMER_HAS_ORDER_HISTORY";

export const CUSTOMER_ORDER_HISTORY_MESSAGE =
  "Customers with order history cannot be deleted.";

export function isCustomerOrderHistoryDeleteError(message?: string | null) {
  return message?.includes(CUSTOMER_HAS_ORDER_HISTORY_ERROR) ?? false;
}
