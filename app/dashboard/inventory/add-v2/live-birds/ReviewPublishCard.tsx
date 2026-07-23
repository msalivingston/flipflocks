"use client";

import { disabledButtonClass } from "./constants";
import { SectionCard } from "./SectionCard";
import type { SaveDraftPreflightResult } from "./saveDraftPreflight";
import type { PublishValidationIssue } from "./types";

export function ReviewPublishCard({
  onValidationIssueClick,
  onSaveDraft,
  onReviewPublish,
  publishDisabledReason,
  publishMessage,
  publishStatus,
  saveDraftDisabledReason,
  saveDraftMessage,
  saveDraftPreflight,
  saveDraftStatus,
  stepLocked = false,
  validationIssues,
}: {
  onValidationIssueClick?: (issue: PublishValidationIssue) => void;
  onSaveDraft: () => void;
  onReviewPublish: () => void;
  publishDisabledReason: string | null;
  publishMessage: string | null;
  publishStatus: PublishStatus;
  saveDraftDisabledReason: string | null;
  saveDraftMessage: string | null;
  saveDraftPreflight: SaveDraftPreflightResult;
  saveDraftStatus: SaveDraftStatus;
  stepLocked?: boolean;
  validationIssues: PublishValidationIssue[];
}) {
  function renderContent() {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="space-y-2 sm:space-y-3">
          <p className="text-base leading-7 text-stone-700">
            Review the details above, then publish when everything looks right.
          </p>
          <p className="text-base leading-7 text-stone-500">
            Published birds will appear in your storefront inventory.
          </p>
        </div>

        {!stepLocked ? (
          <FinalActionStatus
            onValidationIssueClick={onValidationIssueClick}
            publishDisabledReason={publishDisabledReason}
            publishMessage={publishMessage}
            publishStatus={publishStatus}
            saveDraftDisabledReason={saveDraftDisabledReason}
            saveDraftMessage={saveDraftMessage}
            saveDraftStatus={saveDraftStatus}
            validationIssues={validationIssues}
          />
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
          <SaveDraftButton
            canSaveDraft={saveDraftPreflight.canSaveDraft}
            onSaveDraft={onSaveDraft}
            saveDraftDisabledReason={saveDraftDisabledReason}
            saveDraftStatus={saveDraftStatus}
            stepLocked={stepLocked}
          />
          <PublishInventoryButton
            onReviewPublish={onReviewPublish}
            publishDisabledReason={publishDisabledReason}
            publishStatus={publishStatus}
            stepLocked={stepLocked}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <section
        className={`rounded-xl border border-transparent bg-white p-5 shadow-sm sm:hidden ${
          stepLocked ? "opacity-60" : ""
        }`}
      >
        <div className="flex min-h-11 w-full items-center gap-3 text-left">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base font-bold text-emerald-900">
            4
          </span>
          <span className="min-w-0 flex-1 text-xl font-bold text-stone-950">
            Ready to publish?
          </span>
        </div>
        <div className="mt-3">{renderContent()}</div>
      </section>
      <div className="hidden sm:block">
        <SectionCard
          className={stepLocked ? "opacity-60" : ""}
          step="4"
          title="Ready to publish?"
        >
          {renderContent()}
        </SectionCard>
      </div>
    </>
  );
}

function FinalActionStatus({
  onValidationIssueClick,
  publishDisabledReason,
  publishMessage,
  publishStatus,
  saveDraftDisabledReason,
  saveDraftMessage,
  saveDraftStatus,
  validationIssues,
}: {
  onValidationIssueClick?: (issue: PublishValidationIssue) => void;
  publishDisabledReason: string | null;
  publishMessage: string | null;
  publishStatus: PublishStatus;
  saveDraftDisabledReason: string | null;
  saveDraftMessage: string | null;
  saveDraftStatus: SaveDraftStatus;
  validationIssues: PublishValidationIssue[];
}) {
  const messages = [
    saveDraftMessage
      ? {
          key: "save",
          status: saveDraftStatus,
          text: saveDraftMessage,
        }
      : null,
    publishMessage
      ? {
          key: "publish",
          status: publishStatus,
          text: publishMessage,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    status: SaveDraftStatus | PublishStatus;
    text: string;
  }>;
  const visibleDisabledReason =
    publishStatus === "success" || publishStatus === "publishing"
      ? null
      : saveDraftDisabledReason ?? publishDisabledReason;

  if (
    messages.length === 0 &&
    validationIssues.length === 0
  ) {
    return (
      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-base font-semibold leading-7 text-emerald-800">
        Everything is ready to publish.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {messages.map((message) => (
        <p
          className={`rounded-md border px-3 py-2 text-base font-semibold leading-7 ${getStatusMessageClass(
            message.status,
          )}`}
          key={message.key}
        >
          {message.text}
        </p>
      ))}
      {visibleDisabledReason && validationIssues.length === 0 ? (
        <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-base font-semibold leading-7 text-stone-700">
          {visibleDisabledReason}
        </p>
      ) : null}
      {validationIssues.length > 0 ? (
        <PreflightList
          items={validationIssues}
          onValidationIssueClick={onValidationIssueClick}
        />
      ) : null}
    </div>
  );
}

function PreflightList({
  items,
  onValidationIssueClick,
}: {
  items: PublishValidationIssue[];
  onValidationIssueClick?: (issue: PublishValidationIssue) => void;
}) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-base text-amber-900">
      <p className="font-semibold">Finish these details before publishing:</p>
      <ul className="mt-2 space-y-1 text-base font-medium leading-7">
        {items.map((item) => (
          <li key={item.id}>
            {onValidationIssueClick ? (
              <button
                className="text-left underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:ring-offset-2"
                type="button"
                onClick={() => onValidationIssueClick(item)}
              >
                {item.message}
              </button>
            ) : (
              item.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SaveDraftButton({
  canSaveDraft,
  idleLabel = "Save draft",
  onSaveDraft,
  saveDraftDisabledReason,
  saveDraftStatus,
  successLabel = "Draft saved",
  stepLocked = false,
}: {
  canSaveDraft: boolean;
  idleLabel?: string;
  onSaveDraft: () => void;
  saveDraftDisabledReason: string | null;
  saveDraftStatus: SaveDraftStatus;
  successLabel?: string;
  stepLocked?: boolean;
}) {
  const disabled =
    stepLocked ||
    Boolean(saveDraftDisabledReason) ||
    !canSaveDraft ||
    saveDraftStatus === "saving" ||
    saveDraftStatus === "success";
  const label = getSaveDraftButtonLabel(saveDraftStatus, idleLabel, successLabel);

  if (disabled) {
    return (
      <button
        className={`${disabledButtonClass} w-full sm:w-auto`}
        disabled
        type="button"
      >
        {label}
      </button>
    );
  }

  return (
    <button
      className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-emerald-800/40 bg-white px-5 text-base font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 sm:min-h-10 sm:w-auto sm:text-sm sm:font-semibold"
      onClick={onSaveDraft}
      type="button"
    >
      {label}
    </button>
  );
}

export type SaveDraftStatus = "idle" | "saving" | "success" | "error";
export type PublishStatus = "idle" | "publishing" | "success" | "error";

export function PublishInventoryButton({
  onReviewPublish,
  publishDisabledReason,
  publishStatus,
  stepLocked = false,
}: {
  onReviewPublish: () => void;
  publishDisabledReason: string | null;
  publishStatus: PublishStatus;
  stepLocked?: boolean;
}) {
  const disabled =
    stepLocked ||
    Boolean(publishDisabledReason) ||
    publishStatus === "publishing" ||
    publishStatus === "success";
  const label = getPublishInventoryButtonLabel(publishStatus);

  if (disabled) {
    return (
      <button
        className="inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-md bg-emerald-800/70 px-5 text-base font-bold text-white opacity-65 sm:min-h-10 sm:w-auto sm:text-sm sm:font-semibold"
        disabled
        title={stepLocked ? undefined : publishDisabledReason ?? undefined}
        type="button"
      >
        {label}
      </button>
    );
  }

  return (
    <button
      className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-emerald-800 px-5 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 sm:min-h-10 sm:w-auto sm:text-sm sm:font-semibold"
      onClick={onReviewPublish}
      type="button"
    >
      {label}
    </button>
  );
}

function getSaveDraftButtonLabel(
  saveDraftStatus: SaveDraftStatus,
  idleLabel: string,
  successLabel: string,
) {
  if (saveDraftStatus === "saving") return "Saving...";
  if (saveDraftStatus === "success") return successLabel;

  return idleLabel;
}

function getPublishInventoryButtonLabel(publishStatus: PublishStatus) {
  if (publishStatus === "publishing") return "Publishing...";
  if (publishStatus === "success") return "Published";

  return "Publish inventory";
}

function getStatusMessageClass(status: SaveDraftStatus | PublishStatus) {
  return status === "error"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-800";
}
