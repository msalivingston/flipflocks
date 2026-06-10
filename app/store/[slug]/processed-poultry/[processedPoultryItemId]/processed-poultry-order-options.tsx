"use client";

import { useState } from "react";
import {
  StorefrontCartItem,
  addItemsToStorefrontCart,
  normalizeQuantity,
  summarizeStorefrontCart,
} from "../../_components/storefront-cart-client";
import { StorefrontProcessedPoultryItem } from "../../storefront-data";
import {
  StorefrontButton,
  StorefrontCard,
  StorefrontInput,
  StorefrontLabel,
  formatCurrency,
} from "../../storefront-ui";

export function ProcessedPoultryOrderOptions({
  item,
}: {
  item: StorefrontProcessedPoultryItem;
}) {
  const [quantity, setQuantity] = useState(0);
  const [addedItem, setAddedItem] = useState<StorefrontCartItem | null>(null);
  const selectedQuantity = normalizeQuantity(quantity, item.quantity_available);
  const selectedItem =
    selectedQuantity > 0 ? toCartItem(item, selectedQuantity) : null;
  const summary = selectedItem
    ? summarizeStorefrontCart([selectedItem])
    : { itemCount: 0, subtotal: 0, totalQuantity: 0 };

  function handleAddToCart() {
    if (!selectedItem) return;

    addItemsToStorefrontCart(item.store_slug, [selectedItem]);
    setAddedItem(selectedItem);
    setQuantity(0);
  }

  return (
    <StorefrontCard className="overflow-hidden p-0">
      <div className="bg-[#fffdf8] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
          Processed Poultry
        </p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-stone-950">
              Choose quantity
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Local pickup order with seller confirmation.
            </p>
          </div>
          <p className="shrink-0 text-right text-sm font-semibold text-[#24512f]">
            {formatCurrency(item.unit_price)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 border-y border-[#e7decd] bg-[#fbf7ef] p-5">
        <div className="rounded-lg border border-[#ded7c8] bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-stone-950">
                {item.product_name}
              </h3>
              <p className="mt-1 text-sm text-stone-600">
                {[item.poultry_type, item.product_type, item.package_size]
                  .filter(Boolean)
                  .join(" - ")}
              </p>
            </div>
            <p className="text-right text-sm font-semibold text-[#24512f]">
              {item.quantity_available === 1
                ? "1 available"
                : `${item.quantity_available} available`}
            </p>
          </div>
          <StorefrontLabel className="mt-4 text-xs uppercase tracking-[0.1em] text-stone-500">
            Qty
            <StorefrontInput
              className="text-center"
              inputMode="numeric"
              max={item.quantity_available}
              min={0}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                setQuantity(Number.isNaN(parsed) ? 0 : parsed);
                setAddedItem(null);
              }}
              step={1}
              type="number"
              value={selectedQuantity}
            />
          </StorefrontLabel>
        </div>
      </div>

      <div className="grid gap-4 bg-white p-5">
        <div>
          <p className="text-sm font-semibold text-stone-950">Order summary</p>
          <p className="mt-1 text-sm text-stone-600">
            {summary.totalQuantity > 0
              ? `${summary.totalQuantity} selected - Estimated total ${formatCurrency(summary.subtotal)}`
              : "Select a quantity to add this item to your cart."}
          </p>
        </div>
        <StorefrontButton
          className="w-full px-5"
          disabled={!selectedItem}
          onClick={handleAddToCart}
        >
          Add to cart
        </StorefrontButton>
      </div>

      {addedItem ? (
        <div className="border-t border-emerald-200 bg-emerald-50 p-5">
          <h3 className="font-semibold text-emerald-950">Added to cart</h3>
          <div className="mt-3 rounded-md bg-white/70 px-3 py-2 text-sm text-emerald-950">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {addedItem.productName} - {addedItem.quantity} selected
              </span>
              <span className="font-semibold">
                {formatCurrency(addedItem.quantity * addedItem.unitPrice)}
              </span>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-emerald-950">
              Subtotal {formatCurrency(addedItem.quantity * addedItem.unitPrice)}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="min-h-10 rounded-md border border-emerald-700 bg-white/60 px-4 text-sm font-semibold text-emerald-900 hover:bg-white"
                onClick={() => setAddedItem(null)}
                type="button"
              >
                Continue shopping
              </button>
              <StorefrontButton
                className="min-h-10 border-emerald-700 text-emerald-900 hover:bg-white"
                href={`/store/${item.store_slug}/cart`}
                variant="secondary"
              >
                View cart
              </StorefrontButton>
              <StorefrontButton href={`/store/${item.store_slug}/checkout`}>
                Checkout
              </StorefrontButton>
            </div>
          </div>
        </div>
      ) : null}
    </StorefrontCard>
  );
}

function toCartItem(
  item: StorefrontProcessedPoultryItem,
  quantity: number,
): StorefrontCartItem {
  const optionLabel = [item.poultry_type, item.product_type, item.package_size]
    .filter(Boolean)
    .join(" - ");

  return {
    itemType: "processed_poultry_inventory",
    itemId: item.processed_poultry_inventory_item_id,
    inventoryItemId: item.processed_poultry_inventory_item_id,
    productId: item.processed_poultry_inventory_item_id,
    productName: item.product_name,
    speciesName: item.poultry_type,
    optionLabel,
    ageLabel: null,
    typeLabel: item.product_type,
    availableDate: "",
    quantityAvailable: item.quantity_available,
    unitPrice: item.unit_price,
    imageUrl: item.featured_image_url,
    quantity,
  };
}
