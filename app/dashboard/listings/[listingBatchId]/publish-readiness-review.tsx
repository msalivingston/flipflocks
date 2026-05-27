import { SellerCard } from "../../_components/seller-ui";
import type { PublishReadinessReport, PublishReadinessStatus } from "./publish-readiness";

export function PublishReadinessReview({
  report,
}: {
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
            This checklist does not publish the listing. It shows what needs a
            seller review before a future go-live step exists.
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
            label="Inventory"
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
