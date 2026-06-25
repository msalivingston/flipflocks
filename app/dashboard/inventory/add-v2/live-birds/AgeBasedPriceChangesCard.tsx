import { inputClass } from "./constants";
import {
  formatPriceAdjustmentSummary,
  getPriceAdjustmentIssues,
} from "./priceAdjustment";
import { SectionCard } from "./SectionCard";
import type { BirdOffering, PriceAdjustmentState } from "./types";

export function AgeBasedPriceChangesCard({
  offerings,
  priceAdjustment,
  updatePriceAdjustment,
}: {
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
  updatePriceAdjustment: (updates: Partial<PriceAdjustmentState>) => void;
}) {
  const issues = getPriceAdjustmentIssues({ offerings, priceAdjustment });
  const stopPriceLabel =
    priceAdjustment.direction === "increase" ? "Maximum price" : "Minimum price";

  return (
    <SectionCard badge="Optional" step="3" title="Age-based price changes">
      <div className="space-y-3 sm:space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium leading-6 text-stone-600">
              Automatically raise or lower prices after the available date.
            </p>
            <p className="mt-1 text-xs font-medium leading-5 text-stone-500">
              Applies to every Birds for Sale group in this hatch. Buyers only
              see the current price.
            </p>
          </div>
          <button
            aria-label={
              priceAdjustment.enabled
                ? "Turn age-based price changes off"
                : "Turn age-based price changes on"
            }
            aria-pressed={priceAdjustment.enabled}
            className="inline-flex items-center gap-2 rounded-md px-1 py-1 text-sm font-semibold text-stone-700 transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            type="button"
            onClick={() =>
              updatePriceAdjustment({ enabled: !priceAdjustment.enabled })
            }
          >
            <SwitchTrack enabled={priceAdjustment.enabled} />
            <span>{priceAdjustment.enabled ? "On" : "Off"}</span>
          </button>
        </div>

        {priceAdjustment.enabled ? (
          <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50/60 p-3 sm:space-y-4 sm:p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.35fr)_1fr_1fr_1fr]">
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
              className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                issues.length > 0
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900"
              }`}
            >
              {formatPriceAdjustmentSummary(priceAdjustment)}
            </p>

          </div>
        ) : null}
      </div>
    </SectionCard>
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
      <p className="mb-1.5 block text-xs font-semibold text-stone-600">
        Price direction
      </p>
      <button
        aria-label={
          isIncrease
            ? "Switch to decrease over time"
            : "Switch to increase over time"
        }
        aria-pressed={isIncrease}
        className="group flex min-h-10 w-full items-center justify-start gap-3 rounded-md px-1 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
        type="button"
        onClick={() => onChange(isIncrease ? "decrease" : "increase")}
      >
        <span
          className={`text-sm font-semibold transition ${
            isIncrease ? "text-emerald-800" : "text-stone-400"
          }`}
        >
          Increase
        </span>
        <SwitchTrack enabled={isIncrease} />
        <span
          className={`text-sm font-semibold transition ${
            isIncrease ? "text-stone-400" : "text-emerald-800"
          }`}
        >
          Decrease
        </span>
      </button>
    </div>
  );
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
      <span className="mb-1.5 block text-xs font-semibold text-stone-600">
        {label}
      </span>
      <span className="relative block">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-500">
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
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-stone-500">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}
