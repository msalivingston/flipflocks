"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { isCurrentUserPlatformAdmin } from "../_lib/admin-auth";

const adminNavItems = [
  { label: "Stores", href: "/admin/stores" },
  { label: "FAQs", href: "/admin/faqs" },
  { label: "Breeds", href: "/admin/breeds" },
];

export function AdminAppShell({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [authState, setAuthState] = useState<"checking" | "allowed">(
    "checking",
  );
  const pathname = usePathname();
  const router = useRouter();
  const isLoginRoute = pathname === "/admin/login";

  useEffect(() => {
    let isMounted = true;

    async function loadAdminUser() {
      if (isLoginRoute) {
        setAuthState("allowed");
        return;
      }

      setAuthState("checking");

      const { data, error } = await supabase.auth.getUser();
      if (!isMounted) return;

      if (error || !data.user) {
        router.replace("/admin/login");
        return;
      }

      const isAdmin = await isCurrentUserPlatformAdmin();
      if (!isMounted) return;

      if (!isAdmin) {
        await supabase.auth.signOut();
        router.replace(
          "/admin/login?error=platform-admin-required",
        );
        return;
      }

      setEmail(data.user?.email ?? null);
      setAuthState("allowed");
    }

    void loadAdminUser();

    return () => {
      isMounted = false;
    };
  }, [isLoginRoute, router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  if (isLoginRoute) {
    return <>{children}</>;
  }

  if (authState === "checking") {
    return (
      <main className="min-h-screen bg-stone-100 p-5 text-stone-950">
        <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm font-semibold text-stone-600">
          Checking platform admin access...
        </div>
      </main>
    );
  }

  return (
    <div className="platform-admin-shell min-h-screen bg-[#f2f6f3] text-stone-950 lg:grid lg:grid-cols-[260px_1fr]">
      <style>{`
        .platform-admin-shell .seller-primary-button {
          background: #145447;
          box-shadow: 0 1px 0 rgba(15, 51, 43, 0.08);
        }

        .platform-admin-shell .seller-primary-button:hover {
          background: #0f3f35;
        }

        .platform-admin-shell .seller-secondary-button,
        .platform-admin-shell .seller-small-button {
          border-color: #b8d3ca;
          color: #16483d;
        }

        .platform-admin-shell .seller-secondary-button:hover,
        .platform-admin-shell .seller-small-button:hover {
          border-color: #7eab9d;
          background: #eef7f3;
          color: #0f332b;
        }
      `}</style>
      <aside className="hidden border-r border-[#17483d] bg-[#0f332b] text-white shadow-[inset_-1px_0_0_rgba(255,255,255,0.06)] lg:flex lg:min-h-screen lg:flex-col">
        <div className="border-b border-white/10 px-5 py-5">
          <Link href="/admin" className="text-lg font-bold text-white">
            FlockFront Platform Admin
          </Link>
          <p className="mt-1 inline-flex rounded-full border border-[#7fc8b2]/25 bg-[#163f35] px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[#a8dfd1]">
            Internal operations
          </p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          <AdminNavLinks />
        </nav>

        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-xs font-semibold text-[#b8d8cf]">
            {email ?? "Signed out"}
          </p>
          <button className="seller-small-button mt-3" onClick={signOut}>
            Sign Out
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-[#bdd5cd] bg-white lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <Link href="/admin" className="font-bold text-stone-950">
                FlockFront Platform Admin
              </Link>
              <p className="text-xs font-semibold text-[#1b5b4d]">
                Internal operations
              </p>
            </div>
            <button className="seller-small-button" onClick={signOut}>
              Sign Out
            </button>
          </div>
          <nav className="flex gap-2 overflow-x-auto border-t border-[#dce8e3] px-3 py-2">
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
            ? compact
              ? "bg-[#dff3ec] text-[#11473c] ring-1 ring-[#a8d8ca]"
              : "bg-[#1b5b4d] text-white shadow-sm ring-1 ring-[#79baa8]/40"
            : compact
              ? "text-stone-700 hover:bg-[#eef7f3] hover:text-[#11473c]"
              : "text-[#d7ebe4] hover:bg-white/10 hover:text-white"
        }`}
        href={item.href}
        key={item.href}
      >
        {item.label}
      </Link>
    );
  });
}
