import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo-config";

export const metadata: Metadata = { robots: NOINDEX_ROBOTS };

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
