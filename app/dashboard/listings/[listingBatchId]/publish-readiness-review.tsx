"use client";

import { useEffect, useRef } from "react";
import { SellerCard } from "../../_components/seller-ui";
import type { PublishReadinessReport } from "./publish-readiness";

export function PublishReadinessReview({
  isPublishing = false,
  isSavingDraft = false,
  onPublish,
  onSaveDraft,
  publishError,
  report,
  saveDraftError,
}: {
  isPublishing?: boolean;
  isSavingDraft?: boolean;
  onPublish?: () => void;
  onSaveDraft?: () => void;
  publishError?: string | null;
  report: PublishReadinessReport;
  saveDraftError?: string | null;
}) {
  const messageRef = useRef<HTMLDivElement | null>(null);
  const hasBlockers = report.publishGate.blockers.length > 0;
  const hasWarnings = report.publishGate.warnings.length > 0;
  const isBusy = isPublishing || isSavingDraft;

  useEffect(() => {
    if (!publishError && !saveDraftError) return;

    messageRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [publishError, saveDraftError]);

  return (
    <SellerCard className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">
            Review and Publish
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Review the buyer preview above, then publish when the listing is
            ready to appear on your storefront.
          </p>
        </div>
      </div>

      {onPublish || onSaveDraft ? (
        <div className="mt-5 grid gap-4 border-t border-stone-200 pt-5">
          {hasBlockers ? (
            <ReviewList
              items={report.publishGate.blockers}
              title="Fix these before publishing"
              tone="missing"
            />
          ) : null}

          {hasWarnings ? (
            <ReviewList
              items={report.publishGate.warnings}
              title="Worth reviewing"
              tone="warning"
            />
          ) : null}

          {publishError ? (
            <div
              ref={messageRef}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
              tabIndex={-1}
            >
              {publishError}
            </div>
          ) : null}

          {saveDraftError ? (
            <div
              ref={publishError ? undefined : messageRef}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
              tabIndex={-1}
            >
              {saveDraftError}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-stone-600">
              {hasBlockers
                ? "Publishing is locked until the required items above are fixed."
                : hasWarnings
                  ? "These warnings will not block publishing, but buyers will see the listing as-is."
                  : "No blocking issues or warnings are showing."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {onSaveDraft ? (
                <button
                  className="seller-secondary-button min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  onClick={onSaveDraft}
                  type="button"
                >
                  {isSavingDraft ? "Saving Draft" : "Save Draft"}
                </button>
              ) : null}
              {onPublish ? (
                <button
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  disabled={!report.publishGate.canPublish || isBusy}
                  onClick={onPublish}
                  type="button"
                >
                  {isPublishing ? "Publishing" : "Publish Listing"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </SellerCard>
  );
}

function ReviewList({
  items,
  title,
  tone,
}: {
  items: string[];
  title: string;
  tone: "missing" | "warning";
}) {
  const classes =
    tone === "missing"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <div className={`mt-4 rounded-lg border px-4 py-3 ${classes}`}>
      <h4 className="text-sm font-semibold text-stone-950">{title}</h4>
      <ul className="mt-2 grid gap-1 text-sm leading-6">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}
