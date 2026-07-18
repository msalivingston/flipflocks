"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
} from "../../_components/seller-ui";
import { formatAgeAtAvailability } from "../../_lib/listing-formatters";
import {
  formatBuyerAddress,
  OrderPrintDocument,
} from "../_components/order-print-document";
import {
  formatCurrency,
  formatDateTime,
  formatInventoryLabel,
  formatOrderLifecycle,
  formatPaymentMethod,
  getOrderLifecycleState,
} from "../order-formatters";

type SellerOrderDetailRow = {
  order_id: string;
  order_number: string;
  order_source: string | null;
  order_status: string;
  payment_method: string | null;
  payment_status: string | null;
  payment_provider: string | null;
  provider_payment_status: string | null;
  paid_at: string | null;
  created_at: string;
  ready_for_pickup_at: string | null;
  fulfilled_at: string | null;
  canceled_at: string | null;
  buyer_first_name_snapshot: string | null;
  buyer_last_name_snapshot: string | null;
  buyer_email_snapshot: string | null;
  buyer_phone_snapshot: string | null;
  buyer_address_line1_snapshot: string | null;
  buyer_address_line2_snapshot: string | null;
  buyer_city_snapshot: string | null;
  buyer_state_snapshot: string | null;
  buyer_postal_code_snapshot: string | null;
  buyer_country_snapshot: string | null;
  pickup_note: string | null;
  buyer_notes: string | null;
  subtotal_amount: number | null;
  tax_fee_label_snapshot: string | null;
  tax_fee_amount: number | null;
  total_amount: number | null;
  item_count: number | null;
  total_item_quantity: number | null;
  pickup_option_label_snapshot: string | null;
  fulfillment_method: "pickup" | "delivery" | string | null;
  delivery_option_name_snapshot: string | null;
  delivery_fee_amount: number | null;
};

type SellerOrderFulfillmentSnapshotRow = {
  fulfillment_method: "pickup" | "delivery" | string | null;
  delivery_option_name_snapshot: string | null;
  delivery_fee_amount: number | null;
};

type SellerOrderItemRow = {
  order_item_id: string;
  inventory_item_id: string | null;
  listing_batch_id: string | null;
  listing_batch_breed_id: string | null;
  seller_breed_profile_id: string | null;
  species_name_snapshot: string;
  breed_display_name_snapshot: string;
  inventory_type_snapshot: string;
  custom_inventory_label_snapshot: string | null;
  hatch_date_snapshot: string | null;
  available_date_snapshot: string | null;
  age_at_sale_days_snapshot: number | null;
  order_item_source: string | null;
  custom_item_name_snapshot: string | null;
  equipment_inventory_item_id: string | null;
  processed_poultry_inventory_item_id: string | null;
  product_type_snapshot: string | null;
  item_name_snapshot: string | null;
  item_category_snapshot: string | null;
  unit_price_snapshot: number | null;
  quantity: number;
  fulfilled_quantity: number;
  remaining_unfulfilled_quantity: number;
  line_subtotal: number | null;
};

type SellerMediaRow = {
  entity_type: string;
  entity_id: string;
  display_context?: string;
  public_url: string;
  alt_text: string | null;
  sort_order: number | null;
  is_featured: boolean;
  moderation_status: string;
  asset_status: string;
  visibility_status: string;
};

type OrderDetailState = {
  items: SellerOrderItemRow[];
  mediaByItemId: Record<string, SellerMediaRow | null>;
  order: SellerOrderDetailRow | null;
  storeLogo: SellerMediaRow | null;
};

const orderDetailButtonClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-emerald-700 bg-white px-3.5 text-base font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 sm:min-h-9 sm:text-sm";
const orderDetailBackButtonClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3.5 text-base font-bold text-stone-950 shadow-sm transition hover:bg-[#fbfaf6] focus:outline-none focus:ring-2 focus:ring-emerald-700/30 sm:min-h-9 sm:text-sm";
const requestedItemsGridClass =
  "grid gap-3 sm:grid-cols-[minmax(0,1fr)_3.25rem_5.75rem_6.5rem]";

/**
 * Read-only seller order detail for the first public order intake workflow.
 * Mutation actions are intentionally deferred to later fulfillment groups.
 */
export function OrderDetail({ orderId }: { orderId: string }) {
  const { seller } = useSellerContext();
  const [data, setData] = useState<OrderDetailState>({
    items: [],
    mediaByItemId: {},
    order: null,
    storeLogo: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionWarning, setActionWarning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fulfillmentError, setFulfillmentError] = useState<string | null>(null);
  const [unfulfillmentError, setUnfulfillmentError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [restoreInventoryOnCancel, setRestoreInventoryOnCancel] = useState(true);
  const [emailCancellationToBuyer, setEmailCancellationToBuyer] = useState(false);
  const [pendingResendConfirmationActionId, setPendingResendConfirmationActionId] =
    useState<string | null>(null);
  const [isPrintPortalReady, setIsPrintPortalReady] = useState(false);
  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [showFulfillmentDialog, setShowFulfillmentDialog] = useState(false);
  const [showUnfulfillmentDialog, setShowUnfulfillmentDialog] = useState(false);
  const [showResendConfirmationDialog, setShowResendConfirmationDialog] =
    useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadOrder() {
      if (!seller) return;

      setIsLoading(true);
      setError(null);

      const [orderResult, itemResult, fulfillmentSnapshotResult, storeLogo] =
        await Promise.all([
        supabase
          .from("seller_order_management")
          .select(
            "order_id, order_number, order_source, order_status, payment_method, payment_status, payment_provider, provider_payment_status, paid_at, created_at, ready_for_pickup_at, fulfilled_at, canceled_at, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_email_snapshot, buyer_phone_snapshot, buyer_address_line1_snapshot, buyer_address_line2_snapshot, buyer_city_snapshot, buyer_state_snapshot, buyer_postal_code_snapshot, buyer_country_snapshot, pickup_note, buyer_notes, subtotal_amount, tax_fee_label_snapshot, tax_fee_amount, total_amount, item_count, total_item_quantity, pickup_option_label_snapshot",
          )
          .eq("store_id", seller.store_id)
          .eq("order_id", orderId)
          .maybeSingle<SellerOrderDetailRow>(),
        supabase
          .from("seller_order_item_detail")
          .select(
            "order_item_id, inventory_item_id, listing_batch_id, listing_batch_breed_id, seller_breed_profile_id, species_name_snapshot, breed_display_name_snapshot, inventory_type_snapshot, custom_inventory_label_snapshot, hatch_date_snapshot, available_date_snapshot, age_at_sale_days_snapshot, order_item_source, custom_item_name_snapshot, equipment_inventory_item_id, processed_poultry_inventory_item_id, product_type_snapshot, item_name_snapshot, item_category_snapshot, unit_price_snapshot, quantity, fulfilled_quantity, remaining_unfulfilled_quantity, line_subtotal",
          )
          .eq("store_id", seller.store_id)
          .eq("order_id", orderId)
          .order("created_at", { ascending: true })
          .returns<SellerOrderItemRow[]>(),
        supabase
          .from("orders")
          .select(
            "fulfillment_method, delivery_option_name_snapshot, delivery_fee_amount",
          )
          .eq("store_id", seller.store_id)
          .eq("id", orderId)
          .maybeSingle<SellerOrderFulfillmentSnapshotRow>(),
        loadStoreLogo(seller.store_id),
      ]);

      if (!isMounted) return;

      const firstError =
        orderResult.error ?? itemResult.error ?? fulfillmentSnapshotResult.error;

      if (firstError) {
        setError(firstError.message);
        setIsLoading(false);
        return;
      }

      const items = itemResult.data ?? [];
      const mediaByItemId = await loadOrderItemMedia(items, seller.store_id);

      if (!isMounted) return;

      setData({
        order: orderResult.data
          ? {
              ...orderResult.data,
              fulfillment_method:
                fulfillmentSnapshotResult.data?.fulfillment_method ?? "pickup",
              delivery_option_name_snapshot:
                fulfillmentSnapshotResult.data?.delivery_option_name_snapshot ??
                null,
              delivery_fee_amount:
                fulfillmentSnapshotResult.data?.delivery_fee_amount ?? 0,
            }
          : null,
        items,
        mediaByItemId,
        storeLogo,
      });
      setIsLoading(false);
    }

    void loadOrder();

    return () => {
      isMounted = false;
    };
  }, [orderId, refreshKey, seller]);

  const order = data.order;
  const customerName = useMemo(
    () => (order ? formatCustomerName(order) : "Buyer"),
    [order],
  );
  const remainingPickupQuantity = useMemo(
    () =>
      data.items.reduce(
        (total, item) => total + Math.max(item.remaining_unfulfilled_quantity, 0),
        0,
      ),
    [data.items],
  );
  const isDeliveryOrder = order?.fulfillment_method === "delivery";
  const deliveryOptionName = order?.delivery_option_name_snapshot?.trim() ?? "";
  const deliveryFeeAmount = order?.delivery_fee_amount ?? 0;
  const buyerHasEmail = Boolean(order?.buyer_email_snapshot?.trim());
  const canResendOrderConfirmation = Boolean(
    order && buyerHasEmail && canResendConfirmation(order),
  );

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setIsPrintPortalReady(true);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  if (isLoading) {
    return (
      <>
        <SellerPageHeader title="Order" description="Loading order details." />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <LoadingState label="Loading order" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <SellerPageHeader
          title="Order"
          description="Review buyer request details."
        />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <ErrorState
            title="Order could not load"
            message="Please refresh the page or return to Orders."
            action={<BackToOrdersLink />}
          />
        </div>
      </>
    );
  }

  if (!order) {
    return (
      <>
        <SellerPageHeader
          title="Order not found"
          description="This order may not exist or may not belong to this store."
        />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <EmptyState
            title="Order not found"
            description="Return to Orders to review requests for this store."
            action={<BackToOrdersLink />}
          />
        </div>
      </>
    );
  }

  async function markOrderFulfilled({ markPaid }: { markPaid: boolean }) {
    if (!order || isSaving) return;

    const fulfillmentItems = data.items
      .filter((item) => item.remaining_unfulfilled_quantity > 0)
      .map((item) => ({
        order_item_id: item.order_item_id,
        quantity: item.remaining_unfulfilled_quantity,
      }));

    if (fulfillmentItems.length === 0) {
      setFulfillmentError("There are no remaining items to mark fulfilled.");
      return;
    }

    setIsSaving(true);
    setActionError(null);
    setActionMessage(null);
    setActionWarning(null);
    setFulfillmentError(null);
    setUnfulfillmentError(null);

    const { error: fulfillmentRpcError } = await supabase.rpc(
      "seller_record_order_fulfillment",
      {
        p_order_id: order.order_id,
        p_items: fulfillmentItems,
        p_note: null,
      },
    );

    if (fulfillmentRpcError) {
      console.warn("Order fulfillment failed", fulfillmentRpcError.message);
      setFulfillmentError(toSellerOrderFulfillmentError(fulfillmentRpcError.message));
      setIsSaving(false);
      return;
    }

    if (markPaid && order.payment_status !== "paid") {
      const { error: paymentError } = await supabase.rpc("mark_order_paid", {
        p_order_id: order.order_id,
        p_note: "Payment received at pickup.",
      });

      if (paymentError) {
        console.warn("Order payment update after fulfillment failed", paymentError.message);
        setActionWarning(
          "Order was marked fulfilled, but payment status could not be updated.",
        );
        setShowCancelPanel(false);
        setShowFulfillmentDialog(false);
        setIsActionsMenuOpen(false);
        setRefreshKey((current) => current + 1);
        setIsSaving(false);
        return;
      }
    }

    setActionMessage(
      markPaid
        ? "Order marked fulfilled and paid."
        : "Order marked fulfilled.",
    );
    setShowCancelPanel(false);
    setShowFulfillmentDialog(false);
    setShowUnfulfillmentDialog(false);
    setIsActionsMenuOpen(false);
    setRefreshKey((current) => current + 1);
    setIsSaving(false);
  }

  async function markOrderUnfulfilled() {
    if (!order || isSaving) return;

    setIsSaving(true);
    setActionError(null);
    setActionMessage(null);
    setActionWarning(null);
    setFulfillmentError(null);
    setUnfulfillmentError(null);

    const { error: unfulfillmentRpcError } = await supabase.rpc(
      "seller_mark_order_unfulfilled",
      {
        p_order_id: order.order_id,
        p_note: null,
      },
    );

    if (unfulfillmentRpcError) {
      console.warn("Order unfulfillment failed", unfulfillmentRpcError.message);
      setUnfulfillmentError(
        toSellerOrderUnfulfillmentError(unfulfillmentRpcError.message),
      );
      setIsSaving(false);
      return;
    }

    setActionMessage("Order marked unfulfilled.");
    setShowCancelPanel(false);
    setShowFulfillmentDialog(false);
    setShowUnfulfillmentDialog(false);
    setIsActionsMenuOpen(false);
    setRefreshKey((current) => current + 1);
    setIsSaving(false);
  }

  async function markOrderPaid() {
    if (!order) return;

    setIsSaving(true);
    setActionError(null);
    setActionMessage(null);
    setActionWarning(null);
    setFulfillmentError(null);
    setUnfulfillmentError(null);
    setIsActionsMenuOpen(false);

    const { error: paymentError } = await supabase.rpc("mark_order_paid", {
      p_order_id: order.order_id,
      p_note: "Payment marked paid by seller.",
    });

    if (paymentError) {
      setActionError(toSellerOrderPaymentActionError(paymentError.message, "paid"));
      setIsSaving(false);
      return;
    }

    setActionMessage("Order marked paid.");
    setShowCancelPanel(false);
    setShowFulfillmentDialog(false);
    setShowUnfulfillmentDialog(false);
    setIsActionsMenuOpen(false);
    setRefreshKey((current) => current + 1);
    setIsSaving(false);
  }

  async function markOrderUnpaid() {
    if (!order) return;

    setIsSaving(true);
    setActionError(null);
    setActionMessage(null);
    setActionWarning(null);
    setFulfillmentError(null);
    setUnfulfillmentError(null);
    setIsActionsMenuOpen(false);

    const { error: paymentError } = await supabase.rpc("mark_order_pay_at_pickup", {
      p_order_id: order.order_id,
      p_note: "Payment marked unpaid by seller.",
    });

    if (paymentError) {
      setActionError(toSellerOrderPaymentActionError(paymentError.message, "unpaid"));
      setIsSaving(false);
      return;
    }

    setActionMessage("Order marked unpaid.");
    setShowCancelPanel(false);
    setShowFulfillmentDialog(false);
    setShowUnfulfillmentDialog(false);
    setIsActionsMenuOpen(false);
    setRefreshKey((current) => current + 1);
    setIsSaving(false);
  }

  async function cancelOrder() {
    if (!order) return;

    const trimmedReason = cancelReason.trim();

    if (!trimmedReason) {
      setActionError("Please add a short reason before canceling this order.");
      return;
    }

    setIsCanceling(true);
    setActionError(null);
    setActionMessage(null);
    setActionWarning(null);

    const shouldEmailCancellation = buyerHasEmail && emailCancellationToBuyer;
    const { data: cancelData, error: cancelError } = await supabase.rpc("cancel_order", {
      p_order_id: order.order_id,
      p_canceled_reason: trimmedReason,
      p_restore_inventory: true,
      p_send_buyer_notification: shouldEmailCancellation,
    });

    if (cancelError) {
      setActionError(toSellerOrderCancellationError(cancelError.message));
      setIsCanceling(false);
      return;
    }

    const cancelResult = Array.isArray(cancelData) ? cancelData[0] : null;
    const emailQueued = Boolean(
      cancelResult?.buyer_notification_queued &&
        cancelResult?.seller_copy_queued,
    );

    setActionMessage(
      shouldEmailCancellation && emailQueued
        ? "Order canceled and customer emailed."
        : "Order canceled.",
    );
    if (shouldEmailCancellation && !emailQueued) {
      setActionWarning(
        "Order canceled, but the cancellation email could not be queued.",
      );
    }
    setCancelReason("");
    setRestoreInventoryOnCancel(true);
    setEmailCancellationToBuyer(false);
    setShowCancelPanel(false);
    setRefreshKey((current) => current + 1);
    setIsCanceling(false);
  }

  async function resendOrderConfirmation() {
    if (!order || isResendingConfirmation) return;

    const buyerEmail = order.buyer_email_snapshot?.trim();

    if (!buyerEmail) {
      setActionError("This order does not have a customer email address.");
      return;
    }

    if (!canResendConfirmation(order)) {
      setActionError("This order is not eligible for confirmation resend.");
      return;
    }

    setIsResendingConfirmation(true);
    setActionError(null);
    setActionMessage(null);
    setActionWarning(null);

    const emailActionId =
      pendingResendConfirmationActionId ?? crypto.randomUUID();

    const { data: resendData, error: resendError } = await supabase.rpc(
      "seller_resend_order_confirmation",
      {
        p_email_action_id: emailActionId,
        p_order_id: order.order_id,
      },
    );

    if (resendError) {
      setPendingResendConfirmationActionId(emailActionId);
      setActionError(
        "The order was not changed, but the confirmation email could not be queued. Please try again.",
      );
      setIsResendingConfirmation(false);
      setShowResendConfirmationDialog(false);
      return;
    }

    const resendResult = Array.isArray(resendData) ? resendData[0] : null;
    const notificationQueued = Boolean(resendResult?.notification_queued);

    if (!notificationQueued) {
      setPendingResendConfirmationActionId(emailActionId);
      setActionError("This order does not have a customer email address.");
      setIsResendingConfirmation(false);
      setShowResendConfirmationDialog(false);
      return;
    }

    const kickSucceeded = await kickPostmarkEmailWorker();

    if (!kickSucceeded) {
      setPendingResendConfirmationActionId(null);
      setActionWarning(
        "Order confirmation was queued, but email processing could not be started automatically.",
      );
      setIsResendingConfirmation(false);
      setShowResendConfirmationDialog(false);
      return;
    }

    setPendingResendConfirmationActionId(null);
    setActionMessage("Order confirmation resent.");
    setShowResendConfirmationDialog(false);
    setIsResendingConfirmation(false);
  }

  function openResendConfirmationDialog() {
    if (!order || isResendingConfirmation) return;

    const buyerEmail = order.buyer_email_snapshot?.trim();

    setActionError(null);
    setActionMessage(null);
    setActionWarning(null);
    setFulfillmentError(null);
    setUnfulfillmentError(null);

    if (!buyerEmail) {
      setActionError("This order does not have a customer email address.");
      return;
    }

    if (!canResendConfirmation(order)) {
      setActionError("This order is not eligible for confirmation resend.");
      return;
    }

    setShowCancelPanel(false);
    setShowFulfillmentDialog(false);
    setShowUnfulfillmentDialog(false);
    setShowResendConfirmationDialog(true);
    setIsActionsMenuOpen(false);
  }

  function printOrder() {
    runOrderPrint("order-print-active");
  }

  function openCancelPanel() {
    setActionError(null);
    setActionMessage(null);
    setActionWarning(null);
    setFulfillmentError(null);
    setUnfulfillmentError(null);
    setIsActionsMenuOpen(false);
    setRestoreInventoryOnCancel(true);
    setEmailCancellationToBuyer(buyerHasEmail);
    setShowFulfillmentDialog(false);
    setShowUnfulfillmentDialog(false);
    setShowResendConfirmationDialog(false);
    setShowCancelPanel(true);
  }

  return (
    <>
    <div className="order-detail-screen-content mx-auto flex w-full max-w-[1260px] flex-col gap-3 px-4 py-3 sm:px-6 sm:py-4 lg:px-7">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-bold uppercase text-emerald-800 sm:text-xs">
            Storefront order
          </span>
          <h1 className="mt-2 text-3xl font-bold text-stone-950 sm:text-[2.1rem]">
            Order {order.order_number}
          </h1>
          <p className="mt-0.5 text-sm font-medium text-stone-600 sm:text-base">
            {formatDateTime(order.created_at)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusPill tone={getSavedOrderStatusTone(order.order_status)}>
              {formatSavedOrderStatus(order.order_status)}
            </StatusPill>
            <StatusPill tone={getSavedPaymentStatusTone(order.payment_status)}>
              {formatSavedPaymentStatus(order.payment_status)}
            </StatusPill>
          </div>
        </div>
        <div className="flex flex-col gap-5 lg:items-end">
          <BackToOrdersLink />
          <div className="flex flex-wrap gap-2.5 lg:justify-end">
            <button
              className={orderDetailButtonClass}
              type="button"
              onClick={printOrder}
            >
              <Image src="/glyphs/clipboard.png" alt="" width={18} height={18} />
              Print order
            </button>
            {canEditOrder(order) ? (
              <Link
                className={orderDetailButtonClass}
                href={`/dashboard/orders/${order.order_id}/edit`}
              >
                <Image src="/glyphs/pencil.png" alt="" width={18} height={18} />
                Edit order
              </Link>
            ) : null}
            <QuickActionsMenu
              canCancel={canCancelOrder(order)}
              canMarkComplete={canMarkComplete(order, remainingPickupQuantity)}
              canMarkPaid={canMarkPaymentPaid(order)}
              canMarkUnfulfilled={canMarkUnfulfilled(order)}
              canMarkUnpaid={canMarkPaymentUnpaid(order)}
              canResendConfirmation={canResendOrderConfirmation}
              isBusy={isSaving || isCanceling || isResendingConfirmation}
              isOpen={isActionsMenuOpen}
              onCancel={openCancelPanel}
              onMarkComplete={() => {
                setActionError(null);
                setActionMessage(null);
                setActionWarning(null);
                setFulfillmentError(null);
                setUnfulfillmentError(null);
                setShowCancelPanel(false);
                setShowUnfulfillmentDialog(false);
                setShowResendConfirmationDialog(false);
                setShowFulfillmentDialog(true);
                setIsActionsMenuOpen(false);
              }}
              onMarkPaid={() => void markOrderPaid()}
              onMarkUnfulfilled={() => {
                setActionError(null);
                setActionMessage(null);
                setActionWarning(null);
                setFulfillmentError(null);
                setUnfulfillmentError(null);
                setShowCancelPanel(false);
                setShowFulfillmentDialog(false);
                setShowResendConfirmationDialog(false);
                setShowUnfulfillmentDialog(true);
                setIsActionsMenuOpen(false);
              }}
              onMarkUnpaid={() => void markOrderUnpaid()}
              onOpenChange={setIsActionsMenuOpen}
              onPrint={printOrder}
              onResendConfirmation={openResendConfirmationDialog}
            />
          </div>
        </div>
      </header>

      <SellerCard className="p-3.5 shadow-[0_12px_30px_rgba(46,39,25,0.045)] sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-900">
              {getCustomerInitials(customerName)}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-stone-950">
                {customerName}
              </h2>
              <p className="mt-0.5 text-sm font-semibold text-stone-700">
                {order.total_item_quantity ?? 0} item
                {(order.total_item_quantity ?? 0) === 1 ? "" : "s"}{" "}
                <span aria-hidden="true" className="mx-2 text-stone-400">
                  -
                </span>
                {formatCurrency(order.total_amount)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <StatusPill tone={getOrderLifecycleTone(order)}>
              {formatOrderLifecycle(order)}
            </StatusPill>
            <StatusPill tone="bg-emerald-100 text-emerald-800">
              {formatPaymentMethod(order.payment_method)}
            </StatusPill>
          </div>
        </div>
      </SellerCard>

      {actionMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {actionMessage}
        </p>
      ) : null}
      {actionWarning ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          {actionWarning}
        </p>
      ) : null}
      {actionError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {actionError}
        </p>
      ) : null}

      {showCancelPanel ? (
        <CancellationPanel
          cancelReason={cancelReason}
          emailCancellationToBuyer={emailCancellationToBuyer}
          hasBuyerEmail={buyerHasEmail}
          isCanceling={isCanceling}
          restoreInventoryOnCancel={restoreInventoryOnCancel}
          onCancel={cancelOrder}
          onClose={() => {
            setCancelReason("");
            setRestoreInventoryOnCancel(true);
            setEmailCancellationToBuyer(false);
            setShowCancelPanel(false);
          }}
          onEmailCancellationChange={setEmailCancellationToBuyer}
          onReasonChange={setCancelReason}
        />
      ) : null}

      {showFulfillmentDialog ? (
        <FulfillmentDialog
          canMarkPaid={canMarkPaymentPaid(order)}
          error={fulfillmentError}
          isSaving={isSaving}
          onClose={() => {
            if (isSaving) return;
            setFulfillmentError(null);
            setShowFulfillmentDialog(false);
          }}
          onFulfillOnly={() => void markOrderFulfilled({ markPaid: false })}
          onFulfillPaid={() => void markOrderFulfilled({ markPaid: true })}
        />
      ) : null}

      {showUnfulfillmentDialog ? (
        <UnfulfillmentDialog
          error={unfulfillmentError}
          isSaving={isSaving}
          onClose={() => {
            if (isSaving) return;
            setUnfulfillmentError(null);
            setShowUnfulfillmentDialog(false);
          }}
          onConfirm={() => void markOrderUnfulfilled()}
        />
      ) : null}

      {showResendConfirmationDialog ? (
        <ResendConfirmationDialog
          buyerEmail={order.buyer_email_snapshot?.trim() ?? ""}
          isSending={isResendingConfirmation}
          onClose={() => {
            if (isResendingConfirmation) return;
            setShowResendConfirmationDialog(false);
          }}
          onConfirm={() => void resendOrderConfirmation()}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19.5rem]">
        <main className="grid gap-3">
          <SellerCard className="overflow-hidden shadow-[0_12px_30px_rgba(46,39,25,0.045)]">
            <div className={`${requestedItemsGridClass} border-b border-stone-200/80 bg-white px-4 py-3 text-sm font-bold uppercase text-stone-600 sm:text-xs`}>
              <h2 className="text-lg font-bold normal-case text-stone-950">
                Items
              </h2>
              <span className="hidden text-right sm:block">Qty</span>
              <span className="hidden text-right sm:block">Each</span>
              <span className="hidden text-right sm:block">Line total</span>
            </div>
            {data.items.length > 0 ? (
              <>
                <div className="divide-y divide-stone-200/80">
                  {data.items.map((item) => (
                    <OrderItemRow
                      key={item.order_item_id}
                      item={item}
                      media={data.mediaByItemId[item.order_item_id] ?? null}
                    />
                  ))}
                </div>
                <dl className="border-t border-stone-200/80 bg-[#fffdf8] px-4 py-2.5 text-sm">
                  <RequestedTotalRow
                    label="Subtotal"
                    value={formatCurrency(order.subtotal_amount)}
                  />
                  {order.tax_fee_amount ? (
                    <RequestedTotalRow
                      label={order.tax_fee_label_snapshot ?? "Tax/fee"}
                      value={formatCurrency(order.tax_fee_amount)}
                    />
                  ) : null}
                  {isDeliveryOrder ? (
                    <RequestedTotalRow
                      label={`Delivery${
                        deliveryOptionName ? ` — ${deliveryOptionName}` : ""
                      }`}
                      value={formatCurrency(deliveryFeeAmount)}
                    />
                  ) : null}
                  <RequestedTotalRow
                    isStrong
                    label="Total"
                    value={formatCurrency(order.total_amount)}
                  />
                </dl>
              </>
            ) : (
              <div className="p-5">
                <EmptyState
                  title="No line items found"
                  description="This order does not currently show any requested items."
                />
              </div>
            )}
          </SellerCard>

          <FulfillmentNotesSection
            address={formatBuyerAddress(order)}
            deliveryFee={formatCurrency(deliveryFeeAmount)}
            deliveryOptionName={deliveryOptionName}
            isDeliveryOrder={isDeliveryOrder}
            order={order}
          />
        </main>

        <aside className="grid h-fit gap-4">
          <SellerCard className="p-4 shadow-[0_12px_30px_rgba(46,39,25,0.045)]">
            <h2 className="text-lg font-bold text-stone-950">Buyer contact</h2>
            <div className="mt-4 grid gap-3.5">
              <ContactLine
                glyph="/glyphs/person.png"
                value={customerName}
              />
              <ContactEmailLine
                emptyValue="No email provided"
                glyph="/glyphs/envelope.png"
                value={order.buyer_email_snapshot}
              />
              <ContactPhoneLine
                emptyValue="No phone provided"
                glyph="/glyphs/phone.png"
                value={order.buyer_phone_snapshot}
              />
              <ContactLine
                emptyValue="No billing address provided"
                glyph="/glyphs/map-pin.png"
                value={formatBuyerAddress(order)}
              />
            </div>
          </SellerCard>
        </aside>
      </div>
    </div>
      {isPrintPortalReady && typeof document !== "undefined"
        ? createPortal(
            <OrderPrintDocument
              items={data.items}
              order={order}
              storeLogo={data.storeLogo}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function OrderItemRow({
  item,
  media,
}: {
  item: SellerOrderItemRow;
  media: SellerMediaRow | null;
}) {
  const isCustomItem = item.order_item_source === "custom";
  const isEquipmentItem = item.order_item_source === "equipment_inventory";
  const isProcessedPoultryItem =
    item.order_item_source === "processed_poultry_inventory";
  const label = formatInventoryLabel({
    custom_inventory_label: item.custom_inventory_label_snapshot,
    inventory_type: item.inventory_type_snapshot,
  });
  const itemTitle = isEquipmentItem || isProcessedPoultryItem
    ? item.item_name_snapshot || item.breed_display_name_snapshot
    : item.custom_item_name_snapshot || item.breed_display_name_snapshot;
  const subtitle = isCustomItem
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
    subtitle,
    !isCustomItem && !isEquipmentItem && !isProcessedPoultryItem
      ? formatSellerItemDetail(label)
      : null,
    !isCustomItem &&
    !isEquipmentItem &&
    !isProcessedPoultryItem &&
    item.age_at_sale_days_snapshot != null
      ? formatAgeAtAvailability(item.age_at_sale_days_snapshot)
      : null,
  ].filter(Boolean);

  return (
    <article className={`${requestedItemsGridClass} px-4 py-3 sm:items-center`}>
      <div className="flex min-w-0 gap-3">
        <ItemThumbnail
          alt={media?.alt_text || itemTitle}
          fallbackGlyph={getItemFallbackGlyph(item)}
          src={media?.public_url}
        />
        <div className="min-w-0">
          <h3 className="break-words text-base font-bold leading-6 text-stone-950 sm:truncate sm:text-sm sm:leading-5">
            {itemTitle}
          </h3>
          <p className="mt-0.5 break-words text-sm leading-6 text-stone-600 sm:truncate sm:leading-5">
            {details.join(" - ")}
          </p>
          <p className="mt-0.5 break-words text-sm font-medium leading-5 text-stone-500 sm:text-xs">
            {item.hatch_date_snapshot
              ? `Hatched ${formatShortDate(item.hatch_date_snapshot)}`
              : null}
            {item.available_date_snapshot
              ? `${item.hatch_date_snapshot ? " - " : ""}Available ${formatShortDate(
                  item.available_date_snapshot,
                )}`
              : null}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 text-sm min-[360px]:grid-cols-3 sm:contents">
        <MobileAmount label="Qty" value={`${item.quantity}`} />
        <MobileAmount
          label="Unit"
          value={formatCurrency(item.unit_price_snapshot)}
        />
        <MobileAmount
          label="Line total"
          value={formatCurrency(item.line_subtotal)}
        />
      </div>
    </article>
  );
}

function FulfillmentNotesSection({
  address,
  deliveryFee,
  deliveryOptionName,
  isDeliveryOrder,
  order,
}: {
  address: string | null;
  deliveryFee: string;
  deliveryOptionName: string;
  isDeliveryOrder: boolean;
  order: SellerOrderDetailRow;
}) {
  const rows = getFulfillmentNoteRows({
    address,
    deliveryFee,
    deliveryOptionName,
    isDeliveryOrder,
    order,
  });

  if (rows.length === 0) return null;

  return (
    <SellerCard className="p-4 shadow-[0_12px_30px_rgba(46,39,25,0.045)]">
      <h2 className="text-lg font-bold text-stone-950">
        {isDeliveryOrder ? "Delivery" : "Pickup"}
      </h2>
      <dl className="mt-2 grid gap-1.5 text-sm leading-5 text-stone-700">
        {rows.map((row) => (
          <div
            className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3"
            key={row.label}
          >
            <dt className="font-bold text-stone-950">{row.label}</dt>
            <dd className="whitespace-pre-line break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
    </SellerCard>
  );
}

function ContactLine({
  emptyValue = "Not provided",
  glyph,
  value,
}: {
  emptyValue?: string;
  glyph: string;
  value: string | null;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 text-sm font-normal text-stone-700">
      <Image className="shrink-0" src={glyph} alt="" width={18} height={18} />
      <span className="min-w-0 whitespace-pre-line break-words leading-5">
        {value || emptyValue}
      </span>
    </div>
  );
}

function ContactEmailLine({
  emptyValue,
  glyph,
  value,
}: {
  emptyValue: string;
  glyph: string;
  value: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 text-sm font-normal text-stone-700">
      <Image className="shrink-0" src={glyph} alt="" width={18} height={18} />
      {value ? (
        <a
          className="min-w-0 truncate text-stone-700 underline-offset-4 hover:text-emerald-800 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
          href={`mailto:${value}`}
          title={value}
        >
          {value}
        </a>
      ) : (
        <span className="min-w-0 truncate text-stone-500">{emptyValue}</span>
      )}
    </div>
  );
}

function ContactPhoneLine({
  emptyValue,
  glyph,
  value,
}: {
  emptyValue: string;
  glyph: string;
  value: string | null;
}) {
  if (!value) {
    return <ContactLine emptyValue={emptyValue} glyph={glyph} value={null} />;
  }

  const phoneHref = formatPhoneHref(value);

  return (
    <>
      <details className="relative min-w-0 md:hidden">
        <summary className="flex min-w-0 cursor-pointer list-none items-center gap-3 text-sm font-normal text-stone-700 transition hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/30">
          <Image className="shrink-0" src={glyph} alt="" width={18} height={18} />
          <span className="min-w-0 truncate">{value}</span>
          <ChevronDown aria-hidden="true" className="ml-auto size-3.5 shrink-0" />
        </summary>
        <div className="absolute left-7 z-20 mt-2 grid min-w-32 gap-1 rounded-lg border border-stone-200 bg-white p-1.5 text-sm font-semibold shadow-[0_12px_30px_rgba(46,39,25,0.12)]">
          <a
            className="rounded-md px-3 py-2 text-stone-950 hover:bg-[#fbfaf6] hover:text-emerald-800"
            href={`tel:${phoneHref}`}
          >
            Call
          </a>
          <a
            className="rounded-md px-3 py-2 text-stone-950 hover:bg-[#fbfaf6] hover:text-emerald-800"
            href={`sms:${phoneHref}`}
          >
            Text
          </a>
        </div>
      </details>
      <a
        className="hidden min-w-0 items-center gap-3 text-sm font-normal text-stone-700 underline-offset-4 hover:text-emerald-800 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-700/30 md:flex"
        href={`tel:${phoneHref}`}
      >
        <Image className="shrink-0" src={glyph} alt="" width={18} height={18} />
        <span className="min-w-0 truncate">{value}</span>
      </a>
    </>
  );
}

function RequestedTotalRow({
  isStrong = false,
  label,
  value,
}: {
  isStrong?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-0.5 sm:grid-cols-[minmax(0,1fr)_3.25rem_5.75rem_6.5rem]">
      <dt
        className={`sm:col-span-3 ${
          isStrong
            ? "border-t border-stone-200 pt-2 text-base font-bold text-stone-950"
            : "text-stone-700"
        }`}
      >
        {label}
      </dt>
      <dd
        className={`text-right ${
          isStrong
            ? "border-t border-stone-200 pt-2 text-base font-bold text-stone-950"
            : "text-stone-700"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function BackToOrdersLink() {
  return (
    <Link className={orderDetailBackButtonClass} href="/dashboard/orders">
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to Orders
    </Link>
  );
}

function formatCustomerName(order: SellerOrderDetailRow) {
  return (
    [order.buyer_first_name_snapshot, order.buyer_last_name_snapshot]
      .filter(Boolean)
      .join(" ") || "Buyer"
  );
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

function getFulfillmentNoteRows({
  address,
  deliveryFee,
  deliveryOptionName,
  isDeliveryOrder,
  order,
}: {
  address: string | null;
  deliveryFee: string;
  deliveryOptionName: string;
  isDeliveryOrder: boolean;
  order: SellerOrderDetailRow;
}) {
  const pickupOption = order.pickup_option_label_snapshot?.trim() ?? "";
  const pickupNote = order.pickup_note?.trim() ?? "";
  const customerNote = order.buyer_notes?.trim() ?? "";
  const rows: Array<{ label: string; value: string }> = [];

  if (isDeliveryOrder) {
    if (deliveryOptionName) {
      rows.push({ label: "Delivery option", value: deliveryOptionName });
    }

    rows.push({ label: "Delivery fee", value: deliveryFee });

    if (address) {
      rows.push({ label: "Delivery address", value: address });
    }
  } else if (pickupOption) {
    rows.push({ label: "Pickup option", value: pickupOption });
  } else if (pickupNote) {
    rows.push({ label: "Pickup note", value: pickupNote });
  }

  if (customerNote) {
    rows.push({ label: "Customer note", value: customerNote });
  }

  return rows;
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

function formatPhoneHref(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function canCancelOrder(order: SellerOrderDetailRow) {
  return (
    order.payment_method === "pay_at_pickup" &&
    ["pending", "open"].includes(order.order_status)
  );
}

function canMarkComplete(
  order: SellerOrderDetailRow,
  remainingPickupQuantity: number,
) {
  return (
    ["pending", "open"].includes(order.order_status) &&
    remainingPickupQuantity > 0
  );
}

function canMarkPaymentPaid(order: SellerOrderDetailRow) {
  return (
    order.payment_provider === "offline" &&
    order.payment_method === "pay_at_pickup" &&
    ["pay_at_pickup", "unpaid"].includes(order.payment_status ?? "") &&
    ["pending", "open", "fulfilled"].includes(order.order_status)
  );
}

function canMarkUnfulfilled(order: SellerOrderDetailRow) {
  return order.order_status === "fulfilled" && !order.canceled_at;
}

function canMarkPaymentUnpaid(order: SellerOrderDetailRow) {
  return (
    order.payment_provider === "offline" &&
    order.payment_method === "pay_at_pickup" &&
    order.payment_status === "paid" &&
    ["pending", "open", "fulfilled"].includes(order.order_status)
  );
}

function canEditOrder(order: SellerOrderDetailRow) {
  return (
    !order.canceled_at &&
    !order.fulfilled_at &&
    order.order_status !== "canceled" &&
    order.order_status !== "fulfilled"
  );
}

function canResendConfirmation(order: SellerOrderDetailRow) {
  return !order.canceled_at && order.order_status !== "canceled";
}

async function kickPostmarkEmailWorker() {
  try {
    const { data, error } = await supabase.functions.invoke<{ success?: boolean }>(
      "manual-order-email-kick",
    );

    if (error) {
      console.warn("Order confirmation resend email kick failed", error.message);
      return false;
    }

    return data?.success === true;
  } catch (error) {
    console.warn(
      "Order confirmation resend email kick failed",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

function getOrderLifecycleTone(order: SellerOrderDetailRow) {
  const lifecycle = getOrderLifecycleState(order);

  if (lifecycle === "completed") return "bg-emerald-100 text-emerald-800";
  if (lifecycle === "ready_for_pickup") return "bg-sky-100 text-sky-800";
  if (lifecycle === "canceled") return "bg-red-100 text-red-800";

  return "bg-amber-100 text-amber-800";
}

function formatSavedOrderStatus(status: string | null) {
  if (status === "fulfilled") return "FULFILLED";
  if (status === "canceled") return "CANCELED";

  return "OPEN";
}

function getSavedOrderStatusTone(status: string | null) {
  if (status === "fulfilled") return "bg-emerald-100 text-emerald-800";
  if (status === "canceled") return "bg-red-100 text-red-800";

  return "bg-amber-100 text-amber-800";
}

function formatSavedPaymentStatus(status: string | null) {
  if (status === "paid") return "PAID";
  if (status === "refunded") return "REFUNDED";

  return "UNPAID";
}

function getSavedPaymentStatusTone(status: string | null) {
  if (status === "paid") return "bg-emerald-100 text-emerald-800";
  if (status === "refunded") return "bg-sky-100 text-sky-800";

  return "bg-amber-100 text-amber-800";
}

function toSellerOrderFulfillmentError(message: string | undefined) {
  if (!message) {
    return "The order could not be marked fulfilled. Please try again.";
  }

  if (message === "Order is not available." || message.includes("authorized")) {
    return "This order is no longer available. Please refresh Orders.";
  }

  if (message.includes("Only pending or open orders can be fulfilled")) {
    return "This order is no longer open for fulfillment. Refresh the order and try again.";
  }

  if (message.includes("At least one fulfillment item")) {
    return "There are no remaining items to mark fulfilled.";
  }

  if (message.includes("valid order item ID") || message.includes("Duplicate order items")) {
    return "Fulfillment could not be recorded because the item list is no longer current. Refresh and try again.";
  }

  if (message.includes("not available for this order")) {
    return "One or more order items are no longer available for fulfillment. Refresh and try again.";
  }

  if (message.includes("exceeds remaining unfulfilled quantity")) {
    return "One or more line items have already been fulfilled or restored. Refresh and try again.";
  }

  return `The order could not be marked fulfilled: ${message}`;
}

function toSellerOrderUnfulfillmentError(message: string | undefined) {
  if (!message) {
    return "The order could not be marked unfulfilled. Please try again.";
  }

  if (message === "Order is not available." || message.includes("authorized")) {
    return "This order is no longer available. Please refresh Orders.";
  }

  if (message.includes("Canceled orders")) {
    return "Canceled orders cannot be marked unfulfilled.";
  }

  if (message.includes("Only fulfilled orders")) {
    return "Only fulfilled orders can be marked unfulfilled. Refresh the order and try again.";
  }

  return `The order could not be marked unfulfilled: ${message}`;
}

function toSellerOrderPaymentActionError(
  message: string | undefined,
  targetStatus: "paid" | "unpaid",
) {
  if (message?.includes("offline") || message?.includes("pay-at-pickup")) {
    return targetStatus === "paid"
      ? "Only unpaid offline pickup orders can be marked paid here."
      : "Only manually paid offline orders can be marked unpaid here.";
  }

  if (message?.includes("Stripe") || message?.includes("provider")) {
    return "Stripe-paid orders cannot be changed manually.";
  }

  if (message === "Order not found." || message?.includes("authorized")) {
    return "This order is no longer available. Please refresh Orders.";
  }

  return targetStatus === "paid"
    ? "The order could not be marked paid. Please try again."
    : "The order could not be marked unpaid. Please try again.";
}

function toSellerOrderCancellationError(message: string | undefined) {
  if (message === "Cancellation reason is required.") {
    return "Please add a short reason before canceling this order.";
  }

  if (message === "Order is not available.") {
    return "This order is no longer available. Please refresh Orders.";
  }

  if (message?.includes("pending or open")) {
    return "This order cannot be canceled from this screen.";
  }

  return "The order could not be canceled. Please try again.";
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: string;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-sm font-bold ${tone}`}
    >
      {children}
    </span>
  );
}

function QuickActionsMenu({
  canCancel,
  canMarkComplete,
  canMarkPaid,
  canMarkUnfulfilled,
  canMarkUnpaid,
  canResendConfirmation,
  isBusy,
  isOpen,
  onCancel,
  onMarkComplete,
  onMarkPaid,
  onMarkUnfulfilled,
  onMarkUnpaid,
  onOpenChange,
  onPrint,
  onResendConfirmation,
}: {
  canCancel: boolean;
  canMarkComplete: boolean;
  canMarkPaid: boolean;
  canMarkUnfulfilled: boolean;
  canMarkUnpaid: boolean;
  canResendConfirmation: boolean;
  isBusy: boolean;
  isOpen: boolean;
  onCancel: () => void;
  onMarkComplete: () => void;
  onMarkPaid: () => void;
  onMarkUnfulfilled: () => void;
  onMarkUnpaid: () => void;
  onOpenChange: (isOpen: boolean) => void;
  onPrint: () => void;
  onResendConfirmation: () => void;
}) {
  return (
    <details
      className="relative"
      open={isOpen}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary className={`${orderDetailButtonClass} cursor-pointer list-none`}>
        More actions
        <ChevronDown aria-hidden="true" className="size-4" />
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-stone-200 bg-white p-2 shadow-[0_18px_40px_rgba(46,39,25,0.14)]">
        {canMarkComplete ? (
          <QuickActionButton
            disabled={isBusy}
            glyph="/glyphs/checkmark.png"
            label="Mark order fulfilled"
            onClick={onMarkComplete}
          />
        ) : null}
        {canMarkUnfulfilled ? (
          <QuickActionButton
            disabled={isBusy}
            glyph="/glyphs/checkmark.png"
            label="Mark order unfulfilled"
            onClick={onMarkUnfulfilled}
          />
        ) : null}
        {canMarkPaid ? (
          <QuickActionButton
            disabled={isBusy}
            glyph="/glyphs/checkmark.png"
            label="Mark paid"
            onClick={onMarkPaid}
          />
        ) : null}
        {canMarkUnpaid ? (
          <QuickActionButton
            disabled={isBusy}
            glyph="/glyphs/checkmark.png"
            label="Mark unpaid"
            onClick={onMarkUnpaid}
          />
        ) : null}
        <QuickActionButton
          glyph="/glyphs/clipboard.png"
          label="Print order"
          onClick={onPrint}
        />
        {canResendConfirmation ? (
          <QuickActionButton
            disabled={isBusy}
            glyph="/glyphs/envelope.png"
            label="Resend order confirmation"
            onClick={onResendConfirmation}
          />
        ) : null}
        <QuickActionButton
          disabled={!canCancel || isBusy}
          glyph="/glyphs/trashcan.png"
          label="Cancel order"
          title={
            canCancel
              ? undefined
              : "This order cannot be canceled from this screen."
          }
          onClick={onCancel}
        />
        <QuickActionButton
          disabled
          glyph="/glyphs/shopping-bag.png"
          label="Archive"
          title="Order archiving is not wired yet."
        />
      </div>
    </details>
  );
}

function QuickActionButton({
  disabled = false,
  glyph,
  label,
  onClick,
  title,
}: {
  disabled?: boolean;
  glyph: string;
  label: string;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-stone-950 transition hover:bg-emerald-50 hover:text-emerald-900 focus:bg-emerald-50 focus:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/25 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-stone-950"
      disabled={disabled}
      title={title}
      type="button"
      onClick={onClick}
    >
      <Image src={glyph} alt="" width={18} height={18} />
      {label}
    </button>
  );
}

function FulfillmentDialog({
  canMarkPaid,
  error,
  isSaving,
  onClose,
  onFulfillOnly,
  onFulfillPaid,
}: {
  canMarkPaid: boolean;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onFulfillOnly: () => void;
  onFulfillPaid: () => void;
}) {
  return (
    <div
      aria-labelledby="fulfillment-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/30 px-4 py-6"
      role="dialog"
    >
      <section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-[0_22px_60px_rgba(46,39,25,0.2)]">
        <h2
          className="text-lg font-bold text-stone-950"
          id="fulfillment-dialog-title"
        >
          Mark order fulfilled?
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-700">
          This means the buyer has received the birds and the order is complete.
        </p>
        {error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            {error}
          </p>
        ) : null}
        {canMarkPaid ? (
          <p className="mt-4 text-sm font-bold text-stone-950">
            Was this order paid at pickup?
          </p>
        ) : null}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {canMarkPaid ? (
            <button
              className={`${orderDetailButtonClass} min-h-10 disabled:cursor-not-allowed disabled:opacity-60`}
              disabled={isSaving}
              type="button"
              onClick={onFulfillPaid}
            >
              {isSaving ? "Saving..." : "Mark fulfilled and paid"}
            </button>
          ) : null}
          <button
            className={`${canMarkPaid ? orderDetailBackButtonClass : orderDetailButtonClass} min-h-10`}
            disabled={isSaving}
            type="button"
            onClick={onFulfillOnly}
          >
            {isSaving ? "Saving..." : canMarkPaid ? "Mark fulfilled only" : "Mark fulfilled"}
          </button>
          <button
            className="min-h-10 rounded-md px-3.5 text-sm font-bold text-stone-700 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 sm:col-span-2"
            disabled={isSaving}
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function UnfulfillmentDialog({
  error,
  isSaving,
  onClose,
  onConfirm,
}: {
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-labelledby="unfulfillment-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/30 px-4 py-6"
      role="dialog"
    >
      <section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-[0_22px_60px_rgba(46,39,25,0.2)]">
        <h2
          className="text-lg font-bold text-stone-950"
          id="unfulfillment-dialog-title"
        >
          Mark order unfulfilled?
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-700">
          This will reopen the order and reset its fulfillment status. Payment
          status will not change.
        </p>
        {error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            {error}
          </p>
        ) : null}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button
            className={`${orderDetailButtonClass} min-h-10 disabled:cursor-not-allowed disabled:opacity-60`}
            disabled={isSaving}
            type="button"
            onClick={onConfirm}
          >
            {isSaving ? "Saving..." : "Mark unfulfilled"}
          </button>
          <button
            className={`${orderDetailBackButtonClass} min-h-10`}
            disabled={isSaving}
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function ResendConfirmationDialog({
  buyerEmail,
  isSending,
  onClose,
  onConfirm,
}: {
  buyerEmail: string;
  isSending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-labelledby="resend-confirmation-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/30 px-4 py-6"
      role="dialog"
    >
      <section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-[0_22px_60px_rgba(46,39,25,0.2)]">
        <h2
          className="text-lg font-bold text-stone-950"
          id="resend-confirmation-dialog-title"
        >
          Resend order confirmation?
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-700">
          Resend order confirmation to {buyerEmail}?
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button
            className={`${orderDetailButtonClass} min-h-10 disabled:cursor-not-allowed disabled:opacity-60`}
            disabled={isSending}
            type="button"
            onClick={onConfirm}
          >
            {isSending ? "Sending..." : "Resend email"}
          </button>
          <button
            className={`${orderDetailBackButtonClass} min-h-10`}
            disabled={isSending}
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function CancellationPanel({
  cancelReason,
  emailCancellationToBuyer,
  hasBuyerEmail,
  isCanceling,
  restoreInventoryOnCancel,
  onCancel,
  onClose,
  onEmailCancellationChange,
  onReasonChange,
}: {
  cancelReason: string;
  emailCancellationToBuyer: boolean;
  hasBuyerEmail: boolean;
  isCanceling: boolean;
  restoreInventoryOnCancel: boolean;
  onCancel: () => void;
  onClose: () => void;
  onEmailCancellationChange: (value: boolean) => void;
  onReasonChange: (value: string) => void;
}) {
  return (
    <section className="rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-red-950">Cancel order</h2>
          <p className="mt-1 text-sm leading-6 text-red-800">
            Add a reason before canceling. Inventory restore uses the existing
            safe cancellation workflow.
          </p>
        </div>
        <button
          className="seller-small-button rounded-md border-red-200 text-red-800 hover:bg-red-100"
          disabled={isCanceling}
          type="button"
          onClick={onClose}
        >
          Keep order
        </button>
      </div>
      <label className="mt-4 grid gap-2 text-sm font-semibold text-red-950">
        Reason for cancellation
        <textarea
          className="min-h-24 rounded-md border border-red-200 bg-white px-3 py-2 text-base font-normal text-stone-950 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
          maxLength={500}
          onChange={(event) => onReasonChange(event.target.value)}
          value={cancelReason}
        />
      </label>
      {hasBuyerEmail ? (
        <label className="mt-4 flex gap-3 rounded-md border border-red-200 bg-white p-3 text-sm text-stone-700">
          <input
            className="mt-1 size-6 rounded border-stone-300 text-red-700 focus:ring-red-500 sm:size-4"
            checked={emailCancellationToBuyer}
            disabled={isCanceling}
            type="checkbox"
            onChange={(event) => onEmailCancellationChange(event.target.checked)}
          />
          <span>
            <span className="block font-semibold text-stone-950">
              Email cancellation notice to customer
            </span>
            <span className="mt-1 block leading-6 text-stone-600">
              Send the buyer a cancellation email after this order is canceled.
            </span>
          </span>
        </label>
      ) : null}
      <label className="mt-4 flex gap-3 rounded-md border border-red-200 bg-white p-3 text-sm text-stone-700">
        <input
          className="mt-1 size-6 rounded border-stone-300 text-red-700 focus:ring-red-500 sm:size-4"
          checked={restoreInventoryOnCancel}
          disabled
          readOnly
          type="checkbox"
        />
        <span>
          <span className="block font-semibold text-stone-950">
            Restore inventory
          </span>
          <span className="mt-1 block leading-6 text-stone-600">
            Inventory-backed items will be returned to available inventory when
            this order is canceled.
          </span>
        </span>
      </label>
      <button
        className="mt-4 min-h-12 rounded-md bg-red-700 px-4 text-base font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-stone-300 sm:min-h-10 sm:text-sm sm:font-semibold"
        disabled={isCanceling}
        type="button"
        onClick={onCancel}
      >
        {isCanceling ? "Canceling..." : "Confirm cancellation"}
      </button>
    </section>
  );
}

function MobileAmount({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-[#fbfaf6] px-3 py-2 text-left min-[360px]:text-right sm:rounded-none sm:bg-transparent sm:p-0 sm:text-right sm:tabular-nums">
      <span className="block text-sm font-bold uppercase text-stone-500 sm:hidden">
        {label}
      </span>
      <span className="break-words text-base font-bold text-stone-950">{value}</span>
    </div>
  );
}

function ItemThumbnail({
  alt,
  fallbackGlyph,
  src,
}: {
  alt: string;
  fallbackGlyph: string;
  src?: string | null;
}) {
  const [hasImageError, setHasImageError] = useState(false);
  const displayUrl = toDisplayImageUrl(src);
  const shouldShowImage = Boolean(displayUrl) && !hasImageError;

  return (
    <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-[#f4f8ef] sm:size-14">
      {shouldShowImage ? (
        <Image
          className="object-cover"
          src={displayUrl}
          alt={alt}
          fill
          sizes="(max-width: 639px) 48px, 56px"
          onError={() => setHasImageError(true)}
        />
      ) : (
        <Image src={fallbackGlyph} alt="" width={30} height={30} />
      )}
    </span>
  );
}

async function loadOrderItemMedia(
  items: SellerOrderItemRow[],
  storeId: string,
): Promise<Record<string, SellerMediaRow | null>> {
  const entityIds = Array.from(
    new Set(
      items
        .flatMap((item) => getItemMediaEntityKeys(item).map((key) => key.id))
        .filter(Boolean),
    ),
  );

  if (entityIds.length === 0) return {};

  const { data, error } = await supabase
    .from("seller_media_management")
    .select(
      "entity_type, entity_id, public_url, alt_text, sort_order, is_featured, moderation_status, asset_status, visibility_status",
    )
    .eq("store_id", storeId)
    .in("entity_id", entityIds)
    .in("entity_type", [
      "inventory_item",
      "listing_batch",
      "listing_batch_breed",
      "seller_breed_profile",
      "equipment_inventory_item",
      "processed_poultry_inventory_item",
    ])
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .returns<SellerMediaRow[]>();

  if (error) return {};

  const mediaByEntity = new Map<string, SellerMediaRow[]>();

  for (const media of data ?? []) {
    if (
      media.visibility_status !== "active" ||
      media.asset_status !== "active" ||
      media.moderation_status !== "approved"
    ) {
      continue;
    }

    const key = `${media.entity_type}:${media.entity_id}`;
    mediaByEntity.set(key, [...(mediaByEntity.get(key) ?? []), media]);
  }

  return Object.fromEntries(
    items.map((item) => [
      item.order_item_id,
      pickMediaForItem(item, mediaByEntity),
    ]),
  );
}

function pickMediaForItem(
  item: SellerOrderItemRow,
  mediaByEntity: Map<string, SellerMediaRow[]>,
) {
  for (const key of getItemMediaEntityKeys(item)) {
    const media = mediaByEntity.get(`${key.type}:${key.id}`)?.[0];
    if (media) return media;
  }

  return null;
}

async function loadStoreLogo(storeId: string) {
  const { data, error } = await supabase
    .from("seller_media_management")
    .select(
      "entity_type, entity_id, display_context, public_url, alt_text, sort_order, is_featured, moderation_status, asset_status, visibility_status",
    )
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
    .returns<SellerMediaRow[]>();

  if (error) return null;

  return data?.[0] ?? null;
}

function getItemMediaEntityKeys(item: SellerOrderItemRow) {
  if (item.order_item_source === "equipment_inventory") {
    return [
      {
        type: "equipment_inventory_item",
        id: item.equipment_inventory_item_id,
      },
    ];
  }

  if (item.order_item_source === "processed_poultry_inventory") {
    return [
      {
        type: "processed_poultry_inventory_item",
        id: item.processed_poultry_inventory_item_id,
      },
    ];
  }

  return [
    { type: "inventory_item", id: item.inventory_item_id },
    { type: "listing_batch_breed", id: item.listing_batch_breed_id },
    { type: "listing_batch", id: item.listing_batch_id },
    { type: "seller_breed_profile", id: item.seller_breed_profile_id },
  ];
}

function getItemFallbackGlyph(item: SellerOrderItemRow) {
  if (item.order_item_source === "equipment_inventory") return "/glyphs/feed-sack.png";
  if (item.order_item_source === "processed_poultry_inventory") {
    return "/glyphs/chicken-leg.png";
  }

  return "/glyphs/hen.png";
}

function toDisplayImageUrl(value: string | null | undefined) {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) return value;

  return `/storage/v1/object/public/${value}`;
}

function getCustomerInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "B";
}
