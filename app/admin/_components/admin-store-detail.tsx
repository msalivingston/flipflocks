"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  AdminActivityRow,
  AdminRecentOrderRow,
  AdminStoreDetailRow,
} from "../_lib/admin-types";
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
  const [activity, setActivity] = useState<AdminActivityRow[]>([]);
  const [orders, setOrders] = useState<AdminRecentOrderRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadStore() {
      setIsLoading(true);
      setError(null);

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (userError || !userData.user) {
        setError("Sign in with a platform admin account to view this area.");
        setIsLoading(false);
        return;
      }

      const [detailResult, activityResult, ordersResult] = await Promise.all([
        supabase.rpc("admin_platform_store_detail", {
          p_store_id: storeId,
        }),
        supabase.rpc("admin_platform_store_recent_activity", {
          p_limit: 10,
          p_store_id: storeId,
        }),
        supabase.rpc("admin_platform_store_recent_orders", {
          p_limit: 10,
          p_store_id: storeId,
        }),
      ]);

      if (!isMounted) return;

      const firstError =
        detailResult.error ?? activityResult.error ?? ordersResult.error;

      if (firstError) {
        setError(firstError.message);
        setIsLoading(false);
        return;
      }

      const detailRows = (detailResult.data ?? []) as AdminStoreDetailRow[];
      setStore(detailRows[0] ?? null);
      setActivity((activityResult.data ?? []) as AdminActivityRow[]);
      setOrders((ordersResult.data ?? []) as AdminRecentOrderRow[]);
      setIsLoading(false);
    }

    void loadStore();

    return () => {
      isMounted = false;
    };
  }, [storeId]);

  return (
    <>
      <AdminPageHeader
        eyebrow="Platform Admin"
        title={store?.store_name ?? "Store Detail"}
        description="Read-only operational context for platform support. Seller dashboard links are references only and do not impersonate the seller."
        action={
          <Link className="seller-secondary-button" href="/admin/stores">
            Back to Stores
          </Link>
        }
      />

      <div className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 sm:px-7">
        {isLoading ? <AdminLoadingState label="Loading store detail" /> : null}

        {!isLoading && error ? (
          isAdminAuthorizationError(error) ? (
            <AdminAccessState message={error} />
          ) : (
            <AdminErrorState message={error} />
          )
        ) : null}

        {!isLoading && !error && !store ? (
          <AdminErrorState
            message="No store was returned for this admin detail request."
            title="Store not found"
          />
        ) : null}

        {!isLoading && !error && store ? (
          <>
            <AdminCard>
              <div className="grid gap-5 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-stone-950">
                      {store.store_name}
                    </h2>
                    <p className="mt-1 text-sm font-semibold text-stone-500">
                      /store/{store.store_slug}
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
                  <DetailField label="Store ID" value={store.store_id} copy />
                  <DetailField label="Owner User ID" value={store.owner_user_id} copy />
                  <DetailField
                    label="Owner Email"
                    value={store.owner_email ?? "Not available"}
                    copy={Boolean(store.owner_email)}
                  />
                  <DetailField label="Store Slug" value={store.store_slug} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatusField label="Store Status" value={store.store_status} />
                  <StatusField
                    label="Storefront Enabled"
                    value={store.storefront_enabled}
                  />
                  <StatusField label="Storefront Mode" value={store.storefront_mode} />
                  <StatusField
                    label="Admin Hold"
                    value={store.admin_hold_reason ?? "None"}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <StatusField
                    label="Hatching Eggs"
                    value={store.hatching_eggs_enabled}
                  />
                  <StatusField
                    label="Equipment / Supplies"
                    value={store.equipment_supplies_enabled}
                  />
                  <StatusField
                    label="Processed Poultry"
                    value={store.processed_poultry_enabled}
                  />
                </div>
              </div>
            </AdminCard>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <AdminMetric label="Listings" value={store.listing_batch_count} />
              <AdminMetric label="Bird Rows" value={store.inventory_item_count} />
              <AdminMetric
                label="Bird Qty"
                value={store.total_inventory_quantity}
              />
              <AdminMetric label="Customers" value={store.customer_count} />
              <AdminMetric label="Equipment" value={store.equipment_item_count} />
              <AdminMetric
                label="Processed"
                value={store.processed_poultry_item_count}
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <AdminCard>
                <SectionHeader
                  title="Order Summary"
                  description={`${store.open_order_count} open, ${store.fulfilled_order_count} fulfilled, ${store.canceled_order_count} canceled.`}
                />
                <RecentOrdersTable orders={orders} />
              </AdminCard>

              <AdminCard>
                <SectionHeader
                  title="Admin Activity"
                  description="Recent audited platform admin events for this store."
                />
                <RecentActivityList activity={activity} />
              </AdminCard>
            </div>

            <AdminCard>
              <SectionHeader
                title="Reference Links"
                description="These links open normal seller-facing routes as your current account. They are not impersonation and may not show seller data unless your account is authorized by existing checks."
              />
              <div className="flex flex-wrap gap-2 p-5 pt-0">
                <ReferenceLink href="/dashboard" label="Seller Dashboard Home" />
                <ReferenceLink
                  href="/dashboard/store-admin"
                  label="Seller Store Admin"
                />
                <ReferenceLink href="/dashboard/orders" label="Seller Orders" />
                <ReferenceLink
                  href="/dashboard/inventory"
                  label="Seller Inventory"
                />
                <ReferenceLink href="/dashboard/breeds" label="Seller Breeds" />
              </div>
            </AdminCard>
          </>
        ) : null}
      </div>
    </>
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
    <div className="p-5">
      <h2 className="text-lg font-bold text-stone-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">{description}</p>
    </div>
  );
}

function RecentOrdersTable({ orders }: { orders: AdminRecentOrderRow[] }) {
  if (orders.length === 0) {
    return (
      <p className="border-t border-stone-100 px-5 py-4 text-sm font-semibold text-stone-500">
        No recent orders found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-stone-100">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="bg-stone-50 text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
            <th className="px-4 py-3">Order</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Buyer</th>
            <th className="px-4 py-3">Total</th>
            <th className="px-4 py-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr className="border-t border-stone-100" key={order.order_id}>
              <td className="px-4 py-3">
                <p className="font-bold text-stone-950">{order.order_number}</p>
                <p className="text-xs text-stone-500">
                  {order.item_count} items, {order.refund_count} refunds
                </p>
              </td>
              <td className="px-4 py-3">
                <AdminStatusBadge value={order.order_status} />
                <p className="mt-2 text-xs font-semibold text-stone-500">
                  {order.payment_method ?? "unknown"} /{" "}
                  {order.payment_status ?? "unknown"}
                </p>
              </td>
              <td className="px-4 py-3">
                <p className="max-w-48 truncate text-xs font-semibold text-stone-700">
                  {order.buyer_email_snapshot ?? "No email"}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {order.buyer_phone_snapshot ?? "No phone"}
                </p>
              </td>
              <td className="px-4 py-3 font-bold text-stone-950">
                {formatMoney(order.total_amount)}
              </td>
              <td className="px-4 py-3 text-xs font-semibold text-stone-500">
                {formatDateTime(order.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      {activity.map((event) => (
        <div className="border-b border-stone-100 p-4 last:border-0" key={event.admin_activity_event_id}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-bold text-stone-950">
                {event.action_type.replaceAll("_", " ")}
              </p>
              {event.reason ? (
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  {event.reason}
                </p>
              ) : null}
            </div>
            <p className="text-xs font-semibold text-stone-500">
              {formatDateTime(event.created_at)}
            </p>
          </div>
          {event.actor_user_id ? (
            <p className="mt-2 truncate text-xs font-semibold text-stone-500">
              Actor: {event.actor_user_id}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ReferenceLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="seller-small-button" href={href} target="_blank">
      {label}
    </Link>
  );
}
