"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "./seller-context";
import {
  ContactActionButtons,
  EmptyState,
  ErrorState,
  LoadingState,
  PrimaryActionLink,
  SellerCard,
  SellerPageHeader,
  StatusBadge,
} from "./seller-ui";
import type {
  SellerDashboardHome,
  SellerInventoryRow,
  SellerOrderSummary,
} from "../_lib/seller-types";

type DashboardState = {
  home: SellerDashboardHome | null;
  orders: SellerOrderSummary[];
  inventory: SellerInventoryRow[];
};

export function SellerDashboard() {
  const { seller } = useSellerContext();
  const [data, setData] = useState<DashboardState>({
    home: null,
    orders: [],
    inventory: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      if (!seller) return;

      setIsLoading(true);
      setError(null);

      const [homeResult, orderResult, inventoryResult] = await Promise.all([
        supabase
          .rpc("get_seller_dashboard_home", {
            p_store_id: seller.store_id,
          })
          .maybeSingle<SellerDashboardHome>(),
        supabase
          .from("seller_order_management")
          .select(
            "order_id, order_number, order_status, payment_status, created_at, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_email_snapshot, buyer_phone_snapshot, total_amount, item_count, total_item_quantity, pickup_option_label_snapshot",
          )
          .eq("store_id", seller.store_id)
          .order("created_at", { ascending: false })
          .limit(5)
          .returns<SellerOrderSummary[]>(),
        supabase
          .from("seller_inventory_management")
          .select(
            "listing_batch_id, species_name, breed_display_name, available_date, base_price, quantity_available, effective_unit_price, listing_batch_visibility_status, inventory_visibility_status, operational_availability_status, inventory_updated_at",
          )
          .eq("store_id", seller.store_id)
          .order("inventory_updated_at", { ascending: false })
          .limit(12)
          .returns<SellerInventoryRow[]>(),
      ]);

      if (!isMounted) return;

      const firstError =
        homeResult.error ?? orderResult.error ?? inventoryResult.error;

      if (firstError) {
        setError(firstError.message);
        setIsLoading(false);
        return;
      }

      setData({
        home: homeResult.data,
        orders: orderResult.data ?? [],
        inventory: inventoryResult.data ?? [],
      });
      setIsLoading(false);
    }

    void loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const activeListings = useMemo(
    () => summarizeActiveListings(data.inventory),
    [data.inventory],
  );

  return (
    <>
      <SellerPageHeader
        eyebrow={seller?.store_name}
        title="Dashboard"
        description="A working seller home for listings, pickup orders, customers, and storefront status."
        action={
          <PrimaryActionLink href="/dashboard/listings/new">
            Create Listing
          </PrimaryActionLink>
        }
      />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-5 sm:px-7">
        {isLoading ? <LoadingState label="Loading dashboard" /> : null}

        {error ? (
          <ErrorState
            message={error}
            action={
              <Link className="seller-secondary-button" href="/login">
                Return to login
              </Link>
            }
          />
        ) : null}

        {!isLoading && !error ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Active listings"
                value={data.home?.active_listing_count}
                helper={`${data.home?.total_active_inventory_quantity ?? 0} birds available`}
              />
              <MetricCard
                label="Pending orders"
                value={data.home?.pending_open_order_count}
                helper="Open orders needing coordination"
              />
              <MetricCard
                label="Upcoming pickups"
                value={data.home?.upcoming_pickup_order_count}
                helper="Open orders with selected pickup options"
              />
              <MetricCard
                label="Storefront"
                value={data.home?.is_publicly_available ? "Live" : "Not live"}
                helper={data.home?.storefront_enabled ? "Enabled" : "Disabled"}
              />
            </section>

            <SellerCard className="p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-stone-950">
                    Storefront quick link
                  </h2>
                  <p className="mt-1 text-sm text-stone-600">
                    Buyers see saved public data at{" "}
                    <span className="font-semibold text-stone-950">
                      /store/{seller?.store_slug}
                    </span>
                  </p>
                </div>
                <Link
                  className="seller-secondary-button"
                  href={`/store/${seller?.store_slug}`}
                >
                  View Storefront
                </Link>
              </div>
            </SellerCard>

            <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <SellerCard className="overflow-hidden">
                <SectionHeading
                  title="Recent orders"
                  actionHref="/dashboard/orders"
                  actionLabel="View orders"
                />
                {data.orders.length > 0 ? (
                  <div className="divide-y divide-stone-200">
                    {data.orders.map((order) => (
                      <OrderRow key={order.order_id} order={order} />
                    ))}
                  </div>
                ) : (
                  <div className="p-5">
                    <EmptyState
                      title="No orders yet"
                      description="New pay-at-pickup orders will appear here once buyers place them."
                    />
                  </div>
                )}
              </SellerCard>

              <SellerCard className="overflow-hidden">
                <SectionHeading
                  title="Active listings"
                  actionHref="/dashboard/listings"
                  actionLabel="Manage listings"
                />
                {activeListings.length > 0 ? (
                  <div className="divide-y divide-stone-200">
                    {activeListings.map((listing) => (
                      <ListingRow key={listing.id} listing={listing} />
                    ))}
                  </div>
                ) : (
                  <div className="p-5">
                    <EmptyState
                      title="No active listings"
                      description="Create a bird listing to prove the seller flow end to end."
                      action={
                        <PrimaryActionLink href="/dashboard/listings/new">
                          Create Listing
                        </PrimaryActionLink>
                      }
                    />
                  </div>
                )}
              </SellerCard>
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: number | string | null | undefined;
  helper: string;
}) {
  return (
    <SellerCard className="p-5">
      <p className="text-sm font-medium text-stone-600">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-stone-950">
        {value ?? 0}
      </p>
      <p className="mt-2 text-sm text-stone-500">{helper}</p>
    </SellerCard>
  );
}

function SectionHeading({
  title,
  actionHref,
  actionLabel,
}: {
  title: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-4">
      <h2 className="text-base font-semibold text-stone-950">{title}</h2>
      <Link className="text-sm font-semibold text-emerald-800" href={actionHref}>
        {actionLabel}
      </Link>
    </div>
  );
}

function OrderRow({ order }: { order: SellerOrderSummary }) {
  const customerName =
    [order.buyer_first_name_snapshot, order.buyer_last_name_snapshot]
      .filter(Boolean)
      .join(" ") || "Customer";

  return (
    <article className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-stone-950">
            {order.order_number}
          </h3>
          <StatusBadge status={order.order_status} />
        </div>
        <p className="mt-1 text-sm text-stone-600">
          {customerName} · {order.total_item_quantity ?? 0} item(s) ·{" "}
          {formatCurrency(order.total_amount)}
        </p>
        <p className="mt-1 text-sm text-stone-500">
          Pickup: {order.pickup_option_label_snapshot ?? "Not selected"}
        </p>
      </div>
      <ContactActionButtons
        phone={order.buyer_phone_snapshot}
        email={order.buyer_email_snapshot}
      />
    </article>
  );
}

function ListingRow({
  listing,
}: {
  listing: ReturnType<typeof summarizeActiveListings>[number];
}) {
  return (
    <article className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-stone-950">{listing.title}</h3>
          <p className="mt-1 text-sm text-stone-600">
            {listing.rowCount} row(s) · {listing.quantity} available · ready{" "}
            {formatDate(listing.availableDate)}
          </p>
        </div>
        <StatusBadge status={listing.status} />
      </div>
    </article>
  );
}

function summarizeActiveListings(rows: SellerInventoryRow[]) {
  const summaries = new Map<
    string,
    {
      id: string;
      title: string;
      status: string;
      availableDate: string;
      quantity: number;
      rowCount: number;
    }
  >();

  rows.forEach((row) => {
    const existing = summaries.get(row.listing_batch_id);
    const quantity = row.quantity_available ?? 0;

    if (existing) {
      existing.quantity += quantity;
      existing.rowCount += 1;
      return;
    }

    summaries.set(row.listing_batch_id, {
      id: row.listing_batch_id,
      title: `${row.breed_display_name} ${row.species_name}`,
      status: row.operational_availability_status,
      availableDate: row.available_date,
      quantity,
      rowCount: 1,
    });
  });

  return Array.from(summaries.values()).slice(0, 5);
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value ?? 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
