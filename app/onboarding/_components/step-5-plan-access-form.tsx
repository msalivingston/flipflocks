"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getPlanPriceLabel,
  isSafeStripeCheckoutUrl,
  parseSellerBillingStatus,
  type SellerBillingStatus,
} from "@/lib/saas-billing-status";
import {
  PLAN_CAPABILITIES,
  type PlanId,
  normalizePlanId,
} from "@/lib/plan-capabilities";

type Step5PlanAccessFormProps = {
  initialBillingPlan?: string | null;
  initialPlanKey?: string | null;
  onBack: () => void;
  onComplete: (planKey: PlanId, billingPlan: BillingCadence) => void;
};

type BillingCadence = "monthly" | "yearly";

const planCards: Array<{
  badge?: string;
  cta: string;
  id: PlanId;
  includes: string[];
  purpose: string;
}> = [
  {
    id: "small_flock",
    cta: "Choose Coop",
    purpose: "For occasional sellers",
    includes: [
      "Up to 5 birds for sale at once",
      "Live poultry only",
      "Simple fixed pricing",
    ],
  },
  {
    id: "full_flock",
    badge: "Best for active sellers",
    cta: "Choose Market",
    purpose: "For active sellers",
    includes: [
      "Unlimited birds for sale",
      "All sale types (birds, eggs, products, equipment)",
      "Age-based pricing",
    ],
  },
];

export function Step5PlanAccessForm({
  initialBillingPlan,
  initialPlanKey,
  onBack,
  onComplete,
}: Step5PlanAccessFormProps) {
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(
    normalizePlanId(initialPlanKey),
  );
  const [selectedBillingPlan, setSelectedBillingPlan] =
    useState<BillingCadence>(normalizeBillingCadence(initialBillingPlan));
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [billingStatus, setBillingStatus] = useState<SellerBillingStatus | null>(null);

  useEffect(() => {
    let active = true;
    async function loadBillingMode() {
      const { data, error } = await supabase.rpc("seller_get_saas_billing_status");
      if (!active || error) return;
      setBillingStatus(parseSellerBillingStatus(Array.isArray(data) ? data[0] : null));
    }
    void loadBillingMode();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setFormError(null);
    setIsSubmitting(true);

    const { data, error } = await supabase.rpc("seller_save_onboarding_plan_access", {
      p_plan: {
        requested_billing_cadence: selectedBillingPlan,
        requested_plan_key: selectedPlan,
      },
    });

    if (error) {
      setFormError(friendlyPlanAccessError(error.message));
      setIsSubmitting(false);
      return;
    }

    const result = Array.isArray(data)
      ? data[0] as { billing_complete?: boolean; subscription_status?: string } | undefined
      : undefined;
    const checkoutRequired = result?.billing_complete === false
      && result.subscription_status === "dormant";

    if (checkoutRequired) {
      const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke(
        "stripe-saas-checkout",
        {
          body: {
            billing_cadence: selectedBillingPlan,
            plan_key: selectedPlan,
          },
        },
      );
      const checkoutUrl = checkoutData && typeof checkoutData === "object"
        ? (checkoutData as { checkout_url?: unknown }).checkout_url
        : null;
      if (checkoutError || !isSafeStripeCheckoutUrl(checkoutUrl)) {
        setFormError("Secure Checkout is not available right now. Your plan selection is saved; please try again.");
        setIsSubmitting(false);
        return;
      }
      window.location.assign(checkoutUrl);
      return;
    }

    onComplete(selectedPlan, selectedBillingPlan);
  }

  const selectedPlanDetails = PLAN_CAPABILITIES[selectedPlan];
  const checkoutEnabled = billingStatus?.checkout_enabled === true;
  const trialAlreadyUsed = billingStatus?.trial_eligibility === "trial_already_used";
  const selectedPrice = getPlanPriceLabel(selectedPlan, selectedBillingPlan);

  return (
    <section className="rounded-[0.95rem] bg-white px-4 py-4 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 lg:px-7">
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <div>
            <Link
              aria-label="Compare plans and features in the detailed feature table (opens in a new tab)"
              className="inline-flex min-h-11 items-center gap-2 rounded-md pr-3 text-base font-extrabold text-[#16572a] underline decoration-[#87b58c] decoration-2 underline-offset-4 transition hover:text-[#0f4822] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 sm:text-[17px] lg:hidden"
              href="/pricing#mobile-feature-comparison"
              rel="noopener noreferrer"
              target="_blank"
            >
              Compare plans and features
              <span aria-hidden="true" className="text-lg leading-none">
                ↗
              </span>
            </Link>
            <Link
              aria-label="Compare plans and features (opens in a new tab)"
              className="hidden min-h-11 items-center gap-2 rounded-md pr-3 text-[17px] font-extrabold text-[#16572a] underline decoration-[#87b58c] decoration-2 underline-offset-4 transition hover:text-[#0f4822] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 lg:inline-flex"
              href="/pricing#pricing-comparison"
              rel="noopener noreferrer"
              target="_blank"
            >
              Compare plans and features
              <span aria-hidden="true" className="text-lg leading-none">
                ↗
              </span>
            </Link>
          </div>

          <fieldset className="mt-3">
            <legend className="text-base font-extrabold text-stone-950 sm:text-lg">
              Billing
            </legend>
            <div className="mt-2 grid grid-cols-2 overflow-hidden rounded-lg border border-stone-300 bg-white">
              <BillingChoice
                isSelected={selectedBillingPlan === "monthly"}
                isSubmitting={isSubmitting}
                label="Monthly"
                onSelect={() => setSelectedBillingPlan("monthly")}
                sublabel="Pay monthly"
              />
              <BillingChoice
                isSelected={selectedBillingPlan === "yearly"}
                isSubmitting={isSubmitting}
                label="Annual"
                onSelect={() => setSelectedBillingPlan("yearly")}
                sublabel="Pay yearly and save"
              />
            </div>
          </fieldset>
        </div>

        <section aria-labelledby="plan-options-heading">
          <h3
            className="text-base font-extrabold text-stone-950 sm:text-lg"
            id="plan-options-heading"
          >
            Choose a plan
          </h3>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            {planCards.map((plan) => (
              <PlanCard
                billingPlan={selectedBillingPlan}
                isSelected={selectedPlan === plan.id}
                isSubmitting={isSubmitting}
                key={plan.id}
                onSelect={() => setSelectedPlan(plan.id)}
                plan={plan}
              />
            ))}
          </div>
        </section>

        {checkoutEnabled ? (
          <div className="rounded-lg border border-[#dbe8d8] bg-[#eff8ed] px-4 py-3 text-sm leading-6 text-[#16572a]">
            {trialAlreadyUsed ? (
              <p>
                A payment method is required. Your selected FlockFront subscription ({selectedPrice}) will begin when Stripe confirms payment. Applicable tax may be added.
              </p>
            ) : (
              <p>
                Start your 7-day free trial. A payment method is required, but you will not be charged today. Unless you cancel before the trial ends, your selected FlockFront subscription ({selectedPrice}) will begin automatically and your payment method will be charged the displayed price plus any applicable tax.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-[#dbe8d8] bg-[#eff8ed] px-4 py-2.5 text-center">
            <p className="text-sm font-bold text-[#16572a]">
              7-day free trial · $0 due today
            </p>
          </div>
        )}

        {formError ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            role="alert"
          >
            {formError}
          </p>
        ) : null}

        <div className="grid grid-cols-[0.42fr_1fr] gap-3">
          <button
            className="flex min-h-12 w-full items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-stone-700 shadow-sm transition hover:border-[#246f38] hover:text-[#246f38] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-10 sm:text-[15px]"
            disabled={isSubmitting}
            onClick={onBack}
            type="button"
          >
            Back
          </button>
          <button
            className="flex min-h-12 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-base font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-10 sm:text-[15px]"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting
              ? checkoutEnabled ? "Opening secure checkout..." : "Saving plan..."
              : checkoutEnabled
                ? "Continue to secure checkout"
                : `Continue with ${selectedPlanDetails.displayName}`}
          </button>
        </div>
      </form>
    </section>
  );
}

function PlanCard({
  billingPlan,
  isSelected,
  isSubmitting,
  onSelect,
  plan,
}: {
  billingPlan: BillingCadence;
  isSelected: boolean;
  isSubmitting: boolean;
  onSelect: () => void;
  plan: (typeof planCards)[number];
}) {
  const capabilities = PLAN_CAPABILITIES[plan.id];
  const annualPrice = capabilities.yearlyPrice ?? capabilities.monthlyPrice * 12;
  const displayedMonthlyPrice =
    billingPlan === "yearly"
      ? annualPrice / 12
      : capabilities.monthlyPrice;

  return (
    <button
      className={`rounded-xl border px-4 py-4 text-left transition focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed ${
        isSelected
          ? "border-[#16572a] bg-[#eef7ed] shadow-[0_10px_24px_rgba(22,87,42,0.16)]"
          : "border-stone-200 bg-white hover:border-[#b7d7b9] hover:bg-[#fffaf1]"
      }`}
      disabled={isSubmitting}
      onClick={onSelect}
      type="button"
    >
      <span className="flex flex-wrap items-start justify-between gap-2">
        <span>
          <span className="block font-serif text-xl font-semibold leading-tight text-stone-950">
            {capabilities.displayName}
          </span>
          <span className="mt-2 block text-3xl font-extrabold leading-none text-[#246f38]">
            {formatMonthlyPrice(displayedMonthlyPrice)}
            <span className="ml-1 text-base font-bold text-stone-950">
              /month
            </span>
          </span>
          {billingPlan === "yearly" ? (
            <>
              <span className="mt-1.5 block text-sm font-bold text-stone-700">
                Billed ${annualPrice} annually
              </span>
              <span className="mt-1 block text-xs font-extrabold uppercase tracking-wide text-[#8a5a11]">
                Save ${getAnnualSavings(capabilities)} per year
              </span>
            </>
          ) : (
            <span className="mt-1.5 block text-sm font-bold text-stone-700">
              Billed monthly
            </span>
          )}
        </span>
        {plan.badge ? (
          <span className="rounded-md bg-[#246f38] px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide text-white">
            {plan.badge}
          </span>
        ) : null}
      </span>
      <span className="mt-3 block text-sm font-medium leading-5 text-stone-600">
        {plan.purpose}
      </span>
      <span className="mt-3 block border-t border-stone-200 pt-3">
        <span className="grid gap-2">
          {plan.includes.map((item) => (
            <span
              className="flex gap-2 text-sm font-medium leading-5 text-stone-800"
              key={item}
            >
              <span
                className="mt-1.5 size-2 shrink-0 rounded-full bg-[#246f38]"
                aria-hidden="true"
              />
              <span>{item}</span>
            </span>
          ))}
        </span>
      </span>
      <span
        className={`mt-4 flex min-h-10 items-center justify-center rounded-md px-3 text-sm font-bold ${
          isSelected
            ? "bg-[#246f38] text-white"
            : "border border-[#246f38] bg-white text-[#246f38]"
        }`}
      >
        {isSelected ? "Selected" : plan.cta}
      </span>
    </button>
  );
}

function BillingChoice({
  isSelected,
  isSubmitting,
  label,
  onSelect,
  sublabel,
}: {
  isSelected: boolean;
  isSubmitting: boolean;
  label: string;
  onSelect: () => void;
  sublabel: string;
}) {
  return (
    <button
      className={`min-h-14 px-4 py-3 text-center transition focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-inset disabled:cursor-not-allowed ${
        isSelected
          ? "bg-[#246f38] text-white"
          : "bg-white text-stone-950 hover:bg-[#eff8ed]"
      }`}
      disabled={isSubmitting}
      onClick={onSelect}
      type="button"
    >
      <span className="block text-lg font-extrabold">{label}</span>
      <span
        className={`mt-0.5 block text-sm font-medium ${
          isSelected ? "text-white" : "text-stone-600"
        }`}
      >
        {sublabel}
      </span>
    </button>
  );
}

function normalizeBillingCadence(
  value: string | null | undefined,
): BillingCadence {
  return value === "monthly" ? "monthly" : "yearly";
}

function getAnnualSavings(plan: (typeof PLAN_CAPABILITIES)[PlanId]) {
  return plan.monthlyPrice * 12 - (plan.yearlyPrice ?? 0);
}

function formatMonthlyPrice(amount: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    style: "currency",
  }).format(amount);
}

function friendlyPlanAccessError(message: string) {
  if (message.toLowerCase().includes("farm basics")) {
    return "Please finish farm basics before choosing a plan.";
  }

  if (message.toLowerCase().includes("plan")) {
    return "Choose Coop or Market before continuing.";
  }

  return message || "We could not save your plan. Please try again.";
}
