"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
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
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 lg:h-11 lg:w-11"
      href={`/store/${storeSlug}/cart`}
    >
      <Image
        alt=""
        aria-hidden="true"
        className="h-6 w-6 object-contain lg:h-7 lg:w-7"
        height={128}
        src="/glyphs/cart.png"
        unoptimized
        width={128}
      />
      <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#073f1e] px-1 text-[0.68rem] font-bold leading-none text-white lg:h-6 lg:min-w-6">
        {count}
      </span>
    </Link>
  );
}
