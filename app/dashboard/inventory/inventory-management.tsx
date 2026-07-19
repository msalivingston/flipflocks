"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpDown, Funnel } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
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
  cleared_at: string | null;
  inventory_updated_at: string | null;
};

type ReservedRow = {
  inventory_item_id: string | null;
  equipment_inventory_item_id: string | null;
  processed_poultry_inventory_item_id: string | null;
  remaining_unfulfilled_quantity: number | null;
};

type HatchingEggInventoryRow = {
  hatching_egg_inventory_item_id: string;
  store_id: string;
  item_name: string;
  species_id: string;
  species_name: string;
  species_slug: string;
  description: string | null;
  quantity_available: number;
  price: number;
  available_date: string;
  minimum_order_quantity: number | null;
  visibility_status: string;
  moderation_status: string;
  operational_availability_status: string;
  seller_notes: string | null;
  first_published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type InventoryMediaRow = {
  entity_id: string;
  public_url: string | null;
  alt_text: string | null;
};

type InventoryPrimaryPhoto = {
  url: string;
  alt: string;
};

type InventoryProductTab =
  | "live_poultry"
  | "hatching_eggs"
  | "processed_poultry"
  | "equipment";
type AgeFilter = "all" | "0_6" | "7_12" | "13_24" | "25_plus" | "unknown";
type InventoryVisibility = "draft" | "live" | "hidden" | "archived" | "sold_out";
type AvailabilityFilter =
  | "current_inventory"
  | "available_now"
  | "coming_soon"
  | "sold_out"
  | "hidden"
  | "cleared";
type InventorySort =
  | "hatch_date"
  | "breed"
  | "product_name"
  | "item_name"
  | "name"
  | "age"
  | "available"
  | "reserved"
  | "price"
  | "availability"
  | "recently_added";

type InventoryTabFilters = {
  species: string;
  typeSex: string;
  age: AgeFilter;
  breed: string;
  productCategory: string;
  equipmentCategory: string;
  condition: string;
  availability: AvailabilityFilter;
  search: string;
  sortBy: InventorySort;
};

type ClearedInventoryEntry = {
  cleared_inventory_item_id: string;
};

type FlatInventoryItem =
  | {
      kind: "bird";
      productTab: "live_poultry";
      id: string;
      species: string;
      speciesFilterValue: string;
      breedFilterValue: string;
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
      isCleared: boolean;
      manageHref: string;
      primaryPhoto: InventoryPrimaryPhoto | null;
      searchText: string;
      row: InventoryRow;
    }
  | {
      kind: "hatching_egg";
      productTab: "hatching_eggs";
      id: string;
      species: string;
      speciesFilterValue: string;
      breedFilterValue: string;
      breedOrItem: string;
      typeSex: "Hatching Eggs";
      hatchDate: null;
      availableDate: string;
      ageDays: null;
      ageLabel: string;
      availableQuantity: number;
      reservedQuantity: 0;
      price: number;
      availabilityLabel: string;
      availabilityValue: AvailabilityFilter;
      isCleared: false;
      manageHref: string;
      primaryPhoto: InventoryPrimaryPhoto | null;
      searchText: string;
      row: HatchingEggInventoryRow;
    }
  | {
      kind: "processed_poultry";
      productTab: "processed_poultry";
      id: string;
      species: "Poultry Products";
      speciesFilterValue: "processed_poultry";
      breedFilterValue: string;
      breedOrItem: string;
      productCategory: string;
      typeSex: string;
      hatchDate: null;
      availableDate: null;
      ageDays: null;
      ageLabel: string;
      availableQuantity: number;
      reservedQuantity: number;
      price: number;
      availabilityLabel: string;
      availabilityValue: AvailabilityFilter;
      isCleared: false;
      manageHref: string;
      primaryPhoto: InventoryPrimaryPhoto | null;
      searchText: string;
      row: ProcessedPoultryInventoryRow;
    }
  | {
      kind: "equipment";
      productTab: "equipment";
      id: string;
      species: "Equipment";
      speciesFilterValue: "equipment";
      breedFilterValue: string;
      breedOrItem: string;
      equipmentCategory: string;
      condition: string;
      typeSex: string;
      hatchDate: null;
      availableDate: null;
      ageDays: null;
      ageLabel: string;
      availableQuantity: number;
      reservedQuantity: number;
      price: number;
      availabilityLabel: string;
      availabilityValue: AvailabilityFilter;
      isCleared: false;
      manageHref: string;
      primaryPhoto: InventoryPrimaryPhoto | null;
      searchText: string;
      row: EquipmentInventoryRow;
    };

type BirdInventoryItem = Extract<FlatInventoryItem, { kind: "bird" }>;

const unsavedWarning =
  "You have unsaved inventory changes. Save or discard before leaving.";
const ageTooltipText =
  "Age shows the first available age until the available date arrives, then updates to the bird’s current age.";
const reservedTooltipText =
  "Reserved inventory has been sold but not picked up or fulfilled yet.";

const ageFilterOptions: { label: string; value: AgeFilter }[] = [
  { label: "All ages", value: "all" },
  { label: "0-6 weeks", value: "0_6" },
  { label: "7-12 weeks", value: "7_12" },
  { label: "13-24 weeks", value: "13_24" },
  { label: "25+ weeks", value: "25_plus" },
  { label: "Age not set", value: "unknown" },
];

const inventoryProductTabs: Array<{ id: InventoryProductTab; label: string }> = [
  { id: "live_poultry", label: "Live Poultry" },
  { id: "hatching_eggs", label: "Hatching Eggs" },
  { id: "processed_poultry", label: "Poultry Products" },
  { id: "equipment", label: "Equipment & Supplies" },
];

const defaultTabFilters: Record<InventoryProductTab, InventoryTabFilters> = {
  live_poultry: {
    species: "all",
    typeSex: "all",
    age: "all",
    breed: "all",
    productCategory: "all",
    equipmentCategory: "all",
    condition: "all",
    availability: "current_inventory",
    search: "",
    sortBy: "hatch_date",
  },
  hatching_eggs: {
    species: "all",
    typeSex: "all",
    age: "all",
    breed: "all",
    productCategory: "all",
    equipmentCategory: "all",
    condition: "all",
    availability: "current_inventory",
    search: "",
    sortBy: "breed",
  },
  processed_poultry: {
    species: "all",
    typeSex: "all",
    age: "all",
    breed: "all",
    productCategory: "all",
    equipmentCategory: "all",
    condition: "all",
    availability: "current_inventory",
    search: "",
    sortBy: "product_name",
  },
  equipment: {
    species: "all",
    typeSex: "all",
    age: "all",
    breed: "all",
    productCategory: "all",
    equipmentCategory: "all",
    condition: "all",
    availability: "current_inventory",
    search: "",
    sortBy: "item_name",
  },
};

export function InventoryManagement() {
  const { seller } = useSellerContext();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [equipmentRows, setEquipmentRows] = useState<EquipmentInventoryRow[]>([]);
  const [processedPoultryRows, setProcessedPoultryRows] = useState<
    ProcessedPoultryInventoryRow[]
  >([]);
  const [hatchingEggRows, setHatchingEggRows] = useState<
    HatchingEggInventoryRow[]
  >([]);
  const [hatchingEggPrimaryPhotos, setHatchingEggPrimaryPhotos] = useState<
    Record<string, InventoryPrimaryPhoto>
  >({});
  const [reservedByItemId, setReservedByItemId] = useState<
    Record<string, number>
  >({});
  const [reservedByEquipmentId, setReservedByEquipmentId] = useState<
    Record<string, number>
  >({});
  const [reservedByProcessedPoultryId, setReservedByProcessedPoultryId] =
    useState<Record<string, number>>({});
  const [draftQuantities, setDraftQuantities] = useState<
    Record<string, string>
  >({});
  const [activeTab, setActiveTab] =
    useState<InventoryProductTab>("live_poultry");
  const [filtersByTab, setFiltersByTab] =
    useState<Record<InventoryProductTab, InventoryTabFilters>>(
      defaultTabFilters,
    );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
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
        hatchingEggResult,
        hatchingEggMediaResult,
      ] = await Promise.all([
        supabase
          .from("seller_inventory_management")
          .select(
            "store_id, listing_batch_id, inventory_item_id, species_name, species_slug, breed_display_name, batch_type, origin_date, available_date, quantity_available, inventory_type, custom_inventory_label, effective_unit_price, inventory_visibility_status, inventory_moderation_status, listing_batch_visibility_status, listing_batch_moderation_status, operational_availability_status, cleared_at, inventory_updated_at",
          )
          .eq("store_id", seller.store_id)
          .neq("inventory_visibility_status", "archived")
          .neq("listing_batch_visibility_status", "archived")
          .neq("batch_type", "hatching_eggs")
          .neq("inventory_type", "hatching_eggs")
          .eq("inventory_moderation_status", "normal")
          .eq("listing_batch_moderation_status", "normal")
          .order("species_name", { ascending: true })
          .order("breed_display_name", { ascending: true })
          .returns<InventoryRow[]>(),
        supabase
          .from("seller_order_item_detail")
          .select(
            "inventory_item_id, equipment_inventory_item_id, processed_poultry_inventory_item_id, remaining_unfulfilled_quantity",
          )
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
        supabase
          .from("seller_hatching_egg_inventory_management")
          .select("*")
          .eq("store_id", seller.store_id)
          .neq("visibility_status", "archived")
          .eq("moderation_status", "normal")
          .order("updated_at", { ascending: false })
          .returns<HatchingEggInventoryRow[]>(),
        supabase
          .from("seller_media_management")
          .select("entity_id, public_url, alt_text")
          .eq("store_id", seller.store_id)
          .eq("entity_type", "hatching_egg_inventory_item")
          .eq("display_context", "gallery")
          .eq("visibility_status", "active")
          .eq("moderation_status", "normal")
          .order("is_featured", { ascending: false })
          .order("sort_order", { ascending: true })
          .returns<InventoryMediaRow[]>(),
      ]);

      if (!isMounted) return;

      const firstError =
        inventoryResult.error ??
        reservedResult.error ??
        equipmentResult.error ??
        processedPoultryResult.error ??
        hatchingEggResult.error ??
        hatchingEggMediaResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      setRows(inventoryResult.data ?? []);
      setEquipmentRows(equipmentResult.data ?? []);
      setProcessedPoultryRows(processedPoultryResult.data ?? []);
      setHatchingEggRows(hatchingEggResult.data ?? []);
      setHatchingEggPrimaryPhotos(
        buildPrimaryPhotoMap(hatchingEggMediaResult.data ?? []),
      );
      setReservedByItemId(
        buildReservedMap(reservedResult.data ?? [], "inventory_item_id"),
      );
      setReservedByEquipmentId(
        buildReservedMap(
          reservedResult.data ?? [],
          "equipment_inventory_item_id",
        ),
      );
      setReservedByProcessedPoultryId(
        buildReservedMap(
          reservedResult.data ?? [],
          "processed_poultry_inventory_item_id",
        ),
      );
      setDraftQuantities({});
      setIsLoading(false);
    }

    void loadInventory();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const inventoryItems = useMemo(
    () =>
      buildFlatInventoryItems({
        draftQuantities,
        equipmentRows,
        hatchingEggPrimaryPhotos,
        hatchingEggRows,
        processedPoultryRows,
        reservedByEquipmentId,
        reservedByItemId,
        reservedByProcessedPoultryId,
        rows,
      }),
    [
      draftQuantities,
      equipmentRows,
      hatchingEggPrimaryPhotos,
      hatchingEggRows,
      processedPoultryRows,
      reservedByEquipmentId,
      reservedByItemId,
      reservedByProcessedPoultryId,
      rows,
    ],
  );

  const changedBirdRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          isLiveBirdInventoryRow(row) && isBirdRowChanged(row, draftQuantities),
      ),
    [draftQuantities, rows],
  );
  const changedEquipmentRows = useMemo(
    () =>
      equipmentRows.filter((row) =>
        isSimpleQuantityChanged(
          row.equipment_inventory_item_id,
          row.quantity_available,
          draftQuantities,
        ),
      ),
    [draftQuantities, equipmentRows],
  );
  const changedProcessedPoultryRows = useMemo(
    () =>
      processedPoultryRows.filter((row) =>
        isSimpleQuantityChanged(
          row.processed_poultry_inventory_item_id,
          row.quantity_available,
          draftQuantities,
        ),
      ),
    [draftQuantities, processedPoultryRows],
  );
  const changedCount =
    changedBirdRows.length +
    changedEquipmentRows.length +
    changedProcessedPoultryRows.length;
  const hasUnsavedChanges = changedCount > 0;

  useUnsavedInventoryWarning(hasUnsavedChanges);

  const visibleTabs = useMemo(
    () =>
      inventoryProductTabs.filter((tab) => {
        if (tab.id === "live_poultry") return true;
        if (tab.id === "hatching_eggs") {
          return Boolean(seller?.hatching_eggs_enabled);
        }
        if (tab.id === "processed_poultry") {
          return Boolean(seller?.processed_poultry_enabled);
        }
        if (tab.id === "equipment") {
          return Boolean(seller?.equipment_supplies_enabled);
        }

        return false;
      }),
    [seller],
  );

  const activeFilters = filtersByTab[activeTab];
  const activeTabItems = useMemo(
    () => inventoryItems.filter((item) => item.productTab === activeTab),
    [activeTab, inventoryItems],
  );
  const hasClearedItems = useMemo(
    () => activeTabItems.some((item) => item.isCleared),
    [activeTabItems],
  );
  const effectiveAvailability: AvailabilityFilter =
    activeFilters.availability === "cleared" && !hasClearedItems
      ? "current_inventory"
      : activeFilters.availability;
  const effectiveActiveFilters = useMemo(
    () =>
      effectiveAvailability === activeFilters.availability
        ? activeFilters
        : { ...activeFilters, availability: effectiveAvailability },
    [activeFilters, effectiveAvailability],
  );
  const statusScopedItems = useMemo(
    () => filterInventoryItemsByStatus(activeTabItems, effectiveAvailability),
    [activeTabItems, effectiveAvailability],
  );
  const filterOptions = useMemo(
    () =>
      buildFilterOptions(
        activeTab,
        activeTabItems,
        statusScopedItems,
        effectiveAvailability,
      ),
    [activeTab, activeTabItems, effectiveAvailability, statusScopedItems],
  );
  const activeSortOptions = useMemo(
    () => getSortOptionsForTab(activeTab),
    [activeTab],
  );
  const hasActiveFilters = useMemo(
    () =>
      JSON.stringify(effectiveActiveFilters) !==
      JSON.stringify(defaultTabFilters[activeTab]),
    [effectiveActiveFilters, activeTab],
  );

  const filteredItems = useMemo(
    () =>
      filterAndSortInventoryItems(
        statusScopedItems,
        effectiveActiveFilters,
        activeTab,
      ),
    [activeTab, effectiveActiveFilters, statusScopedItems],
  );

  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selectedItemIds.includes(item.id)),
    [filteredItems, selectedItemIds],
  );
  const selectedCount = selectedItems.length;
  const visibleSelectedItemIds = selectedItems.map((item) => item.id);
  const selectedClearCounts = useMemo(
    () => getClearSoldOutCounts(selectedItems),
    [selectedItems],
  );

  const summary = useMemo(
    () => buildInventorySummary(activeTab, statusScopedItems),
    [activeTab, statusScopedItems],
  );

  function updateActiveFilter<TKey extends keyof InventoryTabFilters>(
    key: TKey,
    value: InventoryTabFilters[TKey],
  ) {
    setFiltersByTab((current) => ({
      ...current,
      [activeTab]: {
        ...current[activeTab],
        [key]: value,
      },
    }));
  }

  function resetActiveFilters() {
    setFiltersByTab((current) => ({
      ...current,
      [activeTab]: defaultTabFilters[activeTab],
    }));
  }

  function updateDraftQuantity(item: FlatInventoryItem, nextValue: string) {
    setDraftQuantities((current) => {
      const draftId = getDraftQuantityId(item);
      const originalValue = String(getOriginalQuantity(item));

      if (nextValue === originalValue) {
        const remaining = { ...current };
        delete remaining[draftId];

        return remaining;
      }

      return {
        ...current,
        [draftId]: nextValue,
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
    if (!seller || isSaving || changedCount === 0) return;

    const validationMessage = validateChangedQuantities(
      [
        ...changedBirdRows.map((row) => row.inventory_item_id),
        ...changedEquipmentRows.map((row) => row.equipment_inventory_item_id),
        ...changedProcessedPoultryRows.map(
          (row) => row.processed_poultry_inventory_item_id,
        ),
      ],
      draftQuantities,
    );

    if (validationMessage) {
      setSaveError(validationMessage);
      setSuccessMessage(null);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    for (const row of changedBirdRows) {
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

    for (const row of changedEquipmentRows) {
      const result = await supabase.rpc("seller_update_equipment_inventory_item", {
        p_equipment_inventory_item_id: row.equipment_inventory_item_id,
        p_item_name: row.item_name,
        p_category: row.category,
        p_quantity_available: Number(
          draftQuantities[row.equipment_inventory_item_id],
        ),
        p_price: row.price,
        p_condition: row.condition || null,
        p_description: row.description || null,
        p_seller_notes: row.seller_notes || null,
      });

      if (result.error) {
        setSaveError(result.error.message);
        setIsSaving(false);
        return;
      }
    }

    for (const row of changedProcessedPoultryRows) {
      const result = await supabase.rpc(
        "seller_update_processed_poultry_inventory_item",
        {
          p_processed_poultry_inventory_item_id:
            row.processed_poultry_inventory_item_id,
          p_product_name: row.product_name,
          p_poultry_type: row.poultry_type,
          p_product_type: row.product_type,
          p_quantity_available: Number(
            draftQuantities[row.processed_poultry_inventory_item_id],
          ),
          p_price: row.price,
          p_package_size: row.package_size || null,
          p_description: row.description || null,
          p_seller_notes: row.seller_notes || null,
        },
      );

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

        const nextQuantity = Number(draftValue);

        return {
          ...row,
          quantity_available: nextQuantity,
          cleared_at: nextQuantity > 0 ? null : row.cleared_at,
        };
      }),
    );
    setEquipmentRows((current) =>
      current.map((row) => {
        const draftValue = draftQuantities[row.equipment_inventory_item_id];

        if (draftValue == null) return row;

        return {
          ...row,
          quantity_available: Number(draftValue),
        };
      }),
    );
    setProcessedPoultryRows((current) =>
      current.map((row) => {
        const draftValue =
          draftQuantities[row.processed_poultry_inventory_item_id];

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
    setIsClearConfirmOpen(false);
  }

  function requestClearSoldOutItems() {
    if (selectedItems.length === 0 || isClearing) return;

    if (selectedClearCounts.eligibleCount === 0) {
      setSaveError("Only sold-out items can be cleared.");
      setSuccessMessage(null);
      return;
    }

    setSaveError(null);
    setSuccessMessage(null);
    setIsClearConfirmOpen(true);
  }

  async function clearSelectedInventory() {
    if (!seller || selectedItems.length === 0 || isClearing) return;

    const eligibleItems = getClearSoldOutEligibleItems(selectedItems);
    const selectedBirdIds = eligibleItems.map((item) => item.row.inventory_item_id);
    const unchangedCount = selectedItems.length - selectedBirdIds.length;

    if (selectedBirdIds.length === 0) {
      setSaveError("Only sold-out items can be cleared.");
      setIsClearConfirmOpen(false);
      return;
    }

    setIsClearing(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const result = await supabase.rpc("seller_clear_inventory_items", {
        p_inventory_item_ids: selectedBirdIds,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      const clearedEntries = Array.isArray(result.data)
        ? (result.data as ClearedInventoryEntry[])
        : [];
      const clearedIds = new Set(
        clearedEntries.map((entry) => entry.cleared_inventory_item_id),
      );

      if (clearedIds.size === 0) {
        throw new Error("No inventory rows were cleared.");
      }

      const clearedAt = new Date().toISOString();
      setRows((current) =>
        current.map((row) =>
          clearedIds.has(row.inventory_item_id)
            ? { ...row, cleared_at: row.cleared_at ?? clearedAt }
            : row,
        ),
      );
      setSelectedItemIds((current) =>
        current.filter((selectedId) => {
          const item = selectedItems.find(
            (selectedItem) => selectedItem.id === selectedId,
          );
          const inventoryItemId = item ? getInventoryItemIdForClear(item) : null;

          return inventoryItemId ? !clearedIds.has(inventoryItemId) : false;
        }),
      );
      setSuccessMessage(
        unchangedCount > 0
          ? `${clearedIds.size} sold-out ${
              clearedIds.size === 1 ? "item" : "items"
            } cleared. ${unchangedCount} ${
              unchangedCount === 1 ? "item was" : "items were"
            } not changed.`
          : `${clearedIds.size} sold-out ${
              clearedIds.size === 1 ? "item" : "items"
            } cleared.`,
      );
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not clear selected inventory rows.",
      );
    } finally {
      setIsClearConfirmOpen(false);
      setIsClearing(false);
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
    <div className={`space-y-3 ${hasUnsavedChanges ? "pb-28" : ""}`}>
      <InventoryProductTabs
        activeTab={activeTab}
        tabs={visibleTabs}
        onChange={(tab) => {
          setActiveTab(tab);
          setSelectedItemIds([]);
          setSaveError(null);
          setSuccessMessage(null);
        }}
      />

      <SellerCard className="p-3">
        <div className="grid gap-2 md:grid-cols-3">
          <InventorySummaryCard
            glyph={summary.availableGlyph}
            label={summary.availableLabel}
            value={summary.availableValue}
          />
          <InventorySummaryCard
            glyph="/glyphs/calendar.png"
            label={summary.reservedLabel}
            value={summary.reservedValue}
          />
          <InventorySummaryCard
            glyph="/glyphs/shopping-bag.png"
            label="Unsold Inventory Value"
            value={formatCurrency(summary.inventoryValue)}
          />
        </div>

        {hasUnsavedChanges ? (
          <p className="mt-2 text-sm font-medium text-amber-700">
            {changedCount} unsaved row
            {changedCount === 1 ? "" : "s"}
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

      <SellerCard className="p-3 [&_input]:w-full [&_label]:min-w-0 [&_select]:w-full">
        <div className="grid gap-3 lg:grid-flow-col lg:auto-cols-[minmax(0,1fr)] lg:items-end">
          <label className="grid gap-1 text-[13px] font-bold text-stone-700">
            Search
            <input
              className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm placeholder:text-stone-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 lg:min-h-10 lg:px-2.5"
              placeholder={getSearchPlaceholder(activeTab)}
              value={activeFilters.search}
              onChange={(event) =>
                updateActiveFilter("search", event.target.value)
              }
            />
          </label>
          {activeTab === "live_poultry" ? (
            <InventorySelectControl
              icon="filter"
              label="Species"
              value={activeFilters.species}
              options={filterOptions.species}
              onChange={(value) => updateActiveFilter("species", value)}
            />
          ) : null}
          {activeTab === "live_poultry" ? (
            <InventorySelectControl
              icon="filter"
              label="Type/Sex"
              value={activeFilters.typeSex}
              options={filterOptions.typeSex}
              onChange={(value) => updateActiveFilter("typeSex", value)}
            />
          ) : null}
          {activeTab === "live_poultry" ? (
            <InventorySelectControl
              icon="filter"
              label="Age Range"
              value={activeFilters.age}
              options={ageFilterOptions}
              onChange={(value) => updateActiveFilter("age", value as AgeFilter)}
            />
          ) : null}
          {activeTab === "hatching_eggs" ? (
            <InventorySelectControl
              icon="filter"
              label="Species"
              value={activeFilters.species}
              options={filterOptions.species}
              onChange={(value) => updateActiveFilter("species", value)}
            />
          ) : null}
          {activeTab === "hatching_eggs" ? (
            <InventorySelectControl
              icon="filter"
              label="Breed"
              value={activeFilters.breed}
              options={filterOptions.breed}
              onChange={(value) => updateActiveFilter("breed", value)}
            />
          ) : null}
          {activeTab === "processed_poultry" ? (
            <InventorySelectControl
              icon="filter"
              label="Product Category"
              value={activeFilters.productCategory}
              options={filterOptions.productCategory}
              onChange={(value) =>
                updateActiveFilter("productCategory", value)
              }
            />
          ) : null}
          {activeTab === "equipment" ? (
            <InventorySelectControl
              icon="filter"
              label="Category"
              value={activeFilters.equipmentCategory}
              options={filterOptions.equipmentCategory}
              onChange={(value) =>
                updateActiveFilter("equipmentCategory", value)
              }
            />
          ) : null}
          {activeTab === "equipment" ? (
            <InventorySelectControl
              icon="filter"
              label="Condition"
              value={activeFilters.condition}
              options={filterOptions.condition}
              onChange={(value) => updateActiveFilter("condition", value)}
            />
          ) : null}
          <InventorySelectControl
            icon="filter"
            label="Status"
            value={effectiveActiveFilters.availability}
            options={filterOptions.availability}
            onChange={(value) =>
              updateActiveFilter("availability", value as AvailabilityFilter)
            }
          />
          <InventorySelectControl
            icon="sort"
            label="Sort by"
            value={activeFilters.sortBy}
            options={activeSortOptions}
            onChange={(value) =>
              updateActiveFilter("sortBy", value as InventorySort)
            }
          />
        </div>
        {hasActiveFilters ? (
          <button
            type="button"
            className="mt-3 text-sm font-semibold text-emerald-800 underline-offset-4 hover:text-emerald-950 hover:underline"
            onClick={resetActiveFilters}
          >
            Reset filters
          </button>
        ) : null}
      </SellerCard>

      <SellerCard className="overflow-hidden">
        {activeTabItems.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={getEmptyInventoryTitle(activeTab)}
              description={getEmptyInventoryDescription(activeTab)}
              action={
                <Link
                  className="inline-flex min-h-10 items-center justify-center rounded-full bg-emerald-800 px-4 text-sm font-bold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
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
            hideClearSoldOutAction={
              effectiveActiveFilters.availability === "cleared"
            }
            items={filteredItems}
            isClearing={isClearing}
            onClearSelection={clearSelection}
            onClearSoldOutItems={requestClearSoldOutItems}
            onSelectVisible={setVisibleSelection}
            onToggleSelection={toggleItemSelection}
            selectedItemIds={visibleSelectedItemIds}
            tab={activeTab}
            updateDraftQuantity={updateDraftQuantity}
          />
        )}
      </SellerCard>

      {isClearConfirmOpen ? (
        <ClearInventoryConfirmModal
          eligibleCount={selectedClearCounts.eligibleCount}
          isClearing={isClearing}
          selectedCount={selectedCount}
          unchangedCount={selectedClearCounts.unchangedCount}
          onCancel={() => setIsClearConfirmOpen(false)}
          onConfirm={clearSelectedInventory}
        />
      ) : null}

      {hasUnsavedChanges ? (
        <InventorySaveBar
          changedCount={changedCount}
          isSaving={isSaving}
          onDiscard={discardChanges}
          onSave={saveChanges}
        />
      ) : null}
    </div>
  );
}

function InventoryProductTabs({
  activeTab,
  onChange,
  tabs,
}: {
  activeTab: InventoryProductTab;
  onChange: (tab: InventoryProductTab) => void;
  tabs: Array<{ id: InventoryProductTab; label: string }>;
}) {
  return (
    <div
      aria-label="Inventory product types"
      className="flex gap-1 overflow-x-auto border-b border-stone-200 pl-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;

        return (
          <button
            aria-selected={isActive}
            className={`relative mb-[-1px] min-h-11 shrink-0 rounded-t-lg border px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700 ${
              isActive
                ? "border-stone-200 border-b-white bg-white text-stone-950 shadow-[0_-1px_0_rgba(0,0,0,0.02)]"
                : "border-transparent bg-stone-100/70 text-stone-600 hover:bg-white hover:text-stone-950"
            }`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function InventorySaveBar({
  changedCount,
  isSaving,
  onDiscard,
  onSave,
}: {
  changedCount: number;
  isSaving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-200 bg-white/95 px-4 py-3 shadow-[0_-10px_30px_rgba(0,0,0,0.12)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base font-bold text-stone-950 sm:text-sm">
          Unsaved changes
          <span className="ml-2 font-semibold text-stone-600">
            {changedCount} row{changedCount === 1 ? "" : "s"}
          </span>
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button
            type="button"
            className="seller-secondary-button"
            disabled={isSaving}
            onClick={onDiscard}
          >
            Discard Changes
          </button>
          <button
            type="button"
            className="seller-primary-button"
            disabled={isSaving}
            onClick={onSave}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InventorySelectControl({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: "filter" | "sort";
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  const Icon = icon === "filter" ? Funnel : ArrowUpDown;

  return (
    <label className="grid gap-1 text-[13px] font-bold text-stone-700">
      <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <Icon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-emerald-800"
          strokeWidth={2.25}
        />
        {label}
      </span>
      <select
        className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 lg:min-h-10 lg:px-2.5"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function InventorySummaryCard({
  glyph,
  label,
  value,
}: {
  glyph: string;
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex min-h-16 items-center gap-2.5 rounded-md border border-stone-200 bg-white px-3 py-2.5 shadow-sm">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-900/5">
        <Image src={glyph} alt="" width={21} height={21} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold uppercase tracking-[0.05em] text-stone-500 sm:text-[0.68rem]">
          {label}
          {label.startsWith("Reserved") ? (
            <InfoTooltip
              label="What reserved means"
              text={reservedTooltipText}
              tooltipId={`inventory-summary-${label.toLowerCase().replaceAll(" ", "-")}-tooltip`}
            />
          ) : null}
        </p>
        <p className="mt-0.5 text-2xl font-bold leading-none text-stone-950 sm:text-xl sm:font-semibold">
          {value}
        </p>
      </div>
    </div>
  );
}

function ClearInventoryConfirmModal({
  eligibleCount,
  isClearing,
  selectedCount,
  unchangedCount,
  onCancel,
  onConfirm,
}: {
  eligibleCount: number;
  isClearing: boolean;
  selectedCount: number;
  unchangedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const body =
    unchangedCount > 0
      ? `You selected ${selectedCount} items. ${eligibleCount} sold-out ${
          eligibleCount === 1 ? "item" : "items"
        } will be removed from your Current inventory view. ${unchangedCount} ${
          unchangedCount === 1 ? "item" : "items"
        } with inventory available will stay unchanged. If quantity is added later, cleared items will return automatically.`
      : "These items will be removed from your Current inventory view. If quantity is added later, they will return automatically.";

  return (
    <div
      aria-labelledby="clear-inventory-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-md border border-stone-200 bg-white p-5 shadow-xl">
        <h2
          className="text-lg font-semibold leading-7 text-stone-950"
          id="clear-inventory-title"
        >
          Clear sold-out items?
        </h2>
        <p className="mt-3 text-sm leading-6 text-stone-700">
          {body}
        </p>
        <p className="mt-3 text-sm font-semibold text-stone-950">
          {selectedCount} selected
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="seller-secondary-button"
            disabled={isClearing}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="seller-primary-button"
            disabled={isClearing || eligibleCount === 0}
            onClick={onConfirm}
          >
            {isClearing ? "Clearing..." : "Clear sold-out items"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FlatInventoryTable({
  draftQuantities,
  hideClearSoldOutAction,
  isClearing,
  items,
  onClearSelection,
  onClearSoldOutItems,
  onSelectVisible,
  onToggleSelection,
  selectedItemIds,
  tab,
  updateDraftQuantity,
}: {
  draftQuantities: Record<string, string>;
  hideClearSoldOutAction: boolean;
  isClearing: boolean;
  items: FlatInventoryItem[];
  onClearSelection: () => void;
  onClearSoldOutItems: () => void;
  onSelectVisible: (shouldSelect: boolean) => void;
  onToggleSelection: (itemId: string) => void;
  selectedItemIds: string[];
  tab: InventoryProductTab;
  updateDraftQuantity: (item: FlatInventoryItem, nextValue: string) => void;
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
            {!hideClearSoldOutAction ? (
              <button
                type="button"
                className="min-h-12 rounded-md border border-emerald-800 bg-emerald-800 px-3 py-2 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800/25 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:text-sm sm:font-semibold"
                disabled={isClearing}
                onClick={onClearSoldOutItems}
              >
                Clear sold-out items
              </button>
            ) : null}
            <button
              type="button"
              className="seller-secondary-button"
              disabled={isClearing}
              onClick={onClearSelection}
            >
              Clear selection
            </button>
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 p-3 lg:hidden">
        {tab === "live_poultry" ? (
          <div className="flex justify-end">
          <AgeHeaderWithTooltip tooltipId="inventory-age-tooltip-mobile" />
          </div>
        ) : null}
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
            {!hideClearSoldOutAction ? (
              <button
                type="button"
                className="min-h-12 rounded-md border border-emerald-800 bg-emerald-800 px-3 py-2 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800/25 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-11 sm:text-sm sm:font-semibold"
                disabled={isClearing}
                onClick={onClearSoldOutItems}
              >
                Clear sold-out items
              </button>
            ) : null}
            <button
              type="button"
              className="min-h-12 rounded-md border border-stone-300 bg-white px-3 py-2 text-base font-bold text-stone-800 shadow-sm transition hover:border-emerald-700 hover:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-11 sm:text-sm sm:font-semibold"
              disabled={isClearing}
              onClick={onClearSelection}
            >
              Clear selection
            </button>
          </div>
        </div>
      ) : null}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[940px] border-collapse text-left text-[0.8125rem]">
          <thead className="bg-stone-50 text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-stone-500">
            <FlatInventoryTableHeader
              allVisibleSelected={allVisibleSelected}
              onSelectVisible={onSelectVisible}
              tab={tab}
            />
          </thead>
          <tbody className="divide-y divide-stone-200 bg-white">
            {items.map((item) => (
              <FlatInventoryTableRow
                key={item.id}
                draftQuantities={draftQuantities}
                item={item}
                isSelected={selectedItemIds.includes(item.id)}
                onToggleSelection={onToggleSelection}
                tab={tab}
                updateDraftQuantity={updateDraftQuantity}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FlatInventoryTableHeader({
  allVisibleSelected,
  onSelectVisible,
  tab,
}: {
  allVisibleSelected: boolean;
  onSelectVisible: (shouldSelect: boolean) => void;
  tab: InventoryProductTab;
}) {
  const nameLabel =
    tab === "processed_poultry"
      ? "Product"
      : tab === "equipment"
        ? "Item"
        : "Breed";

  return (
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
      {(tab === "live_poultry" || tab === "hatching_eggs") ? (
        <th className="px-3 py-2.5">Species</th>
      ) : null}
      <th className="px-3 py-2.5">{nameLabel}</th>
      {tab === "live_poultry" ? (
        <>
          <th className="px-3 py-2.5">Type/Sex</th>
          <th className="px-3 py-2.5">Hatch date</th>
          <th className="px-3 py-2.5">
            <AgeHeaderWithTooltip tooltipId="inventory-age-tooltip-table" />
          </th>
        </>
      ) : null}
      {tab === "hatching_eggs" ? (
        <th className="px-3 py-2.5">Available date</th>
      ) : null}
      {tab === "processed_poultry" ? (
        <th className="px-3 py-2.5">Product Category</th>
      ) : null}
      {tab === "equipment" ? (
        <>
          <th className="px-3 py-2.5">Category</th>
          <th className="px-3 py-2.5">Condition</th>
        </>
      ) : null}
      <th className="px-3 py-2.5 text-center">Available</th>
      <th className="px-3 py-2.5 text-center">
        <span className="inline-flex items-center justify-center gap-1.5">
          Reserved
          <InfoTooltip
            label="What reserved means"
            text={reservedTooltipText}
            tooltipId="inventory-reserved-table-tooltip"
          />
        </span>
      </th>
      <th className="px-3 py-2.5">Price</th>
      <th className="px-3 py-2.5">Availability</th>
      <th className="px-3 py-2.5 text-right">Action</th>
    </tr>
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

function InfoTooltip({
  label,
  text,
  tooltipId,
}: {
  label: string;
  text: string;
  tooltipId: string;
}) {
  return (
    <span className="group relative ml-1 inline-flex items-center align-middle normal-case tracking-normal">
      <button
        aria-describedby={tooltipId}
        aria-label={label}
        className="inline-flex size-4 items-center justify-center rounded-full border border-stone-300 bg-white text-[0.625rem] font-bold leading-none text-stone-600 transition hover:border-emerald-700 hover:text-emerald-800 focus:border-emerald-700 focus:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
        type="button"
      >
        i
      </button>
      <span
        className="pointer-events-none absolute left-0 top-6 z-20 w-64 rounded-md border border-stone-200 bg-white px-3 py-2 text-left text-xs font-medium leading-5 text-stone-700 opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100"
        id={tooltipId}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}

function FlatInventoryTableRow({
  draftQuantities,
  isSelected,
  item,
  onToggleSelection,
  tab,
  updateDraftQuantity,
}: {
  draftQuantities: Record<string, string>;
  isSelected: boolean;
  item: FlatInventoryItem;
  onToggleSelection: (itemId: string) => void;
  tab: InventoryProductTab;
  updateDraftQuantity: (item: FlatInventoryItem, nextValue: string) => void;
}) {
  const isChanged = isInventoryItemChanged(item, draftQuantities);
  const actionLabel = getInventoryActionLabel();

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
      {(tab === "live_poultry" || tab === "hatching_eggs") ? (
        <td className="px-3 py-3 align-top font-medium text-stone-700">
          {item.species}
        </td>
      ) : null}
      <td className="px-3 py-3 align-top">
        <Link
          className="inline-flex min-w-0 items-center gap-2 font-semibold text-stone-950 underline-offset-4 hover:underline"
          href={item.manageHref}
        >
          <InventoryItemThumbnail item={item} />
          <span className="min-w-0">{item.breedOrItem}</span>
        </Link>
      </td>
      {tab === "live_poultry" ? (
        <>
          <td className="px-3 py-3 align-top text-stone-700">
            {item.typeSex}
          </td>
          <td className="px-3 py-3 align-top text-stone-700">
            {formatTableDate(item.hatchDate)}
          </td>
          <td className="px-3 py-3 align-top text-stone-700">
            {item.ageLabel}
          </td>
        </>
      ) : null}
      {tab === "hatching_eggs" ? (
        <td className="px-3 py-3 align-top text-stone-700">
          {formatTableDate(item.availableDate)}
        </td>
      ) : null}
      {item.kind === "processed_poultry" ? (
        <td className="px-3 py-3 align-top text-stone-700">
          {item.productCategory}
        </td>
      ) : null}
      {item.kind === "equipment" ? (
        <>
          <td className="px-3 py-3 align-top text-stone-700">
            {item.equipmentCategory}
          </td>
          <td className="px-3 py-3 align-top text-stone-700">
            {item.condition || "--"}
          </td>
        </>
      ) : null}
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
          className="inline-flex min-h-8 items-center justify-center rounded-md bg-emerald-800 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
          href={item.manageHref}
        >
          {actionLabel}
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
  updateDraftQuantity: (item: FlatInventoryItem, nextValue: string) => void;
}) {
  const isChanged = isInventoryItemChanged(item, draftQuantities);
  const actionLabel = getInventoryActionLabel();

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
            <div className="flex min-w-0 items-center gap-2">
              <InventoryItemThumbnail item={item} />
              <h2 className="truncate text-base font-semibold text-stone-950">
                {item.breedOrItem}
              </h2>
            </div>
            <p className="mt-0.5 text-sm leading-5 text-stone-600">
              {getInventoryItemSubtitle(item)}
            </p>
          </div>
        </div>
        <AvailabilityPill label={item.availabilityLabel} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {item.productTab === "live_poultry" ? (
          <>
            <InventoryCardField
              label="Hatch date"
              value={formatTableDate(item.hatchDate)}
            />
            <InventoryCardField label="Age" value={item.ageLabel} />
          </>
        ) : null}
        {item.productTab === "hatching_eggs" ? (
          <InventoryCardField
            label="Available date"
            value={formatTableDate(item.availableDate)}
          />
        ) : null}
        {item.kind === "processed_poultry" ? (
          <InventoryCardField
            label="Product Category"
            value={item.productCategory}
          />
        ) : null}
        {item.kind === "equipment" ? (
          <>
            <InventoryCardField label="Category" value={item.equipmentCategory} />
            <InventoryCardField
              label="Condition"
              value={item.condition || "--"}
            />
          </>
        ) : null}
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

      <Link
        className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
        href={item.manageHref}
      >
        {actionLabel}
      </Link>
    </article>
  );
}

function InventoryItemThumbnail({ item }: { item: FlatInventoryItem }) {
  if (!item.primaryPhoto) return null;

  return (
    <Image
      alt={item.primaryPhoto.alt}
      className="size-10 shrink-0 rounded-md border border-stone-200 object-cover"
      height={40}
      unoptimized
      src={item.primaryPhoto.url}
      width={40}
    />
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
  updateDraftQuantity: (item: FlatInventoryItem, nextValue: string) => void;
}) {
  if (item.kind === "hatching_egg") {
    return (
      <span className="inline-flex h-12 min-w-24 items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-2 text-lg font-bold text-stone-950 sm:h-8 sm:min-w-16 sm:text-sm sm:font-semibold">
        {item.availableQuantity}
      </span>
    );
  }

  const draftId = getDraftQuantityId(item);
  const quantityValue =
    draftQuantities[draftId] ?? String(getOriginalQuantity(item));
  const isChanged = isInventoryItemChanged(item, draftQuantities);
  const rowHasInvalidQuantity =
    draftQuantities[draftId] != null &&
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
        onChange={(event) => updateDraftQuantity(item, event.target.value)}
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
  if (value === "current_inventory") return "Current inventory";
  if (value === "available_now") return "Available now";
  if (value === "coming_soon") return "Coming soon";
  if (value === "sold_out") return "Sold out";
  if (value === "hidden") return "Hidden";
  if (value === "cleared") return "Cleared";

  return "Current inventory";
}

function getProcessedPoultryManageHref(row: ProcessedPoultryInventoryRow) {
  return `/dashboard/listings/new/processed-poultry/${row.processed_poultry_inventory_item_id}`;
}

function buildFlatInventoryItems({
  draftQuantities,
  equipmentRows,
  hatchingEggPrimaryPhotos,
  hatchingEggRows,
  processedPoultryRows,
  reservedByEquipmentId,
  reservedByItemId,
  reservedByProcessedPoultryId,
  rows,
}: {
  draftQuantities: Record<string, string>;
  equipmentRows: EquipmentInventoryRow[];
  hatchingEggPrimaryPhotos: Record<string, InventoryPrimaryPhoto>;
  hatchingEggRows: HatchingEggInventoryRow[];
  processedPoultryRows: ProcessedPoultryInventoryRow[];
  reservedByEquipmentId: Record<string, number>;
  reservedByItemId: Record<string, number>;
  reservedByProcessedPoultryId: Record<string, number>;
  rows: InventoryRow[];
}): FlatInventoryItem[] {
  return [
    ...rows.filter(isLiveBirdInventoryRow).map((row): FlatInventoryItem => {
      const typeSex = getInventoryTypeLabel(row);
      const availability = getBirdAvailability(row, draftQuantities);

      return {
        kind: "bird",
        productTab: "live_poultry",
        id: `bird:${row.inventory_item_id}`,
        species: row.species_name,
        speciesFilterValue: row.species_slug,
        breedFilterValue: row.breed_display_name,
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
        isCleared: Boolean(row.cleared_at),
        manageHref: `/dashboard/inventory/${row.listing_batch_id}/edit`,
        primaryPhoto: null,
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
    ...hatchingEggRows.map((row): FlatInventoryItem => {
      const availability = getStandaloneHatchingEggAvailability(row);

      return {
        kind: "hatching_egg",
        productTab: "hatching_eggs",
        id: `hatching_egg:${row.hatching_egg_inventory_item_id}`,
        species: row.species_name,
        speciesFilterValue: row.species_slug,
        breedFilterValue: row.item_name,
        breedOrItem: row.item_name,
        typeSex: "Hatching Eggs",
        hatchDate: null,
        availableDate: row.available_date,
        ageDays: null,
        ageLabel: "--",
        availableQuantity: row.quantity_available,
        reservedQuantity: 0,
        price: row.price,
        availabilityLabel: availability.label,
        availabilityValue: availability.value,
        isCleared: false,
        manageHref: `/dashboard/listings/new/birds/hatching-eggs/${row.hatching_egg_inventory_item_id}`,
        primaryPhoto:
          hatchingEggPrimaryPhotos[row.hatching_egg_inventory_item_id] ?? null,
        row,
        searchText: [
          row.item_name,
          row.species_name,
          "Hatching Eggs",
          row.description,
          availability.label,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    }),
    ...processedPoultryRows.map((row): FlatInventoryItem => {
      const displayedQuantity = getDisplayedSimpleQuantity(
        row.processed_poultry_inventory_item_id,
        row.quantity_available,
        draftQuantities,
      );
      const availability = getSimpleInventoryAvailability(row, displayedQuantity);

      return {
        kind: "processed_poultry",
        productTab: "processed_poultry",
        id: `processed_poultry:${row.processed_poultry_inventory_item_id}`,
        species: "Poultry Products",
        speciesFilterValue: "processed_poultry",
        breedFilterValue: row.product_name,
        breedOrItem: row.product_name,
        productCategory: row.product_type,
        typeSex: row.package_size
          ? `${row.poultry_type} - ${row.package_size}`
          : row.poultry_type,
        hatchDate: null,
        availableDate: null,
        ageDays: null,
        ageLabel: "--",
        availableQuantity: displayedQuantity,
        reservedQuantity:
          reservedByProcessedPoultryId[
            row.processed_poultry_inventory_item_id
          ] ?? 0,
        price: row.price,
        availabilityLabel: availability.label,
        availabilityValue: availability.value,
        isCleared: false,
        manageHref: getProcessedPoultryManageHref(row),
        primaryPhoto: null,
        row,
        searchText: [
          row.product_name,
          row.poultry_type,
          row.product_type,
          row.package_size,
          row.description,
          availability.label,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    }),
    ...equipmentRows.map((row): FlatInventoryItem => {
      const displayedQuantity = getDisplayedSimpleQuantity(
        row.equipment_inventory_item_id,
        row.quantity_available,
        draftQuantities,
      );
      const availability = getSimpleInventoryAvailability(row, displayedQuantity);

      return {
        kind: "equipment",
        productTab: "equipment",
        id: `equipment:${row.equipment_inventory_item_id}`,
        species: "Equipment",
        speciesFilterValue: "equipment",
        breedFilterValue: row.item_name,
        breedOrItem: row.item_name,
        equipmentCategory: row.category,
        condition: row.condition ?? "",
        typeSex: "--",
        hatchDate: null,
        availableDate: null,
        ageDays: null,
        ageLabel: "--",
        availableQuantity: displayedQuantity,
        reservedQuantity:
          reservedByEquipmentId[row.equipment_inventory_item_id] ?? 0,
        price: row.price,
        availabilityLabel: availability.label,
        availabilityValue: availability.value,
        isCleared: false,
        manageHref: `/dashboard/listings/new/equipment-supplies/${row.equipment_inventory_item_id}`,
        primaryPhoto: null,
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
  if (row.cleared_at) {
    return { label: "Cleared", value: "cleared" };
  }

  const visibility = getInventoryVisibility(row);

  if (visibility === "draft" || visibility === "hidden") {
    return { label: "Hidden", value: "hidden" };
  }

  if (
    visibility === "sold_out" ||
    row.operational_availability_status === "sold_out" ||
    getDisplayedQuantity(row, draftQuantities) <= 0
  ) {
    return { label: "Sold out", value: "sold_out" };
  }

  if (visibility !== "live") {
    return { label: "Hidden", value: "hidden" };
  }

  if (row.available_date && isFutureDate(row.available_date)) {
    return {
      label: `Coming ${formatShortDate(row.available_date)}`,
      value: "coming_soon",
    };
  }

  return { label: "Available now", value: "available_now" };
}

function getSimpleInventoryAvailability(row: {
  operational_availability_status: string;
  quantity_available: number;
  visibility_status: string;
}, displayedQuantity = row.quantity_available): {
  label: string;
  value: AvailabilityFilter;
} {
  if (row.visibility_status === "hidden") {
    return { label: "Hidden", value: "hidden" };
  }

  if (
    row.operational_availability_status === "sold_out" ||
    displayedQuantity <= 0
  ) {
    return { label: "Sold out", value: "sold_out" };
  }

  if (row.visibility_status !== "active") {
    return { label: "Hidden", value: "hidden" };
  }

  return { label: "Available now", value: "available_now" };
}

function getStandaloneHatchingEggAvailability(
  row: HatchingEggInventoryRow,
): { label: string; value: AvailabilityFilter } {
  if (row.visibility_status === "hidden") {
    return { label: "Hidden", value: "hidden" };
  }

  if (
    row.visibility_status === "sold_out" ||
    row.operational_availability_status === "sold_out" ||
    row.quantity_available <= 0
  ) {
    return { label: "Sold out", value: "sold_out" };
  }

  if (row.visibility_status !== "active") {
    return { label: "Hidden", value: "hidden" };
  }

  if (row.available_date && isFutureDate(row.available_date)) {
    return {
      label: `Coming ${formatShortDate(row.available_date)}`,
      value: "coming_soon",
    };
  }

  return { label: "Available now", value: "available_now" };
}

function buildFilterOptions(
  activeTab: InventoryProductTab,
  allItems: FlatInventoryItem[],
  scopedItems: FlatInventoryItem[],
  activeStatus: AvailabilityFilter,
) {
  return {
    species: buildOptions("All species", scopedItems, (item) => [
      item.speciesFilterValue,
      item.species,
    ]),
    typeSex: buildOptions("All types", scopedItems, (item) =>
      item.kind === "bird" ? [getTypeFilterValue(item.row), item.typeSex] : null,
    ),
    breed: buildOptions("All breeds", scopedItems, (item) => [
      item.breedFilterValue,
      item.breedOrItem,
    ]),
    productCategory: buildOptions("All categories", scopedItems, (item) =>
      item.kind === "processed_poultry"
        ? [item.productCategory, item.productCategory]
        : null,
    ),
    equipmentCategory: buildOptions("All categories", scopedItems, (item) =>
      item.kind === "equipment"
        ? [item.equipmentCategory, item.equipmentCategory]
        : null,
    ),
    condition: buildOptions("All conditions", scopedItems, (item) =>
      item.kind === "equipment" && item.condition
        ? [item.condition, item.condition]
        : null,
    ),
    availability: buildStatusOptions(
      allItems,
      activeStatus,
      (item) =>
        activeTab === "equipment" && item.availabilityValue === "coming_soon",
    ),
  };
}

function buildStatusOptions(
  items: FlatInventoryItem[],
  activeStatus: AvailabilityFilter,
  shouldSkip: (item: FlatInventoryItem) => boolean,
): { label: string; value: AvailabilityFilter }[] {
  const uniqueOptions = new Map<AvailabilityFilter, string>();

  for (const item of items) {
    if (shouldSkip(item)) continue;
    if (item.availabilityValue === "current_inventory") continue;

    uniqueOptions.set(
      item.availabilityValue,
      getAvailabilityFilterLabel(item.availabilityValue),
    );
  }

  if (activeStatus !== "current_inventory") {
    uniqueOptions.set(activeStatus, getAvailabilityFilterLabel(activeStatus));
  }

  return [
    { label: "Current inventory", value: "current_inventory" },
    ...Array.from(uniqueOptions, ([value, label]) => ({ label, value })).sort(
      (first, second) => first.label.localeCompare(second.label),
    ),
  ];
}

function filterInventoryItemsByStatus(
  items: FlatInventoryItem[],
  status: AvailabilityFilter,
) {
  if (status === "cleared") {
    return items.filter((item) => item.isCleared);
  }

  if (status === "current_inventory") {
    return items.filter((item) => !item.isCleared);
  }

  return items.filter((item) => !item.isCleared);
}

function buildOptions(
  defaultLabel: string,
  items: FlatInventoryItem[],
  getOption: (item: FlatInventoryItem) => [string, string] | null,
) {
  const uniqueOptions = new Map<string, string>();

  for (const item of items) {
    const option = getOption(item);

    if (!option) continue;

    const [value, label] = option;

    if (!value || value === "all") continue;
    uniqueOptions.set(value, label);
  }

  return [
    { label: defaultLabel, value: "all" },
    ...Array.from(uniqueOptions, ([value, label]) => ({ label, value })).sort(
      (first, second) => first.label.localeCompare(second.label),
    ),
  ];
}

function filterAndSortInventoryItems(
  items: FlatInventoryItem[],
  filters: InventoryTabFilters,
  activeTab: InventoryProductTab,
) {
  const normalizedSearch = filters.search.trim().toLowerCase();

  return items
    .filter((item) => {
      if (filters.species !== "all" && item.speciesFilterValue !== filters.species) {
        return false;
      }

      if (
        filters.typeSex !== "all" &&
        (item.kind !== "bird" || getTypeFilterValue(item.row) !== filters.typeSex)
      ) {
        return false;
      }

      if (
        activeTab === "live_poultry" &&
        item.kind === "bird" &&
        !matchesAgeFilter(item.row, filters.age)
      ) {
        return false;
      }

      if (filters.breed !== "all" && item.breedFilterValue !== filters.breed) {
        return false;
      }

      if (
        filters.productCategory !== "all" &&
        (item.kind !== "processed_poultry" ||
          item.productCategory !== filters.productCategory)
      ) {
        return false;
      }

      if (
        filters.equipmentCategory !== "all" &&
        (item.kind !== "equipment" ||
          item.equipmentCategory !== filters.equipmentCategory)
      ) {
        return false;
      }

      if (
        filters.condition !== "all" &&
        (item.kind !== "equipment" || item.condition !== filters.condition)
      ) {
        return false;
      }

      if (
        filters.availability !== "current_inventory" &&
        filters.availability !== "cleared" &&
        item.availabilityValue !== filters.availability
      ) {
        return false;
      }

      if (!normalizedSearch) return true;

      return item.searchText.includes(normalizedSearch);
    })
    .sort((first, second) =>
      compareFlatInventoryItems(first, second, filters.sortBy),
    );
}

function getSortOptionsForTab(tab: InventoryProductTab) {
  if (tab === "live_poultry") {
    return [
      { label: "Hatch Date", value: "hatch_date" },
      { label: "Breed", value: "breed" },
      { label: "Price", value: "price" },
      { label: "Available Quantity", value: "available" },
    ];
  }

  if (tab === "hatching_eggs") {
    return [
      { label: "Breed", value: "breed" },
      { label: "Price", value: "price" },
      { label: "Available Quantity", value: "available" },
      { label: "Recently Added", value: "recently_added" },
    ];
  }

  if (tab === "processed_poultry") {
    return [
      { label: "Product Name", value: "product_name" },
      { label: "Price", value: "price" },
      { label: "Available Quantity", value: "available" },
      { label: "Recently Added", value: "recently_added" },
    ];
  }

  return [
    { label: "Item Name", value: "item_name" },
    { label: "Price", value: "price" },
    { label: "Available Quantity", value: "available" },
    { label: "Recently Added", value: "recently_added" },
  ];
}

function buildInventorySummary(
  activeTab: InventoryProductTab,
  items: FlatInventoryItem[],
) {
  const availableValue = items.reduce(
    (total, item) => total + item.availableQuantity,
    0,
  );
  const reservedValue = items.reduce(
    (total, item) => total + item.reservedQuantity,
    0,
  );
  const inventoryValue = items.reduce(
    (total, item) => total + item.availableQuantity * (item.price ?? 0),
    0,
  );

  if (activeTab === "live_poultry") {
    return {
      availableGlyph: "/glyphs/hen.png",
      availableLabel: "Available Birds",
      availableValue,
      reservedLabel: "Reserved Birds",
      reservedValue,
      inventoryValue,
    };
  }

  if (activeTab === "hatching_eggs") {
    return {
      availableGlyph: "/glyphs/egg.png",
      availableLabel: "Available Eggs",
      availableValue,
      reservedLabel: "Reserved Eggs",
      reservedValue,
      inventoryValue,
    };
  }

  return {
    availableGlyph:
      activeTab === "processed_poultry"
        ? "/glyphs/chicken-leg.png"
        : "/glyphs/feed-sack.png",
    availableLabel: "Available Units",
    availableValue,
    reservedLabel: "Reserved Units",
    reservedValue,
    inventoryValue,
  };
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

  if (
    sortBy === "name" ||
    sortBy === "breed" ||
    sortBy === "product_name" ||
    sortBy === "item_name"
  ) {
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

  if (sortBy === "recently_added") {
    return getInventoryItemUpdatedAt(right).localeCompare(
      getInventoryItemUpdatedAt(left),
    );
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

function getInventoryItemUpdatedAt(item: FlatInventoryItem) {
  if (item.kind === "bird") return item.row.inventory_updated_at ?? "";

  return item.row.updated_at;
}

function getSearchPlaceholder(tab: InventoryProductTab) {
  if (tab === "hatching_eggs") return "Breed, variety, or species";
  if (tab === "processed_poultry") return "Product name";
  if (tab === "equipment") return "Item name";

  return "Breed or type";
}

function getEmptyInventoryTitle(tab: InventoryProductTab) {
  if (tab === "hatching_eggs") return "No hatching egg inventory yet";
  if (tab === "processed_poultry") return "No poultry product inventory yet";
  if (tab === "equipment") return "No equipment or supplies yet";

  return "No live poultry inventory yet";
}

function getEmptyInventoryDescription(tab: InventoryProductTab) {
  if (tab === "hatching_eggs") {
    return "Add hatching eggs when you are ready to manage egg availability.";
  }

  if (tab === "processed_poultry") {
    return "Create poultry product inventory when you have local-pickup products to sell.";
  }

  if (tab === "equipment") {
    return "Add equipment or supplies when you have items ready to sell.";
  }

  return "Add live birds to start managing flock availability.";
}

function getInventoryItemSubtitle(item: FlatInventoryItem) {
  if (item.kind === "hatching_egg") {
    return [item.species, item.typeSex].filter(Boolean).join(" - ");
  }

  if (item.kind === "processed_poultry") {
    return [item.productCategory, item.typeSex].filter(Boolean).join(" - ");
  }

  if (item.kind === "equipment") {
    return [item.equipmentCategory, item.condition].filter(Boolean).join(" - ");
  }

  return [item.species, item.typeSex].filter(Boolean).join(" - ");
}

function getInventoryActionLabel() {
  return "Edit";
}

function buildPrimaryPhotoMap(rows: InventoryMediaRow[]) {
  return rows.reduce<Record<string, InventoryPrimaryPhoto>>((photos, row) => {
    if (!row.public_url || photos[row.entity_id]) return photos;

    photos[row.entity_id] = {
      url: row.public_url,
      alt: row.alt_text || "Hatching eggs inventory photo",
    };

    return photos;
  }, {});
}

function buildReservedMap(
  rows: ReservedRow[],
  idKey:
    | "inventory_item_id"
    | "equipment_inventory_item_id"
    | "processed_poultry_inventory_item_id",
) {
  return rows.reduce<Record<string, number>>((totals, row) => {
    const itemId = row[idKey];

    if (!itemId) return totals;

    totals[itemId] =
      (totals[itemId] ?? 0) +
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

function isBirdRowChanged(
  row: InventoryRow,
  draftQuantities: Record<string, string>,
) {
  return isSimpleQuantityChanged(
    row.inventory_item_id,
    row.quantity_available ?? 0,
    draftQuantities,
  );
}

function isSimpleQuantityChanged(
  itemId: string,
  originalQuantity: number,
  draftQuantities: Record<string, string>,
) {
  const draftValue = draftQuantities[itemId];

  return draftValue != null && draftValue !== String(originalQuantity);
}

function isInventoryItemChanged(
  item: FlatInventoryItem,
  draftQuantities: Record<string, string>,
) {
  return isSimpleQuantityChanged(
    getDraftQuantityId(item),
    getOriginalQuantity(item),
    draftQuantities,
  );
}

function getDraftQuantityId(item: FlatInventoryItem) {
  if (item.kind === "bird") return item.row.inventory_item_id;
  if (item.kind === "hatching_egg") {
    return item.row.hatching_egg_inventory_item_id;
  }
  if (item.kind === "equipment") return item.row.equipment_inventory_item_id;

  return item.row.processed_poultry_inventory_item_id;
}

function getOriginalQuantity(item: FlatInventoryItem) {
  return item.row.quantity_available ?? 0;
}

function getInventoryItemIdForClear(item: FlatInventoryItem) {
  if (item.kind !== "bird") return null;

  return item.row.inventory_item_id;
}

function isClearSoldOutEligibleItem(
  item: FlatInventoryItem,
): item is BirdInventoryItem {
  return item.kind === "bird" && getOriginalQuantity(item) === 0;
}

function getClearSoldOutEligibleItems(
  items: FlatInventoryItem[],
): BirdInventoryItem[] {
  return items.filter(isClearSoldOutEligibleItem);
}

function getClearSoldOutCounts(items: FlatInventoryItem[]) {
  const eligibleCount = getClearSoldOutEligibleItems(items).length;

  return {
    eligibleCount,
    unchangedCount: items.length - eligibleCount,
  };
}

function isValidQuantity(value: string) {
  if (!value.trim()) return false;

  const numericValue = Number(value);

  return (
    Number.isInteger(numericValue) && numericValue >= 0 && Number.isFinite(numericValue)
  );
}

function validateChangedQuantities(
  changedItemIds: string[],
  draftQuantities: Record<string, string>,
) {
  for (const itemId of changedItemIds) {
    const draftValue = draftQuantities[itemId];

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

function getDisplayedSimpleQuantity(
  itemId: string,
  originalQuantity: number,
  draftQuantities: Record<string, string>,
) {
  const draftValue = draftQuantities[itemId];

  if (draftValue == null) return originalQuantity;
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
