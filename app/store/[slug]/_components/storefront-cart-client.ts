"use client";

export type StorefrontCartItem = {
  inventoryItemId: string;
  productId: string;
  productName: string;
  speciesName: string;
  optionLabel: string;
  ageLabel: string | null;
  typeLabel: string;
  availableDate: string;
  quantityAvailable: number;
  unitPrice: number;
  imageUrl: string | null;
  quantity: number;
};

export type StorefrontCart = {
  storeSlug: string;
  updatedAt: string;
  items: StorefrontCartItem[];
};

export function cartStorageKey(storeSlug: string) {
  return `flipflocks:storefront-cart:${storeSlug}`;
}

export function readStorefrontCart(storeSlug: string): StorefrontCart {
  if (typeof window === "undefined") {
    return emptyCart(storeSlug);
  }

  const raw = window.localStorage.getItem(cartStorageKey(storeSlug));

  if (!raw) return emptyCart(storeSlug);

  try {
    const parsed = JSON.parse(raw) as Partial<StorefrontCart>;
    const items = Array.isArray(parsed.items)
      ? parsed.items.map(normalizeCartItem).filter(isCartItem)
      : [];

    return {
      storeSlug,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
      items,
    };
  } catch {
    return emptyCart(storeSlug);
  }
}

export function writeStorefrontCart(
  storeSlug: string,
  items: StorefrontCartItem[],
) {
  const cart = {
    storeSlug,
    updatedAt: new Date().toISOString(),
    items: items
      .map(normalizeCartItem)
      .filter(isCartItem)
      .filter((item) => item.quantity > 0),
  } satisfies StorefrontCart;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(cartStorageKey(storeSlug), JSON.stringify(cart));
  }

  return cart;
}

export function clearStorefrontCart(storeSlug: string) {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(cartStorageKey(storeSlug));
  }
}

export function addItemsToStorefrontCart(
  storeSlug: string,
  incomingItems: StorefrontCartItem[],
) {
  const cart = readStorefrontCart(storeSlug);
  const byItemId = new Map<string, StorefrontCartItem>();

  for (const item of cart.items) {
    byItemId.set(item.inventoryItemId, item);
  }

  for (const item of incomingItems) {
    const normalized = normalizeCartItem(item);

    if (!normalized) continue;

    const existing = byItemId.get(normalized.inventoryItemId);
    const nextQuantity = normalizeQuantity(
      (existing?.quantity ?? 0) + normalized.quantity,
      normalized.quantityAvailable,
    );

    byItemId.set(normalized.inventoryItemId, {
      ...normalized,
      quantity: nextQuantity,
    });
  }

  return writeStorefrontCart(storeSlug, Array.from(byItemId.values()));
}

export function updateStorefrontCartItemQuantity(
  storeSlug: string,
  inventoryItemId: string,
  quantity: number,
) {
  const cart = readStorefrontCart(storeSlug);
  const items = cart.items
    .map((item) =>
      item.inventoryItemId === inventoryItemId
        ? {
            ...item,
            quantity: normalizeQuantity(quantity, item.quantityAvailable),
          }
        : item,
    )
    .filter((item) => item.quantity > 0);

  return writeStorefrontCart(storeSlug, items);
}

export function removeStorefrontCartItem(
  storeSlug: string,
  inventoryItemId: string,
) {
  const cart = readStorefrontCart(storeSlug);

  return writeStorefrontCart(
    storeSlug,
    cart.items.filter((item) => item.inventoryItemId !== inventoryItemId),
  );
}

export function summarizeStorefrontCart(items: StorefrontCartItem[]) {
  return {
    itemCount: items.length,
    totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
    subtotal: items.reduce(
      (total, item) => total + item.unitPrice * item.quantity,
      0,
    ),
  };
}

export function normalizeQuantity(value: number, max: number) {
  if (!Number.isFinite(value)) return 0;

  return Math.min(Math.max(Math.floor(value), 0), Math.max(0, Math.floor(max)));
}

function emptyCart(storeSlug: string): StorefrontCart {
  return {
    storeSlug,
    updatedAt: new Date().toISOString(),
    items: [],
  };
}

function normalizeCartItem(
  item: Partial<StorefrontCartItem> | null | undefined,
): StorefrontCartItem | null {
  if (!item || typeof item.inventoryItemId !== "string") return null;

  const quantityAvailable = normalizeQuantity(
    Number(item.quantityAvailable),
    Number.MAX_SAFE_INTEGER,
  );
  const quantity = normalizeQuantity(Number(item.quantity), quantityAvailable);
  const unitPrice = Number(item.unitPrice);

  if (quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return null;

  return {
    inventoryItemId: item.inventoryItemId,
    productId: typeof item.productId === "string" ? item.productId : "",
    productName:
      typeof item.productName === "string" ? item.productName : "Product",
    speciesName:
      typeof item.speciesName === "string" ? item.speciesName : "Birds",
    optionLabel:
      typeof item.optionLabel === "string" ? item.optionLabel : "Option",
    ageLabel: typeof item.ageLabel === "string" ? item.ageLabel : null,
    typeLabel: typeof item.typeLabel === "string" ? item.typeLabel : "Option",
    availableDate:
      typeof item.availableDate === "string" ? item.availableDate : "",
    quantityAvailable,
    unitPrice,
    imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : null,
    quantity,
  };
}

function isCartItem(
  item: StorefrontCartItem | null,
): item is StorefrontCartItem {
  return item !== null;
}
