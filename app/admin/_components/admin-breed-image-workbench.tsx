"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  AdminBreedImageWorkbenchRow,
  AdminBreedImageWorkbenchStatus,
} from "../_lib/admin-types";
import {
  AdminCard,
  AdminErrorState,
  AdminLoadingState,
  AdminMetric,
  AdminPageHeader,
} from "./admin-ui";

type WorkbenchResponse = {
  records?: AdminBreedImageWorkbenchRow[];
  references?: ReferenceCandidate[];
  error?: { code?: string; message?: string };
};

type ReferenceCandidate = {
  id: string;
  image_url: string;
  thumbnail_url: string;
  source_website_url: string;
  source_domain: string;
  caption: string;
  token: string;
};

const statusLabels: Record<AdminBreedImageWorkbenchStatus, string> = {
  not_generated: "Not generated",
  waiting_for_master: "Waiting for master",
  generating: "Generating",
  candidate_ready: "Candidate ready",
  approved: "Approved",
  skipped: "Skipped",
  generation_failed: "Generation failed",
};

export function AdminBreedImageWorkbench() {
  const [records, setRecords] = useState<AdminBreedImageWorkbenchRow[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [referenceFiles, setReferenceFiles] = useState<Record<string, File | null>>({});
  const [referenceResults, setReferenceResults] = useState<Record<string, ReferenceCandidate[]>>({});
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<Record<string, string | null>>({});
  const [busyBreedId, setBusyBreedId] = useState<string | null>(null);
  const [referenceBusyBreedId, setReferenceBusyBreedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    const result = await invokeWorkbench({ action: "list" });
    if (result.error) setError(result.error);
    else setRecords(result.records);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRecords(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRecords]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      const matchesQuery = !normalizedQuery || [
        record.breed_name,
        record.base_breed,
        record.variety ?? "",
        record.slug,
        record.proposed_image_family,
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
      return matchesQuery &&
        (statusFilter === "all" || record.status === statusFilter) &&
        (strategyFilter === "all" || record.image_strategy === strategyFilter);
    });
  }, [query, records, statusFilter, strategyFilter]);

  const counts = useMemo(() => ({
    approved: records.filter((record) => record.status === "approved").length,
    candidate: records.filter((record) => record.status === "candidate_ready").length,
    waiting: records.filter((record) => record.status === "waiting_for_master").length,
    remaining: records.filter((record) => ["not_generated", "generation_failed"].includes(record.status)).length,
  }), [records]);

  async function runAction(record: AdminBreedImageWorkbenchRow, action: "generate" | "approve" | "skip") {
    setBusyBreedId(record.stable_id);
    setError(null);
    setMessage(null);

    const referenceFile = referenceFiles[record.stable_id] ?? null;
    const selectedReference = (referenceResults[record.stable_id] ?? []).find(
      (candidate) => candidate.id === selectedReferenceIds[record.stable_id],
    );
    const result = await invokeWorkbench({
      action,
      breedId: record.stable_id,
      referenceFile: action === "generate" ? referenceFile : null,
      webReferenceToken: action === "generate" && !referenceFile ? selectedReference?.token : undefined,
    });

    if (result.error) {
      setError(`${record.breed_name}: ${result.error}`);
    } else {
      setRecords(result.records);
      setReferenceFiles((current) => ({ ...current, [record.stable_id]: null }));
      setMessage(
        action === "approve"
          ? `${record.breed_name} candidate approved.`
          : action === "skip"
            ? `${record.breed_name} skipped.`
            : `${record.breed_name} candidate generated.`,
      );
    }
    setBusyBreedId(null);
  }

  async function findReferences(record: AdminBreedImageWorkbenchRow) {
    setReferenceBusyBreedId(record.stable_id);
    setError(null);
    setMessage(null);
    const result = await invokeWorkbench({ action: "find_references", breedId: record.stable_id });
    if (result.error) {
      setError(`${record.breed_name}: ${result.error}`);
    } else {
      setReferenceResults((current) => ({ ...current, [record.stable_id]: result.references }));
      setSelectedReferenceIds((current) => ({ ...current, [record.stable_id]: null }));
      setMessage(
        result.references.length > 0
          ? `${record.breed_name}: choose a reference, then generate.`
          : `${record.breed_name}: no useful image references were returned. Try again or upload one.`,
      );
    }
    setReferenceBusyBreedId(null);
  }

  return (
    <>
      <AdminPageHeader
        eyebrow="Temporary internal tool"
        title="Breed Image Workbench"
        description="Generate one candidate at a time, review it privately, and publish it only after explicit approval. The finalized image-family plan controls all master and derivative relationships."
      />

      <div className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 sm:px-7">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AdminMetric label="Approved" value={counts.approved} />
          <AdminMetric label="Candidate ready" value={counts.candidate} />
          <AdminMetric label="Waiting for master" value={counts.waiting} />
          <AdminMetric label="Remaining / retry" value={counts.remaining} />
        </div>

        <AdminCard>
          <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px_220px]">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Search breeds
              <input
                className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-stone-950"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Breed, variety, slug, or family"
                type="search"
                value={query}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Status
              <select className="min-h-11 rounded-md border border-stone-300 bg-white px-3" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="all">All statuses</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Strategy
              <select className="min-h-11 rounded-md border border-stone-300 bg-white px-3" onChange={(event) => setStrategyFilter(event.target.value)} value={strategyFilter}>
                <option value="all">All strategies</option>
                {[...new Set(records.map((record) => record.image_strategy))].sort().map((strategy) => <option key={strategy} value={strategy}>{formatStrategy(strategy)}</option>)}
              </select>
            </label>
          </div>
        </AdminCard>

        {message ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">{message}</div> : null}
        {error ? <AdminErrorState message={error} title="Workbench action failed" /> : null}
        {isLoading ? <AdminLoadingState label="Loading active chicken Breed Library records" /> : null}

        {!isLoading && filteredRecords.length === 0 ? (
          <AdminCard><div className="p-6 text-sm font-semibold text-stone-600">No breeds match these filters.</div></AdminCard>
        ) : null}

        <div className="grid gap-4">
          {filteredRecords.map((record) => {
            const isBusy = busyBreedId === record.stable_id;
            const isReferenceBusy = referenceBusyBreedId === record.stable_id;
            const referenceFile = referenceFiles[record.stable_id];
            const candidates = referenceResults[record.stable_id] ?? [];
            const selectedReferenceId = selectedReferenceIds[record.stable_id] ?? null;
            const generationBlocked = record.status === "waiting_for_master" || isBusy;
            const generateLabel = record.candidate_image_url || record.approved_image_url ? "Regenerate" : "Generate";

            return (
              <AdminCard key={record.stable_id}>
                <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_150px_150px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold text-stone-950">{record.breed_name}</h2>
                        <p className="mt-1 break-all text-xs font-semibold text-stone-500">{record.slug} · {record.stable_id}</p>
                      </div>
                      <StatusBadge status={record.status} />
                    </div>

                    <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <Fact label="Base Breed" value={record.base_breed} />
                      <Fact label="Variety" value={record.variety || "—"} />
                      <Fact label="Breed Category" value={record.breed_category || "—"} />
                      <Fact label="Strategy" value={formatStrategy(record.image_strategy)} />
                      <div className="sm:col-span-2"><Fact label="Image family" value={record.proposed_image_family} /></div>
                      <div className="sm:col-span-2"><Fact label="Master" value={record.proposed_master_record} /></div>
                    </dl>

                    {record.status === "waiting_for_master" ? (
                      <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Approve the listed master before generating this derivative.</p>
                    ) : null}
                    {record.last_error ? <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{record.last_error}</p> : null}

                    <div className="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-stone-900">Reference Images</h3>
                          <p className="mt-0.5 text-xs font-medium text-stone-500">Researches the exact Breed + Variety. You choose what guides generation.</p>
                        </div>
                        <button
                          className="seller-secondary-button"
                          disabled={isReferenceBusy || isBusy}
                          onClick={() => void findReferences(record)}
                          type="button"
                        >
                          {isReferenceBusy ? "Searching…" : candidates.length > 0 ? "Refresh References" : "Find References"}
                        </button>
                      </div>

                      {candidates.length > 0 ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                          {candidates.map((candidate) => {
                            const isSelected = candidate.id === selectedReferenceId && !referenceFile;
                            return (
                              <button
                                aria-pressed={isSelected}
                                className={`overflow-hidden rounded-md border bg-white text-left transition ${isSelected ? "border-emerald-600 ring-2 ring-emerald-200" : "border-stone-200 hover:border-stone-400"}`}
                                key={candidate.id}
                                onClick={() => {
                                  setSelectedReferenceIds((current) => ({ ...current, [record.stable_id]: candidate.id }));
                                  setReferenceFiles((current) => ({ ...current, [record.stable_id]: null }));
                                }}
                                type="button"
                              >
                                <div className="aspect-square bg-stone-100">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img alt={candidate.caption} className="h-full w-full object-cover" loading="lazy" src={candidate.thumbnail_url} />
                                </div>
                                <div className="p-2">
                                  <p className="truncate text-xs font-bold text-stone-800">{candidate.source_domain}</p>
                                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-stone-500">{isSelected ? "Selected · " : ""}{candidate.caption}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <label className="grid gap-1 text-sm font-semibold text-stone-700">
                        Use uploaded reference instead (optional)
                        <input
                          accept="image/jpeg,image/png,image/webp"
                          className="min-h-11 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                          disabled={generationBlocked}
                          key={`${record.stable_id}-${selectedReferenceId ?? "upload"}`}
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            setReferenceFiles((current) => ({ ...current, [record.stable_id]: file }));
                            if (file) setSelectedReferenceIds((current) => ({ ...current, [record.stable_id]: null }));
                          }}
                          type="file"
                        />
                        <span className="text-xs font-medium text-stone-500">{referenceFile ? referenceFile.name : selectedReferenceId ? "Web reference selected above." : "Used only as a generation input; never published automatically."}</span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button className="seller-primary-button" disabled={generationBlocked} onClick={() => void runAction(record, "generate")} type="button">{isBusy ? "Working…" : generateLabel}</button>
                        <button className="seller-secondary-button" disabled={isBusy || record.status !== "candidate_ready"} onClick={() => void runAction(record, "approve")} type="button">Approve</button>
                        <button className="seller-secondary-button" disabled={isBusy} onClick={() => void runAction(record, "skip")} type="button">Skip</button>
                      </div>
                    </div>
                  </div>

                  <ImagePreview label="Approved image" src={toCatalogImageSrc(record.approved_image_url)} emptyLabel="No approved image" />
                  <ImagePreview label="Candidate" src={record.candidate_image_url || ""} emptyLabel="No candidate" />
                </div>
              </AdminCard>
            );
          })}
        </div>
      </div>
    </>
  );
}

async function invokeWorkbench({
  action,
  breedId,
  referenceFile,
  webReferenceToken,
}: {
  action: "list" | "find_references" | "generate" | "approve" | "skip";
  breedId?: string;
  referenceFile?: File | null;
  webReferenceToken?: string;
}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    return { records: [], references: [], error: "Sign in with a platform admin account." };
  }

  let body: FormData | { action: string; breed_id?: string };
  if (action === "generate") {
    const formData = new FormData();
    formData.append("action", action);
    formData.append("breed_id", breedId ?? "");
    if (referenceFile) formData.append("reference_image", referenceFile);
    if (webReferenceToken) formData.append("web_reference_token", webReferenceToken);
    body = formData;
  } else {
    body = { action, ...(breedId ? { breed_id: breedId } : {}) };
  }

  const { data, error } = await supabase.functions.invoke<WorkbenchResponse>("admin-breed-image-workbench", {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return {
    records: data?.records ?? [],
    references: data?.references ?? [],
    error: data?.error?.message ?? error?.message ?? null,
  };
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-bold uppercase tracking-[0.06em] text-stone-500">{label}</dt><dd className="mt-1 font-semibold text-stone-800">{value}</dd></div>;
}

function ImagePreview({ label, src, emptyLabel }: { label: string; src: string; emptyLabel: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-stone-500">{label}</p>
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-50 text-center text-xs font-semibold text-stone-500">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={label} className="h-full w-full object-cover" src={src} />
        ) : <span className="p-3">{emptyLabel}</span>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AdminBreedImageWorkbenchStatus }) {
  const tones: Record<AdminBreedImageWorkbenchStatus, string> = {
    approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    candidate_ready: "bg-sky-50 text-sky-800 ring-sky-200",
    generation_failed: "bg-red-50 text-red-800 ring-red-200",
    generating: "bg-violet-50 text-violet-800 ring-violet-200",
    not_generated: "bg-stone-100 text-stone-700 ring-stone-200",
    skipped: "bg-stone-100 text-stone-700 ring-stone-200",
    waiting_for_master: "bg-amber-50 text-amber-900 ring-amber-200",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${tones[status]}`}>{statusLabels[status]}</span>;
}

function formatStrategy(value: string) {
  return value.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function toCatalogImageSrc(value: string | null | undefined) {
  const imageUrl = value?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!imageUrl) return "";
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) return imageUrl;
  if (imageUrl.startsWith("/storage/v1/object/public/") && supabaseUrl) return `${supabaseUrl}${imageUrl}`;
  if (imageUrl.startsWith("/")) return imageUrl;
  if (supabaseUrl) return `${supabaseUrl}/storage/v1/object/public/${imageUrl}`;
  return `/storage/v1/object/public/${imageUrl}`;
}
