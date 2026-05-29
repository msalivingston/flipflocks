"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  ContactActionButtons,
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
} from "../_components/seller-ui";
import {
  formatCurrency,
  formatDateTime,
  formatOrderLifecycle,
  formatOrderSource,
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

const orderFilters: { label: string; value: OrderFilter }[] = [
  { label: "Needs attention", value: "needs_attention" },
  { label: "Ready for pickup", value: "ready_for_pickup" },
  { label: "Completed", value: "completed" },
  { label: "Canceled", value: "canceled" },
  { label: "All", value: "all" },
];

/**
 * Seller-facing order intake list for storefront pay-at-pickup requests.
 * Actions stay on the detail page so this view remains a fast work queue.
 */
export function OrdersList() {
  const { seller } = useSellerContext();
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [filter, setFilter] = useState<OrderFilter>("needs_attention");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadOrders() {
      if (!seller) return;

      setIsLoading(true);
      setError(null);

      const result = await supabase
        .from("seller_order_management")
        .select(
          "order_id, order_number, order_source, order_status, payment_method, payment_status, created_at, ready_for_pickup_at, fulfilled_at, canceled_at, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_email_snapshot, buyer_phone_snapshot, pickup_note, buyer_notes, total_amount, item_count, total_item_quantity, pickup_option_label_snapshot",
        )
        .eq("store_id", seller.store_id)
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<SellerOrderRow[]>();

      if (!isMounted) return;

      if (result.error) {
        setError(result.error.message);
        setIsLoading(false);
        return;
      }

      setOrders(result.data ?? []);
      setIsLoading(false);
    }

    void loadOrders();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const visibleOrders = useMemo(
    () => orders.filter((order) => matchesFilter(order, filter)),
    [filter, orders],
  );
  const filterCounts = useMemo(() => getFilterCounts(orders), [orders]);

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
      <SellerCard className="p-4">
        <div className="grid gap-4">
          <div>
            <h2 className="text-base font-semibold text-stone-950">
              Order intake
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Work the active pickup queue first, then review completed or
              canceled orders when you need records.
            </p>
          </div>
          <OrderLifecycleFilters
            counts={filterCounts}
            value={filter}
            onChange={setFilter}
          />
        </div>
      </SellerCard>

      {visibleOrders.length > 0 ? (
        <div className="grid gap-3">
          {visibleOrders.map((order) => (
            <OrderCard key={order.order_id} order={order} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            filter === "needs_attention"
              ? "No pickup requests need attention"
              : "No orders found"
          }
          description={
            filter === "needs_attention"
              ? "New pickup requests appear here until you mark them ready."
              : "Try a different filter to review older orders."
          }
        />
      )}
    </div>
  );
}

function OrderCard({ order }: { order: SellerOrderRow }) {
  const customerName = formatCustomerName(order);
  const lifecycle = getOrderLifecycleState(order);

  return (
    <SellerCard className="p-4">
      <article className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-stone-950">
              <Link
                className="hover:text-emerald-800"
                href={`/dashboard/orders/${order.order_id}`}
              >
                {order.order_number}
              </Link>
            </h3>
            <OrderLifecycleBadge
              label={formatOrderLifecycle(order)}
              lifecycle={lifecycle}
            />
            <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              {formatOrderSource(order)}
            </span>
          </div>

          <p className="mt-2 text-sm font-semibold text-stone-950">
            {customerName}
          </p>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {formatOrderItems(order)} · {formatCurrency(order.total_amount)} ·{" "}
            {formatDateTime(order.created_at)}
          </p>

          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <OrderFact
              label="Pickup"
              value={formatPickupSummary(order)}
            />
            <OrderFact
              label="Payment"
              value={
                order.payment_method === "pay_at_pickup"
                  ? "Pay at pickup"
                  : formatPaymentMethod(order.payment_method)
              }
            />
          </dl>

          {order.buyer_notes ? (
            <div className="mt-3 rounded-md bg-stone-50 px-3 py-2 text-sm leading-6 text-stone-700">
              <span className="font-semibold text-stone-950">Buyer note: </span>
              {order.buyer_notes}
            </div>
          ) : null}
        </div>

        <ContactActionButtons
          phone={order.buyer_phone_snapshot}
          email={order.buyer_email_snapshot}
          label="buyer"
        />
        <Link
          className="seller-small-button self-start lg:justify-self-end"
          href={`/dashboard/orders/${order.order_id}`}
        >
          View order
        </Link>
      </article>
    </SellerCard>
  );
}

function OrderFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
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
    <div>
      <p className="text-sm font-semibold text-stone-700">Show</p>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {orderFilters.map((filter) => {
          const isActive = value === filter.value;

          return (
            <button
              aria-pressed={isActive}
              className={`min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-700/30 ${
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
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-stone-100 text-stone-600"
                }`}
              >
                {counts[filter.value]}
              </span>
            </button>
          );
        })}
      </div>
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
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

function matchesFilter(order: SellerOrderRow, filter: OrderFilter) {
  if (filter === "all") return true;

  return getOrderLifecycleState(order) === filter;
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

function formatCustomerName(order: SellerOrderRow) {
  return (
    [order.buyer_first_name_snapshot, order.buyer_last_name_snapshot]
      .filter(Boolean)
      .join(" ") || "Buyer"
  );
}

function formatPickupSummary(order: SellerOrderRow) {
  const lifecycle = getOrderLifecycleState(order);

  if (lifecycle === "ready_for_pickup") return "Ready for pickup";
  if (lifecycle === "completed") return "Picked up / complete";
  if (lifecycle === "canceled") return "Canceled";

  return order.pickup_option_label_snapshot ?? "Needs coordination";
}

function formatOrderItems(order: SellerOrderRow) {
  const itemCount = order.item_count ?? 0;
  const quantity = order.total_item_quantity ?? 0;

  return `${quantity} bird${quantity === 1 ? "" : "s"} across ${itemCount} item${
    itemCount === 1 ? "" : "s"
  }`;
}
