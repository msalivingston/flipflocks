import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  getPlanCapabilities,
  type PlanCapabilities,
} from "@/lib/plan-capabilities";
import {
  inputClass,
  mutedTextActionClass,
  soldAsOptions,
} from "./constants";
import { getBirdsForSaleGroupCount, getNumberInputValue } from "./helpers";
import {
  ListingPhotosSection,
  type ListingPhotoItem,
} from "../../../listings/[listingBatchId]/listing-photos-section";
import { toDisplayImageUrl } from "../../../breeds/breed-data";
import { SectionCard } from "./SectionCard";
import { MobileLiveBirdsArtwork } from "./MobileLiveBirdsArtwork";
import { EntryPhotoControl } from "./EntryPhotoControl";
import type { BirdOffering, BreedOption } from "./types";

export function BirdOfferingsCard({
  addOffering,
  breedMediaItemsByProfileId,
  entryMediaItemsByInventoryItemId,
  editPriceSummariesByOfferingId = {},
  editCurrentAgeLabel,
  breedOptions,
  breedOptionsMessage,
  canAddCustomBreed,
  completionErrorMessage,
  duplicateOfferingIds,
  desktopActive,
  desktopDisabled,
  desktopPanelMode = false,
  groupsReviewMode,
  mobileActive,
  offerings,
  onDoneAddingGroups,
  onDesktopOpen,
  onMobileOpen,
  onOpenCustomBreedModal,
  prepareBreedPhotoProfile,
  removeOffering,
  scrollToOfferingId,
  storeId,
  stepLocked,
  toggleOfferingExpanded,
  updateBreedDescription,
  updateOffering,
  updateOfferingBreed,
  onBreedPhotosChanged,
  onEntryPhotosChanged,
  onPendingEntryPhotoChange,
  onPendingEntryPhotoRemove,
  pendingEntryPhotosByOfferingId,
  pendingRemovedOfferings = [],
  removeBlockedInventoryItemIds = new Set<string>(),
  undoPendingRemoval,
  planKey,
  mode = "create",
}: {
  addOffering: () => void;
  breedMediaItemsByProfileId: Record<string, ListingPhotoItem[]>;
  entryMediaItemsByInventoryItemId: Record<string, ListingPhotoItem[]>;
  editPriceSummariesByOfferingId?: Record<
    string,
    {
      after: string;
      current: string;
      currentStarting: string;
      newStarting: string;
    }
  >;
  editCurrentAgeLabel?: string | null;
  breedOptions: BreedOption[];
  breedOptionsMessage: string | null;
  canAddCustomBreed: boolean;
  completionErrorMessage?: string | null;
  duplicateOfferingIds: Set<string>;
  desktopActive: boolean;
  desktopDisabled: boolean;
  desktopPanelMode?: boolean;
  groupsReviewMode: boolean;
  mobileActive: boolean;
  offerings: BirdOffering[];
  onDoneAddingGroups: () => void;
  onDesktopOpen: () => void;
  onMobileOpen: () => void;
  onOpenCustomBreedModal: (offeringId: string) => void;
  prepareBreedPhotoProfile: (offeringId: string) => void;
  removeOffering: (offeringId: string) => void;
  scrollToOfferingId: string | null;
  storeId: string;
  stepLocked?: boolean;
  toggleOfferingExpanded: (offeringId: string) => void;
  updateBreedDescription: (offeringId: string, description: string) => void;
  updateOffering: (
    offeringId: string,
    updates: Partial<Omit<BirdOffering, "id">>,
  ) => void;
  updateOfferingBreed: (offeringId: string, option: BreedOption) => void;
  onBreedPhotosChanged: () => void;
  onEntryPhotosChanged: () => void;
  onPendingEntryPhotoChange: (offeringId: string, file: File) => void;
  onPendingEntryPhotoRemove: (offeringId: string) => void;
  pendingEntryPhotosByOfferingId: Record<
    string,
    { error: string | null; file: File; previewUrl: string }
  >;
  pendingRemovedOfferings?: Array<{ index: number; offering: BirdOffering }>;
  removeBlockedInventoryItemIds?: Set<string>;
  undoPendingRemoval?: (offeringId: string) => void;
  planKey?: string | null;
  mode?: "create" | "edit";
}) {
  const birdsForSaleGroupCount = getBirdsForSaleGroupCount(offerings);
  const mobileSummary = getOfferingsMobileSummary(offerings);
  const desktopSummary = mobileSummary.replace("Avg ", "Average ");
  const plan = getPlanCapabilities(planKey);
  const isEditMode = mode === "edit";
  const isLocked = Boolean(stepLocked);
  const displayedOfferings = useMemo(() => {
    const rows: Array<
      | { kind: "active"; offering: BirdOffering }
      | { kind: "removed"; offering: BirdOffering }
    > = offerings.map((offering) => ({ kind: "active", offering }));

    [...pendingRemovedOfferings]
      .sort((left, right) => left.index - right.index)
      .forEach(({ index, offering }) => {
        rows.splice(Math.min(index, rows.length), 0, {
          kind: "removed",
          offering,
        });
      });

    return rows;
  }, [offerings, pendingRemovedOfferings]);

  return (
    <SectionCard
      badge={`${birdsForSaleGroupCount} added`}
      className={
        isLocked
          ? "max-sm:border-stone-200 max-sm:opacity-60"
          : mobileActive
            ? "max-sm:border-emerald-200 max-sm:bg-emerald-50/60 max-sm:shadow-[0_6px_20px_rgba(31,42,32,0.07)]"
            : "max-sm:border-stone-200"
      }
      desktopComplete={groupsReviewMode}
      desktopDisabled={desktopDisabled}
      desktopExpanded={desktopActive}
      desktopPanelMode={desktopPanelMode}
      desktopSummary={desktopSummary}
      onDesktopToggle={onDesktopOpen}
      mobileComplete={groupsReviewMode}
      mobileArtwork={
        <MobileLiveBirdsArtwork className="size-16 rounded-full" name="hen" />
      }
      mobileExpanded={mobileActive}
      mobileSummary={mobileSummary}
      onMobileToggle={onMobileOpen}
      step="2"
      title="Birds for Sale"
    >
      <div>
        <p
          className={`text-base font-bold text-stone-950 sm:text-sm sm:font-semibold ${
            isLocked ? "text-stone-400" : ""
          }`}
        >
          What birds are you selling from this hatch?
        </p>
        <p
          className={`mt-2 text-base leading-7 ${
            isLocked ? "text-stone-400" : "text-stone-600"
          }`}
        >
          Enter the total number of birds that share the same breed, sex/type, and price. Add a separate entry for anything different.
        </p>
      </div>
      {breedOptionsMessage ? (
        <p className="mt-4 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-base font-semibold leading-7 text-stone-600">
          {breedOptionsMessage}
        </p>
      ) : null}
      {duplicateOfferingIds.size > 0 ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-base font-semibold leading-7 text-amber-800">
          This page already has an entry for this breed and sex/type. Choose
          a different sex/type or remove the duplicate before saving later.
        </p>
      ) : null}
      {!isLocked ? (
        <div className="mt-4 space-y-4 sm:mt-4 sm:space-y-3">
          {displayedOfferings.map((row, index) =>
            row.kind === "removed" ? (
              <RemovedOfferingRow
                key={`removed-${row.offering.id}`}
                index={index}
                offering={row.offering}
                onUndo={() => undoPendingRemoval?.(row.offering.id)}
              />
            ) : row.offering.expanded ? (
              <ExpandedOfferingCard
                key={row.offering.id}
                breedMediaItemsByProfileId={breedMediaItemsByProfileId}
                entryMediaItemsByInventoryItemId={entryMediaItemsByInventoryItemId}
                editPriceSummary={editPriceSummariesByOfferingId[row.offering.id]}
                editCurrentAgeLabel={editCurrentAgeLabel}
                breedOptions={breedOptions}
                canAddCustomBreed={canAddCustomBreed}
                canRemove={offerings.length > 1}
                hasDuplicateCombination={duplicateOfferingIds.has(row.offering.id)}
                isEditMode={isEditMode}
                desktopPanelMode={desktopPanelMode}
                index={index}
                offering={row.offering}
                prepareBreedPhotoProfile={prepareBreedPhotoProfile}
                removeOffering={removeOffering}
                removeDisabled={Boolean(
                  row.offering.inventoryItemId &&
                    removeBlockedInventoryItemIds.has(row.offering.inventoryItemId),
                )}
                scrollToOfferingId={scrollToOfferingId}
                storeId={storeId}
                toggleOfferingExpanded={toggleOfferingExpanded}
                updateBreedDescription={updateBreedDescription}
                updateOffering={updateOffering}
                updateOfferingBreed={updateOfferingBreed}
                onBreedPhotosChanged={onBreedPhotosChanged}
                onEntryPhotosChanged={onEntryPhotosChanged}
                onPendingEntryPhotoChange={(file) =>
                  onPendingEntryPhotoChange(row.offering.id, file)
                }
                onPendingEntryPhotoRemove={() => onPendingEntryPhotoRemove(row.offering.id)}
                pendingEntryPhoto={pendingEntryPhotosByOfferingId[row.offering.id] ?? null}
                onOpenCustomBreedModal={onOpenCustomBreedModal}
                plan={plan}
              />
            ) : (
              <CollapsedOfferingRow
                key={row.offering.id}
                canRemove={offerings.length > 1}
                hasDuplicateCombination={duplicateOfferingIds.has(row.offering.id)}
                isEditMode={isEditMode}
                index={index}
                offering={row.offering}
                removeOffering={removeOffering}
                removeDisabled={Boolean(
                  row.offering.inventoryItemId &&
                    removeBlockedInventoryItemIds.has(row.offering.inventoryItemId),
                )}
                toggleOfferingExpanded={toggleOfferingExpanded}
              />
            ),
          )}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-2 sm:mt-4 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-emerald-800 bg-white px-4 text-base font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400 sm:min-h-10 sm:w-auto sm:border-emerald-800 sm:bg-emerald-800 sm:text-sm sm:font-semibold sm:text-white sm:hover:bg-emerald-900"
          disabled={isLocked}
          onClick={addOffering}
          type="button"
        >
          + Add more birds from this hatch date
        </button>
        <p className="text-base font-medium leading-7 text-stone-500 sm:order-last sm:w-full">
          Use this for another breed, sex/type, quantity, or current price.
        </p>
        {completionErrorMessage ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-base font-semibold leading-7 text-amber-900 sm:order-last sm:w-full">
            {completionErrorMessage}
          </p>
        ) : null}
        {!groupsReviewMode ? (
          <button
            className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-emerald-800 px-4 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 sm:min-h-10 sm:w-auto sm:text-sm sm:font-semibold"
            disabled={isLocked}
            onClick={onDoneAddingGroups}
            type="button"
          >
            Done adding birds
          </button>
        ) : null}
      </div>
    </SectionCard>
  );
}

function ExpandedOfferingCard({
  breedMediaItemsByProfileId,
  entryMediaItemsByInventoryItemId,
  editPriceSummary,
  editCurrentAgeLabel,
  breedOptions,
  canAddCustomBreed,
  canRemove,
  hasDuplicateCombination,
  isEditMode,
  desktopPanelMode,
  index,
  offering,
  prepareBreedPhotoProfile,
  removeOffering,
  removeDisabled,
  scrollToOfferingId,
  storeId,
  toggleOfferingExpanded,
  updateBreedDescription,
  updateOffering,
  updateOfferingBreed,
  onBreedPhotosChanged,
  onEntryPhotosChanged,
  onPendingEntryPhotoChange,
  onPendingEntryPhotoRemove,
  pendingEntryPhoto,
  onOpenCustomBreedModal,
  plan,
}: {
  breedMediaItemsByProfileId: Record<string, ListingPhotoItem[]>;
  entryMediaItemsByInventoryItemId: Record<string, ListingPhotoItem[]>;
  editPriceSummary?: {
    after: string;
    current: string;
    currentStarting: string;
    newStarting: string;
  };
  editCurrentAgeLabel?: string | null;
  breedOptions: BreedOption[];
  canAddCustomBreed: boolean;
  canRemove: boolean;
  hasDuplicateCombination: boolean;
  isEditMode: boolean;
  desktopPanelMode: boolean;
  index: number;
  offering: BirdOffering;
  prepareBreedPhotoProfile: (offeringId: string) => void;
  removeOffering: (offeringId: string) => void;
  removeDisabled: boolean;
  scrollToOfferingId: string | null;
  storeId: string;
  toggleOfferingExpanded: (offeringId: string) => void;
  updateBreedDescription: (offeringId: string, description: string) => void;
  updateOffering: (
    offeringId: string,
    updates: Partial<Omit<BirdOffering, "id">>,
  ) => void;
  updateOfferingBreed: (offeringId: string, option: BreedOption) => void;
  onBreedPhotosChanged: () => void;
  onEntryPhotosChanged: () => void;
  onPendingEntryPhotoChange: (file: File) => void;
  onPendingEntryPhotoRemove: () => void;
  pendingEntryPhoto: { error: string | null; file: File; previewUrl: string } | null;
  onOpenCustomBreedModal: (offeringId: string) => void;
  plan: PlanCapabilities;
}) {
  const selectedBreedOption = findSelectedBreedOption(breedOptions, offering);
  const title = getBirdsForSaleTitle(offering);
  const summary = getBirdsForSaleSummary(offering, isEditMode);
  const cardRef = useRef<HTMLDivElement>(null);
  const breedMediaItems = offering.sellerBreedProfileId
    ? breedMediaItemsByProfileId[offering.sellerBreedProfileId] ?? []
    : [];
  const contentStatus = getBreedContentStatus({
    breedMediaItems,
    breedOption: selectedBreedOption,
    description: offering.description,
  });
  const hasBreed = Boolean(offering.sellerBreedProfileId || offering.breedId);
  const isBreedContentExpanded = Boolean(offering.breedContentExpanded);

  useEffect(() => {
    if (scrollToOfferingId !== offering.id) return;

    cardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    window.setTimeout(() => {
      if (window.matchMedia("(max-width: 639px)").matches) {
        window.scrollBy({ top: -72, behavior: "smooth" });
      }
      cardRef.current
        ?.querySelector<HTMLElement>('[data-live-birds-offering-field="breed"]')
        ?.focus({ preventScroll: true });
    }, 0);
  }, [offering.id, scrollToOfferingId]);

  useEffect(() => {
    if (hasBreed || !isBreedContentExpanded) return;

    updateOffering(offering.id, {
      breedContentExpanded: false,
      breedContentUserToggled: false,
    });
  }, [hasBreed, isBreedContentExpanded, offering.id, updateOffering]);

  function toggleBreedContent() {
    updateOffering(offering.id, {
      breedContentExpanded: !isBreedContentExpanded,
      breedContentUserToggled: true,
    });
  }

  return (
    <div
      className="scroll-mt-20 overflow-hidden rounded-xl border border-emerald-500 border-l-4 bg-emerald-50/30 shadow-[0_8px_24px_rgba(21,128,61,0.12)] sm:rounded-lg sm:border-l sm:bg-white"
      ref={cardRef}
    >
      <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-4 py-4 sm:border-emerald-100 sm:px-4 sm:py-3">
        <div className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <EntryIndex index={index} />
          <span className="min-w-0">
            <span className="block break-words text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
              {title}
            </span>
            <span className="mt-0.5 block text-sm font-medium leading-5 text-stone-500">
              {summary}
            </span>
          </span>
        </div>
        <div className="hidden shrink-0 items-center gap-3 sm:flex">
          <EntryStatus allowSoldOut={isEditMode} offering={offering} />
          {canRemove ? (
            <RemoveOfferingControl
              disabled={removeDisabled}
              offeringId={offering.id}
              removeOffering={removeOffering}
            />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:hidden">
          <EntryStatus allowSoldOut={isEditMode} offering={offering} />
          {canRemove ? (
            <details className="relative">
              <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md text-lg font-bold text-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-700/20">
                ...
              </summary>
              <div className="absolute right-0 z-20 mt-1 rounded-md border border-stone-200 bg-white p-2 shadow-lg">
                <RemoveOfferingControl
                  disabled={removeDisabled}
                  offeringId={offering.id}
                  removeOffering={removeOffering}
                />
              </div>
            </details>
          ) : null}
          <button
            aria-label="Collapse bird entry"
            className="flex size-10 items-center justify-center rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
            type="button"
            onClick={() => toggleOfferingExpanded(offering.id)}
          >
            <DisclosureChevron expanded />
          </button>
        </div>
      </div>

      <div className="border-b border-stone-100 px-4 py-3">
        <EntryPhotoControl
          inventoryItemId={offering.inventoryItemId}
          mediaItems={
            offering.inventoryItemId
              ? entryMediaItemsByInventoryItemId[offering.inventoryItemId] ?? []
              : []
          }
          onReload={onEntryPhotosChanged}
          onPendingPhotoChange={onPendingEntryPhotoChange}
          onPendingPhotoRemove={onPendingEntryPhotoRemove}
          onPendingPhotoUploaded={onPendingEntryPhotoRemove}
          pendingPhoto={pendingEntryPhoto}
          storeId={storeId}
        />
      </div>

      <div
        className={`grid gap-0 px-4 py-5 sm:gap-4 sm:px-4 sm:py-4 ${
          desktopPanelMode
            ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(8rem,0.7fr)_minmax(8rem,0.75fr)]"
            : "lg:grid-cols-4"
        }`}
      >
        {isEditMode ? (
          <dl className="grid gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-2.5 text-stone-700 sm:col-span-full sm:grid-cols-3">
            <EditOfferingMetric
              label="Current age"
              value={editCurrentAgeLabel ?? "Not available"}
            />
            {editPriceSummary ? (
              <>
                <EditOfferingMetric
                  label="Starting price"
                  value={editPriceSummary.newStarting}
                />
                <EditOfferingMetric
                  label="Storefront price"
                  value={
                    editPriceSummary.after !== editPriceSummary.current
                      ? `${editPriceSummary.current} now \u2192 ${editPriceSummary.after} after save`
                      : editPriceSummary.current
                  }
                />
              </>
            ) : null}
          </dl>
        ) : null}
        <div className="space-y-4 border-b border-stone-100 pb-5 sm:contents sm:border-0 sm:pb-0">
          <div>
            <SelectField
              disabled={isEditMode && Boolean(offering.inventoryItemId)}
              fieldName="breed"
              label="Breed"
              options={breedOptions}
              value={offering.breed}
              selectedBreedId={offering.breedId ?? null}
              selectedId={offering.sellerBreedProfileId}
              onChange={(option) => updateOfferingBreed(offering.id, option)}
            />
            <button
              className="mt-2 inline-flex whitespace-nowrap text-left text-sm font-semibold text-emerald-800 underline-offset-4 transition hover:text-emerald-950 hover:underline disabled:cursor-not-allowed disabled:text-stone-400 disabled:no-underline"
              disabled={!canAddCustomBreed}
              title={canAddCustomBreed ? undefined : "Select a species first."}
              type="button"
              onClick={() => onOpenCustomBreedModal(offering.id)}
            >
              + Add Custom Breed
            </button>
          </div>
          <SelectField
            label="Sold as (sex/type)"
            options={soldAsOptions.map((option) => ({
              id: option,
              label: option,
              speciesId: null,
              breedId: null,
              catalogImageUrl: null,
              catalogDescription: null,
              sellerPhotoUrl: null,
              sellerDescription: null,
              source: "fallback",
            }))}
            value={offering.soldAs}
            selectedBreedId={null}
            selectedId={offering.soldAs}
            disabledOptionLabels={
              plan.flockGroupListingsEnabled ? [] : ["Flock"]
            }
            onChange={(option) =>
              updateOffering(offering.id, { soldAs: option.label })
            }
          />
        </div>
        <div className="mt-5 grid gap-4 sm:contents">
          <NumberField
            label="Quantity available"
            value={offering.quantity}
            onChange={(value) => updateOffering(offering.id, { quantity: value })}
          />
          <NumberField
            label={isEditMode ? "Starting price" : "Price per bird"}
            prefix="$"
            value={offering.price}
            onChange={(value) => updateOffering(offering.id, { price: value })}
          />
        </div>
      </div>
      {hasDuplicateCombination ? (
        <p className="mx-4 mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-base font-semibold leading-7 text-amber-800">
          Duplicate breed and sex/type combination. Choose a different sex/type
          or remove this entry before saving.
        </p>
      ) : null}

      {hasBreed ? (
      <div className="border-t border-stone-100 px-4 py-4 sm:border-stone-200 sm:px-4 sm:py-3">
        <button
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-stone-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-emerald-800/30 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-0"
          type="button"
          onClick={toggleBreedContent}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
            <span
              className={`text-base font-bold text-stone-950 sm:text-sm sm:font-semibold ${
                desktopPanelMode ? "hidden sm:inline" : ""
              }`}
            >
              {desktopPanelMode
                ? "Breed Photo and Description"
                : "Photo and description"}
            </span>
            {desktopPanelMode ? (
              <span className="text-base font-bold text-stone-950 sm:hidden">
                Photo and description
              </span>
            ) : null}
            <span
              className={`text-sm font-semibold leading-5 ${
                contentStatus.needsAttention ? "text-amber-700" : "text-emerald-800"
              }`}
            >
              {contentStatus.needsAttention ? "Still needed" : "Added"}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-2 text-sm font-bold text-emerald-900">
            Edit
            <DisclosureChevron expanded={isBreedContentExpanded} />
          </span>
        </button>
        {isBreedContentExpanded ? (
          <div
            className={`mt-3 grid gap-4 sm:items-stretch ${
              desktopPanelMode ? "sm:grid-cols-1" : "sm:grid-cols-2"
            }`}
          >
            <BreedPhotoPanel
              breedMediaItems={breedMediaItems}
              compactDesktop={desktopPanelMode}
              offering={offering}
              prepareBreedPhotoProfile={prepareBreedPhotoProfile}
              storeId={storeId}
              onBreedPhotosChanged={onBreedPhotosChanged}
            />
            <div className="min-w-0 sm:flex sm:h-full sm:flex-col sm:rounded-lg sm:border sm:border-stone-200 sm:bg-white sm:p-5 sm:shadow-sm">
              <h3 className="text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
                Breed description
              </h3>
              <p className="mt-3 text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
                Description
              </p>
              <textarea
                className={`${inputClass} mt-2 min-h-32 resize-y py-3 leading-6 sm:flex-1 ${
                  desktopPanelMode ? "sm:min-h-42" : "sm:min-h-56"
                }`}
                value={offering.description}
                onChange={(event) =>
                  updateBreedDescription(offering.id, event.target.value)
                }
              />
              <p className="mt-2 text-sm font-medium text-stone-500">
                {offering.description.length} / 500
              </p>
            </div>
            <div
              className={`flex justify-end ${
                desktopPanelMode ? "sm:col-span-1" : "sm:col-span-2"
              }`}
            >
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2"
                type="button"
                onClick={toggleBreedContent}
              >
                Done editing
              </button>
            </div>
          </div>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

function EditOfferingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold leading-5 text-stone-900">
        {value}
      </dd>
    </div>
  );
}

function CollapsedOfferingRow({
  canRemove,
  hasDuplicateCombination,
  isEditMode,
  index,
  offering,
  removeOffering,
  removeDisabled,
  toggleOfferingExpanded,
}: {
  canRemove: boolean;
  hasDuplicateCombination: boolean;
  isEditMode: boolean;
  index: number;
  offering: BirdOffering;
  removeOffering: (offeringId: string) => void;
  removeDisabled: boolean;
  toggleOfferingExpanded: (offeringId: string) => void;
}) {
  const title = getBirdsForSaleTitle(offering);
  const summary = getBirdsForSaleSummary(offering, isEditMode);
  const mobileSummary = getBirdsForSaleMobileSummary(offering, isEditMode);

  return (
    <div
      className={`rounded-lg border bg-white px-3 py-2.5 shadow-sm sm:px-4 ${
        hasDuplicateCombination
          ? "border-amber-200"
          : "border-transparent sm:border-stone-200"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3 text-sm sm:items-center sm:gap-x-3 sm:gap-y-2">
        <button
          className="flex min-h-12 min-w-0 basis-full items-start gap-3 text-left sm:flex-1 sm:basis-auto sm:items-center"
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          <EntryIndex index={index} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="break-words text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
              {title}
            </span>
            <span className="hidden text-sm font-medium text-stone-500 sm:block">
              {summary}
            </span>
            <span className="text-sm font-medium leading-5 text-stone-600 sm:hidden">
              {mobileSummary}
            </span>
          </span>
        </button>
        <span className="hidden sm:inline-flex">
          <EntryStatus allowSoldOut={isEditMode} offering={offering} />
        </span>
        <button
          className={`${mutedTextActionClass} ml-auto hidden transition hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2 sm:inline-flex`}
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          Edit
        </button>
        {canRemove ? (
          <span className="hidden sm:inline-flex">
            <RemoveOfferingControl
              disabled={removeDisabled}
              offeringId={offering.id}
              removeOffering={removeOffering}
            />
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2 sm:hidden">
          <EntryStatus allowSoldOut={isEditMode} offering={offering} />
          <button
            aria-label="Expand bird entry"
            className="flex size-10 shrink-0 items-center justify-center rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
            type="button"
            onClick={() => toggleOfferingExpanded(offering.id)}
          >
            <DisclosureChevron />
          </button>
        </div>
      </div>
      {hasDuplicateCombination ? (
        <p className="mt-2 text-base font-semibold text-amber-800">
          Duplicate breed and sex/type combination.
        </p>
      ) : null}
    </div>
  );
}

function RemovedOfferingRow({
  index,
  offering,
  onUndo,
}: {
  index: number;
  offering: BirdOffering;
  onUndo: () => void;
}) {
  return (
    <div className="flex min-h-16 flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <EntryIndex index={index} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{getBirdsForSaleTitle(offering)}</p>
        <p className="mt-0.5 text-red-800">
          Will be permanently removed when you save.
        </p>
      </div>
      <button
        className="min-h-11 rounded-md px-2 font-bold underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-red-300 sm:min-h-9"
        type="button"
        onClick={onUndo}
      >
        Undo
      </button>
    </div>
  );
}

function RemoveOfferingControl({
  disabled,
  offeringId,
  removeOffering,
}: {
  disabled: boolean;
  offeringId: string;
  removeOffering: (offeringId: string) => void;
}) {
  return (
    <span className="relative inline-flex items-center gap-1.5">
      <button
        className="min-h-12 rounded-md px-2 text-base font-semibold text-red-500 transition hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-200 focus:ring-offset-2 disabled:cursor-not-allowed disabled:text-stone-400 sm:min-h-0 sm:px-0 sm:text-sm sm:text-red-500"
        disabled={disabled}
        type="button"
        onClick={() => removeOffering(offeringId)}
      >
        Remove
      </button>
      {disabled ? <RemovalUnavailableHelp /> : null}
    </span>
  );
}

function RemovalUnavailableHelp() {
  return (
    <details className="group relative">
      <summary
        aria-label="Why this entry cannot be removed"
        className="flex size-8 cursor-help list-none items-center justify-center rounded-full border border-stone-300 bg-white text-sm font-bold text-stone-600 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 sm:size-5 sm:text-xs"
      >
        ?
      </summary>
      <p className="absolute right-0 z-30 mt-2 hidden w-72 rounded-md border border-stone-200 bg-stone-950 px-3 py-2 text-left text-xs font-medium leading-5 text-white shadow-lg group-open:block sm:block sm:pointer-events-none sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        This entry can’t be removed because birds from it have already been sold. Set quantity to 0 to stop offering it for sale.
      </p>
    </details>
  );
}

function SelectField({
  disabled = false,
  disabledOptionLabels = [],
  fieldName,
  label,
  onChange,
  options,
  selectedBreedId,
  selectedId,
  value,
}: {
  disabled?: boolean;
  disabledOptionLabels?: string[];
  fieldName?: string;
  label: string;
  onChange: (value: BreedOption) => void;
  options: BreedOption[];
  selectedBreedId: string | null;
  selectedId: string | null;
  value: string;
}) {
  const placeholderLabel =
    label === "Sold as (sex/type)" ? "Choose sex/type" : "Choose breed";
  const selectedValue = getBreedOptionValue({
    id: selectedId,
    label: value,
    speciesId: null,
    breedId: selectedBreedId,
    catalogImageUrl: null,
    catalogDescription: null,
    sellerPhotoUrl: null,
    sellerDescription: null,
    source: "fallback",
  });
  const isBreedField = label === "Breed";

  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-bold leading-5 text-stone-700 sm:font-semibold sm:text-stone-600">
        {label}
      </span>
      {isBreedField ? (
        <BreedCombobox
          disabled={disabled}
          fieldName={fieldName}
          key={selectedValue}
          onChange={onChange}
          options={options}
          placeholderLabel={placeholderLabel}
          selectedBreedId={selectedBreedId}
          selectedId={selectedId}
          value={value}
        />
      ) : (
        <span className="relative block">
        <select
          className={`${inputClass} appearance-none pr-9 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500`}
          data-live-birds-offering-field={fieldName}
          disabled={disabled}
          value={selectedValue}
          onChange={(event) => {
            const nextOption = options.find(
              (option) => getBreedOptionValue(option) === event.target.value,
            );

            if (nextOption) onChange(nextOption);
          }}
        >
          {value.trim().length === 0 && !selectedId && !selectedBreedId ? (
            <option disabled value={selectedValue}>
              {placeholderLabel}
            </option>
          ) : null}
          {options.map((option) => (
            <option
              disabled={disabledOptionLabels.includes(option.label)}
              key={getBreedOptionValue(option)}
              value={getBreedOptionValue(option)}
            >
              {disabledOptionLabels.includes(option.label)
                ? `${option.label} - Market`
                : option.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b-2 border-r-2 ${
            disabled ? "border-stone-400" : "border-emerald-800/70"
          }`}
        />
        </span>
      )}
      {disabled && label === "Breed" ? (
        <span className="mt-1.5 block text-base font-medium leading-6 text-stone-500">
          Breed changes for existing entries are coming soon.
        </span>
      ) : null}
    </label>
  );
}

function BreedCombobox({
  disabled,
  fieldName,
  onChange,
  options,
  placeholderLabel,
  selectedBreedId,
  selectedId,
  value,
}: {
  disabled: boolean;
  fieldName?: string;
  onChange: (value: BreedOption) => void;
  options: BreedOption[];
  placeholderLabel: string;
  selectedBreedId: string | null;
  selectedId: string | null;
  value: string;
}) {
  const generatedListboxId = useId();
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const listboxId = `live-birds-breed-listbox-${generatedListboxId}`;
  const selectedValue = getBreedOptionValue({
    id: selectedId,
    label: value,
    speciesId: null,
    breedId: selectedBreedId,
    catalogImageUrl: null,
    catalogDescription: null,
    sellerPhotoUrl: null,
    sellerDescription: null,
    source: "fallback",
  });
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return options
      .filter((option) =>
        normalizedQuery
          ? option.label.toLowerCase().includes(normalizedQuery)
          : true,
      )
      .slice(0, 40);
  }, [options, query]);

  return (
    <span className="block">
      <span className="relative block">
      <input
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        autoComplete="off"
        className={`${inputClass} pr-9 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500`}
        data-live-birds-offering-field={fieldName}
        disabled={disabled}
        placeholder={placeholderLabel}
        role="combobox"
        value={query}
        onBlur={() => {
          setQuery(value);
          window.setTimeout(() => setIsOpen(false), 120);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={(event) => {
          event.currentTarget.select();
          setIsOpen(true);
        }}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b-2 border-r-2 ${
          disabled ? "border-stone-400" : "border-emerald-800/70"
        }`}
      />
      </span>
      {isOpen && !disabled ? (
        <span
          className="mt-1 block max-h-64 w-full overflow-y-auto rounded-md border border-stone-200 bg-white py-1 shadow-sm"
          id={listboxId}
          role="listbox"
        >
          {filteredOptions.length === 0 ? (
            <span className="block px-3 py-3 text-sm font-medium text-stone-500">
              No matching breeds
            </span>
          ) : (
            filteredOptions.map((option) => {
              const optionValue = getBreedOptionValue(option);
              const isSelected = optionValue === selectedValue;

              return (
                <button
                  aria-selected={isSelected}
                  className={`block w-full px-3 py-3 text-left text-base font-semibold ${
                    isSelected
                      ? "bg-emerald-50 text-emerald-950"
                      : "text-stone-800"
                  }`}
                  key={optionValue}
                  role="option"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option);
                    setQuery(option.label);
                    setIsOpen(false);
                  }}
                >
                  {option.label}
                </button>
              );
            })
          )}
        </span>
      ) : null}
    </span>
  );
}

function getBreedOptionValue(option: BreedOption) {
  if (option.id) return `profile:${option.id}`;
  if (option.breedId) return `catalog:${option.breedId}`;

  return `local:${option.label}`;
}

function NumberField({
  label,
  onChange,
  prefix,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  prefix?: string;
  value: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-bold leading-5 text-stone-700 sm:font-semibold sm:text-stone-600">
        {label}
      </span>
      <span className="relative block">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-stone-500 sm:text-sm">
            {prefix}
          </span>
        ) : null}
        <input
          className={`${inputClass} ${prefix ? "pl-8" : ""}`}
          inputMode={prefix ? "decimal" : "numeric"}
          min="0"
          step={prefix ? "0.01" : "1"}
          type="number"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}

function BreedPhotoPanel({
  breedMediaItems,
  compactDesktop,
  offering,
  prepareBreedPhotoProfile,
  storeId,
  onBreedPhotosChanged,
}: {
  breedMediaItems: ListingPhotoItem[];
  compactDesktop: boolean;
  offering: BirdOffering;
  prepareBreedPhotoProfile: (offeringId: string) => void;
  storeId: string;
  onBreedPhotosChanged: () => void;
}) {
  return (
    <div className={`min-w-0 ${compactDesktop ? "sm:w-2/3" : ""}`}>
      <div>
        {offering.sellerBreedProfileId ? (
          <ListingPhotosSection
            key={`${offering.sellerBreedProfileId}:${breedMediaItems
              .map((item) => item.media_link_id)
              .join(",")}`}
            canManage
            description=""
            emptyDescription="No personal breed photo yet. The catalog photo or placeholder will be used until you add one."
            entityId={offering.sellerBreedProfileId}
            entityType="seller_breed_profile"
            listingBatchId={offering.sellerBreedProfileId}
            mediaItems={breedMediaItems}
            mode="public-content"
            storeId={storeId}
            title="Breed photo"
            mobileCompact
            onReload={onBreedPhotosChanged}
          />
        ) : (
          <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-4 py-5">
            <p className="text-base font-bold text-stone-700 sm:text-sm sm:font-semibold">
              This catalog breed is not in your personal breed library yet.
            </p>
            <p className="mt-2 text-base font-medium leading-7 text-stone-500">
              Change breed photo will first add this breed to your personal
              breed library, then save photos there.
            </p>
            <button
              className="mt-3 min-h-12 rounded-md border border-emerald-800/30 bg-white px-3 py-2 text-base font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2 sm:min-h-0 sm:text-xs sm:font-semibold"
              type="button"
              onClick={() => prepareBreedPhotoProfile(offering.id)}
            >
              Change breed photo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DisclosureChevron({ expanded = false }: { expanded?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-1 h-2.5 w-2.5 shrink-0 border-b-2 border-r-2 border-emerald-800/80 ${
        expanded ? "rotate-45" : "-rotate-45"
      }`}
    />
  );
}

function EntryIndex({ index }: { index: number }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-sm font-bold text-emerald-900">
      {index + 1}
    </span>
  );
}

function EntryStatus({
  allowSoldOut,
  offering,
}: {
  allowSoldOut: boolean;
  offering: BirdOffering;
}) {
  const complete = isOfferingComplete(offering, allowSoldOut);
  const soldOut =
    allowSoldOut && complete && getNumberInputValue(offering.quantity) === 0;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
        soldOut
          ? "border-stone-300 bg-stone-100 text-stone-700"
          : complete
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {complete && !soldOut ? (
        <span
          aria-hidden="true"
          className="block h-2.5 w-1.5 rotate-45 border-b-2 border-r-2 border-emerald-700"
        />
      ) : null}
      <span className={complete && !soldOut ? "hidden sm:inline" : ""}>
        {soldOut ? "Sold Out" : complete ? "Complete" : "Unfinished"}
      </span>
    </span>
  );
}

function findSelectedBreedOption(
  breedOptions: BreedOption[],
  offering: BirdOffering,
) {
  return (
    breedOptions.find(
      (option) =>
        (offering.sellerBreedProfileId &&
          option.id === offering.sellerBreedProfileId) ||
        (offering.breedId && option.breedId === offering.breedId),
    ) ??
    breedOptions.find(
      (option) =>
        option.label.trim().toLowerCase() ===
        offering.breed.trim().toLowerCase(),
    ) ??
    null
  );
}

function getBirdsForSaleTitle(offering: BirdOffering) {
  const breed = offering.breed.trim();
  const soldAs = offering.soldAs.trim();

  if (breed && soldAs) {
    return `${breed} ${getSoldAsTitleText(soldAs)}`;
  }

  if (breed) return breed;

  return "New bird entry";
}

function getBirdsForSaleSummary(
  offering: BirdOffering,
  allowSoldOut: boolean,
) {
  const breed = offering.breed.trim();
  const soldAs = offering.soldAs.trim();
  const quantity = getNumberInputValue(offering.quantity);
  const price = getNumberInputValue(offering.price);

  if (
    !breed ||
    !soldAs ||
    !offering.quantity.trim() ||
    quantity < (allowSoldOut ? 0 : 1) ||
    price <= 0
  ) {
    return "Finish bird details";
  }

  return [
    quantity === 0 ? "Sold out" : `${quantity} available`,
    `${formatCurrency(price)} each`,
  ].join(" · ");
}

function getBirdsForSaleMobileSummary(
  offering: BirdOffering,
  allowSoldOut: boolean,
) {
  const quantity = getNumberInputValue(offering.quantity);
  const price = getNumberInputValue(offering.price);

  return offering.quantity.trim() &&
    quantity >= (allowSoldOut ? 0 : 1) &&
    price > 0
    ? `${quantity === 0 ? "Sold out" : `${quantity} available`} - ${formatCurrency(price)} each`
    : "";
}

function getOfferingsMobileSummary(offerings: BirdOffering[]) {
  const startedOfferings = offerings.filter((offering) => {
    return (
      offering.breed.trim() ||
      offering.soldAs.trim() ||
      getNumberInputValue(offering.quantity) > 0 ||
      getNumberInputValue(offering.price) > 0
    );
  });
  const groupCount = startedOfferings.length;
  const birdCount = startedOfferings.reduce(
    (total, offering) => total + getNumberInputValue(offering.quantity),
    0,
  );
  const prices = startedOfferings
    .map((offering) => getNumberInputValue(offering.price))
    .filter((price) => price > 0);
  const averagePrice =
    prices.length > 0
      ? prices.reduce((total, price) => total + price, 0) / prices.length
      : 0;

  if (groupCount === 0) return "No bird groups added";

  return `${groupCount} ${groupCount === 1 ? "group" : "groups"} • ${birdCount} ${
    birdCount === 1 ? "bird" : "birds"
  }${averagePrice > 0 ? ` • Avg ${formatCurrency(averagePrice)}` : ""}`;
}

function getBreedContentStatus({
  breedMediaItems,
  breedOption,
  description,
}: {
  breedMediaItems: ListingPhotoItem[];
  breedOption: BreedOption | null;
  description: string;
}) {
  const photoCount = getUsableBreedMediaItems(breedMediaItems).length;
  const hasSellerPhoto = Boolean(toDisplayImageUrl(breedOption?.sellerPhotoUrl));
  const hasCatalogPhoto = Boolean(toDisplayImageUrl(breedOption?.catalogImageUrl));
  const trimmedDescription = description.trim();
  const libraryDescription =
    breedOption?.sellerDescription?.trim() ||
    breedOption?.catalogDescription?.trim() ||
    "";
  const photoStatus =
    photoCount > 0
      ? `${photoCount} photo${photoCount === 1 ? "" : "s"}`
      : hasSellerPhoto || hasCatalogPhoto
        ? "Using library content"
        : "Photo Needed";
  const descriptionStatus = !trimmedDescription
    ? "Description Needed"
    : libraryDescription && trimmedDescription === libraryDescription
      ? "Using library content"
      : "Custom description";
  const needsAttention =
    (photoCount === 0 && !hasSellerPhoto && !hasCatalogPhoto) ||
    !trimmedDescription;

  if (photoStatus === "Using library content" && descriptionStatus === photoStatus) {
    return { needsAttention, text: photoStatus };
  }

  return {
    needsAttention,
    text: `${photoStatus} · ${descriptionStatus}`,
  };
}

function getUsableBreedMediaItems(breedMediaItems: ListingPhotoItem[]) {
  return breedMediaItems.filter(
    (item) =>
      item.visibility_status === "active" &&
      item.asset_status === "active" &&
      item.moderation_status === "approved" &&
      Boolean(toDisplayImageUrl(item.public_url)),
  );
}

function isOfferingComplete(offering: BirdOffering, allowSoldOut: boolean) {
  return (
    offering.breed.trim().length > 0 &&
    offering.soldAs.trim().length > 0 &&
    offering.quantity.trim().length > 0 &&
    getNumberInputValue(offering.quantity) >= (allowSoldOut ? 0 : 1) &&
    getNumberInputValue(offering.price) > 0
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function getSoldAsTitleText(soldAs: string) {
  switch (soldAs) {
    case "Female":
      return "females";
    case "Male":
      return "males";
    case "Straight run":
      return "straight run";
    case "Pair":
      return "pairs";
    case "Trio":
      return "trios";
    case "Flock":
      return "flock";
    default:
      return soldAs.toLowerCase();
  }
}
