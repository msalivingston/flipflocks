"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
    <div className="min-h-screen bg-[#fbfaf6] text-stone-950 lg:grid lg:grid-cols-[320px_1fr]">
      <aside className="hidden border-r border-stone-200/80 bg-white lg:flex lg:min-h-screen lg:flex-col">
        <div className="px-8 pb-7 pt-10">
          <Link className="block w-fit" href="/">
            <Image
              src="/branding/logo.png"
              alt="FlockFront"
              width={246}
              height={82}
              priority
            />
          </Link>
          <div className="mt-7">
            <p className="truncate text-2xl font-bold text-stone-950">
              {seller.store_name}
            </p>
            <span className="mt-3 inline-flex items-center gap-3 text-sm font-semibold text-emerald-800">
              <span className="size-3 rounded-full bg-green-500" />
              {isLive ? "Storefront is live" : "Storefront not live"}
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-3 px-5">
          <SellerNavLinks />
        </nav>

        <div className="space-y-3 border-t border-stone-200 px-8 py-5">
          <div className="flex items-center gap-3 rounded-xl px-1 py-2">
            <NavGlyph src="/glyphs/storefront.png" alt="" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-stone-950">
                {seller.store_slug}
              </p>
              <p className="text-xs font-medium text-stone-500">Store slug</p>
            </div>
          </div>
          <a
            className="flex min-h-10 items-center gap-3 rounded-xl px-1 text-sm font-medium text-stone-950 transition hover:text-emerald-800"
            href={`mailto:${SUPPORT_EMAIL}`}
          >
            <NavGlyph src="/glyphs/chat.png" alt="" />
            Contact support
          </a>
          <button
            className="flex min-h-10 items-center gap-3 rounded-xl px-1 text-sm font-medium text-stone-950 transition hover:text-emerald-800"
            onClick={handleSignOut}
          >
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center text-lg leading-none"
            >
              -&gt;
            </span>
            Sign out
          </button>
          <Link className="seller-small-button mt-2 w-full" href={storefrontHref}>
            View Storefront
          </Link>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link className="shrink-0" href="/dashboard">
                <Image
                  src="/branding/logo.png"
                  alt="FlockFront"
                  width={132}
                  height={44}
                  priority
                />
              </Link>
              <div className="min-w-0">
                <p className="truncate text-xs text-stone-600">
                  {seller.store_name}
                </p>
              </div>
            </div>
            <Link className="seller-small-button" href={storefrontHref}>
              Storefront
            </Link>
          </div>
        </header>

        <main className="flex-1 pb-24 lg:pb-0">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-30 flex gap-1 overflow-x-auto border-t border-stone-200/80 bg-white px-2 py-2 shadow-[0_-8px_20px_rgba(67,55,38,0.08)] lg:hidden">
          <MobileSellerNavLinks />
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
        className={`flex min-h-[72px] items-center gap-4 rounded-xl px-4 text-lg font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2 focus:ring-offset-white ${
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
        className={`flex min-w-24 flex-col items-center gap-1 rounded-xl px-2 py-2 text-center text-xs font-semibold ${
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
    <span className="flex size-8 shrink-0 items-center justify-center">
      <Image src={src} alt={alt} width={26} height={26} />
    </span>
  );
}
