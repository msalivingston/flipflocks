"use client";

import { useMemo, useState } from "react";
import {
  StorefrontCartItem,
  addItemsToStorefrontCart,
  cartItemKey,
  normalizeQuantity,
  summarizeStorefrontCart,
} from "../../_components/storefront-cart-client";
import { StorefrontProduct } from "../../storefront-data";
import { ShoppingCart } from "lucide-react";
import {
  StorefrontButton,
  formatCurrency,
  formatDate,
} from "../../storefront-ui";

type ProductOrderOptionsProps = {
  product: StorefrontProduct;
};

export function ProductOrderOptions({ product }: ProductOrderOptionsProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addedItems, setAddedItems] = useState<StorefrontCartItem[] | null>(null);

  const selectableOptions = useMemo(
    () =>
      product.options.filter(
        (option) => option.canCheckout && option.quantityAvailable > 0,
      ),
    [product.options],
  );

  const selectedItems = useMemo<StorefrontCartItem[]>(
    () =>
      selectableOptions.reduce<StorefrontCartItem[]>((items, option) => {
        const quantity = normalizeQuantity(
          quantities[option.inventoryItemId] ?? 0,
          option.quantityAvailable,
        );

        if (quantity <= 0) return items;

        items.push({
          itemType: "listing_inventory",
          itemId: option.inventoryItemId,
          inventoryItemId: option.inventoryItemId,
          productId: product.productId,
          productName: product.name,
          speciesName: product.speciesName,
          optionLabel: option.label,
          ageLabel: option.ageLabel,
          typeLabel: option.typeLabel,
          availableDate: option.availableDate,
          quantityAvailable: option.quantityAvailable,
          unitPrice: option.unitPrice,
          imageUrl: product.imageUrl,
          quantity,
        });

        return items;
      }, []),
    [product, quantities, selectableOptions],
  );

  const summary = summarizeStorefrontCart(selectedItems);
  const addedSummary = addedItems ? summarizeStorefrontCart(addedItems) : null;

  function updateQuantity(inventoryItemId: string, rawValue: string, max: number) {
    const parsed = Number.parseInt(rawValue, 10);
    const quantity = Number.isNaN(parsed) ? 0 : normalizeQuantity(parsed, max);

    setQuantities((current) => ({
      ...current,
      [inventoryItemId]: quantity,
    }));
    setAddedItems(null);
  }

  function handleAddToCart() {
    if (summary.totalQuantity <= 0) return;

    addItemsToStorefrontCart(product.storeSlug, selectedItems);
    setAddedItems(selectedItems);
    setQuantities({});
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[#ded7c8] bg-[#fffdf8]">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#073f1e] text-sm font-bold text-white">
            1
          </span>
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Choose your birds
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Select quantities across available options.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-y border-[#e7decd] bg-[#fbf7ef] p-3">
        {product.options.map((option) => {
          const isAvailable = option.canCheckout && option.quantityAvailable > 0;
          const selectedQuantity =
            quantities[option.inventoryItemId] !== undefined
              ? normalizeQuantity(
                  quantities[option.inventoryItemId],
                  option.quantityAvailable,
                )
              : 0;

          return (
            <article
              className="rounded-lg border border-[#ded7c8] bg-white p-4"
              key={option.inventoryItemId}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-stone-950">
                    {option.typeLabel} <span className="mx-1">-</span>{" "}
                    {option.ageLabel}
                  </h3>
                </div>
                <p className="text-right font-semibold text-[#073f1e]">
                  {formatCurrency(option.unitPrice)}
                  <span className="block text-xs font-normal text-stone-500">
                    each
                  </span>
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="grid gap-1 text-sm text-stone-700">
                  <p>{formatOptionAvailability(option)}</p>
                  <p>
                    {option.quantityAvailable > 0
                      ? `${option.quantityAvailable} available`
                      : "Sold out"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-stone-950">Qty</span>
                  <button
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#ded7c8] bg-white text-lg disabled:text-stone-300"
                    disabled={!isAvailable || selectedQuantity <= 0}
                    onClick={() =>
                      updateQuantity(
                        option.inventoryItemId,
                        String(selectedQuantity - 1),
                        option.quantityAvailable,
                      )
                    }
                    type="button"
                  >
                    -
                  </button>
                  <input
                    className="h-9 w-12 rounded-md border border-[#ded7c8] bg-white text-center text-sm"
                    disabled={!isAvailable}
                    inputMode="numeric"
                    max={Math.max(0, option.quantityAvailable)}
                    min={0}
                    onChange={(event) =>
                      updateQuantity(
                        option.inventoryItemId,
                        event.target.value,
                        option.quantityAvailable,
                      )
                    }
                    step={1}
                    type="number"
                    value={selectedQuantity}
                  />
                  <button
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#ded7c8] bg-white text-lg disabled:text-stone-300"
                    disabled={!isAvailable || selectedQuantity >= option.quantityAvailable}
                    onClick={() =>
                      updateQuantity(
                        option.inventoryItemId,
                        String(selectedQuantity + 1),
                        option.quantityAvailable,
                      )
                    }
                    type="button"
                  >
                    +
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="grid gap-4 bg-white p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#073f1e] text-sm font-bold text-white">
            2
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-stone-950">Order summary</p>
            <p className="mt-1 text-sm text-stone-600">
              {summary.totalQuantity > 0
                ? `${summary.totalQuantity} selected`
                : "Add quantities above to see your total."}
            </p>
          </div>
          <div className="rounded-lg border border-[#eee5d6] bg-[#fffdf8] px-4 py-3 text-right">
            <p className="text-xs text-stone-500">Estimated total</p>
            <p className="text-xl font-bold text-[#073f1e]">
              {formatCurrency(summary.subtotal)}
            </p>
          </div>
        </div>
        <StorefrontButton
          className="w-full gap-2 px-5"
          disabled={summary.totalQuantity <= 0}
          onClick={handleAddToCart}
        >
          <ShoppingCart aria-hidden="true" className="h-5 w-5" />
          Add to cart
        </StorefrontButton>
        <p className="text-center text-xs text-stone-500">
          Secure and safe checkout
        </p>
      </div>

      {addedItems && addedSummary ? (
        <div className="border-t border-emerald-200 bg-emerald-50 p-5">
          <h3 className="font-semibold text-emerald-950">Added to cart</h3>
          <div className="mt-3 grid gap-2 text-sm text-emerald-950">
            {addedItems.map((item) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-white/70 px-3 py-2"
                key={cartItemKey(item)}
              >
                <span>
                  {item.productName} - {item.optionLabel}
                </span>
                <span className="font-semibold">
                  {item.quantity} -{" "}
                  {formatCurrency(item.quantity * item.unitPrice)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-emerald-950">
              Subtotal {formatCurrency(addedSummary.subtotal)}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="min-h-10 rounded-md border border-emerald-700 bg-white/60 px-4 text-sm font-semibold text-emerald-900 hover:bg-white"
                onClick={() => setAddedItems(null)}
                type="button"
              >
                Continue shopping
              </button>
              <StorefrontButton
                className="min-h-10 border-emerald-700 text-emerald-900 hover:bg-white"
                href={`/store/${product.storeSlug}/cart`}
                variant="secondary"
              >
                View cart
              </StorefrontButton>
              <StorefrontButton href={`/store/${product.storeSlug}/checkout`}>
                Checkout
              </StorefrontButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatOptionAvailability(
  option: StorefrontProduct["options"][number],
) {
  if (option.quantityAvailable <= 0) return "Sold out";
  if (option.buyerAvailabilityCode === "ready_now") return "Available now";

  return `Available ${formatDate(option.availableDate)}`;
}
