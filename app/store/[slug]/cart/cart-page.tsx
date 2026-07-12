"use client";

import { useEffect, useMemo, useState } from "react";
import {
  StorefrontCart,
  cartItemKey,
  readStorefrontCart,
  removeStorefrontCartItem,
  summarizeStorefrontCart,
  updateStorefrontCartItemQuantity,
} from "../_components/storefront-cart-client";
import { StorefrontHome } from "../storefront-data";
import {
  StorefrontButton,
  StorefrontCard,
  StorefrontInput,
  StorefrontLabel,
  StorefrontPage,
  StorefrontSummaryCard,
  StorefrontTextButton,
  formatCurrency,
  formatDate,
} from "../storefront-ui";

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

  function updateQuantity(itemKey: string, rawValue: string) {
    const parsed = Number.parseInt(rawValue, 10);
    const nextCart = updateStorefrontCartItemQuantity(
      store.store_slug,
      itemKey,
      Number.isNaN(parsed) ? 0 : parsed,
    );

    setCart(nextCart);
  }

  function removeItem(itemKey: string) {
    setCart(removeStorefrontCartItem(store.store_slug, itemKey));
  }

  return (
    <StorefrontPage className="max-w-6xl gap-7">
      <div className="rounded-xl border border-[#ded7c8] bg-white p-6">
        <p className="storefront-primary-color text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
          Cart
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Your cart
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Review your selected items before checkout.
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
          <StorefrontButton className="mt-4 min-h-10" href={`/store/${store.store_slug}`}>
            Continue shopping
          </StorefrontButton>
        </CartPanel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
          <div className="grid gap-4">
            {items.map((item) => {
              const key = cartItemKey(item);

              return (
                <article
                  className="grid gap-4 rounded-xl border border-[#ded7c8] bg-white p-4 md:grid-cols-[1fr_8rem_6rem] md:items-center"
                  key={key}
                >
                  <div>
                    {item.speciesName ? (
                      <p className="storefront-primary-color text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">
                        {item.speciesName}
                      </p>
                    ) : null}
                    <h2 className="mt-1 text-lg font-semibold text-stone-950">
                      {item.productName}
                    </h2>
                    <p className="mt-1 text-sm text-stone-600">
                      {item.optionLabel}
                    </p>
                    <p className="mt-2 text-sm text-stone-600">
                      {formatCartAvailability(item.availableDate)} -{" "}
                      {formatCurrency(item.unitPrice)} each -{" "}
                      {item.quantityAvailable} available
                    </p>
                  </div>

                  <StorefrontLabel className="h-fit text-xs uppercase tracking-[0.1em] text-stone-500">
                    Qty
                    <StorefrontInput
                      className="text-center"
                      inputMode="numeric"
                      max={item.quantityAvailable}
                      min={0}
                      onChange={(event) =>
                        updateQuantity(
                          key,
                          event.target.value,
                        )
                      }
                      step={1}
                      type="number"
                      value={item.quantity}
                    />
                  </StorefrontLabel>

                  <div className="flex items-start justify-between gap-3 md:grid md:justify-items-end">
                    <p className="font-semibold text-stone-950">
                      {formatCurrency(item.quantity * item.unitPrice)}
                    </p>
                    <StorefrontTextButton
                      onClick={() => removeItem(key)}
                    >
                      Remove
                    </StorefrontTextButton>
                  </div>
                </article>
              );
            })}
          </div>

          <StorefrontSummaryCard className="lg:sticky lg:top-28">
            <p className="storefront-primary-color text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
              Order summary
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950">
              Ready for checkout
            </h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <SummaryRow label="Items" value={String(summary.totalQuantity)} />
              <SummaryRow
                label="Estimated total"
                value={formatCurrency(summary.subtotal)}
              />
            </dl>
            <p className="mt-4 rounded-lg bg-[#fbf7ef] p-3 text-sm leading-6 text-stone-600">
              Final availability is checked again before your order is placed.
            </p>
            <div className="mt-5 grid gap-2">
              <StorefrontButton href={`/store/${store.store_slug}/checkout`}>
                Checkout
              </StorefrontButton>
              <StorefrontButton
                href={`/store/${store.store_slug}`}
                variant="secondary"
              >
                Continue shopping
              </StorefrontButton>
            </div>
          </StorefrontSummaryCard>
        </div>
      )}
    </StorefrontPage>
  );
}

function CartPanel({ children }: { children: React.ReactNode }) {
  return (
    <StorefrontCard>
      {children}
    </StorefrontCard>
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
  if (!availableDate) return "Available now";

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
