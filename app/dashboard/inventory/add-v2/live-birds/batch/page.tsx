"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import {
  breedingHistoryOptions,
  featherConditionOptions,
  formatLiveBirdAdvancedDetails,
} from "@/lib/live-bird-advanced-attributes";
import { useSellerContext } from "../../../../_components/seller-context";
import {
  DashboardPageContent,
  SellerPageHeader,
} from "../../../../_components/seller-ui";
import {
  breedLibrarySelect,
  restoreCatalogDefaultPhotoBestEffort,
  sellerBreedProfileSelect,
  sellerMediaSelect,
  type BreedLibraryItem,
  type SellerBreedProfile,
} from "../../../../breeds/breed-data";
import type { ListingPhotoItem } from "../../../../listings/[listingBatchId]/listing-photos-section";
import { BreedCombobox } from "../BreedCombobox";
import {
  createSellerBreedProfileFromCatalogBreed,
  getBreedOptionForProfile,
  getBreedOptionsForSpecies,
  upsertSellerBreedProfile,
} from "../breedProfiles";
import {
  fallbackSpeciesOptions,
  inputClass,
  soldAsOptions,
  supportedSpeciesSlugs,
} from "../constants";
import {
  defaultPriceAdjustment,
  getPriceAdjustmentIssues,
} from "../priceAdjustment";
import type {
  BirdOffering,
  BreedOption,
  PriceAdjustmentState,
  SpeciesOption,
} from "../types";
import {
  addBatchRow,
  createBatchRow,
  duplicateBatchRow,
  groupBatchRows,
  isBatchRowUntouched,
  isBatchRowValid,
  removeBatchRow,
  validateBatchRow,
  type BatchBirdRow,
  type BatchHatchGroup,
  type BatchRowField,
} from "./batchDomain";
import {
  buildBatchCreatePayload,
  getBatchReviewSummary,
  type BatchCreatePayload,
  type BatchCreateResult,
  type BatchReviewSummary,
  type BatchRpcResponse,
} from "./batchPersistence";

type SpeciesRow = {
  id: string;
  common_name: string;
  slug: string;
  sort_order: number | null;
};

type TouchedFields = Record<string, Partial<Record<BatchRowField, boolean>>>;

type ReviewState = {
  hatchGroups: BatchCreatePayload[];
  requestKey: string;
  rows: BatchBirdRow[];
  summary: BatchReviewSummary;
};

export default function BatchAddLiveBirdsPage() {
  const { error: sellerError, isLoading: sellerLoading, seller } =
    useSellerContext();
  const plan = getPlanCapabilities(seller?.plan_key);
  const nextRowNumber = useRef(2);
  const profileCreationPromises = useRef(
    new Map<
      string,
      ReturnType<typeof createSellerBreedProfileFromCatalogBreed>
    >(),
  );
  const [rows, setRows] = useState<BatchBirdRow[]>(() => [
    createBatchRow("batch-row-1"),
  ]);
  const [touchedFields, setTouchedFields] = useState<TouchedFields>({});
  const [reviewAttempted, setReviewAttempted] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<ReviewState | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<
    "idle" | "submitting" | "success"
  >("idle");
  const [submissionResult, setSubmissionResult] =
    useState<BatchCreateResult | null>(null);
  const [serverRowErrors, setServerRowErrors] = useState<Record<string, string>>(
    {},
  );
  const [serverGroupErrors, setServerGroupErrors] = useState<
    Record<string, string>
  >({});
  const [speciesOptions, setSpeciesOptions] = useState<SpeciesOption[]>(
    fallbackSpeciesOptions,
  );
  const [catalogBreeds, setCatalogBreeds] = useState<BreedLibraryItem[]>([]);
  const [sellerBreedProfiles, setSellerBreedProfiles] = useState<
    SellerBreedProfile[]
  >([]);
  const [breedMediaItems, setBreedMediaItems] = useState<ListingPhotoItem[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [priceAdjustments, setPriceAdjustments] = useState<
    Record<string, PriceAdjustmentState>
  >({});
  const hatchGroups = useMemo(() => groupBatchRows(rows), [rows]);
  const hasUnsavedChanges = useMemo(
    () =>
      submissionStatus !== "success" &&
      (rows.length > 1 ||
        rows.some((row) => !isBatchRowUntouched(row)) ||
        Object.values(priceAdjustments).some((rule) => rule.enabled)),
    [priceAdjustments, rows, submissionStatus],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadReferenceData() {
      if (!seller) return;

      setReferenceLoading(true);
      setReferenceError(null);

      const [speciesResult, catalogResult, profilesResult] = await Promise.all([
        supabase
          .from("species")
          .select("id, common_name, slug, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("common_name", { ascending: true })
          .returns<SpeciesRow[]>(),
        supabase
          .from("breeds")
          .select(breedLibrarySelect)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("breed_name", { ascending: true })
          .returns<BreedLibraryItem[]>(),
        supabase
          .from("seller_breed_profiles")
          .select(sellerBreedProfileSelect)
          .eq("store_id", seller.store_id)
          .eq("visibility_status", "active")
          .eq("moderation_status", "normal")
          .order("display_name", { ascending: true })
          .returns<SellerBreedProfile[]>(),
      ]);

      if (!isMounted) return;

      const error =
        speciesResult.error ?? catalogResult.error ?? profilesResult.error;

      if (error) {
        setReferenceError(error.message);
        setReferenceLoading(false);
        return;
      }

      const loadedSpecies = (speciesResult.data ?? [])
        .filter((species) => supportedSpeciesSlugs.includes(species.slug))
        .map((species) => ({
          id: species.id,
          label: species.common_name,
          slug: species.slug,
        }));
      const profiles = profilesResult.data ?? [];
      const mediaResult =
        profiles.length > 0
          ? await supabase
              .from("seller_media_management")
              .select(sellerMediaSelect)
              .eq("store_id", seller.store_id)
              .eq("entity_type", "seller_breed_profile")
              .in(
                "entity_id",
                profiles.map((profile) => profile.id),
              )
              .returns<ListingPhotoItem[]>()
          : { data: [] as ListingPhotoItem[], error: null };

      if (!isMounted) return;

      setSpeciesOptions(
        loadedSpecies.length > 0 ? loadedSpecies : fallbackSpeciesOptions,
      );
      setCatalogBreeds(catalogResult.data ?? []);
      setSellerBreedProfiles(profiles);
      setBreedMediaItems(mediaResult.data ?? []);
      setReferenceError(mediaResult.error?.message ?? null);
      setReferenceLoading(false);
    }

    void loadReferenceData();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    function handleDocumentClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest("a");
      const href = link?.getAttribute("href");
      if (!link || !href || href.startsWith("#") || link.target === "_blank") {
        return;
      }

      const destination = new URL(href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (
        `${destination.pathname}${destination.search}` ===
        `${window.location.pathname}${window.location.search}`
      ) {
        return;
      }

      if (!window.confirm("Leave Batch Add? Your entered rows will be lost.")) {
        event.preventDefault();
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasUnsavedChanges]);

  function createRowId() {
    const id = `batch-row-${nextRowNumber.current}`;
    nextRowNumber.current += 1;
    return id;
  }

  function updateRow(rowId: string, updates: Partial<BatchBirdRow>) {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...updates } : row)),
    );
    invalidateReview();
  }

  function invalidateReview() {
    setReviewMessage(null);
    setReviewState(null);
    setServerRowErrors({});
    setServerGroupErrors({});
  }

  function touchField(rowId: string, field: BatchRowField) {
    setTouchedFields((current) => ({
      ...current,
      [rowId]: { ...current[rowId], [field]: true },
    }));
  }

  function handleSpeciesChange(row: BatchBirdRow, species: SpeciesOption) {
    updateRow(row.id, {
      species,
      breed:
        row.breed?.speciesId === species.id ? row.breed : null,
      breedResolution: "idle",
      breedResolutionMessage: null,
    });
    touchField(row.id, "species");
  }

  async function handleBreedChange(rowId: string, option: BreedOption) {
    updateRow(rowId, {
      breed: option,
      breedResolution: option.id ? "idle" : "resolving",
      breedResolutionMessage: null,
    });
    touchField(rowId, "breed");

    if (option.id || !option.breedId || !seller?.store_id) return;

    const breedId = option.breedId;
    let creation = profileCreationPromises.current.get(breedId);

    if (!creation) {
      creation = createSellerBreedProfileFromCatalogBreed({
        breedId,
        catalogBreeds,
        storeId: seller.store_id,
      });
      profileCreationPromises.current.set(breedId, creation);
    }

    const result = await creation;
    profileCreationPromises.current.delete(breedId);

    if (!result.ok) {
      setRows((current) =>
        current.map((row) =>
          row.breed?.breedId === breedId && !row.breed.id
            ? {
                ...row,
                breedResolution: "error",
                breedResolutionMessage: result.message,
              }
            : row,
        ),
      );
      return;
    }

    if (option.catalogImageUrl) {
      await restoreCatalogDefaultPhotoBestEffort(result.profile.id);
    }

    const nextProfileOption = getBreedOptionForProfile({
      catalogBreeds,
      mediaItems: breedMediaItems,
      profile: result.profile,
    });

    setSellerBreedProfiles((current) =>
      upsertSellerBreedProfile(current, result.profile),
    );
    setRows((current) =>
      current.map((row) =>
        row.breed?.breedId === breedId
          ? {
              ...row,
              breed: nextProfileOption,
              breedResolution: "idle",
              breedResolutionMessage: null,
            }
          : row,
      ),
    );
  }

  function addRow() {
    setRows((current) => addBatchRow(current, createRowId()));
    invalidateReview();
  }

  function removeRow(rowId: string) {
    setRows((current) => removeBatchRow(current, rowId));
    setTouchedFields((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
    invalidateReview();
  }

  function duplicateRow(rowId: string) {
    const duplicateId = createRowId();
    setRows((current) => duplicateBatchRow(current, rowId, duplicateId));
    invalidateReview();
    window.setTimeout(() => {
      Array.from(
        document.querySelectorAll<HTMLInputElement>(
          `[data-batch-quantity-row-id="${duplicateId}"]`,
        ),
      )
        .find((input) => input.offsetParent !== null)
        ?.focus();
    }, 0);
  }

  function handleReview() {
    setReviewAttempted(true);
    const invalidRowCount = rows.filter((row) => !isBatchRowValid(row)).length;
    const pricingIssueCount = hatchGroups.reduce((count, group) => {
      const adjustment = priceAdjustments[group.id] ?? defaultPriceAdjustment;
      return count + getGroupPriceIssues(group, adjustment).length;
    }, 0);

    if (invalidRowCount > 0 || pricingIssueCount > 0) {
      setReviewMessage(
        `${invalidRowCount + pricingIssueCount} item${
          invalidRowCount + pricingIssueCount === 1 ? " needs" : "s need"
        } attention before review.`,
      );
      setReviewState(null);
      return;
    }

    const summary = getBatchReviewSummary({
      groups: hatchGroups,
      priceAdjustments,
    });
    setServerRowErrors({});
    setServerGroupErrors({});
    setReviewState({
      hatchGroups: buildBatchCreatePayload({
        groups: hatchGroups,
        priceAdjustments,
      }),
      requestKey: crypto.randomUUID(),
      rows: rows.map((row) => ({ ...row })),
      summary,
    });
    setReviewMessage("Review the totals below, then add all inventory together.");
  }

  async function handleAddInventory() {
    if (!reviewState || !seller || submissionStatus === "submitting") return;

    setSubmissionStatus("submitting");
    setReviewMessage(null);
    const { data, error } = await supabase.rpc(
      "seller_create_live_bird_batches",
      {
        p_hatch_groups: reviewState.hatchGroups,
        p_request_key: reviewState.requestKey,
        p_store_id: seller.store_id,
      },
    );

    if (error) {
      setSubmissionStatus("idle");
      setReviewMessage(
        "Inventory could not be added. Your entries are still here; please try again.",
      );
      return;
    }

    const response = (Array.isArray(data) ? data[0] : data) as
      | BatchRpcResponse
      | null;
    if (!response?.ok || !response.result) {
      const message = response?.error_message ?? "Inventory could not be added.";
      setSubmissionStatus("idle");
      setReviewState(null);
      setReviewAttempted(true);
      setReviewMessage(message);
      if (response?.error_row_token) {
        setServerRowErrors({ [response.error_row_token]: message });
      }
      if (response?.error_group_token) {
        setServerGroupErrors({ [response.error_group_token]: message });
      }
      window.setTimeout(() => {
        const target = response?.error_row_token
          ? document.querySelector(
              `[data-batch-row-id="${CSS.escape(response.error_row_token)}"]`,
            )
          : response?.error_group_token
            ? document.querySelector(
                `[data-hatch-group-id="${CSS.escape(response.error_group_token)}"]`,
              )
            : null;
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return;
    }

    setSubmissionResult(response.result);
    setSubmissionStatus("success");
    setReviewState(null);
    setReviewMessage(null);
    setTouchedFields({});
    setReviewAttempted(false);
  }

  function resetBatchAdd() {
    nextRowNumber.current = 2;
    setRows([createBatchRow("batch-row-1")]);
    setTouchedFields({});
    setReviewAttempted(false);
    setReviewMessage(null);
    setReviewState(null);
    setSubmissionStatus("idle");
    setSubmissionResult(null);
    setServerRowErrors({});
    setServerGroupErrors({});
    setPriceAdjustments({});
  }

  if (sellerLoading) {
    return (
      <DashboardPageContent>
        <p className="text-sm font-semibold text-stone-600">
          Loading Batch Add...
        </p>
      </DashboardPageContent>
    );
  }

  if (sellerError || !seller) {
    return (
      <DashboardPageContent>
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
          {sellerError ?? "Seller context is unavailable."}
        </p>
      </DashboardPageContent>
    );
  }

  if (submissionStatus === "success" && submissionResult) {
    return (
      <>
        <SellerPageHeader
          eyebrow="Inventory / Add Inventory / Live Birds"
          title="Inventory added"
          description="All hatch groups and bird entries were added together."
        />
        <DashboardPageContent className="bg-stone-50/60 pb-24">
          <section className="mx-auto max-w-3xl rounded-lg border border-emerald-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="grid gap-3 sm:grid-cols-3">
              <SuccessTotal label="Entries created" value={submissionResult.entries_created} />
              <SuccessTotal label="Hatch groups created" value={submissionResult.hatch_groups_created} />
              <SuccessTotal label="Birds added" value={submissionResult.total_birds_added} />
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                className="seller-primary-button"
                href="/dashboard/inventory?tab=live_poultry"
              >
                Return to Inventory
              </Link>
              <button
                className="seller-secondary-button"
                type="button"
                onClick={resetBatchAdd}
              >
                Add More Live Birds
              </button>
            </div>
          </section>
        </DashboardPageContent>
      </>
    );
  }

  return (
    <>
      <SellerPageHeader
        eyebrow="Inventory / Add Inventory / Live Birds"
        title="Batch Add Live Birds"
        description="Enter multiple breeds, hatch dates, and inventory groups together. Each row will become its own Live Birds inventory entry."
        action={
          <Link
            className="seller-secondary-button"
            href="/dashboard/inventory/add-v2/live-birds"
          >
            Normal Add
          </Link>
        }
      />
      <DashboardPageContent className="bg-stone-50/60 pb-24">
        <div className="mx-auto w-full max-w-[1600px] space-y-5">
          <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-stone-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
              <div>
                <h2 className="text-lg font-bold text-stone-950">Bird entries</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-600">
                  Add one row for each inventory lot. Identical rows are allowed
                  and remain separate inventory entries.
                </p>
                {referenceLoading ? (
                  <p className="mt-2 text-sm font-semibold text-stone-500">
                    Loading species and your Breed Library...
                  </p>
                ) : null}
                {referenceError ? (
                  <p className="mt-2 text-sm font-semibold text-amber-800">
                    Some breed information could not be loaded: {referenceError}
                  </p>
                ) : null}
              </div>
              <button
                className="seller-secondary-button shrink-0"
                type="button"
                onClick={addRow}
              >
                Add Row
              </button>
            </div>

            <div className="hidden xl:block">
              <div className="grid grid-cols-[7rem_8.5rem_8.5rem_minmax(12rem,1.3fr)_8rem_7.5rem_8.5rem_9rem_9rem_minmax(9rem,1fr)_8rem] gap-2 border-b border-stone-200 bg-stone-100/80 px-3 py-2 text-xs font-bold uppercase tracking-wide text-stone-600">
                <GridHeading label="Species" />
                <GridHeading label="Hatch Date" />
                <GridHeading label="Available Date" />
                <GridHeading label="Breed" />
                <GridHeading label="Sold As" />
                <GridHeading label="Quantity Available" />
                <GridHeading label="Starting Price" />
                <GridHeading label="Breeding History" />
                <GridHeading label="Feather Condition" />
                <GridHeading label="Barn Location" />
                <GridHeading label="Actions" />
              </div>
              <div className="divide-y divide-stone-200">
                {rows.map((row, index) => (
                  <BatchRowEditor
                    breedOptions={getBreedOptionsForSpecies({
                      catalogBreeds,
                      mediaItems: breedMediaItems,
                      sellerBreedProfiles,
                      species: row.species,
                    })}
                    canRemove={rows.length > 1}
                    errors={validateBatchRow(row)}
                    index={index}
                    key={row.id}
                    mode="grid"
                    reviewAttempted={reviewAttempted}
                    row={row}
                    serverError={serverRowErrors[row.id]}
                    speciesOptions={speciesOptions}
                    touched={touchedFields[row.id] ?? {}}
                    onBreedChange={(option) => void handleBreedChange(row.id, option)}
                    onDuplicate={() => duplicateRow(row.id)}
                    onRemove={() => removeRow(row.id)}
                    onSpeciesChange={(species) => handleSpeciesChange(row, species)}
                    onTouch={(field) => touchField(row.id, field)}
                    onUpdate={(updates) => updateRow(row.id, updates)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-3 p-3 xl:hidden">
              {rows.map((row, index) => (
                <BatchRowEditor
                  breedOptions={getBreedOptionsForSpecies({
                    catalogBreeds,
                    mediaItems: breedMediaItems,
                    sellerBreedProfiles,
                    species: row.species,
                  })}
                  canRemove={rows.length > 1}
                  errors={validateBatchRow(row)}
                  index={index}
                  key={row.id}
                  mode="card"
                  reviewAttempted={reviewAttempted}
                  row={row}
                  serverError={serverRowErrors[row.id]}
                  speciesOptions={speciesOptions}
                  touched={touchedFields[row.id] ?? {}}
                  onBreedChange={(option) => void handleBreedChange(row.id, option)}
                  onDuplicate={() => duplicateRow(row.id)}
                  onRemove={() => removeRow(row.id)}
                  onSpeciesChange={(species) => handleSpeciesChange(row, species)}
                  onTouch={(field) => touchField(row.id, field)}
                  onUpdate={(updates) => updateRow(row.id, updates)}
                />
              ))}
            </div>

            <div className="border-t border-stone-200 px-4 py-4 sm:px-5">
              <button
                className="seller-secondary-button"
                type="button"
                onClick={addRow}
              >
                Add Row
              </button>
            </div>
          </section>

          <HatchGroupsPreview
            groups={hatchGroups}
            locked={!plan.ageBasedPricingEnabled}
            priceAdjustments={priceAdjustments}
            serverErrors={serverGroupErrors}
            onPriceAdjustmentChange={(groupId, updates) => {
              invalidateReview();
              setPriceAdjustments((current) => ({
                ...current,
                [groupId]: {
                  ...(current[groupId] ?? defaultPriceAdjustment),
                  ...updates,
                },
              }));
            }}
          />

          <section className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h2 className="font-bold text-stone-950">Review Batch</h2>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Validate every row and hatch group before adding inventory.
              </p>
              {reviewMessage ? (
                <p
                  className={`mt-2 text-sm font-semibold ${
                    reviewState
                      ? "text-emerald-800"
                      : "text-amber-800"
                  }`}
                >
                  {reviewMessage}
                </p>
              ) : null}
            </div>
            <button
              className="seller-primary-button shrink-0"
              disabled={submissionStatus === "submitting"}
              type="button"
              onClick={handleReview}
            >
              Review Batch
            </button>
          </section>

          {reviewState ? (
            <BatchReview
              state={reviewState}
              submitting={submissionStatus === "submitting"}
              onAddInventory={() => void handleAddInventory()}
              onBack={() => setReviewState(null)}
            />
          ) : null}
        </div>
      </DashboardPageContent>
    </>
  );
}

function GridHeading({ label }: { label: string }) {
  return <div className="flex items-end">{label}</div>;
}

function BatchReview({
  onAddInventory,
  onBack,
  state,
  submitting,
}: {
  onAddInventory: () => void;
  onBack: () => void;
  state: ReviewState;
  submitting: boolean;
}) {
  const summary = state.summary;
  const totals = [
    ["Inventory entries", summary.entryCount],
    ["Hatch groups", summary.hatchGroupCount],
    ["Total birds", summary.totalBirds],
    ["Breeds", summary.breedCount],
    ["Starting-price range", formatPriceRange(summary.minimumPrice, summary.maximumPrice)],
    ["Barn Locations used", summary.barnLocationCount],
    ["Automatic pricing groups", summary.automaticPricingGroupCount],
  ] as const;

  return (
    <section className="rounded-lg border-2 border-emerald-700/30 bg-emerald-50/40 p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-bold text-stone-950">Ready to add inventory</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">
        This creates every entry below in one operation. If any item fails,
        nothing will be added.
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {totals.map(([label, value]) => (
          <div className="rounded-md border border-stone-200 bg-white px-4 py-3" key={label}>
            <dt className="text-xs font-bold uppercase tracking-wide text-stone-500">
              {label}
            </dt>
            <dd className="mt-1 text-lg font-bold text-stone-950">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 overflow-hidden rounded-md border border-stone-200 bg-white">
        <div className="divide-y divide-stone-200">
          {state.rows.map((row) => {
            const advancedDetails = formatLiveBirdAdvancedDetails({
              breedingHistory: row.breedingHistory,
              featherCondition: row.featherCondition,
            });

            return (
              <div
                className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                key={row.id}
              >
                <div className="min-w-0">
                  <p className="font-bold text-stone-950">
                    {row.breed?.label} · {row.soldAs}
                  </p>
                  {advancedDetails ? (
                    <p className="mt-0.5 text-xs font-medium text-stone-600">
                      {advancedDetails}
                    </p>
                  ) : null}
                </div>
                <p className="font-semibold text-stone-700">
                  {row.quantity} birds · {formatPriceRange(Number(row.price), Number(row.price))}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          className="seller-secondary-button"
          disabled={submitting}
          type="button"
          onClick={onBack}
        >
          Back to editing
        </button>
        <button
          className="seller-primary-button"
          disabled={submitting}
          type="button"
          onClick={onAddInventory}
        >
          {submitting ? "Adding Inventory..." : "Add Inventory"}
        </button>
      </div>
    </section>
  );
}

function SuccessTotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-center">
      <p className="text-2xl font-bold text-emerald-900">{value}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
        {label}
      </p>
    </div>
  );
}

function BatchRowEditor({
  breedOptions,
  canRemove,
  errors,
  index,
  mode,
  reviewAttempted,
  row,
  serverError,
  speciesOptions,
  touched,
  onBreedChange,
  onDuplicate,
  onRemove,
  onSpeciesChange,
  onTouch,
  onUpdate,
}: {
  breedOptions: BreedOption[];
  canRemove: boolean;
  errors: ReturnType<typeof validateBatchRow>;
  index: number;
  mode: "grid" | "card";
  reviewAttempted: boolean;
  row: BatchBirdRow;
  serverError?: string;
  speciesOptions: SpeciesOption[];
  touched: Partial<Record<BatchRowField, boolean>>;
  onBreedChange: (option: BreedOption) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onSpeciesChange: (species: SpeciesOption) => void;
  onTouch: (field: BatchRowField) => void;
  onUpdate: (updates: Partial<BatchBirdRow>) => void;
}) {
  const showError = (field: BatchRowField) =>
    Boolean(errors[field]) && (reviewAttempted || Boolean(touched[field]));
  const fields = (
    <>
      <BatchField label="Species" error={showError("species") ? errors.species : null}>
        <select
          aria-label={`Row ${index + 1} Species`}
          className={`${inputClass} appearance-none`}
          value={row.species.id ?? ""}
          onBlur={() => onTouch("species")}
          onChange={(event) => {
            const species = speciesOptions.find(
              (option) => option.id === event.target.value,
            );
            if (species) onSpeciesChange(species);
          }}
        >
          <option value="" disabled>
            Choose
          </option>
          {speciesOptions.map((species) => (
            <option key={species.id ?? species.slug} value={species.id ?? ""}>
              {species.label}
            </option>
          ))}
        </select>
      </BatchField>
      <BatchField
        label="Hatch Date"
        error={showError("hatchDate") ? errors.hatchDate : null}
      >
        <input
          aria-label={`Row ${index + 1} Hatch Date`}
          className={inputClass}
          type="date"
          value={row.hatchDate}
          onBlur={() => onTouch("hatchDate")}
          onChange={(event) => onUpdate({ hatchDate: event.target.value })}
        />
      </BatchField>
      <BatchField
        label="Available Date"
        error={showError("availableDate") ? errors.availableDate : null}
      >
        <input
          aria-label={`Row ${index + 1} Available Date`}
          className={inputClass}
          type="date"
          value={row.availableDate}
          onBlur={() => onTouch("availableDate")}
          onChange={(event) => onUpdate({ availableDate: event.target.value })}
        />
      </BatchField>
      <BatchField label="Breed" error={showError("breed") ? errors.breed : null}>
        <BreedCombobox
          key={`${row.id}:${row.breed?.id ?? row.breed?.breedId ?? "blank"}`}
          fieldName={`batch-${row.id}-breed`}
          onChange={onBreedChange}
          options={breedOptions}
          selectedBreedId={row.breed?.breedId ?? null}
          selectedId={row.breed?.id ?? null}
          value={row.breed?.label ?? ""}
        />
        {row.breedResolution === "resolving" ? (
          <p className="mt-1 text-xs font-semibold text-emerald-800">
            Adding to your Breed Library...
          </p>
        ) : null}
      </BatchField>
      <BatchField label="Sold As" error={showError("soldAs") ? errors.soldAs : null}>
        <select
          aria-label={`Row ${index + 1} Sold As`}
          className={`${inputClass} appearance-none`}
          value={row.soldAs}
          onBlur={() => onTouch("soldAs")}
          onChange={(event) => onUpdate({ soldAs: event.target.value })}
        >
          <option value="" disabled>
            Choose
          </option>
          {soldAsOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </BatchField>
      <BatchField
        label="Quantity Available"
        error={showError("quantity") ? errors.quantity : null}
      >
        <input
          aria-label={`Row ${index + 1} Quantity Available`}
          className={inputClass}
          data-batch-quantity-row-id={row.id}
          inputMode="numeric"
          min="1"
          step="1"
          type="number"
          value={row.quantity}
          onBlur={() => onTouch("quantity")}
          onChange={(event) => onUpdate({ quantity: event.target.value })}
        />
      </BatchField>
      <BatchField
        label="Starting Price"
        error={showError("price") ? errors.price : null}
      >
        <span className="relative block">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-500">
            $
          </span>
          <input
            aria-label={`Row ${index + 1} Starting Price`}
            className={`${inputClass} pl-7`}
            inputMode="decimal"
            min="0.01"
            step="0.01"
            type="number"
            value={row.price}
            onBlur={() => onTouch("price")}
            onChange={(event) => onUpdate({ price: event.target.value })}
          />
        </span>
      </BatchField>
      <BatchField
        label="Breeding History"
        error={
          showError("breedingHistory") ? errors.breedingHistory : null
        }
      >
        <select
          aria-label={`Row ${index + 1} Breeding History`}
          className={`${inputClass} appearance-none`}
          value={row.breedingHistory}
          onBlur={() => onTouch("breedingHistory")}
          onChange={(event) => onUpdate({ breedingHistory: event.target.value })}
        >
          {breedingHistoryOptions.map((option) => (
            <option key={option.value || "unspecified"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </BatchField>
      <BatchField
        label="Feather Condition"
        error={
          showError("featherCondition") ? errors.featherCondition : null
        }
      >
        <select
          aria-label={`Row ${index + 1} Feather Condition`}
          className={`${inputClass} appearance-none`}
          value={row.featherCondition}
          onBlur={() => onTouch("featherCondition")}
          onChange={(event) => onUpdate({ featherCondition: event.target.value })}
        >
          {featherConditionOptions.map((option) => (
            <option key={option.value || "unspecified"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </BatchField>
      <BatchField
        label="Barn Location"
        error={showError("barnLocation") ? errors.barnLocation : null}
      >
        <input
          aria-label={`Row ${index + 1} Barn Location`}
          className={inputClass}
          placeholder="Optional"
          type="text"
          value={row.barnLocation}
          onBlur={() => onTouch("barnLocation")}
          onChange={(event) => onUpdate({ barnLocation: event.target.value })}
        />
        {row.barnLocation.length > 160 ? (
          <p className="mt-1 text-right text-xs font-medium text-stone-500">
            {row.barnLocation.length}/200
          </p>
        ) : null}
      </BatchField>
    </>
  );

  if (mode === "grid") {
    return (
      <div
        className="grid grid-cols-[7rem_8.5rem_8.5rem_minmax(12rem,1.3fr)_8rem_7.5rem_8.5rem_9rem_9rem_minmax(9rem,1fr)_8rem] items-start gap-2 px-3 py-3"
        data-batch-row-id={row.id}
      >
        {fields}
        <RowActions
          canRemove={canRemove}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />
        {serverError ? (
          <p className="col-span-11 rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
            {serverError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
      data-batch-row-id={row.id}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-bold text-stone-950">Entry {index + 1}</h3>
        <RowActions
          canRemove={canRemove}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{fields}</div>
      {serverError ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          {serverError}
        </p>
      ) : null}
    </section>
  );
}

function BatchField({
  children,
  error,
  label,
}: {
  children: React.ReactNode;
  error?: string | null;
  label: string;
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1.5 block text-xs font-bold text-stone-600 xl:sr-only">
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-semibold leading-4 text-red-700">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function RowActions({
  canRemove,
  onDuplicate,
  onRemove,
}: {
  canRemove: boolean;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 xl:flex-col xl:items-start xl:pt-2">
      <button
        className="text-sm font-bold text-emerald-800 underline-offset-4 hover:underline"
        type="button"
        onClick={onDuplicate}
      >
        Duplicate
      </button>
      <button
        className="text-sm font-semibold text-red-600 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-stone-400"
        disabled={!canRemove}
        type="button"
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}

function HatchGroupsPreview({
  groups,
  locked,
  priceAdjustments,
  serverErrors,
  onPriceAdjustmentChange,
}: {
  groups: BatchHatchGroup[];
  locked: boolean;
  priceAdjustments: Record<string, PriceAdjustmentState>;
  serverErrors: Record<string, string>;
  onPriceAdjustmentChange: (
    groupId: string,
    updates: Partial<PriceAdjustmentState>,
  ) => void;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-lg font-bold text-stone-950">Hatch Groups</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">
        Valid rows are grouped when species, hatch date, and available date match.
      </p>
      {groups.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm font-semibold text-stone-600">
          Complete a row to preview its hatch group.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {groups.map((group) => {
            const adjustment =
              priceAdjustments[group.id] ?? defaultPriceAdjustment;

            return (
              <article
                className="rounded-lg border border-stone-200 bg-stone-50/60 p-4"
                data-hatch-group-id={group.id}
                key={group.id}
              >
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                  {group.species.label}
                </p>
                <h3 className="mt-1 text-base font-bold text-stone-950">
                  {formatLongDate(group.hatchDate)} hatch
                </h3>
                <p className="mt-1 text-sm font-medium text-stone-600">
                  Available {formatLongDate(group.availableDate)}
                </p>
                <p className="mt-2 text-sm font-bold text-stone-800">
                  {group.rows.length} {group.rows.length === 1 ? "entry" : "entries"}
                  {" · "}
                  {group.totalQuantity} {group.totalQuantity === 1 ? "bird" : "birds"}
                  {" · "}
                  {formatPriceRange(group.minimumPrice, group.maximumPrice)}
                </p>
                <GroupAutomaticPricing
                  adjustment={adjustment}
                  group={group}
                  locked={locked}
                  onChange={(updates) =>
                    onPriceAdjustmentChange(group.id, updates)
                  }
                />
                {serverErrors[group.id] ? (
                  <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
                    {serverErrors[group.id]}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function GroupAutomaticPricing({
  adjustment,
  group,
  locked,
  onChange,
}: {
  adjustment: PriceAdjustmentState;
  group: BatchHatchGroup;
  locked: boolean;
  onChange: (updates: Partial<PriceAdjustmentState>) => void;
}) {
  const issues = getGroupPriceIssues(group, adjustment);

  return (
    <div className="mt-4 border-t border-stone-200 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-stone-900">
            Automatic Price Changes
          </p>
          <p className="text-xs font-medium text-stone-500">
            Optional for this hatch group
          </p>
        </div>
        <button
          aria-pressed={adjustment.enabled}
          className="min-h-9 rounded-full border border-stone-300 bg-white px-3 text-xs font-bold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={locked}
          type="button"
          onClick={() => onChange({ enabled: !adjustment.enabled })}
        >
          {locked ? "Market plan" : adjustment.enabled ? "On" : "Off"}
        </button>
      </div>
      {adjustment.enabled && !locked ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-stone-600">
            Direction
            <select
              className={`${inputClass} mt-1 appearance-none`}
              value={adjustment.direction}
              onChange={(event) =>
                onChange({
                  direction:
                    event.target.value === "decrease" ? "decrease" : "increase",
                  maxPrice: event.target.value === "increase" ? adjustment.maxPrice : "",
                  minPrice: event.target.value === "decrease" ? adjustment.minPrice : "",
                })
              }
            >
              <option value="increase">Increase</option>
              <option value="decrease">Decrease</option>
            </select>
          </label>
          <PricingNumberField
            label="Amount"
            prefix="$"
            value={adjustment.amount}
            onChange={(amount) => onChange({ amount })}
          />
          <PricingNumberField
            label="Interval"
            suffix="weeks"
            value={adjustment.intervalWeeks}
            onChange={(intervalWeeks) => onChange({ intervalWeeks })}
          />
          <PricingNumberField
            label={adjustment.direction === "increase" ? "Maximum" : "Minimum"}
            prefix="$"
            value={
              adjustment.direction === "increase"
                ? adjustment.maxPrice
                : adjustment.minPrice
            }
            onChange={(value) =>
              adjustment.direction === "increase"
                ? onChange({ maxPrice: value })
                : onChange({ minPrice: value })
            }
          />
          {issues.length > 0 ? (
            <ul className="space-y-1 text-xs font-semibold text-amber-800 sm:col-span-2">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PricingNumberField({
  label,
  onChange,
  prefix,
  suffix,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  value: string;
}) {
  return (
    <label className="text-xs font-bold text-stone-600">
      {label}
      <span className="relative mt-1 block">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">
            {prefix}
          </span>
        ) : null}
        <input
          className={`${inputClass} ${prefix ? "pl-7" : ""} ${
            suffix ? "pr-14" : ""
          }`}
          inputMode={suffix ? "numeric" : "decimal"}
          min="0"
          step={suffix ? "1" : "0.01"}
          type="number"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-stone-500">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function getGroupPriceIssues(
  group: BatchHatchGroup,
  adjustment: PriceAdjustmentState,
) {
  return getPriceAdjustmentIssues({
    offerings: group.rows.map(
      (row): BirdOffering => ({
        id: row.id,
        sellerBreedProfileId: row.breed?.id ?? null,
        breedId: row.breed?.breedId ?? null,
        breed: row.breed?.label ?? "",
        soldAs: row.soldAs,
        quantity: row.quantity,
        price: row.price,
        description: row.breed?.sellerDescription ?? "",
        expanded: false,
      }),
    ),
    priceAdjustment: adjustment,
  });
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatPriceRange(minimum: number | null, maximum: number | null) {
  if (minimum === null || maximum === null) return "Price not entered";

  const format = (value: number) =>
    new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: 2,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      style: "currency",
    }).format(value);

  return minimum === maximum
    ? format(minimum)
    : `${format(minimum)}–${format(maximum)}`;
}
