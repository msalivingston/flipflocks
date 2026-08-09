"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  readStorefrontCart,
  summarizeStorefrontCart,
  storefrontCartChangedEvent,
} from "./_components/storefront-cart-client";
import { StorefrontGlyph } from "./storefront-ui";

export function StorefrontHeaderCartLink({ storeSlug }: { storeSlug: string }) {
  const count = useStorefrontCartCount(storeSlug);

  return (
    <Link
      aria-label={`Cart${count > 0 ? `, ${count} items` : ""}`}
      className="storefront-primary-color relative inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 lg:h-11 lg:w-11"
      href={`/store/${storeSlug}/cart`}
    >
      <StorefrontGlyph className="h-5 w-5 lg:h-7 lg:w-7" src="/glyphs/cart.png" />
      <span className="storefront-primary-bg absolute right-0 top-0 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.62rem] font-bold leading-none text-white lg:-right-1 lg:-top-1 lg:h-6 lg:min-w-6 lg:text-[0.68rem]">
        {count}
      </span>
    </Link>
  );
}

export function StorefrontFocusedOrderActions({
  cartHref,
  checkoutHref,
  storeSlug,
}: {
  cartHref: string;
  checkoutHref: string;
  storeSlug: string;
}) {
  const count = useStorefrontCartCount(storeSlug);

  return (
    <nav
      aria-label="Order actions"
      className="flex shrink-0 items-center gap-1.5 sm:gap-2"
    >
      <Link
        aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
        className="storefront-primary-border storefront-primary-color inline-flex min-h-10 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-bold text-[#073f1e] transition hover:bg-[#f8f3ea] focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 sm:px-3 sm:text-sm"
        href={cartHref}
      >
        <StorefrontGlyph className="h-4 w-4 sm:h-5 sm:w-5" src="/glyphs/cart.png" />
        Cart
        <span className="storefront-primary-bg inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.68rem] font-bold leading-none text-white">
          {count}
        </span>
      </Link>
      <Link
        className="storefront-primary-button inline-flex min-h-10 items-center justify-center rounded-md px-2.5 text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 sm:px-3 sm:text-sm"
        href={checkoutHref}
      >
        Checkout
      </Link>
    </nav>
  );
}

function useStorefrontCartCount(storeSlug: string) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    function updateCount() {
      const cart = readStorefrontCart(storeSlug);
      setCount(summarizeStorefrontCart(cart.items).totalQuantity);
    }

    function handleCartChanged(event: Event) {
      const detail = (event as CustomEvent<{ storeSlug?: string }>).detail;

      if (!detail?.storeSlug || detail.storeSlug === storeSlug) {
        updateCount();
      }
    }

    const timeout = window.setTimeout(() => {
      updateCount();
    }, 0);

    window.addEventListener(storefrontCartChangedEvent, handleCartChanged);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener(storefrontCartChangedEvent, handleCartChanged);
    };
  }, [storeSlug]);

  return count;
}
