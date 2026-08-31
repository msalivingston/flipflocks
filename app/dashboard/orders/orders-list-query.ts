export const ORDERS_PER_PAGE = 50;
export const ORDER_SEARCH_DEBOUNCE_MS = 350;

export type OrderListArchiveView = "active" | "archived";
export type OrderListFilter =
  | "ready_for_pickup"
  | "completed"
  | "canceled"
  | "all";
export type OrderListSort = "newest" | "oldest" | "buyer_name" | "order_total";

export type OrderListCriteria = {
  archiveView: OrderListArchiveView;
  filter: OrderListFilter;
  page: number;
  pickupOptionId: string | null;
  search: string;
  sort: OrderListSort;
  storeId: string;
};

export function getOrderPageOffset(page: number) {
  return (Math.max(1, page) - 1) * ORDERS_PER_PAGE;
}

export function getOrderTotalPages(totalOrders: number) {
  return Math.max(1, Math.ceil(totalOrders / ORDERS_PER_PAGE));
}

export function getLastValidOrderPage(page: number, totalOrders: number) {
  return Math.min(Math.max(1, page), getOrderTotalPages(totalOrders));
}

export function buildOrderListRpcParams(criteria: OrderListCriteria) {
  return {
    p_archive_view: criteria.archiveView,
    p_limit: ORDERS_PER_PAGE,
    p_offset: getOrderPageOffset(criteria.page),
    p_pickup_option_id: criteria.pickupOptionId,
    p_search: criteria.search.trim() || null,
    p_sort: criteria.sort,
    p_status_filter: criteria.archiveView === "archived" ? "all" : criteria.filter,
    p_store_id: criteria.storeId,
  };
}

export function getOrderPaginationPages(currentPage: number, totalPages: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: Array<number | "ellipsis"> = [1];
  const middleStart = Math.max(2, currentPage - 1);
  const middleEnd = Math.min(totalPages - 1, currentPage + 1);

  if (middleStart > 2) pages.push("ellipsis");

  for (let page = middleStart; page <= middleEnd; page += 1) {
    pages.push(page);
  }

  if (middleEnd < totalPages - 1) pages.push("ellipsis");
  pages.push(totalPages);

  return pages;
}

export function getSelectedOrderRecords<T>(
  selectedIds: Set<string>,
  snapshots: Record<string, T>,
) {
  return Array.from(selectedIds)
    .map((orderId) => snapshots[orderId])
    .filter((record): record is T => record !== undefined);
}
