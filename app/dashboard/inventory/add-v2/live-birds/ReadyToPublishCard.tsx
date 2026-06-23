import { areAllReadinessChecksComplete } from "./helpers";
import { ReviewPublishButton, SaveDraftButton } from "./ReviewPublishCard";
import type { PublishStatus, SaveDraftStatus } from "./ReviewPublishCard";
import type { SaveDraftPreflightResult } from "./saveDraftPreflight";
import { SidebarCard } from "./SidebarCard";
import type { ReadinessChecks } from "./types";

export function ReadyToPublishCard({
  onSaveDraft,
  onReviewPublish,
  publishDisabledReason,
  publishStatus,
  readiness,
  saveDraftDisabledReason,
  saveDraftPreflight,
  saveDraftStatus,
}: {
  onSaveDraft: () => void;
  onReviewPublish: () => void;
  publishDisabledReason: string | null;
  publishStatus: PublishStatus;
  readiness: ReadinessChecks;
  saveDraftDisabledReason: string | null;
  saveDraftPreflight: SaveDraftPreflightResult;
  saveDraftStatus: SaveDraftStatus;
}) {
  const readyToReview = areAllReadinessChecksComplete(readiness);

  return (
    <SidebarCard title="Ready to Publish">
      <div className="space-y-3">
        <ChecklistRow
          complete={readiness.hatchInformationComplete}
          label="Hatch information complete"
        />
        <ChecklistRow
          complete={readiness.birdOfferingsAdded}
          label="Bird offerings added"
        />
        <ChecklistRow
          complete={readiness.birdQuantitiesEntered}
          label="Quantities entered"
        />
        <ChecklistRow
          complete={readiness.pricingEntered}
          label="Pricing entered"
        />
        <ChecklistRow
          complete={readiness.buyerContentComplete}
          label="Buyer content complete"
        />
      </div>
      <p
        className={`mt-5 rounded-md border px-3 py-2 text-sm font-semibold ${
          readyToReview
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-stone-200 bg-stone-50 text-stone-600"
        }`}
      >
        {readyToReview
          ? "Looks ready to review."
          : "Finish the remaining items before publishing."}
      </p>
      <div className="mt-6 grid gap-3">
        <ReviewPublishButton
          onReviewPublish={onReviewPublish}
          publishDisabledReason={publishDisabledReason}
          publishStatus={publishStatus}
        />
        <SaveDraftButton
          canSaveDraft={saveDraftPreflight.canSaveDraft}
          onSaveDraft={onSaveDraft}
          saveDraftDisabledReason={saveDraftDisabledReason}
          saveDraftStatus={saveDraftStatus}
        />
      </div>
      <p className="mt-4 text-sm leading-6 text-stone-500">
        Buyer preview will appear during review.
      </p>
    </SidebarCard>
  );
}

function ChecklistRow({
  complete,
  label,
}: {
  complete: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm text-stone-700">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full ${
          complete
            ? "bg-emerald-600"
            : "border border-stone-300 bg-stone-100"
        }`}
      >
        {complete ? (
          <span className="block h-2.5 w-1.5 rotate-45 border-b-2 border-r-2 border-white" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
        )}
      </span>
      {label}
    </div>
  );
}
