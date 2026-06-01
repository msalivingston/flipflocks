"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
  StatusBadge,
} from "../_components/seller-ui";

type AccountUser = {
  email: string | null;
  name: string | null;
};

type BillingStatus = {
  store_id: string;
  billing_plan: string | null;
  subscription_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  storefront_access_until: string | null;
  trial_ends_at: string | null;
};

export function SellerAccount() {
  const { seller } = useSellerContext();
  const [accountUser, setAccountUser] = useState<AccountUser>({
    email: null,
    name: null,
  });
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadAccount() {
      if (!seller) return;

      setIsLoading(true);
      setLoadError(null);

      const [userResult, billingResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("seller_billing_status")
          .select(
            "store_id, billing_plan, subscription_status, current_period_start, current_period_end, storefront_access_until, trial_ends_at",
          )
          .eq("store_id", seller.store_id)
          .maybeSingle()
          .returns<BillingStatus>(),
      ]);

      if (!isMounted) return;

      if (userResult.error) {
        setLoadError(userResult.error.message);
        setIsLoading(false);
        return;
      }

      if (billingResult.error) {
        setLoadError(billingResult.error.message);
        setIsLoading(false);
        return;
      }

      const user = userResult.data.user;

      setAccountUser({
        email: user?.email ?? null,
        name: getUserName(user?.user_metadata),
      });
      setBillingStatus(billingResult.data ?? null);
      setIsLoading(false);
    }

    void loadAccount();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const billing = useMemo(
    () => ({
      plan: billingStatus?.billing_plan ?? seller?.billing_plan ?? null,
      status:
        billingStatus?.subscription_status ??
        seller?.subscription_status ??
        null,
      currentPeriodStart: billingStatus?.current_period_start ?? null,
      currentPeriodEnd: billingStatus?.current_period_end ?? null,
      trialEndsAt:
        billingStatus?.trial_ends_at ?? seller?.trial_ends_at ?? null,
      storefrontAccessUntil:
        billingStatus?.storefront_access_until ??
        seller?.storefront_access_until ??
        null,
    }),
    [billingStatus, seller],
  );

  if (isLoading) {
    return (
      <>
        <SellerPageHeader
          title="Account"
          description="View your seller account, store ownership, and subscription status."
        />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <LoadingState label="Loading account" />
        </div>
      </>
    );
  }

  if (loadError || !seller) {
    return (
      <>
        <SellerPageHeader title="Account" />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <ErrorState message={loadError ?? "Account could not be loaded."} />
        </div>
      </>
    );
  }

  return (
    <>
      <SellerPageHeader
        eyebrow={seller.store_name}
        title="Account"
        description="Read-only account and subscription details for this seller workspace."
      />

      <main className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 sm:px-7 lg:grid-cols-[1fr_1fr]">
        <SellerCard>
          <div className="grid gap-5 p-5">
            <SectionIntro
              description="Basic identity details from the current authenticated session."
              title="Account"
            />
            <InfoGrid>
              <InfoItem label="Account email" value={accountUser.email} />
              <InfoItem label="User name" value={accountUser.name} />
            </InfoGrid>
          </div>
        </SellerCard>

        <SellerCard>
          <div className="grid gap-5 p-5">
            <SectionIntro
              description="Store ownership and role details for this workspace."
              title="Store Access"
            />
            <InfoGrid>
              <InfoItem label="Store name" value={seller.store_name} />
              <InfoItem label="Store role" value={formatValue(seller.role)} />
              <InfoItem label="Store status" value={seller.store_status}>
                <StatusBadge status={seller.store_status} />
              </InfoItem>
              <InfoItem
                label="Public storefront"
                value={
                  seller.is_publicly_available
                    ? "Publicly available"
                    : "Not publicly available"
                }
              >
                <StatusBadge
                  status={seller.is_publicly_available ? "live" : "hidden"}
                />
              </InfoItem>
            </InfoGrid>
          </div>
        </SellerCard>

        <SellerCard className="lg:col-span-2">
          <div className="grid gap-5 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <SectionIntro
                description="V1 shows subscription data that already exists. Billing management is not available here yet."
                title="Subscription"
              />
              <StatusBadge status={billing.status ?? "not_configured"} />
            </div>
            <InfoGrid>
              <InfoItem label="Subscription status" value={billing.status} />
              <InfoItem label="Plan name" value={billing.plan} />
              <InfoItem
                label="Subscription start date"
                value={formatDateTime(billing.currentPeriodStart)}
              />
              <InfoItem
                label="Renewal/end date"
                value={
                  formatDateTime(billing.currentPeriodEnd) ??
                  formatDateTime(billing.storefrontAccessUntil)
                }
              />
              <InfoItem
                label="Trial status"
                value={getTrialStatus(billing.status, billing.trialEndsAt)}
              />
              <InfoItem
                label="Trial end date"
                value={formatDateTime(billing.trialEndsAt)}
              />
              <InfoItem
                label="Billing contact email"
                value={null}
                placeholder="Not configured"
              />
            </InfoGrid>
          </div>
        </SellerCard>
      </main>
    </>
  );
}

function SectionIntro({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">{description}</p>
    </div>
  );
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>;
}

function InfoItem({
  children,
  label,
  placeholder = "Not available",
  value,
}: {
  children?: React.ReactNode;
  label: string;
  placeholder?: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-2 text-sm font-semibold text-stone-950">
        {children ?? value ?? placeholder}
      </dd>
    </div>
  );
}

function getUserName(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;

  const record = metadata as Record<string, unknown>;
  const candidate =
    record.full_name ??
    record.name ??
    record.display_name ??
    record.user_name;

  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function formatValue(value: string | null | undefined) {
  if (!value) return null;
  return value.replaceAll("_", " ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getTrialStatus(
  subscriptionStatus: string | null | undefined,
  trialEndsAt: string | null | undefined,
) {
  if (subscriptionStatus === "trialing") {
    const formattedTrialEnd = formatDateTime(trialEndsAt);
    return formattedTrialEnd ? `Trialing until ${formattedTrialEnd}` : "Trialing";
  }

  if (trialEndsAt) return "Trial ended";

  return null;
}
