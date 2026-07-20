"use client";

import { useState } from "react";
import Link from "next/link";
import { StorefrontGlyph } from "./storefront-ui";

export function StorefrontMobileMenu({ storeSlug }: { storeSlug: string }) {
  const [isOpen, setIsOpen] = useState(false);

  function closeMenu() {
    setIsOpen(false);
  }

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-label="Open storefront menu"
        className="storefront-primary-color inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 lg:hidden"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span aria-hidden="true" className="grid gap-[0.22rem]">
          <span className="block h-0.5 w-[1.15rem] rounded-full bg-current" />
          <span className="block h-0.5 w-[1.15rem] rounded-full bg-current" />
          <span className="block h-0.5 w-[1.15rem] rounded-full bg-current" />
        </span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close storefront menu"
            className="absolute inset-0 cursor-default bg-stone-950/35"
            onClick={closeMenu}
            type="button"
          />
          <div
            aria-label="Storefront menu"
            aria-modal="true"
            className="absolute inset-x-3 top-3 rounded-lg border border-[#ded7c8] bg-white p-3 shadow-xl"
            role="dialog"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#eee6d8] pb-2">
              <p className="storefront-heading-color text-sm font-semibold text-[#073f1e]">
                Storefront menu
              </p>
              <button
                aria-label="Close storefront menu"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                onClick={closeMenu}
                type="button"
              >
                <span aria-hidden="true" className="text-2xl leading-none">
                  x
                </span>
              </button>
            </div>
            <nav className="mt-2 grid gap-1 text-base font-semibold text-stone-900">
              <Link
                className="flex min-h-11 items-center gap-3 rounded-md px-2.5 hover:bg-[#f8f3ea] focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                href={`/store/${storeSlug}/about`}
                onClick={closeMenu}
              >
                <StorefrontGlyph className="h-5 w-5" src="/glyphs/farmhouse.png" />
                About
              </Link>
              <Link
                className="flex min-h-11 items-center gap-3 rounded-md px-2.5 hover:bg-[#f8f3ea] focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                href={`/store/${storeSlug}/policies`}
                onClick={closeMenu}
              >
                <StorefrontGlyph className="h-5 w-5" src="/glyphs/map-pin.png" />
                Pickup & Policies
              </Link>
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
