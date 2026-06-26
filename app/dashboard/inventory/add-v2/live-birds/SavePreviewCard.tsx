"use client";

import { useState } from "react";
import type { SavePayloadPreview } from "./payloadPreview";

export function SavePreviewCard({
  payloadPreview,
}: {
  payloadPreview: SavePayloadPreview;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">
            Developer save preview
          </h2>
          <p className="mt-1 text-sm font-semibold text-emerald-800">
            Preview only — nothing is saved yet.
          </p>
        </div>
        <button
          aria-expanded={isExpanded}
          className="inline-flex min-h-11 w-fit items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2 sm:min-h-9 sm:text-xs"
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {isExpanded ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <PreviewMetric
              label="Batch target"
              value={payloadPreview.listingBatch.batchType}
            />
            <PreviewMetric
              label="Breed groups"
              value={String(payloadPreview.listingBatchBreeds.length)}
            />
            <PreviewMetric
              label="Inventory rows"
              value={String(payloadPreview.inventoryItems.length)}
            />
          </div>
          <pre className="mt-4 max-h-96 overflow-auto rounded-md border border-stone-200 bg-stone-950 p-4 text-xs leading-5 text-stone-50">
            {JSON.stringify(payloadPreview, null, 2)}
          </pre>
        </>
      ) : null}
    </section>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50/70 px-3 py-2">
      <p className="text-sm font-semibold text-stone-500 sm:text-xs">{label}</p>
      <p className="mt-1 text-base font-semibold text-stone-950 sm:text-sm">{value}</p>
    </div>
  );
}
