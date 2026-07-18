"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
} from "../_components/seller-ui";
import {
  OrderPrintDocument,
  type PrintableOrder,
  type PrintableOrderItem,
  type PrintableStoreLogo,
} from "./_components/order-print-document";
import {
  formatCurrency,
  formatDateTime,
  formatInventoryLabel,
  getOrderLifecycleState,
} from "./order-formatters";
import { downloadPickupSummaryReports } from "./pickup-summary-report-downloads";
import {
  type PickupSummaryExportFormat,
  type PickupSummaryLine,
  type PickupSummaryPayload,
  type PickupSummaryReport,
} from "./pickup-summary-report-data";

type OrderFilter =
  | "ready_for_pickup"
  | "completed"
  | "canceled"
  | "all";

type OrderArchiveView = "active" | "archived";
type OrderSort = "newest" | "oldest" | "buyer_name" | "order_total";
type PickupOptionFilter = "__all__" | string;

type PickupOption = {
  id: string;
  label: string;
};

type StoreDefaults = {
  pickup_method: "notes" | "manual_options" | null;
};

type SellerOrderRow = {
  order_id: string;
  order_number: string;
  order_source: string | null;
  order_status: string;
  payment_method: string | null;
  payment_status: string | null;
  payment_provider: string | null;
  created_at: string;
  ready_for_pickup_at: string | null;
  fulfilled_at: string | null;
  canceled_at: string | null;
  archived_at: string | null;
  archived_by: string | null;
  buyer_first_name_snapshot: string | null;
  buyer_last_name_snapshot: string | null;
  buyer_email_snapshot: string | null;
  buyer_phone_snapshot: string | null;
  pickup_note: string | null;
  buyer_notes: string | null;
  total_amount: number | null;
  item_count: number | null;
  total_item_quantity: number | null;
  pickup_option_id: string | null;
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

type OrderFilterCountRow = {
  order_status: string | null;
  ready_for_pickup_at: string | null;
};

type PickupSummaryOrder = {
  items: SellerOrderItemRow[];
  order: SellerOrderRow;
};

type BulkPrintOrder = {
  items: PrintableOrderItem[];
  order: PrintableOrder;
};

type BulkActionDialog =
  | {
      eligibleCount: number;
      kind: "fulfill";
      payableCount: number;
      selectedCount: number;
      skippedCount: number;
    }
  | {
      eligibleCount: number;
      kind: "mark_paid";
      selectedCount: number;
      skippedCount: number;
    }
  | {
      bothCount: number;
      eligibleCount: number;
      kind: "archive";
      selectedCount: number;
      skippedCount: number;
      unpaidCount: number;
      unfulfilledCount: number;
    }
  | {
      eligibleCount: number;
      kind: "unarchive";
      selectedCount: number;
      skippedCount: number;
    };

type BulkFulfillmentRpcResult = {
  fulfilled_count: number;
  payment_skipped_count: number;
  payment_updated_count: number;
  requested_count: number;
  skipped_count: number;
};

type BulkSimpleRpcResult = {
  requested_count: number;
  skipped_count: number;
  updated_count: number;
};

type CombinedOrderStatus = {
  description: string;
  label: string;
  tone: "canceled" | "completed" | "open" | "refunded" | "warning";
};

const orderFilters: { label: string; value: OrderFilter }[] = [
  { label: "Current", value: "all" },
  { label: "Ready for pickup", value: "ready_for_pickup" },
  { label: "Completed", value: "completed" },
  { label: "Canceled", value: "canceled" },
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
  const [orderArchiveCounts, setOrderArchiveCounts] = useState<
    Record<OrderArchiveView, number>
  >({
    active: 0,
    archived: 0,
  });
  const [activeFilterCounts, setActiveFilterCounts] = useState<
    Record<OrderFilter, number>
  >({
    all: 0,
    canceled: 0,
    completed: 0,
    ready_for_pickup: 0,
  });
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [archiveView, setArchiveView] = useState<OrderArchiveView>("active");
  const [pickupOptionFilter, setPickupOptionFilter] =
    useState<PickupOptionFilter>("__all__");
  const [pickupMethod, setPickupMethod] =
    useState<StoreDefaults["pickup_method"]>("notes");
  const [pickupOptions, setPickupOptions] = useState<PickupOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<OrderSort>("newest");
  const [isPickupSummaryOpen, setIsPickupSummaryOpen] = useState(false);
  const [bulkPrintOrders, setBulkPrintOrders] = useState<BulkPrintOrder[]>([]);
  const [bulkPrintStoreLogo, setBulkPrintStoreLogo] =
    useState<PrintableStoreLogo>(null);
  const [isBulkPrintLoading, setIsBulkPrintLoading] = useState(false);
  const [bulkPrintError, setBulkPrintError] = useState<string | null>(null);
  const [bulkActionDialog, setBulkActionDialog] =
    useState<BulkActionDialog | null>(null);
  const [bulkActionError, setBulkActionError] = useState<string | null>(null);
  const [bulkActionMessage, setBulkActionMessage] = useState<string | null>(null);
  const [bulkFulfillMarkPaid, setBulkFulfillMarkPaid] = useState(false);
  const [bulkArchiveAcknowledged, setBulkArchiveAcknowledged] = useState(false);
  const [isBulkActionSaving, setIsBulkActionSaving] = useState(false);
  const [isBulkActionsMenuOpen, setIsBulkActionsMenuOpen] = useState(false);
  const [isPrintPortalReady, setIsPrintPortalReady] = useState(false);
  const pendingBulkPrintRef = useRef(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [expandedBuyerOrderId, setExpandedBuyerOrderId] =
    useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setIsPrintPortalReady(true);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    if (!pendingBulkPrintRef.current || bulkPrintOrders.length === 0) return;

    pendingBulkPrintRef.current = false;
    runOrderPrint("bulk-order-print-active", () => {
      setBulkPrintOrders([]);
      setBulkPrintStoreLogo(null);
      setIsBulkPrintLoading(false);
    });
  }, [bulkPrintOrders]);

  useEffect(() => {
    let isMounted = true;

    async function loadOrders() {
      if (!seller) return;

      setIsLoading(true);
      setError(null);

      const baseOrderQuery = supabase
        .from("seller_order_management")
        .select(
          "order_id, order_number, order_source, order_status, payment_method, payment_status, payment_provider, created_at, ready_for_pickup_at, fulfilled_at, canceled_at, archived_at, archived_by, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_email_snapshot, buyer_phone_snapshot, pickup_note, buyer_notes, total_amount, item_count, total_item_quantity, pickup_option_id, pickup_option_label_snapshot",
        )
        .eq("store_id", seller.store_id);
      const orderQuery =
        archiveView === "archived"
          ? baseOrderQuery.not("archived_at", "is", null)
          : baseOrderQuery.is("archived_at", null);
      const [orderResult, defaultsResult, pickupOptionsResult] =
        await Promise.all([
          orderQuery
            .order("created_at", { ascending: false })
            .limit(100)
            .returns<SellerOrderRow[]>(),
          supabase
            .from("seller_store_defaults")
            .select("pickup_method")
            .eq("store_id", seller.store_id)
            .maybeSingle<StoreDefaults>(),
          supabase
            .from("store_pickup_options")
            .select("id, label")
            .eq("store_id", seller.store_id)
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
            .order("label", { ascending: true })
            .returns<PickupOption[]>(),
        ]);

      if (!isMounted) return;

      const firstError =
        orderResult.error ?? defaultsResult.error ?? pickupOptionsResult.error;

      if (firstError) {
        setError(firstError.message);
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
      setPickupMethod(defaultsResult.data?.pickup_method ?? "notes");
      setPickupOptions(pickupOptionsResult.data ?? []);
      setPickupOptionFilter("__all__");
      setExpandedOrderId(null);
      setExpandedBuyerOrderId(null);
      setIsLoading(false);
    }

    void loadOrders();

    return () => {
      isMounted = false;
    };
  }, [archiveView, refreshKey, seller]);

  useEffect(() => {
    let isMounted = true;

    async function loadArchiveCounts() {
      if (!seller) return;

      const [activeCountResult, archivedCountResult, activeLifecycleResult] =
        await Promise.all([
          supabase
            .from("seller_order_management")
            .select("order_id", { count: "exact", head: true })
            .eq("store_id", seller.store_id)
            .is("archived_at", null),
          supabase
            .from("seller_order_management")
            .select("order_id", { count: "exact", head: true })
            .eq("store_id", seller.store_id)
            .not("archived_at", "is", null),
          supabase
            .from("seller_order_management")
            .select("order_status, ready_for_pickup_at")
            .eq("store_id", seller.store_id)
            .is("archived_at", null)
            .returns<OrderFilterCountRow[]>(),
        ]);

      if (!isMounted) return;

      setOrderArchiveCounts({
        active: activeCountResult.count ?? 0,
        archived: archivedCountResult.count ?? 0,
      });
      setActiveFilterCounts(getFilterCounts(activeLifecycleResult.data ?? []));
    }

    void loadArchiveCounts();

    return () => {
      isMounted = false;
    };
  }, [refreshKey, seller]);

  const showPickupOptionFilter =
    pickupMethod === "manual_options";
  const selectedViewOrders = useMemo(
    () => orders.filter((order) => isOrderInArchiveView(order, archiveView)),
    [archiveView, orders],
  );
  const searchedOrders = useMemo(
    () =>
      selectedViewOrders.filter(
        (order) =>
          matchesSearch(order, searchQuery, orderItemsByOrderId[order.order_id]) &&
          matchesPickupOptionFilter(order, pickupOptionFilter),
      ),
    [orderItemsByOrderId, pickupOptionFilter, searchQuery, selectedViewOrders],
  );
  const visibleOrders = useMemo(
    () =>
      sortOrders(
        searchedOrders.filter((order) => matchesFilter(order, filter)),
        sort,
      ),
    [filter, searchedOrders, sort],
  );
  const visibleOrderIds = useMemo(
    () => visibleOrders.map((order) => order.order_id),
    [visibleOrders],
  );
  const selectedVisibleCount = visibleOrderIds.filter((orderId) =>
    selectedOrderIds.has(orderId),
  ).length;
  const selectedVisibleOrders = useMemo(
    () => visibleOrders.filter((order) => selectedOrderIds.has(order.order_id)),
    [selectedOrderIds, visibleOrders],
  );
  const selectedOrdersForSummary = useMemo(
    () =>
      orders
        .filter((order) => selectedOrderIds.has(order.order_id))
        .map((order) => ({
          items: orderItemsByOrderId[order.order_id] ?? [],
          order,
        })),
    [orderItemsByOrderId, orders, selectedOrderIds],
  );
  const hasVisibleOrders = visibleOrders.length > 0;
  const allVisibleSelected =
    hasVisibleOrders && selectedVisibleCount === visibleOrders.length;
  const hasSearchOrPickupFilter =
    searchQuery.trim().length > 0 || pickupOptionFilter !== "__all__";

  function clearSelection() {
    setSelectedOrderIds(new Set());
  }

  function updateFilter(nextFilter: OrderFilter) {
    setArchiveView("active");
    setFilter(nextFilter);
    clearSelection();
  }

  function updateArchiveView(nextView: OrderArchiveView) {
    setArchiveView(nextView);
    setFilter("all");
    clearSelection();
  }

  function updatePickupOptionFilter(nextFilter: string) {
    setPickupOptionFilter(nextFilter);
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

  function openPickupSummary() {
    if (selectedOrderIds.size === 0) return;

    setIsPickupSummaryOpen(true);
  }

  async function printSelectedOrders() {
    if (!seller || selectedOrderIds.size === 0 || isBulkPrintLoading) return;

    const selectedOrdersInVisibleOrder = visibleOrders.filter((order) =>
      selectedOrderIds.has(order.order_id),
    );
    const orderIds = selectedOrdersInVisibleOrder.map((order) => order.order_id);

    if (orderIds.length === 0) return;

    setIsBulkPrintLoading(true);
    setBulkPrintError(null);

    const [orderResult, itemResult, fulfillmentResult, logoResult] = await Promise.all([
      supabase
        .from("seller_order_management")
        .select(
          "order_id, order_number, order_source, order_status, payment_method, payment_status, created_at, ready_for_pickup_at, fulfilled_at, canceled_at, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_email_snapshot, buyer_phone_snapshot, buyer_address_line1_snapshot, buyer_address_line2_snapshot, buyer_city_snapshot, buyer_state_snapshot, buyer_postal_code_snapshot, buyer_country_snapshot, pickup_note, buyer_notes, subtotal_amount, tax_fee_label_snapshot, tax_fee_amount, total_amount, item_count, total_item_quantity, pickup_option_label_snapshot",
        )
        .eq("store_id", seller.store_id)
        .in("order_id", orderIds)
        .returns<PrintableOrder[]>(),
      supabase
        .from("seller_order_item_detail")
        .select(
          "order_id, order_item_id, species_name_snapshot, breed_display_name_snapshot, inventory_type_snapshot, custom_inventory_label_snapshot, hatch_date_snapshot, age_at_sale_days_snapshot, order_item_source, custom_item_name_snapshot, product_type_snapshot, item_name_snapshot, item_category_snapshot, unit_price_snapshot, quantity, line_subtotal",
        )
        .eq("store_id", seller.store_id)
        .in("order_id", orderIds)
        .order("created_at", { ascending: true })
        .returns<Array<PrintableOrderItem & { order_id: string }>>(),
      supabase
        .from("orders")
        .select(
          "id, fulfillment_method, delivery_option_name_snapshot, delivery_fee_amount",
        )
        .eq("store_id", seller.store_id)
        .in("id", orderIds)
        .returns<
          Array<{
            delivery_fee_amount: number | null;
            delivery_option_name_snapshot: string | null;
            fulfillment_method: "pickup" | "delivery" | string | null;
            id: string;
          }>
        >(),
      loadStoreLogo(seller.store_id),
    ]);

    const firstError = orderResult.error ?? itemResult.error ?? fulfillmentResult.error;

    if (firstError) {
      setBulkPrintError("One or more selected orders could not be loaded for printing.");
      setIsBulkPrintLoading(false);
      return;
    }

    const fulfillmentById = new Map(
      (fulfillmentResult.data ?? []).map((row) => [row.id, row]),
    );
    const ordersById = new Map(
      (orderResult.data ?? []).map((order) => {
        const fulfillment = fulfillmentById.get(order.order_id);

        return [
          order.order_id,
          {
            ...order,
            delivery_fee_amount: fulfillment?.delivery_fee_amount ?? 0,
            delivery_option_name_snapshot:
              fulfillment?.delivery_option_name_snapshot ?? null,
            fulfillment_method: fulfillment?.fulfillment_method ?? "pickup",
          },
        ];
      }),
    );
    const itemsByOrderId = groupPrintableItemsByOrderId(itemResult.data ?? []);
    const missingOrder = orderIds.find((orderId) => !ordersById.has(orderId));

    if (missingOrder) {
      setBulkPrintError("One or more selected orders could not be loaded for printing.");
      setIsBulkPrintLoading(false);
      return;
    }

    setBulkPrintStoreLogo(logoResult);
    setBulkPrintOrders(
      orderIds.map((orderId) => ({
        order: ordersById.get(orderId)!,
        items: itemsByOrderId[orderId] ?? [],
      })),
    );
    pendingBulkPrintRef.current = true;
  }

  function openBulkFulfillmentDialog() {
    const eligibleOrders = selectedVisibleOrders.filter(isBulkFulfillmentEligible);

    setBulkActionDialog({
      eligibleCount: eligibleOrders.length,
      kind: "fulfill",
      payableCount: eligibleOrders.filter(isBulkPaymentEligible).length,
      selectedCount: selectedVisibleOrders.length,
      skippedCount: selectedVisibleOrders.length - eligibleOrders.length,
    });
    setBulkActionError(null);
    setBulkActionMessage(null);
    setBulkFulfillMarkPaid(false);
    setIsBulkActionsMenuOpen(false);
  }

  function openBulkMarkPaidDialog() {
    const eligibleOrders = selectedVisibleOrders.filter(isBulkPaymentEligible);

    setBulkActionDialog({
      eligibleCount: eligibleOrders.length,
      kind: "mark_paid",
      selectedCount: selectedVisibleOrders.length,
      skippedCount: selectedVisibleOrders.length - eligibleOrders.length,
    });
    setBulkActionError(null);
    setBulkActionMessage(null);
    setIsBulkActionsMenuOpen(false);
  }

  function openBulkArchiveDialog() {
    const summary = getBulkArchiveSummary(selectedVisibleOrders);

    setBulkActionError(null);
    setBulkActionMessage(null);
    setBulkArchiveAcknowledged(false);
    setIsBulkActionsMenuOpen(false);

    if (!summary.needsAcknowledgement) {
      void archiveSelectedOrders();
      return;
    }

    setBulkActionDialog({
      bothCount: summary.bothCount,
      eligibleCount: summary.eligibleCount,
      kind: "archive",
      selectedCount: selectedVisibleOrders.length,
      skippedCount: selectedVisibleOrders.length - summary.eligibleCount,
      unpaidCount: summary.unpaidCount,
      unfulfilledCount: summary.unfulfilledCount,
    });
  }

  function openBulkUnarchiveDialog() {
    const eligibleOrders = selectedVisibleOrders.filter(isBulkUnarchiveEligible);

    setBulkActionDialog({
      eligibleCount: eligibleOrders.length,
      kind: "unarchive",
      selectedCount: selectedVisibleOrders.length,
      skippedCount: selectedVisibleOrders.length - eligibleOrders.length,
    });
    setBulkActionError(null);
    setBulkActionMessage(null);
    setIsBulkActionsMenuOpen(false);
  }

  async function markSelectedOrdersFulfilled() {
    if (
      isBulkActionSaving ||
      bulkActionDialog?.kind !== "fulfill" ||
      bulkActionDialog.eligibleCount === 0
    ) {
      return;
    }

    setIsBulkActionSaving(true);
    setBulkActionError(null);
    setBulkActionMessage(null);

    const { data, error } = await supabase.rpc(
      "seller_bulk_mark_orders_fulfilled",
      {
        p_mark_paid: bulkFulfillMarkPaid,
        p_note: bulkFulfillMarkPaid
          ? "Bulk fulfilled and marked eligible orders paid by seller."
          : "Bulk fulfilled by seller.",
        p_order_ids: getSelectedVisibleOrderIds(selectedVisibleOrders),
      },
    );

    if (error) {
      setBulkActionError(toBulkOrderActionError(error.message));
      setIsBulkActionSaving(false);
      return;
    }

    const result = getFirstRpcRow<BulkFulfillmentRpcResult>(data);
    setBulkActionMessage(formatBulkFulfillmentResult(result));
    finishBulkAction();
  }

  async function markSelectedOrdersPaid() {
    if (
      isBulkActionSaving ||
      bulkActionDialog?.kind !== "mark_paid" ||
      bulkActionDialog.eligibleCount === 0
    ) {
      return;
    }

    setIsBulkActionSaving(true);
    setBulkActionError(null);
    setBulkActionMessage(null);

    const { data, error } = await supabase.rpc("seller_bulk_mark_orders_paid", {
      p_note: "Bulk marked paid by seller.",
      p_order_ids: getSelectedVisibleOrderIds(selectedVisibleOrders),
    });

    if (error) {
      setBulkActionError(toBulkOrderActionError(error.message));
      setIsBulkActionSaving(false);
      return;
    }

    const result = getFirstRpcRow<BulkSimpleRpcResult>(data);
    setBulkActionMessage(formatBulkSimpleResult(result, "marked paid"));
    finishBulkAction();
  }

  async function archiveSelectedOrders() {
    if (isBulkActionSaving || selectedVisibleOrders.length === 0) return;

    setIsBulkActionSaving(true);
    setBulkActionError(null);
    setBulkActionMessage(null);

    const { data, error } = await supabase.rpc("seller_bulk_archive_orders", {
      p_note: "Bulk archived by seller.",
      p_order_ids: getSelectedVisibleOrderIds(selectedVisibleOrders),
    });

    if (error) {
      setBulkActionError(toBulkOrderActionError(error.message));
      setIsBulkActionSaving(false);
      return;
    }

    const result = getFirstRpcRow<BulkSimpleRpcResult>(data);
    setBulkActionMessage(formatBulkSimpleResult(result, "archived"));
    finishBulkAction();
  }

  async function unarchiveSelectedOrders() {
    if (
      isBulkActionSaving ||
      bulkActionDialog?.kind !== "unarchive" ||
      bulkActionDialog.eligibleCount === 0
    ) {
      return;
    }

    setIsBulkActionSaving(true);
    setBulkActionError(null);
    setBulkActionMessage(null);

    const { data, error } = await supabase.rpc("seller_bulk_unarchive_orders", {
      p_note: "Bulk unarchived by seller.",
      p_order_ids: getSelectedVisibleOrderIds(selectedVisibleOrders),
    });

    if (error) {
      setBulkActionError(toBulkOrderActionError(error.message));
      setIsBulkActionSaving(false);
      return;
    }

    const result = getFirstRpcRow<BulkSimpleRpcResult>(data);
    setBulkActionMessage(formatBulkSimpleResult(result, "unarchived"));
    finishBulkAction();
  }

  function finishBulkAction() {
    setBulkActionDialog(null);
    setBulkFulfillMarkPaid(false);
    setBulkArchiveAcknowledged(false);
    setIsBulkActionSaving(false);
    setIsBulkActionsMenuOpen(false);
    clearSelection();
    setRefreshKey((current) => current + 1);
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
    <>
      <div className="orders-screen-content grid gap-4">
        <SellerCard className="rounded-2xl p-3 shadow-[0_16px_38px_rgba(46,39,25,0.05)] sm:p-4">
          <div className="grid gap-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_11rem]">
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
                  placeholder={`Search ${
                    archiveView === "archived" ? "Archived" : "Current"
                  } orders by buyer, order #, phone, item, or pickup notes`}
                  style={{ paddingLeft: "3.5rem" }}
                  type="search"
                  value={searchQuery}
                  onChange={(event) => updateSearchQuery(event.target.value)}
                />
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

            <div className="flex items-center gap-3 pb-1">
              <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <OrderLifecycleFilters
                  counts={activeFilterCounts}
                  value={archiveView === "active" ? filter : null}
                  onChange={updateFilter}
                />
              </div>

              <OrderArchiveTabs
                archivedCount={orderArchiveCounts.archived}
                value={archiveView}
                onChange={updateArchiveView}
              />
            </div>

            {showPickupOptionFilter ? (
              <PickupOptionFilterControl
                options={pickupOptions}
                value={pickupOptionFilter}
                onChange={updatePickupOptionFilter}
              />
            ) : null}
          </div>
        </SellerCard>

        {hasVisibleOrders ? (
          <OrdersTableCard
            allVisibleSelected={allVisibleSelected}
            archiveView={archiveView}
            bulkActionError={bulkActionError}
            bulkActionMessage={bulkActionMessage}
            bulkPrintError={bulkPrintError}
            expandedBuyerOrderId={expandedBuyerOrderId}
            expandedOrderId={expandedOrderId}
            isBulkActionSaving={isBulkActionSaving}
            isBulkActionsMenuOpen={isBulkActionsMenuOpen}
            isBulkPrintLoading={isBulkPrintLoading}
            itemsByOrderId={orderItemsByOrderId}
            orders={visibleOrders}
            selectedOrderIds={selectedOrderIds}
            selectedVisibleCount={selectedVisibleCount}
            onBulkActionsOpenChange={setIsBulkActionsMenuOpen}
            onClearSelection={clearSelection}
            onOpenBulkArchive={openBulkArchiveDialog}
            onOpenBulkFulfillment={openBulkFulfillmentDialog}
            onOpenBulkMarkPaid={openBulkMarkPaidDialog}
            onOpenBulkUnarchive={openBulkUnarchiveDialog}
            onOpenPickupSummary={openPickupSummary}
            onPrintSelectedOrders={() => void printSelectedOrders()}
            onToggleExpandedBuyer={toggleExpandedBuyer}
            onToggleExpandedOrder={toggleExpandedOrder}
            onToggleOrderSelection={toggleOrderSelection}
            onToggleSelectAll={toggleSelectAllOnPage}
          />
        ) : (
          <EmptyState
            title={getEmptyTitle(filter, hasSearchOrPickupFilter, archiveView)}
            description={
              hasSearchOrPickupFilter
                ? "Try a different search or pickup option filter."
                : archiveView === "archived"
                  ? "Orders you archive will appear here."
                : "Try a different status to review older orders."
            }
          />
        )}
        {isPickupSummaryOpen ? (
          <PickupSummaryModal
            orders={selectedOrdersForSummary}
            onClose={() => setIsPickupSummaryOpen(false)}
          />
        ) : null}
        {bulkActionDialog?.kind === "fulfill" ? (
          <BulkFulfillmentDialog
            dialog={bulkActionDialog}
            error={bulkActionError}
            isSaving={isBulkActionSaving}
            markPaid={bulkFulfillMarkPaid}
            onClose={() => {
              if (isBulkActionSaving) return;
              setBulkActionDialog(null);
              setBulkActionError(null);
              setBulkFulfillMarkPaid(false);
            }}
            onMarkPaidChange={setBulkFulfillMarkPaid}
            onSubmit={() => void markSelectedOrdersFulfilled()}
          />
        ) : null}
        {bulkActionDialog?.kind === "mark_paid" ? (
          <BulkMarkPaidDialog
            dialog={bulkActionDialog}
            error={bulkActionError}
            isSaving={isBulkActionSaving}
            onClose={() => {
              if (isBulkActionSaving) return;
              setBulkActionDialog(null);
              setBulkActionError(null);
            }}
            onSubmit={() => void markSelectedOrdersPaid()}
          />
        ) : null}
        {bulkActionDialog?.kind === "archive" ? (
          <BulkArchiveDialog
            acknowledgementChecked={bulkArchiveAcknowledged}
            dialog={bulkActionDialog}
            error={bulkActionError}
            isSaving={isBulkActionSaving}
            onAcknowledgementChange={setBulkArchiveAcknowledged}
            onClose={() => {
              if (isBulkActionSaving) return;
              setBulkActionDialog(null);
              setBulkActionError(null);
              setBulkArchiveAcknowledged(false);
            }}
            onSubmit={() => void archiveSelectedOrders()}
          />
        ) : null}
        {bulkActionDialog?.kind === "unarchive" ? (
          <BulkUnarchiveDialog
            dialog={bulkActionDialog}
            error={bulkActionError}
            isSaving={isBulkActionSaving}
            onClose={() => {
              if (isBulkActionSaving) return;
              setBulkActionDialog(null);
              setBulkActionError(null);
            }}
            onSubmit={() => void unarchiveSelectedOrders()}
          />
        ) : null}
      </div>
      {isPrintPortalReady &&
      bulkPrintOrders.length > 0 &&
      typeof document !== "undefined"
        ? createPortal(
            <div aria-hidden="true" className="order-print-batch">
              {bulkPrintOrders.map(({ items, order }) => (
                <OrderPrintDocument
                  items={items}
                  key={order.order_id}
                  order={order}
                  storeLogo={bulkPrintStoreLogo}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function OrdersTableCard({
  allVisibleSelected,
  archiveView,
  bulkActionError,
  bulkActionMessage,
  bulkPrintError,
  expandedBuyerOrderId,
  expandedOrderId,
  isBulkActionSaving,
  isBulkActionsMenuOpen,
  isBulkPrintLoading,
  itemsByOrderId,
  orders,
  selectedOrderIds,
  selectedVisibleCount,
  onBulkActionsOpenChange,
  onClearSelection,
  onOpenBulkArchive,
  onOpenBulkFulfillment,
  onOpenBulkMarkPaid,
  onOpenBulkUnarchive,
  onOpenPickupSummary,
  onPrintSelectedOrders,
  onToggleExpandedBuyer,
  onToggleExpandedOrder,
  onToggleOrderSelection,
  onToggleSelectAll,
}: {
  allVisibleSelected: boolean;
  archiveView: OrderArchiveView;
  bulkActionError: string | null;
  bulkActionMessage: string | null;
  bulkPrintError: string | null;
  expandedBuyerOrderId: string | null;
  expandedOrderId: string | null;
  isBulkActionSaving: boolean;
  isBulkActionsMenuOpen: boolean;
  isBulkPrintLoading: boolean;
  itemsByOrderId: Record<string, SellerOrderItemRow[]>;
  orders: SellerOrderRow[];
  selectedOrderIds: Set<string>;
  selectedVisibleCount: number;
  onBulkActionsOpenChange: (isOpen: boolean) => void;
  onClearSelection: () => void;
  onOpenBulkArchive: () => void;
  onOpenBulkFulfillment: () => void;
  onOpenBulkMarkPaid: () => void;
  onOpenBulkUnarchive: () => void;
  onOpenPickupSummary: () => void;
  onPrintSelectedOrders: () => void;
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
        <label className="flex min-h-12 items-center gap-3 text-base font-semibold text-stone-950 sm:min-h-10 sm:text-sm sm:font-medium">
          <input
            ref={selectAllRef}
            aria-label="Select all orders on this page"
            checked={allVisibleSelected}
            className="size-6 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700 sm:size-5"
            type="checkbox"
            onChange={onToggleSelectAll}
          />
          Select all on this page
        </label>

        {selectedVisibleCount > 0 ? (
          <BulkActions
            archiveView={archiveView}
            isBulkActionSaving={isBulkActionSaving}
            isBulkActionsMenuOpen={isBulkActionsMenuOpen}
            isBulkPrintLoading={isBulkPrintLoading}
            selectedCount={selectedVisibleCount}
            onBulkActionsOpenChange={onBulkActionsOpenChange}
            onClearSelection={onClearSelection}
            onOpenBulkArchive={onOpenBulkArchive}
            onOpenBulkFulfillment={onOpenBulkFulfillment}
            onOpenBulkMarkPaid={onOpenBulkMarkPaid}
            onOpenBulkUnarchive={onOpenBulkUnarchive}
            onOpenPickupSummary={onOpenPickupSummary}
            onPrintSelectedOrders={onPrintSelectedOrders}
          />
        ) : null}
      </div>
      {bulkActionMessage ? (
        <p className="border-b border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {bulkActionMessage}
        </p>
      ) : null}
      {bulkActionError ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {bulkActionError}
        </p>
      ) : null}
      {bulkPrintError ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {bulkPrintError}
        </p>
      ) : null}

      <div
        aria-hidden="true"
        className="hidden grid-cols-[2.25rem_minmax(9rem,10.5rem)_minmax(6.5rem,7.5rem)_minmax(0,1.6fr)_minmax(4.75rem,5.75rem)_minmax(9.5rem,11.5rem)_5.5rem] gap-3 bg-[#fbfaf6] px-4 py-3 text-xs font-medium uppercase tracking-[0.08em] text-stone-600 xl:grid"
      >
        <span />
        <span>Order</span>
        <span>Date</span>
        <span>Buyer</span>
        <span>Total</span>
        <span>Status</span>
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
  archiveView,
  isBulkActionSaving,
  isBulkActionsMenuOpen,
  isBulkPrintLoading,
  selectedCount,
  onBulkActionsOpenChange,
  onClearSelection,
  onOpenBulkArchive,
  onOpenBulkFulfillment,
  onOpenBulkMarkPaid,
  onOpenBulkUnarchive,
  onOpenPickupSummary,
  onPrintSelectedOrders,
}: {
  archiveView: OrderArchiveView;
  isBulkActionSaving: boolean;
  isBulkActionsMenuOpen: boolean;
  isBulkPrintLoading: boolean;
  selectedCount: number;
  onBulkActionsOpenChange: (isOpen: boolean) => void;
  onClearSelection: () => void;
  onOpenBulkArchive: () => void;
  onOpenBulkFulfillment: () => void;
  onOpenBulkMarkPaid: () => void;
  onOpenBulkUnarchive: () => void;
  onOpenPickupSummary: () => void;
  onPrintSelectedOrders: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      <span className="text-base font-bold text-stone-600 sm:text-xs sm:font-medium sm:text-stone-500">
        {selectedCount} selected
      </span>
      <button
        className="seller-small-button min-h-11 gap-2 rounded-md border-emerald-800 bg-emerald-800 px-3 text-white hover:border-emerald-900 hover:bg-emerald-900 sm:min-h-10"
        type="button"
        onClick={onOpenPickupSummary}
      >
        <Image src="/glyphs/clipboard.png" alt="" width={16} height={16} />
        Pickup Summary
      </button>
      <button
        className="seller-small-button min-h-11 gap-2 rounded-md px-3 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10"
        disabled={isBulkPrintLoading || selectedCount === 0}
        type="button"
        onClick={onPrintSelectedOrders}
      >
        <Image src="/glyphs/printer.png" alt="" width={16} height={16} />
        {isBulkPrintLoading ? "Loading print..." : "Print orders"}
      </button>
      <details
        className="relative"
        open={isBulkActionsMenuOpen}
        onToggle={(event) => onBulkActionsOpenChange(event.currentTarget.open)}
      >
        <summary
          className={`seller-small-button min-h-11 cursor-pointer list-none rounded-md px-3 sm:min-h-10 ${
            isBulkActionSaving ? "pointer-events-none opacity-60" : ""
          }`}
        >
          More actions
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-stone-200 bg-white p-2 shadow-[0_18px_40px_rgba(46,39,25,0.14)]">
          {archiveView === "active" ? (
            <>
              <QuickBulkActionButton
                disabled={isBulkActionSaving}
                glyph="/glyphs/checkmark.png"
                label="Mark fulfilled"
                onClick={onOpenBulkFulfillment}
              />
              <QuickBulkActionButton
                disabled={isBulkActionSaving}
                glyph="/glyphs/checkmark.png"
                label="Mark paid"
                onClick={onOpenBulkMarkPaid}
              />
              <QuickBulkActionButton
                disabled={isBulkActionSaving}
                glyph="/glyphs/shopping-bag.png"
                label="Archive"
                onClick={onOpenBulkArchive}
              />
            </>
          ) : (
            <QuickBulkActionButton
              disabled={isBulkActionSaving}
              glyph="/glyphs/shopping-bag.png"
              label="Unarchive"
              onClick={onOpenBulkUnarchive}
            />
          )}
        </div>
      </details>
      <button
        className="min-h-12 rounded-md px-3 text-base font-bold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 sm:min-h-10 sm:text-sm sm:font-medium"
        type="button"
        onClick={onClearSelection}
      >
        Clear selection
      </button>
    </div>
  );
}

function QuickBulkActionButton({
  disabled = false,
  glyph,
  label,
  onClick,
}: {
  disabled?: boolean;
  glyph: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-stone-950 transition hover:bg-[#fbfaf6] focus:outline-none focus:ring-2 focus:ring-emerald-700/30 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <Image src={glyph} alt="" width={18} height={18} />
      {label}
    </button>
  );
}

function BulkFulfillmentDialog({
  dialog,
  error,
  isSaving,
  markPaid,
  onClose,
  onMarkPaidChange,
  onSubmit,
}: {
  dialog: Extract<BulkActionDialog, { kind: "fulfill" }>;
  error: string | null;
  isSaving: boolean;
  markPaid: boolean;
  onClose: () => void;
  onMarkPaidChange: (value: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <BulkDialogFrame
      error={error}
      isSaving={isSaving}
      title="Mark selected orders fulfilled?"
      onClose={onClose}
    >
      <p className="text-sm leading-6 text-stone-700">
        {dialog.eligibleCount} of {dialog.selectedCount} selected{" "}
        {pluralize(dialog.selectedCount, "order")} will be marked fulfilled.
        {dialog.skippedCount > 0
          ? ` ${dialog.skippedCount} already fulfilled or canceled ${pluralize(
              dialog.skippedCount,
              "order",
            )} will be skipped.`
          : ""}
      </p>
      <label className="mt-4 flex gap-3 rounded-md border border-stone-200 bg-[#fffdf8] p-3 text-sm text-stone-700">
        <input
          className="mt-1 size-6 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700 sm:size-4"
          checked={markPaid}
          disabled={isSaving || dialog.payableCount === 0}
          type="checkbox"
          onChange={(event) => onMarkPaidChange(event.target.checked)}
        />
        <span>
          <span className="block font-semibold text-stone-950">
            Also mark eligible unpaid orders paid
          </span>
          <span className="mt-1 block leading-6 text-stone-600">
            {dialog.payableCount > 0
              ? `${dialog.payableCount} offline pay-at-pickup ${pluralize(
                  dialog.payableCount,
                  "order",
                )} can also be marked paid.`
              : "No selected orders are eligible for manual payment update."}
          </span>
        </span>
      </label>
      <BulkDialogActions
        isSaving={isSaving}
        primaryDisabled={dialog.eligibleCount === 0}
        primaryLabel="Mark fulfilled"
        savingLabel="Saving..."
        secondaryLabel="Keep orders"
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </BulkDialogFrame>
  );
}

function BulkMarkPaidDialog({
  dialog,
  error,
  isSaving,
  onClose,
  onSubmit,
}: {
  dialog: Extract<BulkActionDialog, { kind: "mark_paid" }>;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <BulkDialogFrame
      error={error}
      isSaving={isSaving}
      title="Mark selected orders paid?"
      onClose={onClose}
    >
      <p className="text-sm leading-6 text-stone-700">
        {dialog.eligibleCount} of {dialog.selectedCount} selected{" "}
        {pluralize(dialog.selectedCount, "order")} will be marked paid.
        {dialog.skippedCount > 0
          ? ` ${dialog.skippedCount} already paid, refunded, canceled, Stripe-paid, or otherwise ineligible ${pluralize(
              dialog.skippedCount,
              "order",
            )} will be skipped.`
          : ""}
      </p>
      <BulkDialogActions
        isSaving={isSaving}
        primaryDisabled={dialog.eligibleCount === 0}
        primaryLabel="Mark paid"
        savingLabel="Saving..."
        secondaryLabel="Keep orders"
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </BulkDialogFrame>
  );
}

function BulkArchiveDialog({
  acknowledgementChecked,
  dialog,
  error,
  isSaving,
  onAcknowledgementChange,
  onClose,
  onSubmit,
}: {
  acknowledgementChecked: boolean;
  dialog: Extract<BulkActionDialog, { kind: "archive" }>;
  error: string | null;
  isSaving: boolean;
  onAcknowledgementChange: (value: boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <BulkDialogFrame
      error={error}
      isSaving={isSaving}
      title="Archive unfinished orders?"
      onClose={onClose}
    >
      <p className="text-sm leading-6 text-stone-700">
        Archiving will hide selected orders from your active order list, but it
        will not change fulfillment, payment, cancellation, inventory, totals,
        Stripe state, or emails.
      </p>
      <p className="mt-2 text-sm leading-6 text-stone-700">
        {formatBulkArchiveWarning(dialog)}
      </p>
      {dialog.skippedCount > 0 ? (
        <p className="mt-2 text-sm leading-6 text-stone-700">
          {dialog.skippedCount} already archived{" "}
          {pluralize(dialog.skippedCount, "order")} will be skipped.
        </p>
      ) : null}
      <label className="mt-4 flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-stone-700">
        <input
          className="mt-1 size-6 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700 sm:size-4"
          checked={acknowledgementChecked}
          disabled={isSaving}
          type="checkbox"
          onChange={(event) => onAcknowledgementChange(event.target.checked)}
        />
        <span className="font-semibold text-stone-950">
          I understand some selected orders are not complete.
        </span>
      </label>
      <BulkDialogActions
        isSaving={isSaving}
        primaryDisabled={dialog.eligibleCount === 0 || !acknowledgementChecked}
        primaryLabel="Archive orders"
        savingLabel="Archiving..."
        secondaryLabel="Keep orders"
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </BulkDialogFrame>
  );
}

function BulkUnarchiveDialog({
  dialog,
  error,
  isSaving,
  onClose,
  onSubmit,
}: {
  dialog: Extract<BulkActionDialog, { kind: "unarchive" }>;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <BulkDialogFrame
      error={error}
      isSaving={isSaving}
      title="Unarchive selected orders?"
      onClose={onClose}
    >
      <p className="text-sm leading-6 text-stone-700">
        {dialog.eligibleCount} of {dialog.selectedCount} selected{" "}
        {pluralize(dialog.selectedCount, "order")} will return to your active
        order list.
        {dialog.skippedCount > 0
          ? ` ${dialog.skippedCount} ${pluralize(
              dialog.skippedCount,
              "order",
            )} will be skipped.`
          : ""}
      </p>
      <BulkDialogActions
        isSaving={isSaving}
        primaryDisabled={dialog.eligibleCount === 0}
        primaryLabel="Unarchive orders"
        savingLabel="Unarchiving..."
        secondaryLabel="Keep archived"
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </BulkDialogFrame>
  );
}

function BulkDialogFrame({
  children,
  error,
  isSaving,
  onClose,
  title,
}: {
  children: ReactNode;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      aria-labelledby="bulk-order-action-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/30 px-4 py-6"
      role="dialog"
    >
      <section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-[0_22px_60px_rgba(46,39,25,0.2)]">
        <div className="flex items-start justify-between gap-4">
          <h2
            className="text-lg font-bold text-stone-950"
            id="bulk-order-action-dialog-title"
          >
            {title}
          </h2>
          <button
            aria-label="Close dialog"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-2xl font-light leading-none text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            type="button"
            onClick={onClose}
          >
            &times;
          </button>
        </div>
        <div className="mt-2">{children}</div>
        {error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function BulkDialogActions({
  isSaving,
  onClose,
  onSubmit,
  primaryDisabled,
  primaryLabel,
  savingLabel,
  secondaryLabel,
}: {
  isSaving: boolean;
  onClose: () => void;
  onSubmit: () => void;
  primaryDisabled: boolean;
  primaryLabel: string;
  savingLabel: string;
  secondaryLabel: string;
}) {
  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-2">
      <button
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800/30 disabled:cursor-not-allowed disabled:bg-stone-300"
        disabled={isSaving || primaryDisabled}
        type="button"
        onClick={onSubmit}
      >
        {isSaving ? savingLabel : primaryLabel}
      </button>
      <button
        className="seller-secondary-button min-h-10 rounded-md px-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSaving}
        type="button"
        onClick={onClose}
      >
        {secondaryLabel}
      </button>
    </div>
  );
}

function PickupSummaryModal({
  onClose,
  orders,
}: {
  onClose: () => void;
  orders: PickupSummaryOrder[];
}) {
  const summaryLines = useMemo(() => getPickupSummaryLines(orders), [orders]);
  const [includedLineIds, setIncludedLineIds] = useState<Set<string>>(
    () =>
      new Set(
        summaryLines
          .filter((line) => isReadyForPickupSummary(line.readyDate))
          .map((line) => line.id),
      ),
  );
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(
    () => new Set(orders.map(({ order }) => order.order_id)),
  );
  const [reports, setReports] = useState<Record<PickupSummaryReport, boolean>>({
    order_summary: true,
    pull_sheet: true,
  });
  const [exportFormat, setExportFormat] =
    useState<PickupSummaryExportFormat>("pdf");
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const includedLines = useMemo(
    () => summaryLines.filter((line) => includedLineIds.has(line.id)),
    [includedLineIds, summaryLines],
  );
  const summaryTotals = useMemo(
    () => getPickupSummaryTotals(includedLines),
    [includedLines],
  );
  const selectedReports = useMemo(
    () =>
      (Object.entries(reports) as Array<[PickupSummaryReport, boolean]>)
        .filter(([, isSelected]) => isSelected)
        .map(([report]) => report),
    [reports],
  );

  function toggleLine(lineId: string) {
    setIncludedLineIds((current) => {
      const next = new Set(current);

      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }

      return next;
    });
    setMessage(null);
  }

  function toggleOrder(orderId: string) {
    setExpandedOrderIds((current) => {
      const next = new Set(current);

      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }

      return next;
    });
  }

  function toggleReport(report: PickupSummaryReport) {
    setReports((current) => {
      const selectedCount = Object.values(current).filter(Boolean).length;

      if (current[report] && selectedCount === 1) {
        setMessage("Select at least one report.");
        return current;
      }

      setMessage(null);
      return { ...current, [report]: !current[report] };
    });
  }

  async function generateReports() {
    if (includedLines.length === 0) {
      setMessage("Select at least one hatch date group.");
      return;
    }

    if (selectedReports.length === 0) {
      setMessage("Select at least one report.");
      return;
    }

    const payload = buildPickupSummaryPayload({
      exportFormat,
      includedLines,
      reports: selectedReports,
    });

    try {
      setIsGenerating(true);
      setMessage(null);
      await downloadPickupSummaryReports(payload);
      setMessage(
        `Reports downloaded: ${payload.overallBirdTotal} birds from ${payload.includedOrders.length} orders.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong while generating reports.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 px-3 py-2 sm:items-center"
      role="dialog"
    >
      <section className="max-h-[calc(100vh-1rem)] w-full max-w-[58rem] overflow-y-auto rounded-lg bg-white p-4 shadow-2xl sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[1.65rem] font-bold leading-tight text-stone-950">
              Create Pickup Summary
            </h2>
            <p className="mt-1.5 text-sm leading-5 text-stone-700">
              Choose which hatch date groups to include in this pickup. All birds
              from the selected dates will be included.
            </p>
          </div>
          <button
            aria-label="Close pickup summary"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-3xl font-light leading-none text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isGenerating}
            type="button"
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        <div className="mt-4 grid rounded-md border border-stone-200 sm:grid-cols-3 sm:divide-x sm:divide-stone-200">
          <SummaryMetric
            glyphSrc="/glyphs/calendar.png"
            label="Selected orders"
            value={orders.length}
          />
          <SummaryMetric
            glyphSrc="/glyphs/hen.png"
            label="Birds included"
            value={summaryTotals.birds}
          />
          <SummaryMetric
            glyphSrc="/glyphs/cart.png"
            label="Pickup value"
            value={formatCurrency(summaryTotals.value)}
          />
        </div>

        <div className="mt-4">
          <h3 className="text-lg font-bold leading-tight text-stone-950">
            Choose items for this pickup
          </h3>
          <p className="mt-1 text-sm leading-5 text-stone-600">
            Select the hatch date groups you are including in this pickup.
          </p>
          <div className="mt-3 grid gap-2.5">
            {orders.map(({ order }) => {
              const orderLines = summaryLines.filter(
                (line) => line.orderId === order.order_id,
              );
              const isExpanded = expandedOrderIds.has(order.order_id);

              return (
                <section
                  className="overflow-hidden rounded-md border border-stone-200 bg-white"
                  key={order.order_id}
                >
                  <button
                    aria-expanded={isExpanded}
                    className="flex min-h-10 w-full items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 text-left text-sm font-bold text-stone-950 transition hover:bg-[#fbfaf6] focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
                    type="button"
                    onClick={() => toggleOrder(order.order_id)}
                  >
                    <span>
                      Order #{order.order_number} &bull; {formatCustomerName(order)}
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-5 shrink-0 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {isExpanded ? (
                    <div className="divide-y divide-stone-200 px-4">
                      {orderLines.length > 0 ? (
                        orderLines.map((line) => (
                          <label
                            className="grid min-h-10 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 py-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)_minmax(10rem,14rem)_4.5rem]"
                            key={line.id}
                          >
                            <input
                              checked={includedLineIds.has(line.id)}
                              className="peer sr-only"
                              type="checkbox"
                              onChange={() => toggleLine(line.id)}
                            />
                            <span
                              aria-hidden="true"
                              className={`flex size-5 shrink-0 items-center justify-center rounded border text-sm font-bold leading-none transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-700 ${
                                includedLineIds.has(line.id)
                                  ? "border-emerald-800 bg-emerald-800 text-white"
                                  : "border-stone-300 bg-white"
                              }`}
                            >
                              {includedLineIds.has(line.id) ? (
                                <span>&#10003;</span>
                              ) : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-stone-950">
                                {line.breedOrVariety}
                              </span>
                            </span>
                            <span className="col-start-2 whitespace-nowrap text-sm text-stone-600 sm:col-start-auto">
                              {line.readyDate
                                ? `Ready ${formatShortDate(line.readyDate)}`
                                : "Ready date not set"}
                            </span>
                            <span className="col-start-2 text-sm text-stone-950 sm:col-start-auto sm:justify-self-end sm:text-right">
                              Qty {line.quantity}
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="py-3 text-sm text-stone-600">
                          No bird hatch-date groups found for this order.
                        </p>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>

        <div className="mt-3 rounded-md border border-emerald-100 bg-emerald-50/50 px-4 py-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-emerald-800 text-sm font-bold leading-none text-emerald-800"
              >
                &#10003;
              </span>
              <div>
                <p className="text-sm font-bold text-emerald-950">
                  {summaryTotals.birds} birds will be included in this pickup
                </p>
                <p className="text-sm text-stone-600">
                  From {summaryTotals.orderCount} orders
                </p>
              </div>
            </div>
            <p className="text-sm font-bold text-stone-950">
              Pickup value:{" "}
              <span className="text-emerald-800">
                {formatCurrency(summaryTotals.value)}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-4 border-t border-stone-200 pt-3 md:grid-cols-2 md:gap-0 md:divide-x md:divide-stone-200">
          <fieldset className="md:pr-6">
            <legend className="text-lg font-bold leading-tight text-stone-950">
              Reports to generate
            </legend>
            <p className="mt-1 text-sm text-stone-600">
              Choose one or both reports.
            </p>
            <div className="mt-3 grid gap-2.5">
              <ReportCheckbox
                checked={reports.pull_sheet}
                description="Totals birds by breed/variety."
                glyphSrc="/glyphs/clipboard.png"
                label="Pull Sheet"
                onChange={() => toggleReport("pull_sheet")}
              />
              <ReportCheckbox
                checked={reports.order_summary}
                description="List of customers with bird counts and amounts."
                glyphSrc="/glyphs/customers.png"
                label="Order Summary"
                onChange={() => toggleReport("order_summary")}
              />
            </div>
          </fieldset>

          <fieldset className="md:pl-6">
            <legend className="text-lg font-bold leading-tight text-stone-950">
              Export format
            </legend>
            <p className="mt-1 text-sm text-stone-600">
              Choose the format for your report(s).
            </p>
            <div className="mt-3 grid gap-2.5">
              <FormatRadio
                checked={exportFormat === "pdf"}
                description="Print-friendly format."
                label="PDF (recommended)"
                onChange={() => setExportFormat("pdf")}
              />
              <FormatRadio
                checked={exportFormat === "xlsx"}
                description="Editable spreadsheet."
                label="Excel (.xlsx)"
                onChange={() => setExportFormat("xlsx")}
              />
            </div>
          </fieldset>
        </div>

        {message ? (
          <p className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
            {message}
          </p>
        ) : null}

        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className="seller-secondary-button min-h-10 rounded-md px-7 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isGenerating}
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-8 text-sm font-bold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isGenerating}
            type="button"
            onClick={generateReports}
          >
            {isGenerating ? "Generating..." : "Generate Reports"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SummaryMetric({
  glyphSrc,
  label,
  value,
}: {
  glyphSrc: string;
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
      <Image
        alt=""
        aria-hidden="true"
        className="size-7 shrink-0 object-contain"
        height={28}
        src={glyphSrc}
        width={28}
      />
      <div>
        <p className="text-sm font-bold text-stone-600">{label}</p>
        <p className="mt-0.5 text-xl font-bold leading-tight text-stone-950">
          {value}
        </p>
      </div>
    </div>
  );
}

function ReportCheckbox({
  checked,
  description,
  glyphSrc,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  glyphSrc: string;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        checked={checked}
        className="peer sr-only"
        type="checkbox"
        onChange={onChange}
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-sm font-bold leading-none transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-700 ${
          checked
            ? "border-emerald-800 bg-emerald-800 text-white"
            : "border-stone-300 bg-white"
        }`}
      >
        {checked ? <span>&#10003;</span> : null}
      </span>
      <Image
        alt=""
        aria-hidden="true"
        className="mt-0.5 size-7 shrink-0 object-contain"
        height={28}
        src={glyphSrc}
        width={28}
      />
      <span>
        <span className="block text-sm font-bold text-stone-950">{label}</span>
        <span className="mt-0.5 block text-sm text-stone-600">
          {description}
        </span>
      </span>
    </label>
  );
}

function FormatRadio({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        checked={checked}
        className="peer sr-only"
        name="pickup-summary-export-format"
        type="radio"
        onChange={onChange}
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-700 ${
          checked ? "border-emerald-800" : "border-stone-300"
        }`}
      >
        {checked ? (
          <span className="size-2.5 rounded-full bg-emerald-800" />
        ) : null}
      </span>
      <span>
        <span className="block text-sm font-bold text-stone-950">{label}</span>
        <span className="mt-0.5 block text-sm text-stone-600">
          {description}
        </span>
      </span>
    </label>
  );
}

function getPickupSummaryLines(orders: PickupSummaryOrder[]) {
  return orders.flatMap(({ items, order }) =>
    items.filter(isPickupSummaryBirdLine).map((item) => {
      const summary = formatOrderItemSummary(item);
      const quantity = item.quantity ?? 0;
      const lineValue =
        item.line_subtotal ?? (item.unit_price_snapshot ?? 0) * quantity;

      return {
        breedOrVariety: summary.title,
        customerEmail: order.buyer_email_snapshot,
        customerName: formatCustomerName(order),
        customerPhone: order.buyer_phone_snapshot,
        id: item.order_item_id,
        lineValue,
        orderId: order.order_id,
        orderNumber: order.order_number,
        quantity,
        readyDate: item.available_date_snapshot,
        sex: formatPickupSummarySex(item),
      };
    }),
  );
}

function isPickupSummaryBirdLine(item: SellerOrderItemRow) {
  if (
    item.order_item_source === "custom" ||
    item.order_item_source === "equipment_inventory" ||
    item.order_item_source === "processed_poultry_inventory"
  ) {
    return false;
  }

  return item.inventory_type_snapshot !== "hatching_eggs";
}

function formatPickupSummarySex(item: SellerOrderItemRow) {
  const label = formatInventoryLabel({
    custom_inventory_label: item.custom_inventory_label_snapshot,
    inventory_type: item.inventory_type_snapshot,
  });

  return formatSellerItemDetail(label);
}

function isReadyForPickupSummary(value: string | null) {
  if (!value) return false;

  const readyDate = new Date(`${value.slice(0, 10)}T00:00:00`);

  if (!Number.isFinite(readyDate.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return readyDate.getTime() <= today.getTime();
}

function getPickupSummaryTotals(lines: PickupSummaryLine[]) {
  return {
    birds: lines.reduce((total, line) => total + line.quantity, 0),
    orderCount: new Set(lines.map((line) => line.orderId)).size,
    value: lines.reduce((total, line) => total + line.lineValue, 0),
  };
}

function buildPickupSummaryPayload({
  exportFormat,
  includedLines,
  reports,
}: {
  exportFormat: PickupSummaryExportFormat;
  includedLines: PickupSummaryLine[];
  reports: PickupSummaryReport[];
}): PickupSummaryPayload {
  const includedOrders = new Map<
    string,
    PickupSummaryPayload["includedOrders"][number]
  >();
  const customerTotals = new Map<
    string,
    PickupSummaryPayload["includedBirdTotalPerCustomer"][number]
  >();

  includedLines.forEach((line) => {
    includedOrders.set(line.orderId, {
      customerName: line.customerName,
      email: line.customerEmail,
      orderId: line.orderId,
      orderNumber: line.orderNumber,
      phone: line.customerPhone,
    });

    const existing = customerTotals.get(line.orderId) ?? {
      customerName: line.customerName,
      email: line.customerEmail,
      orderId: line.orderId,
      orderNumber: line.orderNumber,
      phone: line.customerPhone,
      totalBirds: 0,
      totalValue: 0,
    };

    existing.totalBirds += line.quantity;
    existing.totalValue += line.lineValue;
    customerTotals.set(line.orderId, existing);
  });

  const totals = getPickupSummaryTotals(includedLines);

  return {
    defaultSelectionRule:
      "Lines with ready dates today or earlier are selected by default; future or unreadable ready dates are unchecked.",
    exportFormat,
    includedBirdTotalPerCustomer: Array.from(customerTotals.values()),
    includedOrderLines: includedLines,
    includedOrders: Array.from(includedOrders.values()),
    overallBirdTotal: totals.birds,
    overallPickupValue: totals.value,
    reports,
  };
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
  const pickupNote = order.pickup_note?.trim();
  const mobileDetailsId = `mobile-order-details-${order.order_id}`;
  const desktopBuyerDetailsId = `desktop-buyer-details-${order.order_id}`;
  const desktopDetailsId = `desktop-order-items-${order.order_id}`;
  const itemSummary = formatOrderItems(order);
  const combinedStatus = getCombinedOrderStatus(order);

  return (
    <article className="bg-white transition hover:bg-[#fffdf8]">
      <div className="grid gap-3 px-4 py-3 xl:hidden">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3">
          <label className="flex min-h-12 items-start pt-1">
            <input
              aria-label={`Select order ${order.order_number}`}
              checked={isSelected}
              className="size-6 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
              type="checkbox"
              onChange={onToggleSelection}
            />
          </label>

          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Link
                className="text-lg font-bold text-stone-950 hover:text-emerald-800 sm:text-base sm:font-medium"
                href={`/dashboard/orders/${order.order_id}`}
              >
                #{order.order_number}
              </Link>
              <CombinedOrderStatusBadge status={combinedStatus} />
              {order.archived_at ? <OrderArchivedBadge /> : null}
            </div>
            <p className="mt-1 truncate text-base font-semibold text-stone-950 sm:text-sm sm:font-normal">
              {customerName}
            </p>
            <p className="mt-1 text-sm leading-5 text-stone-600">
              {formatOrderItems(order)} &bull; {formatCurrency(order.total_amount)}
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
            className="flex size-12 items-center justify-center rounded-md border border-stone-200 bg-white text-xl font-bold text-emerald-900 transition hover:bg-[#fbfaf6] focus:outline-none focus:ring-2 focus:ring-emerald-700/30 sm:size-10 sm:text-lg sm:font-medium"
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
                  className="inline-flex min-h-11 min-w-0 items-center gap-2 hover:text-emerald-800"
                  href={`tel:${order.buyer_phone_snapshot}`}
                >
                  <Image src="/glyphs/phone.png" alt="" width={16} height={16} />
                  <span className="truncate">{order.buyer_phone_snapshot}</span>
                </a>
              ) : null}
              {order.buyer_email_snapshot ? (
                <a
                  className="inline-flex min-h-11 min-w-0 items-center gap-2 hover:text-emerald-800"
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
                <span className="font-medium text-stone-700">Status:</span>{" "}
                <span title={combinedStatus.description}>
                  {combinedStatus.label}
                </span>
              </p>
            </div>

            <div className="grid gap-2">
              <Link
                className="inline-flex min-h-12 w-full items-center justify-center gap-1 rounded-md bg-emerald-800 px-3 text-base font-bold text-white shadow-[0_8px_18px_rgba(4,120,87,0.14)] transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2 sm:min-h-11 sm:text-sm sm:font-medium"
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

      <div className="hidden gap-3 px-4 py-2.5 xl:grid xl:grid-cols-[2.25rem_minmax(9rem,10.5rem)_minmax(6.5rem,7.5rem)_minmax(0,1.6fr)_minmax(4.75rem,5.75rem)_minmax(9.5rem,11.5rem)_5.5rem] xl:items-center">
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
          {order.archived_at ? <OrderArchivedBadge /> : null}
          <button
            aria-controls={desktopDetailsId}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? `Hide items in order ${order.order_number}`
                : `Show items in order ${order.order_number}`
            }
            className="inline-flex min-h-7 min-w-0 items-center gap-1.5 rounded-sm text-left text-emerald-800 underline-offset-4 transition hover:text-emerald-900 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
            type="button"
            onClick={onToggleExpanded}
          >
            <span className="truncate">{itemSummary}</span>
            <ChevronDown
              aria-hidden="true"
              className={`size-3.5 shrink-0 transition-transform ${
                isExpanded ? "rotate-180" : ""
              }`}
              strokeWidth={2.25}
            />
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
            className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-sm text-left text-sm text-stone-950 transition hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
            type="button"
            onClick={onToggleBuyer}
          >
            <span className="truncate">{customerName}</span>
            <ChevronDown
              aria-hidden="true"
              className={`size-3.5 shrink-0 transition-transform ${
                isBuyerExpanded ? "rotate-180" : ""
              }`}
              strokeWidth={2.25}
            />
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

        <CombinedOrderStatusBadge status={combinedStatus} />

        <Link
          className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border border-emerald-800 bg-emerald-800 px-3 text-sm font-semibold text-white transition hover:border-emerald-900 hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
          href={`/dashboard/orders/${order.order_id}`}
        >
          View
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
      <p className="text-sm font-medium uppercase tracking-[0.08em] text-stone-500 sm:text-xs">
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
                  <p className="mt-0.5 truncate text-sm text-stone-500 sm:text-xs">
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
  value: OrderFilter | null;
}) {
  return (
    <div className="flex shrink-0 gap-2">
      {orderFilters.map((filter) => {
        const isActive = value === filter.value;

        return (
          <button
            aria-pressed={isActive}
            className={`min-h-12 shrink-0 rounded-full border px-4 text-base font-bold transition focus:outline-none focus:ring-2 focus:ring-emerald-700/30 sm:min-h-10 sm:px-3.5 sm:text-sm sm:font-medium ${
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
              className={`ml-2 rounded-full px-2 py-0.5 text-sm sm:text-xs ${
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

function OrderArchiveTabs({
  archivedCount,
  onChange,
  value,
}: {
  archivedCount: number;
  onChange: (value: OrderArchiveView) => void;
  value: OrderArchiveView;
}) {
  return (
    <div className="flex shrink-0 gap-2">
      <button
        aria-pressed={value === "archived"}
        className={`min-h-11 shrink-0 rounded-full border px-4 text-base font-bold transition focus:outline-none focus:ring-2 focus:ring-emerald-700/30 sm:min-h-9 sm:px-3.5 sm:text-sm sm:font-medium ${
          value === "archived"
            ? "border-[#6f614d] bg-[#6f614d] text-white"
            : "border-[#d7cfc1] bg-[#f7f3ea] text-stone-700 hover:border-[#9c8f7b] hover:text-stone-900"
        }`}
        type="button"
        onClick={() => onChange("archived")}
      >
        Archived
        <span
          className={`ml-2 rounded-full px-2 py-0.5 text-sm sm:text-xs ${
            value === "archived"
              ? "bg-white/20 text-white"
              : "bg-stone-100 text-stone-600"
          }`}
        >
          {archivedCount}
        </span>
      </button>
    </div>
  );
}

function PickupOptionFilterControl({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void;
  options: PickupOption[];
  value: PickupOptionFilter;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-emerald-100 bg-[#f4f8ef] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-emerald-100">
          <Image src="/glyphs/calendar.png" alt="" width={20} height={20} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-stone-950">
            Filter by pickup option
          </p>
          <p className="text-sm leading-5 text-stone-600">
            Quickly find orders for a specific pickup time or method.
          </p>
        </div>
      </div>
      <label className="shrink-0">
        <span className="sr-only">Filter by pickup option</span>
        <select
          className="seller-form-field min-h-11 rounded-lg bg-white font-medium sm:min-w-64"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="__all__">All pickup options</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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
      : "seller-small-button min-h-11 rounded-md p-0";

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

function CombinedOrderStatusBadge({ status }: { status: CombinedOrderStatus }) {
  const tone =
    status.tone === "completed"
      ? "bg-emerald-100 text-emerald-800"
      : status.tone === "canceled"
        ? "bg-red-100 text-red-800"
        : status.tone === "refunded"
          ? "bg-sky-100 text-sky-800"
          : status.tone === "warning"
            ? "bg-amber-100 text-amber-800"
            : "bg-stone-100 text-stone-700";

  return (
    <span
      className={`inline-flex min-h-7 w-fit max-w-full items-center justify-self-start whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium ${tone}`}
      title={status.description}
    >
      <span className="truncate">{status.label}</span>
    </span>
  );
}

function OrderArchivedBadge() {
  return (
    <span className="inline-flex min-h-7 items-center rounded-full bg-stone-200 px-2.5 py-1 text-sm font-medium text-stone-700 sm:min-h-0 sm:text-xs">
      Archived
    </span>
  );
}

function matchesFilter(order: SellerOrderRow, filter: OrderFilter) {
  if (filter === "all") return true;

  const lifecycle = getOrderLifecycleState(order);

  if (filter === "ready_for_pickup") {
    return lifecycle === "ready_for_pickup" || lifecycle === "needs_attention";
  }

  return lifecycle === filter;
}

function isOrderInArchiveView(
  order: SellerOrderRow,
  archiveView: OrderArchiveView,
) {
  return archiveView === "archived" ? Boolean(order.archived_at) : !order.archived_at;
}

function matchesPickupOptionFilter(
  order: SellerOrderRow,
  filter: PickupOptionFilter,
) {
  return filter === "__all__" || order.pickup_option_id === filter;
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

function groupPrintableItemsByOrderId(
  items: Array<PrintableOrderItem & { order_id: string }>,
) {
  return items.reduce<Record<string, PrintableOrderItem[]>>((groups, item) => {
    const { order_id: orderId, ...printableItem } = item;
    groups[orderId] = [...(groups[orderId] ?? []), printableItem];
    return groups;
  }, {});
}

async function loadStoreLogo(storeId: string): Promise<PrintableStoreLogo> {
  const { data, error } = await supabase
    .from("seller_media_management")
    .select("public_url, alt_text")
    .eq("store_id", storeId)
    .eq("entity_type", "store")
    .eq("entity_id", storeId)
    .eq("display_context", "logo")
    .eq("visibility_status", "active")
    .eq("asset_status", "active")
    .eq("moderation_status", "approved")
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(1)
    .returns<Array<NonNullable<PrintableStoreLogo>>>();

  if (error) return null;

  return data?.[0] ?? null;
}

function runOrderPrint(bodyClassName: string, onCleanup?: () => void) {
  let didCleanUp = false;
  const printMedia = window.matchMedia?.("print") ?? null;
  let hasEnteredPrint = printMedia?.matches ?? false;

  function cleanup() {
    if (didCleanUp) return;
    if (printMedia?.matches) return;

    didCleanUp = true;
    window.removeEventListener("beforeprint", markPrintStarted);
    window.removeEventListener("afterprint", cleanup);
    printMedia?.removeEventListener("change", handlePrintMediaChange);
    document.body.classList.remove(bodyClassName);
    onCleanup?.();
  }

  function markPrintStarted() {
    hasEnteredPrint = true;
  }

  function handlePrintMediaChange(event: MediaQueryListEvent) {
    if (event.matches) {
      hasEnteredPrint = true;
      return;
    }

    if (hasEnteredPrint) cleanup();
  }

  document.body.classList.add(bodyClassName);
  window.addEventListener("beforeprint", markPrintStarted);
  window.addEventListener("afterprint", cleanup, { once: true });
  printMedia?.addEventListener("change", handlePrintMediaChange);

  requestPrintFrame(() => {
    window.print();
  });
}

function requestPrintFrame(callback: () => void) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

function getFilterCounts(orders: OrderFilterCountRow[]) {
  const counts: Record<OrderFilter, number> = {
    all: orders.length,
    canceled: 0,
    completed: 0,
    ready_for_pickup: 0,
  };

  for (const order of orders) {
    const lifecycle = getOrderLifecycleState(order);

    if (lifecycle === "needs_attention") {
      counts.ready_for_pickup += 1;
    } else {
      counts[lifecycle] += 1;
    }
  }

  return counts;
}

function getCombinedOrderStatus(order: SellerOrderRow): CombinedOrderStatus {
  if (isOrderCanceled(order)) {
    return {
      description: "Order is canceled, regardless of payment state.",
      label: "Canceled",
      tone: "canceled",
    };
  }

  if (order.payment_status === "refunded") {
    return {
      description: "Payment status is refunded.",
      label: "Refunded",
      tone: "refunded",
    };
  }

  const isFulfilled = isOrderFulfilled(order);
  const isPaid = isOrderPaid(order);

  if (isFulfilled && isPaid) {
    return {
      description: "Order is fulfilled and payment is paid.",
      label: "Completed",
      tone: "completed",
    };
  }

  if (isFulfilled) {
    return {
      description: "Order is fulfilled and payment is unpaid.",
      label: "Fulfilled / Unpaid",
      tone: "warning",
    };
  }

  if (isPaid) {
    return {
      description: "Payment is paid and order is not fulfilled.",
      label: "Paid / Unfulfilled",
      tone: "warning",
    };
  }

  return {
    description: "Order is not fulfilled and payment is unpaid.",
    label: "Open",
    tone: "open",
  };
}

function isBulkFulfillmentEligible(order: SellerOrderRow) {
  return (
    !order.archived_at &&
    !isOrderCanceled(order) &&
    order.order_status !== "fulfilled"
  );
}

function isBulkPaymentEligible(order: SellerOrderRow) {
  return (
    !order.archived_at &&
    !isOrderCanceled(order) &&
    order.payment_provider === "offline" &&
    order.payment_method === "pay_at_pickup" &&
    (order.order_status === "pending" ||
      order.order_status === "open" ||
      order.order_status === "fulfilled") &&
    (order.payment_status === "pay_at_pickup" ||
      order.payment_status === "unpaid")
  );
}

function isBulkArchiveEligible(order: SellerOrderRow) {
  return !order.archived_at;
}

function isBulkUnarchiveEligible(order: SellerOrderRow) {
  return Boolean(order.archived_at);
}

function isOrderCanceled(order: SellerOrderRow) {
  return order.order_status === "canceled" || Boolean(order.canceled_at);
}

function isOrderFulfilled(order: SellerOrderRow) {
  return order.order_status === "fulfilled";
}

function isOrderPaid(order: SellerOrderRow) {
  return order.payment_status === "paid";
}

function isOrderUnfulfilledForArchive(order: SellerOrderRow) {
  return !isOrderCanceled(order) && !isOrderFulfilled(order);
}

function isOrderUnpaidForArchive(order: SellerOrderRow) {
  return !isOrderCanceled(order) && !isOrderPaid(order);
}

function getBulkArchiveSummary(orders: SellerOrderRow[]) {
  const eligibleOrders = orders.filter(isBulkArchiveEligible);
  const unfulfilledCount = eligibleOrders.filter(isOrderUnfulfilledForArchive).length;
  const unpaidCount = eligibleOrders.filter(isOrderUnpaidForArchive).length;
  const bothCount = eligibleOrders.filter(
    (order) => isOrderUnfulfilledForArchive(order) && isOrderUnpaidForArchive(order),
  ).length;

  return {
    bothCount,
    eligibleCount: eligibleOrders.length,
    needsAcknowledgement: unfulfilledCount > 0 || unpaidCount > 0,
    unpaidCount,
    unfulfilledCount,
  };
}

function getSelectedVisibleOrderIds(orders: SellerOrderRow[]) {
  return orders.map((order) => order.order_id);
}

function getFirstRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;

  return (data as T | null) ?? null;
}

function toBulkOrderActionError(message: string | null | undefined) {
  return message?.trim() || "Selected orders could not be updated.";
}

function formatBulkFulfillmentResult(result: BulkFulfillmentRpcResult | null) {
  if (!result) return "Selected orders updated.";

  const paymentMessage =
    result.payment_updated_count > 0
      ? ` ${result.payment_updated_count} ${pluralize(
          result.payment_updated_count,
          "order",
        )} also marked paid.`
      : "";
  const skippedMessage =
    result.skipped_count > 0
      ? ` ${result.skipped_count} ${pluralize(
          result.skipped_count,
          "order",
        )} skipped.`
      : "";

  return `${result.fulfilled_count} ${pluralize(
    result.fulfilled_count,
    "order",
  )} marked fulfilled.${paymentMessage}${skippedMessage}`;
}

function formatBulkSimpleResult(
  result: BulkSimpleRpcResult | null,
  actionLabel: string,
) {
  if (!result) return "Selected orders updated.";

  const skippedMessage =
    result.skipped_count > 0
      ? ` ${result.skipped_count} ${pluralize(
          result.skipped_count,
          "order",
        )} skipped.`
      : "";

  return `${result.updated_count} ${pluralize(
    result.updated_count,
    "order",
  )} ${actionLabel}.${skippedMessage}`;
}

function formatBulkArchiveWarning(
  dialog: Extract<BulkActionDialog, { kind: "archive" }>,
) {
  const parts: string[] = [];

  if (dialog.bothCount > 0) {
    parts.push(
      `${dialog.bothCount} ${pluralize(
        dialog.bothCount,
        "order",
      )} still open and unpaid`,
    );
  }

  const onlyUnfulfilledCount = dialog.unfulfilledCount - dialog.bothCount;
  if (onlyUnfulfilledCount > 0) {
    parts.push(
      `${onlyUnfulfilledCount} ${pluralize(
        onlyUnfulfilledCount,
        "order",
      )} still open`,
    );
  }

  const onlyUnpaidCount = dialog.unpaidCount - dialog.bothCount;
  if (onlyUnpaidCount > 0) {
    parts.push(
      `${onlyUnpaidCount} ${pluralize(
        onlyUnpaidCount,
        "order",
      )} still unpaid`,
    );
  }

  if (parts.length === 0) return "Selected orders are complete or canceled.";
  if (parts.length === 1) return `${parts[0]}.`;

  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}.`;
}

function pluralize(count: number, singular: string) {
  return count === 1 ? singular : `${singular}s`;
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

function formatShortDate(value: string | null) {
  if (!value) return "Date not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function getEmptyTitle(
  filter: OrderFilter,
  hasSearchOrPickupFilter: boolean,
  archiveView: OrderArchiveView,
) {
  if (hasSearchOrPickupFilter) return "No orders match that search.";
  if (archiveView === "archived") return "No archived orders";

  if (filter === "ready_for_pickup") return "No orders are ready for pickup.";
  if (filter === "completed") return "No completed orders yet.";
  if (filter === "canceled") return "No canceled orders.";

  return "No orders yet.";
}
