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

type AgeFilter = "all" | "0_6" | "7_12" | "13_24" | "25_plus" | "unknown";

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
  const [searchQuery, setSearchQuery] = useState("");
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
            "store_id, listing_batch_id, inventory_item_id, species_name, species_slug, breed_display_name, origin_date, available_date, quantity_available, inventory_type, custom_inventory_label, inventory_visibility_status, inventory_moderation_status, listing_batch_visibility_status, listing_batch_moderation_status, operational_availability_status, inventory_updated_at",
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

      if (!normalizedSearch) return true;

      const searchable = [
        row.breed_display_name,
        row.species_name,
        getInventoryTypeLabel(row),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalizedSearch);
    });
  }, [ageFilter, rows, searchQuery, speciesFilter, typeFilter]);

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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
        {filteredRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No inventory matches these filters"
              description="Adjust the filters or search to see more of your available birds."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold uppercase tracking-[0.06em] text-stone-500">
                <tr>
                  <th className="px-4 py-3">Breed</th>
                  <th className="px-4 py-3">Type/sex</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3">Available quantity</th>
                  <th className="px-4 py-3">Reserved quantity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredRows.map((row) => {
                  const isChanged = isRowChanged(row, draftQuantities);
                  const quantityValue =
                    draftQuantities[row.inventory_item_id] ??
                    String(row.quantity_available ?? 0);
                  const rowHasInvalidQuantity =
                    draftQuantities[row.inventory_item_id] != null &&
                    !isValidQuantity(quantityValue);

                  return (
                    <tr
                      key={row.inventory_item_id}
                      className={
                        isChanged ? "bg-amber-50/70" : "bg-white"
                      }
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-stone-950">
                          {row.breed_display_name}
                        </div>
                        <div className="mt-1 text-xs text-stone-500">
                          {row.species_name}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-stone-700">
                        {getInventoryTypeLabel(row)}
                      </td>
                      <td className="px-4 py-3 align-top text-stone-700">
                        {formatCurrentAge(row.origin_date)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          className={`h-10 w-28 rounded-md border px-3 text-sm font-semibold text-stone-950 shadow-sm focus:outline-none focus:ring-2 ${
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
                          onChange={(event) =>
                            updateDraftQuantity(row, event.target.value)
                          }
                        />
                        {isChanged ? (
                          <p className="mt-1 text-xs font-semibold text-amber-700">
                            Unsaved
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top font-medium text-stone-700">
                        {reservedByItemId[row.inventory_item_id] ?? 0}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusBadge
                          status={row.operational_availability_status}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Link
                          className="text-sm font-semibold text-emerald-800 hover:text-emerald-950"
                          href={`/dashboard/listings/${row.listing_batch_id}`}
                        >
                          View listing
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SellerCard>
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

function getInventoryTypeLabel(row: InventoryRow) {
  if (row.inventory_type === "other" && row.custom_inventory_label) {
    return row.custom_inventory_label;
  }

  return formatInventoryTypeLabel(row.inventory_type);
}

function getTypeFilterValue(row: InventoryRow) {
  return `${row.inventory_type}:${row.custom_inventory_label ?? ""}`;
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
