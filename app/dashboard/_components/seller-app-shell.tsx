"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { SellerContextProvider, useSellerContext } from "./seller-context";
import { ErrorState, LoadingState } from "./seller-ui";

const sellerNavItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Listings", href: "/dashboard/listings" },
  { label: "Inventory", href: "/dashboard/inventory" },
  { label: "Orders", href: "/dashboard/orders" },
  { label: "Customers", href: "/dashboard/customers" },
  { label: "Reports", href: "/dashboard/reports" },
  { label: "Store Admin", href: "/dashboard/store-admin" },
  { label: "Account", href: "/dashboard/account" },
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
      <main className="min-h-screen bg-stone-100 p-5">
        <LoadingState label="Loading seller workspace" />
      </main>
    );
  }

  if (error || !seller) {
    return (
      <main className="min-h-screen bg-stone-100 p-5">
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

  return (
    <div className="min-h-screen bg-stone-100 text-stone-950 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden border-r border-stone-200 bg-white lg:flex lg:min-h-screen lg:flex-col">
        <div className="border-b border-stone-200 px-5 py-5">
          <Link href="/" className="text-lg font-bold text-stone-950">
            FlipFlocks
          </Link>
          <p className="mt-1 text-sm text-stone-600">{seller.store_name}</p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          <SellerNavLinks />
        </nav>

        <div className="border-t border-stone-200 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
            Store
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-stone-950">
            {seller.store_slug}
          </p>
          <div className="mt-3 flex gap-2">
            <Link
              className="seller-small-button"
              href={`/store/${seller.store_slug}`}
            >
              View Store
            </Link>
            <button className="seller-small-button" onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-stone-200 bg-white lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <Link href="/dashboard" className="font-bold text-stone-950">
                FlipFlocks
              </Link>
              <p className="truncate text-xs text-stone-600">
                {seller.store_name}
              </p>
            </div>
            <Link
              className="seller-small-button"
              href={`/store/${seller.store_slug}`}
            >
              View Store
            </Link>
          </div>
        </header>

        <main className="flex-1 pb-20 lg:pb-0">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-30 flex gap-1 overflow-x-auto border-t border-stone-200 bg-white px-2 py-2 shadow-[0_-8px_20px_rgba(28,25,23,0.08)] lg:hidden">
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
        className={`block rounded-md px-3 py-2 text-sm font-semibold transition ${
          isActive
            ? "bg-emerald-50 text-emerald-900"
            : "text-stone-700 hover:bg-stone-100 hover:text-stone-950"
        }`}
      >
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
        className={`min-w-24 rounded-md px-2 py-2 text-center text-xs font-semibold ${
          isActive ? "bg-emerald-50 text-emerald-900" : "text-stone-600"
        }`}
      >
        {item.label}
      </Link>
    );
  });
}
