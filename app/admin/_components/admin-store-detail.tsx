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
  AdminMetric,
  AdminPageHeader,
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
      <AdminPageHeader
        action={
          <Link className="seller-secondary-button" href="/admin/stores">
            Back to Stores
          </Link>
        }
        description="Operational support details and narrowly scoped store controls."
        eyebrow="Platform Admin"
        title={store?.store_name ?? "Store Detail"}
      />

      <div className="mx-auto grid w-full max-w-7xl gap-4 px-5 py-5 sm:px-7">
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

            <div className="grid gap-4 xl:grid-cols-2">
              <SalesSummaryCard operations={operations} />
              <PlanStorefrontCard operations={operations} store={store} />
            </div>

            <AdminStoreControls
              onRefresh={() => loadStore()}
              operations={operations}
              store={store}
            />

            <div className="grid gap-4 xl:grid-cols-2">
              <OrderSummaryCard operations={operations} />
              <AdminCard>
                <SectionHeader
                  description="Recent platform-admin actions for this store."
                  title="Admin Activity"
                />
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
      <div className="grid gap-5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl font-bold text-stone-950">
                {store.store_name}
              </h2>
              <AdminStatusBadge value={store.store_status} />
            </div>
            <p className="mt-1 text-sm font-semibold text-stone-500">
              /store/{store.store_slug}
            </p>
            <p className="mt-2 text-sm text-stone-700">
              <span className="font-bold">Owner:</span>{" "}
              {store.owner_email ?? "Email not available"}
            </p>
            <p className="mt-1 text-xs font-semibold text-stone-500">
              Joined {formatDate(store.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="seller-small-button"
              href={`/store/${store.store_slug}`}
              target="_blank"
            >
              Public Storefront
            </Link>
            <AdminCopyButton label="Copy Store ID" value={store.store_id} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DetailField copy label="Store ID" value={store.store_id} />
          <DetailField
            copy
            label="Owner User ID"
            value={store.owner_user_id}
          />
          <DetailField
            copy={Boolean(store.owner_email)}
            label="Owner Email"
            value={store.owner_email ?? "Not available"}
          />
          <DetailField copy label="Store Slug" value={store.store_slug} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusField label="Store Status" value={store.store_status} />
          <StatusField
            label="Storefront Enabled"
            value={store.storefront_enabled ? "Enabled" : "Disabled"}
          />
          <StatusField label="Storefront Mode" value={store.storefront_mode} />
          <StatusField
            label="Admin Hold"
            value={store.admin_hold_reason ? "On hold" : "Not on hold"}
          />
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
      <SectionHeader
        description="All-time seller order activity."
        title="Sales Summary"
      />
      <div className="grid gap-3 px-5 sm:grid-cols-3">
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
      <div className="px-5 pb-5 pt-4 text-xs leading-5 text-stone-500">
        <p>
          Sales include seller orders across all categories and do not include
          FlockFront subscription fees.
        </p>
        <p>
          Matches seller Reports: non-canceled order totals are recorded
          regardless of payment status; refunds are not subtracted.
        </p>
      </div>
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
  const plan = getPlanCapabilities(operations.plan_key);
  const configuredPrice =
    operations.billing_plan === "yearly" && plan.yearlyPrice !== null
      ? `${formatMoney(plan.yearlyPrice)} / year`
      : operations.billing_plan === "monthly"
        ? `${formatMoney(plan.monthlyPrice)} / month`
        : null;

  return (
    <AdminCard>
      <SectionHeader
        description="Current effective plan and public storefront state."
        title="Plan & Storefront"
      />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
        <SummaryMetric
          icon="/glyphs/shopping-bag.png"
          label="Current Plan"
          value={plan.displayName}
        >
          {configuredPrice ? (
            <p className="mt-1 text-xs font-semibold text-stone-500">
              Configured {configuredPrice}
            </p>
          ) : null}
        </SummaryMetric>
        <SummaryMetric
          icon="/glyphs/storefront.png"
          label="Storefront"
          value={store.storefront_enabled ? "Enabled" : "Disabled"}
        >
          <p className="mt-1 text-xs font-semibold capitalize text-stone-500">
            {store.storefront_mode}
          </p>
        </SummaryMetric>
      </div>
    </AdminCard>
  );
}

function OrderSummaryCard({
  operations,
}: {
  operations: AdminStoreOperationsSummaryRow;
}) {
  return (
    <AdminCard>
      <SectionHeader
        description="Compact lifecycle counts for support."
        title="Order Summary"
      />
      <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4">
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
    <AdminCard>
      <SectionHeader
        description="Existing support-safe store and module counts."
        title="Store Data"
      />
      <div className="grid gap-3 px-5 sm:grid-cols-2 xl:grid-cols-6">
        <AdminMetric label="Sale groups" value={store.listing_batch_count} />
        <AdminMetric
          label="Inventory rows"
          value={store.inventory_item_count}
        />
        <AdminMetric
          label="Available birds"
          value={store.total_inventory_quantity}
        />
        <AdminMetric label="Customers" value={store.customer_count} />
        <AdminMetric
          label="Equipment items"
          value={store.equipment_item_count}
        />
        <AdminMetric
          label="Poultry products"
          value={store.processed_poultry_item_count}
        />
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-3">
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
    </AdminCard>
  );
}

function DetailField({
  copy = false,
  label,
  value,
}: {
  copy?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-xs font-semibold text-stone-800">
          {value}
        </code>
        {copy ? <AdminCopyButton value={value} /> : null}
      </div>
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
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      <AdminStatusBadge value={value} />
    </div>
  );
}

function SectionHeader({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="px-5 pb-4 pt-5">
      <h2 className="text-lg font-bold text-stone-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">{description}</p>
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
    <div className="flex min-w-0 items-center gap-3 rounded-lg bg-[#f7faf8] p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e4f2ec]">
        <Image alt="" height={24} src={icon} width={24} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-stone-500">{label}</p>
        <p className="mt-0.5 truncate text-lg font-bold text-stone-950">
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
    <div className="rounded-lg border border-stone-200 bg-[#fbfcfb] p-3">
      <p className="text-xl font-bold text-stone-950">{value}</p>
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

function RecentActivityList({ activity }: { activity: AdminActivityRow[] }) {
  if (activity.length === 0) {
    return (
      <p className="border-t border-stone-100 px-5 py-4 text-sm font-semibold text-stone-500">
        No recent admin activity found.
      </p>
    );
  }

  return (
    <div className="grid gap-0 border-t border-stone-100">
      {activity.map((event) => {
        const change = formatActivityChange(event.metadata);

        return (
          <div
            className="border-b border-stone-100 p-4 last:border-0"
            key={event.admin_activity_event_id}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-bold text-stone-950">
                  {formatAdminAction(event.action_type)}
                </p>
                {event.reason ? (
                  <p className="mt-1 text-sm leading-6 text-stone-600">
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
              <p className="mt-2 truncate text-xs font-semibold text-stone-500">
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
