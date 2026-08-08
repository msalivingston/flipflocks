import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo-config";
import { SellerAppShell } from "./_components/seller-app-shell";

export const metadata: Metadata = {
  robots: NOINDEX_ROBOTS,
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SellerAppShell>{children}</SellerAppShell>;
}
