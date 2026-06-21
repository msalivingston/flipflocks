"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { SellerContextProvider, useSellerContext } from "./seller-context";
import { ErrorState, LoadingState } from "./seller-ui";

const SUPPORT_EMAIL = "support@flipflocks.com";

const sellerNavItems = [
  { label: "Dashboard", href: "/dashboard", glyph: "/glyphs/farmhouse.png" },
  {
    label: "Orders",
    href: "/dashboard/orders",
    glyph: "/glyphs/shopping-bag.png",
  },
  {
    label: "Inventory",
    href: "/dashboard/inventory",
    glyph: "/glyphs/egg-carton.png",
  },
  { label: "Breeds", href: "/dashboard/breeds", glyph: "/glyphs/hen.png" },
  {
    label: "Customers",
    href: "/dashboard/customers",
    glyph: "/glyphs/customers.png",
  },
  { label: "Reports", href: "/dashboard/reports", glyph: "/glyphs/reports.png" },
  {
    label: "Store Admin",
    href: "/dashboard/store-admin",
    glyph: "/glyphs/storefront.png",
  },
  { label: "Account", href: "/dashboard/account", glyph: "/glyphs/person.png" },
];

export function SellerAppShell({ children }: { children: React.ReactNode }) {
  return (
    <SellerContextProvider>
      <SellerShellContent>{children}</SellerShellContent>
    </SellerContextProvider>
  );
}

function SellerShellContent({ children }: { children: React.ReactNode }) {
  const { seller, isLoading, error, reload } = useSellerContext();
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#fbfaf6] p-5">
        <LoadingState label="Loading seller workspace" />
      </main>
    );
  }

  if (error || !seller) {
    return (
      <main className="min-h-screen bg-[#fbfaf6] p-5">
        <ErrorState
          message={error ?? "Seller context could not be loaded."}
          action={
            <button className="seller-secondary-button" onClick={reload}>
              Try again
            </button>
          }
        />
      </main>
    );
  }

  const storefrontHref = `/store/${seller.store_slug}`;
  const isLive = seller.is_publicly_available;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#fbfaf6] text-stone-950 lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="hidden border-r border-stone-200/80 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="px-3.5 pb-2 pt-3">
          <Link className="block w-fit" href="/">
            <Image
              src="/branding/flockfront-logo.png"
              alt="FlockFront"
              width={164}
              height={69}
              priority
            />
          </Link>
          <div className="mt-1.5">
            <p className="truncate text-base font-bold text-stone-950">
              {seller.store_name}
            </p>
            <span className="mt-0.5 inline-flex items-center gap-2 text-xs font-semibold text-emerald-800">
              <span className="size-2 rounded-full bg-green-500" />
              {isLive ? "Storefront is live" : "Storefront not live"}
            </span>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5">
          <SellerNavLinks />
        </nav>

        <div className="sticky bottom-0 shrink-0 space-y-1 border-t border-stone-200 bg-white px-3 py-2.5">
          <div className="flex items-center gap-2.5 rounded-xl px-1 py-0.5">
            <NavGlyph src="/glyphs/storefront.png" alt="" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-stone-950">
                {seller.store_slug}
              </p>
              <p className="text-xs font-medium text-stone-500">Store URL</p>
            </div>
          </div>
          <a
            className="flex min-h-8 items-center gap-2 rounded-xl px-1 text-xs font-medium text-stone-950 transition hover:text-emerald-800"
            href={`mailto:${SUPPORT_EMAIL}`}
          >
            <NavGlyph src="/glyphs/chat.png" alt="" />
            Contact support
          </a>
          <button
            className="flex min-h-8 items-center gap-2 rounded-xl px-1 text-xs font-medium text-stone-950 transition hover:text-emerald-800"
            onClick={handleSignOut}
          >
            <LogOut aria-hidden="true" className="size-5 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <Link className="shrink-0" href="/dashboard">
                <Image
                  src="/branding/flockfront-logo.png"
                  alt="FlockFront"
                  width={132}
                  height={44}
                  className="h-auto w-[132px] max-[360px]:w-28"
                  priority
                />
              </Link>
              <div className="min-w-0">
                <p className="truncate text-xs text-stone-600">
                  {seller.store_name}
                </p>
              </div>
            </div>
            <Link
              className="seller-small-button shrink-0"
              href={storefrontHref}
              rel="noopener noreferrer"
              target="_blank"
            >
              Storefront
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden pb-[calc(5.75rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>

        <nav
          aria-label="Seller navigation"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/80 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_20px_rgba(67,55,38,0.08)] lg:hidden"
        >
          <div className="overflow-x-auto px-2 py-1.5 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-1">
              <MobileSellerNavLinks />
            </div>
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-9 bg-gradient-to-l from-white via-white/90 to-white/0"
          />
        </nav>
      </div>
    </div>
  );
}

function SellerNavLinks() {
  const pathname = usePathname();

  return sellerNavItems.map((item) => {
    const isActive =
      item.href === "/dashboard"
        ? pathname === item.href
        : pathname.startsWith(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex min-h-8 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2 focus:ring-offset-white ${
          isActive
            ? "bg-[#f0f5ea] text-emerald-950"
            : "text-stone-950 hover:bg-[#f7faf3] hover:text-emerald-950"
        }`}
      >
        <NavGlyph src={item.glyph} alt="" />
        {item.label}
      </Link>
    );
  });
}

function MobileSellerNavLinks() {
  const pathname = usePathname();

  return sellerNavItems.map((item) => {
    const isActive =
      item.href === "/dashboard"
        ? pathname === item.href
        : pathname.startsWith(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex min-h-14 min-w-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-center text-[0.7rem] font-semibold leading-tight ${
          isActive ? "bg-emerald-100 text-emerald-950" : "text-stone-600"
        }`}
      >
        <NavGlyph src={item.glyph} alt="" />
        {item.label}
      </Link>
    );
  });
}

function NavGlyph({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <Image src={src} alt={alt} width={18} height={18} />
    </span>
  );
}
