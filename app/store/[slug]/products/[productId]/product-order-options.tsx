"use client";

import { useMemo, useState } from "react";
import {
  StorefrontCartItem,
  addItemsToStorefrontCart,
  cartItemKey,
  normalizeQuantity,
  summarizeStorefrontCart,
} from "../../_components/storefront-cart-client";
import { useAddToCartConfirmation } from "../../_components/use-add-to-cart-confirmation";
import { StorefrontProduct } from "../../storefront-data";
import {
  StorefrontButton,
  StorefrontGlyph,
  cx,
  formatCurrency,
} from "../../storefront-ui";

type ProductOrderOptionsProps = {
  product: StorefrontProduct;
};

export function ProductOrderOptions({ product }: ProductOrderOptionsProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addedItems, setAddedItems] = useState<StorefrontCartItem[] | null>(null);
  const isHatchingEggProduct = product.options.every(
    (option) => option.inventoryType === "hatching_eggs",
  );

  const selectableOptions = useMemo(
    () =>
      product.options.filter(
        (option) => option.canCheckout && option.quantityAvailable > 0,
      ),
    [product.options],
  );
  const visibleOptions = useMemo(
    () =>
      product.options.filter(
        (option) =>
          option.quantityAvailable > 0 ||
          (option.buyerAvailabilityCode === "reserve_now" &&
            Boolean(option.availableDate)),
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
  const {
    confirmationPanelRef,
    isButtonConfirmed,
    isPanelHighlighted,
    showAddToCartConfirmation,
  } = useAddToCartConfirmation();

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
    showAddToCartConfirmation();
  }

  return (
    <section className="grid gap-3">
      <div className="overflow-hidden rounded-lg border border-[#ded7c8] bg-white">
        <div className="flex flex-col gap-2 border-b border-[#ded7c8] bg-[#f7faf4] px-4 py-4 sm:flex-row sm:items-center sm:gap-5">
          <h2 className="text-lg font-semibold text-stone-950">
            Purchase details
          </h2>
          <p className="text-sm leading-6 text-stone-600">
            {isHatchingEggProduct
              ? "Choose from the seller's available hatching egg options."
              : "Choose the quantities you would like to add to your cart."}
          </p>
        </div>

        <div className="hidden md:block">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#e7decd] bg-[#fbf7ef] text-stone-950">
                <TableHeading>{isHatchingEggProduct ? "Item" : "Current age"}</TableHeading>
                <TableHeading>{isHatchingEggProduct ? "Type" : "Sex"}</TableHeading>
                <TableHeading>Ready Date</TableHeading>
                <TableHeading>Available</TableHeading>
                <TableHeading>Price</TableHeading>
                <TableHeading className="text-right">Quantity</TableHeading>
              </tr>
            </thead>
            <tbody>
              {visibleOptions.map((option) => {
                const selectedQuantity = getSelectedQuantity(
                  option,
                  quantities,
                );
                const isAvailable =
                  option.canCheckout && option.quantityAvailable > 0;

                return (
                  <tr
                    className="border-b border-[#eee7dc] last:border-b-0"
                    key={option.inventoryItemId}
                  >
                    <TableCell className="font-medium text-stone-950">
                      {option.ageLabel}
                    </TableCell>
                    <TableCell>
                      <SexLabel label={option.typeLabel} />
                    </TableCell>
                    <TableCell>
                      <ReadyPill option={option} />
                    </TableCell>
                    <TableCell className="storefront-primary-color font-semibold text-[#073f1e]">
                      {formatQuantityAvailable(option.quantityAvailable)}
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-stone-950">
                        {formatCurrency(option.unitPrice)}
                      </span>{" "}
                      <span className="text-stone-500">each</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <QuantityStepper
                        disabled={!isAvailable}
                        max={option.quantityAvailable}
                        onChange={(value) =>
                          updateQuantity(
                            option.inventoryItemId,
                            value,
                            option.quantityAvailable,
                          )
                        }
                        value={selectedQuantity}
                      />
                    </TableCell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-0 md:hidden">
          {visibleOptions.map((option) => {
            const selectedQuantity = getSelectedQuantity(option, quantities);
            const isAvailable = option.canCheckout && option.quantityAvailable > 0;

            return (
              <article
                className="grid gap-3 border-b border-[#eee7dc] p-4 last:border-b-0"
                key={option.inventoryItemId}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
                      {isHatchingEggProduct ? "Item" : "Current age"}
                    </p>
                    <h3 className="mt-1 font-semibold text-stone-950">
                      {option.ageLabel}
                    </h3>
                  </div>
                  <ReadyPill option={option} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <MobileFact label={isHatchingEggProduct ? "Type" : "Sex"}>
                    <SexLabel label={option.typeLabel} />
                  </MobileFact>
                  <MobileFact label="Available">
                    <span className="storefront-primary-color font-semibold text-[#073f1e]">
                      {formatQuantityAvailable(option.quantityAvailable)}
                    </span>
                  </MobileFact>
                  <MobileFact label="Price">
                    <span className="font-semibold text-stone-950">
                      {formatCurrency(option.unitPrice)}
                    </span>{" "}
                    <span className="text-stone-500">each</span>
                  </MobileFact>
                  <MobileFact label="Quantity">
                    <QuantityStepper
                      disabled={!isAvailable}
                      max={option.quantityAvailable}
                      onChange={(value) =>
                        updateQuantity(
                          option.inventoryItemId,
                          value,
                          option.quantityAvailable,
                        )
                      }
                      value={selectedQuantity}
                    />
                  </MobileFact>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <p className="text-sm text-stone-600">{getMinimumOrderNote(product)}</p>

      <div className="grid gap-4 rounded-lg border border-[#ded7c8] bg-white p-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)_minmax(14rem,0.65fr)] md:items-center">
        <div>
          <p className="font-semibold text-stone-950">Order summary</p>
          <p className="mt-1 text-sm text-stone-600">
            {summary.totalQuantity > 0
              ? `${summary.totalQuantity} selected`
              : "Add quantities above to see your total."}
          </p>
        </div>
        <div>
          <p className="text-sm text-stone-600">Estimated total</p>
          <p className="storefront-primary-color text-2xl font-bold text-[#073f1e]">
            {formatCurrency(summary.subtotal)}
          </p>
        </div>
        <StorefrontButton
          className="w-full gap-2 px-5"
          disabled={summary.totalQuantity <= 0}
          onClick={handleAddToCart}
        >
          <StorefrontGlyph className="h-5 w-5" src="/glyphs/cart.png" />
          {isButtonConfirmed ? "Added to cart" : "Add to cart"}
        </StorefrontButton>
      </div>

      {addedItems && addedSummary ? (
        <div
          className={cx(
            "rounded-lg border border-emerald-200 bg-emerald-50 p-5 transition-[box-shadow,opacity] duration-500 ease-out",
            isPanelHighlighted
              ? "shadow-[0_0_0_3px_rgba(16,185,129,0.22)]"
              : "shadow-none",
          )}
          ref={confirmationPanelRef}
        >
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
                className="storefront-primary-border storefront-primary-color min-h-10 rounded-md border bg-white/60 px-4 text-sm font-semibold hover:bg-white"
                onClick={() => setAddedItems(null)}
                type="button"
              >
                Continue shopping
              </button>
              <StorefrontButton
                className="min-h-10 hover:bg-white"
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

function TableHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={cx("px-4 py-4 font-semibold", className)} scope="col">
      {children}
    </th>
  );
}

function TableCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cx("px-4 py-4 align-middle", className)}>{children}</td>;
}

function MobileFact({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      <div className="mt-1 min-w-0 text-stone-800">{children}</div>
    </div>
  );
}

function QuantityStepper({
  disabled,
  max,
  onChange,
  value,
}: {
  disabled: boolean;
  max: number;
  onChange: (value: string) => void;
  value: number;
}) {
  return (
    <div className="inline-grid grid-cols-[2.5rem_3.25rem_2.5rem] overflow-hidden rounded-md border border-[#ded7c8] bg-white align-middle">
      <button
        className="flex h-10 items-center justify-center border-r border-[#ded7c8] text-lg disabled:text-stone-300"
        disabled={disabled || value <= 0}
        onClick={() => onChange(String(value - 1))}
        type="button"
      >
        -
      </button>
      <input
        className="h-10 min-w-0 bg-white text-center text-sm focus:outline-none disabled:bg-stone-50 disabled:text-stone-400"
        disabled={disabled}
        inputMode="numeric"
        max={Math.max(0, max)}
        min={0}
        onChange={(event) => onChange(event.target.value)}
        step={1}
        type="number"
        value={value}
      />
      <button
        className="flex h-10 items-center justify-center border-l border-[#ded7c8] text-lg disabled:text-stone-300"
        disabled={disabled || value >= max}
        onClick={() => onChange(String(value + 1))}
        type="button"
      >
        +
      </button>
    </div>
  );
}

function SexLabel({ label }: { label: string }) {
  return <span>{label}</span>;
}

function ReadyPill({ option }: { option: StorefrontProduct["options"][number] }) {
  const isReadyNow = option.buyerAvailabilityCode === "ready_now";

  return (
    <span
      className={cx(
        "inline-flex whitespace-nowrap rounded-full border px-3 py-1 text-sm font-semibold",
        isReadyNow
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-[#ded7c8] bg-white text-stone-800",
      )}
    >
      {isReadyNow ? "Ready now" : `Ready ${formatShortDate(option.availableDate)}`}
    </span>
  );
}

function getSelectedQuantity(
  option: StorefrontProduct["options"][number],
  quantities: Record<string, number>,
) {
  return quantities[option.inventoryItemId] !== undefined
    ? normalizeQuantity(quantities[option.inventoryItemId], option.quantityAvailable)
    : 0;
}

function formatQuantityAvailable(quantity: number) {
  if (quantity <= 0) return "Sold out";
  return quantity === 1 ? "1 available" : `${quantity} available`;
}

function formatShortDate(value: string) {
  if (!value) return "later";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "later";

  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(date);
  const dottedMonth = month.endsWith(".") ? month : `${month}.`;

  return `${dottedMonth} ${day}`;
}

function getMinimumOrderNote(product: StorefrontProduct) {
  const description = product.description ?? "";
  const match = description.match(/minimum order\s*:\s*([^.\n]+\.?)/i);

  if (match?.[1] && !/hatching?\s+eggs?|eggs?/i.test(match[1])) {
    return `Minimum order: ${match[1].trim()}`;
  }

  return "Minimum order: No minimum listed.";
}
