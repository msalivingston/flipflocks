import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo-config";

export const metadata: Metadata = {
  robots: NOINDEX_ROBOTS,
};

export default function DevLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
