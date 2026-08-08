"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { currentSellerTerms, legalRoutes } from "@/lib/legal";
import { supabase } from "@/lib/supabase";

type SellerTermsAcceptanceProps = {
  compact?: boolean;
  initiallyAccepted?: boolean;
  onAccepted: () => void | Promise<void>;
  storeId: string;
};

export function SellerTermsAcceptance({
  compact = false,
  initiallyAccepted = false,
  onAccepted,
  storeId,
}: SellerTermsAcceptanceProps) {
  const checkboxId = useId();
  const [checked, setChecked] = useState(false);
  const [accepted, setAccepted] = useState(initiallyAccepted);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acceptTerms() {
    if (!checked || accepted || isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    const { data, error: acceptanceError } = await supabase.rpc(
      "seller_accept_current_terms",
      { p_store_id: storeId },
    );
    const acceptance = Array.isArray(data) ? data[0] : null;

    if (acceptanceError || !acceptance) {
      setError(
        acceptanceError?.message === "STORE_NOT_FOUND_OR_NOT_OWNER"
          ? "Only the store owner can accept the Seller Terms."
          : "We could not record your acceptance. Please try again.",
      );
      setIsSubmitting(false);
      return;
    }

    setAccepted(true);
    setIsSubmitting(false);
    await onAccepted();
  }

  if (accepted) {
    return (
      <p
        className={
          compact
            ? "mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800"
            : "rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
        }
        role="status"
      >
        Seller Terms accepted.
      </p>
    );
  }

  return (
    <div
      className={
        compact
          ? "mt-3 border-t border-stone-200 pt-3"
          : "rounded-lg border border-[#dbe8d8] bg-[#fffdf8] px-4 py-4"
      }
    >
      <p className={compact ? "text-xs leading-5 text-stone-600" : "text-sm leading-6 text-stone-600"}>
        Review the current Seller Terms, effective {currentSellerTerms.effectiveDate}.
      </p>
      <label
        className={`mt-3 flex cursor-pointer items-start gap-3 font-semibold text-stone-800 ${compact ? "text-xs leading-5" : "text-sm leading-6"}`}
        htmlFor={checkboxId}
      >
        <input
          checked={checked}
          className="mt-1 size-4 shrink-0 accent-[#246f38]"
          disabled={isSubmitting}
          id={checkboxId}
          onChange={(event) => setChecked(event.target.checked)}
          type="checkbox"
        />
        <span>
          I have read and agree to the FlockFront{" "}
          <Link
            className="text-[#1f6f38] underline decoration-2 underline-offset-2"
            href={legalRoutes.terms}
            rel="noopener noreferrer"
            target="_blank"
          >
            Terms of Service
          </Link>
          .
        </span>
      </label>

      {error ? (
        <p className="mt-2 text-xs font-semibold leading-5 text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <button
        className={`${compact ? "mt-3 min-h-10 w-full text-xs" : "mt-4 min-h-11 px-5 text-sm"} inline-flex items-center justify-center rounded-md bg-[#246f38] font-bold text-white transition hover:bg-[#1c5c2d] disabled:cursor-not-allowed disabled:bg-stone-300`}
        disabled={!checked || isSubmitting}
        onClick={() => void acceptTerms()}
        type="button"
      >
        {isSubmitting ? "Recording acceptance..." : "Accept Seller Terms"}
      </button>
    </div>
  );
}

