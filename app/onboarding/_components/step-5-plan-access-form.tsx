"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
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

type PromoState = {
  appliedCode: string | null;
  error: string | null;
};

const acceptedBetaPromoCode = "FOUNDINGFLOCK";

const planCards: Array<{
  badge?: string;
  cta: string;
  id: PlanId;
  includes: string[];
  purpose: string;
}> = [
  {
    id: "small_flock",
    cta: "Choose Small Flock",
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
    cta: "Choose Full Flock",
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
  const [promoCode, setPromoCode] = useState("");
  const [promo, setPromo] = useState<PromoState>({
    appliedCode: null,
    error: null,
  });
  const [isPromoOpen, setIsPromoOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function normalizePromoCode(value: string) {
    return value.trim().toUpperCase();
  }

  function applyPromoCode() {
    const normalizedCode = normalizePromoCode(promoCode);

    if (!normalizedCode) {
      setPromo({ appliedCode: null, error: null });
      return;
    }

    if (normalizedCode !== acceptedBetaPromoCode) {
      setPromo({
        appliedCode: null,
        error: "That promo code is not valid right now.",
      });
      return;
    }

    setPromo({ appliedCode: acceptedBetaPromoCode, error: null });
    setPromoCode(acceptedBetaPromoCode);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedCode = normalizePromoCode(promoCode);
    let appliedCode = promo.appliedCode;

    if (normalizedCode && normalizedCode !== promo.appliedCode) {
      if (normalizedCode !== acceptedBetaPromoCode) {
        setPromo({
          appliedCode: null,
          error: "Apply a valid promo code, or leave the field blank.",
        });
        setIsPromoOpen(true);
        return;
      }

      appliedCode = acceptedBetaPromoCode;
      setPromo({ appliedCode, error: null });
    }

    setFormError(null);
    setIsSubmitting(true);

    const { error } = await supabase.rpc("seller_save_onboarding_plan_access", {
      p_plan: {
        billing_plan: selectedBillingPlan,
        plan_key: selectedPlan,
        promo_code: appliedCode,
      },
    });

    if (error) {
      setFormError(friendlyPlanAccessError(error.message));
      setIsSubmitting(false);
      return;
    }

    onComplete(selectedPlan, selectedBillingPlan);
  }

  const hasBetaAccess = promo.appliedCode === acceptedBetaPromoCode;

  return (
    <section className="rounded-[0.95rem] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 lg:px-7">
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <section>
          <h3 className="text-base font-extrabold text-stone-950 sm:text-lg">
            1. Choose your plan
          </h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
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

        <fieldset>
          <legend className="text-base font-extrabold text-stone-950 sm:text-lg">
            2. Choose your billing
          </legend>
          <div className="mt-3 grid overflow-hidden rounded-lg border border-stone-300 bg-white sm:grid-cols-2">
            <BillingChoice
              isSelected={selectedBillingPlan === "monthly"}
              isSubmitting={isSubmitting}
              label="Monthly"
              onSelect={() => setSelectedBillingPlan("monthly")}
              sublabel="Pay month to month"
            />
            <BillingChoice
              isSelected={selectedBillingPlan === "yearly"}
              isSubmitting={isSubmitting}
              label="Annual"
              onSelect={() => setSelectedBillingPlan("yearly")}
              sublabel="Pay once a year and save"
            />
          </div>
        </fieldset>

        <div className="rounded-lg border border-[#ead8b8] bg-[#fffaf1] px-4 py-3 text-center text-sm font-bold text-stone-800">
          7-day free trial. $0 today.
        </div>

        <div className="rounded-lg border border-dashed border-stone-300 bg-white">
          <button
            className="flex min-h-11 w-full items-center justify-between px-4 text-left text-sm font-extrabold text-[#16572a] transition hover:bg-[#eff8ed] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2"
            disabled={isSubmitting}
            onClick={() => setIsPromoOpen((current) => !current)}
            type="button"
          >
            <span>Have a promo code?</span>
            <span aria-hidden="true">{isPromoOpen ? "Hide" : "Show"}</span>
          </button>
          {isPromoOpen ? (
            <div className="border-t border-stone-200 px-4 py-3">
              <label
                className="text-xs font-bold text-stone-950 sm:text-[13px]"
                htmlFor="promo-code"
              >
                Promo code
              </label>
              <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  aria-describedby={promo.error ? "promo-code-error" : undefined}
                  aria-invalid={Boolean(promo.error)}
                  className={`min-h-10 rounded-md border bg-white px-3 text-sm font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:ring-2 focus:ring-[#246f38]/25 sm:text-[14px] ${
                    promo.error
                      ? "border-red-400 focus:border-red-500"
                      : "border-stone-300 focus:border-[#246f38]"
                  }`}
                  disabled={isSubmitting}
                  id="promo-code"
                  onChange={(event) => {
                    setPromoCode(event.target.value);
                    if (promo.error) {
                      setPromo((current) => ({ ...current, error: null }));
                    }
                  }}
                  placeholder="Beta or promo code"
                  type="text"
                  value={promoCode}
                />
                <button
                  className="min-h-10 rounded-md border border-[#246f38] bg-white px-4 text-sm font-bold text-[#246f38] shadow-sm transition hover:bg-[#eff8ed] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={isSubmitting}
                  onClick={applyPromoCode}
                  type="button"
                >
                  Apply
                </button>
              </div>
              {promo.error ? (
                <p
                  className="mt-1 text-xs font-semibold text-red-700 sm:text-[13px]"
                  id="promo-code-error"
                >
                  {promo.error}
                </p>
              ) : null}
              {hasBetaAccess ? (
                <p className="mt-1 text-xs font-bold text-[#246f38] sm:text-[13px]">
                  Beta access applied.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {formError ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            role="alert"
          >
            {formError}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[0.42fr_1fr]">
          <button
            className="flex min-h-10 w-full items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-sm font-bold text-stone-700 shadow-sm transition hover:border-[#246f38] hover:text-[#246f38] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:text-[15px]"
            disabled={isSubmitting}
            onClick={onBack}
            type="button"
          >
            Back
          </button>
          <button
            className="flex min-h-10 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:text-[15px]"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Saving plan..." : "Continue"}
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
  const price = getAfterTrialAmount(capabilities, billingPlan);

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
            {formatPlanPriceMain(price)}
            <span className="ml-1 text-base font-bold text-stone-950">
              {formatPlanPriceCadence(price)}
            </span>
          </span>
          {billingPlan === "yearly" ? (
            <span className="mt-1 block text-xs font-extrabold uppercase tracking-wide text-[#8a5a11]">
              Save ${getAnnualSavings(capabilities)}
            </span>
          ) : null}
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
  return value === "yearly" ? "yearly" : "monthly";
}

function getAnnualSavings(plan: (typeof PLAN_CAPABILITIES)[PlanId]) {
  return plan.monthlyPrice * 12 - (plan.yearlyPrice ?? 0);
}

function getAfterTrialAmount(
  plan: (typeof PLAN_CAPABILITIES)[PlanId],
  billingPlan: BillingCadence,
) {
  if (billingPlan === "yearly") {
    return `$${plan.yearlyPrice}/year`;
  }

  return `$${plan.monthlyPrice}/month`;
}

function formatPlanPriceMain(price: string) {
  return price.split("/")[0];
}

function formatPlanPriceCadence(price: string) {
  return `/${price.split("/")[1]}`;
}

function friendlyPlanAccessError(message: string) {
  if (message.toLowerCase().includes("farm basics")) {
    return "Please finish farm basics before choosing a plan.";
  }

  if (message.toLowerCase().includes("plan")) {
    return "Choose Small Flock or Full Flock before continuing.";
  }

  if (message.toLowerCase().includes("promo")) {
    return "That promo code is not valid right now.";
  }

  return message || "We could not save your plan. Please try again.";
}
