"use client";

import { useEffect, useMemo, useState } from "react";
import {
  StorefrontCart,
  cartItemKey,
  clearStorefrontCart,
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
  const [isClearCartConfirmOpen, setIsClearCartConfirmOpen] = useState(false);

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

  function stepQuantity(itemKey: string, quantity: number, delta: number) {
    const nextQuantity = quantity + delta;
    const nextCart = updateStorefrontCartItemQuantity(
      store.store_slug,
      itemKey,
      nextQuantity,
    );

    setCart(nextCart);
  }

  function removeItem(itemKey: string) {
    setCart(removeStorefrontCartItem(store.store_slug, itemKey));
  }

  function clearCart() {
    clearStorefrontCart(store.store_slug);
    setCart(readStorefrontCart(store.store_slug));
    setIsClearCartConfirmOpen(false);
  }

  return (
    <StorefrontPage className="max-w-6xl gap-3 py-4 sm:gap-4 sm:py-8">
      <div className="rounded-xl border border-[#ded7c8] bg-white px-4 py-3 sm:p-4">
        <p className="storefront-primary-color text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
          Cart
        </p>
        <h1 className="mt-0.5 text-2xl font-semibold text-stone-950 sm:mt-1 sm:text-3xl">
          Your cart
        </h1>
        <p className="mt-0.5 text-sm leading-5 text-stone-600 sm:mt-1">
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
          <p className="mt-1.5 text-sm leading-5 text-stone-600">
            Add available options from the storefront to start an order.
          </p>
          <StorefrontButton className="mt-3 min-h-10" href={`/store/${store.store_slug}`}>
            Continue shopping
          </StorefrontButton>
        </CartPanel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_21rem] lg:items-start">
          <div className="grid gap-2.5">
            {items.map((item) => {
              const key = cartItemKey(item);

              return (
                <article
                  className="grid gap-2.5 rounded-xl border border-[#ded7c8] bg-white p-3 md:grid-cols-[1fr_7rem_5.75rem] md:items-center md:gap-3"
                  key={key}
                >
                  <div className="min-w-0">
                    {item.speciesName ? (
                      <p className="storefront-primary-color text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-emerald-700">
                        {item.speciesName}
                      </p>
                    ) : null}
                    <h2 className="mt-0.5 break-words text-base font-semibold leading-tight text-stone-950">
                      {item.productName}
                    </h2>
                    <p className="mt-0.5 break-words text-sm leading-5 text-stone-600">
                      {item.optionLabel}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-stone-600 sm:mt-1">
                      {formatCartAvailability(item.availableDate)} -{" "}
                      {formatCurrency(item.unitPrice)} each -{" "}
                      {item.quantityAvailable} available
                    </p>
                  </div>

                  <StorefrontLabel className="hidden h-fit gap-1 text-xs uppercase tracking-[0.1em] text-stone-500 md:grid">
                    Qty
                    <StorefrontInput
                      className="min-h-9 py-1 text-center text-sm"
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
                  <CartQuantityStepper
                    max={item.quantityAvailable}
                    onStep={(delta) => stepQuantity(key, item.quantity, delta)}
                    quantity={item.quantity}
                  />

                  <div className="flex items-center justify-between gap-3 md:grid md:items-start md:justify-items-end">
                    <p className="text-base font-semibold text-stone-950 md:text-sm">
                      {formatCurrency(item.quantity * item.unitPrice)}
                    </p>
                    <StorefrontTextButton
                      className="shrink-0"
                      onClick={() => removeItem(key)}
                    >
                      Remove
                    </StorefrontTextButton>
                  </div>
                </article>
              );
            })}
          </div>

          <StorefrontSummaryCard className="p-4 lg:sticky lg:top-28 lg:p-5">
            <p className="storefront-primary-color text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
              Order summary
            </p>
            <h2 className="mt-1 text-lg font-semibold text-stone-950 sm:mt-1.5 sm:text-xl">
              Ready for checkout
            </h2>
            <dl className="mt-2.5 grid gap-1 text-sm sm:mt-3 sm:gap-1.5">
              <SummaryRow label="Items" value={String(summary.totalQuantity)} />
              <SummaryRow
                label="Estimated total"
                value={formatCurrency(summary.subtotal)}
              />
            </dl>
            <p className="mt-2.5 rounded-lg bg-[#fbf7ef] px-3 py-2 text-xs leading-5 text-stone-600 sm:mt-3 sm:p-2.5">
              Final availability is checked again before your order is placed.
            </p>
            <div className="mt-3 grid gap-2">
              <StorefrontButton
                className="min-h-10"
                href={`/store/${store.store_slug}/checkout`}
              >
                Checkout
              </StorefrontButton>
              <div className="grid gap-2 min-[375px]:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
                <StorefrontButton
                  className="min-h-10 whitespace-nowrap px-1.5 text-[0.8125rem] min-[390px]:text-sm"
                  href={`/store/${store.store_slug}`}
                  variant="secondary"
                >
                  Continue shopping
                </StorefrontButton>
                <StorefrontButton
                  className="min-h-10 whitespace-nowrap px-1.5 text-[0.8125rem] min-[390px]:text-sm"
                  onClick={() => setIsClearCartConfirmOpen(true)}
                  variant="secondary"
                >
                  Clear cart
                </StorefrontButton>
              </div>
            </div>
          </StorefrontSummaryCard>
        </div>
      )}
      {isClearCartConfirmOpen ? (
        <ClearCartConfirmModal
          itemCount={summary.totalQuantity}
          onCancel={() => setIsClearCartConfirmOpen(false)}
          onConfirm={clearCart}
        />
      ) : null}
    </StorefrontPage>
  );
}

function CartQuantityStepper({
  max,
  onStep,
  quantity,
}: {
  max: number;
  onStep: (delta: number) => void;
  quantity: number;
}) {
  return (
    <div
      aria-label="Quantity"
      className="storefront-primary-color grid min-h-11 grid-cols-[3.25rem_minmax(0,1fr)_3.25rem] overflow-hidden rounded-md border border-stone-300 text-stone-950 md:hidden"
      role="group"
    >
      <button
        aria-label="Decrease quantity"
        className="flex min-h-11 items-center justify-center border-r border-stone-300 text-2xl leading-none transition hover:bg-[#fbf7ef] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700"
        onClick={() => onStep(-1)}
        type="button"
      >
        -
      </button>
      <div className="flex min-h-11 items-center justify-center px-3 text-base font-semibold">
        {quantity}
      </div>
      <button
        aria-label="Increase quantity"
        className="flex min-h-11 items-center justify-center border-l border-stone-300 text-2xl leading-none transition hover:bg-[#fbf7ef] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
        disabled={quantity >= max}
        onClick={() => onStep(1)}
        type="button"
      >
        +
      </button>
    </div>
  );
}

function ClearCartConfirmModal({
  itemCount,
  onCancel,
  onConfirm,
}: {
  itemCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 px-4"
      role="dialog"
    >
      <div className="w-full max-w-sm rounded-lg border border-[#ded7c8] bg-white p-4 shadow-xl">
        <h2 className="text-lg font-semibold text-stone-950">Clear cart?</h2>
        <p className="mt-2 text-sm leading-5 text-stone-600">
          This will remove {itemCount} item{itemCount === 1 ? "" : "s"} from
          your cart.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <StorefrontButton
            className="min-h-10 px-3 text-sm"
            onClick={onCancel}
            variant="secondary"
          >
            Keep cart
          </StorefrontButton>
          <StorefrontButton
            className="min-h-10 px-3 text-sm"
            onClick={onConfirm}
          >
            Clear cart
          </StorefrontButton>
        </div>
      </div>
    </div>
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
