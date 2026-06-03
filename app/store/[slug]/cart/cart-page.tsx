"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  StorefrontCart,
  readStorefrontCart,
  removeStorefrontCartItem,
  summarizeStorefrontCart,
  updateStorefrontCartItemQuantity,
} from "../_components/storefront-cart-client";
import { StorefrontHome } from "../storefront-data";
import { formatCurrency, formatDate } from "../storefront-ui";

const emptyItems: StorefrontCart["items"] = [];

export function CartPage({ store }: { store: StorefrontHome }) {
  const [cart, setCart] = useState<StorefrontCart | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCart(readStorefrontCart(store.store_slug));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [store.store_slug]);

  const items = cart?.items ?? emptyItems;
  const summary = useMemo(() => summarizeStorefrontCart(items), [items]);

  function updateQuantity(inventoryItemId: string, rawValue: string) {
    const parsed = Number.parseInt(rawValue, 10);
    const nextCart = updateStorefrontCartItemQuantity(
      store.store_slug,
      inventoryItemId,
      Number.isNaN(parsed) ? 0 : parsed,
    );

    setCart(nextCart);
  }

  function removeItem(inventoryItemId: string) {
    setCart(removeStorefrontCartItem(store.store_slug, inventoryItemId));
  }

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-5 py-8 sm:px-7">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
          Cart
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Your cart
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Review your selected birds before checkout.
        </p>
      </div>

      {cart === null ? (
        <CartPanel>
          <p className="text-sm text-stone-600">Loading cart...</p>
        </CartPanel>
      ) : items.length === 0 ? (
        <CartPanel>
          <h2 className="text-xl font-semibold text-stone-950">
            Your cart is empty
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Add available options from the storefront to start an order.
          </p>
          <Link
            className="mt-4 inline-flex min-h-10 items-center rounded-md bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900"
            href={`/store/${store.store_slug}`}
          >
            Continue shopping
          </Link>
        </CartPanel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
          <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="divide-y divide-stone-200">
              {items.map((item) => (
                <article
                  className="grid gap-4 p-4 md:grid-cols-[1fr_8rem_6rem]"
                  key={item.inventoryItemId}
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">
                      {item.speciesName}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-stone-950">
                      {item.productName}
                    </h2>
                    <p className="mt-1 text-sm text-stone-600">
                      {item.optionLabel}
                    </p>
                    <p className="mt-2 text-sm text-stone-600">
                      {formatCartAvailability(item.availableDate)} ·{" "}
                      {formatCurrency(item.unitPrice)} each ·{" "}
                      {item.quantityAvailable} available
                    </p>
                  </div>

                  <label className="grid h-fit gap-1 text-sm font-semibold text-stone-800">
                    Quantity
                    <input
                      className="min-h-11 rounded-md border border-stone-300 px-3 py-2 text-base font-normal text-stone-950 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      inputMode="numeric"
                      max={item.quantityAvailable}
                      min={0}
                      onChange={(event) =>
                        updateQuantity(
                          item.inventoryItemId,
                          event.target.value,
                        )
                      }
                      step={1}
                      type="number"
                      value={item.quantity}
                    />
                  </label>

                  <div className="flex items-start justify-between gap-3 md:grid md:justify-items-end">
                    <p className="font-semibold text-stone-950">
                      {formatCurrency(item.quantity * item.unitPrice)}
                    </p>
                    <button
                      className="text-sm font-semibold text-stone-500 hover:text-rose-700"
                      onClick={() => removeItem(item.inventoryItemId)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-950">
              Order summary
            </h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <SummaryRow label="Items" value={String(summary.totalQuantity)} />
              <SummaryRow
                label="Estimated total"
                value={formatCurrency(summary.subtotal)}
              />
            </dl>
            <div className="mt-5 grid gap-2">
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900"
                href={`/store/${store.store_slug}/checkout`}
              >
                Checkout
              </Link>
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-800 hover:bg-stone-50"
                href={`/store/${store.store_slug}`}
              >
                Continue shopping
              </Link>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function CartPanel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      {children}
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-stone-600">{label}</dt>
      <dd className="font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function formatCartAvailability(availableDate: string) {
  if (!availableDate) return "Available date coming soon";

  const today = new Date();
  const normalizedToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const availability = new Date(`${availableDate}T00:00:00`);

  if (availability <= normalizedToday) return "Available now";

  return `Available ${formatDate(availableDate)}`;
}
