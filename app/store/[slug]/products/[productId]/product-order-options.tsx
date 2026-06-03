"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  StorefrontCartItem,
  addItemsToStorefrontCart,
  normalizeQuantity,
  summarizeStorefrontCart,
} from "../../_components/storefront-cart-client";
import { StorefrontProduct } from "../../storefront-data";
import { formatCurrency, formatDate } from "../../storefront-ui";

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
    <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
          Purchase options
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-stone-950">
          Choose quantities
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Select one or more available options, then add them to your cart.
        </p>
      </div>

      <div className="divide-y divide-stone-200">
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
            <div
              className="grid gap-4 p-4 md:grid-cols-[1.1fr_0.8fr_0.8fr_0.7fr_8rem]"
              key={option.inventoryItemId}
            >
              <div>
                <h3 className="font-semibold text-stone-950">
                  {option.typeLabel}
                </h3>
                <p className="mt-1 text-sm text-stone-600">
                  {option.ageLabel}
                </p>
              </div>

              <OptionDetail
                label="Available"
                value={formatOptionAvailability(option)}
              />
              <OptionDetail
                label="Quantity"
                value={
                  option.quantityAvailable > 0
                    ? `${option.quantityAvailable} available`
                    : "Sold out"
                }
              />
              <OptionDetail
                label="Price"
                value={`${formatCurrency(option.unitPrice)} each`}
              />

              <label className="grid gap-1 text-sm font-semibold text-stone-800">
                Quantity
                <input
                  className="min-h-11 rounded-md border border-stone-300 px-3 py-2 text-base font-normal text-stone-950 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:bg-stone-100 disabled:text-stone-400"
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
              </label>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 border-t border-stone-200 bg-stone-50 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-stone-950">Order summary</p>
          <p className="mt-1 text-sm text-stone-600">
            {summary.totalQuantity > 0
              ? `${summary.totalQuantity} selected - Estimated total ${formatCurrency(summary.subtotal)}`
              : "Select a quantity to add options to your cart."}
          </p>
        </div>
        <button
          className="min-h-11 rounded-md bg-emerald-800 px-5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-stone-300"
          disabled={summary.totalQuantity <= 0}
          onClick={handleAddToCart}
          type="button"
        >
          Add to cart
        </button>
      </div>

      {addedItems && addedSummary ? (
        <div className="border-t border-emerald-200 bg-emerald-50 p-5">
          <h3 className="font-semibold text-emerald-950">Added to cart</h3>
          <div className="mt-3 grid gap-2 text-sm text-emerald-950">
            {addedItems.map((item) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-white/70 px-3 py-2"
                key={item.inventoryItemId}
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
                className="min-h-10 rounded-md border border-emerald-700 px-4 text-sm font-semibold text-emerald-900 hover:bg-white"
                onClick={() => setAddedItems(null)}
                type="button"
              >
                Continue shopping
              </button>
              <Link
                className="inline-flex min-h-10 items-center rounded-md border border-emerald-700 px-4 text-sm font-semibold text-emerald-900 hover:bg-white"
                href={`/store/${product.storeSlug}/cart`}
              >
                View cart
              </Link>
              <Link
                className="inline-flex min-h-10 items-center rounded-md bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900"
                href={`/store/${product.storeSlug}/checkout`}
              >
                Checkout
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OptionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function formatOptionAvailability(
  option: StorefrontProduct["options"][number],
) {
  if (option.quantityAvailable <= 0) return "Sold out";
  if (option.buyerAvailabilityCode === "ready_now") return "Available now";

  return `Available ${formatDate(option.availableDate)}`;
}
