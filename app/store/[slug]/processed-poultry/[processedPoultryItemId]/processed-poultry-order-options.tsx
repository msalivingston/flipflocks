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

  function handleAddToCart() {
    if (!selectedItem) return;

    addItemsToStorefrontCart(item.store_slug, [selectedItem]);
    setAddedItem(selectedItem);
    setQuantity(0);
  }

  return (
    <section className="grid gap-3">
      <div className="overflow-hidden rounded-lg border border-[#ded7c8] bg-white">
        <div className="flex flex-col gap-2 border-b border-[#ded7c8] bg-[#f7faf4] px-4 py-4 sm:flex-row sm:items-center sm:gap-5">
          <h2 className="text-lg font-semibold text-stone-950">Purchase details</h2>
          <p className="text-sm leading-6 text-stone-600">
            Choose the quantity you would like to add to your cart.
          </p>
        </div>

        <div className="hidden md:block">
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

        <article className="grid gap-3 p-4 md:hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
                Product
              </p>
              <h3 className="mt-1 font-semibold text-stone-950">
                {item.product_name}
              </h3>
            </div>
            <p className="storefront-primary-color font-semibold text-[#073f1e]">
              {formatQuantityAvailable(item.quantity_available)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <MobileFact label="Poultry">{item.poultry_type}</MobileFact>
            <MobileFact label="Package">
              {[item.product_type, item.package_size].filter(Boolean).join(" - ") ||
                "Not listed"}
            </MobileFact>
            <MobileFact label="Price">
              <span className="font-semibold text-stone-950">
                {formatCurrency(item.unit_price)}
              </span>{" "}
              <span className="text-stone-500">each</span>
            </MobileFact>
            <MobileFact label="Quantity">
              <QuantityStepper
                disabled={!item.can_checkout || item.quantity_available <= 0}
                max={item.quantity_available}
                onChange={updateQuantity}
                value={selectedQuantity}
              />
            </MobileFact>
          </div>
        </article>
      </div>

      <div className="grid gap-4 rounded-lg border border-[#ded7c8] bg-white p-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)_minmax(14rem,0.65fr)] md:items-center">
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
