import { publicSupabase } from "@/lib/public-supabase";
import type { StorefrontCropMetadata } from "./storefront-ui";
import type { StorefrontFontPairId } from "./storefront-fonts";

export type StorefrontHeroCropMetadata = StorefrontCropMetadata;

export type StorefrontCustomPolicy = {
  title: string;
  body: string;
};

export type StorefrontHome = {
  store_id: string;
  store_slug: string;
  store_name: string;
  store_tagline: string | null;
  hero_subheading: string | null;
  storefront_font_pair: StorefrontFontPairId | string | null;
  storefront_heading_color: string | null;
  storefront_text_color: string | null;
  storefront_top_menu_color: string | null;
  public_city: string | null;
  public_state: string | null;
  public_country: string | null;
  about_text: string | null;
  pickup_policy: string | null;
  cancellation_policy: string | null;
  other_policies?: string | null;
  custom_policies?: StorefrontCustomPolicy[] | null;
  pickup_instructions: string | null;
  pickup_method: "notes" | "manual_options" | string | null;
  public_email: string | null;
  public_phone: string | null;
  website_url: string | null;
  social_url: string | null;
  npip_number: string | null;
  hero_image_url: string | null;
  hero_image_alt_text: string | null;
  hero_crop_metadata: StorefrontHeroCropMetadata | null;
  hero_image_layout: "full" | "right" | string | null;
  logo_image_url: string | null;
  logo_image_alt_text: string | null;
  public_inventory_item_count: number;
  ready_now_item_count: number;
  reserve_now_item_count: number;
  sold_out_item_count: number;
  total_quantity_available: number;
  next_available_date: string | null;
  has_public_inventory: boolean;
};

export type StorefrontPickupOption = {
  store_id: string;
  store_slug: string;
  pickup_option_id: string;
  label: string;
  description: string | null;
  sort_order: number;
};

export type StorefrontDeliveryOption = {
  delivery_option_id: string;
  name: string;
  price_amount: number;
  sort_order: number;
};

type StorefrontDeliveryOptionRow = {
  delivery_option_id: string | number | null;
  name: string | null;
  price_amount: number | string | null;
  sort_order: number | string | null;
};

export type StorefrontInventoryItem = {
  store_id: string;
  store_slug: string;
  species_id: string;
  species_name: string;
  species_slug: string;
  seller_breed_profile_id: string;
  breed_display_name: string;
  breed_description: string | null;
  listing_batch_id: string;
  listing_batch_breed_id: string;
  inventory_item_id: string;
  inventory_type: string;
  custom_inventory_label: string | null;
  quantity_available: number;
  buyer_availability_code: "ready_now" | "reserve_now" | "sold_out" | string;
  buyer_availability_label: string;
  available_date: string;
  origin_date: string | null;
  is_available_now: boolean;
  can_checkout: boolean;
  unit_price: number;
  featured_image_url: string | null;
  featured_image_alt_text: string | null;
  breed_bird_type: string | null;
  breed_egg_color: string | null;
  breed_annual_egg_production: string | null;
  breed_sort_order: number | null;
  inventory_sort_order: number | null;
  batch_type: string | null;
  age_at_availability_days: number | null;
};

export type StorefrontMedia = {
  store_slug: string;
  store_id: string;
  entity_type: string;
  entity_id: string;
  display_context: string;
  public_url: string;
  alt_text: string | null;
  caption: string | null;
  sort_order: number;
  is_featured: boolean;
  crop_metadata?: StorefrontHeroCropMetadata | null;
  width_px: number | null;
  height_px: number | null;
};

export type StorefrontEquipmentItem = {
  store_id: string;
  store_slug: string;
  equipment_inventory_item_id: string;
  item_type: "equipment_inventory";
  item_name: string;
  category: string;
  condition: string | null;
  description: string | null;
  quantity_available: number;
  buyer_availability_code: "ready_now" | "sold_out" | string;
  buyer_availability_label: string;
  can_checkout: boolean;
  unit_price: number;
  featured_image_url: string | null;
  featured_image_alt_text: string | null;
  updated_at: string;
};

export type StorefrontProcessedPoultryItem = {
  store_id: string;
  store_slug: string;
  processed_poultry_inventory_item_id: string;
  item_type: "processed_poultry_inventory";
  product_name: string;
  poultry_type: string;
  product_type: string;
  package_size: string | null;
  description: string | null;
  quantity_available: number;
  buyer_availability_code: "ready_now" | "sold_out" | string;
  buyer_availability_label: string;
  can_checkout: boolean;
  unit_price: number;
  featured_image_url: string | null;
  featured_image_alt_text: string | null;
  updated_at: string;
};

export type StorefrontPurchaseOption = {
  inventoryItemId: string;
  inventoryType: string;
  label: string;
  ageLabel: string;
  ageFilterDays: number | null;
  typeLabel: string;
  quantityAvailable: number;
  buyerAvailabilityCode: string;
  buyerAvailabilityLabel: string;
  availableDate: string;
  originDate: string | null;
  canCheckout: boolean;
  unitPrice: number;
  fulfillmentNote: string | null;
};

export type StorefrontProduct = {
  productId: string;
  storeSlug: string;
  speciesName: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  purpose: string | null;
  eggColor: string | null;
  annualEggProduction: string | null;
  totalQuantityAvailable: number;
  optionsCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  nextAvailableDate: string | null;
  availabilityCode: "ready_now" | "reserve_now" | "sold_out" | "mixed";
  availabilityLabel: string;
  pricingLabel: string | null;
  quantityLabel: string;
  options: StorefrontPurchaseOption[];
};

export type StorefrontProfileImage = {
  imageAlt: string | null;
  imageUrl: string;
};

export type StorefrontProfileImageMap = Record<string, StorefrontProfileImage>;

export async function loadStorefrontHome(slug: string) {
  const { data, error } = await publicSupabase
    .rpc("get_public_storefront_home", {
      p_store_slug: slug,
    })
    .maybeSingle();

  return {
    data: data as StorefrontHome | null,
    error,
  };
}

export async function loadStorefrontInventory(slug: string) {
  const { data, error } = await publicSupabase
    .from("public_storefront_inventory")
    .select("*")
    .eq("store_slug", slug)
    .order("breed_sort_order", { ascending: true })
    .order("inventory_sort_order", { ascending: true })
    .order("available_date", { ascending: true });

  return {
    data: (data ?? []) as StorefrontInventoryItem[],
    error,
  };
}

export async function loadStorefrontEquipment(slug: string) {
  const { data, error } = await publicSupabase
    .from("public_storefront_equipment_inventory")
    .select("*")
    .eq("store_slug", slug)
    .order("category", { ascending: true })
    .order("item_name", { ascending: true });

  return {
    data: (data ?? []) as StorefrontEquipmentItem[],
    error,
  };
}

export async function loadStorefrontEquipmentItem(
  slug: string,
  equipmentItemId: string,
) {
  const { data, error } = await publicSupabase
    .from("public_storefront_equipment_inventory")
    .select("*")
    .eq("store_slug", slug)
    .eq("equipment_inventory_item_id", equipmentItemId)
    .maybeSingle();

  return {
    data: data as StorefrontEquipmentItem | null,
    error,
  };
}

export async function loadStorefrontProcessedPoultry(slug: string) {
  const { data, error } = await publicSupabase
    .from("public_storefront_processed_poultry_inventory")
    .select("*")
    .eq("store_slug", slug)
    .order("poultry_type", { ascending: true })
    .order("product_type", { ascending: true })
    .order("product_name", { ascending: true });

  return {
    data: (data ?? []) as StorefrontProcessedPoultryItem[],
    error,
  };
}

export async function loadStorefrontProcessedPoultryItem(
  slug: string,
  processedPoultryItemId: string,
) {
  const { data, error } = await publicSupabase
    .from("public_storefront_processed_poultry_inventory")
    .select("*")
    .eq("store_slug", slug)
    .eq("processed_poultry_inventory_item_id", processedPoultryItemId)
    .maybeSingle();

  return {
    data: data as StorefrontProcessedPoultryItem | null,
    error,
  };
}

export async function loadStorefrontPickupOptions(slug: string) {
  const { data, error } = await publicSupabase
    .from("public_storefront_pickup_options")
    .select("*")
    .eq("store_slug", slug)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  return {
    data: (data ?? []) as StorefrontPickupOption[],
    error,
  };
}

export async function loadStorefrontDeliveryOptions(slug: string) {
  const { data, error } = await publicSupabase.rpc(
    "get_public_storefront_delivery_options",
    {
      p_store_slug: slug,
    },
  );

  return {
    data: ((data ?? []) as StorefrontDeliveryOptionRow[]).map((option) => ({
      delivery_option_id: String(option.delivery_option_id),
      name: String(option.name ?? ""),
      price_amount: toSafeNumber(option.price_amount),
      sort_order: toSafeNumber(option.sort_order),
    })) as StorefrontDeliveryOption[],
    error,
  };
}

export async function loadStorefrontProcessedPoultryGallery(
  slug: string,
  processedPoultryItemId: string,
  limit = 8,
) {
  const { data, error } = await publicSupabase
    .from("public_storefront_processed_poultry_media_gallery")
    .select("*")
    .eq("store_slug", slug)
    .eq("entity_type", "processed_poultry_inventory_item")
    .eq("entity_id", processedPoultryItemId)
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(limit);

  return {
    data: (data ?? []) as StorefrontMedia[],
    error,
  };
}

export async function loadStoreGallery(
  slug: string,
  options: {
    entityId?: string;
    entityType?: string;
    limit?: number;
  } = {},
) {
  let query = publicSupabase
    .from("public_storefront_media_gallery")
    .select("*")
    .eq("store_slug", slug)
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true });

  if (options.entityType) {
    query = query.eq("entity_type", options.entityType);
  }

  if (options.entityId) {
    query = query.eq("entity_id", options.entityId);
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  return {
    data: (data ?? []) as StorefrontMedia[],
    error,
  };
}

export async function loadStorefrontProfileImages(
  slug: string,
  profileIds: string[],
) {
  const uniqueProfileIds = Array.from(new Set(profileIds.filter(Boolean)));

  if (uniqueProfileIds.length === 0) {
    return {
      data: {} as StorefrontProfileImageMap,
      error: null,
    };
  }

  const { data, error } = await publicSupabase
    .from("public_storefront_media_gallery")
    .select("*")
    .eq("store_slug", slug)
    .eq("entity_type", "seller_breed_profile")
    .in("entity_id", uniqueProfileIds)
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true });

  const images: StorefrontProfileImageMap = {};

  for (const image of (data ?? []) as StorefrontMedia[]) {
    if (images[image.entity_id]) continue;

    images[image.entity_id] = {
      imageAlt: image.alt_text,
      imageUrl: image.public_url,
    };
  }

  return {
    data: images,
    error,
  };
}

export function groupInventoryByProduct(
  items: StorefrontInventoryItem[],
  profileImages: StorefrontProfileImageMap = {},
) {
  const groups = new Map<string, StorefrontInventoryItem[]>();

  for (const item of items) {
    const current = groups.get(item.seller_breed_profile_id) ?? [];
    current.push(item);
    groups.set(item.seller_breed_profile_id, current);
  }

  return Array.from(groups.values()).map((group) =>
    toStorefrontProduct(group, profileImages),
  );
}

export function toStorefrontProduct(
  items: StorefrontInventoryItem[],
  profileImages: StorefrontProfileImageMap = {},
) {
  const sorted = [...items].sort(compareOptions);
  const first = sorted[0];
  const profileImage = profileImages[first.seller_breed_profile_id];
  const availableOptions = sorted.filter((item) => item.quantity_available > 0);
  const priceableOptions = availableOptions.length > 0 ? availableOptions : sorted;
  const prices = priceableOptions
    .map((item) => Number(item.unit_price))
    .filter((value) => Number.isFinite(value));
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
  const totalQuantityAvailable = sorted.reduce(
    (total, item) => total + Math.max(0, item.quantity_available),
    0,
  );
  const availabilityCode = summarizeAvailability(sorted);

  return {
    productId: first.seller_breed_profile_id,
    storeSlug: first.store_slug,
    speciesName: first.species_name,
    name: first.breed_display_name,
    description: first.breed_description,
    imageUrl: profileImage?.imageUrl ?? first.featured_image_url,
    imageAlt: profileImage?.imageAlt ?? first.featured_image_alt_text,
    purpose: formatBirdPurpose(first.breed_bird_type),
    eggColor: formatEggColor(first.breed_egg_color),
    annualEggProduction: formatAnnualEggProduction(
      first.breed_annual_egg_production,
    ),
    totalQuantityAvailable,
    optionsCount: sorted.length,
    minPrice,
    maxPrice,
    nextAvailableDate: getNextAvailableDate(sorted),
    availabilityCode,
    availabilityLabel: formatAvailabilitySummary(availabilityCode),
    pricingLabel: formatPricingSummary(minPrice, maxPrice),
    quantityLabel: formatProductQuantity(totalQuantityAvailable),
    options: sorted.map(toPurchaseOption),
  } satisfies StorefrontProduct;
}

export function toPurchaseOption(
  item: StorefrontInventoryItem,
): StorefrontPurchaseOption {
  const ageLabel = formatAgeLabel(item);
  const typeLabel = formatInventoryTypeLabel(item);

  return {
    inventoryItemId: item.inventory_item_id,
    inventoryType: item.inventory_type,
    label: [ageLabel, typeLabel].filter(Boolean).join(" - ") || typeLabel,
    ageLabel,
    ageFilterDays: getPurchaseOptionAgeFilterDays(item),
    typeLabel,
    quantityAvailable: item.quantity_available,
    buyerAvailabilityCode: item.buyer_availability_code,
    buyerAvailabilityLabel: item.buyer_availability_label,
    availableDate: item.available_date,
    originDate: item.origin_date,
    canCheckout: item.can_checkout,
    unitPrice: item.unit_price,
    fulfillmentNote: null,
  };
}

function getPurchaseOptionAgeFilterDays(item: StorefrontInventoryItem) {
  if (item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs") {
    return null;
  }

  if (item.buyer_availability_code === "ready_now") {
    return getCurrentBirdAgeDays(item);
  }

  if (
    item.age_at_availability_days !== null &&
    Number.isFinite(item.age_at_availability_days)
  ) {
    return Math.max(0, Math.floor(item.age_at_availability_days));
  }

  return null;
}

export function findProduct(
  products: StorefrontProduct[],
  productId: string,
) {
  return products.find((product) => product.productId === productId) ?? null;
}

export function previewText(value: string | null, fallback: string) {
  const trimmed = value?.trim();

  if (!trimmed) return fallback;

  if (trimmed.length <= 180) return trimmed;

  return `${trimmed.slice(0, 177).trimEnd()}...`;
}

export function formatInventoryTypeLabel(item: {
  custom_inventory_label: string | null;
  inventory_type: string;
}) {
  if (item.custom_inventory_label) return item.custom_inventory_label;

  const labels: Record<string, string> = {
    female: "Female",
    male: "Male",
    straight_run: "Straight run",
    unsexed: "Unsexed",
    pair: "Pair",
    trio: "Trio",
    hatching_eggs: "Hatching eggs",
    other: "Other",
  };

  return labels[item.inventory_type] ?? item.inventory_type.replaceAll("_", " ");
}

export function formatAgeLabel(item: {
  age_at_availability_days: number | null;
  available_date?: string | null;
  batch_type: string | null;
  inventory_type: string;
  origin_date?: string | null;
}) {
  if (item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs") {
    return "Hatching eggs";
  }

  return formatCurrentBirdAgeLabel(item);
}

export function formatBirdAgeLabel(days: number | null | undefined) {
  if (days === null || days === undefined || !Number.isFinite(days)) {
    return "Age not listed";
  }

  const wholeDays = Math.floor(days);

  if (wholeDays < 0) return "Age not listed";
  if (wholeDays === 0) return "Hatch day";

  if (wholeDays < 7) {
    return wholeDays === 1 ? "1 day old" : `${wholeDays} days old`;
  }

  const weeks = Math.floor(wholeDays / 7);

  return weeks === 1 ? "1 week old" : `${weeks} weeks old`;
}

function formatCurrentBirdAgeLabel(item: {
  age_at_availability_days: number | null;
  available_date?: string | null;
  origin_date?: string | null;
}) {
  const currentAgeDays = getCurrentBirdAgeDays(item);

  if (currentAgeDays === null) return "Age not listed";

  if (currentAgeDays < 7) {
    return currentAgeDays === 1 ? "1 day old" : `${currentAgeDays} days old`;
  }

  const weeks = Math.max(0, Math.floor(currentAgeDays / 7));

  return weeks === 1 ? "1 week old" : `${weeks} weeks old`;
}

function getCurrentBirdAgeDays(item: {
  age_at_availability_days: number | null;
  available_date?: string | null;
  origin_date?: string | null;
}) {
  const today = parseDateOnly(new Date().toISOString().slice(0, 10));

  if (!today) return null;

  if (item.origin_date) {
    const origin = parseDateOnly(item.origin_date);

    if (origin) {
      return Math.max(
        0,
        Math.floor((today.getTime() - origin.getTime()) / 86_400_000),
      );
    }
  }

  if (
    item.available_date &&
    item.age_at_availability_days !== null &&
    Number.isFinite(item.age_at_availability_days)
  ) {
    const available = parseDateOnly(item.available_date);

    if (available) {
      const daysUntilReady = Math.ceil(
        (available.getTime() - today.getTime()) / 86_400_000,
      );

      return Math.max(0, item.age_at_availability_days - daysUntilReady);
    }
  }

  return null;
}

function parseDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00`);

  return Number.isNaN(date.getTime()) ? null : date;
}

function toSafeNumber(value: number | string | null | undefined) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;

  return Number.isFinite(numericValue) ? numericValue : 0;
}

function compareOptions(
  first: StorefrontInventoryItem,
  second: StorefrontInventoryItem,
) {
  return (
    availabilityRank(first.buyer_availability_code) -
      availabilityRank(second.buyer_availability_code) ||
    (first.age_at_availability_days ?? 99999) -
      (second.age_at_availability_days ?? 99999) ||
    first.available_date.localeCompare(second.available_date) ||
    (first.inventory_sort_order ?? 0) - (second.inventory_sort_order ?? 0)
  );
}

function availabilityRank(code: string) {
  if (code === "ready_now") return 0;
  if (code === "reserve_now") return 1;
  return 2;
}

function summarizeAvailability(items: StorefrontInventoryItem[]) {
  const liveItems = items.filter((item) => item.quantity_available > 0);
  const source = liveItems.length > 0 ? liveItems : items;
  const codes = new Set(source.map((item) => item.buyer_availability_code));

  if (codes.size > 1) return "mixed";
  if (codes.has("ready_now")) return "ready_now";
  if (codes.has("reserve_now")) return "reserve_now";
  return "sold_out";
}

function formatAvailabilitySummary(
  code: StorefrontProduct["availabilityCode"],
) {
  if (code === "ready_now") return "Available now";
  if (code === "reserve_now") return "Available later";
  if (code === "mixed") return "Multiple availabilities";
  return "Sold out";
}

function getNextAvailableDate(items: StorefrontInventoryItem[]) {
  const availableDates = items
    .filter((item) => item.quantity_available > 0)
    .map((item) => item.available_date)
    .sort();

  return availableDates[0] ?? null;
}

function formatPricingSummary(
  minPrice: number | null,
  maxPrice: number | null,
) {
  if (minPrice === null || maxPrice === null) return null;

  if (minPrice !== maxPrice) {
    return `From ${formatCurrency(minPrice)}`;
  }

  return formatCurrency(minPrice);
}

function formatProductQuantity(quantity: number) {
  if (quantity <= 0) return "Sold out";
  if (quantity === 1) return "1 available";
  return `${quantity} available`;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatBirdPurpose(value: string | null) {
  const labels: Record<string, string> = {
    dual_purpose: "Dual-purpose",
    layer: "Layer",
    meat: "Meat",
  };

  return value ? labels[value] ?? toTitleText(value) : null;
}

function formatEggColor(value: string | null) {
  const labels: Record<string, string> = {
    blue: "Blue",
    blue_green: "Blue-green",
    brown: "Brown",
    dark_brown: "Dark brown",
    green: "Green",
    light_brown: "Light brown",
    olive: "Olive",
    white: "White",
  };

  return value ? labels[value] ?? toTitleText(value) : null;
}

function formatAnnualEggProduction(value: string | null) {
  const labels: Record<string, string> = {
    "150_200": "150-200 per year",
    "200_250": "200-250 per year",
    "250_300": "250-300 per year",
    over_300: "More than 300 per year",
    under_150: "Less than 150 per year",
  };

  return value ? labels[value] ?? toTitleText(value) : null;
}

function toTitleText(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
