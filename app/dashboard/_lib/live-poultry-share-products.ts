import { supabase } from "@/lib/supabase";
import { buildPublicListingPath } from "./public-listing-url";

export type LivePoultryShareProduct = {
  id: string;
  publicPath: ReturnType<typeof buildPublicListingPath>;
  shareText: string | null;
  summary: string | null;
  title: string;
};

type LivePoultryShareProductRow = {
  available_date: string | null;
  base_price: number | null;
  breed_display_name: string;
  custom_inventory_label: string | null;
  effective_unit_price?: number | null;
  inventory_item_sort_order: number | null;
  inventory_type: string;
  inventory_visibility_status: string;
  listing_batch_breed_id: string;
  listing_batch_breed_sort_order: number | null;
  listing_batch_breed_visibility_status: string;
  price_override: number | null;
  quantity_available: number | null;
};

type LoadLivePoultryShareProductsInput = {
  listingBatchId: string;
  storeId: string;
  storeName: string | null | undefined;
  storeSlug: string | null | undefined;
};

export async function loadLivePoultryShareProducts({
  listingBatchId,
  storeId,
  storeName,
  storeSlug,
}: LoadLivePoultryShareProductsInput): Promise<
  { ok: true; products: LivePoultryShareProduct[] } | { ok: false; message: string }
> {
  const { data, error } = await supabase
    .from("seller_inventory_management")
    .select(
      "listing_batch_breed_id, breed_display_name, available_date, base_price, effective_unit_price, price_override, inventory_type, custom_inventory_label, quantity_available, listing_batch_breed_sort_order, inventory_item_sort_order, listing_batch_breed_visibility_status, inventory_visibility_status",
    )
    .eq("store_id", storeId)
    .eq("listing_batch_id", listingBatchId)
    .eq("batch_type", "live_animals")
    .eq("listing_batch_visibility_status", "active")
    .order("listing_batch_breed_sort_order", { ascending: true })
    .order("inventory_item_sort_order", { ascending: true })
    .returns<LivePoultryShareProductRow[]>();

  if (error) {
    return { ok: false, message: error.message };
  }

  const groups = new Map<string, LivePoultryShareProductRow[]>();

  for (const row of data ?? []) {
    if (
      row.listing_batch_breed_visibility_status !== "active" ||
      row.inventory_visibility_status !== "active"
    ) {
      continue;
    }

    const current = groups.get(row.listing_batch_breed_id) ?? [];
    current.push(row);
    groups.set(row.listing_batch_breed_id, current);
  }

  return {
    ok: true,
    products: Array.from(groups.entries()).map(([productId, rows]) =>
      toLivePoultryShareProduct({
        productId,
        rows,
        storeName,
        storeSlug,
      }),
    ),
  };
}

export function buildFallbackLivePoultryShareProduct(
  listingBatchId: string,
): LivePoultryShareProduct {
  return {
    id: listingBatchId,
    publicPath: null,
    shareText: null,
    summary: null,
    title: "Live poultry listing",
  };
}

function toLivePoultryShareProduct({
  productId,
  rows,
  storeName,
  storeSlug,
}: {
  productId: string;
  rows: LivePoultryShareProductRow[];
  storeName: string | null | undefined;
  storeSlug: string | null | undefined;
}): LivePoultryShareProduct {
  const first = rows[0];
  const title = buildLivePoultryTitle(rows);
  const totalQuantityAvailable = rows.reduce(
    (total, row) => total + Math.max(0, row.quantity_available ?? 0),
    0,
  );
  const availability = formatAvailability({
    availableDate: first?.available_date,
    totalQuantityAvailable,
  });
  const price = formatProductPrice(rows);
  const summary = [availability, price].filter(Boolean).join(" | ") || null;
  const shareText = buildSentenceShareText([
    [title, storeName?.trim() ? `from ${storeName.trim()}` : null]
      .filter(Boolean)
      .join(" "),
    availability,
    price,
  ]);

  return {
    id: productId,
    publicPath: buildPublicListingPath({
      listingType: "live_poultry",
      productId,
      storeSlug,
    }),
    shareText,
    summary,
    title,
  };
}

function buildLivePoultryTitle(rows: LivePoultryShareProductRow[]) {
  const first = rows[0];

  if (!first) return "Live poultry";

  const breedName = stripTrailingSentencePunctuation(
    first.breed_display_name,
  );

  if (rows.length !== 1) return breedName;

  const optionLabel = formatInventoryTypeLabel(
    first.inventory_type,
    first.custom_inventory_label,
  );

  if (!optionLabel) return breedName;

  return `${breedName} ${optionLabel.toLowerCase()}`;
}

function formatInventoryTypeLabel(
  inventoryType: string,
  customLabel: string | null,
) {
  if (inventoryType === "other") return customLabel?.trim() ?? "";

  const labels: Record<string, string> = {
    female: "Female",
    male: "Male",
    pair: "Pair",
    straight_run: "Straight run",
    trio: "Trio",
    unsexed: "Unsexed",
  };

  return labels[inventoryType] ?? inventoryType.replaceAll("_", " ");
}

function formatAvailability({
  availableDate: value,
  totalQuantityAvailable,
}: {
  availableDate: string | null | undefined;
  totalQuantityAvailable: number;
}) {
  if (totalQuantityAvailable <= 0) return "Sold out";
  if (!value) return null;

  const availableDate = parseDate(value);
  if (!availableDate) return null;

  const today = new Date();
  const localToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  if (availableDate <= localToday) return "Available now";

  return `Ready ${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(availableDate)}`;
}

function formatProductPrice(rows: LivePoultryShareProductRow[]) {
  const availableRows = rows.filter((row) => (row.quantity_available ?? 0) > 0);
  const priceableRows = availableRows.length > 0 ? availableRows : rows;
  const prices = priceableRows
    .map((row) => row.effective_unit_price ?? row.price_override ?? row.base_price)
    .filter((value): value is number => typeof value === "number" && value >= 0);

  if (prices.length === 0) return null;

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  if (minPrice === maxPrice) return `${formatCurrency(minPrice)} each`;

  return `${formatCurrency(minPrice)}-${formatCurrency(maxPrice)} each`;
}

function buildSentenceShareText(parts: Array<string | null | undefined>) {
  const sentences = parts
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => `${stripTrailingSentencePunctuation(value)}.`);

  return sentences.length > 0 ? sentences.join(" ") : null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function parseDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stripTrailingSentencePunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/g, "");
}
