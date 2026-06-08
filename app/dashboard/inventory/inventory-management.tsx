"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  FilterControl,
  LoadingState,
  SellerCard,
  StatusBadge,
} from "../_components/seller-ui";
import {
  formatAgeAtAvailability,
  formatInventoryTypeLabel,
} from "../_lib/listing-formatters";

type InventoryRow = {
  store_id: string;
  listing_batch_id: string;
  inventory_item_id: string;
  species_name: string;
  species_slug: string;
  breed_display_name: string;
  origin_date: string | null;
  available_date: string;
  quantity_available: number | null;
  inventory_type: string;
  custom_inventory_label: string | null;
  effective_unit_price: number | null;
  inventory_visibility_status: string;
  inventory_moderation_status: string;
  listing_batch_visibility_status: string;
  listing_batch_moderation_status: string;
  operational_availability_status: string;
  inventory_updated_at: string | null;
};

type ReservedRow = {
  inventory_item_id: string | null;
  remaining_unfulfilled_quantity: number | null;
};

type BreedInventoryGroup = {
  id: string;
  breedName: string;
  speciesName: string;
  rows: InventoryRow[];
};

type AgeFilter = "all" | "0_6" | "7_12" | "13_24" | "25_plus" | "unknown";
type InventoryVisibility = "draft" | "live" | "hidden" | "archived" | "sold_out";

const unsavedWarning =
  "You have unsaved inventory changes. Save or discard before leaving.";

const ageFilterOptions: { label: string; value: AgeFilter }[] = [
  { label: "All ages", value: "all" },
  { label: "0-6 weeks", value: "0_6" },
  { label: "7-12 weeks", value: "7_12" },
  { label: "13-24 weeks", value: "13_24" },
  { label: "25+ weeks", value: "25_plus" },
  { label: "Age not set", value: "unknown" },
];

export function InventoryManagement() {
  const { seller } = useSellerContext();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [reservedByItemId, setReservedByItemId] = useState<
    Record<string, number>
  >({});
  const [draftQuantities, setDraftQuantities] = useState<
    Record<string, string>
  >({});
  const [speciesFilter, setSpeciesFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroupIds, setExpandedGroupIds] = useState<
    Record<string, boolean>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadInventory() {
      if (!seller) return;

      setIsLoading(true);
      setLoadError(null);

      const [inventoryResult, reservedResult] = await Promise.all([
        supabase
          .from("seller_inventory_management")
          .select(
            "store_id, listing_batch_id, inventory_item_id, species_name, species_slug, breed_display_name, origin_date, available_date, quantity_available, inventory_type, custom_inventory_label, effective_unit_price, inventory_visibility_status, inventory_moderation_status, listing_batch_visibility_status, listing_batch_moderation_status, operational_availability_status, inventory_updated_at",
          )
          .eq("store_id", seller.store_id)
          .neq("inventory_visibility_status", "archived")
          .neq("listing_batch_visibility_status", "archived")
          .eq("inventory_moderation_status", "normal")
          .eq("listing_batch_moderation_status", "normal")
          .order("species_name", { ascending: true })
          .order("breed_display_name", { ascending: true })
          .returns<InventoryRow[]>(),
        supabase
          .from("seller_order_item_detail")
          .select("inventory_item_id, remaining_unfulfilled_quantity")
          .eq("store_id", seller.store_id)
          .returns<ReservedRow[]>(),
      ]);

      if (!isMounted) return;

      const firstError = inventoryResult.error ?? reservedResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      setRows(inventoryResult.data ?? []);
      setReservedByItemId(buildReservedMap(reservedResult.data ?? []));
      setDraftQuantities({});
      setIsLoading(false);
    }

    void loadInventory();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const changedRows = useMemo(
    () => rows.filter((row) => isRowChanged(row, draftQuantities)),
    [draftQuantities, rows],
  );
  const hasUnsavedChanges = changedRows.length > 0;

  useUnsavedInventoryWarning(hasUnsavedChanges);

  const speciesOptions = useMemo(() => {
    const uniqueSpecies = new Map<string, string>();

    for (const row of rows) {
      uniqueSpecies.set(row.species_slug, row.species_name);
    }

    return [
      { label: "All species", value: "all" },
      ...Array.from(uniqueSpecies, ([value, label]) => ({ label, value })),
    ];
  }, [rows]);

  const typeOptions = useMemo(() => {
    const uniqueTypes = new Map<string, string>();

    for (const row of rows) {
      const value = getTypeFilterValue(row);
      uniqueTypes.set(value, getInventoryTypeLabel(row));
    }

    return [
      { label: "All types", value: "all" },
      ...Array.from(uniqueTypes, ([value, label]) => ({ label, value })).sort(
        (first, second) => first.label.localeCompare(second.label),
      ),
    ];
  }, [rows]);

  const statusOptions = useMemo(() => {
    const uniqueStatuses = new Map<string, string>();

    for (const row of rows) {
      uniqueStatuses.set(
        row.operational_availability_status,
        formatInventoryStatus(row.operational_availability_status),
      );
    }

    return [
      { label: "All statuses", value: "all" },
      ...Array.from(uniqueStatuses, ([value, label]) => ({ label, value })).sort(
        (first, second) => first.label.localeCompare(second.label),
      ),
    ];
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return rows.filter((row) => {
      if (speciesFilter !== "all" && row.species_slug !== speciesFilter) {
        return false;
      }

      if (typeFilter !== "all" && getTypeFilterValue(row) !== typeFilter) {
        return false;
      }

      if (!matchesAgeFilter(row, ageFilter)) {
        return false;
      }

      if (
        statusFilter !== "all" &&
        row.operational_availability_status !== statusFilter
      ) {
        return false;
      }

      if (!normalizedSearch) return true;

      const searchable = [
        row.breed_display_name,
        row.species_name,
        getInventoryTypeLabel(row),
        formatInventoryStatus(row.operational_availability_status),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalizedSearch);
    });
  }, [ageFilter, rows, searchQuery, speciesFilter, statusFilter, typeFilter]);

  const inventoryGroups = useMemo(
    () => groupRowsByBreed(filteredRows),
    [filteredRows],
  );

  const hasActiveFilters =
    speciesFilter !== "all" ||
    typeFilter !== "all" ||
    ageFilter !== "all" ||
    statusFilter !== "all" ||
    searchQuery.trim() !== "";

  const totalBirdsShown = filteredRows.reduce(
    (total, row) => total + getDisplayedQuantity(row, draftQuantities),
    0,
  );

  function updateDraftQuantity(row: InventoryRow, nextValue: string) {
    setDraftQuantities((current) => {
      const originalValue = String(row.quantity_available ?? 0);

      if (nextValue === originalValue) {
        const remaining = { ...current };
        delete remaining[row.inventory_item_id];

        return remaining;
      }

      return {
        ...current,
        [row.inventory_item_id]: nextValue,
      };
    });
    setSaveError(null);
    setSuccessMessage(null);
  }

  function discardChanges() {
    setDraftQuantities({});
    setSaveError(null);
    setSuccessMessage(null);
  }

  async function saveChanges() {
    if (!seller || isSaving || changedRows.length === 0) return;

    const validationMessage = validateChangedRows(changedRows, draftQuantities);

    if (validationMessage) {
      setSaveError(validationMessage);
      setSuccessMessage(null);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    for (const row of changedRows) {
      const result = await supabase.rpc("seller_adjust_inventory_quantity", {
        p_inventory_item_id: row.inventory_item_id,
        p_quantity_available: Number(draftQuantities[row.inventory_item_id]),
        p_quantity_delta: null,
        p_note: "Updated from seller inventory page.",
      });

      if (result.error) {
        setSaveError(result.error.message);
        setIsSaving(false);
        return;
      }
    }

    setRows((current) =>
      current.map((row) => {
        const draftValue = draftQuantities[row.inventory_item_id];

        if (draftValue == null) return row;

        return {
          ...row,
          quantity_available: Number(draftValue),
        };
      }),
    );
    setDraftQuantities({});
    setSuccessMessage("Inventory quantities saved.");
    setIsSaving(false);
  }

  if (isLoading) {
    return <LoadingState label="Loading inventory" />;
  }

  if (loadError) {
    return (
      <ErrorState
        message={loadError}
        action={
          <button
            type="button"
            className="seller-secondary-button"
            onClick={() => window.location.reload()}
          >
            Reload inventory
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <SellerCard className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
              Total Birds Shown
            </p>
            <p className="mt-1 text-3xl font-semibold text-stone-950">
              {totalBirdsShown}
            </p>
            {hasUnsavedChanges ? (
              <p className="mt-1 text-sm font-medium text-amber-700">
                {changedRows.length} unsaved row
                {changedRows.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="seller-secondary-button"
              disabled={!hasUnsavedChanges || isSaving}
              onClick={discardChanges}
            >
              Discard Changes
            </button>
            <button
              type="button"
              className="seller-primary-button"
              disabled={!hasUnsavedChanges || isSaving}
              onClick={saveChanges}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {saveError ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {saveError}
          </div>
        ) : null}
        {successMessage ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {successMessage}
          </div>
        ) : null}
      </SellerCard>

      <SellerCard className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <FilterControl
            label="Species"
            value={speciesFilter}
            options={speciesOptions}
            onChange={setSpeciesFilter}
          />
          <FilterControl
            label="Type/sex"
            value={typeFilter}
            options={typeOptions}
            onChange={setTypeFilter}
          />
          <FilterControl
            label="Age range"
            value={ageFilter}
            options={ageFilterOptions}
            onChange={(value) => setAgeFilter(value as AgeFilter)}
          />
          <FilterControl
            label="Status"
            value={statusFilter}
            options={statusOptions}
            onChange={setStatusFilter}
          />
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Search
            <input
              className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              placeholder="Breed or name"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>
      </SellerCard>

      <SellerCard className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No inventory yet"
              description="Add birds, eggs, or upcoming availability to start building your storefront."
              action={
                <Link
                  className="seller-primary-button"
                  href="/dashboard/listings/new"
                >
                  Add Inventory
                </Link>
              }
            />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No inventory matches these filters"
              description="Adjust the filters or search to see more of your flock availability."
            />
          </div>
        ) : (
          <div className="divide-y divide-stone-200">
            {inventoryGroups.map((group) => (
              <BreedInventoryRows
                key={group.id}
                draftQuantities={draftQuantities}
                forceExpanded={hasActiveFilters}
                group={group}
                isExpanded={Boolean(expandedGroupIds[group.id])}
                reservedByItemId={reservedByItemId}
                toggleExpanded={() =>
                  setExpandedGroupIds((current) => ({
                    ...current,
                    [group.id]: !current[group.id],
                  }))
                }
                updateDraftQuantity={updateDraftQuantity}
              />
            ))}
          </div>
        )}
      </SellerCard>
    </div>
  );
}

function BreedInventoryRows({
  draftQuantities,
  forceExpanded,
  group,
  isExpanded,
  reservedByItemId,
  toggleExpanded,
  updateDraftQuantity,
}: {
  draftQuantities: Record<string, string>;
  forceExpanded: boolean;
  group: BreedInventoryGroup;
  isExpanded: boolean;
  reservedByItemId: Record<string, number>;
  toggleExpanded: () => void;
  updateDraftQuantity: (row: InventoryRow, nextValue: string) => void;
}) {
  const expanded = forceExpanded || isExpanded;
  const totalAvailable = group.rows.reduce(
    (total, row) => total + getDisplayedQuantity(row, draftQuantities),
    0,
  );
  const totalReserved = group.rows.reduce(
    (total, row) => total + (reservedByItemId[row.inventory_item_id] ?? 0),
    0,
  );
  const summary = summarizeGroupAvailability(group.rows, draftQuantities);
  const priceRange = formatPriceRange(
    ...group.rows.reduce<[number | null, number | null]>(
      ([minPrice, maxPrice], row) => [
        minNullable(minPrice, row.effective_unit_price),
        maxNullable(maxPrice, row.effective_unit_price),
      ],
      [null, null],
    ),
  );

  return (
    <section className={expanded ? "bg-emerald-50/40" : "bg-white"}>
      <button
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-stone-50 sm:px-5"
        onClick={toggleExpanded}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 inline-block shrink-0 text-stone-500 transition ${
            expanded ? "rotate-90" : ""
          }`}
        >
          &gt;
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold uppercase tracking-[0.08em] text-stone-950">
            {group.breedName}
          </span>
          <span className="mt-1 block text-sm font-semibold leading-6 normal-case tracking-normal text-stone-600">
            {[
              group.speciesName,
              `${group.rows.length} record${group.rows.length === 1 ? "" : "s"}`,
              `${totalAvailable} available`,
              `${totalReserved} reserved`,
              summary,
              priceRange,
            ].join(" - ")}
          </span>
        </span>
      </button>

      {expanded ? (
        <div className="px-4 pb-4 sm:px-5">
          <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-[0.06em] text-stone-500">
                <tr>
                  <th className="px-3 py-3">Type/Sex</th>
                  <th className="px-3 py-3">Age</th>
                  <th className="px-3 py-3">Available</th>
                  <th className="px-3 py-3">Reserved</th>
                  <th className="px-3 py-3">Price</th>
                  <th className="px-3 py-3">Status/Availability</th>
                  <th className="px-3 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {group.rows.map((row) => (
                  <InventoryTableRow
                    key={row.inventory_item_id}
                    draftQuantities={draftQuantities}
                    reservedQuantity={reservedByItemId[row.inventory_item_id] ?? 0}
                    row={row}
                    updateDraftQuantity={updateDraftQuantity}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function InventoryTableRow({
  draftQuantities,
  reservedQuantity,
  row,
  updateDraftQuantity,
}: {
  draftQuantities: Record<string, string>;
  reservedQuantity: number;
  row: InventoryRow;
  updateDraftQuantity: (row: InventoryRow, nextValue: string) => void;
}) {
  const isChanged = isRowChanged(row, draftQuantities);
  const quantityValue =
    draftQuantities[row.inventory_item_id] ??
    String(row.quantity_available ?? 0);
  const rowHasInvalidQuantity =
    draftQuantities[row.inventory_item_id] != null &&
    !isValidQuantity(quantityValue);

  return (
    <tr className={isChanged ? "bg-amber-50/70" : "bg-white"}>
      <td className="px-3 py-3 align-top text-stone-700">
        {getInventoryTypeLabel(row)}
      </td>
      <td className="px-3 py-3 align-top text-stone-700">
        {formatCurrentAge(row.origin_date)}
      </td>
      <td className="px-3 py-3 align-top">
        <input
          className={`h-9 w-20 rounded-md border px-2 text-sm font-semibold text-stone-950 shadow-sm focus:outline-none focus:ring-2 ${
            rowHasInvalidQuantity
              ? "border-red-400 focus:border-red-600 focus:ring-red-600/20"
              : isChanged
                ? "border-amber-400 bg-white focus:border-amber-600 focus:ring-amber-600/20"
                : "border-stone-300 focus:border-emerald-700 focus:ring-emerald-700/20"
          }`}
          min="0"
          step="1"
          type="number"
          value={quantityValue}
          onChange={(event) => updateDraftQuantity(row, event.target.value)}
        />
        {isChanged ? (
          <p className="mt-1 text-xs font-semibold text-amber-700">Unsaved</p>
        ) : null}
      </td>
      <td className="px-3 py-3 align-top font-medium text-stone-700">
        {reservedQuantity}
      </td>
      <td className="px-3 py-3 align-top font-medium text-stone-700">
        {formatCurrency(row.effective_unit_price)}
      </td>
      <td className="px-3 py-3 align-top">
        <InventoryStateBadges row={row} />
      </td>
      <td className="px-3 py-3 align-top">
        <Link
          className="text-sm font-semibold text-emerald-800 hover:text-emerald-950"
          href={`/dashboard/inventory/${row.listing_batch_id}`}
        >
          Manage
        </Link>
      </td>
    </tr>
  );
}

function InventoryStateBadges({ row }: { row: InventoryRow }) {
  const visibility = getInventoryVisibility(row);
  const showAvailability =
    visibility === "live" && row.operational_availability_status !== "sold_out";

  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status={visibility} />
      {showAvailability ? (
        <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
          {formatInventoryAvailability(row)}
        </span>
      ) : null}
    </div>
  );
}

function buildReservedMap(rows: ReservedRow[]) {
  return rows.reduce<Record<string, number>>((totals, row) => {
    if (!row.inventory_item_id) return totals;

    totals[row.inventory_item_id] =
      (totals[row.inventory_item_id] ?? 0) +
      Math.max(row.remaining_unfulfilled_quantity ?? 0, 0);

    return totals;
  }, {});
}

function groupRowsByBreed(rows: InventoryRow[]) {
  const groups = new Map<string, BreedInventoryGroup>();

  for (const row of rows) {
    const groupId = `${row.species_slug}:${row.breed_display_name}`;
    const existing = groups.get(groupId);

    if (existing) {
      existing.rows.push(row);
      continue;
    }

    groups.set(groupId, {
      id: groupId,
      breedName: row.breed_display_name,
      speciesName: row.species_name,
      rows: [row],
    });
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    rows: group.rows.slice().sort(compareInventoryRows),
  }));
}

function compareInventoryRows(left: InventoryRow, right: InventoryRow) {
  if (left.available_date !== right.available_date) {
    return left.available_date.localeCompare(right.available_date);
  }

  const leftAge = calculateCurrentAgeDays(left.origin_date);
  const rightAge = calculateCurrentAgeDays(right.origin_date);

  if (leftAge !== rightAge) {
    return (
      (leftAge ?? Number.MAX_SAFE_INTEGER) -
      (rightAge ?? Number.MAX_SAFE_INTEGER)
    );
  }

  return getInventoryTypeLabel(left).localeCompare(getInventoryTypeLabel(right));
}

function getInventoryTypeLabel(row: InventoryRow) {
  if (row.inventory_type === "other" && row.custom_inventory_label) {
    return row.custom_inventory_label;
  }

  return formatInventoryTypeLabel(row.inventory_type);
}

function getTypeFilterValue(row: InventoryRow) {
  return `${row.inventory_type}:${row.custom_inventory_label ?? ""}`;
}

function formatInventoryStatus(value: string | null | undefined) {
  if (value === "active") return "Live";
  if (value === "ready_now") return "Available now";
  if (value === "reserve_now") return "Future";
  if (value === "hidden") return "Hidden";
  if (value === "sold_out") return "Sold out";
  if (value === "archived") return "Archived";
  if (value === "unavailable") return "Unavailable";

  return value ? value.replaceAll("_", " ") : "Unknown";
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "Not priced";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
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

function getInventoryVisibility(row: InventoryRow): InventoryVisibility {
  if (
    row.listing_batch_visibility_status === "archived" ||
    row.inventory_visibility_status === "archived"
  ) {
    return "archived";
  }

  if (row.operational_availability_status === "sold_out") return "sold_out";
  if (row.listing_batch_visibility_status === "active") return "live";
  if (row.listing_batch_visibility_status === "hidden") return "draft";

  return "hidden";
}

function formatInventoryAvailability(row: InventoryRow) {
  if (row.operational_availability_status === "sold_out") return "Sold Out";
  if (getInventoryVisibility(row) !== "live") return "";

  const today = new Date();
  const todayIso = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  if (row.available_date && row.available_date > todayIso) {
    return `Available ${formatShortDate(row.available_date)}`;
  }

  return "Available Now";
}

function summarizeGroupAvailability(
  rows: InventoryRow[],
  draftQuantities: Record<string, string>,
) {
  const counts = rows.reduce(
    (summary, row) => {
      const visibility = getInventoryVisibility(row);

      if (visibility === "draft") summary.draft += 1;
      else if (visibility === "hidden") summary.hidden += 1;
      else if (visibility === "archived") summary.archived += 1;
      else if (visibility === "sold_out") summary.soldOut += 1;
      else if (getDisplayedQuantity(row, draftQuantities) <= 0) {
        summary.soldOut += 1;
      } else if (row.available_date && isFutureDate(row.available_date)) {
        summary.future += 1;
      } else {
        summary.availableNow += 1;
      }

      return summary;
    },
    {
      archived: 0,
      availableNow: 0,
      draft: 0,
      future: 0,
      hidden: 0,
      soldOut: 0,
    },
  );

  const parts = [
    formatCount(counts.availableNow, "available now"),
    formatCount(counts.future, "future"),
    formatCount(counts.draft, "draft"),
    formatCount(counts.hidden, "hidden"),
    formatCount(counts.soldOut, "sold out"),
    formatCount(counts.archived, "archived"),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" - ") : "No availability";
}

function formatCount(count: number, label: string) {
  return count > 0 ? `${count} ${label}` : "";
}

function isFutureDate(value: string) {
  const today = new Date();
  const todayIso = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  return value > todayIso;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function calculateCurrentAgeDays(originDate: string | null) {
  if (!originDate) return null;

  const originTime = Date.parse(`${originDate}T00:00:00Z`);

  if (Number.isNaN(originTime)) return null;

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  return Math.max(Math.floor((todayUtc - originTime) / 86_400_000), 0);
}

function formatCurrentAge(originDate: string | null) {
  return formatAgeAtAvailability(calculateCurrentAgeDays(originDate));
}

function matchesAgeFilter(row: InventoryRow, ageFilter: AgeFilter) {
  if (ageFilter === "all") return true;

  const ageDays = calculateCurrentAgeDays(row.origin_date);

  if (ageDays == null) return ageFilter === "unknown";

  const ageWeeks = Math.floor(ageDays / 7);

  if (ageFilter === "0_6") return ageWeeks <= 6;
  if (ageFilter === "7_12") return ageWeeks >= 7 && ageWeeks <= 12;
  if (ageFilter === "13_24") return ageWeeks >= 13 && ageWeeks <= 24;
  if (ageFilter === "25_plus") return ageWeeks >= 25;

  return false;
}

function isRowChanged(
  row: InventoryRow,
  draftQuantities: Record<string, string>,
) {
  const draftValue = draftQuantities[row.inventory_item_id];

  return draftValue != null && draftValue !== String(row.quantity_available ?? 0);
}

function isValidQuantity(value: string) {
  if (!value.trim()) return false;

  const numericValue = Number(value);

  return (
    Number.isInteger(numericValue) && numericValue >= 0 && Number.isFinite(numericValue)
  );
}

function validateChangedRows(
  changedRows: InventoryRow[],
  draftQuantities: Record<string, string>,
) {
  for (const row of changedRows) {
    const draftValue = draftQuantities[row.inventory_item_id];

    if (!draftValue || !isValidQuantity(draftValue)) {
      return "Available quantity must be a whole number of zero or more.";
    }
  }

  return null;
}

function getDisplayedQuantity(
  row: InventoryRow,
  draftQuantities: Record<string, string>,
) {
  const draftValue = draftQuantities[row.inventory_item_id];

  if (draftValue == null) return row.quantity_available ?? 0;
  if (!isValidQuantity(draftValue)) return 0;

  return Number(draftValue);
}

function useUnsavedInventoryWarning(hasUnsavedChanges: boolean) {
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = unsavedWarning;
      return unsavedWarning;
    }

    function handleLinkClick(event: MouseEvent) {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const link = target.closest("a[href]");

      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== "_self") return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const nextUrl = new URL(link.href);

      if (nextUrl.href === window.location.href) return;

      if (!window.confirm(unsavedWarning)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [hasUnsavedChanges]);
}
