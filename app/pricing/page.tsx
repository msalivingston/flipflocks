import type { Metadata } from "next";
import { loadSellerSignupsEnabled } from "@/lib/platform-settings";
import { PricingPageClient } from "./pricing-page-client";

export const metadata: Metadata = {
  title: "Pricing | FlockFront",
  description:
    "Simple FlockFront pricing for poultry sellers: Coop and Market plans.",
};

export default async function PricingPage() {
  const sellerSignupsEnabled = await loadSellerSignupsEnabled();

  return <PricingPageClient sellerSignupsEnabled={sellerSignupsEnabled} />;
}
