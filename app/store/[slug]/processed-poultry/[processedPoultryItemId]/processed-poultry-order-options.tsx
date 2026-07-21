"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  StorefrontCartItem,
  addItemsToStorefrontCart,
  normalizeQuantity,
  summarizeStorefrontCart,
} from "../../_components/storefront-cart-client";
import { useAddToCartConfirmation } from "../../_components/use-add-to-cart-confirmation";
import { StorefrontProcessedPoultryItem } from "../../storefront-data";
import {
  StorefrontButton,
  cx,
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
  const {
    confirmationPanelRef,
    isButtonConfirmed,
    isPanelHighlighted,
    showAddToCartConfirmation,
  } = useAddToCartConfirmation();
  const mobileActionRef = useRef<HTMLDivElement | null>(null);
  const showStickyBar = useStickyPurchaseBar(Boolean(selectedItem), mobileActionRef);

  function handleAddToCart() {
    if (!selectedItem) return;

    addItemsToStorefrontCart(item.store_slug, [selectedItem]);
    setAddedItem(selectedItem);
    setQuantity(0);
    showAddToCartConfirmation();
  }

  return (
    <section className="grid gap-2.5">
      <div className="hidden overflow-hidden rounded-lg border border-[#ded7c8] bg-white md:block">
        <div className="flex flex-col gap-2 border-b border-[#ded7c8] bg-[#f7faf4] px-4 py-4 sm:flex-row sm:items-center sm:gap-5">
          <h2 className="text-lg font-semibold text-stone-950">Purchase details</h2>
          <p className="text-sm leading-6 text-stone-600">
            Choose the quantity you would like to add to your cart.
          </p>
        </div>

        <div>
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#e7decd] bg-[#fbf7ef] text-stone-950">
                <TableHeading>Product</TableHeading>
                <TableHeading>Poultry</TableHeading>
                <TableHeading>Package</TableHeading>
                <TableHeading>Available</TableHeading>
                <TableHeading>Price</TableHeading>
                <TableHeading className="text-right">Quantity</TableHeading>
              </tr>
            </thead>
            <tbody>
              <tr>
                <TableCell className="font-medium text-stone-950">
                  {item.product_name}
                </TableCell>
                <TableCell>{item.poultry_type}</TableCell>
                <TableCell>
                  {[item.product_type, item.package_size]
                    .filter(Boolean)
                    .join(" - ") || "Not listed"}
                </TableCell>
                <TableCell className="storefront-primary-color font-semibold text-[#073f1e]">
                  {formatQuantityAvailable(item.quantity_available)}
                </TableCell>
                <TableCell>
                  <span className="font-semibold text-stone-950">
                    {formatCurrency(item.unit_price)}
                  </span>{" "}
                  <span className="text-stone-500">each</span>
                </TableCell>
                <TableCell className="text-right">
                  <QuantityStepper
                    disabled={!item.can_checkout || item.quantity_available <= 0}
                    max={item.quantity_available}
                    onChange={updateQuantity}
                    value={selectedQuantity}
                  />
                </TableCell>
              </tr>
            </tbody>
          </table>
        </div>

      </div>

      <div className="grid gap-2.5 rounded-lg border border-[#ded7c8] bg-white/95 p-3 shadow-[0_2px_12px_rgba(41,37,36,0.05)] md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[1.08rem] font-bold leading-tight text-stone-950">Choose quantity</h2>
            <p className="mt-0.5 text-[0.86rem] leading-5 text-stone-600">
              {formatQuantityAvailable(item.quantity_available)} available
            </p>
          </div>
          <p className="storefront-primary-color text-[1.16rem] font-bold leading-tight text-[#073f1e]">
            {formatCurrency(item.unit_price)}
            <span className="text-xs font-semibold text-stone-500"> each</span>
          </p>
        </div>
        <div className="grid gap-2 rounded-md border border-[#eee2d2] bg-[#fffdf8] p-2.5">
          <div className="grid grid-cols-2 gap-2 text-[0.84rem]">
            <MobileFact label="Poultry">{item.poultry_type}</MobileFact>
            {[item.product_type, item.package_size].filter(Boolean).length > 0 ? (
              <MobileFact label="Package">
                {[item.product_type, item.package_size].filter(Boolean).join(" - ")}
              </MobileFact>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-sm font-bold text-stone-950">Quantity</span>
            <QuantityStepper
              disabled={!item.can_checkout || item.quantity_available <= 0}
              max={item.quantity_available}
              onChange={updateQuantity}
              value={selectedQuantity}
            />
          </div>
        </div>
      </div>

      <div
        className={cx(
          "rounded-lg md:hidden",
          selectedItem
            ? "grid gap-2 border border-[#dfe7d8] bg-[#f3f8ef] p-3 shadow-[0_2px_12px_rgba(41,37,36,0.05)]"
            : "border border-transparent px-1 py-0.5",
        )}
        ref={mobileActionRef}
      >
        {selectedItem ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="font-bold text-stone-950">Order summary</p>
                <p className="mt-0.5 text-sm text-stone-600">
                  {summary.totalQuantity} selected
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
              className="min-h-11 w-full px-5"
              disabled={!selectedItem}
              onClick={handleAddToCart}
            >
              {isButtonConfirmed ? "Added to cart" : "Add to cart"}
            </StorefrontButton>
          </>
        ) : (
          <p className="text-[0.84rem] leading-5 text-stone-500">
            Choose a quantity to see your order total.
          </p>
        )}
      </div>

      <div className="hidden gap-4 rounded-lg border border-[#ded7c8] bg-white p-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)_minmax(14rem,0.65fr)] md:items-center">
        <div>
          <p className="font-semibold text-stone-950">Order summary</p>
          <p className="mt-1 text-sm text-stone-600">
            {summary.totalQuantity > 0
              ? `${summary.totalQuantity} selected`
              : "Add a quantity above to see your total."}
          </p>
        </div>
        <div>
          <p className="text-sm text-stone-600">Estimated total</p>
          <p className="storefront-primary-color text-2xl font-bold text-[#073f1e]">
            {formatCurrency(summary.subtotal)}
          </p>
        </div>
        <StorefrontButton
          className="w-full px-5"
          disabled={!selectedItem}
          onClick={handleAddToCart}
        >
          {isButtonConfirmed ? "Added to cart" : "Add to cart"}
        </StorefrontButton>
      </div>

      <MobileStickyPurchaseBar
        buttonLabel={isButtonConfirmed ? "Added to cart" : "Add to cart"}
        disabled={!selectedItem}
        onAddToCart={handleAddToCart}
        show={showStickyBar}
        subtotal={summary.subtotal}
        totalQuantity={summary.totalQuantity}
      />

      {addedItem ? (
        <div
          className={cx(
            "border-t border-emerald-200 bg-emerald-50 p-5 transition-[box-shadow,opacity] duration-500 ease-out",
            isPanelHighlighted
              ? "shadow-[0_0_0_3px_rgba(16,185,129,0.22)]"
              : "shadow-none",
          )}
          ref={confirmationPanelRef}
        >
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
                className="storefront-primary-border storefront-primary-color min-h-10 rounded-md border bg-white/60 px-4 text-sm font-semibold hover:bg-white"
                onClick={() => setAddedItem(null)}
                type="button"
              >
                Continue shopping
              </button>
              <StorefrontButton
                className="min-h-10 hover:bg-white"
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
    </section>
  );

  function updateQuantity(rawValue: string) {
    const parsed = Number.parseInt(rawValue, 10);
    setQuantity(Number.isNaN(parsed) ? 0 : parsed);
    setAddedItem(null);
  }
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
          className="min-h-11 shrink-0 px-4 text-sm"
          disabled={disabled}
          onClick={onAddToCart}
        >
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
  onChange,
  value,
}: {
  disabled: boolean;
  max: number;
  onChange: (value: string) => void;
  value: number;
}) {
  return (
    <div className="inline-grid grid-cols-[2.25rem_2.75rem_2.25rem] overflow-hidden rounded-md border border-[#ded7c8] bg-white align-middle">
      <button
        className="flex h-9 items-center justify-center border-r border-[#ded7c8] text-base disabled:text-stone-300"
        disabled={disabled || value <= 0}
        onClick={() => onChange(String(value - 1))}
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
        onClick={() => onChange(String(value + 1))}
        type="button"
      >
        +
      </button>
    </div>
  );
}

function formatQuantityAvailable(quantity: number) {
  if (quantity <= 0) return "Sold out";
  return quantity === 1 ? "1 available" : `${quantity} available`;
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
