"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../_components/seller-context";
import {
  DashboardPageContent,
  SellerPageHeader,
} from "../../_components/seller-ui";
import { liveBirdsV2DraftMarker } from "./live-birds/constants";

type InventoryOption = {
  title: string;
  description: string;
  glyph: string;
  href?: string;
};

const inventoryOptions: InventoryOption[] = [
  {
    title: "Live Birds",
    description: "Start the new inventory flow for birds available now or soon.",
    glyph: "/glyphs/hen.png",
    href: "/dashboard/inventory/add-v2/live-birds",
  },
  {
    title: "Hatching Eggs",
    description: "Create egg inventory for pickup or shipping once v2 is ready.",
    glyph: "/glyphs/egg-carton.png",
  },
  {
    title: "Processed Poultry",
    description: "Add local pickup poultry products in a future v2 flow.",
    glyph: "/glyphs/chicken-leg.png",
  },
  {
    title: "Equipment & Supplies",
    description: "List brooders, incubators, feed, and supplies later.",
    glyph: "/glyphs/feed-sack.png",
  },
];

type DraftRow = {
  listing_batch_id: string;
  listing_batch_breed_id: string;
  inventory_item_id: string;
  species_name: string | null;
  origin_date: string | null;
  available_date: string | null;
  listing_batch_updated_at: string | null;
  inventory_updated_at: string | null;
};

type SavedDraft = {
  id: string;
  speciesName: string | null;
  hatchDate: string | null;
  availableDate: string | null;
  offeringCount: number;
  breedGroupCount: number;
  lastSavedAt: string | null;
};

export default function AddInventoryV2Page() {
  const { seller } = useSellerContext();
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const savedDrafts = useMemo(() => getSavedDrafts(draftRows), [draftRows]);

  useEffect(() => {
    let isMounted = true;

    async function loadSavedDrafts() {
      if (!seller) return;

      setDraftsLoading(true);
      setDraftsError(null);

      const { data, error } = await supabase
        .from("seller_inventory_management")
        .select(
          "listing_batch_id, listing_batch_breed_id, inventory_item_id, species_name, origin_date, available_date, listing_batch_updated_at, inventory_updated_at",
        )
        .eq("store_id", seller.store_id)
        .eq("batch_type", "live_animals")
        .eq("listing_batch_visibility_status", "hidden")
        .eq("internal_batch_label", liveBirdsV2DraftMarker)
        .order("listing_batch_updated_at", { ascending: false })
        .returns<DraftRow[]>();

      if (!isMounted) return;

      if (error) {
        setDraftsError(error.message);
        setDraftRows([]);
        setDraftsLoading(false);
        return;
      }

      setDraftRows(data ?? []);
      setDraftsLoading(false);
    }

    void loadSavedDrafts();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  return (
    <>
      <SellerPageHeader
        title="Add Inventory"
        description="Choose what you want to add to your storefront."
      />
      <DashboardPageContent>
        <div className="grid max-w-5xl gap-4 md:grid-cols-2">
          {inventoryOptions.map((option) => (
            <InventoryOptionCard key={option.title} option={option} />
          ))}
        </div>
        <SavedDraftsSection
          drafts={savedDrafts}
          error={draftsError}
          isLoading={draftsLoading}
        />
      </DashboardPageContent>
    </>
  );
}

function InventoryOptionCard({ option }: { option: InventoryOption }) {
  const cardContent = (
    <>
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-emerald-100 bg-emerald-50">
        <Image src={option.glyph} alt="" width={36} height={36} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-stone-950">
            {option.title}
          </h2>
          {option.href ? null : (
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-600">
              Coming soon
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          {option.description}
        </p>
      </div>
    </>
  );

  const className =
    "flex min-h-40 gap-4 rounded-lg border border-stone-200 bg-white p-5 text-left shadow-sm transition";

  if (option.href) {
    return (
      <Link
        className={`${className} hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2`}
        href={option.href}
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <div
      aria-disabled="true"
      className={`${className} cursor-not-allowed opacity-70`}
    >
      {cardContent}
    </div>
  );
}

function SavedDraftsSection({
  drafts,
  error,
  isLoading,
}: {
  drafts: SavedDraft[];
  error: string | null;
  isLoading: boolean;
}) {
  if (isLoading || (!error && drafts.length === 0)) return null;

  return (
    <section className="mt-6 max-w-5xl rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">
            Saved drafts
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Hidden Add Inventory drafts that are not published yet.
          </p>
        </div>
      </div>
      {error ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
          Saved drafts could not be loaded. {error}
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {drafts.map((draft) => (
            <SavedDraftCard key={draft.id} draft={draft} />
          ))}
        </div>
      )}
    </section>
  );
}

function SavedDraftCard({ draft }: { draft: SavedDraft }) {
  return (
    <article className="rounded-lg border border-stone-200 bg-stone-50/60 px-4 py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-stone-950">
              Live Birds
            </h3>
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">
              Draft
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-sm text-stone-600 sm:grid-cols-2 lg:grid-cols-3">
            <DraftMeta label="Species" value={draft.speciesName} />
            <DraftMeta label="Hatch date" value={formatDate(draft.hatchDate)} />
            <DraftMeta
              label="Available date"
              value={formatDate(draft.availableDate)}
            />
            <DraftMeta
              label="Offerings"
              value={`${draft.offeringCount} offering${
                draft.offeringCount === 1 ? "" : "s"
              }`}
            />
            <DraftMeta
              label="Breed groups"
              value={`${draft.breedGroupCount} group${
                draft.breedGroupCount === 1 ? "" : "s"
              }`}
            />
            <DraftMeta
              label="Last saved"
              value={formatDateTime(draft.lastSavedAt)}
            />
          </div>
          <p className="mt-3 text-sm leading-6 text-stone-500">
            Draft saved. Continue editing is coming next.
          </p>
        </div>
        <button
          className="inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-md border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-400"
          disabled
          type="button"
        >
          Continue coming soon
        </button>
      </div>
    </article>
  );
}

function DraftMeta({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-stone-500">{label}</p>
      <p className="mt-0.5 font-semibold text-stone-800">
        {value || "Not set"}
      </p>
    </div>
  );
}

function getSavedDrafts(rows: DraftRow[]) {
  const draftMap = new Map<
    string,
    {
      availableDate: string | null;
      breedGroupIds: Set<string>;
      hatchDate: string | null;
      id: string;
      inventoryItemIds: Set<string>;
      lastSavedAt: string | null;
      speciesName: string | null;
    }
  >();

  rows.forEach((row) => {
    const existing =
      draftMap.get(row.listing_batch_id) ??
      {
        availableDate: row.available_date,
        breedGroupIds: new Set<string>(),
        hatchDate: row.origin_date,
        id: row.listing_batch_id,
        inventoryItemIds: new Set<string>(),
        lastSavedAt: null,
        speciesName: row.species_name,
      };

    existing.breedGroupIds.add(row.listing_batch_breed_id);
    existing.inventoryItemIds.add(row.inventory_item_id);
    existing.lastSavedAt = getLatestTimestamp(
      existing.lastSavedAt,
      row.listing_batch_updated_at,
      row.inventory_updated_at,
    );
    draftMap.set(row.listing_batch_id, existing);
  });

  return Array.from(draftMap.values()).map((draft) => ({
    id: draft.id,
    speciesName: draft.speciesName,
    hatchDate: draft.hatchDate,
    availableDate: draft.availableDate,
    offeringCount: draft.inventoryItemIds.size,
    breedGroupCount: draft.breedGroupIds.size,
    lastSavedAt: draft.lastSavedAt,
  }));
}

function getLatestTimestamp(...values: Array<string | null>) {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);

  if (timestamps.length === 0) return null;

  return new Date(Math.max(...timestamps)).toISOString();
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    year: "numeric",
  }).format(date);
}
