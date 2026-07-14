"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LOCKED_PLAN_MESSAGES,
  type LockedPlanFeature,
} from "@/lib/plan-capabilities";

type PlanUpgradePromptProps = {
  feature?: LockedPlanFeature;
  message?: string;
  title?: string;
  compact?: boolean;
  className?: string;
};

export function PlanUpgradePrompt({
  className = "",
  compact = false,
  feature,
  message,
  title = "Unlock this with Market",
}: PlanUpgradePromptProps) {
  const body =
    message ??
    (feature ? LOCKED_PLAN_MESSAGES[feature] : null) ??
    "Market includes unlimited live bird quantities, flock/group listings, hatching eggs, equipment/supplies, processed poultry, and Age-Based Pricing.";

  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50/80 text-amber-950 ${compact ? "p-3" : "p-4"} ${className}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-amber-800 shadow-sm"
        >
          Lock
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-1 text-sm font-medium leading-6 text-amber-900">
            {body}
          </p>
          {!compact ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-4 text-sm font-semibold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                href="/dashboard/account"
              >
                Upgrade to Market
              </Link>
              <span className="inline-flex min-h-10 items-center justify-center rounded-md border border-amber-300 bg-white/70 px-4 text-sm font-semibold text-amber-900">
                Keep using Coop
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function usePlanUpgradeDialog() {
  const [prompt, setPrompt] = useState<{
    feature?: LockedPlanFeature;
    message?: string;
    title?: string;
  } | null>(null);

  return {
    prompt,
    closePrompt: () => setPrompt(null),
    openPrompt: setPrompt,
  };
}

export function PlanUpgradeDialog({
  feature,
  message,
  onClose,
  title = "Upgrade to Market",
}: {
  feature?: LockedPlanFeature;
  message?: string;
  onClose: () => void;
  title?: string;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-stone-950/45 px-4 py-6"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-2xl">
        <PlanUpgradePrompt
          feature={feature}
          message={message}
          title={title}
        />
        <div className="mt-4 flex justify-end">
          <button
            className="seller-secondary-button"
            type="button"
            onClick={onClose}
          >
            Keep using Coop
          </button>
        </div>
      </div>
    </div>
  );
}

export function FullFlockPill() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
      Market
    </span>
  );
}
