"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  FilterControl,
  LoadingState,
  PrimaryActionLink,
  SellerCard,
  SellerPageHeader,
  SellerTabs,
  StatusBadge,
} from "../_components/seller-ui";
import type { SellerInventoryManagementRow } from "../_lib/seller-types";

type ListingView = "listing" | "breed";

type ListingStatusFilter =
  | "current"
  | "all"
  | "active"
  | "hidden"
  | "sold_out"
  | "archived";

type AvailabilityFilter =
  | "all"
  | "ready_now"
  | "reserve_now"
  | "sold_out"
  | "hidden"
  | "unavailable"
  | "archived";

type ListingBatchSummary = {
  id: string;
  title: string;
  speciesName: string;
  internalLabel: string | null;
  originDate: string | null;
  availableDate: string;
  basePrice: number | null;
  visibilityStatus: string;
  moderationStatus: string;
  availabilityStatus: string;
  totalAvailable: number;
  breedCount: number;
  rowCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  inventoryTypes: string[];
  updatedAt: string | null;
  rows: SellerInventoryManagementRow[];
};

type BreedSummary = {
  id: string;
  breedName: string;
  speciesName: string;
  totalAvailable: number;
  listingCount: number;
  rowCount: number;
  nextAvailableDate: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  availabilityStatus: string;
  rows: SellerInventoryManagementRow[];
};

type LifecycleCounts = Record<ListingStatusFilter, number>;

const addInventoryHref = "/dashboard/inventory/add-v2/live-birds";

const lifecycleFilterOptions: { label: string; value: ListingStatusFilter }[] = [
  { label: "Current", value: "current" },
  { label: "Live", value: "active" },
  { label: "Hidden", value: "hidden" },
  { label: "Sold Out", value: "sold_out" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" },
];

const availabilityOptions: { label: string; value: AvailabilityFilter }[] = [
  { label: "All availability", value: "all" },
  { label: "Ready now", value: "ready_now" },
  { label: "Reserve now", value: "reserve_now" },
  { label: "Sold Out", value: "sold_out" },
  { label: "Hidden", value: "hidden" },
  { label: "Unavailable", value: "unavailable" },
  { label: "Archived", value: "archived" },
];

const inventorySelect =
  "store_id, listing_batch_id, listing_batch_breed_id, inventory_item_id, species_id, species_name, species_slug, seller_breed_profile_id, breed_display_name, batch_type, origin_date, available_date, age_at_availability_days, base_price, auto_price_increase_enabled, auto_price_increase_amount, auto_price_increase_max_price, auto_price_adjustment_enabled, price_adjustment_direction, price_adjustment_amount, price_adjustment_interval_weeks, price_adjustment_max_price, price_adjustment_min_price, internal_batch_label, listing_batch_visibility_status, listing_batch_moderation_status, listing_batch_breed_sort_order, listing_batch_breed_visibility_status, listing_batch_breed_moderation_status, inventory_type, custom_inventory_label, quantity_available, price_override, effective_unit_price, inventory_item_sort_order, inventory_visibility_status, inventory_moderation_status, operational_availability_status, inventory_seller_notes, listing_batch_breed_seller_notes, listing_batch_seller_notes, inventory_updated_at, listing_batch_updated_at";

/**
 * Seller listings foundation page.
 *
 * Security assumption: seller-private inventory rows come from
 * `seller_inventory_management`, which is store-owner scoped by RLS/security
 * barrier rules. The UI still filters by the active store ID from
 * `get_seller_context()` so the request matches the currently bootstrapped
 * seller workspace.
 */
export function ListingsFoundation() {
  const { seller } = useSellerContext();
  const [rows, setRows] = useState<SellerInventoryManagementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ListingView>("listing");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<ListingStatusFilter>("current");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<AvailabilityFilter>("all");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadListings() {
      if (!seller) return;

      setIsLoading(true);
      setError(null);

      const { data, error: listingError } = await supabase
        .from("seller_inventory_management")
        .select(inventorySelect)
        .eq("store_id", seller.store_id)
        .order("listing_batch_updated_at", { ascending: false })
        .order("listing_batch_breed_sort_order", { ascending: true })
        .order("inventory_item_sort_order", { ascending: true })
        .returns<SellerInventoryManagementRow[]>();

      if (!isMounted) return;

      if (listingError) {
        setError(listingError.message);
        setIsLoading(false);
        return;
      }

      setRows(data ?? []);
      setIsLoading(false);
    }

    void loadListings();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  useEffect(() => {
    const message = window.sessionStorage.getItem(
      "flipflocksListingCreatedMessage",
    );

    if (!message) return;

    window.sessionStorage.removeItem("flipflocksListingCreatedMessage");
    window.setTimeout(() => setSuccessMessage(message), 0);
  }, []);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        matchesFilters(row, search, statusFilter, availabilityFilter),
      ),
    [rows, search, statusFilter, availabilityFilter],
  );

  const allListingSummaries = useMemo(() => summarizeByListing(rows), [rows]);

  const lifecycleCounts = useMemo(
    () => countLifecycleStates(allListingSummaries),
    [allListingSummaries],
  );

  const listingSummaries = useMemo(
    () => summarizeByListing(filteredRows),
    [filteredRows],
  );

  const breedSummaries = useMemo(
    () => summarizeByBreed(filteredRows),
    [filteredRows],
  );

  const hasFilters =
    search.trim() !== "" ||
    statusFilter !== "current" ||
    availabilityFilter !== "all";

  return (
    <>
      <SellerPageHeader
        eyebrow={seller?.store_name}
        title="Listings"
        description="Manage your available birds by hatch group or by breed, with prices, quantities, and storefront status in one place."
        action={
          <PrimaryActionLink href={addInventoryHref}>
            Create Listing
          </PrimaryActionLink>
        }
      />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-5 sm:px-7">
        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-semibold">{successMessage}</p>
              <button
                className="seller-small-button"
                onClick={() => setSuccessMessage(null)}
                type="button"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <SellerCard className="p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-col gap-3">
              <SellerTabs<ListingView>
                value={view}
                tabs={[
                  { label: "By Listing / Batch", value: "listing" },
                  { label: "By Breed", value: "breed" },
                ]}
                onChange={setView}
              />
              <p className="text-sm text-stone-600">
                {allListingSummaries.length} listing
                {allListingSummaries.length === 1 ? "" : "s"} and{" "}
                {rows.length} inventory row{rows.length === 1 ? "" : "s"} ready
                to review.
              </p>
              <LifecycleFilterChips
                counts={lifecycleCounts}
                value={statusFilter}
                onChange={setStatusFilter}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_190px] xl:w-[520px]">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Search listings
                <input
                  className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Breed, species, label, bird type"
                  type="search"
                />
              </label>
              <FilterControl
                label="Availability"
                value={availabilityFilter}
                options={availabilityOptions}
                onChange={(value) =>
                  setAvailabilityFilter(value as AvailabilityFilter)
                }
              />
            </div>
          </div>
        </SellerCard>

        {isLoading ? <LoadingState label="Loading listings" /> : null}

        {error ? (
          <ErrorState
            title="Listings could not load"
            message={error}
            action={
              <button
                className="seller-secondary-button"
                onClick={() => window.location.reload()}
              >
                Reload listings
              </button>
            }
          />
        ) : null}

        {!isLoading && !error ? (
          <ListingsContent
            view={view}
            listingSummaries={listingSummaries}
            breedSummaries={breedSummaries}
            hasFilters={hasFilters}
          />
        ) : null}
      </div>
    </>
  );
}

function ListingsContent({
  view,
  listingSummaries,
  breedSummaries,
  hasFilters,
}: {
  view: ListingView;
  listingSummaries: ListingBatchSummary[];
  breedSummaries: BreedSummary[];
  hasFilters: boolean;
}) {
  if (view === "listing") {
    if (listingSummaries.length === 0) {
      return <ListingsEmptyState hasFilters={hasFilters} />;
    }

    return (
      <>
        <div className="grid gap-4 lg:hidden">
          {listingSummaries.map((listing) => (
            <ListingBatchCard key={listing.id} listing={listing} />
          ))}
        </div>
        <SellerCard className="hidden overflow-hidden lg:block">
          <ListingBatchTable listings={listingSummaries} />
        </SellerCard>
      </>
    );
  }

  if (breedSummaries.length === 0) {
    return <ListingsEmptyState hasFilters={hasFilters} />;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {breedSummaries.map((breed) => (
        <BreedCard key={breed.id} breed={breed} />
      ))}
    </div>
  );
}

function ListingsEmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <EmptyState
      title={hasFilters ? "No listings match those filters" : "No listings yet"}
      description={
        hasFilters
          ? "Try a different breed, lifecycle, or availability filter."
          : "Create your first bird listing when you are ready to publish availability for your flock."
      }
      action={
        hasFilters ? null : (
          <PrimaryActionLink href={addInventoryHref}>
            Create Listing
          </PrimaryActionLink>
        )
      }
    />
  );
}

function ListingBatchCard({ listing }: { listing: ListingBatchSummary }) {
  const lifecycleStatus = getDerivedLifecycleStatus(listing);

  return (
    <SellerCard
      className={`p-4 ${
        lifecycleStatus === "archived" ? "bg-stone-50" : ""
      }`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-stone-950">
              {listing.title}
            </h2>
            {listing.internalLabel ? (
              <p className="mt-1 text-sm text-stone-600">
                {listing.internalLabel}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <LifecycleBadge status={lifecycleStatus} />
            {shouldShowAvailabilityBadge(listing) ? (
              <StatusBadge status={listing.availabilityStatus} />
            ) : null}
          </div>
        </div>

        <p className="rounded-md bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700">
          {getLifecycleNextStep(listing)}
        </p>

        <ListingMetrics listing={listing} />

        <div className="grid gap-2 border-t border-stone-200 pt-3 text-sm text-stone-600">
          <p>
            Ready:{" "}
            <span className="font-semibold text-stone-950">
              {formatDate(listing.availableDate)}
            </span>
          </p>
          <p>
            Price:{" "}
            <span className="font-semibold text-stone-950">
              {formatPriceRange(listing.minPrice, listing.maxPrice)}
            </span>
          </p>
          <p>
            Types:{" "}
            <span className="font-semibold text-stone-950">
              {listing.inventoryTypes.join(", ")}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            className="seller-small-button"
            href={getPrimaryListingHref(listing)}
          >
            {lifecycleStatus === "hidden" ? "Continue Setup" : "View Details"}
          </Link>
          <Link className="seller-small-button" href={addInventoryHref}>
            Create similar
          </Link>
        </div>
      </div>
    </SellerCard>
  );
}

function ListingMetrics({ listing }: { listing: ListingBatchSummary }) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      <Metric label="Available" value={listing.totalAvailable.toString()} />
      <Metric label="Breeds" value={listing.breedCount.toString()} />
      <Metric label="Rows" value={listing.rowCount.toString()} />
    </dl>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-stone-50 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function ListingBatchTable({
  listings,
}: {
  listings: ListingBatchSummary[];
}) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        <tr>
          <th className="px-5 py-3">Listing</th>
          <th className="px-5 py-3">Ready</th>
          <th className="px-5 py-3">Available</th>
          <th className="px-5 py-3">Price</th>
          <th className="px-5 py-3">Lifecycle</th>
          <th className="px-5 py-3 text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-200 bg-white">
        {listings.map((listing) => {
          const lifecycleStatus = getDerivedLifecycleStatus(listing);

          return (
            <tr key={listing.id}>
              <td className="px-5 py-4 align-top">
                <Link
                  className="font-semibold text-stone-950 underline-offset-4 hover:underline"
                  href={getPrimaryListingHref(listing)}
                >
                  {listing.title}
                </Link>
                <p className="mt-1 text-stone-600">
                  {listing.breedCount} breed{listing.breedCount === 1 ? "" : "s"}{" "}
                  - {listing.rowCount} row{listing.rowCount === 1 ? "" : "s"}
                </p>
                {listing.internalLabel ? (
                  <p className="mt-1 text-xs font-semibold text-stone-500">
                    {listing.internalLabel}
                  </p>
                ) : null}
              </td>
              <td className="px-5 py-4 align-top text-stone-700">
                {formatDate(listing.availableDate)}
              </td>
              <td className="px-5 py-4 align-top font-semibold text-stone-950">
                {listing.totalAvailable}
              </td>
              <td className="px-5 py-4 align-top text-stone-700">
                {formatPriceRange(listing.minPrice, listing.maxPrice)}
              </td>
              <td className="px-5 py-4 align-top">
                <div className="flex flex-col items-start gap-2">
                  <LifecycleBadge status={lifecycleStatus} />
                  {shouldShowAvailabilityBadge(listing) ? (
                    <StatusBadge status={listing.availabilityStatus} />
                  ) : null}
                  <span className="text-xs text-stone-500">
                    {getLifecycleNextStep(listing)}
                  </span>
                </div>
              </td>
              <td className="px-5 py-4 text-right align-top">
                <div className="flex justify-end gap-2">
                  <Link
                    className="seller-small-button"
                    href={getPrimaryListingHref(listing)}
                  >
                    {lifecycleStatus === "hidden" ? "Continue Setup" : "Open"}
                  </Link>
                  <Link className="seller-small-button" href={addInventoryHref}>
                    Create similar
                  </Link>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BreedCard({ breed }: { breed: BreedSummary }) {
  const previewRows = breed.rows.slice(0, 3);

  return (
    <SellerCard className="p-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-stone-950">
              {breed.breedName}
            </h2>
            <p className="mt-1 text-sm text-stone-600">{breed.speciesName}</p>
          </div>
          <StatusBadge status={breed.availabilityStatus} />
        </div>

        <dl className="grid grid-cols-3 gap-2">
          <Metric label="Available" value={breed.totalAvailable.toString()} />
          <Metric label="Listings" value={breed.listingCount.toString()} />
          <Metric label="Groups" value={breed.rowCount.toString()} />
        </dl>

        <div className="grid gap-2 text-sm text-stone-600">
          <p>
            Next ready:{" "}
            <span className="font-semibold text-stone-950">
              {formatDate(breed.nextAvailableDate)}
            </span>
          </p>
          <p>
            Price:{" "}
            <span className="font-semibold text-stone-950">
              {formatPriceRange(breed.minPrice, breed.maxPrice)}
            </span>
          </p>
        </div>

        <div className="divide-y divide-stone-200 rounded-md border border-stone-200">
          {previewRows.map((row) => (
            <div
              key={row.inventory_item_id}
              className="grid gap-1 px-3 py-3 text-sm sm:grid-cols-[1fr_auto]"
            >
              <p className="font-semibold text-stone-950">
                {formatInventoryType(row)}
              </p>
              <p className="text-stone-600">
                {row.quantity_available ?? 0} available -{" "}
                {formatCurrency(row.effective_unit_price)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SellerCard>
  );
}

function matchesFilters(
  row: SellerInventoryManagementRow,
  search: string,
  statusFilter: ListingStatusFilter,
  availabilityFilter: AvailabilityFilter,
) {
  const haystack = [
    row.breed_display_name,
    row.species_name,
    row.internal_batch_label,
    row.inventory_type,
    row.custom_inventory_label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const searchTerm = search.trim().toLowerCase();
  const matchesSearch = searchTerm === "" || haystack.includes(searchTerm);
  const matchesStatus = matchesLifecycleFilter(
    getDerivedRowLifecycleStatus(row),
    statusFilter,
  );
  const matchesAvailability =
    availabilityFilter === "all" ||
    row.operational_availability_status === availabilityFilter;

  return matchesSearch && matchesStatus && matchesAvailability;
}

function LifecycleFilterChips({
  counts,
  onChange,
  value,
}: {
  counts: LifecycleCounts;
  onChange: (value: ListingStatusFilter) => void;
  value: ListingStatusFilter;
}) {
  return (
    <div
      aria-label="Filter listings by lifecycle"
      className="flex flex-wrap gap-2"
    >
      {lifecycleFilterOptions.map((option) => {
        const isActive = value === option.value;
        const count = counts[option.value] ?? 0;

        return (
          <button
            key={option.value}
            className={`min-h-9 rounded-full border px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 ${
              isActive
                ? "border-emerald-800 bg-emerald-800 text-white"
                : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
            }`}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}{" "}
            <span className={isActive ? "text-emerald-50" : "text-stone-500"}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LifecycleBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getLifecycleTone(
        status,
      )}`}
    >
      {formatLifecycleStatus(status)}
    </span>
  );
}

function summarizeByListing(rows: SellerInventoryManagementRow[]) {
  const summaries = new Map<string, ListingBatchSummary>();

  rows.forEach((row) => {
    const existing = summaries.get(row.listing_batch_id);
    const price = row.effective_unit_price;

    if (existing) {
      existing.totalAvailable += row.quantity_available ?? 0;
      existing.rowCount += 1;
      existing.rows.push(row);
      existing.minPrice = minNullable(existing.minPrice, price);
      existing.maxPrice = maxNullable(existing.maxPrice, price);
      existing.availabilityStatus = pickListingAvailabilityStatus(
        existing.availabilityStatus,
        row.operational_availability_status,
      );
      existing.inventoryTypes = uniqueSorted([
        ...existing.inventoryTypes,
        formatInventoryType(row),
      ]);
      existing.breedCount = new Set(
        existing.rows.map((item) => item.seller_breed_profile_id),
      ).size;
      return;
    }

    summaries.set(row.listing_batch_id, {
      id: row.listing_batch_id,
      title: buildListingTitle(row),
      speciesName: row.species_name,
      internalLabel: row.internal_batch_label,
      originDate: row.origin_date,
      availableDate: row.available_date,
      basePrice: row.base_price,
      visibilityStatus: row.listing_batch_visibility_status,
      moderationStatus: row.listing_batch_moderation_status,
      availabilityStatus: row.operational_availability_status,
      totalAvailable: row.quantity_available ?? 0,
      breedCount: 1,
      rowCount: 1,
      minPrice: price,
      maxPrice: price,
      inventoryTypes: [formatInventoryType(row)],
      updatedAt: row.listing_batch_updated_at ?? row.inventory_updated_at,
      rows: [row],
    });
  });

  return Array.from(summaries.values()).sort(compareListingSummaries);
}

function summarizeByBreed(rows: SellerInventoryManagementRow[]) {
  const summaries = new Map<string, BreedSummary>();

  rows.forEach((row) => {
    const existing = summaries.get(row.seller_breed_profile_id);
    const price = row.effective_unit_price;

    if (existing) {
      existing.totalAvailable += row.quantity_available ?? 0;
      existing.rowCount += 1;
      existing.rows.push(row);
      existing.minPrice = minNullable(existing.minPrice, price);
      existing.maxPrice = maxNullable(existing.maxPrice, price);
      existing.nextAvailableDate = minDate(
        existing.nextAvailableDate,
        row.available_date,
      );
      existing.availabilityStatus = pickListingAvailabilityStatus(
        existing.availabilityStatus,
        row.operational_availability_status,
      );
      existing.listingCount = new Set(
        existing.rows.map((item) => item.listing_batch_id),
      ).size;
      return;
    }

    summaries.set(row.seller_breed_profile_id, {
      id: row.seller_breed_profile_id,
      breedName: row.breed_display_name,
      speciesName: row.species_name,
      totalAvailable: row.quantity_available ?? 0,
      listingCount: 1,
      rowCount: 1,
      nextAvailableDate: row.available_date,
      minPrice: price,
      maxPrice: price,
      availabilityStatus: row.operational_availability_status,
      rows: [row],
    });
  });

  return Array.from(summaries.values()).sort((a, b) =>
    a.breedName.localeCompare(b.breedName),
  );
}

function countLifecycleStates(listings: ListingBatchSummary[]): LifecycleCounts {
  const counts: LifecycleCounts = {
    current: 0,
    all: listings.length,
    active: 0,
    hidden: 0,
    sold_out: 0,
    archived: 0,
  };

  listings.forEach((listing) => {
    const lifecycleStatus = getDerivedLifecycleStatus(listing);

    if (matchesLifecycleFilter(lifecycleStatus, "current")) {
      counts.current += 1;
    }

    if (isKnownLifecycleStatus(lifecycleStatus)) {
      counts[lifecycleStatus] += 1;
    }
  });

  return counts;
}

function buildListingTitle(row: SellerInventoryManagementRow) {
  if (row.internal_batch_label) return row.internal_batch_label;

  return `${row.breed_display_name} ${row.species_name}`;
}

function formatInventoryType(row: SellerInventoryManagementRow) {
  return row.custom_inventory_label || formatStatus(row.inventory_type);
}

function formatStatus(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "Not set";
}

function formatLifecycleStatus(status: string) {
  if (status === "active") return "Live";
  if (status === "sold_out") return "Sold Out";
  if (status === "hidden") return "Draft";
  if (status === "archived") return "Archived";

  return formatStatus(status);
}

function getLifecycleTone(status: string) {
  if (status === "active") return "bg-emerald-100 text-emerald-800";
  if (status === "hidden") return "bg-sky-100 text-sky-800";
  if (status === "sold_out") return "bg-amber-100 text-amber-800";
  if (status === "archived") return "bg-stone-200 text-stone-700";

  return "bg-stone-100 text-stone-700";
}

function getLifecycleNextStep(listing: ListingBatchSummary) {
  const lifecycleStatus = getDerivedLifecycleStatus(listing);

  if (lifecycleStatus === "active") {
    return "Live on your storefront. Keep quantities, prices, and photos current.";
  }

  if (lifecycleStatus === "hidden") {
    return "Draft. Continue setup, then review before publishing.";
  }

  if (lifecycleStatus === "sold_out") {
    return "Sold Out. Add quantity when more birds are available.";
  }

  if (lifecycleStatus === "archived") {
    return "Archived for your records. Hidden from buyers and read-only until restored.";
  }

  return "Review this listing before making changes.";
}

function getPrimaryListingHref(listing: ListingBatchSummary) {
  const lifecycleStatus = getDerivedLifecycleStatus(listing);

  if (lifecycleStatus !== "hidden") {
    return `/dashboard/listings/${listing.id}`;
  }

  const creationPath =
    listing.rowCount === 1 && listing.breedCount === 1
      ? "/dashboard/listings/new/birds/single"
      : "/dashboard/listings/new/birds/batch";

  return `${creationPath}?draft=${listing.id}`;
}

function shouldShowAvailabilityBadge(listing: ListingBatchSummary) {
  const lifecycleStatus = getDerivedLifecycleStatus(listing);

  if (lifecycleStatus === "archived") return false;
  if (lifecycleStatus === "hidden") return false;
  if (lifecycleStatus === "sold_out") return false;

  return listing.availabilityStatus !== lifecycleStatus;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value ?? 0);
}

function formatPriceRange(
  minPrice: number | null | undefined,
  maxPrice: number | null | undefined,
) {
  if (minPrice == null && maxPrice == null) return "Not priced";
  if (minPrice === maxPrice || maxPrice == null) return formatCurrency(minPrice);
  if (minPrice == null) return formatCurrency(maxPrice);

  return `${formatCurrency(minPrice)} - ${formatCurrency(maxPrice)}`;
}

function matchesLifecycleFilter(status: string, filter: ListingStatusFilter) {
  if (filter === "all") return true;
  if (filter === "current") return status !== "archived";

  return status === filter;
}

function getDerivedLifecycleStatus(listing: ListingBatchSummary) {
  if (listing.visibilityStatus === "active" && listing.totalAvailable <= 0) {
    return "sold_out";
  }

  return listing.visibilityStatus;
}

function getDerivedRowLifecycleStatus(row: SellerInventoryManagementRow) {
  if (
    row.listing_batch_visibility_status === "active" &&
    row.operational_availability_status === "sold_out"
  ) {
    return "sold_out";
  }

  return row.listing_batch_visibility_status;
}

function isKnownLifecycleStatus(
  status: string,
): status is Exclude<ListingStatusFilter, "all" | "current"> {
  return ["active", "hidden", "sold_out", "archived"].includes(status);
}

function minNullable(
  current: number | null | undefined,
  next: number | null | undefined,
) {
  if (current == null) return next ?? null;
  if (next == null) return current;

  return Math.min(current, next);
}

function maxNullable(
  current: number | null | undefined,
  next: number | null | undefined,
) {
  if (current == null) return next ?? null;
  if (next == null) return current;

  return Math.max(current, next);
}

function minDate(
  current: string | null | undefined,
  next: string | null | undefined,
) {
  if (!current) return next ?? null;
  if (!next) return current;

  return next < current ? next : current;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function pickListingAvailabilityStatus(current: string, next: string) {
  const priority = [
    "ready_now",
    "reserve_now",
    "hidden",
    "sold_out",
    "unavailable",
    "archived",
  ];

  const currentIndex = priority.indexOf(current);
  const nextIndex = priority.indexOf(next);

  if (currentIndex === -1) return next;
  if (nextIndex === -1) return current;

  return nextIndex < currentIndex ? next : current;
}

function compareListingSummaries(
  left: ListingBatchSummary,
  right: ListingBatchSummary,
) {
  const leftDate = left.updatedAt ?? left.availableDate;
  const rightDate = right.updatedAt ?? right.availableDate;

  if (leftDate !== rightDate) {
    return rightDate.localeCompare(leftDate);
  }

  return left.title.localeCompare(right.title);
}
