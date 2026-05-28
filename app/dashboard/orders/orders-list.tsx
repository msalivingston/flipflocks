"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  ContactActionButtons,
  EmptyState,
  ErrorState,
  FilterControl,
  LoadingState,
  SellerCard,
  StatusBadge,
} from "../_components/seller-ui";
import {
  formatCurrency,
  formatDateTime,
  formatOrderSource,
  formatPaymentMethod,
} from "./order-formatters";

type OrderFilter = "open" | "all" | "fulfilled" | "canceled";

type SellerOrderRow = {
  order_id: string;
  order_number: string;
  order_source: string | null;
  order_status: string;
  payment_method: string | null;
  payment_status: string | null;
  created_at: string;
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
  { label: "Needs attention", value: "open" },
  { label: "All orders", value: "all" },
  { label: "Fulfilled", value: "fulfilled" },
  { label: "Canceled", value: "canceled" },
];

/**
 * First seller-facing order intake list for storefront pay-at-pickup requests.
 * It is intentionally read-only until fulfillment/detail workflows are built.
 */
export function OrdersList() {
  const { seller } = useSellerContext();
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [filter, setFilter] = useState<OrderFilter>("open");
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
          "order_id, order_number, order_source, order_status, payment_method, payment_status, created_at, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_email_snapshot, buyer_phone_snapshot, pickup_note, buyer_notes, total_amount, item_count, total_item_quantity, pickup_option_label_snapshot",
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
        <div className="grid gap-3 md:grid-cols-[1fr_14rem] md:items-end">
          <div>
            <h2 className="text-base font-semibold text-stone-950">
              Order intake
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              New storefront pickup requests appear here as open orders. Contact
              the buyer to coordinate pickup details.
            </p>
          </div>
          <FilterControl
            label="Show"
            value={filter}
            options={orderFilters}
            onChange={(value) => setFilter(value as OrderFilter)}
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
          title={filter === "open" ? "No open pickup requests" : "No orders found"}
          description={
            filter === "open"
              ? "When a buyer sends a pickup request from your storefront, it will appear here."
              : "Try a different filter to review older orders."
          }
        />
      )}
    </div>
  );
}

function OrderCard({ order }: { order: SellerOrderRow }) {
  const customerName = formatCustomerName(order);

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
            <StatusBadge status={order.order_status} />
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
              value={order.pickup_option_label_snapshot ?? "Needs coordination"}
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

function matchesFilter(order: SellerOrderRow, filter: OrderFilter) {
  if (filter === "all") return true;
  if (filter === "open") return ["open", "pending"].includes(order.order_status);

  return order.order_status === filter;
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
  const quantity = order.total_item_quantity ?? 0;

  return `${quantity} bird${quantity === 1 ? "" : "s"} across ${itemCount} item${
    itemCount === 1 ? "" : "s"
  }`;
}
