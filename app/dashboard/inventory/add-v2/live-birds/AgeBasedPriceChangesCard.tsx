"use client";

import { inputClass } from "./constants";
import { PlanUpgradePrompt } from "../../../_components/plan-upgrade-prompt";
import {
  formatPriceAdjustmentSummary,
  getPriceAdjustmentExample,
  getPriceAdjustmentIssues,
} from "./priceAdjustment";
import { SectionCard } from "./SectionCard";
import { MobileLiveBirdsArtwork } from "./MobileLiveBirdsArtwork";
import type { BirdOffering, PriceAdjustmentState } from "./types";

export function AgeBasedPriceChangesCard({
  availableDate,
  desktopActive,
  desktopComplete,
  desktopDisabled,
  desktopPanelMode = false,
  introText,
  offerings,
  priceAdjustment,
  stepLocked = false,
  updatePriceAdjustment,
  locked = false,
  mobileActive = false,
  onDesktopContinue,
  onMobileContinue,
  onMobileOpen,
  onDesktopOpen,
}: {
  availableDate: string;
  desktopActive: boolean;
  desktopComplete: boolean;
  desktopDisabled: boolean;
  desktopPanelMode?: boolean;
  introText?: string;
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
  stepLocked?: boolean;
  updatePriceAdjustment: (updates: Partial<PriceAdjustmentState>) => void;
  locked?: boolean;
  mobileActive?: boolean;
  onDesktopContinue: () => void;
  onMobileContinue: () => void;
  onMobileOpen: () => void;
  onDesktopOpen: () => void;
}) {
  const issues = getPriceAdjustmentIssues({ offerings, priceAdjustment });
  const example = getPriceAdjustmentExample({
    availableDate,
    offerings,
    priceAdjustment,
  });
  const stopPriceLabel =
    priceAdjustment.direction === "increase" ? "Maximum price" : "Minimum price";
  function renderContent() {
    return (
      <div className="space-y-3 sm:space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
              How should the price change over time?
            </p>
            <p className="text-base font-medium leading-7 text-stone-600">
              {introText ??
                "Automatically raise or lower prices on the schedule you choose."}
            </p>
          </div>
          <button
            aria-label={
              priceAdjustment.enabled
                ? "Turn age-based price changes off"
                : "Turn age-based price changes on"
            }
            aria-pressed={priceAdjustment.enabled}
            className="inline-flex min-h-12 items-center gap-2 rounded-md px-1 py-1 text-base font-bold text-stone-700 transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:text-sm sm:font-semibold"
            type="button"
            disabled={locked || stepLocked}
            onClick={() =>
              updatePriceAdjustment({ enabled: !priceAdjustment.enabled })
            }
          >
            <SwitchTrack enabled={priceAdjustment.enabled} />
            <span>{locked ? "Market" : priceAdjustment.enabled ? "On" : "Off"}</span>
          </button>
        </div>
        {locked ? (
          <PlanUpgradePrompt compact feature="age_based_pricing" />
        ) : null}

        {priceAdjustment.enabled && !locked && !stepLocked ? (
          <div className="space-y-3 rounded-lg border border-transparent bg-stone-50/70 p-0 sm:space-y-4 sm:border-stone-200 sm:p-4">
            <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(260px,1.35fr)_1fr_1fr_1fr]">
              <PriceDirectionToggle
                direction={priceAdjustment.direction}
                onChange={(direction) =>
                  updatePriceAdjustment(
                    direction === "increase"
                      ? { direction, minPrice: "" }
                      : { direction, maxPrice: "" },
                  )
                }
              />
              <NumberField
                label="Amount"
                prefix="$"
                value={priceAdjustment.amount}
                onChange={(amount) => updatePriceAdjustment({ amount })}
              />
              <NumberField
                label="Every"
                suffix="weeks"
                value={priceAdjustment.intervalWeeks}
                onChange={(intervalWeeks) =>
                  updatePriceAdjustment({ intervalWeeks })
                }
              />
              <NumberField
                label={stopPriceLabel}
                prefix="$"
                value={
                  priceAdjustment.direction === "increase"
                    ? priceAdjustment.maxPrice
                    : priceAdjustment.minPrice
                }
                onChange={(stopPrice) =>
                  priceAdjustment.direction === "increase"
                    ? updatePriceAdjustment({ maxPrice: stopPrice })
                    : updatePriceAdjustment({ minPrice: stopPrice })
                }
              />
            </div>

            <p
              className={`rounded-md border px-3 py-2 text-base font-semibold leading-7 ${
                issues.length > 0
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900"
              }`}
            >
              {formatPriceAdjustmentSummary(priceAdjustment)}
            </p>
            {example ? (
              <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                  Preview
                </p>
                <div className="mt-2 space-y-2 text-sm font-medium leading-6 text-stone-600">
                  {example.results.map((result) => (
                    <p key={result}>{result}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          className="ml-auto hidden min-h-10 items-center justify-center rounded-md bg-emerald-800 px-6 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500 sm:inline-flex"
          disabled={stepLocked}
          type="button"
          onClick={onDesktopContinue}
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <>
      <section
        className={`rounded-2xl border p-5 transition-colors sm:hidden ${
          stepLocked
            ? "border-stone-200 bg-white opacity-60"
            : mobileActive
              ? "border-emerald-200 bg-emerald-50/60 shadow-[0_6px_20px_rgba(31,42,32,0.07)]"
              : "border-stone-200 bg-white"
        }`}
      >
        <button
          aria-expanded={mobileActive}
          className="flex min-h-11 w-full items-start gap-3 text-left"
          type="button"
          onClick={() => {
            onMobileOpen();
          }}
        >
          <MobileLiveBirdsArtwork className="size-16 rounded-full" name="price" />
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-sm font-bold text-white">
            3
          </span>
          <span className="min-w-0 flex-1 text-xl font-bold leading-6 text-stone-950">
            Automatic price changes
          </span>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-sm font-semibold text-stone-600">
            Optional
          </span>
          <DisclosureChevron expanded={mobileActive} />
        </button>
        {mobileActive ? (
          <div className="mt-4">
            {renderContent()}
            <button
              className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-800 px-5 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500 disabled:shadow-none"
              disabled={stepLocked}
              type="button"
              onClick={onMobileContinue}
            >
              Continue
            </button>
          </div>
        ) : (
          <p className="mt-3 text-base font-medium leading-7 text-stone-600">
            {priceAdjustment.enabled
              ? getCompactPriceAdjustmentSummary(priceAdjustment)
              : "Automatically raise or lower prices on the schedule you choose."}
          </p>
        )}
      </section>
      <div className="hidden sm:block">
        <SectionCard
          badge="Optional"
          className={stepLocked ? "opacity-60" : ""}
          desktopComplete={desktopComplete}
          desktopDisabled={desktopDisabled}
          desktopExpanded={desktopActive}
          desktopPanelMode={desktopPanelMode}
          desktopSummary={
            priceAdjustment.enabled
              ? getCompactPriceAdjustmentSummary(priceAdjustment)
                  .replace("Max ", "Maximum ")
                  .replace("Min ", "Minimum ")
              : "No automatic price changes"
          }
          onDesktopToggle={onDesktopOpen}
          step="3"
          title="Automatic price changes"
        >
          {renderContent()}
        </SectionCard>
      </div>
    </>
  );
}

function DisclosureChevron({ expanded = false }: { expanded?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-1 h-2.5 w-2.5 shrink-0 border-b-2 border-r-2 border-emerald-800/80 ${
        expanded ? "rotate-45" : "-rotate-45"
      }`}
    />
  );
}

function PriceDirectionToggle({
  direction,
  onChange,
}: {
  direction: PriceAdjustmentState["direction"];
  onChange: (direction: PriceAdjustmentState["direction"]) => void;
}) {
  const isIncrease = direction === "increase";

  return (
    <div>
      <p className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
        Price direction
      </p>
      <div
        className="grid min-h-12 grid-cols-2 overflow-hidden rounded-lg border border-stone-300 bg-white p-1"
        role="group"
        aria-label="Price direction"
      >
        <button
          aria-pressed={isIncrease}
          className={`rounded-md px-3 text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-emerald-700 ${
            isIncrease
              ? "bg-emerald-800 text-white shadow-sm"
              : "text-stone-600 hover:bg-stone-50"
          }`}
          type="button"
          onClick={() => onChange("increase")}
        >
          Increase
        </button>
        <button
          aria-pressed={!isIncrease}
          className={`rounded-md px-3 text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-emerald-700 ${
            !isIncrease
              ? "bg-emerald-800 text-white shadow-sm"
              : "text-stone-600 hover:bg-stone-50"
          }`}
          type="button"
          onClick={() => onChange("decrease")}
        >
          Decrease
        </button>
      </div>
    </div>
  );
}

function getCompactPriceAdjustmentSummary(value: PriceAdjustmentState) {
  if (!value.enabled) return "No automatic price changes";

  const amount = Number(value.amount);
  const weeks = Number(value.intervalWeeks);
  const stopPrice =
    value.direction === "increase" ? Number(value.maxPrice) : Number(value.minPrice);

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isFinite(weeks) ||
    weeks <= 0 ||
    !Number.isFinite(stopPrice)
  ) {
    return formatPriceAdjustmentSummary(value);
  }

  const direction = value.direction === "increase" ? "Increasing" : "Decreasing";
  const cadence = weeks === 1 ? "week" : `${weeks} weeks`;
  const boundary = value.direction === "increase" ? "Max" : "Min";

  return `${direction} $${amount}/${cadence} • ${boundary} $${stopPrice}`;
}

function SwitchTrack({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${
        enabled ? "bg-emerald-700" : "bg-stone-400"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition ${
          enabled ? "left-5" : "left-0.5"
        }`}
      />
    </span>
  );
}

function NumberField({
  label,
  onChange,
  prefix,
  suffix,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  value: string;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
        {label}
      </span>
      <span className="relative block">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-stone-500 sm:text-sm">
            {prefix}
          </span>
        ) : null}
        <input
          className={`${inputClass} ${prefix ? "pl-8" : ""} ${suffix ? "pr-16" : ""}`}
          min="0"
          step={label === "Every" ? "1" : "0.01"}
          type="number"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-base font-semibold text-stone-500 sm:text-xs">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}
