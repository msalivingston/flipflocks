"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
} from "../_components/seller-ui";
import {
  formatCurrency,
  formatDateTime,
  formatInventoryLabel,
  formatOrderLifecycle,
  formatPaymentMethod,
  getOrderLifecycleState,
  type OrderLifecycleState,
} from "./order-formatters";

type OrderFilter =
  | "needs_attention"
  | "ready_for_pickup"
  | "completed"
  | "canceled"
  | "all";

type OrderSort = "newest" | "oldest" | "buyer_name" | "order_total";
type PickupNoteFilter = "__all__" | "__none__" | string;

type SellerOrderRow = {
  order_id: string;
  order_number: string;
  order_source: string | null;
  order_status: string;
  payment_method: string | null;
  payment_status: string | null;
  created_at: string;
  ready_for_pickup_at: string | null;
  fulfilled_at: string | null;
  canceled_at: string | null;
  buyer_first_name_snapshot: string | null;
  buyer_last_name_snapshot: string | null;
  buyer_email_snapshot: string | null;
  buyer_phone_snapshot: string | null;
  pickup_note: string | null;
  buyer_notes: string | null;
  total_amount: number | null;
  item_count: number | null;
  total_item_quantity: number | null;
  pickup_option_label_snapshot: string | null;
};

type SellerOrderItemRow = {
  order_id: string;
  order_item_id: string;
  species_name_snapshot: string | null;
  breed_display_name_snapshot: string | null;
  inventory_type_snapshot: string | null;
  custom_inventory_label_snapshot: string | null;
  hatch_date_snapshot: string | null;
  available_date_snapshot: string | null;
  age_at_sale_days_snapshot: number | null;
  order_item_source: string | null;
  custom_item_name_snapshot: string | null;
  product_type_snapshot: string | null;
  item_name_snapshot: string | null;
  item_category_snapshot: string | null;
  unit_price_snapshot: number | null;
  quantity: number;
  line_subtotal: number | null;
};

const orderFilters: { label: string; value: OrderFilter }[] = [
  { label: "Needs attention", value: "needs_attention" },
  { label: "Ready for pickup", value: "ready_for_pickup" },
  { label: "Completed", value: "completed" },
  { label: "Canceled", value: "canceled" },
  { label: "All", value: "all" },
];

const orderSortOptions: { label: string; value: OrderSort }[] = [
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
  { label: "Buyer name", value: "buyer_name" },
  { label: "Order total", value: "order_total" },
];

/**
 * Seller-facing order intake list for storefront pay-at-pickup requests.
 * Actions stay on the detail page so this view remains a fast work queue.
 */
export function OrdersList() {
  const { seller } = useSellerContext();
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [orderItemsByOrderId, setOrderItemsByOrderId] = useState<
    Record<string, SellerOrderItemRow[]>
  >({});
  const [filter, setFilter] = useState<OrderFilter>("needs_attention");
  const [pickupNoteFilter, setPickupNoteFilter] =
    useState<PickupNoteFilter>("__all__");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<OrderSort>("newest");
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [expandedBuyerOrderId, setExpandedBuyerOrderId] =
    useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadOrders() {
      if (!seller) return;

      setIsLoading(true);
      setError(null);

      const orderResult = await supabase
        .from("seller_order_management")
        .select(
          "order_id, order_number, order_source, order_status, payment_method, payment_status, created_at, ready_for_pickup_at, fulfilled_at, canceled_at, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_email_snapshot, buyer_phone_snapshot, pickup_note, buyer_notes, total_amount, item_count, total_item_quantity, pickup_option_label_snapshot",
        )
        .eq("store_id", seller.store_id)
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<SellerOrderRow[]>();

      if (!isMounted) return;

      if (orderResult.error) {
        setError(orderResult.error.message);
        setIsLoading(false);
        return;
      }

      const nextOrders = orderResult.data ?? [];
      const orderIds = nextOrders.map((order) => order.order_id);
      let nextItemsByOrderId: Record<string, SellerOrderItemRow[]> = {};

      if (orderIds.length > 0) {
        const itemResult = await supabase
          .from("seller_order_item_detail")
          .select(
            "order_id, order_item_id, species_name_snapshot, breed_display_name_snapshot, inventory_type_snapshot, custom_inventory_label_snapshot, hatch_date_snapshot, available_date_snapshot, age_at_sale_days_snapshot, order_item_source, custom_item_name_snapshot, product_type_snapshot, item_name_snapshot, item_category_snapshot, unit_price_snapshot, quantity, line_subtotal",
          )
          .eq("store_id", seller.store_id)
          .in("order_id", orderIds)
          .order("created_at", { ascending: true })
          .returns<SellerOrderItemRow[]>();

        if (!isMounted) return;

        if (itemResult.error) {
          setError(itemResult.error.message);
          setIsLoading(false);
          return;
        }

        nextItemsByOrderId = groupOrderItemsByOrderId(itemResult.data ?? []);
      }

      setOrders(nextOrders);
      setOrderItemsByOrderId(nextItemsByOrderId);
      setExpandedOrderId(null);
      setExpandedBuyerOrderId(null);
      setIsLoading(false);
    }

    void loadOrders();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const pickupNoteOptions = useMemo(
    () => getPickupNoteOptions(orders),
    [orders],
  );
  const baseFilteredOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          matchesSearch(order, searchQuery, orderItemsByOrderId[order.order_id]) &&
          matchesPickupNoteFilter(order, pickupNoteFilter),
      ),
    [orderItemsByOrderId, orders, pickupNoteFilter, searchQuery],
  );
  const visibleOrders = useMemo(
    () =>
      sortOrders(
        baseFilteredOrders.filter((order) => matchesFilter(order, filter)),
        sort,
      ),
    [baseFilteredOrders, filter, sort],
  );
  const filterCounts = useMemo(
    () => getFilterCounts(baseFilteredOrders),
    [baseFilteredOrders],
  );
  const visibleOrderIds = useMemo(
    () => visibleOrders.map((order) => order.order_id),
    [visibleOrders],
  );
  const selectedVisibleCount = visibleOrderIds.filter((orderId) =>
    selectedOrderIds.has(orderId),
  ).length;
  const hasVisibleOrders = visibleOrders.length > 0;
  const allVisibleSelected =
    hasVisibleOrders && selectedVisibleCount === visibleOrders.length;
  const hasSearchOrPickupFilter =
    searchQuery.trim().length > 0 || pickupNoteFilter !== "__all__";

  function clearSelection() {
    setSelectedOrderIds(new Set());
  }

  function updateFilter(nextFilter: OrderFilter) {
    setFilter(nextFilter);
    clearSelection();
  }

  function updatePickupNoteFilter(nextFilter: string) {
    setPickupNoteFilter(nextFilter);
    clearSelection();
  }

  function updateSearchQuery(nextQuery: string) {
    setSearchQuery(nextQuery);
    clearSelection();
  }

  function toggleExpandedOrder(orderId: string) {
    setExpandedOrderId((current) => (current === orderId ? null : orderId));
  }

  function toggleExpandedBuyer(orderId: string) {
    setExpandedBuyerOrderId((current) => (current === orderId ? null : orderId));
  }

  function toggleOrderSelection(orderId: string) {
    setSelectedOrderIds((current) => {
      const next = new Set(current);

      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }

      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelectedOrderIds((current) => {
      if (allVisibleSelected) return new Set();

      return new Set([...current, ...visibleOrderIds]);
    });
  }

  if (isLoading) {
    return <LoadingState label="Loading orders" />;
  }

  if (error) {
    return (
      <ErrorState
        message="Orders could not load. Please refresh the page and try again."
        title="Orders need attention"
      />
    );
  }

  return (
    <div className="grid gap-4">
      <SellerCard className="rounded-2xl p-3 shadow-[0_16px_38px_rgba(46,39,25,0.05)] sm:p-4">
        <div className="grid gap-3">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_13rem_11rem]">
            <label className="relative block">
              <span className="sr-only">Search orders</span>
              <Image
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-70"
                src="/glyphs/looking-glass.png"
                alt=""
                width={18}
                height={18}
              />
              <input
                className="seller-form-field min-h-12 rounded-lg"
                placeholder="Search orders by buyer, order #, phone, item, or pickup notes"
                style={{ paddingLeft: "3.5rem" }}
                type="search"
                value={searchQuery}
                onChange={(event) => updateSearchQuery(event.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">Pickup notes filter</span>
              <select
                className="seller-form-field min-h-12 rounded-lg font-medium"
                value={pickupNoteFilter}
                onChange={(event) => updatePickupNoteFilter(event.target.value)}
              >
                <option value="__all__">All pickup notes</option>
                {pickupNoteOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Sort orders</span>
              <select
                className="seller-form-field min-h-12 rounded-lg font-medium"
                value={sort}
                onChange={(event) => setSort(event.target.value as OrderSort)}
              >
                {orderSortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <OrderLifecycleFilters
            counts={filterCounts}
            value={filter}
            onChange={updateFilter}
          />
        </div>
      </SellerCard>

      {hasVisibleOrders ? (
        <OrdersTableCard
          allVisibleSelected={allVisibleSelected}
          expandedBuyerOrderId={expandedBuyerOrderId}
          expandedOrderId={expandedOrderId}
          itemsByOrderId={orderItemsByOrderId}
          orders={visibleOrders}
          selectedOrderIds={selectedOrderIds}
          selectedVisibleCount={selectedVisibleCount}
          onClearSelection={clearSelection}
          onToggleExpandedBuyer={toggleExpandedBuyer}
          onToggleExpandedOrder={toggleExpandedOrder}
          onToggleOrderSelection={toggleOrderSelection}
          onToggleSelectAll={toggleSelectAllOnPage}
        />
      ) : (
        <EmptyState
          title={getEmptyTitle(filter, hasSearchOrPickupFilter)}
          description={
            hasSearchOrPickupFilter
              ? "Try a different search or pickup notes filter."
              : "Try a different status to review older orders."
          }
        />
      )}
    </div>
  );
}

function OrdersTableCard({
  allVisibleSelected,
  expandedBuyerOrderId,
  expandedOrderId,
  itemsByOrderId,
  orders,
  selectedOrderIds,
  selectedVisibleCount,
  onClearSelection,
  onToggleExpandedBuyer,
  onToggleExpandedOrder,
  onToggleOrderSelection,
  onToggleSelectAll,
}: {
  allVisibleSelected: boolean;
  expandedBuyerOrderId: string | null;
  expandedOrderId: string | null;
  itemsByOrderId: Record<string, SellerOrderItemRow[]>;
  orders: SellerOrderRow[];
  selectedOrderIds: Set<string>;
  selectedVisibleCount: number;
  onClearSelection: () => void;
  onToggleExpandedBuyer: (orderId: string) => void;
  onToggleExpandedOrder: (orderId: string) => void;
  onToggleOrderSelection: (orderId: string) => void;
  onToggleSelectAll: () => void;
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const isPartiallySelected =
    selectedVisibleCount > 0 && selectedVisibleCount < orders.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isPartiallySelected;
    }
  }, [isPartiallySelected]);

  return (
    <SellerCard className="overflow-hidden rounded-2xl border-stone-200/80 shadow-[0_16px_38px_rgba(46,39,25,0.05)]">
      <div className="flex flex-col gap-3 border-b border-stone-200/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex min-h-10 items-center gap-3 text-sm font-medium text-stone-950">
          <input
            ref={selectAllRef}
            aria-label="Select all orders on this page"
            checked={allVisibleSelected}
            className="size-5 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
            type="checkbox"
            onChange={onToggleSelectAll}
          />
          Select all on this page
        </label>

        {selectedVisibleCount > 0 ? (
          <BulkActions
            selectedCount={selectedVisibleCount}
            onClearSelection={onClearSelection}
          />
        ) : null}
      </div>

      <div
        aria-hidden="true"
        className="hidden grid-cols-[2.25rem_minmax(9rem,10.5rem)_minmax(6.5rem,7.5rem)_minmax(0,1.6fr)_minmax(4.75rem,5.75rem)_minmax(7rem,8.25rem)_5.5rem] gap-3 bg-[#fbfaf6] px-4 py-3 text-xs font-medium uppercase tracking-[0.08em] text-stone-600 xl:grid"
      >
        <span />
        <span>Order</span>
        <span>Date</span>
        <span>Buyer</span>
        <span>Total</span>
        <span>Payment</span>
        <span className="text-right">Open</span>
      </div>

      <div className="divide-y divide-stone-200/80">
        {orders.map((order) => (
          <OrderRow
            isBuyerExpanded={expandedBuyerOrderId === order.order_id}
            isExpanded={expandedOrderId === order.order_id}
            isSelected={selectedOrderIds.has(order.order_id)}
            items={itemsByOrderId[order.order_id] ?? []}
            key={order.order_id}
            order={order}
            onToggleBuyer={() => onToggleExpandedBuyer(order.order_id)}
            onToggleExpanded={() => onToggleExpandedOrder(order.order_id)}
            onToggleSelection={() => onToggleOrderSelection(order.order_id)}
          />
        ))}
      </div>
    </SellerCard>
  );
}

function BulkActions({
  selectedCount,
  onClearSelection,
}: {
  selectedCount: number;
  onClearSelection: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      <span className="text-xs font-medium text-stone-500">
        {selectedCount} selected
      </span>
      <button
        className="seller-small-button min-h-10 gap-2 rounded-md px-3 disabled:cursor-not-allowed disabled:opacity-60"
        disabled
        title="Print orders is not wired yet."
        type="button"
      >
        <Image src="/glyphs/clipboard.png" alt="" width={16} height={16} />
        Print orders
      </button>
      <button
        className="seller-small-button min-h-10 rounded-md px-3 disabled:cursor-not-allowed disabled:opacity-60"
        disabled
        title="Bulk actions are not wired yet."
        type="button"
      >
        More actions
      </button>
      <button
        className="min-h-10 rounded-md px-3 text-sm font-medium text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
        type="button"
        onClick={onClearSelection}
      >
        Clear selection
      </button>
    </div>
  );
}

function OrderRow({
  isBuyerExpanded,
  isExpanded,
  isSelected,
  items,
  order,
  onToggleBuyer,
  onToggleExpanded,
  onToggleSelection,
}: {
  isBuyerExpanded: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  items: SellerOrderItemRow[];
  order: SellerOrderRow;
  onToggleBuyer: () => void;
  onToggleExpanded: () => void;
  onToggleSelection: () => void;
}) {
  const customerName = formatCustomerName(order);
  const lifecycle = getOrderLifecycleState(order);
  const pickupNote = order.pickup_note?.trim();
  const mobileDetailsId = `mobile-order-details-${order.order_id}`;
  const desktopBuyerDetailsId = `desktop-buyer-details-${order.order_id}`;
  const desktopDetailsId = `desktop-order-items-${order.order_id}`;
  const itemSummary = formatOrderItems(order);
  const paymentSummary = formatPaymentSummary(order);

  return (
    <article className="bg-white transition hover:bg-[#fffdf8]">
      <div className="grid gap-3 px-4 py-3 xl:hidden">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3">
          <label className="flex min-h-10 items-start pt-1">
            <input
              aria-label={`Select order ${order.order_number}`}
              checked={isSelected}
              className="size-5 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
              type="checkbox"
              onChange={onToggleSelection}
            />
          </label>

          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Link
                className="text-base font-medium text-stone-950 hover:text-emerald-800"
                href={`/dashboard/orders/${order.order_id}`}
              >
                #{order.order_number}
              </Link>
              <OrderLifecycleBadge
                label={formatOrderLifecycle(order)}
                lifecycle={lifecycle}
              />
            </div>
            <p className="mt-1 truncate text-sm text-stone-950">
              {customerName}
            </p>
            <p className="mt-1 text-sm leading-5 text-stone-600">
              {formatOrderItems(order)} · {formatCurrency(order.total_amount)}
            </p>
            <p className="mt-0.5 text-sm leading-5 text-stone-500">
              {formatDateTime(order.created_at)}
            </p>
          </div>

          <button
            aria-controls={mobileDetailsId}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded ? "Hide order details" : "Show order details"
            }
            className="flex size-10 items-center justify-center rounded-md border border-stone-200 bg-white text-lg font-medium text-emerald-900 transition hover:bg-[#fbfaf6] focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
            type="button"
            onClick={onToggleExpanded}
          >
            <span aria-hidden="true">{isExpanded ? "^" : "v"}</span>
          </button>
        </div>

        {isExpanded ? (
          <div
            className="grid gap-3 border-t border-stone-200/80 pt-3"
            id={mobileDetailsId}
          >
            <OrderItemsQuickview items={items} />

            <div className="grid gap-2 text-sm text-stone-700">
              {order.buyer_phone_snapshot ? (
                <a
                  className="inline-flex min-w-0 items-center gap-2 hover:text-emerald-800"
                  href={`tel:${order.buyer_phone_snapshot}`}
                >
                  <Image src="/glyphs/phone.png" alt="" width={16} height={16} />
                  <span className="truncate">{order.buyer_phone_snapshot}</span>
                </a>
              ) : null}
              {order.buyer_email_snapshot ? (
                <a
                  className="inline-flex min-w-0 items-center gap-2 hover:text-emerald-800"
                  href={`mailto:${order.buyer_email_snapshot}`}
                >
                  <Image
                    src="/glyphs/envelope.png"
                    alt=""
                    width={16}
                    height={16}
                  />
                  <span className="truncate">
                    {order.buyer_email_snapshot}
                  </span>
                </a>
              ) : null}
              {pickupNote ? (
                <p className="min-w-0 text-stone-600">
                  <span className="font-medium text-stone-700">Note:</span>{" "}
                  {pickupNote}
                </p>
              ) : null}
            <p>
                <span className="font-medium text-stone-700">Payment:</span>{" "}
                {paymentSummary}
              </p>
            </div>

            <div className="grid gap-2">
              <Link
                className="inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-md bg-emerald-800 px-3 text-sm font-medium text-white shadow-[0_8px_18px_rgba(4,120,87,0.14)] transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
                href={`/dashboard/orders/${order.order_id}`}
              >
                View order
                <span aria-hidden="true" className="text-lg leading-none">
                  &rarr;
                </span>
              </Link>
              <OrderContactButtons order={order} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="hidden gap-3 px-4 py-2.5 xl:grid xl:grid-cols-[2.25rem_minmax(9rem,10.5rem)_minmax(6.5rem,7.5rem)_minmax(0,1.6fr)_minmax(4.75rem,5.75rem)_minmax(7rem,8.25rem)_5.5rem] xl:items-center">
        <label className="flex min-h-6 items-center gap-3">
          <input
            aria-label={`Select order ${order.order_number}`}
            checked={isSelected}
            className="size-5 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
            type="checkbox"
            onChange={onToggleSelection}
          />
          <span className="sr-only">Select order</span>
        </label>

        <div className="flex min-w-0 items-center gap-1 text-sm">
          <Link
            className="shrink-0 text-stone-950 hover:text-emerald-800"
            href={`/dashboard/orders/${order.order_id}`}
          >
            #{order.order_number}
          </Link>
          <span className="shrink-0 text-stone-500">-</span>
          <button
            aria-controls={desktopDetailsId}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? `Hide items in order ${order.order_number}`
                : `Show items in order ${order.order_number}`
            }
            className="inline-flex min-w-0 items-center gap-1.5 text-left text-emerald-800 underline-offset-4 transition hover:text-emerald-900 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
            type="button"
            onClick={onToggleExpanded}
          >
            <span className="truncate">{itemSummary}</span>
            <span aria-hidden="true" className="text-xs leading-none">
              {isExpanded ? "\u25B4" : "\u25BE"}
            </span>
          </button>
        </div>

        <p className="min-w-0 truncate text-sm text-stone-500">
          {formatShortDate(order.created_at)}
        </p>

        <div className="min-w-0">
          <button
            aria-controls={desktopBuyerDetailsId}
            aria-expanded={isBuyerExpanded}
            aria-label={
              isBuyerExpanded
                ? `Hide contact details for ${customerName}`
                : `Show contact details for ${customerName}`
            }
            className="inline-flex max-w-full items-center gap-1.5 text-left text-sm text-stone-950 transition hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
            type="button"
            onClick={onToggleBuyer}
          >
            <span className="truncate">{customerName}</span>
            <span aria-hidden="true" className="text-xs leading-none">
              {isBuyerExpanded ? "\u25B4" : "\u25BE"}
            </span>
          </button>
          {isBuyerExpanded ? (
            <div
              className="mt-1 grid gap-0.5 text-xs leading-5 text-stone-600"
              id={desktopBuyerDetailsId}
            >
              {order.buyer_phone_snapshot ? (
                <a
                  className="truncate hover:text-emerald-800"
                  href={`tel:${order.buyer_phone_snapshot}`}
                >
                  {order.buyer_phone_snapshot}
                </a>
              ) : null}
              {order.buyer_email_snapshot ? (
                <a
                  className="truncate hover:text-emerald-800"
                  href={`mailto:${order.buyer_email_snapshot}`}
                >
                  {order.buyer_email_snapshot}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="min-w-0 truncate text-sm text-stone-950">
          {formatCurrency(order.total_amount)}
        </p>

        <p className="min-w-0 truncate text-sm text-stone-950">
          {paymentSummary}
        </p>

        <Link
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 text-sm text-emerald-800 transition hover:border-emerald-700 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
          href={`/dashboard/orders/${order.order_id}`}
        >
          View
          <span aria-hidden="true" className="text-lg leading-none">
            &rarr;
          </span>
        </Link>
      </div>

      {isExpanded ? (
        <div
          className="hidden border-t border-stone-200/80 bg-[#fffdf8] px-4 py-3 xl:block"
          id={desktopDetailsId}
        >
          <div className="pl-[calc(2.25rem+0.75rem)]">
            <OrderItemsQuickview items={items} />
          </div>
        </div>
      ) : null}
    </article>
  );
}

function OrderItemsQuickview({ items }: { items: SellerOrderItemRow[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-200 bg-white px-3 py-2 text-sm text-stone-500">
        Item details are not available for this order.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-stone-500">
        Items in order
      </p>
      <div className="grid gap-1.5">
        {items.map((item) => {
          const { details, title } = formatOrderItemSummary(item);

          return (
            <div
              className="grid gap-1 rounded-lg border border-stone-200/80 bg-white px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              key={item.order_item_id}
            >
              <div className="min-w-0">
                <p className="truncate text-stone-950">
                  {item.quantity} &times; {title}
                </p>
                {details ? (
                  <p className="mt-0.5 truncate text-xs text-stone-500">
                    {details}
                  </p>
                ) : null}
              </div>
              <p className="text-sm text-stone-600 sm:text-right">
                {formatCurrency(item.line_subtotal)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrderLifecycleFilters({
  counts,
  onChange,
  value,
}: {
  counts: Record<OrderFilter, number>;
  onChange: (value: OrderFilter) => void;
  value: OrderFilter;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {orderFilters.map((filter) => {
        const isActive = value === filter.value;

        return (
          <button
            aria-pressed={isActive}
            className={`min-h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-700/30 ${
              isActive
                ? "border-emerald-800 bg-emerald-800 text-white"
                : "border-stone-300 bg-white text-stone-700 hover:border-emerald-700 hover:text-emerald-800"
            }`}
            key={filter.value}
            type="button"
            onClick={() => onChange(filter.value)}
          >
            {filter.label}
            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                isActive ? "bg-white/20 text-white" : "bg-stone-100 text-stone-600"
              }`}
            >
              {counts[filter.value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function OrderContactButtons({
  order,
  variant = "mobile",
}: {
  order: SellerOrderRow;
  variant?: "desktop" | "mobile";
}) {
  const buttonClass =
    variant === "desktop"
      ? "seller-small-button size-8 rounded-md p-0"
      : "seller-small-button min-h-9 rounded-md p-0";

  return (
    <div
      className={
        variant === "desktop"
          ? "flex shrink-0 items-center gap-1"
          : "grid max-w-full grid-cols-3 gap-1.5 xl:w-full"
      }
    >
      {order.buyer_phone_snapshot ? (
        <a
          aria-label={`Call ${formatCustomerName(order)}`}
          className={buttonClass}
          href={`tel:${order.buyer_phone_snapshot}`}
          title="Call buyer"
        >
          <Image src="/glyphs/phone.png" alt="" width={16} height={16} />
        </a>
      ) : variant === "mobile" ? (
        <span aria-hidden="true" />
      ) : null}
      {variant === "mobile" && order.buyer_phone_snapshot ? (
        <a
          aria-label={`Text ${formatCustomerName(order)}`}
          className={buttonClass}
          href={`sms:${order.buyer_phone_snapshot}`}
          title="Text buyer"
        >
          <Image src="/glyphs/chat.png" alt="" width={16} height={16} />
        </a>
      ) : variant === "mobile" ? (
        <span aria-hidden="true" />
      ) : null}
      {order.buyer_email_snapshot ? (
        <a
          aria-label={`Email ${formatCustomerName(order)}`}
          className={buttonClass}
          href={`mailto:${order.buyer_email_snapshot}`}
          title="Email buyer"
        >
          <Image src="/glyphs/envelope.png" alt="" width={16} height={16} />
        </a>
      ) : variant === "mobile" ? (
        <span aria-hidden="true" />
      ) : null}
    </div>
  );
}

function OrderLifecycleBadge({
  label,
  lifecycle,
}: {
  label: string;
  lifecycle: OrderLifecycleState;
}) {
  const tone =
    lifecycle === "completed"
      ? "bg-emerald-100 text-emerald-800"
      : lifecycle === "ready_for_pickup"
        ? "bg-sky-100 text-sky-800"
        : lifecycle === "canceled"
          ? "bg-red-100 text-red-800"
          : "bg-amber-100 text-amber-800";

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

function matchesFilter(order: SellerOrderRow, filter: OrderFilter) {
  if (filter === "all") return true;

  return getOrderLifecycleState(order) === filter;
}

function matchesPickupNoteFilter(
  order: SellerOrderRow,
  filter: PickupNoteFilter,
) {
  if (filter === "__all__") return true;

  const pickupNote = normalizeFilterText(order.pickup_note);

  if (filter === "__none__") return !pickupNote;

  return pickupNote === normalizeFilterText(filter);
}

function matchesSearch(
  order: SellerOrderRow,
  query: string,
  items: SellerOrderItemRow[] = [],
) {
  const normalizedQuery = normalizeFilterText(query);

  if (!normalizedQuery) return true;

  return getOrderSearchText(order, items).includes(normalizedQuery);
}

function getOrderSearchText(
  order: SellerOrderRow,
  items: SellerOrderItemRow[] = [],
) {
  return normalizeFilterText(
    [
      order.order_number,
      formatCustomerName(order),
      order.buyer_phone_snapshot,
      order.buyer_email_snapshot,
      formatOrderItems(order),
      formatCurrency(order.total_amount),
      order.pickup_note,
      order.pickup_option_label_snapshot,
      order.buyer_notes,
      ...items.map((item) => getOrderItemSearchText(item)),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function normalizeFilterText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function groupOrderItemsByOrderId(items: SellerOrderItemRow[]) {
  return items.reduce<Record<string, SellerOrderItemRow[]>>((groups, item) => {
    groups[item.order_id] = [...(groups[item.order_id] ?? []), item];
    return groups;
  }, {});
}

function getFilterCounts(orders: SellerOrderRow[]) {
  const counts: Record<OrderFilter, number> = {
    all: orders.length,
    canceled: 0,
    completed: 0,
    needs_attention: 0,
    ready_for_pickup: 0,
  };

  for (const order of orders) {
    counts[getOrderLifecycleState(order)] += 1;
  }

  return counts;
}

function getPickupNoteOptions(orders: SellerOrderRow[]) {
  const notes = new Map<string, string>();
  let hasEmptyNote = false;

  for (const order of orders) {
    const note = order.pickup_note?.trim();

    if (!note) {
      hasEmptyNote = true;
      continue;
    }

    notes.set(normalizeFilterText(note), note);
  }

  const options = [...notes.values()]
    .sort((first, second) => first.localeCompare(second))
    .map((note) => ({ label: note, value: note }));

  if (hasEmptyNote) {
    options.push({ label: "No pickup notes", value: "__none__" });
  }

  return options;
}

function sortOrders(orders: SellerOrderRow[], sort: OrderSort) {
  return [...orders].sort((first, second) => {
    if (sort === "oldest") {
      return dateValue(first.created_at) - dateValue(second.created_at);
    }

    if (sort === "buyer_name") {
      return formatCustomerName(first).localeCompare(formatCustomerName(second));
    }

    if (sort === "order_total") {
      return (second.total_amount ?? 0) - (first.total_amount ?? 0);
    }

    return dateValue(second.created_at) - dateValue(first.created_at);
  });
}

function dateValue(value: string | null | undefined) {
  return value ? new Date(value).getTime() : 0;
}

function formatCustomerName(order: SellerOrderRow) {
  return (
    [order.buyer_first_name_snapshot, order.buyer_last_name_snapshot]
      .filter(Boolean)
      .join(" ") || "Buyer"
  );
}

function formatOrderItems(order: SellerOrderRow) {
  const itemCount = order.item_count ?? 0;

  return `${itemCount} item${itemCount === 1 ? "" : "s"}`;
}

function formatOrderItemSummary(item: SellerOrderItemRow) {
  const isCustomItem = item.order_item_source === "custom";
  const isEquipmentItem = item.order_item_source === "equipment_inventory";
  const isProcessedPoultryItem =
    item.order_item_source === "processed_poultry_inventory";
  const inventoryLabel = formatInventoryLabel({
    custom_inventory_label: item.custom_inventory_label_snapshot,
    inventory_type: item.inventory_type_snapshot,
  });
  const title =
    isEquipmentItem || isProcessedPoultryItem
      ? item.item_name_snapshot || item.breed_display_name_snapshot
      : item.custom_item_name_snapshot || item.breed_display_name_snapshot;
  const fallbackTitle =
    item.item_name_snapshot ||
    item.custom_item_name_snapshot ||
    item.breed_display_name_snapshot ||
    "Order item";
  const category = isCustomItem
    ? "Custom item"
    : isEquipmentItem
      ? [item.item_category_snapshot, item.custom_inventory_label_snapshot]
          .filter(Boolean)
          .join(" - ") || "Equipment & Supplies"
      : isProcessedPoultryItem
        ? [item.item_category_snapshot, item.custom_inventory_label_snapshot]
            .filter(Boolean)
            .join(" - ") || "Processed Poultry"
        : item.species_name_snapshot;
  const details = [
    category,
    !isCustomItem && !isEquipmentItem && !isProcessedPoultryItem
      ? formatSellerItemDetail(inventoryLabel)
      : null,
    !isCustomItem &&
    !isEquipmentItem &&
    !isProcessedPoultryItem &&
    item.age_at_sale_days_snapshot != null
      ? formatAgeAtSale(item.age_at_sale_days_snapshot)
      : null,
  ]
    .filter(Boolean)
    .join(" - ");

  return {
    details,
    title: title || fallbackTitle,
  };
}

function getOrderItemSearchText(item: SellerOrderItemRow) {
  const summary = formatOrderItemSummary(item);

  return [
    summary.title,
    summary.details,
    item.product_type_snapshot,
    item.item_category_snapshot,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatSellerItemDetail(value: string | null) {
  const normalized = value?.trim();

  if (!normalized) return null;

  const lower = normalized.toLowerCase();

  if (lower === "female") return "Female";
  if (lower === "male") return "Male";
  if (lower === "straight run") return "Straight run";
  if (lower === "unknown") return "Unknown";

  return normalized;
}

function formatAgeAtSale(days: number) {
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} old`;

  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} old`;
}

function formatPaymentSummary(order: SellerOrderRow) {
  if (order.payment_status === "paid") return "Paid";
  if (order.payment_status === "refunded") return "Refunded";
  if (order.payment_status === "unpaid") return "Unpaid";

  return order.payment_method === "pay_at_pickup"
    ? "Pay at pickup"
    : formatPaymentMethod(order.payment_method);
}

function formatShortDate(value: string | null) {
  if (!value) return "Date not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function getEmptyTitle(filter: OrderFilter, hasSearchOrPickupFilter: boolean) {
  if (hasSearchOrPickupFilter) return "No orders match that search.";

  if (filter === "needs_attention") return "No orders need attention right now.";
  if (filter === "ready_for_pickup") return "No orders are ready for pickup.";
  if (filter === "completed") return "No completed orders yet.";
  if (filter === "canceled") return "No canceled orders.";

  return "No orders yet.";
}
