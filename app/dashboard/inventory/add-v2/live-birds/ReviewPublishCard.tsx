import { disabledButtonClass } from "./constants";
import { formatDisplayDate } from "./helpers";
import { SectionCard } from "./SectionCard";

export function ReviewPublishCard({
  availableDate,
  birdsTotal,
  hatchDate,
  offeringCount,
  priceRange,
  species,
}: {
  availableDate: string;
  birdsTotal: number;
  hatchDate: string;
  offeringCount: number;
  priceRange: string;
  species: string;
}) {
  return (
    <SectionCard step="3" title="Review & Publish">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <ReviewSummaryItem label="Species" value={species || "Not selected"} />
          <ReviewSummaryItem
            label="Hatch date"
            value={formatDisplayDate(hatchDate)}
          />
          <ReviewSummaryItem
            label="Available date"
            value={formatDisplayDate(availableDate)}
          />
          <ReviewSummaryItem
            label="Bird offerings"
            value={String(offeringCount)}
          />
          <ReviewSummaryItem label="Total birds" value={String(birdsTotal)} />
          <ReviewSummaryItem label="Price range" value={priceRange} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={disabledButtonClass} disabled type="button">
            Save draft
          </button>
          <button
            className="inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-md bg-emerald-800/70 px-4 text-sm font-semibold text-white opacity-65"
            disabled
            type="button"
          >
            Review & publish
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

function ReviewSummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50/70 px-3 py-2">
      <p className="text-xs font-semibold text-stone-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-stone-950">{value}</p>
    </div>
  );
}
