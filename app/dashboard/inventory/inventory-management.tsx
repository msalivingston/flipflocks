"use client";

import Image from "next/image";
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
  calculateAgeAtAvailabilityDays,
  formatAgeAtAvailabilityFromDates,
  formatInventoryTypeLabel,
} from "../_lib/listing-formatters";
import {
  type EquipmentInventoryRow,
} from "../_lib/equipment-inventory";
import {
  type ProcessedPoultryInventoryRow,
  formatCurrency as formatProcessedPoultryCurrency,
  formatProcessedPoultryDescriptor,
  formatProcessedPoultryStatus,
} from "../_lib/processed-poultry-inventory";

type InventoryRow = {
  store_id: string;
  listing_batch_id: string;
  inventory_item_id: string;
  species_name: string;
  species_slug: string;
  breed_display_name: string;
  batch_type: string;
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

type AgeFilter = "all" | "0_6" | "7_12" | "13_24" | "25_plus" | "unknown";
type InventoryVisibility = "draft" | "live" | "hidden" | "archived" | "sold_out";
type AvailabilityFilter =
  | "all"
  | "available_now"
  | "future"
  | "sold_out"
  | "local_pickup"
  | "not_listed"
  | "unavailable";
type InventorySort =
  | "hatch_date"
  | "name"
  | "age"
  | "available"
  | "reserved"
  | "price"
  | "availability";

type DeletedInventoryEntry = {
  deleted_item_type: "listing_inventory" | "equipment_inventory";
  deleted_item_id: string;
};

type FlatInventoryItem =
  | {
      kind: "bird";
      id: string;
      species: string;
      speciesFilterValue: string;
      breedOrItem: string;
      typeSex: string;
      hatchDate: string | null;
      availableDate: string | null;
      ageDays: number | null;
      ageLabel: string;
      availableQuantity: number;
      reservedQuantity: number;
      price: number | null;
      availabilityLabel: string;
      availabilityValue: AvailabilityFilter;
      manageHref: string;
      searchText: string;
      row: InventoryRow;
    }
  | {
      kind: "equipment";
      id: string;
      species: "Equipment";
      speciesFilterValue: "equipment";
      breedOrItem: string;
      typeSex: "—";
      hatchDate: null;
      availableDate: null;
      ageDays: null;
      ageLabel: "—";
      availableQuantity: number;
      reservedQuantity: 0;
      price: number;
      availabilityLabel: string;
      availabilityValue: AvailabilityFilter;
      manageHref: string;
      searchText: string;
      row: EquipmentInventoryRow;
    };

const unsavedWarning =
  "You have unsaved inventory changes. Save or discard before leaving.";
const ageTooltipText =
  "Age shows the first available age until the available date arrives, then updates to the bird’s current age.";

const ageFilterOptions: { label: string; value: AgeFilter }[] = [
  { label: "All ages", value: "all" },
  { label: "0-6 weeks", value: "0_6" },
  { label: "7-12 weeks", value: "7_12" },
  { label: "13-24 weeks", value: "13_24" },
  { label: "25+ weeks", value: "25_plus" },
  { label: "Age not set", value: "unknown" },
];

const sortOptions: { label: string; value: InventorySort }[] = [
  { label: "Hatch date", value: "hatch_date" },
  { label: "Breed / Item", value: "name" },
  { label: "Age", value: "age" },
  { label: "Available", value: "available" },
  { label: "Reserved", value: "reserved" },
  { label: "Price", value: "price" },
  { label: "Availability", value: "availability" },
];

export function InventoryManagement() {
  const { seller } = useSellerContext();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [equipmentRows, setEquipmentRows] = useState<EquipmentInventoryRow[]>([]);
  const [processedPoultryRows, setProcessedPoultryRows] = useState<
    ProcessedPoultryInventoryRow[]
  >([]);
  const [reservedByItemId, setReservedByItemId] = useState<
    Record<string, number>
  >({});
  const [draftQuantities, setDraftQuantities] = useState<
    Record<string, string>
  >({});
  const [speciesFilter, setSpeciesFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<AvailabilityFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<InventorySort>("hatch_date");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadInventory() {
      if (!seller) return;

      setIsLoading(true);
      setLoadError(null);

      const [
        inventoryResult,
        reservedResult,
        equipmentResult,
        processedPoultryResult,
      ] = await Promise.all([
        supabase
          .from("seller_inventory_management")
          .select(
            "store_id, listing_batch_id, inventory_item_id, species_name, species_slug, breed_display_name, batch_type, origin_date, available_date, quantity_available, inventory_type, custom_inventory_label, effective_unit_price, inventory_visibility_status, inventory_moderation_status, listing_batch_visibility_status, listing_batch_moderation_status, operational_availability_status, inventory_updated_at",
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
        supabase
          .from("seller_equipment_inventory_management")
          .select("*")
          .eq("store_id", seller.store_id)
          .neq("visibility_status", "archived")
          .eq("moderation_status", "normal")
          .order("updated_at", { ascending: false })
          .returns<EquipmentInventoryRow[]>(),
        supabase
          .from("seller_processed_poultry_inventory_management")
          .select("*")
          .eq("store_id", seller.store_id)
          .neq("visibility_status", "archived")
          .eq("moderation_status", "normal")
          .order("updated_at", { ascending: false })
          .returns<ProcessedPoultryInventoryRow[]>(),
      ]);

      if (!isMounted) return;

      const firstError =
        inventoryResult.error ??
        reservedResult.error ??
        equipmentResult.error ??
        processedPoultryResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      setRows(inventoryResult.data ?? []);
      setEquipmentRows(equipmentResult.data ?? []);
      setProcessedPoultryRows(processedPoultryResult.data ?? []);
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

  const inventoryItems = useMemo(
    () =>
      buildFlatInventoryItems({
        draftQuantities,
        equipmentRows,
        reservedByItemId,
        rows,
      }),
    [draftQuantities, equipmentRows, reservedByItemId, rows],
  );

  const speciesOptions = useMemo(() => {
    const uniqueSpecies = new Map<string, string>();

    for (const item of inventoryItems) {
      uniqueSpecies.set(item.speciesFilterValue, item.species);
    }

    return [
      { label: "All species", value: "all" },
      ...Array.from(uniqueSpecies, ([value, label]) => ({ label, value })),
    ];
  }, [inventoryItems]);

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

  const availabilityOptions = useMemo(() => {
    const uniqueAvailability = new Map<AvailabilityFilter, string>();

    for (const item of inventoryItems) {
      if (item.availabilityValue === "all") continue;
      uniqueAvailability.set(
        item.availabilityValue,
        getAvailabilityFilterLabel(item.availabilityValue),
      );
    }

    return [
      { label: "All availability", value: "all" },
      ...Array.from(uniqueAvailability, ([value, label]) => ({
        label,
        value,
      })).sort(
        (first, second) => first.label.localeCompare(second.label),
      ),
    ];
  }, [inventoryItems]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return inventoryItems
      .filter((item) => {
        if (
          speciesFilter !== "all" &&
          item.speciesFilterValue !== speciesFilter
        ) {
          return false;
        }

        if (
          typeFilter !== "all" &&
          (item.kind !== "bird" || getTypeFilterValue(item.row) !== typeFilter)
        ) {
          return false;
        }

        if (item.kind === "bird" && !matchesAgeFilter(item.row, ageFilter)) {
          return false;
        }

        if (item.kind === "equipment" && ageFilter !== "all") {
          return false;
        }

        if (
          availabilityFilter !== "all" &&
          item.availabilityValue !== availabilityFilter
        ) {
          return false;
        }

        if (!normalizedSearch) return true;

        return item.searchText.includes(normalizedSearch);
      })
      .sort((first, second) => compareFlatInventoryItems(first, second, sortBy));
  }, [
    ageFilter,
    availabilityFilter,
    inventoryItems,
    searchQuery,
    sortBy,
    speciesFilter,
    typeFilter,
  ]);

  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selectedItemIds.includes(item.id)),
    [filteredItems, selectedItemIds],
  );
  const selectedCount = selectedItems.length;
  const visibleSelectedItemIds = selectedItems.map((item) => item.id);

  const visibleBirdItems = filteredItems.filter(
    (item) => item.kind === "bird" && isLiveBirdInventoryRow(item.row),
  );
  const totalBirdsShown = visibleBirdItems.reduce(
    (total, item) => total + item.availableQuantity,
    0,
  );
  const totalForSale = visibleBirdItems.reduce(
    (total, item) =>
      total + Math.max(item.availableQuantity - item.reservedQuantity, 0),
    0,
  );
  const totalReserved = visibleBirdItems.reduce(
    (total, item) => total + item.reservedQuantity,
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

  function toggleItemSelection(itemId: string) {
    setSelectedItemIds((current) =>
      current.includes(itemId)
        ? current.filter((selectedId) => selectedId !== itemId)
        : [...current, itemId],
    );
    setSaveError(null);
    setSuccessMessage(null);
  }

  function setVisibleSelection(shouldSelect: boolean) {
    if (!shouldSelect) {
      setSelectedItemIds([]);
      return;
    }

    setSelectedItemIds(filteredItems.map((item) => item.id));
    setSaveError(null);
    setSuccessMessage(null);
  }

  function clearSelection() {
    setSelectedItemIds([]);
    setIsDeleteConfirmOpen(false);
  }

  async function deleteSelectedInventory() {
    if (!seller || selectedItems.length === 0 || isDeleting) return;

    const selectedBirdIds = selectedItems
      .filter((item) => item.kind === "bird")
      .map((item) => item.row.inventory_item_id);
    const selectedEquipmentIds = selectedItems
      .filter((item) => item.kind === "equipment")
      .map((item) => item.row.equipment_inventory_item_id);

    setIsDeleting(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const result = await supabase.rpc("seller_delete_inventory_entries", {
        p_equipment_inventory_item_ids: selectedEquipmentIds,
        p_inventory_item_ids: selectedBirdIds,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      const deletedEntries = Array.isArray(result.data)
        ? (result.data as DeletedInventoryEntry[])
        : [];
      const deletedBirdIds = new Set(
        deletedEntries
          .filter((entry) => entry.deleted_item_type === "listing_inventory")
          .map((entry) => entry.deleted_item_id),
      );
      const deletedEquipmentIds = new Set(
        deletedEntries
          .filter((entry) => entry.deleted_item_type === "equipment_inventory")
          .map((entry) => entry.deleted_item_id),
      );
      const deletedCount = deletedBirdIds.size + deletedEquipmentIds.size;

      if (deletedCount === 0) {
        throw new Error("No inventory entries were deleted.");
      }

      setRows((current) =>
        current.filter((row) => !deletedBirdIds.has(row.inventory_item_id)),
      );
      setEquipmentRows((current) =>
        current.filter(
          (row) => !deletedEquipmentIds.has(row.equipment_inventory_item_id),
        ),
      );
      setReservedByItemId((current) => {
        const next = { ...current };

        for (const deletedId of deletedBirdIds) {
          delete next[deletedId];
        }

        return next;
      });
      setDraftQuantities((current) => {
        const next = { ...current };

        for (const deletedId of deletedBirdIds) {
          delete next[deletedId];
        }

        return next;
      });

      setSelectedItemIds([]);
      setSuccessMessage(
        `Deleted ${deletedCount} inventory ${deletedCount === 1 ? "entry" : "entries"}.`,
      );
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not delete selected inventory entries.",
      );
    } finally {
      setIsDeleteConfirmOpen(false);
      setIsDeleting(false);
    }
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
    <div className="space-y-3">
      <SellerCard className="p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid flex-1 gap-2 md:grid-cols-3">
            <InventorySummaryCard
              glyph="/glyphs/hen.png"
              label="Total Birds Shown"
              value={totalBirdsShown}
            />
            <InventorySummaryCard
              glyph="/glyphs/egg-carton.png"
              label="Total For Sale"
              value={totalForSale}
            />
            <InventorySummaryCard
              glyph="/glyphs/calendar.png"
              label="Reserved"
              value={totalReserved}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row xl:justify-end">
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

        {hasUnsavedChanges ? (
          <p className="mt-2 text-sm font-medium text-amber-700">
            {changedRows.length} unsaved row
            {changedRows.length === 1 ? "" : "s"}
          </p>
        ) : null}

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

      <SellerCard className="p-3">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
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
            label="Availability"
            value={availabilityFilter}
            options={availabilityOptions}
            onChange={(value) =>
              setAvailabilityFilter(value as AvailabilityFilter)
            }
          />
          <label className="grid gap-1.5 text-base font-bold text-stone-700 sm:text-sm">
            Search
            <input
              className="min-h-12 rounded-md border border-stone-300 bg-white px-3 text-base font-semibold text-stone-950 shadow-sm placeholder:text-stone-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 sm:min-h-10 sm:text-sm sm:font-medium"
              placeholder="Breed or name"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <FilterControl
            label="Sort by"
            value={sortBy}
            options={sortOptions}
            onChange={(value) => setSortBy(value as InventorySort)}
          />
        </div>
      </SellerCard>

      <SellerCard className="overflow-hidden">
        {inventoryItems.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                equipmentRows.length > 0
                  ? "No bird inventory yet"
                  : "No inventory yet"
              }
              description={
                equipmentRows.length > 0
                  ? "Add live birds or hatching eggs when you are ready to manage bird availability."
                  : "Add birds, eggs, or equipment to start building your inventory."
              }
              action={
                <Link
                  className="seller-primary-button"
                  href="/dashboard/inventory/add-v2"
                >
                  Add Inventory
                </Link>
              }
            />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No inventory matches these filters"
              description="Adjust the filters or search to see more inventory."
            />
          </div>
        ) : (
          <FlatInventoryTable
            draftQuantities={draftQuantities}
            items={filteredItems}
            isDeleting={isDeleting}
            onClearSelection={clearSelection}
            onDeleteSelected={() => setIsDeleteConfirmOpen(true)}
            onSelectVisible={setVisibleSelection}
            onToggleSelection={toggleItemSelection}
            selectedItemIds={visibleSelectedItemIds}
            updateDraftQuantity={updateDraftQuantity}
          />
        )}
      </SellerCard>

      {processedPoultryRows.length > 0 ? (
        <ProcessedPoultryInventorySection rows={processedPoultryRows} />
      ) : null}

      {isDeleteConfirmOpen ? (
        <DeleteInventoryConfirmModal
          isDeleting={isDeleting}
          selectedCount={selectedCount}
          onCancel={() => setIsDeleteConfirmOpen(false)}
          onConfirm={deleteSelectedInventory}
        />
      ) : null}
    </div>
  );
}

function InventorySummaryCard({
  glyph,
  label,
  value,
}: {
  glyph: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex min-h-16 items-center gap-2.5 rounded-md border border-stone-200 bg-white px-3 py-2.5 shadow-sm">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-900/5">
        <Image src={glyph} alt="" width={21} height={21} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold uppercase tracking-[0.05em] text-stone-500 sm:text-[0.68rem]">
          {label}
        </p>
        <p className="mt-0.5 text-2xl font-bold leading-none text-stone-950 sm:text-xl sm:font-semibold">
          {value}
        </p>
      </div>
    </div>
  );
}

function DeleteInventoryConfirmModal({
  isDeleting,
  selectedCount,
  onCancel,
  onConfirm,
}: {
  isDeleting: boolean;
  selectedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-labelledby="delete-inventory-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-md border border-stone-200 bg-white p-5 shadow-xl">
        <h2
          className="text-lg font-semibold leading-7 text-stone-950"
          id="delete-inventory-title"
        >
          Delete selected inventory?
        </h2>
        <p className="mt-3 text-sm leading-6 text-stone-700">
          This permanently removes the selected inventory entries. Use this only
          for test data or entries that were never actually sold.
        </p>
        <p className="mt-3 text-sm font-semibold text-stone-950">
          {selectedCount} selected
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="seller-secondary-button"
            disabled={isDeleting}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md border border-red-700 bg-red-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-700/25 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isDeleting || selectedCount === 0}
            onClick={onConfirm}
          >
            {isDeleting ? "Deleting..." : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FlatInventoryTable({
  draftQuantities,
  isDeleting,
  items,
  onClearSelection,
  onDeleteSelected,
  onSelectVisible,
  onToggleSelection,
  selectedItemIds,
  updateDraftQuantity,
}: {
  draftQuantities: Record<string, string>;
  isDeleting: boolean;
  items: FlatInventoryItem[];
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onSelectVisible: (shouldSelect: boolean) => void;
  onToggleSelection: (itemId: string) => void;
  selectedItemIds: string[];
  updateDraftQuantity: (row: InventoryRow, nextValue: string) => void;
}) {
  const selectedCount = selectedItemIds.length;
  const allVisibleSelected =
    items.length > 0 && items.every((item) => selectedItemIds.includes(item.id));

  return (
    <>
      {selectedCount > 0 ? (
        <div className="hidden border-b border-stone-200 bg-emerald-50/70 px-4 py-3 lg:flex lg:items-center lg:justify-between">
          <p className="text-base font-bold text-emerald-950 sm:text-sm sm:font-semibold">
            {selectedCount} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="min-h-12 rounded-md border border-red-700 bg-red-700 px-3 py-2 text-base font-bold text-white shadow-sm transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-700/25 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:text-sm sm:font-semibold"
              disabled={isDeleting}
              onClick={onDeleteSelected}
            >
              Delete selected
            </button>
            <button
              type="button"
              className="seller-secondary-button"
              disabled={isDeleting}
              onClick={onClearSelection}
            >
              Clear selection
            </button>
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 p-3 lg:hidden">
        <div className="flex justify-end">
          <AgeHeaderWithTooltip tooltipId="inventory-age-tooltip-mobile" />
        </div>
        {items.map((item) => (
          <FlatInventoryCard
            key={item.id}
            draftQuantities={draftQuantities}
            item={item}
            isSelected={selectedItemIds.includes(item.id)}
            onToggleSelection={onToggleSelection}
            updateDraftQuantity={updateDraftQuantity}
          />
        ))}
      </div>
      {selectedCount > 0 ? (
        <div className="sticky bottom-0 z-30 border-t border-emerald-900/20 bg-white/95 px-3 py-2 shadow-[0_-8px_20px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-base font-bold text-emerald-950 sm:text-sm sm:font-semibold">
              {selectedCount} selected
            </p>
            <button
              type="button"
              className="min-h-12 rounded-md border border-red-700 bg-red-700 px-3 py-2 text-base font-bold text-white shadow-sm transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-700/25 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-11 sm:text-sm sm:font-semibold"
              disabled={isDeleting}
              onClick={onDeleteSelected}
            >
              Delete selected
            </button>
            <button
              type="button"
              className="min-h-12 rounded-md border border-stone-300 bg-white px-3 py-2 text-base font-bold text-stone-800 shadow-sm transition hover:border-emerald-700 hover:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-11 sm:text-sm sm:font-semibold"
              disabled={isDeleting}
              onClick={onClearSelection}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[940px] border-collapse text-left text-[0.8125rem]">
          <thead className="bg-stone-50 text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-stone-500">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  aria-label="Select all visible inventory rows"
                  checked={allVisibleSelected}
                  className="size-4 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
                  type="checkbox"
                  onChange={(event) => onSelectVisible(event.target.checked)}
                />
              </th>
              <th className="px-3 py-2.5">Species</th>
              <th className="px-3 py-2.5">Breed / Item</th>
              <th className="px-3 py-2.5">Type/Sex</th>
              <th className="px-3 py-2.5">Hatch date</th>
              <th className="px-3 py-2.5">
                <AgeHeaderWithTooltip tooltipId="inventory-age-tooltip-table" />
              </th>
              <th className="px-3 py-2.5 text-center">Available</th>
              <th className="px-3 py-2.5 text-center">Reserved</th>
              <th className="px-3 py-2.5">Price</th>
              <th className="px-3 py-2.5">Availability</th>
              <th className="px-3 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 bg-white">
            {items.map((item) => (
              <FlatInventoryTableRow
                key={item.id}
                draftQuantities={draftQuantities}
                item={item}
                isSelected={selectedItemIds.includes(item.id)}
                onToggleSelection={onToggleSelection}
                updateDraftQuantity={updateDraftQuantity}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AgeHeaderWithTooltip({ tooltipId }: { tooltipId: string }) {
  return (
    <span className="group relative inline-flex items-center gap-1.5 align-middle">
      <span>Age</span>
      <button
        aria-describedby={tooltipId}
        aria-label="How age is calculated"
        className="inline-flex size-4 items-center justify-center rounded-full border border-stone-300 bg-white text-[0.625rem] font-bold leading-none text-stone-600 transition hover:border-emerald-700 hover:text-emerald-800 focus:border-emerald-700 focus:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
        type="button"
      >
        i
      </button>
      <span
        className="pointer-events-none absolute left-0 top-6 z-20 w-64 rounded-md border border-stone-200 bg-white px-3 py-2 text-left text-xs font-medium normal-case leading-5 tracking-normal text-stone-700 opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100"
        id={tooltipId}
        role="tooltip"
      >
        {ageTooltipText}
      </span>
    </span>
  );
}

function FlatInventoryTableRow({
  draftQuantities,
  isSelected,
  item,
  onToggleSelection,
  updateDraftQuantity,
}: {
  draftQuantities: Record<string, string>;
  isSelected: boolean;
  item: FlatInventoryItem;
  onToggleSelection: (itemId: string) => void;
  updateDraftQuantity: (row: InventoryRow, nextValue: string) => void;
}) {
  const isChanged = item.kind === "bird" && isRowChanged(item.row, draftQuantities);

  return (
    <tr
      className={
        isSelected
          ? "bg-emerald-50/80"
          : isChanged
            ? "bg-amber-50/70"
            : "bg-white"
      }
    >
      <td className="px-3 py-3 align-top">
        <input
          aria-label={`Select ${item.breedOrItem}`}
          checked={isSelected}
          className="size-4 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
          type="checkbox"
          onChange={() => onToggleSelection(item.id)}
        />
      </td>
      <td className="px-3 py-3 align-top font-medium text-stone-700">
        {item.species}
      </td>
      <td className="px-3 py-3 align-top">
        <Link
          className="font-semibold text-stone-950 underline-offset-4 hover:underline"
          href={item.manageHref}
        >
          {item.breedOrItem}
        </Link>
      </td>
      <td className="px-3 py-3 align-top text-stone-700">{item.typeSex}</td>
      <td className="px-3 py-3 align-top text-stone-700">
        {formatTableDate(item.hatchDate)}
      </td>
      <td className="px-3 py-3 align-top text-stone-700">{item.ageLabel}</td>
      <td className="px-3 py-3 text-center align-top">
        <AvailableQuantityControl
          draftQuantities={draftQuantities}
          item={item}
          updateDraftQuantity={updateDraftQuantity}
        />
      </td>
      <td className="px-3 py-3 text-center align-top font-medium text-stone-700">
        {item.reservedQuantity}
      </td>
      <td className="px-3 py-3 align-top font-medium text-stone-700">
        {formatCurrency(item.price)}
      </td>
      <td className="px-3 py-3 align-top">
        <AvailabilityPill label={item.availabilityLabel} />
      </td>
      <td className="px-3 py-3 text-right align-top">
        <Link
          className="text-xs font-semibold text-emerald-800 hover:text-emerald-950"
          href={item.manageHref}
        >
          Manage
        </Link>
      </td>
    </tr>
  );
}

function FlatInventoryCard({
  draftQuantities,
  isSelected,
  item,
  onToggleSelection,
  updateDraftQuantity,
}: {
  draftQuantities: Record<string, string>;
  isSelected: boolean;
  item: FlatInventoryItem;
  onToggleSelection: (itemId: string) => void;
  updateDraftQuantity: (row: InventoryRow, nextValue: string) => void;
}) {
  const isChanged = item.kind === "bird" && isRowChanged(item.row, draftQuantities);

  return (
    <article
      className={`rounded-lg border p-4 shadow-sm sm:p-3 ${
        isSelected
          ? "border-emerald-700 bg-emerald-50/70"
          : isChanged
            ? "border-amber-200 bg-amber-50/70"
            : "border-transparent bg-white sm:border-stone-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2">
          <input
            aria-label={`Select ${item.breedOrItem}`}
            checked={isSelected}
            className="mt-0.5 size-7 shrink-0 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700 sm:size-6"
            type="checkbox"
            onChange={() => onToggleSelection(item.id)}
          />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-stone-950">
              {item.breedOrItem}
            </h2>
            <p className="mt-0.5 text-sm leading-5 text-stone-600">
              {item.species}
              {item.typeSex !== "—" ? ` • ${item.typeSex}` : ""}
            </p>
          </div>
        </div>
        <AvailabilityPill label={item.availabilityLabel} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <InventoryCardField label="Hatch date" value={formatTableDate(item.hatchDate)} />
        <InventoryCardField label="Age" value={item.ageLabel} />
        <div className="rounded-md bg-stone-50 px-2.5 py-2">
          <dt className="text-sm font-bold uppercase tracking-[0.05em] text-stone-500 sm:text-xs sm:font-semibold">
            Available
          </dt>
          <dd className="mt-1">
            <AvailableQuantityControl
              draftQuantities={draftQuantities}
              item={item}
              updateDraftQuantity={updateDraftQuantity}
            />
          </dd>
        </div>
        <InventoryCardField
          label="Reserved"
          value={String(item.reservedQuantity)}
        />
        <InventoryCardField label="Price" value={formatCurrency(item.price)} />
        <InventoryCardField label="Availability" value={item.availabilityLabel} />
      </dl>

      <Link className="seller-small-button mt-4 inline-flex" href={item.manageHref}>
        Manage
      </Link>
    </article>
  );
}

function InventoryCardField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md bg-stone-50 px-2.5 py-2">
      <dt className="text-sm font-bold uppercase tracking-[0.05em] text-stone-500 sm:text-xs sm:font-semibold">
        {label}
      </dt>
      <dd className="mt-1 text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">{value}</dd>
    </div>
  );
}

function AvailableQuantityControl({
  draftQuantities,
  item,
  updateDraftQuantity,
}: {
  draftQuantities: Record<string, string>;
  item: FlatInventoryItem;
  updateDraftQuantity: (row: InventoryRow, nextValue: string) => void;
}) {
  if (item.kind === "equipment") {
    return (
      <span className="flex justify-center font-semibold text-stone-950">
        {item.availableQuantity}
      </span>
    );
  }

  const quantityValue =
    draftQuantities[item.row.inventory_item_id] ??
    String(item.row.quantity_available ?? 0);
  const isChanged = isRowChanged(item.row, draftQuantities);
  const rowHasInvalidQuantity =
    draftQuantities[item.row.inventory_item_id] != null &&
    !isValidQuantity(quantityValue);

  return (
    <div className="flex flex-col items-center">
      <input
        aria-label={`Available quantity for ${item.breedOrItem}`}
        className={`h-12 w-24 rounded-md border px-2 text-center text-lg font-bold text-stone-950 shadow-sm focus:outline-none focus:ring-2 sm:h-8 sm:w-16 sm:text-sm sm:font-semibold ${
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
        onChange={(event) => updateDraftQuantity(item.row, event.target.value)}
      />
      {isChanged ? (
        <p className="mt-1 text-sm font-semibold text-amber-700 sm:text-xs">
          Unsaved
        </p>
      ) : null}
    </div>
  );
}

function AvailabilityPill({ label }: { label: string }) {
  return (
    <span className="inline-flex min-h-7 items-center whitespace-nowrap rounded-full bg-stone-100 px-2.5 py-0.5 text-sm font-semibold text-stone-800 sm:min-h-0 sm:px-2 sm:text-[0.72rem]">
      {label}
    </span>
  );
}

function getAvailabilityFilterLabel(value: AvailabilityFilter) {
  if (value === "available_now") return "Available now";
  if (value === "future") return "Future availability";
  if (value === "sold_out") return "Sold out";
  if (value === "local_pickup") return "Local pickup";
  if (value === "not_listed") return "Not listed";
  if (value === "unavailable") return "Unavailable";

  return "All availability";
}

function ProcessedPoultryInventorySection({
  rows,
}: {
  rows: ProcessedPoultryInventoryRow[];
}) {
  return (
    <SellerCard className="overflow-hidden">
      <div className="border-b border-stone-200 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-stone-950">
              Processed Poultry
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Simple local-pickup processed poultry inventory. This does not
              affect the bird count above.
            </p>
          </div>
          <Link
            className="seller-secondary-button"
            href="/dashboard/listings/new/processed-poultry"
          >
            Add Processed Poultry
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No processed poultry inventory yet"
            description="Create processed poultry inventory when you have simple local-pickup products to sell."
          />
        </div>
      ) : (
        <>
          <div className="grid gap-4 p-4 lg:hidden">
            {rows.map((row) => (
              <ProcessedPoultryInventoryCard
                key={row.processed_poultry_inventory_item_id}
                row={row}
              />
            ))}
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-[0.06em] text-stone-500">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3">Poultry</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Quantity</th>
                  <th className="px-5 py-3">Price</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 bg-white">
                {rows.map((row) => (
                  <tr key={row.processed_poultry_inventory_item_id}>
                    <td className="px-5 py-4 align-top">
                      <Link
                        className="font-semibold text-stone-950 underline-offset-4 hover:underline"
                        href={`/dashboard/inventory/processed-poultry/${row.processed_poultry_inventory_item_id}`}
                      >
                        {row.product_name}
                      </Link>
                      {row.description ? (
                        <p className="mt-1 max-w-md truncate text-stone-600">
                          {row.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 align-top text-stone-700">
                      {row.poultry_type}
                    </td>
                    <td className="px-5 py-4 align-top text-stone-700">
                      {row.package_size
                        ? `${row.product_type} - ${row.package_size}`
                        : row.product_type}
                    </td>
                    <td className="px-5 py-4 align-top font-semibold text-stone-950">
                      {row.quantity_available}
                    </td>
                    <td className="px-5 py-4 align-top text-stone-700">
                      {formatProcessedPoultryCurrency(row.price)}
                    </td>
                    <td className="px-5 py-4 align-top">
                      <StatusBadge status={deriveProcessedPoultryBadge(row)} />
                    </td>
                    <td className="px-5 py-4 text-right align-top">
                      <Link
                        className="seller-small-button"
                        href={`/dashboard/inventory/processed-poultry/${row.processed_poultry_inventory_item_id}`}
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SellerCard>
  );
}

function ProcessedPoultryInventoryCard({
  row,
}: {
  row: ProcessedPoultryInventoryRow;
}) {
  return (
    <div className="rounded-md border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-stone-950">{row.product_name}</h3>
          <p className="mt-1 text-sm text-stone-600">
            {formatProcessedPoultryDescriptor(row)}
          </p>
        </div>
        <StatusBadge status={deriveProcessedPoultryBadge(row)} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-stone-50 px-3 py-2">
          <dt className="text-sm font-bold uppercase tracking-[0.06em] text-stone-500 sm:text-xs sm:font-semibold">
            Quantity
          </dt>
          <dd className="mt-1 text-lg font-semibold text-stone-950">
            {row.quantity_available}
          </dd>
        </div>
        <div className="rounded-md bg-stone-50 px-3 py-2">
          <dt className="text-sm font-bold uppercase tracking-[0.06em] text-stone-500 sm:text-xs sm:font-semibold">
            Price
          </dt>
          <dd className="mt-1 text-lg font-semibold text-stone-950">
            {formatProcessedPoultryCurrency(row.price)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-sm font-semibold text-stone-600">
        {formatProcessedPoultryStatus(row)}
      </p>
      <Link
        className="seller-small-button mt-4 inline-flex"
        href={`/dashboard/inventory/processed-poultry/${row.processed_poultry_inventory_item_id}`}
      >
        Manage
      </Link>
    </div>
  );
}

function deriveProcessedPoultryBadge(row: ProcessedPoultryInventoryRow) {
  if (row.visibility_status === "hidden") return "draft";
  if (row.visibility_status === "active") return "live";

  return row.visibility_status;
}

function buildFlatInventoryItems({
  draftQuantities,
  equipmentRows,
  reservedByItemId,
  rows,
}: {
  draftQuantities: Record<string, string>;
  equipmentRows: EquipmentInventoryRow[];
  reservedByItemId: Record<string, number>;
  rows: InventoryRow[];
}): FlatInventoryItem[] {
  return [
    ...rows.map((row): FlatInventoryItem => {
      const typeSex = getInventoryTypeLabel(row);
      const availability = getBirdAvailability(row, draftQuantities);

      return {
        kind: "bird",
        id: `bird:${row.inventory_item_id}`,
        species: row.species_name,
        speciesFilterValue: row.species_slug,
        breedOrItem: row.breed_display_name,
        typeSex,
        hatchDate: row.origin_date,
        availableDate: row.available_date,
        ageDays: calculateInventoryAgeDays(row),
        ageLabel: formatInventoryAge(row),
        availableQuantity: getDisplayedQuantity(row, draftQuantities),
        reservedQuantity: reservedByItemId[row.inventory_item_id] ?? 0,
        price: row.effective_unit_price,
        availabilityLabel: availability.label,
        availabilityValue: availability.value,
        manageHref: `/dashboard/inventory/${row.listing_batch_id}`,
        row,
        searchText: [
          row.breed_display_name,
          row.species_name,
          typeSex,
          row.custom_inventory_label,
          availability.label,
          formatInventoryStatus(row.operational_availability_status),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    }),
    ...equipmentRows.map((row): FlatInventoryItem => {
      const availability = getEquipmentAvailability(row);

      return {
        kind: "equipment",
        id: `equipment:${row.equipment_inventory_item_id}`,
        species: "Equipment",
        speciesFilterValue: "equipment",
        breedOrItem: row.item_name,
        typeSex: "—",
        hatchDate: null,
        availableDate: null,
        ageDays: null,
        ageLabel: "—",
        availableQuantity: row.quantity_available,
        reservedQuantity: 0,
        price: row.price,
        availabilityLabel: availability.label,
        availabilityValue: availability.value,
        manageHref: `/dashboard/inventory/equipment/${row.equipment_inventory_item_id}`,
        row,
        searchText: [
          row.item_name,
          row.category,
          row.condition,
          row.description,
          availability.label,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    }),
  ];
}

function getBirdAvailability(
  row: InventoryRow,
  draftQuantities: Record<string, string>,
): { label: string; value: AvailabilityFilter } {
  const visibility = getInventoryVisibility(row);

  if (visibility === "draft" || visibility === "hidden") {
    return { label: "Not listed", value: "not_listed" };
  }

  if (
    visibility === "sold_out" ||
    row.operational_availability_status === "sold_out" ||
    getDisplayedQuantity(row, draftQuantities) <= 0
  ) {
    return { label: "Sold out", value: "sold_out" };
  }

  if (visibility !== "live") {
    return { label: "Unavailable", value: "unavailable" };
  }

  if (row.available_date && isFutureDate(row.available_date)) {
    return {
      label: `Available ${formatShortDate(row.available_date)}`,
      value: "future",
    };
  }

  return { label: "Available now", value: "available_now" };
}

function getEquipmentAvailability(row: EquipmentInventoryRow): {
  label: string;
  value: AvailabilityFilter;
} {
  if (row.visibility_status === "hidden") {
    return { label: "Not listed", value: "not_listed" };
  }

  if (row.operational_availability_status === "sold_out") {
    return { label: "Sold out", value: "sold_out" };
  }

  if (row.visibility_status !== "active") {
    return { label: "Unavailable", value: "unavailable" };
  }

  return { label: "Local pickup", value: "local_pickup" };
}

function compareFlatInventoryItems(
  left: FlatInventoryItem,
  right: FlatInventoryItem,
  sortBy: InventorySort,
) {
  if (sortBy === "hatch_date") {
    const hatchDateComparison = compareNullableDates(
      left.hatchDate,
      right.hatchDate,
    );

    if (hatchDateComparison !== 0) return hatchDateComparison;

    return left.breedOrItem.localeCompare(right.breedOrItem);
  }

  if (sortBy === "name") {
    return left.breedOrItem.localeCompare(right.breedOrItem);
  }

  if (sortBy === "age") {
    return compareNullableNumbers(left.ageDays, right.ageDays);
  }

  if (sortBy === "available") {
    return right.availableQuantity - left.availableQuantity;
  }

  if (sortBy === "reserved") {
    return right.reservedQuantity - left.reservedQuantity;
  }

  if (sortBy === "price") {
    return compareNullableNumbers(left.price, right.price);
  }

  const availabilityComparison = left.availabilityLabel.localeCompare(
    right.availabilityLabel,
  );

  if (availabilityComparison !== 0) return availabilityComparison;

  return left.breedOrItem.localeCompare(right.breedOrItem);
}

function compareNullableDates(left: string | null, right: string | null) {
  if (left && right && left !== right) return left.localeCompare(right);
  if (left && !right) return -1;
  if (!left && right) return 1;

  return 0;
}

function compareNullableNumbers(
  left: number | null | undefined,
  right: number | null | undefined,
) {
  if (left != null && right != null && left !== right) return left - right;
  if (left != null && right == null) return -1;
  if (left == null && right != null) return 1;

  return 0;
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

function isLiveBirdInventoryRow(row: InventoryRow) {
  return (
    row.batch_type !== "hatching_eggs" &&
    row.inventory_type !== "hatching_eggs"
  );
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

function formatTableDate(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function calculateInventoryAgeDays(row: InventoryRow) {
  return calculateAgeAtAvailabilityDays(row.origin_date ?? "", row.available_date);
}

function formatInventoryAge(row: InventoryRow) {
  return formatAgeAtAvailabilityFromDates(row.origin_date, row.available_date);
}

function matchesAgeFilter(row: InventoryRow, ageFilter: AgeFilter) {
  if (ageFilter === "all") return true;

  const ageDays = calculateInventoryAgeDays(row);

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
