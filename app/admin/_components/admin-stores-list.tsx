"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AdminStoreListRow } from "../_lib/admin-types";
import {
  AdminAccessState,
  AdminCard,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminStatusBadge,
  isAdminAuthorizationError,
} from "./admin-ui";

export function AdminStoresList() {
  const [stores, setStores] = useState<AdminStoreListRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
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
  const filteredStores = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return stores;

    return stores.filter((store) =>
      [store.store_name, store.store_slug, store.owner_email]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }, [searchQuery, stores]);

  return (
    <>
      <AdminPageHeader
        eyebrow="Platform Admin"
        title="Stores"
        description="View seller stores and open operational controls."
      />

      <div className="mx-auto grid w-full max-w-7xl gap-4 px-5 py-5 sm:px-7">
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
            <div className="grid gap-2.5 sm:grid-cols-3">
              <SummaryCard
                icon="/glyphs/storefront.png"
                label="Total Stores"
                value={totals.total}
              />
              <SummaryCard
                icon="/glyphs/reports.png"
                label="Live Stores"
                value={totals.live}
              />
              <SummaryCard
                icon="/glyphs/storefront.png"
                label="Storefronts On"
                value={totals.visible}
              />
            </div>

            <StoreSearch
              onChange={setSearchQuery}
              resultCount={filteredStores.length}
              totalCount={stores.length}
              value={searchQuery}
            />

            <AdminCard>
              {filteredStores.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="font-bold text-stone-900">No accounts found</p>
                  <p className="mt-1 text-sm text-stone-500">
                    Try a different store name or owner email.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid divide-y divide-stone-100 xl:hidden">
                    {filteredStores.map((store) => (
                      <MobileStoreRow key={store.store_id} store={store} />
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto xl:block">
                    <table className="w-full min-w-[1060px] table-fixed border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-stone-200 bg-stone-50 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-stone-500">
                          <th className="w-[17%] px-3 py-2.5">Store</th>
                          <th className="w-[17%] px-3 py-2.5">Owner</th>
                          <th className="w-[9%] px-3 py-2.5">Plan</th>
                          <th className="w-[14%] px-3 py-2.5">Store State</th>
                          <th className="w-[14%] px-3 py-2.5">Modules</th>
                          <th className="w-[10%] px-3 py-2.5">Orders</th>
                          <th className="w-[10%] px-3 py-2.5">Admin Hold</th>
                          <th className="w-[9%] px-3 py-2.5">Open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStores.map((store) => (
                          <tr
                            className="border-b border-stone-100 align-middle last:border-0"
                            key={store.store_id}
                          >
                            <td className="px-3 py-3">
                              <StoreIdentity store={store} />
                            </td>
                            <td className="px-3 py-3">
                              <OwnerIdentity store={store} />
                            </td>
                            <td className="px-3 py-3">
                              <PlanSummary />
                            </td>
                            <td className="px-3 py-3">
                              <StoreState store={store} />
                            </td>
                            <td className="px-3 py-3">
                              <ModuleSummary store={store} />
                            </td>
                            <td className="px-3 py-3">
                              <OrderSummary store={store} />
                            </td>
                            <td className="px-3 py-3">
                              <HoldSummary store={store} />
                            </td>
                            <td className="px-3 py-3">
                              <OpenButton store={store} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </AdminCard>
          </>
        ) : null}
      </div>
    </>
  );
}

function StoreSearch({
  onChange,
  resultCount,
  totalCount,
  value,
}: {
  onChange: (value: string) => void;
  resultCount: number;
  totalCount: number;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <label className="relative block w-full sm:max-w-md">
        <span className="sr-only">Search accounts</span>
        <Image
          alt=""
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60"
          height={18}
          src="/glyphs/looking-glass.png"
          width={18}
        />
        <input
          className="min-h-10 w-full rounded-lg border border-stone-300 bg-white py-2 pl-10 pr-3 text-sm text-stone-900 shadow-sm outline-none placeholder:text-stone-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search by store name or owner email"
          type="search"
          value={value}
        />
      </label>
      {value.trim() ? (
        <p className="shrink-0 text-xs font-semibold text-stone-500" aria-live="polite">
          {resultCount} of {totalCount} accounts
        </p>
      ) : null}
    </div>
  );
}

function MobileStoreRow({ store }: { store: AdminStoreListRow }) {
  return (
    <article className="grid gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <StoreIdentity store={store} />
        <OpenButton store={store} />
      </div>
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <MobileFact label="Owner">
          <OwnerIdentity store={store} />
        </MobileFact>
        <MobileFact label="Plan">
          <PlanSummary />
        </MobileFact>
        <MobileFact label="Store State">
          <StoreState store={store} />
        </MobileFact>
        <MobileFact label="Modules">
          <ModuleSummary store={store} />
        </MobileFact>
        <MobileFact label="Orders">
          <OrderSummary store={store} />
        </MobileFact>
        <MobileFact label="Admin Hold">
          <HoldSummary store={store} />
        </MobileFact>
      </div>
    </article>
  );
}

function StoreIdentity({ store }: { store: AdminStoreListRow }) {
  return (
    <div className="min-w-0">
      <Link
        className="block truncate font-bold text-stone-950 hover:text-emerald-900"
        href={`/admin/stores/${store.store_id}`}
      >
        {store.store_name}
      </Link>
      <p className="mt-0.5 truncate text-xs text-stone-500">
        /store/{store.store_slug}
      </p>
    </div>
  );
}

function OwnerIdentity({ store }: { store: AdminStoreListRow }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-stone-700" title={store.owner_email ?? ""}>
        {store.owner_email ?? "Email not available"}
      </p>
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <code
          className="truncate rounded bg-stone-100 px-2 py-1 text-[0.68rem] text-stone-600"
          title={store.owner_user_id}
        >
          {shortId(store.owner_user_id)}
        </code>
        <CopyIconButton value={store.owner_user_id} />
      </div>
    </div>
  );
}

function PlanSummary() {
  return (
    <div>
      <span className="inline-flex rounded-full bg-stone-100 px-2 py-1 text-xs font-bold text-stone-600">
        —
      </span>
      <p className="mt-1 text-xs text-stone-500">Not in list data</p>
    </div>
  );
}

function StoreState({ store }: { store: AdminStoreListRow }) {
  return (
    <div>
      <AdminStatusBadge value={store.store_status} />
      <p className="mt-1.5 text-xs text-stone-600">
        Storefront: {store.storefront_enabled ? "On" : "Off"}
      </p>
      <p className="mt-0.5 text-xs capitalize text-stone-500">
        {store.storefront_mode}
      </p>
    </div>
  );
}

function OrderSummary({ store }: { store: AdminStoreListRow }) {
  return (
    <div>
      <p className="font-bold text-stone-950">{store.open_order_count} open</p>
      <p className="mt-1 text-xs text-stone-500">
        {store.fulfilled_order_count} done
      </p>
      <p className="text-xs text-stone-500">
        {store.canceled_order_count} canceled
      </p>
    </div>
  );
}

function HoldSummary({ store }: { store: AdminStoreListRow }) {
  const isOnHold = Boolean(store.admin_hold_reason);
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ring-1 ${
        isOnHold
          ? "bg-amber-50 text-amber-800 ring-amber-200"
          : "bg-stone-100 text-stone-600 ring-stone-200"
      }`}
      title={store.admin_hold_reason ?? undefined}
    >
      {isOnHold ? "Yes" : "No"}
    </span>
  );
}

function OpenButton({ store }: { store: AdminStoreListRow }) {
  return (
    <Link
      className="seller-small-button shrink-0 gap-2 px-3"
      href={`/admin/stores/${store.store_id}`}
    >
      Open <span aria-hidden="true">›</span>
    </Link>
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
    <div className="min-w-0">
      <p className="mb-1.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      {children}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3.5 py-3 shadow-sm">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50">
        <Image alt="" height={20} src={icon} width={20} />
      </span>
      <div>
        <p className="text-xs font-semibold text-stone-500">{label}</p>
        <p className="mt-0.5 text-xl font-bold leading-none text-stone-950">
          {value}
        </p>
      </div>
    </div>
  );
}

function CopyIconButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      aria-label={copied ? "Owner ID copied" : "Copy owner ID"}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-100 hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      onClick={copyValue}
      title={copied ? "Copied" : "Copy owner ID"}
      type="button"
    >
      <Image alt="" height={15} src="/glyphs/clipboard.png" width={15} />
    </button>
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
  ].filter(([, enabled]) => enabled);

  if (modules.length === 0) {
    return <span className="text-xs text-stone-500">None</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {modules.map(([label]) => (
        <span
          className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800"
          key={label as string}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
