"use client";

import Link from "next/link";
import { getBillingBanner } from "@/lib/saas-billing-status";
import { useSellerBillingStatus } from "./seller-billing-context";

export function SellerBillingBanner() {
  const { status } = useSellerBillingStatus();
  const banner = status ? getBillingBanner(status) : null;
  if (!banner) return null;

  const classes = banner.tone === "critical"
    ? "border-red-300 bg-red-50 text-red-950"
    : banner.tone === "attention"
      ? "border-amber-300 bg-amber-50 text-amber-950"
      : "border-sky-300 bg-sky-50 text-sky-950";

  return (
    <aside className={`border-b px-5 py-3 sm:px-7 ${classes}`} aria-label="Billing notice">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between">
        <p role="status">{banner.message}</p>
        <Link className="min-h-10 shrink-0 content-center underline underline-offset-4" href="/dashboard/account">
          View billing status
        </Link>
      </div>
    </aside>
  );
}
