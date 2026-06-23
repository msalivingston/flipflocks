import { disabledButtonClass } from "./constants";
import { formatDisplayDate } from "./helpers";
import { SectionCard } from "./SectionCard";
import type { SaveDraftPreflightResult } from "./saveDraftPreflight";

export function ReviewPublishCard({
  availableDate,
  birdsTotal,
  hatchDate,
  onSaveDraft,
  offeringCount,
  priceRange,
  saveDraftDisabledReason,
  saveDraftMessage,
  saveDraftPreflight,
  saveDraftStatus,
  species,
}: {
  availableDate: string;
  birdsTotal: number;
  hatchDate: string;
  onSaveDraft: () => void;
  offeringCount: number;
  priceRange: string;
  saveDraftDisabledReason: string | null;
  saveDraftMessage: string | null;
  saveDraftPreflight: SaveDraftPreflightResult;
  saveDraftStatus: SaveDraftStatus;
  species: string;
}) {
  return (
    <SectionCard step="3" title="Review & Publish">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
        <PreflightStatus
          preflight={saveDraftPreflight}
          saveDraftDisabledReason={saveDraftDisabledReason}
          saveDraftMessage={saveDraftMessage}
          saveDraftStatus={saveDraftStatus}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <SaveDraftButton
            canSaveDraft={saveDraftPreflight.canSaveDraft}
            onSaveDraft={onSaveDraft}
            saveDraftDisabledReason={saveDraftDisabledReason}
            saveDraftStatus={saveDraftStatus}
          />
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

function PreflightStatus({
  preflight,
  saveDraftDisabledReason,
  saveDraftMessage,
  saveDraftStatus,
}: {
  preflight: SaveDraftPreflightResult;
  saveDraftDisabledReason: string | null;
  saveDraftMessage: string | null;
  saveDraftStatus: SaveDraftStatus;
}) {
  const messageClass =
    saveDraftStatus === "error"
      ? "border-red-200 text-red-700"
      : "border-emerald-200 text-emerald-800";

  return (
    <div
      className={`rounded-md border px-3 py-3 text-sm ${
        preflight.canSaveDraft
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      <p className="font-semibold">
        {saveDraftDisabledReason
          ? saveDraftDisabledReason
          : preflight.canSaveDraft
            ? "Ready to save draft."
            : "Draft save not ready yet."}
      </p>
      {saveDraftMessage ? (
        <p
          className={`mt-2 rounded-md border bg-white/70 px-3 py-2 text-xs font-semibold ${messageClass}`}
        >
          {saveDraftMessage}
        </p>
      ) : null}
      {preflight.blockingIssues.length > 0 ? (
        <PreflightList
          items={preflight.blockingIssues}
          label="Before save wiring"
        />
      ) : null}
      {preflight.warnings.length > 0 ? (
        <PreflightList items={preflight.warnings} label="Notes" />
      ) : null}
    </div>
  );
}

function PreflightList({
  items,
  label,
}: {
  items: string[];
  label: string;
}) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-current">
        {label}
      </p>
      <ul className="mt-1 space-y-1 text-xs font-medium leading-5">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

export function SaveDraftButton({
  canSaveDraft,
  onSaveDraft,
  saveDraftDisabledReason,
  saveDraftStatus,
}: {
  canSaveDraft: boolean;
  onSaveDraft: () => void;
  saveDraftDisabledReason: string | null;
  saveDraftStatus: SaveDraftStatus;
}) {
  const disabled =
    Boolean(saveDraftDisabledReason) ||
    !canSaveDraft ||
    saveDraftStatus === "saving" ||
    saveDraftStatus === "success";
  const label = getSaveDraftButtonLabel(saveDraftStatus);

  if (disabled) {
    return (
      <button className={disabledButtonClass} disabled type="button">
        {label}
      </button>
    );
  }

  return (
    <button
      className="inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-800/30 bg-white px-4 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
      onClick={onSaveDraft}
      type="button"
    >
      {label}
    </button>
  );
}

export type SaveDraftStatus = "idle" | "saving" | "success" | "error";

function getSaveDraftButtonLabel(saveDraftStatus: SaveDraftStatus) {
  if (saveDraftStatus === "saving") return "Saving...";
  if (saveDraftStatus === "success") return "Draft saved";

  return "Save draft";
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
