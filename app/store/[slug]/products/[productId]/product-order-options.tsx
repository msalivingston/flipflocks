"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
        const quantity = normalizeOptionQuantity(
          quantities[option.inventoryItemId] ?? 0,
          option.quantityAvailable,
          getOptionMinimumQuantity(option),
        );

        if (quantity <= 0) return items;

        items.push({
          itemType:
            product.productSource === "hatching_egg_inventory"
              ? "hatching_egg_inventory"
              : "listing_inventory",
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
  const mobileActionRef = useRef<HTMLDivElement | null>(null);
  const showStickyBar = useStickyPurchaseBar(
    summary.totalQuantity > 0,
    mobileActionRef,
  );
  const minimumOrderNote = getMinimumOrderNote(product);

  function updateQuantity(
    inventoryItemId: string,
    rawValue: string,
    max: number,
    min = 1,
  ) {
    const parsed = Number.parseInt(rawValue, 10);
    const quantity = Number.isNaN(parsed)
      ? 0
      : normalizeOptionQuantity(parsed, max, min);

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
    <section className="grid gap-2.5">
      <div className="hidden overflow-hidden rounded-lg border border-[#ded7c8] bg-white md:block">
        <div className="flex flex-col gap-2 border-b border-[#ded7c8] bg-[#f7faf4] px-4 py-4 sm:flex-row sm:items-center sm:gap-5">
          <h2 className="text-lg font-semibold text-stone-950">
            Purchase details
          </h2>
          <p className="text-sm leading-6 text-stone-600">
            {isHatchingEggProduct
              ? "Review the seller's available hatching egg options."
              : "Choose the quantities you would like to add to your cart."}
          </p>
        </div>

        <div>
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
                        min={getOptionMinimumQuantity(option)}
                        onChange={(value) =>
                          updateQuantity(
                            option.inventoryItemId,
                            value,
                            option.quantityAvailable,
                            getOptionMinimumQuantity(option),
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

      </div>

      <div className="grid gap-2.5 rounded-lg border border-[#ded7c8] bg-white/95 p-3 shadow-[0_2px_12px_rgba(41,37,36,0.04)] md:hidden">
        <div>
          <h2 className="text-[1.08rem] font-bold leading-tight text-stone-950">
            {isHatchingEggProduct ? "Choose your eggs" : "Choose your birds"}
          </h2>
          <p className="mt-0.5 text-[0.86rem] leading-5 text-stone-600">
            {isHatchingEggProduct
              ? "Select an option and quantity to add to your order."
              : "Select an age and quantity to add to your order."}
          </p>
        </div>

        <div className="grid">
          {visibleOptions.map((option, index) => {
            const selectedQuantity = getSelectedQuantity(option, quantities);
            const isAvailable = option.canCheckout && option.quantityAvailable > 0;

            return (
              <article
                className={cx(
                  "grid gap-2.5 bg-[#fffdf8] p-2.5 transition",
                  index > 0 ? "border-t border-[#efe5d8]" : "",
                  selectedQuantity > 0
                    ? "storefront-primary-border rounded-md border shadow-[0_0_0_1px_var(--storefront-heading-color)]"
                    : "",
                )}
                key={option.inventoryItemId}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[0.96rem] font-bold leading-tight text-stone-950">
                      {option.ageLabel}
                    </h3>
                    <p className="mt-0.5 truncate text-[0.84rem] font-semibold text-stone-700">
                      <SexLabel label={option.typeLabel} />
                    </p>
                  </div>
                  <ReadyPill option={option} />
                </div>

                <div className="flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <p className="storefront-primary-color text-[1rem] font-bold leading-tight text-[#073f1e]">
                      {formatCurrency(option.unitPrice)}{" "}
                      <span className="text-xs font-semibold text-stone-500">
                        each
                      </span>
                    </p>
                    <p className="mt-0.5 text-[0.84rem] font-semibold text-stone-600">
                      {formatQuantityAvailable(option.quantityAvailable)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <QuantityStepper
                      disabled={!isAvailable}
                      max={option.quantityAvailable}
                      min={getOptionMinimumQuantity(option)}
                      onChange={(value) =>
                        updateQuantity(
                          option.inventoryItemId,
                          value,
                          option.quantityAvailable,
                          getOptionMinimumQuantity(option),
                        )
                      }
                      value={selectedQuantity}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {minimumOrderNote ? (
        <p className="text-[0.84rem] leading-5 text-stone-600">
          {minimumOrderNote}
        </p>
      ) : null}

      <div
        className={cx(
          "rounded-lg md:hidden",
          summary.totalQuantity > 0
            ? "grid gap-2 border border-[#dfe7d8] bg-[#f3f8ef] p-3 shadow-[0_2px_12px_rgba(41,37,36,0.05)]"
            : "border border-transparent px-1 py-0.5",
        )}
        ref={mobileActionRef}
      >
        {summary.totalQuantity > 0 ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="font-bold text-stone-950">Order summary</p>
                <p className="mt-0.5 text-sm text-stone-600">
                  {getOrderSummaryText(summary.totalQuantity)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-stone-500">
                  Total
                </p>
                <p className="storefront-primary-color text-[1.2rem] font-bold leading-tight text-[#073f1e]">
                  {formatCurrency(summary.subtotal)}
                </p>
              </div>
            </div>
            <StorefrontButton
              className="min-h-11 w-full gap-2 px-5"
              disabled={summary.totalQuantity <= 0}
              onClick={handleAddToCart}
            >
              <StorefrontGlyph className="h-5 w-5" src="/glyphs/cart.png" />
              {getAddToCartButtonLabel(isButtonConfirmed)}
            </StorefrontButton>
          </>
        ) : (
          <p className="text-[0.84rem] leading-5 text-stone-500">
            Choose quantities to see your order total.
          </p>
        )}
      </div>

      <div className="hidden gap-4 rounded-lg border border-[#ded7c8] bg-white p-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)_minmax(14rem,0.65fr)] md:items-center">
        <div>
          <p className="font-semibold text-stone-950">Order summary</p>
          <p className="mt-1 text-sm text-stone-600">
            {getOrderSummaryText(summary.totalQuantity)}
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
          {getAddToCartButtonLabel(isButtonConfirmed)}
        </StorefrontButton>
      </div>

      <MobileStickyPurchaseBar
        buttonLabel={getAddToCartButtonLabel(isButtonConfirmed)}
        disabled={summary.totalQuantity <= 0}
        onAddToCart={handleAddToCart}
        show={showStickyBar}
        subtotal={summary.subtotal}
        totalQuantity={summary.totalQuantity}
      />

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

function MobileStickyPurchaseBar({
  buttonLabel,
  disabled,
  onAddToCart,
  show,
  subtotal,
  totalQuantity,
}: {
  buttonLabel: string;
  disabled: boolean;
  onAddToCart: () => void;
  show: boolean;
  subtotal: number;
  totalQuantity: number;
}) {
  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ded7c8] bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(41,37,36,0.12)] backdrop-blur md:hidden pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-[28rem] items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-stone-600">
            {totalQuantity} selected
          </p>
          <p className="storefront-primary-color text-lg font-bold leading-tight text-[#073f1e]">
            {formatCurrency(subtotal)}
          </p>
        </div>
        <StorefrontButton
          className="min-h-11 shrink-0 gap-2 px-4 text-sm"
          disabled={disabled}
          onClick={onAddToCart}
        >
          <StorefrontGlyph className="h-4 w-4" src="/glyphs/cart.png" />
          {buttonLabel}
        </StorefrontButton>
      </div>
    </div>
  );
}

function useStickyPurchaseBar(
  enabled: boolean,
  targetRef: RefObject<HTMLElement | null>,
) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const target = targetRef.current;

    if (!target || typeof IntersectionObserver === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 767px)");

    if (!mediaQuery.matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShow(!entry.isIntersecting);
      },
      { threshold: 0.2 },
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [enabled, targetRef]);

  return enabled && show;
}

function QuantityStepper({
  disabled,
  max,
  min,
  onChange,
  value,
}: {
  disabled: boolean;
  max: number;
  min: number;
  onChange: (value: string) => void;
  value: number;
}) {
  const nextIncrement = value <= 0 ? min : value + 1;
  const nextDecrement = value <= min ? 0 : value - 1;

  return (
    <div className="inline-grid grid-cols-[2.25rem_2.75rem_2.25rem] overflow-hidden rounded-md border border-[#ded7c8] bg-white align-middle">
      <button
        className="flex h-9 items-center justify-center border-r border-[#ded7c8] text-base disabled:text-stone-300"
        disabled={disabled || value <= 0}
        onClick={() => onChange(String(nextDecrement))}
        type="button"
      >
        -
      </button>
      <input
        className="h-9 min-w-0 bg-white text-center text-sm focus:outline-none disabled:bg-stone-50 disabled:text-stone-400"
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
        className="flex h-9 items-center justify-center border-l border-[#ded7c8] text-base disabled:text-stone-300"
        disabled={disabled || value >= max}
        onClick={() => onChange(String(nextIncrement))}
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
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.72rem] font-semibold leading-5",
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
    ? normalizeOptionQuantity(
        quantities[option.inventoryItemId],
        option.quantityAvailable,
        getOptionMinimumQuantity(option),
      )
    : 0;
}

function getOptionMinimumQuantity(option: StorefrontProduct["options"][number]) {
  return Math.max(1, Math.floor(option.minimumOrderQuantity ?? 1));
}

function normalizeOptionQuantity(value: number, max: number, min: number) {
  const quantity = normalizeQuantity(value, max);

  if (quantity <= 0) return 0;

  return Math.max(quantity, Math.min(min, Math.max(0, Math.floor(max))));
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
  const hatchingEggMinimums = product.options
    .map((option) => option.minimumOrderQuantity)
    .filter(
      (quantity): quantity is number =>
        quantity !== null && quantity !== undefined && quantity > 1,
    );

  if (hatchingEggMinimums.length > 0) {
    const uniqueMinimums = Array.from(new Set(hatchingEggMinimums)).sort(
      (first, second) => first - second,
    );

    if (uniqueMinimums.length === 1) {
      return `Minimum order: ${uniqueMinimums[0]} eggs.`;
    }

    return `Minimum order varies by option: ${uniqueMinimums.join(", ")} eggs.`;
  }

  const description = product.description ?? "";
  const match = description.match(/minimum order\s*:\s*([^.\n]+\.?)/i);

  if (match?.[1] && !/hatching?\s+eggs?|eggs?/i.test(match[1])) {
    return `Minimum order: ${match[1].trim()}`;
  }

  return null;
}

function getOrderSummaryText(selectedQuantity: number) {
  return selectedQuantity > 0
    ? `${selectedQuantity} selected`
    : "Add quantities above to see your total.";
}

function getAddToCartButtonLabel(isButtonConfirmed: boolean) {
  return isButtonConfirmed ? "Added to cart" : "Add to cart";
}
