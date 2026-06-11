"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const adminNavItems = [
  { label: "Stores", href: "/admin/stores" },
  { label: "Breeds", href: "/admin/breeds" },
];

export function AdminAppShell({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      if (!isMounted) return;
      setEmail(data.user?.email ?? null);
    }

    void loadUser();

    return () => {
      isMounted = false;
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-stone-100 text-stone-950 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden border-r border-stone-200 bg-white lg:flex lg:min-h-screen lg:flex-col">
        <div className="border-b border-stone-200 px-5 py-5">
          <Link href="/" className="text-lg font-bold text-stone-950">
            FlipFlocks
          </Link>
          <p className="mt-1 text-sm font-semibold text-emerald-900">
            Platform Admin
          </p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          <AdminNavLinks />
        </nav>

        <div className="border-t border-stone-200 px-5 py-4">
          <p className="truncate text-xs font-semibold text-stone-500">
            {email ?? "Signed out"}
          </p>
          <button className="seller-small-button mt-3" onClick={signOut}>
            Sign Out
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-stone-200 bg-white lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <Link href="/admin" className="font-bold text-stone-950">
                FlipFlocks
              </Link>
              <p className="text-xs font-semibold text-emerald-900">
                Platform Admin
              </p>
            </div>
            <button className="seller-small-button" onClick={signOut}>
              Sign Out
            </button>
          </div>
          <nav className="flex gap-2 overflow-x-auto border-t border-stone-100 px-3 py-2">
            <AdminNavLinks compact />
          </nav>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function AdminNavLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();

  return adminNavItems.map((item) => {
    const isActive = pathname.startsWith(item.href);

    return (
      <Link
        className={`block rounded-md px-3 py-2 text-sm font-semibold transition ${
          compact ? "min-w-24 text-center text-xs" : ""
        } ${
          isActive
            ? "bg-emerald-50 text-emerald-900"
            : "text-stone-700 hover:bg-stone-100 hover:text-stone-950"
        }`}
        href={item.href}
        key={item.href}
      >
        {item.label}
      </Link>
    );
  });
}
