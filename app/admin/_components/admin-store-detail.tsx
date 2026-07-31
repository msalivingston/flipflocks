"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { supabase } from "@/lib/supabase";
import type {
  AdminActivityRow,
  AdminStoreDetailRow,
  AdminStoreOperationsSummaryRow,
} from "../_lib/admin-types";
import { AdminStoreControls } from "./admin-store-controls";
import {
  AdminAccessState,
  AdminCard,
  AdminCopyButton,
  AdminErrorState,
  AdminLoadingState,
  AdminStatusBadge,
  formatDateTime,
  formatMoney,
  isAdminAuthorizationError,
} from "./admin-ui";

export function AdminStoreDetail({ storeId }: { storeId: string }) {
  const [store, setStore] = useState<AdminStoreDetailRow | null>(null);
  const [operations, setOperations] =
    useState<AdminStoreOperationsSummaryRow | null>(null);
  const [activity, setActivity] = useState<AdminActivityRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStore = useCallback(
    async () => {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      setError(null);

      if (userError || !userData.user) {
        setError("Sign in with a platform admin account to view this area.");
        setIsLoading(false);
        return;
      }

      const [detailResult, operationsResult, activityResult] =
        await Promise.all([
          supabase.rpc("admin_platform_store_detail", {
            p_store_id: storeId,
          }),
          supabase.rpc("admin_platform_store_operations_summary", {
            p_store_id: storeId,
          }),
          supabase.rpc("admin_platform_store_recent_activity", {
            p_limit: 10,
            p_store_id: storeId,
          }),
        ]);

      const firstError =
        detailResult.error ?? operationsResult.error ?? activityResult.error;

      if (firstError) {
        setError(firstError.message);
        setIsLoading(false);
        return;
      }

      const detailRows = (detailResult.data ?? []) as AdminStoreDetailRow[];
      const operationsRows = (operationsResult.data ??
        []) as AdminStoreOperationsSummaryRow[];

      setStore(detailRows[0] ?? null);
      setOperations(operationsRows[0] ?? null);
      setActivity((activityResult.data ?? []) as AdminActivityRow[]);
      setIsLoading(false);
    },
    [storeId],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadStore();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadStore]);

  return (
    <>
      <header className="border-b border-[#c9ddd6] bg-white">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-col gap-3 px-5 py-3 sm:px-7 md:flex-row md:items-center md:justify-between">
          <Link
            className="inline-flex items-center gap-2 text-sm font-bold text-stone-700 transition hover:text-[#145447]"
            href="/admin/stores"
          >
            <span aria-hidden="true">←</span>
            Back to Stores
          </Link>
          {store ? (
            <div className="flex flex-wrap gap-2">
              <Link
                className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#145447] px-4 text-sm font-bold text-white transition hover:bg-[#0f3f35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78b5a5] focus-visible:ring-offset-2"
                href={`/store/${store.store_slug}`}
                target="_blank"
              >
                Public Storefront
              </Link>
              <AdminCopyButton
                className="!border-[#145447] !bg-[#145447] !text-white hover:!bg-[#0f3f35]"
                label="Copy Store ID"
                value={store.store_id}
              />
            </div>
          ) : null}
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-3 px-5 py-4 sm:px-7">
        {isLoading ? <AdminLoadingState label="Loading store detail" /> : null}

        {!isLoading && error ? (
          isAdminAuthorizationError(error) ? (
            <AdminAccessState message={error} />
          ) : (
            <AdminErrorState message={error} />
          )
        ) : null}

        {!isLoading && !error && (!store || !operations) ? (
          <AdminErrorState
            message="No store was returned for this admin detail request."
            title="Store not found"
          />
        ) : null}

        {!isLoading && !error && store && operations ? (
          <>
            <StoreIdentityCard store={store} />

            <div className="grid gap-3 lg:grid-cols-2">
              <SalesSummaryCard operations={operations} />
              <PlanStorefrontCard operations={operations} store={store} />
            </div>

            <AdminStoreControls
              onRefresh={() => loadStore()}
              operations={operations}
              store={store}
            />

            <div className="grid gap-3 lg:grid-cols-2">
              <OrderSummaryCard operations={operations} />
              <AdminCard>
                <SectionHeader title="Admin Activity" />
                <RecentActivityList activity={activity} />
              </AdminCard>
            </div>

            <StoreDataCard store={store} />

            <p className="pb-2 text-center text-xs font-semibold text-stone-500">
              Internal administrative area. Do not share private store details
              outside the support team.
            </p>
          </>
        ) : null}
      </div>
    </>
  );
}

function StoreIdentityCard({ store }: { store: AdminStoreDetailRow }) {
  return (
    <AdminCard>
      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-stone-950 sm:text-2xl">
              {store.store_name}
            </h1>
            <AdminStatusBadge value={store.store_status} />
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-stone-500">
            /store/{store.store_slug}
          </p>
          <p className="mt-2 truncate text-sm text-stone-700">
            <span className="font-bold">Owner:</span>{" "}
            {store.owner_email ?? "Email not available"}
          </p>
          <p className="mt-1 text-xs font-semibold text-stone-500">
            Joined {formatDate(store.created_at)}
          </p>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <DetailField label="Store ID" value={store.store_id} />
            <DetailField label="Owner User ID" value={store.owner_user_id} />
            <DetailField label="Store Slug" value={store.store_slug} />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
            <StatusField label="Store Status" value={store.store_status} />
            <StatusField
              label="Storefront Enabled"
              value={store.storefront_enabled ? "Enabled" : "Disabled"}
            />
            <StatusField
              label="Storefront Mode"
              value={store.storefront_mode}
            />
            <StatusField
              label="Admin Hold"
              value={store.admin_hold_reason ? "On hold" : "Not on hold"}
            />
          </div>
        </div>
      </div>
    </AdminCard>
  );
}

function SalesSummaryCard({
  operations,
}: {
  operations: AdminStoreOperationsSummaryRow;
}) {
  return (
    <AdminCard>
      <SectionHeader title="Sales Summary" />
      <div className="grid gap-2 px-4 sm:grid-cols-3">
        <SummaryMetric
          icon="/glyphs/reports.png"
          label="Recorded Gross Sales"
          value={formatMoney(toNumber(operations.recorded_gross_sales))}
        />
        <SummaryMetric
          icon="/glyphs/cart.png"
          label="Total Orders"
          value={String(operations.total_order_count)}
        />
        <SummaryMetric
          icon="/glyphs/clipboard.png"
          label="Open Orders"
          value={String(operations.open_order_count)}
        />
      </div>
      <p className="px-4 pb-4 pt-3 text-xs leading-5 text-stone-500">
        Sales include seller orders across all categories, excluding FlockFront
        subscription fees. Recorded gross follows seller Reports: non-canceled
        totals regardless of payment status, without subtracting refunds.
      </p>
    </AdminCard>
  );
}

function PlanStorefrontCard({
  operations,
  store,
}: {
  operations: AdminStoreOperationsSummaryRow;
  store: AdminStoreDetailRow;
}) {
  const requestedPlan = getPlanCapabilities(operations.requested_plan_key);
  const effectivePlan = operations.plan_key
    ? getPlanCapabilities(operations.plan_key)
    : null;
  const configuredPrice =
    operations.requested_billing_cadence === "yearly" &&
    requestedPlan.yearlyPrice !== null
      ? `${formatMoney(requestedPlan.yearlyPrice)} / year`
      : operations.requested_billing_cadence === "monthly"
        ? `${formatMoney(requestedPlan.monthlyPrice)} / month`
        : null;

  return (
    <AdminCard>
      <SectionHeader title="Plan & Storefront" />
      <div className="grid gap-2 px-4 pb-4 sm:grid-cols-3">
        <SummaryMetric
          icon="/glyphs/shopping-bag.png"
          label="Requested Plan"
          value={requestedPlan.displayName}
        >
          {configuredPrice ? (
            <p className="mt-1 text-xs font-semibold text-stone-500">
              Configured {configuredPrice}
            </p>
          ) : null}
        </SummaryMetric>
        <SummaryMetric
          icon="/glyphs/storefront.png"
          label="Effective Access"
          value={
            operations.has_active_entitlement
              ? `${effectivePlan?.displayName ?? "Active"}`
              : "Inactive"
          }
        >
          <p className="mt-1 text-xs font-semibold text-stone-500">
            {formatEntitlementReason(operations.entitlement_reason)}
            {operations.entitlement_access_until
              ? ` · until ${formatDateTime(operations.entitlement_access_until)}`
              : ""}
          </p>
        </SummaryMetric>
        <SummaryMetric
          icon="/glyphs/storefront.png"
          label="Storefront Status"
          value={store.storefront_enabled ? "Enabled" : "Disabled"}
        />
      </div>
    </AdminCard>
  );
}

function formatEntitlementReason(value: string | null) {
  return (value ?? "inactive").replaceAll("_", " ");
}

function OrderSummaryCard({
  operations,
}: {
  operations: AdminStoreOperationsSummaryRow;
}) {
  return (
    <AdminCard>
      <SectionHeader title="Order Summary" />
      <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-4">
        <OrderCount label="Open" value={operations.open_order_count} />
        <OrderCount
          label="Fulfilled"
          tone="positive"
          value={operations.fulfilled_order_count}
        />
        <OrderCount
          label="Canceled"
          tone="restrictive"
          value={operations.canceled_order_count}
        />
        <OrderCount
          label="Refunded"
          value={operations.refunded_order_count}
        />
      </div>
    </AdminCard>
  );
}

function StoreDataCard({ store }: { store: AdminStoreDetailRow }) {
  return (
    <details className="group rounded-lg border border-stone-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold text-stone-700 marker:hidden">
        <span>Store Data</span>
        <span
          aria-hidden="true"
          className="text-stone-400 transition group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-stone-100 px-4 py-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
          <DataMetric label="Sale groups" value={store.listing_batch_count} />
          <DataMetric
            label="Inventory rows"
            value={store.inventory_item_count}
          />
          <DataMetric
            label="Available birds"
            value={store.total_inventory_quantity}
          />
          <DataMetric label="Customers" value={store.customer_count} />
          <DataMetric
            label="Equipment items"
            value={store.equipment_item_count}
          />
          <DataMetric
            label="Poultry products"
            value={store.processed_poultry_item_count}
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 border-t border-stone-100 pt-3 sm:grid-cols-3">
          <StatusField
            label="Hatching Eggs"
            value={store.hatching_eggs_enabled ? "Enabled" : "Disabled"}
          />
          <StatusField
            label="Equipment / Supplies"
            value={store.equipment_supplies_enabled ? "Enabled" : "Disabled"}
          />
          <StatusField
            label="Processed Poultry"
            value={store.processed_poultry_enabled ? "Enabled" : "Disabled"}
          />
        </div>
      </div>
    </details>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border-stone-200 sm:border-l sm:pl-3 sm:first:border-l-0 sm:first:pl-0">
      <p className="text-xs font-semibold text-stone-500">
        {label}
      </p>
      <code
        className="mt-1 block truncate text-xs font-semibold text-stone-800"
        title={value}
      >
        {value}
      </code>
    </div>
  );
}

function StatusField({
  label,
  value,
}: {
  label: string;
  value: string | boolean;
}) {
  return (
    <div className="min-w-0 border-stone-200 sm:border-l sm:pl-3 sm:first:border-l-0 sm:first:pl-0">
      <p className="mb-1.5 text-xs font-semibold text-stone-500">
        {label}
      </p>
      <AdminStatusBadge value={value} />
    </div>
  );
}

function SectionHeader({
  title,
}: {
  title: string;
}) {
  return (
    <div className="px-4 pb-3 pt-4">
      <h2 className="text-base font-bold text-stone-950">{title}</h2>
    </div>
  );
}

function SummaryMetric({
  children,
  icon,
  label,
  value,
}: {
  children?: React.ReactNode;
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-[#f7faf8] px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#e4f2ec]">
        <Image alt="" height={21} src={icon} width={21} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-stone-500">{label}</p>
        <p className="mt-0.5 truncate text-base font-bold capitalize text-stone-950 sm:text-lg">
          {value}
        </p>
        {children}
      </div>
    </div>
  );
}

function OrderCount({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "positive" | "restrictive";
  value: number;
}) {
  return (
    <div className="rounded-md border border-stone-200 bg-[#fbfcfb] px-3 py-2.5">
      <p className="text-lg font-bold text-stone-950">{value}</p>
      <p
        className={`mt-1 text-xs font-bold ${
          tone === "positive"
            ? "text-emerald-700"
            : tone === "restrictive"
              ? "text-red-700"
              : "text-stone-500"
        }`}
      >
        {label}
      </p>
    </div>
  );
}

function DataMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-stone-500">{label}</p>
      <p className="mt-0.5 text-base font-bold text-stone-800">{value}</p>
    </div>
  );
}

function RecentActivityList({ activity }: { activity: AdminActivityRow[] }) {
  if (activity.length === 0) {
    return (
      <p className="border-t border-stone-100 px-5 py-4 text-sm font-semibold text-stone-500">
        No recent admin activity found.
      </p>
    );
  }

  return (
    <div className="max-h-64 overflow-y-auto border-t border-stone-100">
      {activity.map((event) => {
        const change = formatActivityChange(event.metadata);

        return (
          <div
            className="border-b border-stone-100 px-4 py-2.5 last:border-0"
            key={event.admin_activity_event_id}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-bold text-stone-950">
                  {formatAdminAction(event.action_type)}
                </p>
                {event.reason ? (
                  <p className="mt-0.5 text-xs leading-5 text-stone-600">
                    {event.reason}
                  </p>
                ) : null}
                {change ? (
                  <p className="mt-1 text-xs font-semibold text-stone-500">
                    {change}
                  </p>
                ) : null}
              </div>
              <p className="shrink-0 text-xs font-semibold text-stone-500">
                {formatDateTime(event.created_at)}
              </p>
            </div>
            {event.actor_user_id ? (
              <p className="mt-1 truncate text-[11px] font-semibold text-stone-500">
                Admin user: {event.actor_user_id}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function formatAdminAction(actionType: string) {
  const labels: Record<string, string> = {
    store_hold_placed: "Admin hold placed",
    store_hold_removed: "Admin hold removed",
    store_internal_note_updated: "Internal note updated",
    store_plan_changed: "Plan changed",
    storefront_disabled: "Storefront disabled",
    storefront_enabled: "Storefront enabled",
  };

  return labels[actionType] ?? actionType.replaceAll("_", " ");
}

function formatActivityChange(metadata: Record<string, unknown>) {
  if (!("previous_value" in metadata) || !("new_value" in metadata)) {
    return null;
  }

  return `${formatActivityValue(metadata.previous_value)} → ${formatActivityValue(metadata.new_value)}`;
}

function formatActivityValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";

  const planLabels: Record<string, string> = {
    full_flock: "Market",
    small_flock: "Coop",
  };

  return planLabels[String(value)] ?? String(value);
}

function formatDate(value: string | null) {
  if (!value) return "date not available";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function toNumber(value: number | string | null | undefined) {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : 0;
}
