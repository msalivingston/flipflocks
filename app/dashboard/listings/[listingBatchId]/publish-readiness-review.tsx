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
    <SellerCard className="border-amber-200 bg-amber-50/40 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-amber-700">
            Preview / Review Only
          </p>
          <h2 className="mt-2 text-lg font-semibold text-stone-950">
            Review Before Publish
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            This checklist does not publish by itself. It shows what needs a
            seller review before making the listing visible.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
          <ReadinessCount label="Ready" value={report.summary.readyCount} />
          <ReadinessCount label="Warnings" value={report.summary.warningCount} />
          <ReadinessCount label="Missing" value={report.summary.missingCount} />
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-stone-200 bg-white p-4">
        <h3 className="font-semibold text-stone-950">
          Storefront-visible snapshot
        </h3>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <PreviewItem label="Title" value={report.storefrontPreview.title} />
          <PreviewItem
            label="Species / breed"
            value={report.storefrontPreview.speciesBreed}
          />
          <PreviewItem
            label="Bird groups"
            value={report.storefrontPreview.inventorySummary}
          />
          <PreviewItem
            label="Pricing"
            value={report.storefrontPreview.pricingSummary}
          />
          <PreviewItem
            label="Pickup"
            value={report.storefrontPreview.pickupSummary}
          />
          <PreviewItem
            label="Delivery"
            value={report.storefrontPreview.deliverySummary}
          />
        </dl>
      </div>

      <div className="mt-5 grid gap-4">
        {report.sections.map((section) => (
          <section
            key={section.id}
            className="rounded-lg border border-stone-200 bg-white p-4"
          >
            <h3 className="font-semibold text-stone-950">{section.title}</h3>
            <div className="mt-3 grid gap-3">
              {section.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 rounded-lg bg-stone-50 p-3 sm:flex-row sm:items-start sm:justify-between"
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
          </section>
        ))}
      </div>

      {onPublish ? (
        <div className="mt-5 rounded-lg border border-stone-200 bg-white p-4">
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

function ReadinessCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-16 rounded-lg border border-stone-200 bg-white px-3 py-2">
      <div className="text-base text-stone-950">{value}</div>
      <div className="text-stone-500">{label}</div>
    </div>
  );
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
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
