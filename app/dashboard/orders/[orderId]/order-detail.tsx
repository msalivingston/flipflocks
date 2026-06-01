"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  formatCurrency,
  formatDateTime,
  formatInventoryLabel,
  formatOrderLifecycle,
  formatOrderSource,
  formatPaymentMethod,
  formatPlainLabel,
  getOrderLifecycleState,
} from "../order-formatters";

type SellerOrderDetailRow = {
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
};

type SellerOrderItemRow = {
  order_item_id: string;
  species_name_snapshot: string;
  breed_display_name_snapshot: string;
  inventory_type_snapshot: string;
  custom_inventory_label_snapshot: string | null;
  hatch_date_snapshot: string | null;
  available_date_snapshot: string | null;
  age_at_sale_days_snapshot: number | null;
  order_item_source: string | null;
  custom_item_name_snapshot: string | null;
  unit_price_snapshot: number | null;
  quantity: number;
  fulfilled_quantity: number;
  remaining_unfulfilled_quantity: number;
  line_subtotal: number | null;
};

type OrderDetailState = {
  items: SellerOrderItemRow[];
  order: SellerOrderDetailRow | null;
};

/**
 * Read-only seller order detail for the first public order intake workflow.
 * Mutation actions are intentionally deferred to later fulfillment groups.
 */
export function OrderDetail({ orderId }: { orderId: string }) {
  const { seller } = useSellerContext();
  const [data, setData] = useState<OrderDetailState>({
    items: [],
    order: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [restoreInventoryOnCancel, setRestoreInventoryOnCancel] = useState(false);
  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [copiedContact, setCopiedContact] = useState<"email" | "phone" | null>(
    null,
  );
  const [contactCopyError, setContactCopyError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadOrder() {
      if (!seller) return;

      setIsLoading(true);
      setError(null);

      const [orderResult, itemResult] = await Promise.all([
        supabase
          .from("seller_order_management")
          .select(
            "order_id, order_number, order_source, order_status, payment_method, payment_status, created_at, ready_for_pickup_at, fulfilled_at, canceled_at, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_email_snapshot, buyer_phone_snapshot, buyer_address_line1_snapshot, buyer_address_line2_snapshot, buyer_city_snapshot, buyer_state_snapshot, buyer_postal_code_snapshot, buyer_country_snapshot, pickup_note, buyer_notes, subtotal_amount, tax_fee_label_snapshot, tax_fee_amount, total_amount, item_count, total_item_quantity, pickup_option_label_snapshot",
          )
          .eq("store_id", seller.store_id)
          .eq("order_id", orderId)
          .maybeSingle<SellerOrderDetailRow>(),
        supabase
          .from("seller_order_item_detail")
          .select(
            "order_item_id, species_name_snapshot, breed_display_name_snapshot, inventory_type_snapshot, custom_inventory_label_snapshot, hatch_date_snapshot, available_date_snapshot, age_at_sale_days_snapshot, order_item_source, custom_item_name_snapshot, unit_price_snapshot, quantity, fulfilled_quantity, remaining_unfulfilled_quantity, line_subtotal",
          )
          .eq("store_id", seller.store_id)
          .eq("order_id", orderId)
          .order("created_at", { ascending: true })
          .returns<SellerOrderItemRow[]>(),
      ]);

      if (!isMounted) return;

      const firstError = orderResult.error ?? itemResult.error;

      if (firstError) {
        setError(firstError.message);
        setIsLoading(false);
        return;
      }

      setData({
        order: orderResult.data,
        items: itemResult.data ?? [],
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

  async function markReadyForPickup() {
    if (!order) return;

    setIsSaving(true);
    setActionError(null);
    setActionMessage(null);

    const { error: readyError } = await supabase.rpc(
      "seller_mark_order_ready_for_pickup",
      {
        p_order_id: order.order_id,
        p_note: null,
      },
    );

    if (readyError) {
      setActionError(toSellerOrderActionError(readyError.message));
      setIsSaving(false);
      return;
    }

    setActionMessage("Order marked ready for pickup.");
    setRefreshKey((current) => current + 1);
    setIsSaving(false);
  }

  async function markPickedUpComplete() {
    if (!order) return;

    const fulfillmentItems = data.items
      .filter((item) => item.remaining_unfulfilled_quantity > 0)
      .map((item) => ({
        order_item_id: item.order_item_id,
        quantity: item.remaining_unfulfilled_quantity,
      }));

    if (fulfillmentItems.length === 0) {
      setActionError("There are no remaining birds to mark picked up.");
      return;
    }

    setIsSaving(true);
    setActionError(null);
    setActionMessage(null);

    const { error: fulfillmentError } = await supabase.rpc(
      "seller_record_order_fulfillment",
      {
        p_order_id: order.order_id,
        p_items: fulfillmentItems,
        p_note: null,
      },
    );

    if (fulfillmentError) {
      setActionError(toSellerOrderActionError(fulfillmentError.message));
      setIsSaving(false);
      return;
    }

    setActionMessage("Order marked picked up and complete.");
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

    const { error: cancelError } = await supabase.rpc("cancel_order", {
      p_order_id: order.order_id,
      p_canceled_reason: trimmedReason,
      p_restore_inventory: restoreInventoryOnCancel,
    });

    if (cancelError) {
      setActionError(toSellerOrderCancellationError(cancelError.message));
      setIsCanceling(false);
      return;
    }

    setActionMessage(
      restoreInventoryOnCancel
        ? "Order canceled. Inventory-backed items were returned to available inventory."
        : "Order canceled. Inventory was not changed.",
    );
    setCancelReason("");
    setRestoreInventoryOnCancel(false);
    setShowCancelPanel(false);
    setRefreshKey((current) => current + 1);
    setIsCanceling(false);
  }

  async function copyContactValue(kind: "email" | "phone", value: string | null) {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setContactCopyError(null);
      setCopiedContact(kind);
      window.setTimeout(() => {
        setCopiedContact((current) => (current === kind ? null : current));
      }, 2000);
    } catch {
      setContactCopyError("That contact detail could not be copied.");
    }
  }

  return (
    <>
      <SellerPageHeader
        eyebrow={formatOrderSource(order)}
        title={`Order ${order.order_number}`}
        description="Read-only order details for pickup coordination."
        action={<BackToOrdersLink />}
      />

      <div className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 sm:px-7 xl:grid-cols-[1fr_22rem]">
        <main className="grid gap-5">
          <SellerCard className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-stone-950">
                  Request summary
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  {customerName} requested {order.total_item_quantity ?? 0} bird
                  {(order.total_item_quantity ?? 0) === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getOrderLifecycleTone(order)}`}
                >
                  {formatOrderLifecycle(order)}
                </span>
                <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  {formatPaymentMethod(order.payment_method)}
                </span>
              </div>
            </div>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <DetailFact label="Received" value={formatDateTime(order.created_at)} />
              <DetailFact
                label="Pickup"
                value={formatPickupStatus(order)}
              />
              <DetailFact
                label="Payment status"
                value={formatPlainLabel(order.payment_status)}
              />
              <DetailFact label="Total" value={formatCurrency(order.total_amount)} />
            </dl>
          </SellerCard>

          {canCancelOrder(order) ? (
            <SellerCard className="p-5">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div>
                  <h2 className="text-lg font-semibold text-stone-950">
                    Cancel order
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    Canceling removes this pickup request from your open orders.
                    You can choose whether inventory-backed items should be
                    returned to available inventory.
                  </p>
                </div>
                {!showCancelPanel ? (
                  <button
                    className="seller-secondary-button"
                    disabled={isSaving || isCanceling}
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setActionMessage(null);
                      setRestoreInventoryOnCancel(false);
                      setShowCancelPanel(true);
                    }}
                  >
                    Cancel order
                  </button>
                ) : null}
              </div>

              {showCancelPanel ? (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
                  <label className="grid gap-2 text-sm font-semibold text-red-950">
                    Reason for cancellation
                    <textarea
                      className="min-h-24 rounded-md border border-red-200 bg-white px-3 py-2 text-base font-normal text-stone-950 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
                      maxLength={500}
                      onChange={(event) => setCancelReason(event.target.value)}
                      value={cancelReason}
                    />
                    <span className="text-xs font-normal text-red-800">
                      This is saved with the order history and may be used in the
                      buyer cancellation notice.
                    </span>
                  </label>

                  <label className="mt-4 flex gap-3 rounded-md border border-red-200 bg-white p-3 text-sm text-stone-700">
                    <input
                      className="mt-1 h-4 w-4 rounded border-stone-300 text-red-700 focus:ring-red-500"
                      checked={restoreInventoryOnCancel}
                      onChange={(event) =>
                        setRestoreInventoryOnCancel(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>
                      <span className="block font-semibold text-stone-950">
                        Restore inventory?
                      </span>
                      <span className="mt-1 block leading-6 text-stone-600">
                        If checked, inventory-backed items will be returned to
                        available inventory. Leave unchecked if you want to
                        review inventory manually.
                      </span>
                    </span>
                  </label>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="min-h-10 rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                      disabled={isCanceling}
                      type="button"
                      onClick={cancelOrder}
                    >
                      {isCanceling ? "Canceling..." : "Confirm cancellation"}
                    </button>
                    <button
                      className="seller-secondary-button"
                      disabled={isCanceling}
                      type="button"
                      onClick={() => {
                        setCancelReason("");
                        setRestoreInventoryOnCancel(false);
                        setShowCancelPanel(false);
                      }}
                    >
                      Keep order
                    </button>
                  </div>
                </div>
              ) : null}
            </SellerCard>
          ) : null}

          <SellerCard className="p-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
              <div>
                <h2 className="text-lg font-semibold text-stone-950">
                  Pickup progress
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Use these simple steps when the order is ready, then after the
                  buyer has picked up the birds.
                </p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <DetailFact
                    label="Ready"
                    value={
                      order.ready_for_pickup_at
                        ? formatDateTime(order.ready_for_pickup_at)
                        : "Not marked ready"
                    }
                  />
                  <DetailFact
                    label="Complete"
                    value={
                      order.fulfilled_at
                        ? formatDateTime(order.fulfilled_at)
                        : "Not complete"
                    }
                  />
                  <DetailFact
                    label="Still open"
                    value={`${remainingPickupQuantity} bird${
                      remainingPickupQuantity === 1 ? "" : "s"
                    }`}
                  />
                </dl>
                {actionMessage ? (
                  <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                    {actionMessage}
                  </p>
                ) : null}
                {actionError ? (
                  <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                    {actionError}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2 sm:flex lg:grid">
                {canMarkReady(order) ? (
                  <button
                    className="seller-secondary-button"
                    disabled={isSaving}
                    type="button"
                    onClick={markReadyForPickup}
                  >
                    {isSaving ? "Saving..." : "Mark ready for pickup"}
                  </button>
                ) : null}
                {canMarkComplete(order, remainingPickupQuantity) ? (
                  <button
                    className="seller-secondary-button"
                    disabled={isSaving}
                    type="button"
                    onClick={markPickedUpComplete}
                  >
                    {isSaving ? "Saving..." : "Mark picked up"}
                  </button>
                ) : null}
                {!canMarkReady(order) &&
                !canMarkComplete(order, remainingPickupQuantity) ? (
                  <p className="text-sm leading-6 text-stone-500">
                    No pickup actions are available for this order.
                  </p>
                ) : null}
              </div>
            </div>
          </SellerCard>

          <SellerCard className="overflow-hidden">
            <div className="border-b border-stone-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-stone-950">
                Requested birds
              </h2>
            </div>
            {data.items.length > 0 ? (
              <div className="divide-y divide-stone-200">
                {data.items.map((item) => (
                  <OrderItemRow key={item.order_item_id} item={item} />
                ))}
              </div>
            ) : (
              <div className="p-5">
                <EmptyState
                  title="No line items found"
                  description="This order does not currently show any requested birds."
                />
              </div>
            )}
          </SellerCard>

          <SellerCard className="p-5">
            <h2 className="text-lg font-semibold text-stone-950">
              Pickup / order notes
            </h2>
            <div className="mt-3 grid gap-3 text-sm leading-6 text-stone-700">
              <NoteBlock
                label="Note from buyer"
                value={order.buyer_notes}
                empty="No buyer note added."
              />
              <NoteBlock
                label="Pickup note"
                value={order.pickup_note}
                empty="No pickup note added."
              />
            </div>
          </SellerCard>
        </main>

        <aside className="grid h-fit gap-5">
          <SellerCard className="p-5">
            <h2 className="text-lg font-semibold text-stone-950">
              Buyer contact
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Use these details to coordinate pickup directly with the buyer.
            </p>
            {contactCopyError ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                {contactCopyError}
              </p>
            ) : null}
            <div className="mt-4 grid gap-3">
              <ContactDetailRow
                label="Name"
                value={customerName}
              />
              <ContactDetailRow
                actionLabel="Email buyer"
                copiedLabel={copiedContact === "email" ? "Email copied" : null}
                emptyValue="No email provided"
                href={
                  order.buyer_email_snapshot
                    ? `mailto:${order.buyer_email_snapshot}`
                    : null
                }
                label="Email"
                onCopy={() => copyContactValue("email", order.buyer_email_snapshot)}
                value={order.buyer_email_snapshot}
              />
              <ContactDetailRow
                actionLabel="Call buyer"
                copiedLabel={copiedContact === "phone" ? "Phone copied" : null}
                emptyValue="No phone provided"
                href={
                  order.buyer_phone_snapshot
                    ? `tel:${formatPhoneHref(order.buyer_phone_snapshot)}`
                    : null
                }
                label="Phone"
                onCopy={() => copyContactValue("phone", order.buyer_phone_snapshot)}
                value={order.buyer_phone_snapshot}
              />
            </div>
          </SellerCard>

          <SellerCard className="p-5">
            <h2 className="text-lg font-semibold text-stone-950">
              Pickup contact info
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-stone-700">
              {formatBuyerAddress(order)}
            </p>
          </SellerCard>

          <SellerCard className="p-5">
            <h2 className="text-lg font-semibold text-stone-950">
              Order totals
            </h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <TotalRow label="Subtotal" value={formatCurrency(order.subtotal_amount)} />
              {order.tax_fee_amount ? (
                <TotalRow
                  label={order.tax_fee_label_snapshot ?? "Tax/fee"}
                  value={formatCurrency(order.tax_fee_amount)}
                />
              ) : null}
              <TotalRow
                isStrong
                label="Total"
                value={formatCurrency(order.total_amount)}
              />
            </dl>
          </SellerCard>
        </aside>
      </div>
    </>
  );
}

function OrderItemRow({ item }: { item: SellerOrderItemRow }) {
  const isCustomItem = item.order_item_source === "custom";
  const label = formatInventoryLabel({
    custom_inventory_label: item.custom_inventory_label_snapshot,
    inventory_type: item.inventory_type_snapshot,
  });
  const itemTitle =
    item.custom_item_name_snapshot || item.breed_display_name_snapshot;

  return (
    <article className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto]">
      <div>
        <h3 className="font-semibold text-stone-950">
          {itemTitle}
          {isCustomItem ? "" : ` ${label}`}
        </h3>
        <p className="mt-1 text-sm text-stone-600">
          {isCustomItem ? "Custom item" : item.species_name_snapshot}
          {!isCustomItem && item.hatch_date_snapshot
            ? ` - hatched ${formatShortDate(item.hatch_date_snapshot)}`
            : ""}
          {!isCustomItem && item.available_date_snapshot
            ? ` · available ${formatShortDate(item.available_date_snapshot)}`
            : ""}
        </p>
        <p className="mt-1 text-sm text-stone-500">
          {!isCustomItem && item.age_at_sale_days_snapshot != null
            ? `${formatAgeAtAvailability(item.age_at_sale_days_snapshot)} at sale - `
            : ""}
          {isCustomItem
            ? `${item.remaining_unfulfilled_quantity} remaining on order`
            : `${item.remaining_unfulfilled_quantity} still needing pickup`}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-right text-sm sm:min-w-64">
        <DetailFact label="Qty" value={`${item.quantity}`} />
        <DetailFact label="Each" value={formatCurrency(item.unit_price_snapshot)} />
        <DetailFact label="Line" value={formatCurrency(item.line_subtotal)} />
      </dl>
    </article>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function NoteBlock({
  empty,
  label,
  value,
}: {
  empty: string;
  label: string;
  value: string | null;
}) {
  return (
    <section className="rounded-md bg-stone-50 px-3 py-2">
      <h3 className="font-semibold text-stone-950">{label}</h3>
      <p className="mt-1 whitespace-pre-line">{value || empty}</p>
    </section>
  );
}

function ContactDetailRow({
  actionLabel,
  copiedLabel,
  emptyValue = "Not provided",
  href,
  label,
  onCopy,
  value,
}: {
  actionLabel?: string;
  copiedLabel?: string | null;
  emptyValue?: string;
  href?: string | null;
  label: string;
  onCopy?: () => void;
  value: string | null;
}) {
  const hasValue = Boolean(value);

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-stone-950">
        {value || emptyValue}
      </p>
      {hasValue && (href || onCopy) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {href && actionLabel ? (
            <a className="seller-small-button" href={href}>
              {actionLabel}
            </a>
          ) : null}
          {onCopy ? (
            <button
              className="seller-small-button"
              type="button"
              onClick={onCopy}
            >
              {copiedLabel ?? `Copy ${label.toLowerCase()}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TotalRow({
  isStrong = false,
  label,
  value,
}: {
  isStrong?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div
      className={`flex justify-between gap-3 ${
        isStrong ? "border-t border-stone-200 pt-2 font-semibold text-stone-950" : ""
      }`}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function BackToOrdersLink() {
  return (
    <Link className="seller-secondary-button" href="/dashboard/orders">
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

function formatBuyerAddress(order: SellerOrderDetailRow) {
  const cityLine = [
    order.buyer_city_snapshot,
    order.buyer_state_snapshot,
    order.buyer_postal_code_snapshot,
  ]
    .filter(Boolean)
    .join(", ");
  const lines = [
    order.buyer_address_line1_snapshot,
    order.buyer_address_line2_snapshot,
    cityLine,
    order.buyer_country_snapshot,
  ].filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : "No pickup contact address.";
}

function formatPhoneHref(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function canMarkReady(order: SellerOrderDetailRow) {
  return (
    ["pending", "open"].includes(order.order_status) &&
    !order.ready_for_pickup_at
  );
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

function formatPickupStatus(order: SellerOrderDetailRow) {
  if (order.order_status === "fulfilled") return "Picked up / complete";
  if (order.order_status === "canceled") return "Canceled";
  if (order.ready_for_pickup_at) return "Ready for pickup";

  return order.pickup_option_label_snapshot ?? "Needs coordination";
}

function getOrderLifecycleTone(order: SellerOrderDetailRow) {
  const lifecycle = getOrderLifecycleState(order);

  if (lifecycle === "completed") return "bg-emerald-100 text-emerald-800";
  if (lifecycle === "ready_for_pickup") return "bg-sky-100 text-sky-800";
  if (lifecycle === "canceled") return "bg-red-100 text-red-800";

  return "bg-amber-100 text-amber-800";
}

function toSellerOrderActionError(message: string | undefined) {
  if (message === "Order is not available.") {
    return "This order is no longer available. Please refresh Orders.";
  }

  if (message?.includes("ready for pickup")) {
    return "This order cannot be marked ready right now.";
  }

  if (message?.includes("fulfilled") || message?.includes("fulfillment")) {
    return "This order cannot be marked picked up right now.";
  }

  return "The order could not be updated. Please try again.";
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
