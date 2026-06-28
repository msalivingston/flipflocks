"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type Step5PlanAccessFormProps = {
  onBack: () => void;
  onComplete: () => void;
};

type PromoState = {
  appliedCode: string | null;
  error: string | null;
};

const acceptedBetaPromoCode = "FOUNDINGFLOCK";

const planIncludes = [
  "Farm storefront",
  "Live birds, hatching eggs, poultry products, and equipment listings",
  "Inventory management",
  "Customer orders",
  "Pickup instructions and store policies",
  "Seller dashboard",
];

export function Step5PlanAccessForm({
  onBack,
  onComplete,
}: Step5PlanAccessFormProps) {
  const [promoCode, setPromoCode] = useState("");
  const [promo, setPromo] = useState<PromoState>({
    appliedCode: null,
    error: null,
  });
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
        return;
      }

      appliedCode = acceptedBetaPromoCode;
      setPromo({ appliedCode, error: null });
    }

    setFormError(null);
    setIsSubmitting(true);

    const { error } = await supabase.rpc("seller_save_onboarding_plan_access", {
      p_plan: {
        promo_code: appliedCode,
      },
    });

    if (error) {
      setFormError(friendlyPlanAccessError(error.message));
      setIsSubmitting(false);
      return;
    }

    onComplete();
  }

  const hasBetaAccess = promo.appliedCode === acceptedBetaPromoCode;

  return (
    <section className="rounded-[0.95rem] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-7 lg:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-[1.45rem] font-semibold leading-tight text-stone-950 sm:text-[1.7rem]">
            FlockFront Seller Plan
          </h2>
          <p className="mt-1 text-lg font-extrabold text-[#246f38]">
            $29/month after trial
          </p>
        </div>
        <span className="rounded-full bg-[#eff8ed] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#246f38] ring-1 ring-[#b7d7b9]">
          7-day free trial
        </span>
      </div>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="rounded-lg border border-stone-200 bg-[#fffaf1] px-4 py-3">
          <p className="text-sm font-extrabold text-stone-950">
            Plan includes
          </p>
          <ul className="mt-2 space-y-1.5">
            {planIncludes.map((item) => (
              <li
                className="flex gap-2 text-sm font-medium leading-5 text-stone-700"
                key={item}
              >
                <span
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-[#246f38]"
                  aria-hidden="true"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
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
              <SummaryRow label="Promo" value="Beta access applied" />
              <SummaryRow label="Due today" value="$0" />
              <SummaryRow
                label="Billing"
                value="No payment required during beta"
              />
            </dl>
          ) : (
            <dl className="mt-2 space-y-1 text-sm font-medium text-stone-700">
              <SummaryRow label="Trial" value="7 days free" />
              <SummaryRow label="Due today" value="$0" />
              <SummaryRow label="After trial" value="$29/month" />
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
            {isSubmitting ? "Saving plan access..." : "Continue"}
          </button>
        </div>
      </form>
    </section>
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
  if (message.toLowerCase().includes("pickup")) {
    return "Please finish pickup instructions before saving plan access.";
  }

  if (message.toLowerCase().includes("promo")) {
    return "That promo code is not valid right now.";
  }

  return message || "We could not save your plan access. Please try again.";
}
