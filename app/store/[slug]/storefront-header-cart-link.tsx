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

  return (
    <Link
      aria-label={`Cart${count > 0 ? `, ${count} items` : ""}`}
      className="storefront-primary-color relative inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 lg:h-11 lg:w-11"
      href={`/store/${storeSlug}/cart`}
    >
      <StorefrontGlyph className="h-6 w-6 lg:h-7 lg:w-7" src="/glyphs/cart.png" />
      <span className="storefront-primary-bg absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.68rem] font-bold leading-none text-white lg:h-6 lg:min-w-6">
        {count}
      </span>
    </Link>
  );
}
