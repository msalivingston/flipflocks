import { useEffect, useRef } from "react";
import {
  getPlanCapabilities,
  type PlanCapabilities,
} from "@/lib/plan-capabilities";
import {
  PlanUpgradePrompt,
} from "../../../_components/plan-upgrade-prompt";
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
import type { BirdOffering, BreedOption } from "./types";

export function BirdOfferingsCard({
  addOffering,
  breedMediaItemsByProfileId,
  breedOptions,
  breedOptionsMessage,
  canAddCustomBreed,
  duplicateOfferingIds,
  groupsReviewMode,
  offerings,
  onDoneAddingGroups,
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
  planKey,
  mode = "create",
}: {
  addOffering: () => void;
  breedMediaItemsByProfileId: Record<string, ListingPhotoItem[]>;
  breedOptions: BreedOption[];
  breedOptionsMessage: string | null;
  canAddCustomBreed: boolean;
  duplicateOfferingIds: Set<string>;
  groupsReviewMode: boolean;
  offerings: BirdOffering[];
  onDoneAddingGroups: () => void;
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
  planKey?: string | null;
  mode?: "create" | "edit";
}) {
  const birdsForSaleGroupCount = getBirdsForSaleGroupCount(offerings);
  const plan = getPlanCapabilities(planKey);
  const isEditMode = mode === "edit";
  const isLocked = Boolean(stepLocked);

  return (
    <SectionCard
      badge={`${birdsForSaleGroupCount} added`}
      className={isLocked ? "opacity-60" : ""}
      step="2"
      title="Birds for sale"
    >
      <p
        className={`text-base leading-7 ${
          isLocked ? "text-stone-400" : "text-stone-600"
        }`}
      >
        Enter the total number of birds that share the same breed, sex/type, and price. Add a separate entry for anything different.
      </p>
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
        <div className="mt-3 space-y-3 sm:mt-4">
          {offerings.map((offering, index) =>
            offering.expanded ? (
              <ExpandedOfferingCard
                key={offering.id}
                breedMediaItemsByProfileId={breedMediaItemsByProfileId}
                breedOptions={breedOptions}
                canAddCustomBreed={canAddCustomBreed}
                canRemove={!isEditMode && offerings.length > 1}
                hasDuplicateCombination={duplicateOfferingIds.has(offering.id)}
                isEditMode={isEditMode}
                index={index}
                offering={offering}
                prepareBreedPhotoProfile={prepareBreedPhotoProfile}
                removeOffering={removeOffering}
                scrollToOfferingId={scrollToOfferingId}
                storeId={storeId}
                toggleOfferingExpanded={toggleOfferingExpanded}
                updateBreedDescription={updateBreedDescription}
                updateOffering={updateOffering}
                updateOfferingBreed={updateOfferingBreed}
                onBreedPhotosChanged={onBreedPhotosChanged}
                onOpenCustomBreedModal={onOpenCustomBreedModal}
                plan={plan}
              />
            ) : (
              <CollapsedOfferingRow
                key={offering.id}
                canRemove={!isEditMode && offerings.length > 1}
                hasDuplicateCombination={duplicateOfferingIds.has(offering.id)}
                index={index}
                offering={offering}
                removeOffering={removeOffering}
                toggleOfferingExpanded={toggleOfferingExpanded}
              />
            ),
          )}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-emerald-800 bg-white px-4 text-base font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400 sm:min-h-10 sm:w-auto sm:border-emerald-800 sm:bg-emerald-800 sm:text-sm sm:font-semibold sm:text-white sm:hover:bg-emerald-900"
          disabled={isLocked}
          onClick={addOffering}
          type="button"
        >
          + Add different birds from this hatch
        </button>
        <p className="text-base font-medium leading-7 text-stone-500 sm:order-last sm:w-full">
          Use this for another breed, sex/type, quantity, or current price.
        </p>
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
  breedOptions,
  canAddCustomBreed,
  canRemove,
  hasDuplicateCombination,
  isEditMode,
  index,
  offering,
  prepareBreedPhotoProfile,
  removeOffering,
  scrollToOfferingId,
  storeId,
  toggleOfferingExpanded,
  updateBreedDescription,
  updateOffering,
  updateOfferingBreed,
  onBreedPhotosChanged,
  onOpenCustomBreedModal,
  plan,
}: {
  breedMediaItemsByProfileId: Record<string, ListingPhotoItem[]>;
  breedOptions: BreedOption[];
  canAddCustomBreed: boolean;
  canRemove: boolean;
  hasDuplicateCombination: boolean;
  isEditMode: boolean;
  index: number;
  offering: BirdOffering;
  prepareBreedPhotoProfile: (offeringId: string) => void;
  removeOffering: (offeringId: string) => void;
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
  onOpenCustomBreedModal: (offeringId: string) => void;
  plan: PlanCapabilities;
}) {
  const selectedBreedOption = findSelectedBreedOption(breedOptions, offering);
  const title = getBirdsForSaleTitle(offering);
  const summary = getBirdsForSaleSummary(offering);
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
      className="scroll-mt-20 rounded-xl border border-emerald-200 bg-white shadow-sm sm:rounded-lg sm:bg-white"
      ref={cardRef}
    >
      <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-0 py-3 sm:border-emerald-100 sm:px-4">
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
          <EntryStatus offering={offering} />
          {canRemove ? (
            <RemoveOfferingControl
              offeringId={offering.id}
              removeOffering={removeOffering}
            />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:hidden">
          <EntryStatus offering={offering} />
          {canRemove ? (
            <details className="relative">
              <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md text-lg font-bold text-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-700/20">
                ...
              </summary>
              <div className="absolute right-0 z-20 mt-1 rounded-md border border-stone-200 bg-white p-2 shadow-lg">
                <RemoveOfferingControl
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

      <div className="grid gap-3 px-0 py-4 sm:gap-4 sm:px-4 sm:py-4 lg:grid-cols-4">
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
        <NumberField
          label="Quantity available"
          value={offering.quantity}
          onChange={(value) => updateOffering(offering.id, { quantity: value })}
        />
        <NumberField
          label="Price per bird"
          prefix="$"
          value={offering.price}
          onChange={(value) => updateOffering(offering.id, { price: value })}
        />
      </div>
      {!plan.flockGroupListingsEnabled ? (
        <PlanUpgradePrompt
          className="mx-0 mb-4 sm:mx-4"
          compact
          feature="flock_group"
        />
      ) : null}
      {hasDuplicateCombination ? (
        <p className="mx-4 mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-base font-semibold leading-7 text-amber-800">
          Duplicate breed and sex/type combination. Choose a different sex/type
          or remove this entry before saving.
        </p>
      ) : null}

      {hasBreed ? (
      <div className="border-t border-stone-100 px-0 py-3 sm:border-stone-200 sm:px-4 sm:py-3">
        <button
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-stone-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-emerald-800/30 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-0"
          type="button"
          onClick={toggleBreedContent}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
              Photo and description
            </span>
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
          <div className="mt-3 grid gap-4">
            <BreedPhotoPanel
              breedMediaItems={breedMediaItems}
              offering={offering}
              prepareBreedPhotoProfile={prepareBreedPhotoProfile}
              storeId={storeId}
              onBreedPhotosChanged={onBreedPhotosChanged}
            />
            <div>
              <h3 className="text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
                Breed description
              </h3>
              <p className="mt-3 text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
                Description
              </p>
              <textarea
                className={`${inputClass} mt-2 min-h-32 resize-y py-3 leading-6 sm:min-h-36`}
                value={offering.description}
                onChange={(event) =>
                  updateBreedDescription(offering.id, event.target.value)
                }
              />
              <p className="mt-2 text-sm font-medium text-stone-500">
                {offering.description.length} / 500
              </p>
            </div>
            <div className="flex justify-end">
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

function CollapsedOfferingRow({
  canRemove,
  hasDuplicateCombination,
  index,
  offering,
  removeOffering,
  toggleOfferingExpanded,
}: {
  canRemove: boolean;
  hasDuplicateCombination: boolean;
  index: number;
  offering: BirdOffering;
  removeOffering: (offeringId: string) => void;
  toggleOfferingExpanded: (offeringId: string) => void;
}) {
  const title = getBirdsForSaleTitle(offering);
  const summary = getBirdsForSaleSummary(offering);
  const mobileSummary = getBirdsForSaleMobileSummary(offering);

  return (
    <div
      className={`rounded-lg border bg-white px-3 py-2.5 shadow-sm sm:px-4 ${
        hasDuplicateCombination
          ? "border-amber-200"
          : "border-transparent sm:border-stone-200"
      }`}
    >
      <div className="flex items-start gap-3 text-sm sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2">
        <button
          className="flex min-h-12 min-w-0 flex-1 items-start gap-3 text-left sm:items-center"
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          <EntryIndex index={index} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="break-words text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
              {title}
            </span>
            <span className="hidden text-sm font-medium text-stone-500 sm:block">
              {summary}
            </span>
            <span className="text-sm font-medium leading-5 text-stone-600 sm:hidden">
              {mobileSummary.lineOne}
            </span>
            <span className="text-sm font-medium leading-5 text-stone-600 sm:hidden">
              {mobileSummary.lineTwo}
            </span>
          </span>
        </button>
        <EntryStatus offering={offering} />
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
              offeringId={offering.id}
              removeOffering={removeOffering}
            />
          </span>
        ) : null}
        <button
          aria-label="Expand bird entry"
          className="flex size-10 shrink-0 items-center justify-center rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700/20 sm:hidden"
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          <DisclosureChevron />
        </button>
      </div>
      {hasDuplicateCombination ? (
        <p className="mt-2 text-base font-semibold text-amber-800">
          Duplicate breed and sex/type combination.
        </p>
      ) : null}
    </div>
  );
}

function RemoveOfferingControl({
  offeringId,
  removeOffering,
}: {
  offeringId: string;
  removeOffering: (offeringId: string) => void;
}) {
  return (
    <button
      className="min-h-12 rounded-md px-2 text-base font-semibold text-red-500 transition hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-200 focus:ring-offset-2 sm:min-h-0 sm:px-0 sm:text-sm sm:text-red-500"
      type="button"
      onClick={() => removeOffering(offeringId)}
    >
      Remove
    </button>
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

  return (
    <label>
      <span className="mb-1.5 block text-sm font-bold leading-5 text-stone-700 sm:font-semibold sm:text-stone-600">
        {label}
      </span>
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
      {disabled && label === "Breed" ? (
        <span className="mt-1.5 block text-base font-medium leading-6 text-stone-500">
          Breed changes for existing entries are coming soon.
        </span>
      ) : null}
    </label>
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
    <label>
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
  offering,
  prepareBreedPhotoProfile,
  storeId,
  onBreedPhotosChanged,
}: {
  breedMediaItems: ListingPhotoItem[];
  offering: BirdOffering;
  prepareBreedPhotoProfile: (offeringId: string) => void;
  storeId: string;
  onBreedPhotosChanged: () => void;
}) {
  return (
    <div>
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

function EntryStatus({ offering }: { offering: BirdOffering }) {
  const complete = isOfferingComplete(offering);

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
        complete
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {complete ? (
        <span
          aria-hidden="true"
          className="block h-2.5 w-1.5 rotate-45 border-b-2 border-r-2 border-emerald-700"
        />
      ) : null}
      <span className={complete ? "hidden sm:inline" : ""}>
        {complete ? "Complete" : "Unfinished"}
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

function getBirdsForSaleSummary(offering: BirdOffering) {
  const breed = offering.breed.trim();
  const soldAs = offering.soldAs.trim();
  const quantity = getNumberInputValue(offering.quantity);
  const price = getNumberInputValue(offering.price);

  if (!breed || !soldAs || quantity <= 0 || price <= 0) {
    return "Finish bird details";
  }

  return [
    breed,
    soldAs,
    `${quantity} available`,
    `${formatCurrency(price)} each`,
  ].join(" · ");
}

function getBirdsForSaleMobileSummary(offering: BirdOffering) {
  const breed = offering.breed.trim();
  const soldAs = offering.soldAs.trim();
  const quantity = getNumberInputValue(offering.quantity);
  const price = getNumberInputValue(offering.price);

  return {
    lineOne: breed && soldAs ? `${breed} - ${soldAs}` : "Finish bird details",
    lineTwo:
      quantity > 0 && price > 0
        ? `${quantity} available - ${formatCurrency(price)} each`
        : "",
  };
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

function isOfferingComplete(offering: BirdOffering) {
  return (
    offering.breed.trim().length > 0 &&
    offering.soldAs.trim().length > 0 &&
    getNumberInputValue(offering.quantity) > 0 &&
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
