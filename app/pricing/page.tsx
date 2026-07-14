import type { Metadata } from "next";
import { PricingPageClient } from "./pricing-page-client";

export const metadata: Metadata = {
  title: "Pricing | FlockFront",
  description:
    "Simple FlockFront pricing for poultry sellers: Coop and Market plans.",
};

export default function PricingPage() {
  return <PricingPageClient />;
}
