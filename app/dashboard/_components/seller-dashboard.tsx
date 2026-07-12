"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
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
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(
    () => new Set(),
  );

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
  const storeName = seller?.store_name?.trim();
  const hasListings =
    (data.home?.active_listing_count ?? data.inventory.length) > 0;
  const showFirstListingPrompt = !isLoading && !error && !hasListings;
  const welcomeMessage = storefrontIsLive
    ? `Hello${storeName ? `, ${storeName}` : ""} - your storefront is live.`
    : `Hello${storeName ? `, ${storeName}` : ""}`;
  const toggleOrder = (orderId: string) => {
    setExpandedOrderIds((current) => {
      const next = new Set(current);

      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }

      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[#fbfaf6]">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-8 sm:py-5 lg:px-10 lg:py-6">
        {showFirstListingPrompt ? (
          <FirstListingWelcomeCard />
        ) : (
          <section className="flex flex-col gap-2.5 rounded-xl border border-emerald-950/5 bg-[#f4f8ef] px-3 py-2.5 shadow-[0_12px_32px_rgba(46,39,25,0.04)] sm:gap-3 sm:px-5 sm:py-3 lg:min-h-14 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-900/10 sm:size-10">
                <Image
                  src="/glyphs/checkmark.png"
                  alt=""
                  width={20}
                  height={20}
                />
              </span>
              <p className="text-sm font-medium text-stone-950 sm:text-base">
                {welcomeMessage}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <PrimaryActionLink href="/dashboard/inventory/add-v2">
                <span aria-hidden="true" className="mr-2 text-xl leading-none">
                  +
                </span>
                Add Inventory
              </PrimaryActionLink>
              <Link
                className="seller-secondary-button gap-2"
                href={storefrontHref}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Image src="/glyphs/storefront.png" alt="" width={20} height={20} />
                View Storefront
              </Link>
            </div>
          </section>
        )}

        <header>
          <h1 className="font-serif text-3xl font-bold tracking-normal text-stone-950 sm:text-4xl">
            Dashboard
          </h1>
        </header>

        {isLoading ? <LoadingState label="Loading dashboard" /> : null}

        {error ? (
          <ErrorState
            message={error}
            action={
              <Link className="seller-secondary-button" href="/login">
                Return to sign in
              </Link>
            }
          />
        ) : null}

        {!isLoading && !error ? (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
                    <OrderRow
                      key={order.order_id}
                      isExpanded={expandedOrderIds.has(order.order_id)}
                      onToggle={() => toggleOrder(order.order_id)}
                      order={order}
                    />
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

function FirstListingWelcomeCard() {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#d8e5cf] bg-[#f4f8ef] shadow-[0_18px_44px_rgba(46,39,25,0.08)]">
      <div className="grid gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[1fr_auto] lg:items-center lg:px-7">
        <div className="flex min-w-0 gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-[#d8e5cf] sm:size-16">
            <Image
              src="/glyphs/storefront.png"
              alt=""
              width={34}
              height={34}
              className="sm:h-10 sm:w-10"
            />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-wide text-[#246f38]">
              Onboarding complete
            </p>
            <h2 className="mt-1 font-serif text-2xl font-bold leading-tight text-stone-950 sm:text-3xl">
              Your store is ready. Add your first listing.
            </h2>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-stone-700 sm:text-base">
              Listings are what buyers see on your storefront. Start with
              whatever you have available now, and you can add more later.
            </p>
            <p className="mt-2 text-sm font-semibold text-[#246f38]">
              Your storefront stays private until you&apos;re ready to publish.
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:min-w-64 lg:grid-cols-1">
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-emerald-800 px-5 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
            href="/dashboard/inventory/add-v2/live-birds"
          >
            <span aria-hidden="true" className="mr-2 text-xl leading-none">
              +
            </span>
            Add your first listing
          </Link>
          <Link
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[#b7d7b9] bg-white px-5 text-base font-bold text-emerald-900 shadow-sm transition hover:border-emerald-800 hover:bg-[#fffaf1] focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
            href="/dashboard/store-admin"
          >
            <Image src="/glyphs/storefront.png" alt="" width={20} height={20} />
            Open Store Admin
          </Link>
        </div>
      </div>
    </section>
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
    <SellerCard className="min-h-28 rounded-2xl p-3 shadow-[0_12px_28px_rgba(46,39,25,0.04)] sm:p-4">
      <div className="flex h-full min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4 lg:flex-col lg:items-start xl:flex-row xl:items-center">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full sm:size-12 ${iconTone}`}
        >
          <Image
            src={glyph}
            alt={glyphAlt}
            width={24}
            height={24}
            className="sm:h-7 sm:w-7"
          />
        </span>
        <div className="min-w-0">
          <p className="text-base font-medium leading-snug text-stone-600 sm:text-sm lg:text-xs xl:text-sm">
            {label}
          </p>
          <p className={`mt-0.5 font-serif text-2xl font-bold sm:mt-1 sm:text-3xl lg:text-2xl xl:text-3xl ${valueTone}`}>
            {value ?? 0}
          </p>
          <p className="mt-0.5 text-sm leading-6 text-stone-500 sm:mt-1 sm:leading-5 lg:text-xs xl:text-sm">
            {helper}
          </p>
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
    <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 sm:px-5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-emerald-900/10">
          <Image src="/glyphs/clipboard.png" alt="" width={21} height={21} />
        </span>
        <h2 className="font-serif text-xl font-bold text-stone-950 sm:text-2xl">
          {title}
        </h2>
      </div>
      <Link
        className="inline-flex min-h-11 items-center text-base font-bold text-emerald-800 sm:min-h-0 sm:text-sm sm:font-semibold"
        href={actionHref}
      >
        {actionLabel}
      </Link>
    </div>
  );
}

function OrderRow({
  order,
  isExpanded,
  onToggle,
}: {
  order: SellerOrderSummary;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const customerName =
    [order.buyer_first_name_snapshot, order.buyer_last_name_snapshot]
      .filter(Boolean)
      .join(" ") || "Customer";
  const itemCount = order.total_item_quantity ?? order.item_count ?? 0;
  const detailsId = `order-details-${order.order_id}`;

  return (
    <article className="mx-4 mb-2 rounded-xl border border-stone-200/90 bg-white last:mb-4 sm:mx-5">
      <button
        aria-controls={detailsId}
        aria-expanded={isExpanded}
        className="grid w-full gap-1.5 rounded-xl px-3.5 py-2.5 text-left transition hover:bg-[#fbfaf6] focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2 sm:gap-2 sm:px-4 sm:py-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] sm:items-center"
        onClick={onToggle}
        type="button"
      >
        <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-start">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-semibold text-stone-950">
              {order.order_number}
            </span>
            <span className="shrink-0">
              <StatusBadge status={getOrderStatusLabel(order.order_status)} />
            </span>
          </div>
          <ChevronRight
            aria-hidden="true"
            className={`size-5 shrink-0 text-stone-500 transition-transform duration-200 sm:hidden ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </div>

        <div className="min-w-0">
          <p className="truncate text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
            {customerName}
          </p>
          <p className="text-sm text-stone-600 sm:mt-0.5">
            {itemCount} {itemCount === 1 ? "item" : "items"} &bull;{" "}
            {formatCurrency(order.total_amount)}
          </p>
        </div>

        <span className="text-sm leading-tight text-stone-500 sm:text-right">
          {formatDateTime(order.created_at)}
        </span>

        <ChevronRight
          aria-hidden="true"
          className={`hidden size-5 text-stone-500 transition-transform duration-200 sm:block ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
        id={detailsId}
      >
        <div className="overflow-hidden">
          <div className="grid gap-2.5 border-t border-stone-200/80 px-4 py-2.5">
            <div className="grid min-w-0 gap-2 text-sm text-stone-600">
              {order.buyer_email_snapshot ? (
                <a
                  aria-label={`Email ${order.buyer_email_snapshot}`}
                  className="inline-flex min-w-0 max-w-full items-center gap-2 text-stone-950 underline-offset-4 hover:underline lg:max-w-2xl"
                  href={`mailto:${order.buyer_email_snapshot}`}
                  title={order.buyer_email_snapshot}
                >
                  <Image
                    className="shrink-0"
                    src="/glyphs/envelope.png"
                    alt=""
                    width={17}
                    height={17}
                  />
                  <span className="min-w-0 truncate">
                    {order.buyer_email_snapshot}
                  </span>
                </a>
              ) : null}
              <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-1.5">
                {order.buyer_phone_snapshot ? (
                  <a
                    className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-stone-950 underline-offset-4 hover:underline sm:min-h-0"
                    href={`tel:${order.buyer_phone_snapshot}`}
                  >
                    <Image
                      className="shrink-0"
                      src="/glyphs/phone.png"
                      alt=""
                      width={17}
                      height={17}
                    />
                    {order.buyer_phone_snapshot}
                  </a>
                ) : null}
                <span className="min-w-0 max-w-full leading-5 sm:max-w-xl">
                  Pickup: {order.pickup_option_label_snapshot ?? "Not selected"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-0.5">
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
                  <Image
                    src="/glyphs/envelope.png"
                    alt=""
                    width={18}
                    height={18}
                  />
                  Email
                </a>
              ) : null}
              <Link
                className="seller-small-button min-h-11 gap-2 bg-emerald-800 px-4 text-white hover:bg-emerald-900 sm:min-h-9"
                href={`/dashboard/orders/${order.order_id}`}
              >
                View order
                <span aria-hidden="true">&gt;</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function getOrderStatusLabel(status: string | null | undefined) {
  if (!status || status === "pending") return "open";

  return status;
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
