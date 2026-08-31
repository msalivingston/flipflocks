"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, Funnel, MoreHorizontal } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ListingShareDialog } from "../_components/listing-share-dialog";
import { useSellerContext } from "../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
} from "../_components/seller-ui";
import {
  buildEquipmentShareSummary,
  buildEquipmentShareText,
} from "../_lib/equipment-share-text";
import {
  loadLivePoultryShareProducts,
  type LivePoultryShareProduct,
} from "../_lib/live-poultry-share-products";
import {
  buildHatchingEggShareSummary,
  buildHatchingEggShareText,
} from "../_lib/hatching-egg-share-text";
import {
  buildPoultryProductShareSummary,
  buildPoultryProductShareText,
} from "../_lib/poultry-product-share-text";
import {
  calculateAgeAtAvailabilityDays,
  calculateCurrentBirdAgeDays,
  formatInventoryAgeLabel,
  formatInventoryTypeLabel,
} from "../_lib/listing-formatters";
import { buildPublicListingPath } from "../_lib/public-listing-url";
import {
  type EquipmentInventoryRow,
} from "../_lib/equipment-inventory";
import {
  type ProcessedPoultryInventoryRow,
} from "../_lib/processed-poultry-inventory";
import {
  getCoopActivationErrorMessage,
  getLiveBirdInventoryManageHref,
} from "./_lib/live-bird-draft-state";

type InventoryRow = {
  store_id: string;
  listing_batch_id: string;
  listing_batch_breed_id: string;
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
  price_override: number | null;
  inventory_item_sort_order: number | null;
  inventory_visibility_status: string;
  inventory_moderation_status: string;
  listing_batch_breed_visibility_status: string;
  listing_batch_visibility_status: string;
  listing_batch_moderation_status: string;
  operational_availability_status: string;
  inventory_seller_notes: string | null;
  internal_batch_label: string | null;
  has_published_activity: boolean;
  is_unfinished_add_v2_draft: boolean;
  archived_at: string | null;
  inventory_updated_at: string | null;
};

type HatchingEggInventoryRow = {
  hatching_egg_inventory_item_id: string;
  hatching_egg_product_id: string | null;
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

type InventoryPrimaryPhoto = {
  url: string;
  alt: string;
};

type InventoryPageRow = {
  primary_photo: InventoryPrimaryPhoto | null;
  reserved_quantity: number;
  row: Record<string, unknown>;
};

type InventoryPageResponse = {
  category: InventoryProductTab;
  category_count: number;
  options: {
    breed?: Array<{ label: string; value: string }>;
    condition?: Array<{ label: string; value: string }>;
    equipment_category?: Array<{ label: string; value: string }>;
    product_category?: Array<{ label: string; value: string }>;
    species?: Array<{ label: string; value: string }>;
    type_sex?: Array<{ label: string; value: string }>;
  };
  rows: InventoryPageRow[];
  summary: {
    available_quantity: number;
    inventory_value: number;
    reserved_quantity: number;
  };
  total_count: number;
};

type InventoryProductTab =
  | "live_poultry"
  | "hatching_eggs"
  | "processed_poultry"
  | "equipment";
type AgeFilter = "all" | "0_6" | "7_12" | "13_24" | "25_plus" | "unknown";
type InventoryVisibility = "draft" | "live" | "hidden" | "archived" | "sold_out";
type InventoryStoreVisibilityStatus = "hidden" | "active";
type InventoryArchiveStatus = "archived" | "hidden";
type AvailabilityFilter =
  | "current_inventory"
  | "available_now"
  | "coming_soon"
  | "sold_out"
  | "hidden"
  | "archived";
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

type InventoryArchiveDialogState = {
  items: ArchiveInventoryItem[];
  mode: "single" | "bulk";
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
      isArchived: boolean;
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
      isArchived: boolean;
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
      availableDate: string;
      ageDays: null;
      ageLabel: string;
      availableQuantity: number;
      reservedQuantity: number;
      price: number;
      availabilityLabel: string;
      availabilityValue: AvailabilityFilter;
      isArchived: boolean;
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
      availableDate: string;
      ageDays: null;
      ageLabel: string;
      availableQuantity: number;
      reservedQuantity: number;
      price: number;
      availabilityLabel: string;
      availabilityValue: AvailabilityFilter;
      isArchived: boolean;
      manageHref: string;
      primaryPhoto: InventoryPrimaryPhoto | null;
      searchText: string;
      row: EquipmentInventoryRow;
    };

type BirdInventoryItem = Extract<FlatInventoryItem, { kind: "bird" }>;
type StoreVisibilityInventoryItem = Extract<
  FlatInventoryItem,
  { kind: "bird" | "hatching_egg" | "processed_poultry" | "equipment" }
>;
type ArchiveInventoryItem = StoreVisibilityInventoryItem;
type InventoryShareDialogState = LivePoultryShareProduct;

const unsavedWarning =
  "You have unsaved inventory changes. Save or discard before leaving.";
const ageTooltipText =
  "Age is calculated from the hatch date and updates daily. It is shown in weeks through 26 weeks, then in whole months.";
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

const inventoryTabParamValues: Record<string, InventoryProductTab> = {
  equipment: "equipment",
  hatching_eggs: "hatching_eggs",
  live_poultry: "live_poultry",
  processed_poultry: "processed_poultry",
};

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
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [draftPrices, setDraftPrices] = useState<Record<string, string>>({});
  const [filtersByTab, setFiltersByTab] =
    useState<Record<InventoryProductTab, InventoryTabFilters>>(
      defaultTabFilters,
    );
  const [pagesByTab, setPagesByTab] = useState<
    Record<InventoryProductTab, number>
  >({ equipment: 0, hatching_eggs: 0, live_poultry: 0, processed_poultry: 0 });
  const [inventoryPage, setInventoryPage] = useState<InventoryPageResponse | null>(
    null,
  );
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiveProcessing, setIsArchiveProcessing] = useState(false);
  const [archiveConfirm, setArchiveConfirm] =
    useState<InventoryArchiveDialogState | null>(null);
  const [updatingArchiveItemIds, setUpdatingArchiveItemIds] = useState<
    string[]
  >([]);
  const [updatingVisibilityItemIds, setUpdatingVisibilityItemIds] = useState<
    string[]
  >([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [restoreSuccessDialogMessage, setRestoreSuccessDialogMessage] =
    useState<string | null>(null);
  const [sharingItemId, setSharingItemId] = useState<string | null>(null);
  const [shareProduct, setShareProduct] =
    useState<InventoryShareDialogState | null>(null);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const isMountedRef = useRef(true);
  const isShareResolvingRef = useRef(false);
  const activeTab =
    inventoryTabParamValues[searchParams.get("tab") ?? ""] ?? "live_poultry";
  const page = pagesByTab[activeTab];
  const filtersForQuery = filtersByTab[activeTab];
  const deferredSearch = useDeferredValue(filtersForQuery.search);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  function changeInventoryTab(tab: InventoryProductTab) {
    setSelectedItemIds([]);
    setSaveError(null);
    setSuccessMessage(null);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", tab);
    const query = nextParams.toString();

    router.push(query ? `/dashboard/inventory?${query}` : "/dashboard/inventory", {
      scroll: false,
    });
  }

  useEffect(() => {
    let isMounted = true;

    async function loadInventory() {
      if (!seller) return;

      setIsLoading(true);
      setLoadError(null);

      const result = await supabase.rpc("seller_get_inventory_management_page", {
        p_age: filtersForQuery.age,
        p_availability: filtersForQuery.availability,
        p_breed: filtersForQuery.breed,
        p_category: activeTab,
        p_condition: filtersForQuery.condition,
        p_equipment_category: filtersForQuery.equipmentCategory,
        p_limit: 50,
        p_offset: page * 50,
        p_product_category: filtersForQuery.productCategory,
        p_search: deferredSearch,
        p_sort: filtersForQuery.sortBy,
        p_species: filtersForQuery.species,
        p_store_id: seller.store_id,
        p_type_sex: filtersForQuery.typeSex,
      });

      if (!isMounted) return;

      if (result.error) {
        setLoadError(result.error.message);
        setIsLoading(false);
        return;
      }

      const nextPage = normalizeInventoryPageResponse(result.data);

      if (nextPage.total_count > 0 && page * 50 >= nextPage.total_count) {
        setPagesByTab((current) => ({
          ...current,
          [activeTab]: Math.floor((nextPage.total_count - 1) / 50),
        }));
        return;
      }

      const nextRows = nextPage.rows.map((entry) => entry.row);
      const reservationMap = Object.fromEntries(
        nextPage.rows.map((entry) => [
          getInventoryPageRowId(activeTab, entry.row),
          Number(entry.reserved_quantity ?? 0),
        ]),
      );

      setRows(
        activeTab === "live_poultry"
          ? (nextRows as unknown as InventoryRow[])
          : [],
      );
      setHatchingEggRows(
        activeTab === "hatching_eggs"
          ? (nextRows as unknown as HatchingEggInventoryRow[])
          : [],
      );
      setProcessedPoultryRows(
        activeTab === "processed_poultry"
          ? (nextRows as unknown as ProcessedPoultryInventoryRow[])
          : [],
      );
      setEquipmentRows(
        activeTab === "equipment"
          ? (nextRows as unknown as EquipmentInventoryRow[])
          : [],
      );
      setHatchingEggPrimaryPhotos(
        activeTab === "hatching_eggs"
          ? Object.fromEntries(
              nextPage.rows
                .filter((entry) => entry.primary_photo)
                .map((entry) => [
                  getInventoryPageRowId(activeTab, entry.row),
                  entry.primary_photo as InventoryPrimaryPhoto,
                ]),
            )
          : {},
      );
      setReservedByItemId(activeTab === "live_poultry" ? reservationMap : {});
      setReservedByEquipmentId(activeTab === "equipment" ? reservationMap : {});
      setReservedByProcessedPoultryId(activeTab === "processed_poultry" ? reservationMap : {});
      setInventoryPage(nextPage);
      setSelectedItemIds([]);
      setIsLoading(false);
    }

    void loadInventory();

    return () => {
      isMounted = false;
    };
  }, [
    activeTab,
    deferredSearch,
    filtersForQuery.age,
    filtersForQuery.availability,
    filtersForQuery.breed,
    filtersForQuery.condition,
    filtersForQuery.equipmentCategory,
    filtersForQuery.productCategory,
    filtersForQuery.sortBy,
    filtersForQuery.species,
    filtersForQuery.typeSex,
    page,
    refreshVersion,
    seller,
  ]);

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
  const changedPriceItems = useMemo(
    () =>
      inventoryItems.filter((item) => isInventoryItemPriceChanged(item, draftPrices)),
    [draftPrices, inventoryItems],
  );
  const changedItemIds = useMemo(() => {
    const itemIds = new Set<string>();

    changedBirdRows.forEach((row) => itemIds.add(`bird:${row.inventory_item_id}`));
    changedEquipmentRows.forEach((row) =>
      itemIds.add(`equipment:${row.equipment_inventory_item_id}`),
    );
    changedProcessedPoultryRows.forEach((row) =>
      itemIds.add(
        `processed_poultry:${row.processed_poultry_inventory_item_id}`,
      ),
    );
    changedPriceItems.forEach((item) => itemIds.add(item.id));

    return itemIds;
  }, [
    changedBirdRows,
    changedEquipmentRows,
    changedPriceItems,
    changedProcessedPoultryRows,
  ]);
  const changedCount = changedItemIds.size;
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
  const effectiveAvailability = activeFilters.availability;
  const effectiveActiveFilters = useMemo(
    () =>
      effectiveAvailability === activeFilters.availability
        ? activeFilters
        : { ...activeFilters, availability: effectiveAvailability },
    [activeFilters, effectiveAvailability],
  );
  const filterOptions = useMemo(
    () => buildInventoryPageFilterOptions(inventoryPage),
    [inventoryPage],
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

  const filteredItems = activeTabItems;

  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selectedItemIds.includes(item.id)),
    [filteredItems, selectedItemIds],
  );
  const visibleSelectedItemIds = selectedItems.map((item) => item.id);

  const summary = useMemo(
    () => buildInventoryPageSummary(activeTab, inventoryPage),
    [activeTab, inventoryPage],
  );

  function updateActiveFilter<TKey extends keyof InventoryTabFilters>(
    key: TKey,
    value: InventoryTabFilters[TKey],
  ) {
    if (hasUnsavedChanges) {
      setSaveError("Save or discard your inventory changes before changing filters.");
      return;
    }

    setPagesByTab((current) => ({ ...current, [activeTab]: 0 }));
    setSelectedItemIds([]);
    setFiltersByTab((current) => ({
      ...current,
      [activeTab]: {
        ...current[activeTab],
        [key]: value,
      },
    }));
  }

  function resetActiveFilters() {
    if (hasUnsavedChanges) {
      setSaveError("Save or discard your inventory changes before resetting filters.");
      return;
    }

    setPagesByTab((current) => ({ ...current, [activeTab]: 0 }));
    setSelectedItemIds([]);
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

  function updateDraftPrice(item: FlatInventoryItem, nextValue: string) {
    setDraftPrices((current) => {
      const priceItemId = getPriceEditItemId(item);
      const normalizedValue = normalizePriceInput(nextValue);

      if (
        normalizedValue != null &&
        areMoneyValuesEqual(normalizedValue, getOriginalPrice(item))
      ) {
        const next = { ...current };
        delete next[priceItemId];

        return next;
      }

      return {
        ...current,
        [priceItemId]: nextValue,
      };
    });
    setSaveError(null);
    setSuccessMessage(null);
  }

  function resetDraftPrice(item: FlatInventoryItem) {
    setDraftPrices((current) => {
      const next = { ...current };
      delete next[getPriceEditItemId(item)];

      return next;
    });
    setSaveError(null);
  }

  function applyInventoryItemPrice(item: FlatInventoryItem, nextPrice: number) {
    if (item.kind === "bird") {
      setRows((current) =>
        current.map((row) =>
          row.inventory_item_id === item.row.inventory_item_id
            ? {
                ...row,
                effective_unit_price: nextPrice,
                price_override: nextPrice,
              }
            : row,
        ),
      );
      return;
    }

    if (item.kind === "hatching_egg") {
      setHatchingEggRows((current) =>
        current.map((row) =>
          row.hatching_egg_inventory_item_id ===
          item.row.hatching_egg_inventory_item_id
            ? { ...row, price: nextPrice }
            : row,
        ),
      );
      return;
    }

    if (item.kind === "processed_poultry") {
      setProcessedPoultryRows((current) =>
        current.map((row) =>
          row.processed_poultry_inventory_item_id ===
          item.row.processed_poultry_inventory_item_id
            ? { ...row, price: nextPrice }
            : row,
        ),
      );
      return;
    }

    setEquipmentRows((current) =>
      current.map((row) =>
        row.equipment_inventory_item_id === item.row.equipment_inventory_item_id
          ? { ...row, price: nextPrice }
          : row,
      ),
    );
  }

  function discardChanges() {
    setDraftQuantities({});
    setDraftPrices({});
    setSaveError(null);
    setSuccessMessage(null);
  }

  async function saveChanges() {
    if (!seller || isSaving || changedCount === 0) return;

    const quantityValidationMessage = validateChangedQuantities(
      [
        ...changedBirdRows.map((row) => row.inventory_item_id),
        ...changedEquipmentRows.map((row) => row.equipment_inventory_item_id),
        ...changedProcessedPoultryRows.map(
          (row) => row.processed_poultry_inventory_item_id,
        ),
      ],
      draftQuantities,
    );

    if (quantityValidationMessage) {
      setSaveError(quantityValidationMessage);
      setSuccessMessage(null);
      return;
    }

    const priceValidationMessage = validateChangedPrices(changedPriceItems, draftPrices);

    if (priceValidationMessage) {
      setSaveError(priceValidationMessage);
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
        p_price: getPendingInventoryPrice(
          row.equipment_inventory_item_id,
          row.price,
          draftPrices,
        ),
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
          p_price: getPendingInventoryPrice(
            row.processed_poultry_inventory_item_id,
            row.price,
            draftPrices,
          ),
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

    for (const item of changedPriceItems) {
      const nextPrice = normalizePriceInput(
        draftPrices[getPriceEditItemId(item)] ?? "",
      );

      if (nextPrice == null) continue;

      if (
        item.kind === "equipment" &&
        changedEquipmentRows.some(
          (row) =>
            row.equipment_inventory_item_id ===
            item.row.equipment_inventory_item_id,
        )
      ) {
        continue;
      }

      if (
        item.kind === "processed_poultry" &&
        changedProcessedPoultryRows.some(
          (row) =>
            row.processed_poultry_inventory_item_id ===
            item.row.processed_poultry_inventory_item_id,
        )
      ) {
        continue;
      }

      const result = await updateInventoryItemPrice(
        item,
        nextPrice,
        draftQuantities,
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
    for (const item of changedPriceItems) {
      const nextPrice = normalizePriceInput(
        draftPrices[getPriceEditItemId(item)] ?? "",
      );

      if (nextPrice == null) continue;

      applyInventoryItemPrice(item, nextPrice);
    }
    setDraftQuantities({});
    setDraftPrices({});
    setSuccessMessage("Inventory changes saved.");
    setIsSaving(false);
    setRefreshVersion((current) => current + 1);
  }

  async function refetchVisibilityCategories(
    kinds: Set<StoreVisibilityInventoryItem["kind"]>,
  ) {
    void kinds;
    setRefreshVersion((current) => current + 1);
  }

  async function setInventoryStoreVisibility(
    items: StoreVisibilityInventoryItem[],
    nextStatus: InventoryStoreVisibilityStatus,
  ) {
    if (!seller || updatingVisibilityItemIds.length > 0) return;

    const targetItems = getStoreVisibilityTargetItems(items, nextStatus);

    if (targetItems.length === 0) return;

    const targetIds = targetItems.map(getStoreVisibilityItemId);
    const successfulIds = new Set<string>();
    const successfulKinds = new Set<StoreVisibilityInventoryItem["kind"]>();
    const failedMessages: string[] = [];

    setUpdatingVisibilityItemIds(targetIds);
    setSaveError(null);
    setSuccessMessage(null);

    for (const item of targetItems) {
      const result = await setInventoryItemVisibility(item, nextStatus);

      if (result.error) {
        failedMessages.push(result.error.message);
      } else {
        successfulIds.add(getStoreVisibilityItemId(item));
        successfulKinds.add(item.kind);
      }
    }

    if (successfulIds.size > 0) {
      try {
        await refetchVisibilityCategories(successfulKinds);
      } catch (error) {
        setSaveError(
          error instanceof Error
            ? error.message
            : "Inventory visibility changed, but the updated rows could not be loaded.",
        );
      }

      setSelectedItemIds((current) =>
        current.filter((selectedId) => {
          const selectedItem = selectedItems.find((item) => item.id === selectedId);

          if (!selectedItem) return true;

          return !successfulIds.has(getStoreVisibilityItemId(selectedItem));
        }),
      );
    }

    const actionText = nextStatus === "hidden" ? "hidden from" : "shown on";
    const singleSuccessMessage =
      nextStatus === "hidden"
        ? "Inventory hidden from store."
        : "Inventory shown on store.";

    if (successfulIds.size > 0 && failedMessages.length === 0) {
      setSuccessMessage(
        targetItems.length === 1
          ? singleSuccessMessage
          : `${successfulIds.size} inventory ${
              successfulIds.size === 1 ? "item" : "items"
            } ${actionText} store.`,
      );
    } else if (successfulIds.size > 0 && failedMessages.length > 0) {
      setSuccessMessage(
        `${successfulIds.size} inventory ${
          successfulIds.size === 1 ? "item" : "items"
        } ${actionText} store. ${failedMessages.length} failed.`,
      );
        setSaveError(
          getCoopActivationErrorMessage(
            failedMessages[0] ?? "Some inventory rows could not be updated.",
          ),
        );
    } else {
      setSaveError(getCoopActivationErrorMessage(
        failedMessages[0] ??
          (nextStatus === "hidden"
            ? "Inventory could not be hidden from store."
            : "Inventory could not be shown on store."),
      ));
    }

    setUpdatingVisibilityItemIds([]);
  }

  async function setLiveBirdInventoryVisibility(
    items: StoreVisibilityInventoryItem[],
    nextStatus: InventoryStoreVisibilityStatus,
  ) {
    await setInventoryStoreVisibility(items, nextStatus);
  }

  function requestArchiveInventoryItems(
    items: ArchiveInventoryItem[],
    mode: InventoryArchiveDialogState["mode"],
  ) {
    if (items.length === 0 || isArchiveProcessing) return;

    const targetItems = getArchiveTargetItems(items, "archived");

    if (targetItems.length === 0) return;

    setSaveError(null);
    setSuccessMessage(null);
    setArchiveConfirm({ items: targetItems, mode });
  }

  async function confirmArchiveInventoryItems() {
    if (!archiveConfirm) return;

    await setInventoryArchiveStatus(archiveConfirm.items, "archived");
    setArchiveConfirm(null);
  }

  async function restoreInventoryItems(items: ArchiveInventoryItem[]) {
    await setInventoryArchiveStatus(items, "hidden");
  }

  async function setInventoryArchiveStatus(
    items: ArchiveInventoryItem[],
    nextStatus: InventoryArchiveStatus,
  ) {
    if (!seller || isArchiveProcessing) return;

    const targetItems = getArchiveTargetItems(items, nextStatus);

    if (targetItems.length === 0) return;

    const targetIds = targetItems.map(getArchiveItemId);
    const successfulIds = new Set<string>();
    const successfulKinds = new Set<ArchiveInventoryItem["kind"]>();
    const failedMessages: string[] = [];

    setIsArchiveProcessing(true);
    setUpdatingArchiveItemIds(targetIds);
    setSaveError(null);
    setSuccessMessage(null);
    setRestoreSuccessDialogMessage(null);

    for (const item of targetItems) {
      try {
        const result = await setInventoryItemArchiveStatus(item, nextStatus);

        if (result.error) {
          failedMessages.push(result.error.message);
        } else {
          successfulIds.add(getArchiveItemId(item));
          successfulKinds.add(item.kind);
        }
      } catch (error) {
        failedMessages.push(
          error instanceof Error
            ? error.message
            : "Inventory row could not be updated.",
        );
      }
    }

    if (successfulIds.size > 0) {
      try {
        await refetchVisibilityCategories(successfulKinds);
      } catch (error) {
        setSaveError(
          error instanceof Error
            ? error.message
            : "Inventory changed, but the updated rows could not be loaded.",
        );
      }

      setSelectedItemIds((current) =>
        current.filter((selectedId) => {
          const selectedItem = selectedItems.find((item) => item.id === selectedId);

          if (!selectedItem || !isArchiveInventoryItem(selectedItem)) return true;

          return !successfulIds.has(getArchiveItemId(selectedItem));
        }),
      );
    }

    const isArchive = nextStatus === "archived";
    const restoreSuccessMessage =
      successfulIds.size === 1
        ? "Restored to inventory. This item is still hidden from your storefront. Use “Show on store” when you’re ready for buyers to see it."
        : "Restored to inventory. Restored items are still hidden from your storefront. Use “Show on store” when you’re ready for buyers to see them.";

    if (successfulIds.size > 0 && failedMessages.length === 0) {
      if (isArchive) {
        setSuccessMessage(
          targetItems.length === 1
            ? "Inventory item archived."
            : `${successfulIds.size} inventory items archived.`,
        );
      } else {
        setRestoreSuccessDialogMessage(restoreSuccessMessage);
      }
    } else if (successfulIds.size > 0 && failedMessages.length > 0) {
      if (isArchive) {
        setSuccessMessage(
          `${successfulIds.size} inventory ${
            successfulIds.size === 1 ? "item" : "items"
          } archived. ${failedMessages.length} failed.`,
        );
      } else {
        setRestoreSuccessDialogMessage(
          `${restoreSuccessMessage} ${failedMessages.length} failed.`,
        );
      }
      setSaveError(failedMessages[0] ?? "Some inventory rows could not be updated.");
    } else {
      setSaveError(
        failedMessages[0] ??
          (isArchive
            ? "Inventory could not be archived."
            : "Inventory could not be restored to Current Inventory."),
      );
    }

    setUpdatingArchiveItemIds([]);
    setIsArchiveProcessing(false);
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

  function deselectInventoryItems() {
    setSelectedItemIds([]);
    setArchiveConfirm(null);
  }

  function openInventoryRowShare(item: FlatInventoryItem) {
    if (item.kind === "bird") {
      void openLivePoultryRowShare(item);
      return;
    }

    openSimpleInventoryRowShare(item);
  }

  async function openLivePoultryRowShare(item: BirdInventoryItem) {
    if (!seller || isShareResolvingRef.current) return;

    const listingBatchBreedId = item.row.listing_batch_breed_id?.trim();
    const publicPath = buildPublicListingPath({
      listingType: "live_poultry",
      productId: listingBatchBreedId,
      storeSlug: seller.store_slug,
    });

    if (!isShareableLivePoultryItem(item) || !listingBatchBreedId || !publicPath) {
      setSaveError("A public listing link is not available for this listing.");
      setSuccessMessage(null);
      return;
    }

    isShareResolvingRef.current = true;
    setSharingItemId(item.id);
    setShareProduct(null);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const result = await loadLivePoultryShareProducts({
        listingBatchBreedId,
        listingBatchId: item.row.listing_batch_id,
        storeId: seller.store_id,
        storeName: seller.store_name,
        storeSlug: seller.store_slug,
      });

      if (!isMountedRef.current) return;

      if (!result.ok) {
        setSaveError(result.message);
        return;
      }

      const product =
        result.products.find((candidate) => candidate.id === listingBatchBreedId) ??
        null;

      if (!product?.publicPath) {
        setSaveError("A public listing link is not available for this listing.");
        return;
      }

      setShareProduct({
        ...product,
        publicPath,
      });
      setIsShareDialogOpen(true);
    } catch (error) {
      if (!isMountedRef.current) return;

      setSaveError(
        error instanceof Error
          ? error.message
          : "A public listing link is not available for this listing.",
      );
    } finally {
      isShareResolvingRef.current = false;

      if (isMountedRef.current) {
        setSharingItemId(null);
      }
    }
  }

  function closeLivePoultryRowShare() {
    setIsShareDialogOpen(false);
    setShareProduct(null);
    isShareResolvingRef.current = false;
  }

  function openSimpleInventoryRowShare(item: FlatInventoryItem) {
    if (!seller || isShareResolvingRef.current || isShareDialogOpen) return;

    const shareProduct = buildSimpleInventoryShareProduct(item, seller);

    if (!shareProduct?.publicPath) {
      setSaveError("A public listing link is not available for this listing.");
      setSuccessMessage(null);
      return;
    }

    isShareResolvingRef.current = true;
    setSharingItemId(item.id);
    setShareProduct(shareProduct);
    setSaveError(null);
    setSuccessMessage(null);
    setIsShareDialogOpen(true);
    setSharingItemId(null);
  }

  if (isLoading || inventoryPage?.category !== activeTab) {
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
        onChange={changeInventoryTab}
      />

      <SellerCard className="p-3">
        <div className="grid grid-cols-3 divide-x divide-stone-200 lg:hidden">
          <InventorySummaryCard
            compact
            glyph={summary.availableGlyph}
            label={summary.availableLabel}
            value={summary.availableValue}
          />
          <InventorySummaryCard
            compact
            glyph="/glyphs/calendar.png"
            label={summary.reservedLabel}
            value={summary.reservedValue}
          />
          <InventorySummaryCard
            compact
            glyph="/glyphs/shopping-bag.png"
            label="Inventory Value"
            value={formatCurrency(summary.inventoryValue)}
          />
        </div>
        <div className="hidden gap-2 lg:grid lg:grid-cols-3">
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
        <div className="grid gap-3 lg:hidden">
          <label className="relative block">
            <span className="sr-only">Search inventory</span>
            <Image
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-70"
              src="/glyphs/looking-glass.png"
              alt=""
              width={18}
              height={18}
            />
            <input
              className="seller-form-field min-h-12 rounded-lg"
              placeholder={getMobileSearchPlaceholder(activeTab)}
              style={{ paddingLeft: "3.5rem" }}
              type="search"
              value={activeFilters.search}
              onChange={(event) =>
                updateActiveFilter("search", event.target.value)
              }
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <details className="group relative open:pb-[28rem]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold text-stone-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/20 [&::-webkit-details-marker]:hidden">
                <Funnel
                  aria-hidden="true"
                  className="size-4 text-emerald-800"
                  strokeWidth={2.25}
                />
                Filters
                <span aria-hidden="true" className="text-stone-400 group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="absolute left-0 top-[3.25rem] z-30 grid w-[calc(200%+0.5rem)] gap-3 rounded-lg border border-stone-200 bg-white p-3 shadow-[0_18px_40px_rgba(46,39,25,0.16)]">
                {activeTab === "live_poultry" ? (
                  <>
                    <InventorySelectControl
                      icon="filter"
                      label="Species"
                      mobileLarge
                      value={activeFilters.species}
                      options={filterOptions.species}
                      onChange={(value) => updateActiveFilter("species", value)}
                    />
                    <InventorySelectControl
                      icon="filter"
                      label="Type/Sex"
                      mobileLarge
                      value={activeFilters.typeSex}
                      options={filterOptions.typeSex}
                      onChange={(value) => updateActiveFilter("typeSex", value)}
                    />
                    <InventorySelectControl
                      icon="filter"
                      label="Age Range"
                      mobileLarge
                      value={activeFilters.age}
                      options={ageFilterOptions}
                      onChange={(value) =>
                        updateActiveFilter("age", value as AgeFilter)
                      }
                    />
                  </>
                ) : null}
                {activeTab === "hatching_eggs" ? (
                  <>
                    <InventorySelectControl
                      icon="filter"
                      label="Species"
                      mobileLarge
                      value={activeFilters.species}
                      options={filterOptions.species}
                      onChange={(value) => updateActiveFilter("species", value)}
                    />
                    <InventorySelectControl
                      icon="filter"
                      label="Breed"
                      mobileLarge
                      value={activeFilters.breed}
                      options={filterOptions.breed}
                      onChange={(value) => updateActiveFilter("breed", value)}
                    />
                  </>
                ) : null}
                {activeTab === "processed_poultry" ? (
                  <InventorySelectControl
                    icon="filter"
                    label="Product Category"
                    mobileLarge
                    value={activeFilters.productCategory}
                    options={filterOptions.productCategory}
                    onChange={(value) =>
                      updateActiveFilter("productCategory", value)
                    }
                  />
                ) : null}
                {activeTab === "equipment" ? (
                  <>
                    <InventorySelectControl
                      icon="filter"
                      label="Category"
                      mobileLarge
                      value={activeFilters.equipmentCategory}
                      options={filterOptions.equipmentCategory}
                      onChange={(value) =>
                        updateActiveFilter("equipmentCategory", value)
                      }
                    />
                    <InventorySelectControl
                      icon="filter"
                      label="Condition"
                      mobileLarge
                      value={activeFilters.condition}
                      options={filterOptions.condition}
                      onChange={(value) => updateActiveFilter("condition", value)}
                    />
                  </>
                ) : null}
                <InventorySelectControl
                  icon="filter"
                  label="Status"
                  mobileLarge
                  value={effectiveActiveFilters.availability}
                  options={filterOptions.availability}
                  onChange={(value) =>
                    updateActiveFilter(
                      "availability",
                      value as AvailabilityFilter,
                    )
                  }
                />
                {hasActiveFilters ? (
                  <button
                    type="button"
                    className="justify-self-start text-sm font-semibold text-emerald-800 underline-offset-4 hover:text-emerald-950 hover:underline"
                    onClick={resetActiveFilters}
                  >
                    Reset filters
                  </button>
                ) : null}
              </div>
            </details>
            <InventorySelectControl
              compact
              icon="sort"
              label="Sort"
              value={activeFilters.sortBy}
              options={activeSortOptions}
              onChange={(value) =>
                updateActiveFilter("sortBy", value as InventorySort)
              }
            />
          </div>
        </div>
        <div className="hidden gap-3 lg:grid lg:grid-flow-col lg:auto-cols-[minmax(0,1fr)] lg:items-end">
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
            className="mt-3 hidden text-sm font-semibold text-emerald-800 underline-offset-4 hover:text-emerald-950 hover:underline lg:inline-block"
            onClick={resetActiveFilters}
          >
            Reset filters
          </button>
        ) : null}
      </SellerCard>

      <SellerCard className="overflow-hidden">
        {(inventoryPage?.category_count ?? 0) === 0 ? (
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
            draftPrices={draftPrices}
            draftQuantities={draftQuantities}
            hasUnsavedChanges={hasUnsavedChanges}
            items={filteredItems}
            isArchiveProcessing={isArchiveProcessing}
            sharingItemId={sharingItemId}
            updatingArchiveItemIds={updatingArchiveItemIds}
            updatingVisibilityItemIds={updatingVisibilityItemIds}
            onArchiveInventoryItems={requestArchiveInventoryItems}
            onDeselectAll={deselectInventoryItems}
            onRestoreInventoryItems={restoreInventoryItems}
            onShareInventoryItem={openInventoryRowShare}
            onSelectVisible={setVisibleSelection}
            onSetLiveBirdInventoryVisibility={setLiveBirdInventoryVisibility}
            onToggleSelection={toggleItemSelection}
            selectedItemIds={visibleSelectedItemIds}
            tab={activeTab}
            resetDraftPrice={resetDraftPrice}
            updateDraftPrice={updateDraftPrice}
            updateDraftQuantity={updateDraftQuantity}
          />
        )}
        {(inventoryPage?.total_count ?? 0) > 50 ? (
          <InventoryPagination
            disabled={hasUnsavedChanges}
            page={page}
            setPage={(nextPage) => {
              setSelectedItemIds([]);
              setPagesByTab((current) => ({
                ...current,
                [activeTab]: nextPage,
              }));
            }}
            totalCount={inventoryPage?.total_count ?? 0}
          />
        ) : null}
      </SellerCard>

      {archiveConfirm ? (
        <ArchiveInventoryConfirmModal
          isProcessing={isArchiveProcessing}
          mode={archiveConfirm.mode}
          selectedCount={archiveConfirm.items.length}
          onCancel={() => setArchiveConfirm(null)}
          onConfirm={confirmArchiveInventoryItems}
        />
      ) : null}

      {restoreSuccessDialogMessage ? (
        <RestoreInventorySuccessDialog
          message={restoreSuccessDialogMessage}
          onClose={() => setRestoreSuccessDialogMessage(null)}
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

      {shareProduct ? (
        <ListingShareDialog
          isStorePublic={Boolean(seller?.is_publicly_available)}
          listingTitle={shareProduct.title}
          mode="share"
          open={isShareDialogOpen}
          publicPath={shareProduct.publicPath}
          shareText={shareProduct.shareText}
          storeName={seller?.store_name ?? "Your farm"}
          summary={shareProduct.summary}
          onClose={closeLivePoultryRowShare}
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
    <>
      <label className="grid gap-2 text-lg font-bold text-stone-800 lg:hidden">
        Inventory category
        <select
          aria-label="Inventory category"
          className="h-14 w-full rounded-lg border border-stone-300 bg-white px-4 text-lg font-bold text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
          value={activeTab}
          onChange={(event) =>
            onChange(event.target.value as InventoryProductTab)
          }
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </select>
      </label>
      <div
        aria-label="Inventory product types"
        className="hidden gap-1 overflow-x-auto border-b border-stone-200 pl-px [scrollbar-width:none] lg:flex [&::-webkit-scrollbar]:hidden"
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
    </>
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
  compact = false,
  icon,
  label,
  mobileLarge = false,
  value,
  options,
  onChange,
}: {
  compact?: boolean;
  icon: "filter" | "sort";
  label: string;
  mobileLarge?: boolean;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  const Icon = icon === "filter" ? Funnel : ArrowUpDown;

  if (compact) {
    return (
      <label className="relative block">
        <span className="sr-only">{label}</span>
        <Icon
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-emerald-800"
          strokeWidth={2.25}
        />
        <select
          aria-label={label}
          className="h-11 rounded-md border border-stone-300 bg-white pl-9 pr-3 text-base font-bold text-stone-800 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
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

  return (
    <label
      className={`grid font-bold text-stone-700 ${
        mobileLarge ? "gap-1.5 text-base" : "gap-1 text-[13px]"
      }`}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <Icon
          aria-hidden="true"
          className={`shrink-0 text-emerald-800 ${
            mobileLarge ? "size-5" : "size-3.5"
          }`}
          strokeWidth={2.25}
        />
        {label}
      </span>
      <select
        className={`rounded-md border border-stone-300 bg-white font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 ${
          mobileLarge
            ? "h-14 px-4 text-lg"
            : "min-h-11 px-3 text-sm lg:min-h-10 lg:px-2.5"
        }`}
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
  compact = false,
  glyph,
  label,
  value,
}: {
  compact?: boolean;
  glyph: string;
  label: string;
  value: number | string;
}) {
  if (compact) {
    return (
      <div className="min-w-0 px-2 py-1 text-center first:pl-0 last:pr-0">
        <span className="mx-auto flex size-7 items-center justify-center rounded-full bg-emerald-900/5">
          <Image src={glyph} alt="" width={16} height={16} />
        </span>
        <p className="mt-1 flex min-h-7 items-center justify-center text-center text-[0.68rem] font-bold uppercase leading-3.5 tracking-[0.02em] text-stone-500">
          {label}
        </p>
        <p className="mt-1 truncate text-[1.05rem] font-bold leading-none text-stone-950">
          {value}
        </p>
      </div>
    );
  }

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

function ArchiveInventoryConfirmModal({
  isProcessing,
  mode,
  selectedCount,
  onCancel,
  onConfirm,
}: {
  isProcessing: boolean;
  mode: InventoryArchiveDialogState["mode"];
  selectedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isBulk = mode === "bulk";

  return (
    <div
      aria-labelledby="archive-inventory-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-md border border-stone-200 bg-white p-5 shadow-xl">
        <h2
          className="text-lg font-semibold leading-7 text-stone-950"
          id="archive-inventory-title"
        >
          {isBulk ? "Archive selected inventory?" : "Archive this inventory item?"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-stone-700">
          {isBulk
            ? "These items will be removed from Current Inventory and will no longer appear on your storefront. You can restore them later."
            : "This item will be removed from Current Inventory and will no longer appear on your storefront. You can restore it later."}
        </p>
        <p className="mt-3 text-sm font-semibold text-stone-950">
          {selectedCount} selected
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="seller-secondary-button"
            disabled={isProcessing}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="seller-primary-button"
            disabled={isProcessing || selectedCount === 0}
            onClick={onConfirm}
          >
            {isProcessing
              ? "Archiving..."
              : isBulk
                ? "Archive items"
                : "Archive item"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InventoryPagination({
  disabled,
  page,
  setPage,
  totalCount,
}: {
  disabled: boolean;
  page: number;
  setPage: (value: number) => void;
  totalCount: number;
}) {
  const start = page * 50 + 1;
  const end = Math.min((page + 1) * 50, totalCount);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-stone-200 px-4 py-3 text-sm text-stone-600 sm:px-5">
      <span>
        {start}–{end} of {totalCount}
      </span>
      <div className="flex gap-2">
        <button
          className="seller-secondary-button min-h-10"
          disabled={disabled || page === 0}
          onClick={() => setPage(Math.max(page - 1, 0))}
          type="button"
        >
          Previous
        </button>
        <button
          className="seller-secondary-button min-h-10"
          disabled={disabled || end >= totalCount}
          onClick={() => setPage(page + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function RestoreInventorySuccessDialog({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      aria-labelledby="restore-inventory-success-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-md border border-stone-200 bg-white p-5 shadow-xl">
        <h2
          className="text-lg font-semibold leading-7 text-stone-950"
          id="restore-inventory-success-title"
        >
          Inventory restored
        </h2>
        <p className="mt-3 text-sm leading-6 text-stone-700">{message}</p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className="seller-primary-button"
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function FlatInventoryTable({
  draftPrices,
  draftQuantities,
  hasUnsavedChanges,
  isArchiveProcessing,
  items,
  sharingItemId,
  updatingArchiveItemIds,
  updatingVisibilityItemIds,
  onArchiveInventoryItems,
  onDeselectAll,
  onRestoreInventoryItems,
  onShareInventoryItem,
  onSelectVisible,
  onSetLiveBirdInventoryVisibility,
  onToggleSelection,
  resetDraftPrice,
  selectedItemIds,
  tab,
  updateDraftPrice,
  updateDraftQuantity,
}: {
  draftPrices: Record<string, string>;
  draftQuantities: Record<string, string>;
  hasUnsavedChanges: boolean;
  isArchiveProcessing: boolean;
  items: FlatInventoryItem[];
  sharingItemId: string | null;
  updatingArchiveItemIds: string[];
  updatingVisibilityItemIds: string[];
  onArchiveInventoryItems: (
    items: ArchiveInventoryItem[],
    mode: InventoryArchiveDialogState["mode"],
  ) => void;
  onDeselectAll: () => void;
  onRestoreInventoryItems: (items: ArchiveInventoryItem[]) => void;
  onShareInventoryItem: (item: FlatInventoryItem) => void;
  onSelectVisible: (shouldSelect: boolean) => void;
  onSetLiveBirdInventoryVisibility: (
    items: StoreVisibilityInventoryItem[],
    nextStatus: InventoryStoreVisibilityStatus,
  ) => void;
  onToggleSelection: (itemId: string) => void;
  resetDraftPrice: (item: FlatInventoryItem) => void;
  selectedItemIds: string[];
  tab: InventoryProductTab;
  updateDraftPrice: (item: FlatInventoryItem, nextValue: string) => void;
  updateDraftQuantity: (item: FlatInventoryItem, nextValue: string) => void;
}) {
  const selectedCount = selectedItemIds.length;
  const allVisibleSelected =
    items.length > 0 && items.every((item) => selectedItemIds.includes(item.id));
  const selectedStoreVisibilityItems = items.filter(
    (item): item is StoreVisibilityInventoryItem =>
      item.productTab === tab &&
      isStoreVisibilityInventoryItem(item) &&
      selectedItemIds.includes(item.id),
  );
  const selectedArchiveItems = items.filter(
    (item): item is ArchiveInventoryItem =>
      item.productTab === tab &&
      isArchiveInventoryItem(item) &&
      selectedItemIds.includes(item.id),
  );

  return (
    <>
      {selectedCount > 0 ? (
        <div className="hidden border-b border-stone-200 bg-emerald-50/70 px-4 py-3 lg:flex lg:items-center lg:justify-between">
          <p className="text-base font-bold text-emerald-950 sm:text-sm sm:font-semibold">
            {selectedCount} selected
          </p>
          <div className="flex items-center gap-2">
            <InventoryVisibilityBulkActions
              items={selectedStoreVisibilityItems}
              updatingVisibilityItemIds={updatingVisibilityItemIds}
              onSetLiveBirdInventoryVisibility={onSetLiveBirdInventoryVisibility}
            />
            <InventoryArchiveBulkActions
              items={selectedArchiveItems}
              isProcessing={isArchiveProcessing}
              updatingArchiveItemIds={updatingArchiveItemIds}
              onArchiveInventoryItems={(items) =>
                onArchiveInventoryItems(items, "bulk")
              }
              onRestoreInventoryItems={onRestoreInventoryItems}
            />
            <button
              type="button"
              className="seller-secondary-button"
              disabled={isArchiveProcessing}
              onClick={onDeselectAll}
            >
              Deselect
            </button>
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 p-2 lg:hidden">
        {items.map((item) => (
          <FlatInventoryCard
            draftPrices={draftPrices}
            key={item.id}
            draftQuantities={draftQuantities}
            item={item}
            isSelected={selectedItemIds.includes(item.id)}
            sharingItemId={sharingItemId}
            updatingArchiveItemIds={updatingArchiveItemIds}
            updatingVisibilityItemIds={updatingVisibilityItemIds}
            onArchiveInventoryItems={(items) =>
              onArchiveInventoryItems(items, "single")
            }
            onRestoreInventoryItems={onRestoreInventoryItems}
            onShareInventoryItem={onShareInventoryItem}
            onSetLiveBirdInventoryVisibility={onSetLiveBirdInventoryVisibility}
            onToggleSelection={onToggleSelection}
            resetDraftPrice={resetDraftPrice}
            updateDraftPrice={updateDraftPrice}
            updateDraftQuantity={updateDraftQuantity}
          />
        ))}
      </div>
      {selectedCount > 0 ? (
        <div
          className={`sticky z-30 border-t border-emerald-900/20 bg-white/95 px-3 py-2.5 shadow-[0_-8px_20px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden ${
            hasUnsavedChanges ? "bottom-[7.75rem]" : "bottom-0"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-[7rem] flex-1 text-sm font-bold text-emerald-950">
              {selectedCount} selected
            </p>
            <InventoryVisibilityBulkActions
              items={selectedStoreVisibilityItems}
              updatingVisibilityItemIds={updatingVisibilityItemIds}
              onSetLiveBirdInventoryVisibility={onSetLiveBirdInventoryVisibility}
            />
            <InventoryArchiveBulkActions
              items={selectedArchiveItems}
              isProcessing={isArchiveProcessing}
              updatingArchiveItemIds={updatingArchiveItemIds}
              onArchiveInventoryItems={(items) =>
                onArchiveInventoryItems(items, "bulk")
              }
              onRestoreInventoryItems={onRestoreInventoryItems}
            />
            <button
              type="button"
              className="min-h-11 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 shadow-sm transition hover:border-emerald-700 hover:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isArchiveProcessing}
              onClick={onDeselectAll}
            >
              Deselect
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
                draftPrices={draftPrices}
                key={item.id}
                draftQuantities={draftQuantities}
                item={item}
                isSelected={selectedItemIds.includes(item.id)}
                sharingItemId={sharingItemId}
                updatingArchiveItemIds={updatingArchiveItemIds}
                updatingVisibilityItemIds={updatingVisibilityItemIds}
                onArchiveInventoryItems={(items) =>
                  onArchiveInventoryItems(items, "single")
                }
                onRestoreInventoryItems={onRestoreInventoryItems}
                onShareInventoryItem={onShareInventoryItem}
                onSetLiveBirdInventoryVisibility={onSetLiveBirdInventoryVisibility}
                onToggleSelection={onToggleSelection}
                resetDraftPrice={resetDraftPrice}
                tab={tab}
                updateDraftPrice={updateDraftPrice}
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
          <th className="w-24 px-3 py-2.5">
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
      <th className="w-28 px-3 py-2.5">Price</th>
      <th className="px-3 py-2.5">Availability</th>
      <th className="px-3 py-2.5 text-right">Action</th>
    </tr>
  );
}

function InventoryVisibilityBulkActions({
  items,
  updatingVisibilityItemIds,
  onSetLiveBirdInventoryVisibility,
}: {
  items: StoreVisibilityInventoryItem[];
  updatingVisibilityItemIds: string[];
  onSetLiveBirdInventoryVisibility: (
    items: StoreVisibilityInventoryItem[],
    nextStatus: InventoryStoreVisibilityStatus,
  ) => void;
}) {
  if (items.length === 0) return null;

  const hiddenItems = getStoreVisibilityTargetItems(items, "active");
  const visibleItems = getStoreVisibilityTargetItems(items, "hidden");
  const hasHiddenItems = hiddenItems.length > 0;
  const hasVisibleItems = visibleItems.length > 0;
  const isUpdatingSelection = items.some((item) =>
    updatingVisibilityItemIds.includes(getStoreVisibilityItemId(item)),
  );

  return (
    <>
      {hasVisibleItems ? (
        <button
          type="button"
          className="min-h-12 rounded-md border border-stone-300 bg-white px-3 py-2 text-base font-bold text-stone-800 shadow-sm transition hover:border-emerald-700 hover:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 disabled:cursor-wait disabled:opacity-60 sm:min-h-0 sm:text-sm sm:font-semibold"
          disabled={isUpdatingSelection}
          onClick={() =>
            onSetLiveBirdInventoryVisibility(visibleItems, "hidden")
          }
        >
          Hide from store
        </button>
      ) : null}
      {hasHiddenItems ? (
        <button
          type="button"
          className="min-h-12 rounded-md border border-stone-300 bg-white px-3 py-2 text-base font-bold text-stone-800 shadow-sm transition hover:border-emerald-700 hover:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 disabled:cursor-wait disabled:opacity-60 sm:min-h-0 sm:text-sm sm:font-semibold"
          disabled={isUpdatingSelection}
          onClick={() => onSetLiveBirdInventoryVisibility(hiddenItems, "active")}
        >
          Show on store
        </button>
      ) : null}
    </>
  );
}

function InventoryArchiveBulkActions({
  isProcessing,
  items,
  updatingArchiveItemIds,
  onArchiveInventoryItems,
  onRestoreInventoryItems,
}: {
  isProcessing: boolean;
  items: ArchiveInventoryItem[];
  updatingArchiveItemIds: string[];
  onArchiveInventoryItems: (items: ArchiveInventoryItem[]) => void;
  onRestoreInventoryItems: (items: ArchiveInventoryItem[]) => void;
}) {
  if (items.length === 0) return null;

  const archiveItems = getArchiveTargetItems(items, "archived");
  const restoreItems = getArchiveTargetItems(items, "hidden");
  const isUpdatingSelection = items.some((item) =>
    updatingArchiveItemIds.includes(getArchiveItemId(item)),
  );

  return (
    <>
      {archiveItems.length > 0 ? (
        <button
          type="button"
          className="min-h-12 rounded-md border border-emerald-800 bg-emerald-800 px-3 py-2 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800/25 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:text-sm sm:font-semibold"
          disabled={isProcessing || isUpdatingSelection}
          onClick={() => onArchiveInventoryItems(archiveItems)}
        >
          Archive
        </button>
      ) : null}
      {restoreItems.length > 0 ? (
        <button
          type="button"
          className="min-h-12 rounded-md border border-stone-300 bg-white px-3 py-2 text-base font-bold text-stone-800 shadow-sm transition hover:border-emerald-700 hover:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 disabled:cursor-wait disabled:opacity-60 sm:min-h-0 sm:text-sm sm:font-semibold"
          disabled={isProcessing || isUpdatingSelection}
          onClick={() => onRestoreInventoryItems(restoreItems)}
        >
          Restore to inventory
        </button>
      ) : null}
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
  draftPrices,
  draftQuantities,
  isSelected,
  item,
  sharingItemId,
  updatingArchiveItemIds,
  updatingVisibilityItemIds,
  onArchiveInventoryItems,
  onRestoreInventoryItems,
  onShareInventoryItem,
  onSetLiveBirdInventoryVisibility,
  onToggleSelection,
  resetDraftPrice,
  tab,
  updateDraftPrice,
  updateDraftQuantity,
}: {
  draftPrices: Record<string, string>;
  draftQuantities: Record<string, string>;
  isSelected: boolean;
  item: FlatInventoryItem;
  sharingItemId: string | null;
  updatingArchiveItemIds: string[];
  updatingVisibilityItemIds: string[];
  onArchiveInventoryItems: (items: ArchiveInventoryItem[]) => void;
  onRestoreInventoryItems: (items: ArchiveInventoryItem[]) => void;
  onShareInventoryItem: (item: FlatInventoryItem) => void;
  onSetLiveBirdInventoryVisibility: (
    items: StoreVisibilityInventoryItem[],
    nextStatus: InventoryStoreVisibilityStatus,
  ) => void;
  onToggleSelection: (itemId: string) => void;
  resetDraftPrice: (item: FlatInventoryItem) => void;
  tab: InventoryProductTab;
  updateDraftPrice: (item: FlatInventoryItem, nextValue: string) => void;
  updateDraftQuantity: (item: FlatInventoryItem, nextValue: string) => void;
}) {
  const isChanged =
    isInventoryItemChanged(item, draftQuantities) ||
    isInventoryItemPriceChanged(item, draftPrices);
  const priceCell = (
    <td className="w-28 px-3 py-3 align-top">
      <PriceEditControl
        draftPrices={draftPrices}
        item={item}
        resetDraftPrice={resetDraftPrice}
        updateDraftPrice={updateDraftPrice}
      />
    </td>
  );

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
          <td className="w-24 px-3 py-3 align-top text-stone-700">
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
      {priceCell}
      <td className="px-3 py-3 align-top">
        <AvailabilityPill label={item.availabilityLabel} />
      </td>
      <td className="px-3 py-3 text-right align-top">
        <InventoryItemActionsMenu
          item={item}
          isSharing={sharingItemId === item.id}
          isVisibilityUpdating={
            isStoreVisibilityInventoryItem(item) &&
            updatingVisibilityItemIds.includes(getStoreVisibilityItemId(item))
          }
          isArchiveUpdating={
            isArchiveInventoryItem(item) &&
            updatingArchiveItemIds.includes(getArchiveItemId(item))
          }
          onArchiveInventoryItems={(items) => onArchiveInventoryItems(items)}
          onRestoreInventoryItems={onRestoreInventoryItems}
          onShareInventoryItem={onShareInventoryItem}
          onSetLiveBirdInventoryVisibility={onSetLiveBirdInventoryVisibility}
        />
      </td>
    </tr>
  );
}

function FlatInventoryCard({
  draftPrices,
  draftQuantities,
  isSelected,
  item,
  sharingItemId,
  updatingArchiveItemIds,
  updatingVisibilityItemIds,
  onArchiveInventoryItems,
  onRestoreInventoryItems,
  onShareInventoryItem,
  onSetLiveBirdInventoryVisibility,
  onToggleSelection,
  resetDraftPrice,
  updateDraftPrice,
  updateDraftQuantity,
}: {
  draftPrices: Record<string, string>;
  draftQuantities: Record<string, string>;
  isSelected: boolean;
  item: FlatInventoryItem;
  sharingItemId: string | null;
  updatingArchiveItemIds: string[];
  updatingVisibilityItemIds: string[];
  onArchiveInventoryItems: (items: ArchiveInventoryItem[]) => void;
  onRestoreInventoryItems: (items: ArchiveInventoryItem[]) => void;
  onShareInventoryItem: (item: FlatInventoryItem) => void;
  onSetLiveBirdInventoryVisibility: (
    items: StoreVisibilityInventoryItem[],
    nextStatus: InventoryStoreVisibilityStatus,
  ) => void;
  onToggleSelection: (itemId: string) => void;
  resetDraftPrice: (item: FlatInventoryItem) => void;
  updateDraftPrice: (item: FlatInventoryItem, nextValue: string) => void;
  updateDraftQuantity: (item: FlatInventoryItem, nextValue: string) => void;
}) {
  const isChanged =
    isInventoryItemChanged(item, draftQuantities) ||
    isInventoryItemPriceChanged(item, draftPrices);
  const compactTitle =
    item.productTab === "live_poultry" && item.typeSex
      ? `${item.breedOrItem}, ${item.typeSex}`
      : item.breedOrItem;

  return (
    <article
      className={`rounded-lg border p-3 shadow-sm ${
        isSelected
          ? "border-emerald-700 bg-emerald-50/70"
          : isChanged
            ? "border-amber-200 bg-amber-50/70"
            : "border-transparent bg-white sm:border-stone-200"
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          aria-label={`Select ${item.breedOrItem}`}
          checked={isSelected}
          className="mt-2 size-6 shrink-0 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
          type="checkbox"
          onChange={() => onToggleSelection(item.id)}
        />
        <details className="group min-w-0 flex-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700/20 [&::-webkit-details-marker]:hidden">
            <InventoryItemThumbnail item={item} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold text-stone-950">
                {compactTitle}
              </span>
              <span
                className={`mt-0.5 block truncate leading-5 text-stone-600 ${
                  item.productTab === "live_poultry"
                    ? "text-base font-medium"
                    : "text-sm"
                }`}
              >
                {item.productTab === "live_poultry"
                  ? `Age: ${item.ageLabel}`
                  : getInventoryItemSubtitle(item)}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-xl leading-none text-stone-500 transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </summary>

          <div className="-ml-8 mt-3 w-[calc(100%+2rem)] min-w-0 border-t border-stone-200 pt-3">
            <dl className="grid min-w-0 grid-cols-2 gap-2 text-sm">
              {item.productTab === "live_poultry" ? (
                <InventoryCardField
                  label="Hatch date"
                  value={formatTableDate(item.hatchDate)}
                />
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
                  <InventoryCardField
                    label="Category"
                    value={item.equipmentCategory}
                  />
                  <InventoryCardField
                    label="Condition"
                    value={item.condition || "--"}
                  />
                </>
              ) : null}
              <InventoryCardField
                label="Reserved"
                value={String(item.reservedQuantity)}
              />
              <div className="col-start-1 rounded-md bg-stone-50 px-2.5 py-2">
                <dt className="text-sm font-bold uppercase tracking-[0.05em] text-stone-500 sm:text-xs sm:font-semibold">
                  Still Available
                </dt>
                <dd className="mt-1">
                  <AvailableQuantityControl
                    draftQuantities={draftQuantities}
                    item={item}
                    updateDraftQuantity={updateDraftQuantity}
                  />
                </dd>
              </div>
              <div className="rounded-md bg-stone-50 px-2.5 py-2">
                <dt className="text-sm font-bold uppercase tracking-[0.05em] text-stone-500 sm:text-xs sm:font-semibold">
                  Price
                </dt>
                <dd className="mt-1">
                  <PriceEditControl
                    draftPrices={draftPrices}
                    item={item}
                    resetDraftPrice={resetDraftPrice}
                    updateDraftPrice={updateDraftPrice}
                  />
                </dd>
              </div>
              <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <InventoryCardField
                  label="Availability"
                  value={item.availabilityLabel}
                />
                <InventoryItemActionsMenu
                  item={item}
                  isSharing={sharingItemId === item.id}
                  isVisibilityUpdating={
                    isStoreVisibilityInventoryItem(item) &&
                    updatingVisibilityItemIds.includes(
                      getStoreVisibilityItemId(item),
                    )
                  }
                  isArchiveUpdating={
                    isArchiveInventoryItem(item) &&
                    updatingArchiveItemIds.includes(getArchiveItemId(item))
                  }
                  onArchiveInventoryItems={(items) =>
                    onArchiveInventoryItems(items)
                  }
                  onRestoreInventoryItems={onRestoreInventoryItems}
                  onShareInventoryItem={onShareInventoryItem}
                  onSetLiveBirdInventoryVisibility={
                    onSetLiveBirdInventoryVisibility
                  }
                />
              </div>
            </dl>
          </div>
        </details>
      </div>
    </article>
  );
}

function InventoryItemActionsMenu({
  isArchiveUpdating,
  isVisibilityUpdating,
  isSharing,
  item,
  onArchiveInventoryItems,
  onRestoreInventoryItems,
  onShareInventoryItem,
  onSetLiveBirdInventoryVisibility,
}: {
  isArchiveUpdating: boolean;
  isVisibilityUpdating: boolean;
  isSharing: boolean;
  item: FlatInventoryItem;
  onArchiveInventoryItems: (items: ArchiveInventoryItem[]) => void;
  onRestoreInventoryItems: (items: ArchiveInventoryItem[]) => void;
  onShareInventoryItem: (item: FlatInventoryItem) => void;
  onSetLiveBirdInventoryVisibility: (
    items: StoreVisibilityInventoryItem[],
    nextStatus: InventoryStoreVisibilityStatus,
  ) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const canShare = isShareableInventoryItem(item);
  const storeVisibilityAction = getStoreVisibilityAction(item);
  const archiveAction = getArchiveAction(item);

  function updateMenuPosition() {
    const summaryElement = summaryRef.current;

    if (!summaryElement) return;

    const rect = summaryElement.getBoundingClientRect();
    const menuWidth = 176;
    const menuHeight = menuRef.current?.offsetHeight ?? 190;
    const gap = 8;
    const viewportPadding = 8;
    const left = Math.max(
      viewportPadding,
      Math.min(window.innerWidth - menuWidth - viewportPadding, rect.right - menuWidth),
    );
    const bottomTop = rect.bottom + gap;
    const top =
      bottomTop + menuHeight + viewportPadding > window.innerHeight
        ? Math.max(viewportPadding, rect.top - menuHeight - gap)
        : bottomTop;

    setMenuPosition({ left, top });
  }

  useEffect(() => {
    if (!isOpen) return;

    const frameId = window.requestAnimationFrame(updateMenuPosition);

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen]);

  return (
    <details
      className="relative inline-block text-left"
      open={isOpen}
      onToggle={(event) => {
        const nextIsOpen = event.currentTarget.open;

        setIsOpen(nextIsOpen);
        setMenuPosition(null);

        if (nextIsOpen) {
          window.requestAnimationFrame(updateMenuPosition);
        }
      }}
    >
      <summary
        ref={summaryRef}
        aria-label={`Actions for ${item.breedOrItem}`}
        className="inline-flex size-9 cursor-pointer list-none items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 shadow-sm transition hover:border-emerald-700 hover:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </summary>
      <div
        ref={menuRef}
        className="fixed z-50 w-44 rounded-lg border border-stone-200 bg-white p-1.5 text-left shadow-[0_18px_40px_rgba(46,39,25,0.14)]"
        style={{
          left: menuPosition?.left ?? 0,
          top: menuPosition?.top ?? 0,
          visibility: menuPosition ? "visible" : "hidden",
        }}
      >
        <Link
          className="block rounded-md px-3 py-2.5 text-base font-semibold text-stone-800 transition hover:bg-stone-100 hover:text-stone-950 focus:bg-stone-100 focus:outline-none lg:py-2 lg:text-sm"
          href={item.manageHref}
          onClick={() => setIsOpen(false)}
        >
          {item.kind === "bird" && item.row.is_unfinished_add_v2_draft
            ? "Continue draft"
            : "Edit"}
        </Link>
        {canShare ? (
          <button
            type="button"
            className="block w-full rounded-md px-3 py-2.5 text-left text-base font-semibold text-stone-800 transition hover:bg-stone-100 hover:text-stone-950 focus:bg-stone-100 focus:outline-none disabled:cursor-wait disabled:opacity-60 lg:py-2 lg:text-sm"
            disabled={isSharing}
            onClick={() => {
              setIsOpen(false);
              onShareInventoryItem(item);
            }}
          >
            {isSharing ? "Opening..." : "Share listing"}
          </button>
        ) : null}
        {storeVisibilityAction ? (
          <button
            type="button"
            className="block w-full rounded-md px-3 py-2.5 text-left text-base font-semibold text-stone-800 transition hover:bg-stone-100 hover:text-stone-950 focus:bg-stone-100 focus:outline-none disabled:cursor-wait disabled:opacity-60 lg:py-2 lg:text-sm"
            disabled={isVisibilityUpdating}
            onClick={() => {
              setIsOpen(false);
              onSetLiveBirdInventoryVisibility(
                [storeVisibilityAction.item],
                storeVisibilityAction.nextStatus,
              );
            }}
          >
            {isVisibilityUpdating
              ? "Updating..."
              : storeVisibilityAction.label}
          </button>
        ) : null}
        {archiveAction ? (
          <button
            type="button"
            className="block w-full rounded-md px-3 py-2.5 text-left text-base font-semibold text-stone-800 transition hover:bg-stone-100 hover:text-stone-950 focus:bg-stone-100 focus:outline-none disabled:cursor-wait disabled:opacity-60 lg:py-2 lg:text-sm"
            disabled={isArchiveUpdating}
            onClick={() => {
              setIsOpen(false);

              if (archiveAction.nextStatus === "archived") {
                onArchiveInventoryItems([archiveAction.item]);
              } else {
                onRestoreInventoryItems([archiveAction.item]);
              }
            }}
          >
            {isArchiveUpdating ? "Updating..." : archiveAction.label}
          </button>
        ) : null}
      </div>
    </details>
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
    <div className="min-w-0 rounded-md bg-stone-50 px-2.5 py-2">
      <dt className="text-sm font-bold uppercase tracking-[0.05em] text-stone-500 sm:text-xs sm:font-semibold">
        {label}
      </dt>
      <dd className="mt-1 break-words text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">{value}</dd>
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
      <span className="inline-flex h-11 min-w-24 items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-2 text-lg font-bold text-stone-950 sm:h-8 sm:min-w-16 sm:text-sm sm:font-semibold">
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
        className={`h-11 w-24 rounded-md border px-2 text-center text-lg font-bold text-stone-950 shadow-sm focus:outline-none focus:ring-2 sm:h-8 sm:w-16 sm:text-sm sm:font-semibold ${
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

function PriceEditControl({
  draftPrices,
  item,
  resetDraftPrice,
  updateDraftPrice,
}: {
  draftPrices: Record<string, string>;
  item: FlatInventoryItem;
  resetDraftPrice: (item: FlatInventoryItem) => void;
  updateDraftPrice: (item: FlatInventoryItem, nextValue: string) => void;
}) {
  const priceItemId = getPriceEditItemId(item);
  const priceValue =
    draftPrices[priceItemId] ?? formatPriceInput(getOriginalPrice(item));
  const rowHasInvalidPrice =
    draftPrices[priceItemId] != null && normalizePriceInput(priceValue) == null;
  const isChanged = isInventoryItemPriceChanged(item, draftPrices);

  return (
    <div className="flex flex-col items-start">
      <label className="sr-only" htmlFor={`price-${priceItemId}`}>
        Price for {item.breedOrItem}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-500">
          $
        </span>
        <input
          id={`price-${priceItemId}`}
          aria-label={`Price for ${item.breedOrItem}`}
          className={`h-11 w-24 rounded-md border py-0 pl-6 pr-2 text-right text-lg font-bold text-stone-950 shadow-sm focus:outline-none focus:ring-2 sm:h-8 sm:w-20 sm:text-sm sm:font-semibold ${
            rowHasInvalidPrice
              ? "border-red-400 focus:border-red-600 focus:ring-red-600/20"
              : isChanged
                ? "border-amber-300 bg-amber-50 focus:border-amber-600 focus:ring-amber-600/20"
              : "border-stone-300 focus:border-emerald-700 focus:ring-emerald-700/20"
          }`}
          inputMode="decimal"
          min="0"
          step="0.01"
          type="text"
          value={priceValue}
          onChange={(event) => updateDraftPrice(item, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }

            if (event.key === "Escape") {
              event.preventDefault();
              resetDraftPrice(item);
            }
          }}
        />
      </div>
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
        isArchived: isInventoryItemArchivedByRow(row),
        manageHref: getLiveBirdInventoryManageHref({
          isUnfinishedDraft: row.is_unfinished_add_v2_draft,
          listingBatchId: row.listing_batch_id,
        }),
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
        isArchived: isInventoryItemArchivedByRow(row),
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
        availableDate: row.available_date,
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
        isArchived: isInventoryItemArchivedByRow(row),
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
        availableDate: row.available_date,
        ageDays: null,
        ageLabel: "--",
        availableQuantity: displayedQuantity,
        reservedQuantity:
          reservedByEquipmentId[row.equipment_inventory_item_id] ?? 0,
        price: row.price,
        availabilityLabel: availability.label,
        availabilityValue: availability.value,
        isArchived: isInventoryItemArchivedByRow(row),
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
  const visibility = getInventoryVisibility(row);

  if (visibility === "archived") {
    return { label: "Archived", value: "archived" };
  }

  if (visibility === "draft" || visibility === "hidden") {
    return {
      label: visibility === "draft" ? "Draft" : "Hidden",
      value: "hidden",
    };
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
      label: `Ready ${formatShortDate(row.available_date)}`,
      value: "coming_soon",
    };
  }

  return { label: "Ready now", value: "available_now" };
}

function normalizeInventoryPageResponse(value: unknown): InventoryPageResponse {
  const response = (value ?? {}) as Partial<InventoryPageResponse>;

  return {
    category: response.category ?? "live_poultry",
    category_count: Number(response.category_count ?? 0),
    options: response.options ?? {},
    rows: Array.isArray(response.rows) ? response.rows : [],
    summary: {
      available_quantity: Number(response.summary?.available_quantity ?? 0),
      inventory_value: Number(response.summary?.inventory_value ?? 0),
      reserved_quantity: Number(response.summary?.reserved_quantity ?? 0),
    },
    total_count: Number(response.total_count ?? 0),
  };
}

function getInventoryPageRowId(
  category: InventoryProductTab,
  row: Record<string, unknown>,
) {
  if (category === "live_poultry") return String(row.inventory_item_id ?? "");
  if (category === "hatching_eggs") {
    return String(row.hatching_egg_inventory_item_id ?? "");
  }
  if (category === "processed_poultry") {
    return String(row.processed_poultry_inventory_item_id ?? "");
  }

  return String(row.equipment_inventory_item_id ?? "");
}

function buildInventoryPageFilterOptions(page: InventoryPageResponse | null) {
  const options = page?.options ?? {};

  return {
    availability: [
      { label: "Current inventory", value: "current_inventory" },
      { label: "Ready now", value: "available_now" },
      { label: "Ready later", value: "coming_soon" },
      { label: "Sold out", value: "sold_out" },
      { label: "Hidden", value: "hidden" },
      { label: "Archived", value: "archived" },
    ],
    breed: [{ label: "All breeds", value: "all" }, ...(options.breed ?? [])],
    condition: [
      { label: "All conditions", value: "all" },
      ...(options.condition ?? []),
    ],
    equipmentCategory: [
      { label: "All categories", value: "all" },
      ...(options.equipment_category ?? []),
    ],
    productCategory: [
      { label: "All categories", value: "all" },
      ...(options.product_category ?? []),
    ],
    species: [
      { label: "All species", value: "all" },
      ...(options.species ?? []),
    ],
    typeSex: [
      { label: "All types", value: "all" },
      ...(options.type_sex ?? []),
    ],
  };
}

function buildInventoryPageSummary(
  activeTab: InventoryProductTab,
  page: InventoryPageResponse | null,
) {
  const availableValue = page?.summary.available_quantity ?? 0;
  const reservedValue = page?.summary.reserved_quantity ?? 0;
  const inventoryValue = page?.summary.inventory_value ?? 0;

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

function getSimpleInventoryAvailability(row: {
  available_date?: string | null;
  operational_availability_status: string;
  quantity_available: number;
  visibility_status: string;
}, displayedQuantity = row.quantity_available): {
  label: string;
  value: AvailabilityFilter;
} {
  if (row.visibility_status === "archived") {
    return { label: "Archived", value: "archived" };
  }

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

  if (row.available_date && isFutureDate(row.available_date)) {
    return {
      label: `Ready ${formatShortDate(row.available_date)}`,
      value: "coming_soon",
    };
  }

  return { label: "Ready now", value: "available_now" };
}

function getStandaloneHatchingEggAvailability(
  row: HatchingEggInventoryRow,
): { label: string; value: AvailabilityFilter } {
  if (row.visibility_status === "archived") {
    return { label: "Archived", value: "archived" };
  }

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
      label: `Ready ${formatShortDate(row.available_date)}`,
      value: "coming_soon",
    };
  }

  return { label: "Ready now", value: "available_now" };
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

function getSearchPlaceholder(tab: InventoryProductTab) {
  if (tab === "hatching_eggs") return "Breed, variety, or species";
  if (tab === "processed_poultry") return "Product name";
  if (tab === "equipment") return "Item name";

  return "Breed or type";
}

function getMobileSearchPlaceholder(tab: InventoryProductTab) {
  if (tab === "hatching_eggs") {
    return "Search by breed, variety, or species";
  }
  if (tab === "processed_poultry") return "Search by product name";
  if (tab === "equipment") return "Search by item name";

  return "Search by breed or type";
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
    return [item.typeSex, item.species].filter(Boolean).join(" · ");
  }

  if (item.kind === "processed_poultry") {
    return [item.productCategory, item.typeSex].filter(Boolean).join(" - ");
  }

  if (item.kind === "equipment") {
    return [item.equipmentCategory, item.condition].filter(Boolean).join(" - ");
  }

  return [item.species, item.typeSex].filter(Boolean).join(" - ");
}

function isShareableInventoryItem(item: FlatInventoryItem) {
  if (item.kind === "bird") return isShareableLivePoultryItem(item);

  if (item.kind === "hatching_egg") {
    return Boolean(
      item.row.hatching_egg_product_id?.trim() &&
        item.row.visibility_status === "active" &&
        item.row.moderation_status === "normal" &&
        !isInventoryItemArchivedByRow(item.row),
    );
  }

  if (item.kind === "processed_poultry") {
    return Boolean(
      item.row.processed_poultry_inventory_item_id?.trim() &&
        item.row.visibility_status === "active" &&
        item.row.moderation_status === "normal" &&
        !isInventoryItemArchivedByRow(item.row),
    );
  }

  if (item.kind === "equipment") {
    return Boolean(
      item.row.equipment_inventory_item_id?.trim() &&
        item.row.visibility_status === "active" &&
        item.row.moderation_status === "normal" &&
        !isInventoryItemArchivedByRow(item.row),
    );
  }

  return false;
}

function isShareableLivePoultryItem(item: FlatInventoryItem): item is BirdInventoryItem {
  if (item.kind !== "bird") return false;

  const row = item.row;

  return Boolean(
    row.listing_batch_breed_id?.trim() &&
      !isInventoryItemArchivedByRow(row) &&
      row.listing_batch_visibility_status === "active" &&
      row.listing_batch_breed_visibility_status === "active" &&
      row.inventory_visibility_status === "active" &&
      row.listing_batch_moderation_status === "normal" &&
      row.inventory_moderation_status === "normal",
  );
}

function buildSimpleInventoryShareProduct(
  item: FlatInventoryItem,
  seller: { store_name: string | null | undefined; store_slug: string | null | undefined },
): InventoryShareDialogState | null {
  if (!isShareableInventoryItem(item) || item.kind === "bird") return null;

  if (item.kind === "hatching_egg") {
    const input = {
      availableDate: item.row.available_date,
      itemName: item.row.item_name,
      price: item.row.price,
    };

    return {
      id: item.row.hatching_egg_inventory_item_id,
      publicPath: buildPublicListingPath({
        listingType: "hatching_eggs",
        productId: item.row.hatching_egg_product_id,
        storeSlug: seller.store_slug,
      }),
      shareText: buildHatchingEggShareText(input, seller.store_name),
      summary: buildHatchingEggShareSummary(input),
      title: item.row.item_name,
    };
  }

  if (item.kind === "processed_poultry") {
    const input = {
      packageSize: item.row.package_size,
      price: item.row.price,
      productName: item.row.product_name,
      quantityAvailable: item.row.quantity_available,
    };

    return {
      id: item.row.processed_poultry_inventory_item_id,
      publicPath: buildPublicListingPath({
        listingType: "poultry_products",
        processedPoultryItemId: item.row.processed_poultry_inventory_item_id,
        storeSlug: seller.store_slug,
      }),
      shareText: buildPoultryProductShareText(input, seller.store_name),
      summary: buildPoultryProductShareSummary(input),
      title: item.row.product_name,
    };
  }

  if (item.kind === "equipment") {
    const input = {
      condition: item.row.condition,
      itemName: item.row.item_name,
      price: item.row.price,
    };

    return {
      id: item.row.equipment_inventory_item_id,
      publicPath: buildPublicListingPath({
        listingType: "equipment_supplies",
        equipmentItemId: item.row.equipment_inventory_item_id,
        storeSlug: seller.store_slug,
      }),
      shareText: buildEquipmentShareText(input, seller.store_name),
      summary: buildEquipmentShareSummary(input),
      title: item.row.item_name,
    };
  }

  return null;
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
    row.listing_batch_breed_visibility_status === "archived" ||
    row.inventory_visibility_status === "archived"
  ) {
    return "archived";
  }

  if (row.inventory_visibility_status === "hidden") return "hidden";
  if (row.listing_batch_visibility_status === "hidden") {
    return row.is_unfinished_add_v2_draft ? "draft" : "hidden";
  }
  if (row.listing_batch_breed_visibility_status === "hidden") return "hidden";
  if (row.operational_availability_status === "sold_out") return "sold_out";
  if (row.operational_availability_status === "hidden") return "hidden";
  if (row.operational_availability_status === "unavailable") return "hidden";
  if (
    row.listing_batch_visibility_status === "active" &&
    row.listing_batch_breed_visibility_status === "active" &&
    row.inventory_visibility_status === "active"
  ) {
    return "live";
  }

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

function formatInventoryAge(row: InventoryRow) {
  return formatInventoryAgeLabel(
    calculateCurrentBirdAgeDays(row.origin_date),
  ).replace(/ old$/, "");
}

function calculateInventoryAgeDays(row: InventoryRow) {
  return calculateAgeAtAvailabilityDays(
    row.origin_date ?? "",
    row.available_date,
  );
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

function getPriceEditItemId(item: FlatInventoryItem) {
  return `price:${getDraftQuantityId(item)}`;
}

function getOriginalPrice(item: FlatInventoryItem) {
  return item.price ?? 0;
}

function formatPriceInput(value: number | null | undefined) {
  return (value ?? 0).toFixed(2);
}

function normalizePriceInput(value: string) {
  const trimmedValue = value.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(trimmedValue)) return null;

  const numericValue = Number(trimmedValue);

  if (!Number.isFinite(numericValue) || numericValue < 0) return null;

  return Math.round(numericValue * 100) / 100;
}

function areMoneyValuesEqual(left: number, right: number | null | undefined) {
  return Math.round(left * 100) === Math.round((right ?? 0) * 100);
}

function isInventoryItemPriceChanged(
  item: FlatInventoryItem,
  draftPrices: Record<string, string>,
) {
  const draftValue = draftPrices[getPriceEditItemId(item)];

  if (draftValue == null) return false;

  const normalizedValue = normalizePriceInput(draftValue);

  if (normalizedValue == null) return true;

  return !areMoneyValuesEqual(normalizedValue, getOriginalPrice(item));
}

function getPendingInventoryPrice(
  itemId: string,
  originalPrice: number,
  draftPrices: Record<string, string>,
) {
  const normalizedValue = normalizePriceInput(draftPrices[`price:${itemId}`] ?? "");

  return normalizedValue ?? originalPrice;
}

function isStoreVisibilityInventoryItem(
  item: FlatInventoryItem,
): item is StoreVisibilityInventoryItem {
  return (
    item.kind === "bird" ||
    item.kind === "hatching_egg" ||
    item.kind === "processed_poultry" ||
    item.kind === "equipment"
  );
}

function isArchiveInventoryItem(item: FlatInventoryItem): item is ArchiveInventoryItem {
  return isStoreVisibilityInventoryItem(item);
}

function isInventoryItemArchivedByRow(
  row:
    | InventoryRow
    | HatchingEggInventoryRow
    | ProcessedPoultryInventoryRow
    | EquipmentInventoryRow,
) {
  if ("inventory_visibility_status" in row) {
    return (
      row.inventory_visibility_status === "archived" ||
      row.listing_batch_visibility_status === "archived" ||
      row.listing_batch_breed_visibility_status === "archived"
    );
  }

  return row.visibility_status === "archived";
}

function getStoreVisibilityItemId(item: StoreVisibilityInventoryItem) {
  if (item.kind === "bird") return item.row.inventory_item_id;
  if (item.kind === "hatching_egg") {
    return item.row.hatching_egg_inventory_item_id;
  }
  if (item.kind === "processed_poultry") {
    return item.row.processed_poultry_inventory_item_id;
  }

  return item.row.equipment_inventory_item_id;
}

function getStoreVisibilityStatus(item: StoreVisibilityInventoryItem) {
  if (item.kind === "bird") return item.row.inventory_visibility_status;

  return item.row.visibility_status;
}

function getArchiveItemId(item: ArchiveInventoryItem) {
  return getStoreVisibilityItemId(item);
}

function isInventoryItemArchived(item: ArchiveInventoryItem) {
  return isInventoryItemArchivedByRow(item.row);
}

function getArchiveAction(item: FlatInventoryItem): {
  item: ArchiveInventoryItem;
  label: string;
  nextStatus: InventoryArchiveStatus;
} | null {
  if (!isArchiveInventoryItem(item)) return null;

  if (isInventoryItemArchived(item)) {
    return { item, label: "Restore to inventory", nextStatus: "hidden" };
  }

  return { item, label: "Archive", nextStatus: "archived" };
}

function getStoreVisibilityAction(item: FlatInventoryItem): {
  item: StoreVisibilityInventoryItem;
  label: string;
  nextStatus: InventoryStoreVisibilityStatus;
} | null {
  if (!isStoreVisibilityInventoryItem(item)) return null;
  if (isInventoryItemArchived(item)) return null;
  if (item.kind === "bird" && item.row.is_unfinished_add_v2_draft) return null;

  const visibilityStatus = getStoreVisibilityStatus(item);

  if (visibilityStatus === "hidden") {
    return { item, label: "Show on store", nextStatus: "active" };
  }

  return { item, label: "Hide from store", nextStatus: "hidden" };
}

function getStoreVisibilityTargetItems(
  items: StoreVisibilityInventoryItem[],
  nextStatus: InventoryStoreVisibilityStatus,
) {
  return items.filter((item) =>
    nextStatus === "hidden"
      ? !isInventoryItemArchived(item) && getStoreVisibilityStatus(item) !== "hidden"
      : !isInventoryItemArchived(item) && getStoreVisibilityStatus(item) === "hidden",
  );
}

function getArchiveTargetItems(
  items: ArchiveInventoryItem[],
  nextStatus: InventoryArchiveStatus,
) {
  return items.filter((item) =>
    nextStatus === "archived"
      ? !isInventoryItemArchived(item)
      : isInventoryItemArchived(item),
  );
}

async function setInventoryItemVisibility(
  item: StoreVisibilityInventoryItem,
  nextStatus: InventoryStoreVisibilityStatus,
) {
  if (item.kind === "bird") {
    return supabase.rpc("seller_set_inventory_visibility", {
      p_inventory_item_id: item.row.inventory_item_id,
      p_visibility_status: nextStatus,
      p_note:
        nextStatus === "hidden"
          ? "Hidden from seller Inventory page."
          : "Shown from seller Inventory page.",
    });
  }

  if (item.kind === "hatching_egg") {
    return supabase.rpc("seller_set_hatching_egg_inventory_visibility", {
      p_hatching_egg_inventory_item_id:
        item.row.hatching_egg_inventory_item_id,
      p_visibility_status: nextStatus,
    });
  }

  if (item.kind === "processed_poultry") {
    return supabase.rpc("seller_set_processed_poultry_inventory_visibility", {
      p_processed_poultry_inventory_item_id:
        item.row.processed_poultry_inventory_item_id,
      p_visibility_status: nextStatus,
    });
  }

  return supabase.rpc("seller_set_equipment_inventory_visibility", {
    p_equipment_inventory_item_id: item.row.equipment_inventory_item_id,
    p_visibility_status: nextStatus,
  });
}

async function setInventoryItemArchiveStatus(
  item: ArchiveInventoryItem,
  nextStatus: InventoryArchiveStatus,
) {
  if (item.kind === "bird") {
    return supabase.rpc(
      nextStatus === "archived"
        ? "seller_archive_inventory_items"
        : "seller_restore_inventory_items",
      {
        p_inventory_item_ids: [item.row.inventory_item_id],
      },
    );
  }

  if (item.kind === "hatching_egg") {
    return supabase.rpc(
      nextStatus === "archived"
        ? "seller_archive_hatching_egg_inventory_items"
        : "seller_restore_hatching_egg_inventory_items",
      {
        p_hatching_egg_inventory_item_ids: [
          item.row.hatching_egg_inventory_item_id,
        ],
      },
    );
  }

  if (item.kind === "processed_poultry") {
    return supabase.rpc(
      nextStatus === "archived"
        ? "seller_archive_processed_poultry_inventory_items"
        : "seller_restore_processed_poultry_inventory_items",
      {
        p_processed_poultry_inventory_item_ids: [
          item.row.processed_poultry_inventory_item_id,
        ],
      },
    );
  }

  return supabase.rpc(
    nextStatus === "archived"
      ? "seller_archive_equipment_inventory_items"
      : "seller_restore_equipment_inventory_items",
    {
      p_equipment_inventory_item_ids: [item.row.equipment_inventory_item_id],
    },
  );
}

async function updateInventoryItemPrice(
  item: FlatInventoryItem,
  nextPrice: number,
  draftQuantities: Record<string, string>,
) {
  if (item.kind === "bird") {
    return supabase.rpc("seller_update_inventory_item", {
      p_custom_inventory_label: item.row.custom_inventory_label,
      p_inventory_item_id: item.row.inventory_item_id,
      p_inventory_type: item.row.inventory_type,
      p_price_override: nextPrice,
      p_seller_notes: item.row.inventory_seller_notes,
      p_sort_order: item.row.inventory_item_sort_order ?? 0,
    });
  }

  if (item.kind === "hatching_egg") {
    return supabase.rpc("seller_update_hatching_egg_inventory_item", {
      p_available_date: item.row.available_date,
      p_description: item.row.description ?? "",
      p_hatching_egg_inventory_item_id:
        item.row.hatching_egg_inventory_item_id,
      p_item_name: item.row.item_name,
      p_minimum_order_quantity: item.row.minimum_order_quantity,
      p_price: nextPrice,
      p_quantity_available:
        draftQuantities[item.row.hatching_egg_inventory_item_id] != null
          ? Number(draftQuantities[item.row.hatching_egg_inventory_item_id])
          : item.row.quantity_available,
      p_seller_notes: item.row.seller_notes,
      p_species_id: item.row.species_id,
    });
  }

  if (item.kind === "processed_poultry") {
    return supabase.rpc("seller_update_processed_poultry_inventory_item", {
      p_description: item.row.description || null,
      p_package_size: item.row.package_size || null,
      p_poultry_type: item.row.poultry_type,
      p_price: nextPrice,
      p_processed_poultry_inventory_item_id:
        item.row.processed_poultry_inventory_item_id,
      p_product_name: item.row.product_name,
      p_product_type: item.row.product_type,
      p_quantity_available:
        draftQuantities[item.row.processed_poultry_inventory_item_id] != null
          ? Number(draftQuantities[item.row.processed_poultry_inventory_item_id])
          : item.row.quantity_available,
      p_seller_notes: item.row.seller_notes || null,
    });
  }

  return supabase.rpc("seller_update_equipment_inventory_item", {
    p_category: item.row.category,
    p_condition: item.row.condition || null,
    p_description: item.row.description || null,
    p_equipment_inventory_item_id: item.row.equipment_inventory_item_id,
    p_item_name: item.row.item_name,
    p_price: nextPrice,
    p_quantity_available:
      draftQuantities[item.row.equipment_inventory_item_id] != null
        ? Number(draftQuantities[item.row.equipment_inventory_item_id])
        : item.row.quantity_available,
    p_seller_notes: item.row.seller_notes || null,
  });
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

function validateChangedPrices(
  changedItems: FlatInventoryItem[],
  draftPrices: Record<string, string>,
) {
  for (const item of changedItems) {
    const draftValue = draftPrices[getPriceEditItemId(item)];

    if (draftValue == null) continue;

    const normalizedValue = normalizePriceInput(draftValue);

    if (normalizedValue == null) {
      return "Price must be a zero or positive dollar amount with up to two decimal places.";
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
