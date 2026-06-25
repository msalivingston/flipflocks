import { disabledButtonClass } from "./constants";
import { SectionCard } from "./SectionCard";
import type { SaveDraftPreflightResult } from "./saveDraftPreflight";

export function ReviewPublishCard({
  onSaveDraft,
  onReviewPublish,
  publishDisabledReason,
  publishMessage,
  publishStatus,
  saveDraftDisabledReason,
  saveDraftMessage,
  saveDraftPreflight,
  saveDraftStatus,
}: {
  onSaveDraft: () => void;
  onReviewPublish: () => void;
  publishDisabledReason: string | null;
  publishMessage: string | null;
  publishStatus: PublishStatus;
  saveDraftDisabledReason: string | null;
  saveDraftMessage: string | null;
  saveDraftPreflight: SaveDraftPreflightResult;
  saveDraftStatus: SaveDraftStatus;
}) {
  return (
    <SectionCard step="4" title="Ready to publish?">
      <div className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm leading-6 text-stone-700">
            Review the details above, then publish when everything looks right.
          </p>
          <p className="text-sm leading-6 text-stone-500">
            Published birds will appear in your storefront inventory.
          </p>
        </div>

        <FinalActionStatus
          preflight={saveDraftPreflight}
          publishDisabledReason={publishDisabledReason}
          publishMessage={publishMessage}
          publishStatus={publishStatus}
          saveDraftDisabledReason={saveDraftDisabledReason}
          saveDraftMessage={saveDraftMessage}
          saveDraftStatus={saveDraftStatus}
        />

        <div className="flex flex-wrap justify-end gap-3">
          <SaveDraftButton
            canSaveDraft={saveDraftPreflight.canSaveDraft}
            onSaveDraft={onSaveDraft}
            saveDraftDisabledReason={saveDraftDisabledReason}
            saveDraftStatus={saveDraftStatus}
          />
          <PublishInventoryButton
            onReviewPublish={onReviewPublish}
            publishDisabledReason={publishDisabledReason}
            publishStatus={publishStatus}
          />
        </div>
      </div>
    </SectionCard>
  );
}

function FinalActionStatus({
  preflight,
  publishDisabledReason,
  publishMessage,
  publishStatus,
  saveDraftDisabledReason,
  saveDraftMessage,
  saveDraftStatus,
}: {
  preflight: SaveDraftPreflightResult;
  publishDisabledReason: string | null;
  publishMessage: string | null;
  publishStatus: PublishStatus;
  saveDraftDisabledReason: string | null;
  saveDraftMessage: string | null;
  saveDraftStatus: SaveDraftStatus;
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
    publishStatus === "success"
      ? null
      : saveDraftDisabledReason ?? publishDisabledReason;

  if (
    messages.length === 0 &&
    !visibleDisabledReason &&
    preflight.blockingIssues.length === 0
  ) {
    return null;
  }

  return (
    <div className="space-y-2">
      {messages.map((message) => (
        <p
          className={`rounded-md border px-3 py-2 text-sm font-semibold ${getStatusMessageClass(
            message.status,
          )}`}
          key={message.key}
        >
          {message.text}
        </p>
      ))}
      {visibleDisabledReason ? (
        <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700">
          {visibleDisabledReason}
        </p>
      ) : null}
      {preflight.blockingIssues.length > 0 ? (
        <PreflightList items={preflight.blockingIssues} />
      ) : null}
    </div>
  );
}

function PreflightList({ items }: { items: string[] }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
      <p className="font-semibold">Finish these details before publishing.</p>
      <ul className="mt-2 space-y-1 text-xs font-medium leading-5">
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
      className="inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-800/40 bg-white px-5 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
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
}: {
  onReviewPublish: () => void;
  publishDisabledReason: string | null;
  publishStatus: PublishStatus;
}) {
  const disabled =
    Boolean(publishDisabledReason) ||
    publishStatus === "publishing" ||
    publishStatus === "success";
  const label = getPublishInventoryButtonLabel(publishStatus);

  if (disabled) {
    return (
      <button
        className="inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-md bg-emerald-800/70 px-5 text-sm font-semibold text-white opacity-65"
        disabled
        title={publishDisabledReason ?? undefined}
        type="button"
      >
        {label}
      </button>
    );
  }

  return (
    <button
      className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
      onClick={onReviewPublish}
      type="button"
    >
      {label}
    </button>
  );
}

function getSaveDraftButtonLabel(saveDraftStatus: SaveDraftStatus) {
  if (saveDraftStatus === "saving") return "Saving...";
  if (saveDraftStatus === "success") return "Draft saved";

  return "Save draft";
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
