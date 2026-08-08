import type { Metadata } from "next";
import { loadSellerSignupsEnabled } from "@/lib/platform-settings";
import { PricingPageClient } from "./pricing-page-client";
import { buildPublicMetadata } from "@/lib/public-metadata";

export const metadata: Metadata = buildPublicMetadata({
  canonicalPath: "/pricing",
  title: "Seller Plans and Pricing | FlockFront",
  description:
    "Compare FlockFront Coop and Market plans for poultry storefronts, listings, customer records, and order management.",
});

export default async function PricingPage() {
  const sellerSignupsEnabled = await loadSellerSignupsEnabled();

  return <PricingPageClient sellerSignupsEnabled={sellerSignupsEnabled} />;
}
