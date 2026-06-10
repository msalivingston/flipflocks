"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import {
  readStorefrontCart,
  summarizeStorefrontCart,
} from "./_components/storefront-cart-client";

export function StorefrontHeaderCartLink({ storeSlug }: { storeSlug: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const cart = readStorefrontCart(storeSlug);
      setCount(summarizeStorefrontCart(cart.items).totalQuantity);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [storeSlug]);

  return (
    <Link
      aria-label={`Cart${count > 0 ? `, ${count} items` : ""}`}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
      href={`/store/${storeSlug}/cart`}
    >
      <ShoppingCart aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
      <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#073f1e] px-1 text-[0.68rem] font-bold leading-none text-white">
        {count}
      </span>
    </Link>
  );
}
