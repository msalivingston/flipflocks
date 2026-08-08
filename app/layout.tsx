import type { Metadata } from "next";
import {
  INDEXING_ENABLED,
  NOINDEX_ROBOTS,
  PRODUCTION_ORIGIN,
} from "@/lib/seo-config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(PRODUCTION_ORIGIN),
  title: "FlockFront",
  description: "Independent poultry storefronts for local pickup.",
  robots: INDEXING_ENABLED ? undefined : NOINDEX_ROBOTS,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
