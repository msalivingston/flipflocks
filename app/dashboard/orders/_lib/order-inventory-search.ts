"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  normalizeSellableInventoryRows,
} from "./order-form-inventory";
import type {
  BrowseInventoryFilter,
  EquipmentInventoryRow,
  HatchingEggInventoryRow,
  InventoryItemType,
  InventorySearchRow,
  ListingInventoryRow,
  OrderLine,
  ProcessedPoultryInventoryRow,
} from "./order-form-types";

export const ORDER_INVENTORY_SEARCH_DEBOUNCE_MS = 250;
export const ORDER_INVENTORY_QUICK_RESULT_LIMIT = 12;
export const ORDER_INVENTORY_BROWSE_RESULT_LIMIT = 20;

const listingInventorySelect =
  "inventory_item_id, listing_batch_id, breed_display_name, batch_type, inventory_type, custom_inventory_label, breeding_history, feather_condition, origin_date, available_date, quantity_available, effective_unit_price, inventory_visibility_status, inventory_moderation_status, listing_batch_visibility_status, listing_batch_moderation_status, operational_availability_status";
const equipmentInventorySelect =
  "equipment_inventory_item_id, item_name, category, condition, quantity_available, price, visibility_status, moderation_status, operational_availability_status";
const hatchingEggInventorySelect =
  "hatching_egg_inventory_item_id, item_name, species_name, description, quantity_available, price, available_date, minimum_order_quantity, visibility_status, moderation_status, operational_availability_status";
const processedPoultryInventorySelect =
  "processed_poultry_inventory_item_id, product_name, poultry_type, product_type, package_size, quantity_available, price, visibility_status, moderation_status, operational_availability_status";

export type InventoryReference = {
  id: string;
  itemType: InventoryItemType;
};

type UseOrderInventorySearchInput = {
  enabled: boolean;
  filter: BrowseInventoryFilter;
  limit: number;
  query: string;
  storeId: string | undefined;
};

export function useOrderInventorySearch({
  enabled,
  filter,
  limit,
  query,
  storeId,
}: UseOrderInventorySearchInput) {
  const requestKey = `${storeId ?? ""}:${filter}:${limit}:${query}`;
  const [state, setState] = useState<{
    error: string | null;
    requestKey: string;
    results: InventorySearchRow[];
  }>({ error: null, requestKey: "", results: [] });

  useEffect(() => {
    if (!enabled || !storeId) return;

    let isMounted = true;

    const timeoutId = window.setTimeout(() => {
      void searchOrderInventory({ filter, limit, query, storeId }).then(
        (nextResults) => {
          if (!isMounted) return;
          setState({ error: null, requestKey, results: nextResults });
        },
        (searchError: unknown) => {
          if (!isMounted) return;
          setState({
            error:
              searchError instanceof Error
                ? searchError.message
                : "Inventory search could not load.",
            requestKey,
            results: [],
          });
        },
      );
    }, ORDER_INVENTORY_SEARCH_DEBOUNCE_MS);

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
    };
  }, [enabled, filter, limit, query, requestKey, storeId]);

  if (!enabled || !storeId) {
    return { error: null, isLoading: false, results: [] };
  }

  return state.requestKey === requestKey
    ? { error: state.error, isLoading: false, results: state.results }
    : { error: null, isLoading: true, results: [] };
}

export async function searchOrderInventory({
  filter,
  limit,
  query,
  storeId,
}: {
  filter: BrowseInventoryFilter;
  limit: number;
  query: string;
  storeId: string;
}) {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const normalizedQuery = query.trim();
  const categorySearchFilter =
    filter === "all" ? getInventoryCategorySearchFilter(normalizedQuery) : null;
  const effectiveFilter = categorySearchFilter ?? filter;
  const effectiveQuery = categorySearchFilter ? "" : normalizedQuery;
  const includeListing =
    effectiveFilter === "all" ||
    effectiveFilter === "poultry" ||
    effectiveFilter === "hatching_eggs";

  const [listingRows, hatchingEggRows, processedPoultryRows, equipmentRows] =
    await Promise.all([
      includeListing
        ? searchListingInventory({
            filter: effectiveFilter,
            limit: boundedLimit,
            query: effectiveQuery,
            storeId,
          })
        : Promise.resolve([]),
      effectiveFilter === "all" || effectiveFilter === "hatching_eggs"
        ? searchHatchingEggInventory({
            limit: boundedLimit,
            query: effectiveQuery,
            storeId,
          })
        : Promise.resolve([]),
      effectiveFilter === "all" || effectiveFilter === "processed_poultry"
        ? searchProcessedPoultryInventory({
            limit: boundedLimit,
            query: effectiveQuery,
            storeId,
          })
        : Promise.resolve([]),
      effectiveFilter === "all" || effectiveFilter === "equipment"
        ? searchEquipmentInventory({
            limit: boundedLimit,
            query: effectiveQuery,
            storeId,
          })
        : Promise.resolve([]),
    ]);

  return normalizeSellableInventoryRows({
    equipmentRows,
    hatchingEggRows,
    listingRows,
    processedPoultryRows,
  }).slice(0, boundedLimit);
}

export async function loadOrderInventoryForLines(
  storeId: string,
  lines: OrderLine[],
) {
  return loadOrderInventoryByReferences(
    storeId,
    lines.flatMap((line) =>
      line.type === "inventory" && line.inventoryItemId && line.inventoryItemType
        ? [{ id: line.inventoryItemId, itemType: line.inventoryItemType }]
        : [],
    ),
    { includeHistorical: true },
  );
}

export async function loadOrderInventoryByReferences(
  storeId: string,
  references: InventoryReference[],
  options: { includeHistorical?: boolean } = {},
) {
  const idsByType = groupInventoryReferenceIds(references);
  const includeHistorical = options.includeHistorical ?? false;

  const [listingRows, hatchingEggRows, processedPoultryRows, equipmentRows] =
    await Promise.all([
      loadListingInventoryByIds(
        storeId,
        idsByType.listing_inventory,
        includeHistorical,
      ),
      loadHatchingEggInventoryByIds(
        storeId,
        idsByType.hatching_egg_inventory,
        includeHistorical,
      ),
      loadProcessedPoultryInventoryByIds(
        storeId,
        idsByType.processed_poultry_inventory,
        includeHistorical,
      ),
      loadEquipmentInventoryByIds(
        storeId,
        idsByType.equipment_inventory,
        includeHistorical,
      ),
    ]);

  return normalizeSellableInventoryRows({
    equipmentRows,
    hatchingEggRows,
    listingRows,
    processedPoultryRows,
  });
}

export function mergeOrderInventoryRows(
  current: InventorySearchRow[],
  incoming: InventorySearchRow[],
) {
  const rows = new Map(
    current.map((item) => [`${item.itemType}:${item.id}`, item]),
  );

  for (const item of incoming) {
    rows.set(`${item.itemType}:${item.id}`, item);
  }

  return Array.from(rows.values());
}

function groupInventoryReferenceIds(references: InventoryReference[]) {
  const grouped: Record<InventoryItemType, Set<string>> = {
    equipment_inventory: new Set(),
    hatching_egg_inventory: new Set(),
    listing_inventory: new Set(),
    processed_poultry_inventory: new Set(),
  };

  for (const reference of references) {
    grouped[reference.itemType].add(reference.id);
  }

  return {
    equipment_inventory: Array.from(grouped.equipment_inventory),
    hatching_egg_inventory: Array.from(grouped.hatching_egg_inventory),
    listing_inventory: Array.from(grouped.listing_inventory),
    processed_poultry_inventory: Array.from(
      grouped.processed_poultry_inventory,
    ),
  };
}

async function searchListingInventory({
  filter,
  limit,
  query: search,
  storeId,
}: {
  filter: BrowseInventoryFilter;
  limit: number;
  query: string;
  storeId: string;
}) {
  let query = supabase
    .from("seller_inventory_management")
    .select(listingInventorySelect)
    .eq("store_id", storeId)
    .neq("inventory_visibility_status", "archived")
    .neq("listing_batch_visibility_status", "archived")
    .eq("inventory_moderation_status", "normal")
    .eq("listing_batch_moderation_status", "normal");

  if (filter === "poultry") {
    query = query
      .neq("batch_type", "hatching_eggs")
      .neq("inventory_type", "hatching_eggs");
  } else if (filter === "hatching_eggs") {
    query = query.or(
      "batch_type.eq.hatching_eggs,inventory_type.eq.hatching_eggs",
    );
  }

  const ageRange = getInventoryAgeSearchRange(search);

  if (ageRange) {
    query = query
      .gte("age_at_availability_days", ageRange.from)
      .lte("age_at_availability_days", ageRange.to);
  } else {
    const searchFilter = buildPostgrestSearchFilter(search, [
      "breed_display_name",
      "species_name",
      "inventory_type",
      "custom_inventory_label",
      "internal_batch_label",
      "operational_availability_status",
    ]);
    if (searchFilter) query = query.or(searchFilter);
  }

  const { data, error } = await query
    .order("breed_display_name", { ascending: true })
    .order("inventory_item_id", { ascending: true })
    .limit(limit)
    .returns<ListingInventoryRow[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function searchEquipmentInventory(input: SearchInput) {
  let query = currentEquipmentInventoryQuery(input.storeId);
  const searchFilter = buildPostgrestSearchFilter(input.query, [
    "item_name",
    "category",
    "condition",
    "description",
    "operational_availability_status",
  ]);
  if (searchFilter) query = query.or(searchFilter);

  const { data, error } = await query
    .order("item_name", { ascending: true })
    .order("equipment_inventory_item_id", { ascending: true })
    .limit(input.limit)
    .returns<EquipmentInventoryRow[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function searchHatchingEggInventory(input: SearchInput) {
  let query = currentHatchingEggInventoryQuery(input.storeId);
  const searchFilter = buildPostgrestSearchFilter(input.query, [
    "item_name",
    "species_name",
    "description",
    "operational_availability_status",
  ]);
  if (searchFilter) query = query.or(searchFilter);

  const { data, error } = await query
    .order("item_name", { ascending: true })
    .order("hatching_egg_inventory_item_id", { ascending: true })
    .limit(input.limit)
    .returns<HatchingEggInventoryRow[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function searchProcessedPoultryInventory(input: SearchInput) {
  let query = currentProcessedPoultryInventoryQuery(input.storeId);
  const searchFilter = buildPostgrestSearchFilter(input.query, [
    "product_name",
    "poultry_type",
    "product_type",
    "package_size",
    "description",
    "operational_availability_status",
  ]);
  if (searchFilter) query = query.or(searchFilter);

  const { data, error } = await query
    .order("product_name", { ascending: true })
    .order("processed_poultry_inventory_item_id", { ascending: true })
    .limit(input.limit)
    .returns<ProcessedPoultryInventoryRow[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

type SearchInput = { limit: number; query: string; storeId: string };

function currentEquipmentInventoryQuery(storeId: string) {
  return supabase
    .from("seller_equipment_inventory_management")
    .select(equipmentInventorySelect)
    .eq("store_id", storeId)
    .neq("visibility_status", "archived")
    .eq("moderation_status", "normal");
}

function currentHatchingEggInventoryQuery(storeId: string) {
  return supabase
    .from("seller_hatching_egg_inventory_management")
    .select(hatchingEggInventorySelect)
    .eq("store_id", storeId)
    .neq("visibility_status", "archived")
    .eq("moderation_status", "normal");
}

function currentProcessedPoultryInventoryQuery(storeId: string) {
  return supabase
    .from("seller_processed_poultry_inventory_management")
    .select(processedPoultryInventorySelect)
    .eq("store_id", storeId)
    .neq("visibility_status", "archived")
    .eq("moderation_status", "normal");
}

async function loadListingInventoryByIds(
  storeId: string,
  ids: string[],
  includeHistorical: boolean,
) {
  return loadInventoryIdChunks(ids, async (idChunk) => {
    let query = supabase
      .from("seller_inventory_management")
      .select(listingInventorySelect)
      .eq("store_id", storeId)
      .in("inventory_item_id", idChunk);

    if (!includeHistorical) {
      query = query
        .neq("inventory_visibility_status", "archived")
        .neq("listing_batch_visibility_status", "archived")
        .eq("inventory_moderation_status", "normal")
        .eq("listing_batch_moderation_status", "normal");
    }

    const { data, error } = await query.returns<ListingInventoryRow[]>();

    if (error) throw new Error(error.message);
    return data ?? [];
  });
}

async function loadEquipmentInventoryByIds(
  storeId: string,
  ids: string[],
  includeHistorical: boolean,
) {
  return loadInventoryIdChunks(ids, async (idChunk) => {
    let query = supabase
      .from("seller_equipment_inventory_management")
      .select(equipmentInventorySelect)
      .eq("store_id", storeId)
      .in("equipment_inventory_item_id", idChunk);

    if (!includeHistorical) {
      query = query
        .neq("visibility_status", "archived")
        .eq("moderation_status", "normal");
    }

    const { data, error } = await query.returns<EquipmentInventoryRow[]>();

    if (error) throw new Error(error.message);
    return data ?? [];
  });
}

async function loadHatchingEggInventoryByIds(
  storeId: string,
  ids: string[],
  includeHistorical: boolean,
) {
  return loadInventoryIdChunks(ids, async (idChunk) => {
    let query = supabase
      .from("seller_hatching_egg_inventory_management")
      .select(hatchingEggInventorySelect)
      .eq("store_id", storeId)
      .in("hatching_egg_inventory_item_id", idChunk);

    if (!includeHistorical) {
      query = query
        .neq("visibility_status", "archived")
        .eq("moderation_status", "normal");
    }

    const { data, error } = await query.returns<HatchingEggInventoryRow[]>();

    if (error) throw new Error(error.message);
    return data ?? [];
  });
}

async function loadProcessedPoultryInventoryByIds(
  storeId: string,
  ids: string[],
  includeHistorical: boolean,
) {
  return loadInventoryIdChunks(ids, async (idChunk) => {
    let query = supabase
      .from("seller_processed_poultry_inventory_management")
      .select(processedPoultryInventorySelect)
      .eq("store_id", storeId)
      .in("processed_poultry_inventory_item_id", idChunk);

    if (!includeHistorical) {
      query = query
        .neq("visibility_status", "archived")
        .eq("moderation_status", "normal");
    }

    const { data, error } = await query.returns<
      ProcessedPoultryInventoryRow[]
    >();

    if (error) throw new Error(error.message);
    return data ?? [];
  });
}

async function loadInventoryIdChunks<T>(
  ids: string[],
  loadChunk: (ids: string[]) => Promise<T[]>,
) {
  const chunks: string[][] = [];

  for (let index = 0; index < ids.length; index += 200) {
    chunks.push(ids.slice(index, index + 200));
  }

  return (await Promise.all(chunks.map(loadChunk))).flat();
}

export function getInventoryAgeSearchRange(search: string) {
  const normalized = search.trim().toLowerCase();
  if (normalized === "at hatch" || normalized === "hatch day") {
    return { from: 0, to: 0 };
  }

  const weekAndDayMatch = normalized.match(
    /^(\d+)\s+weeks?\s*\+\s*(\d+)\s+days?$/,
  );
  if (weekAndDayMatch) {
    const days = Number(weekAndDayMatch[1]) * 7 + Number(weekAndDayMatch[2]);
    return { from: days, to: days };
  }

  const weekMatch = normalized.match(/^(\d+)\s+weeks?$/);
  if (weekMatch) {
    const from = Number(weekMatch[1]) * 7;
    return { from, to: from + 6 };
  }

  const dayMatch = normalized.match(/^(\d+)\s+days?$/);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    return { from: days, to: days };
  }

  const monthMatch = normalized.match(/^(\d+)\s+months?$/);
  if (monthMatch) {
    const months = Number(monthMatch[1]);
    const firstWeek = Math.max(27, Math.ceil((months * 52) / 12));
    const nextMonthFirstWeek = Math.ceil(((months + 1) * 52) / 12);
    return { from: firstWeek * 7, to: nextMonthFirstWeek * 7 - 1 };
  }

  return null;
}

export function getInventoryCategorySearchFilter(
  search: string,
): BrowseInventoryFilter | null {
  const normalized = search.trim().toLowerCase().replace(/\s*&\s*/g, " ");

  if (["live bird", "live birds"].includes(normalized)) return "poultry";
  if (["hatching egg", "hatching eggs"].includes(normalized)) {
    return "hatching_eggs";
  }
  if (["poultry product", "poultry products"].includes(normalized)) {
    return "processed_poultry";
  }
  if (
    ["equipment", "equipment supplies", "equipment and supplies"].includes(
      normalized,
    )
  ) {
    return "equipment";
  }

  return null;
}

function buildPostgrestSearchFilter(search: string, fields: string[]) {
  const normalizedSearch = search.trim();
  if (!normalizedSearch) return null;

  const quotedPattern = `"*${normalizedSearch
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}*"`;

  return fields.map((field) => `${field}.ilike.${quotedPattern}`).join(",");
}
