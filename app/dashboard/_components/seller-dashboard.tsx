"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "./seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PrimaryActionLink,
  SellerCard,
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

type MetricCardProps = {
  label: string;
  value: number | string | null | undefined;
  helper: string;
  glyph: string;
  glyphAlt: string;
  tone?: "amber" | "green";
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
            "inventory_item_id, listing_batch_id, species_name, species_slug, breed_display_name, origin_date, available_date, base_price, quantity_available, inventory_type, custom_inventory_label, effective_unit_price, listing_batch_visibility_status, listing_batch_moderation_status, inventory_visibility_status, inventory_moderation_status, operational_availability_status, inventory_updated_at",
          )
          .eq("store_id", seller.store_id)
          .neq("inventory_visibility_status", "archived")
          .neq("listing_batch_visibility_status", "archived")
          .eq("inventory_moderation_status", "normal")
          .eq("listing_batch_moderation_status", "normal")
          .order("species_name", { ascending: true })
          .order("breed_display_name", { ascending: true })
          .limit(100)
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

  const liveInventoryQuantity = useMemo(
    () => summarizeLiveInventoryQuantity(data.inventory),
    [data.inventory],
  );

  const storefrontIsLive =
    data.home?.is_publicly_available ?? seller?.is_publicly_available ?? false;
  const storefrontEnabled =
    data.home?.storefront_enabled ?? seller?.storefront_enabled ?? false;
  const storefrontHref = `/store/${seller?.store_slug ?? ""}`;
  const sellerDisplayName = getSellerDisplayName(seller?.store_name);
  const welcomeMessage = storefrontIsLive
    ? `Good morning${sellerDisplayName ? `, ${sellerDisplayName}` : ""} - your storefront is live.`
    : "Your storefront is ready for setup.";

  return (
    <div className="min-h-screen bg-[#fbfaf6]">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
        <section className="flex flex-col gap-4 rounded-xl border border-emerald-950/5 bg-[#f4f8ef] px-5 py-4 shadow-[0_12px_32px_rgba(46,39,25,0.04)] sm:px-6 lg:min-h-20 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-900/10">
              <Image
                src="/glyphs/checkmark.png"
                alt=""
                width={25}
                height={25}
              />
            </span>
            <p className="text-base font-medium text-stone-950">
              {welcomeMessage}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <PrimaryActionLink href="/dashboard/listings/new">
              <span aria-hidden="true" className="mr-2 text-xl leading-none">
                +
              </span>
              Add Listing
            </PrimaryActionLink>
            <Link className="seller-secondary-button gap-2" href={storefrontHref}>
              <Image src="/glyphs/storefront.png" alt="" width={20} height={20} />
              View Storefront
            </Link>
          </div>
        </section>

        <header>
          <h1 className="font-serif text-4xl font-bold tracking-normal text-stone-950 sm:text-5xl">
            Dashboard
          </h1>
        </header>

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
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="New orders"
                value={data.home?.pending_open_order_count}
                helper="Recent orders"
                glyph="/glyphs/shopping-bag.png"
                glyphAlt="Shopping bag"
                tone="amber"
              />
              <MetricCard
                label="Available birds"
                value={
                  data.home?.total_active_inventory_quantity ??
                  liveInventoryQuantity
                }
                helper="Live visible inventory"
                glyph="/glyphs/hen.png"
                glyphAlt="Hen"
              />
              <MetricCard
                label="Total items for sale"
                value={data.home?.active_listing_count}
                helper="Across all active listings"
                glyph="/glyphs/incubator.png"
                glyphAlt="Incubator"
              />
              <MetricCard
                label="Storefront"
                value={storefrontIsLive ? "Live" : "Not live"}
                helper={storefrontEnabled ? "Enabled" : "Disabled"}
                glyph="/glyphs/storefront.png"
                glyphAlt="Storefront"
              />
            </section>

            <SellerCard className="overflow-hidden rounded-2xl border-stone-200/80 shadow-[0_16px_38px_rgba(46,39,25,0.05)]">
              <SectionHeading
                title="Recent orders"
                actionHref="/dashboard/orders"
                actionLabel="View all orders"
              />
              {data.orders.length > 0 ? (
                <div className="divide-y divide-stone-200/80">
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
          </>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
  glyph,
  glyphAlt,
  tone = "green",
}: MetricCardProps) {
  const iconTone =
    tone === "amber"
      ? "bg-orange-100 text-orange-600"
      : "bg-emerald-900/5 text-emerald-900";
  const valueTone = tone === "amber" ? "text-orange-600" : "text-emerald-900";

  return (
    <SellerCard className="min-h-44 rounded-2xl p-5 shadow-[0_12px_28px_rgba(46,39,25,0.04)] sm:p-6">
      <div className="flex h-full items-center gap-5">
        <span
          className={`flex size-16 shrink-0 items-center justify-center rounded-full ${iconTone}`}
        >
          <Image src={glyph} alt={glyphAlt} width={34} height={34} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-600">{label}</p>
          <p className={`mt-3 font-serif text-4xl font-bold ${valueTone}`}>
            {value ?? 0}
          </p>
          <p className="mt-2 text-sm text-stone-500">{helper}</p>
        </div>
      </div>
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
    <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-5 py-5 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-emerald-900/10">
          <Image src="/glyphs/clipboard.png" alt="" width={23} height={23} />
        </span>
        <h2 className="font-serif text-2xl font-bold text-stone-950">{title}</h2>
      </div>
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
  const initials = getCustomerInitials(
    order.buyer_first_name_snapshot,
    order.buyer_last_name_snapshot,
    customerName,
  );

  return (
    <article className="mx-5 mb-5 rounded-xl border border-stone-200/90 px-5 py-5 last:mb-5 sm:mx-6 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-stone-950">
              {order.order_number}
            </h3>
            <StatusBadge status={getOrderStatusLabel(order.order_status)} />
          </div>
          <span className="text-sm text-stone-500 lg:hidden">
            {formatDateTime(order.created_at)}
          </span>
        </div>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-900/10 text-base font-bold text-emerald-900">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-600">
              <span className="font-semibold text-stone-950">{customerName}</span>
              <span>
                {order.total_item_quantity ?? order.item_count ?? 0} item(s) -{" "}
                {formatCurrency(order.total_amount)}
              </span>
              {order.buyer_email_snapshot ? (
                <a
                  className="inline-flex items-center gap-2 text-stone-950 underline-offset-4 hover:underline"
                  href={`mailto:${order.buyer_email_snapshot}`}
                >
                  <Image
                    src="/glyphs/envelope.png"
                    alt=""
                    width={17}
                    height={17}
                  />
                  {order.buyer_email_snapshot}
                </a>
              ) : null}
              {order.buyer_phone_snapshot ? (
                <a
                  className="inline-flex items-center gap-2 text-stone-950 underline-offset-4 hover:underline"
                  href={`tel:${order.buyer_phone_snapshot}`}
                >
                  <Image src="/glyphs/phone.png" alt="" width={17} height={17} />
                  {order.buyer_phone_snapshot}
                </a>
              ) : null}
            </div>
            <p className="mt-3 text-sm text-stone-600">
              Pickup: {order.pickup_option_label_snapshot ?? "Not selected"}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 lg:mt-0 lg:justify-end">
        <span className="hidden min-w-24 text-right text-sm text-stone-500 lg:block">
          {formatDateTime(order.created_at)}
        </span>
        {order.buyer_phone_snapshot ? (
          <a
            className="seller-small-button gap-2"
            href={`sms:${order.buyer_phone_snapshot}`}
          >
            <Image src="/glyphs/chat.png" alt="" width={18} height={18} />
            Text
          </a>
        ) : null}
        {order.buyer_email_snapshot ? (
          <a
            className="seller-small-button gap-2"
            href={`mailto:${order.buyer_email_snapshot}`}
          >
            <Image src="/glyphs/envelope.png" alt="" width={18} height={18} />
            Email
          </a>
        ) : null}
        <Link
          className="seller-small-button min-h-11 gap-3 bg-emerald-800 px-5 text-white hover:bg-emerald-900"
          href={`/dashboard/orders/${order.order_id}`}
        >
          View order
          <span aria-hidden="true">›</span>
        </Link>
      </div>
    </article>
  );
}

function getOrderStatusLabel(status: string | null | undefined) {
  if (!status || status === "pending") return "open";

  return status;
}

function getCustomerInitials(
  firstName: string | null,
  lastName: string | null,
  fallback: string,
) {
  const initials = [firstName, lastName]
    .filter(Boolean)
    .map((part) => part?.trim().charAt(0))
    .join("");

  if (initials) return initials.toUpperCase();

  return fallback
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function getSellerDisplayName(storeName: string | null | undefined) {
  if (!storeName) return null;

  return storeName.replace(/\s+(test\s+)?store$/i, "").trim() || storeName;
}

function summarizeLiveInventoryQuantity(rows: SellerInventoryRow[]) {
  return rows
    .filter(
      (row) =>
        row.inventory_visibility_status === "active" &&
        row.listing_batch_visibility_status === "active" &&
        (row.quantity_available ?? 0) > 0,
    )
    .reduce((total, row) => total + (row.quantity_available ?? 0), 0);
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value ?? 0);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Date not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
