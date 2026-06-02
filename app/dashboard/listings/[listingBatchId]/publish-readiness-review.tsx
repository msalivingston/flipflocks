import { SellerCard } from "../../_components/seller-ui";
import type { PublishReadinessReport, PublishReadinessStatus } from "./publish-readiness";

export function PublishReadinessReview({
  isPublishing = false,
  onPublish,
  publishError,
  report,
}: {
  isPublishing?: boolean;
  onPublish?: () => void;
  publishError?: string | null;
  report: PublishReadinessReport;
}) {
  return (
    <SellerCard className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">
            Ready to Publish
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Check the few things buyers need before this listing goes live.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {report.checklist.map((item) => (
          <div
            key={item.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3"
          >
            <div>
              <p className="text-sm font-semibold text-stone-950">
                {item.label}
              </p>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                {item.message}
              </p>
            </div>
            <ReadinessBadge status={item.status} />
          </div>
        ))}
      </div>

      <dl className="mt-5 grid gap-2 rounded-lg border border-stone-200 bg-white p-4 text-sm sm:grid-cols-3">
        {report.policyStatuses.map((policy) => (
          <div key={policy.label}>
            <dt className="font-semibold text-stone-600">{policy.label}</dt>
            <dd className="mt-1 font-semibold text-stone-950">
              {policy.value}
            </dd>
          </div>
        ))}
      </dl>

      {onPublish ? (
        <div className="mt-5 border-t border-stone-200 pt-5">
          <h3 className="font-semibold text-stone-950">Publish listing</h3>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Publishing makes this listing visible to buyers on your storefront.
          </p>

          {report.publishGate.blockers.length > 0 ? (
            <ReviewList
              items={report.publishGate.blockers}
              title="Fix these before publishing"
              tone="missing"
            />
          ) : null}

          {report.publishGate.warnings.length > 0 ? (
            <ReviewList
              items={report.publishGate.warnings}
              title="Warnings to review"
              tone="warning"
            />
          ) : null}

          {publishError ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
              {publishError}
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-stone-600">
              {report.publishGate.canPublish
                ? "This listing has no blocking issues. Review any warnings before continuing."
                : "The publish button is locked until blocking issues are fixed."}
            </p>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!report.publishGate.canPublish || isPublishing}
              onClick={onPublish}
              type="button"
            >
              {isPublishing ? "Publishing" : "Publish listing"}
            </button>
          </div>
        </div>
      ) : null}
    </SellerCard>
  );
}

function ReadinessBadge({ status }: { status: PublishReadinessStatus }) {
  const tone = {
    ready: "bg-emerald-100 text-emerald-800",
    warning: "bg-amber-100 text-amber-800",
    missing: "bg-red-100 text-red-800",
    info: "bg-sky-100 text-sky-800",
  }[status];

  const label = {
    ready: "Ready",
    warning: "Warning",
    missing: "Missing",
    info: "Review",
  }[status];

  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
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
