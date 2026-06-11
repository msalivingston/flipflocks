"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AdminStoreListRow } from "../_lib/admin-types";
import {
  AdminAccessState,
  AdminCard,
  AdminCopyButton,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminStatusBadge,
  isAdminAuthorizationError,
} from "./admin-ui";

export function AdminStoresList() {
  const [stores, setStores] = useState<AdminStoreListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadStores() {
      setIsLoading(true);
      setError(null);

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (userError || !userData.user) {
        setError("Sign in with a platform admin account to view this area.");
        setIsLoading(false);
        return;
      }

      const { data, error: storesError } = await supabase.rpc(
        "admin_platform_store_list",
      );

      if (!isMounted) return;

      if (storesError) {
        setError(storesError.message);
        setIsLoading(false);
        return;
      }

      setStores((data ?? []) as AdminStoreListRow[]);
      setIsLoading(false);
    }

    void loadStores();

    return () => {
      isMounted = false;
    };
  }, []);

  const totals = useMemo(
    () => ({
      live: stores.filter((store) => store.store_status === "live").length,
      total: stores.length,
      visible: stores.filter((store) => store.storefront_enabled).length,
    }),
    [stores],
  );

  return (
    <>
      <AdminPageHeader
        eyebrow="Platform Admin"
        title="Stores"
        description="Read-only support view of seller stores."
      />

      <div className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 sm:px-7">
        {isLoading ? <AdminLoadingState label="Loading stores" /> : null}

        {!isLoading && error ? (
          isAdminAuthorizationError(error) ? (
            <AdminAccessState message={error} />
          ) : (
            <AdminErrorState message={error} />
          )
        ) : null}

        {!isLoading && !error ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryCard label="Total Stores" value={totals.total} />
              <SummaryCard label="Live Stores" value={totals.live} />
              <SummaryCard label="Storefronts On" value={totals.visible} />
            </div>

            <AdminCard>
              <div className="grid divide-y divide-stone-100 lg:hidden">
                {stores.map((store) => (
                  <MobileStoreRow key={store.store_id} store={store} />
                ))}
              </div>

              <div className="hidden overflow-hidden lg:block">
                <table className="w-full table-fixed border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
                      <th className="w-[24%] px-3 py-3 sm:px-4">Store</th>
                      <th className="w-[15%] px-3 py-3 sm:px-4">Owner</th>
                      <th className="w-[13%] px-3 py-3 sm:px-4">Status</th>
                      <th className="w-[14%] px-3 py-3 sm:px-4">Storefront</th>
                      <th className="w-[14%] px-3 py-3 sm:px-4">Modules</th>
                      <th className="w-[11%] px-3 py-3 sm:px-4">Orders</th>
                      <th className="w-[9%] px-3 py-3 sm:px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stores.map((store) => (
                      <tr
                        className="border-b border-stone-100 align-top last:border-0"
                        key={store.store_id}
                      >
                        <td className="px-3 py-4 sm:px-4">
                          <Link
                            className="block truncate font-bold text-stone-950 hover:text-emerald-900"
                            href={`/admin/stores/${store.store_id}`}
                          >
                            {store.store_name}
                          </Link>
                          <p className="mt-1 truncate text-xs font-semibold text-stone-500">
                            /store/{store.store_slug}
                          </p>
                        </td>
                        <td className="px-3 py-4 sm:px-4">
                          <div className="grid max-w-full gap-2">
                            <code
                              className="truncate rounded bg-stone-100 px-2 py-1 text-xs text-stone-700"
                              title={store.owner_user_id}
                            >
                              {shortId(store.owner_user_id)}
                            </code>
                            <AdminCopyButton
                              label="Copy ID"
                              value={store.owner_user_id}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-4 sm:px-4">
                          <AdminStatusBadge value={store.store_status} />
                          {store.admin_hold_reason ? (
                            <p className="mt-2 max-w-52 text-xs font-semibold text-red-700">
                              Hold: {store.admin_hold_reason}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-4 sm:px-4">
                          <div className="grid gap-2">
                            <AdminStatusBadge value={store.storefront_enabled} />
                            <span className="text-xs font-semibold capitalize text-stone-600">
                              {store.storefront_mode}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-4 sm:px-4">
                          <ModuleSummary store={store} />
                        </td>
                        <td className="px-3 py-4 sm:px-4">
                          <p className="font-semibold text-stone-950">
                            {store.open_order_count} open
                          </p>
                          <p className="mt-1 text-xs text-stone-500">
                            {store.fulfilled_order_count} done
                          </p>
                          <p className="text-xs text-stone-500">
                            {store.canceled_order_count} canceled
                          </p>
                        </td>
                        <td className="px-3 py-4 sm:px-4">
                          <div className="grid gap-2">
                            <Link
                              className="seller-small-button justify-center"
                              href={`/admin/stores/${store.store_id}`}
                            >
                              Detail
                            </Link>
                            <Link
                              className="seller-small-button justify-center"
                              href={`/store/${store.store_slug}`}
                              target="_blank"
                            >
                              Public
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          </>
        ) : null}
      </div>
    </>
  );
}

function MobileStoreRow({ store }: { store: AdminStoreListRow }) {
  return (
    <article className="grid gap-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            className="block truncate font-bold text-stone-950 hover:text-emerald-900"
            href={`/admin/stores/${store.store_id}`}
          >
            {store.store_name}
          </Link>
          <p className="mt-1 truncate text-xs font-semibold text-stone-500">
            /store/{store.store_slug}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            className="seller-small-button"
            href={`/admin/stores/${store.store_id}`}
          >
            Detail
          </Link>
          <Link
            className="seller-small-button"
            href={`/store/${store.store_slug}`}
            target="_blank"
          >
            Public
          </Link>
        </div>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <MobileFact label="Status">
          <AdminStatusBadge value={store.store_status} />
        </MobileFact>
        <MobileFact label="Storefront">
          <div className="flex flex-wrap items-center gap-2">
            <AdminStatusBadge value={store.storefront_enabled} />
            <span className="text-xs font-semibold capitalize text-stone-600">
              {store.storefront_mode}
            </span>
          </div>
        </MobileFact>
        <MobileFact label="Owner">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-stone-100 px-2 py-1 text-xs text-stone-700">
              {shortId(store.owner_user_id)}
            </code>
            <AdminCopyButton label="Copy ID" value={store.owner_user_id} />
          </div>
        </MobileFact>
        <MobileFact label="Orders">
          <p className="font-semibold text-stone-950">
            {store.open_order_count} open
          </p>
          <p className="text-xs text-stone-500">
            {store.fulfilled_order_count} done, {store.canceled_order_count}{" "}
            canceled
          </p>
        </MobileFact>
      </div>

      <ModuleSummary store={store} />
    </article>
  );
}

function MobileFact({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      {children}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-stone-950">{value}</p>
    </div>
  );
}

function shortId(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function ModuleSummary({ store }: { store: AdminStoreListRow }) {
  const modules = [
    ["Eggs", store.hatching_eggs_enabled],
    ["Equipment", store.equipment_supplies_enabled],
    ["Processed", store.processed_poultry_enabled],
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {modules.map(([label, enabled]) => (
        <span
          className={`rounded-full px-2 py-1 text-xs font-bold ${
            enabled
              ? "bg-emerald-50 text-emerald-800"
              : "bg-stone-100 text-stone-500"
          }`}
          key={label as string}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
