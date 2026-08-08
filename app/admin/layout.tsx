import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo-config";
import { AdminAppShell } from "./_components/admin-app-shell";

export const metadata: Metadata = {
  robots: NOINDEX_ROBOTS,
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminAppShell>{children}</AdminAppShell>;
}
