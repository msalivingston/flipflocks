"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  PLAN_CAPABILITIES,
  type PlanId,
  normalizePlanId,
} from "@/lib/plan-capabilities";

type Step5PlanAccessFormProps = {
  initialPlanKey?: string | null;
  onBack: () => void;
  onComplete: (planKey: PlanId) => void;
};

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
    purpose:
      "For occasional sellers, off-season farms, and keeping your storefront active with a few birds.",
    includes: [
      "Live birds only",
      "Single birds, pairs, and trios",
      "Up to 5 active birds for sale",
      "Simple fixed pricing",
      "Farm storefront stays active",
    ],
  },
  {
    id: "full_flock",
    badge: "Best for active sellers",
    cta: "Choose Full Flock",
    purpose: "For active poultry sellers who need more room and more sale types.",
    includes: [
      "Unlimited live bird quantities",
      "Flock/group listings",
      "Hatching eggs",
      "Poultry products",
      "Equipment or supplies",
      "Age-Based Pricing",
    ],
  },
];

export function Step5PlanAccessForm({
  initialPlanKey,
  onBack,
  onComplete,
}: Step5PlanAccessFormProps) {
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(
    normalizePlanId(initialPlanKey),
  );
  const [promoCode, setPromoCode] = useState("");
  const [promo, setPromo] = useState<PromoState>({
    appliedCode: null,
    error: null,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedPlanConfig = PLAN_CAPABILITIES[selectedPlan];

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
        return;
      }

      appliedCode = acceptedBetaPromoCode;
      setPromo({ appliedCode, error: null });
    }

    setFormError(null);
    setIsSubmitting(true);

    const { error } = await supabase.rpc("seller_save_onboarding_plan_access", {
      p_plan: {
        plan_key: selectedPlan,
        promo_code: appliedCode,
      },
    });

    if (error) {
      setFormError(friendlyPlanAccessError(error.message));
      setIsSubmitting(false);
      return;
    }

    onComplete(selectedPlan);
  }

  const hasBetaAccess = promo.appliedCode === acceptedBetaPromoCode;

  return (
    <section className="rounded-[0.95rem] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-7 lg:py-6">
      <h2 className="font-serif text-[1.45rem] font-semibold leading-tight text-stone-950 sm:text-[1.7rem]">
        Choose your plan
      </h2>
      <p className="mt-2 text-sm font-medium leading-6 text-stone-600">
        Pick the plan that fits how you sell right now. You can change plans
        later.
      </p>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-3">
          {planCards.map((plan) => (
            <PlanCard
              isSelected={selectedPlan === plan.id}
              isSubmitting={isSubmitting}
              key={plan.id}
              onSelect={() => setSelectedPlan(plan.id)}
              plan={plan}
            />
          ))}
        </div>

        <div>
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

        <div className="rounded-lg border border-[#dbe8d8] bg-[#eff8ed] px-4 py-3">
          <p className="text-sm font-extrabold text-[#16572a]">
            Pricing summary
          </p>
          {hasBetaAccess ? (
            <dl className="mt-2 space-y-1 text-sm font-medium text-stone-700">
              <SummaryRow label="Plan" value={selectedPlanConfig.displayName} />
              <SummaryRow label="Promo" value="Beta access applied" />
              <SummaryRow label="Due today" value="$0" />
              <SummaryRow
                label="Billing"
                value="No payment required during beta"
              />
            </dl>
          ) : (
            <dl className="mt-2 space-y-1 text-sm font-medium text-stone-700">
              <SummaryRow label="Plan" value={selectedPlanConfig.displayName} />
              <SummaryRow label="Trial" value="7 days free" />
              <SummaryRow label="Due today" value="$0" />
              <SummaryRow
                label="After trial"
                value={`$${selectedPlanConfig.monthlyPrice}/month`}
              />
            </dl>
          )}
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
  isSelected,
  isSubmitting,
  onSelect,
  plan,
}: {
  isSelected: boolean;
  isSubmitting: boolean;
  onSelect: () => void;
  plan: (typeof planCards)[number];
}) {
  const capabilities = PLAN_CAPABILITIES[plan.id];

  return (
    <button
      className={`rounded-xl border px-4 py-4 text-left transition focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed ${
        isSelected
          ? "border-[#246f38] bg-[#eff8ed] shadow-sm"
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
          <span className="mt-1 block text-lg font-extrabold text-[#246f38]">
            ${capabilities.monthlyPrice}/month
          </span>
        </span>
        {plan.badge ? (
          <span className="rounded-full bg-[#246f38] px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide text-white">
            {plan.badge}
          </span>
        ) : null}
      </span>
      <span className="mt-2 block text-sm font-medium leading-6 text-stone-600">
        {plan.purpose}
      </span>
      <span className="mt-3 grid gap-1.5">
        {plan.includes.map((item) => (
          <span
            className="flex gap-2 text-sm font-medium leading-5 text-stone-700"
            key={item}
          >
            <span
              className="mt-2 size-1.5 shrink-0 rounded-full bg-[#246f38]"
              aria-hidden="true"
            />
            <span>{item}</span>
          </span>
        ))}
      </span>
      <span
        className={`mt-3 inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-bold ${
          isSelected
            ? "bg-[#246f38] text-white"
            : "border border-[#b7d7b9] bg-white text-[#246f38]"
        }`}
      >
        {isSelected ? "Selected" : plan.cta}
      </span>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt>{label}:</dt>
      <dd className="text-right font-bold text-stone-950">{value}</dd>
    </div>
  );
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
