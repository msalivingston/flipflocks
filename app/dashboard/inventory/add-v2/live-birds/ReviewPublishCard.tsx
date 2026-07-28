"use client";

import type { ReactNode } from "react";
import { disabledButtonClass } from "./constants";
import type { SaveDraftPreflightResult } from "./saveDraftPreflight";
import type { PublishValidationIssue } from "./types";
import { MobileLiveBirdsArtwork } from "./MobileLiveBirdsArtwork";

export function ReviewPublishCard({
  onValidationIssueClick,
  desktopDisabled,
  desktopListingSummary,
  onSaveDraft,
  onMobileOpen,
  onReviewPublish,
  publishDisabledReason,
  publishMessage,
  publishStatus,
  saveDraftDisabledReason,
  saveDraftMessage,
  saveDraftPreflight,
  saveDraftStatus,
  stepLocked = false,
  mobileActive = false,
  validationIssues,
}: {
  onValidationIssueClick?: (issue: PublishValidationIssue) => void;
  desktopDisabled: boolean;
  desktopListingSummary?: ReactNode;
  onSaveDraft: () => void;
  onMobileOpen: () => void;
  onReviewPublish: () => void;
  publishDisabledReason: string | null;
  publishMessage: string | null;
  publishStatus: PublishStatus;
  saveDraftDisabledReason: string | null;
  saveDraftMessage: string | null;
  saveDraftPreflight: SaveDraftPreflightResult;
  saveDraftStatus: SaveDraftStatus;
  stepLocked?: boolean;
  mobileActive?: boolean;
  validationIssues: PublishValidationIssue[];
}) {
  function renderContent() {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col items-center py-3 text-center sm:hidden">
          <span
            aria-hidden="true"
            className="flex size-20 animate-[live-birds-check_280ms_ease-out] items-center justify-center rounded-full bg-emerald-800 text-4xl font-bold text-white shadow-[0_10px_30px_rgba(6,95,70,0.2)]"
          >
            ✓
          </span>
          <p className="mt-4 text-xl font-bold text-stone-950">
            Everything looks good!
          </p>
        </div>
        <div
          className={`hidden items-center gap-5 rounded-lg bg-emerald-50 px-5 py-4 ${
            !stepLocked && validationIssues.length === 0 ? "sm:flex" : ""
          }`}
        >
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-2xl font-bold text-white"
          >
            ✓
          </span>
          <div>
            <p className="text-lg font-bold text-stone-950">
              You&apos;re all set!
            </p>
            <p className="mt-1 text-sm text-stone-600">
              Review the summary below, then publish your inventory.
            </p>
          </div>
        </div>
        <div className="space-y-2 sm:space-y-3">
          <p className="text-base leading-7 text-stone-700">
            Review the details above, then publish when everything looks right.
          </p>
          <p className="text-base leading-7 text-stone-500">
            Published birds will appear in your storefront inventory.
          </p>
        </div>

        <div className="sm:hidden">
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
          <div className="mt-4 flex flex-col-reverse gap-3">
            <SaveDraftButton
              canSaveDraft={saveDraftPreflight.canSaveDraft}
              onSaveDraft={onSaveDraft}
              saveDraftDisabledReason={saveDraftDisabledReason}
              saveDraftStatus={saveDraftStatus}
              stepLocked={stepLocked}
              desktopFullWidth
            />
            <PublishInventoryButton
              onReviewPublish={onReviewPublish}
              publishDisabledReason={publishDisabledReason}
              publishStatus={publishStatus}
              stepLocked={stepLocked}
              desktopFullWidth
            />
          </div>
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          <div className="min-w-0 flex-1">
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
          </div>
          <PublishInventoryButton
            onReviewPublish={onReviewPublish}
            publishDisabledReason={publishDisabledReason}
            publishStatus={publishStatus}
            stepLocked={stepLocked}
          />
          <SaveDraftButton
            canSaveDraft={saveDraftPreflight.canSaveDraft}
            onSaveDraft={onSaveDraft}
            saveDraftDisabledReason={saveDraftDisabledReason}
            saveDraftStatus={saveDraftStatus}
            stepLocked={stepLocked}
          />
        </div>
        {desktopListingSummary ? (
          <div className="hidden sm:block">{desktopListingSummary}</div>
        ) : null}
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
          className="flex min-h-11 w-full items-center gap-3 text-left"
          type="button"
          onClick={onMobileOpen}
        >
          <MobileLiveBirdsArtwork className="size-16 rounded-full" name="ready" />
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-sm font-bold text-white">
            4
          </span>
          <span className="min-w-0 flex-1 text-xl font-bold text-stone-950">
            Ready to Publish
          </span>
          <DisclosureChevron expanded={mobileActive} />
        </button>
        {mobileActive ? (
          <div className="mt-3">{renderContent()}</div>
        ) : (
          <p className="mt-1 flex items-center gap-2 pl-11 text-sm font-semibold leading-5 text-emerald-800">
            <span aria-hidden="true">✓</span>
            Everything ready to publish
          </p>
        )}
      </section>
      <div className="hidden sm:block">
        <section
          className={`rounded-lg border border-stone-200 bg-white p-5 shadow-sm ${
            desktopDisabled || stepLocked
              ? "bg-stone-50/70 opacity-60 shadow-none"
              : ""
          }`}
        >
          <div className="flex min-h-12 w-full items-center gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base font-bold text-emerald-900">
              4
            </span>
            <h2 className="min-w-0 text-xl font-bold text-stone-950">
              Ready to Publish
            </h2>
          </div>
          {!desktopDisabled ? <div className="mt-4">{renderContent()}</div> : null}
        </section>
      </div>
    </>
  );
}

function DisclosureChevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-2.5 w-2.5 shrink-0 border-b-2 border-r-2 border-emerald-800/80 transition-transform ${
        expanded ? "rotate-45" : "-rotate-45"
      }`}
    />
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
  desktopFullWidth = false,
}: {
  canSaveDraft: boolean;
  idleLabel?: string;
  onSaveDraft: () => void;
  saveDraftDisabledReason: string | null;
  saveDraftStatus: SaveDraftStatus;
  successLabel?: string;
  stepLocked?: boolean;
  desktopFullWidth?: boolean;
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
        className={`${disabledButtonClass} w-full ${
          desktopFullWidth ? "sm:w-full" : "sm:w-auto"
        }`}
        disabled
        type="button"
      >
        {label}
      </button>
    );
  }

  return (
    <button
      className={`inline-flex min-h-12 w-full items-center justify-center rounded-md border border-emerald-800/40 bg-white px-5 text-base font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 sm:min-h-10 sm:text-sm sm:font-semibold ${
        desktopFullWidth ? "sm:w-full" : "sm:w-auto"
      }`}
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
  desktopFullWidth = false,
  onReviewPublish,
  publishDisabledReason,
  publishStatus,
  stepLocked = false,
}: {
  desktopFullWidth?: boolean;
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
        className={`inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-md bg-emerald-800/70 px-5 text-base font-bold text-white opacity-65 sm:min-h-10 sm:text-sm sm:font-semibold ${
          desktopFullWidth ? "sm:w-full" : "sm:w-auto"
        }`}
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
      className={`inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-800 px-6 text-lg font-bold text-white shadow-[0_8px_22px_rgba(6,95,70,0.2)] transition-all hover:-translate-y-0.5 hover:bg-emerald-900 active:translate-y-0 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 sm:rounded-md ${
        desktopFullWidth
          ? "sm:min-h-12 sm:w-full sm:text-base"
          : "sm:min-h-10 sm:w-auto sm:px-5 sm:text-sm sm:font-semibold"
      }`}
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
