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
import { pickFeaturedMedia, toDisplayImageUrl } from "../../../breeds/breed-data";
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
      badge={`${birdsForSaleGroupCount} group${
        birdsForSaleGroupCount === 1 ? "" : "s"
      }`}
      className={isLocked ? "opacity-60" : ""}
      step="2"
      title="Birds for Sale"
    >
      <p
        className={`text-base leading-7 sm:text-sm sm:leading-6 ${
          isLocked ? "text-stone-400" : "text-stone-600"
        }`}
      >
        Add one group for each breed, sex/type, quantity, and price.
      </p>
      {breedOptionsMessage ? (
        <p className="mt-4 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold leading-6 text-stone-600">
          {breedOptionsMessage}
        </p>
      ) : null}
      {duplicateOfferingIds.size > 0 ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold leading-6 text-amber-800">
          This page already has a group for this breed and sex/type. Choose
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

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-emerald-800/30 bg-white px-4 text-base font-bold text-emerald-900 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 sm:min-h-10 sm:w-auto sm:text-sm sm:font-semibold"
          disabled={isLocked}
          onClick={addOffering}
          type="button"
        >
          + Add another group
        </button>
        {!groupsReviewMode ? (
          <button
            className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-stone-700 transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 sm:min-h-10 sm:w-auto sm:text-sm sm:font-semibold"
            disabled={isLocked}
            onClick={onDoneAddingGroups}
            type="button"
          >
            Done adding groups
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
  const title = getBirdsForSaleTitle(offering, index);
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
  const isBreedContentExpanded = Boolean(offering.breedContentExpanded);

  useEffect(() => {
    if (scrollToOfferingId !== offering.id) return;

    cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [offering.id, scrollToOfferingId]);

  function toggleBreedContent() {
    updateOffering(offering.id, {
      breedContentExpanded: !isBreedContentExpanded,
      breedContentUserToggled: true,
    });
  }

  return (
    <div
      className="rounded-xl border border-transparent bg-stone-50/70 shadow-none sm:rounded-lg sm:border-stone-200 sm:bg-white sm:shadow-sm"
      ref={cardRef}
    >
      <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-0 py-3 sm:border-stone-200 sm:px-4">
        <button
          className="flex min-h-12 min-w-0 flex-1 items-start gap-3 text-left"
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          <DisclosureChevron expanded />
          <span className="min-w-0">
            <span className="block break-words text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
              {title}
            </span>
            <span className="mt-0.5 block text-sm font-medium leading-5 text-stone-500">
              {summary}
            </span>
          </span>
        </button>
        <div className="hidden shrink-0 items-center gap-3 sm:flex">
          {canRemove ? (
            <RemoveOfferingControl
              offeringId={offering.id}
              removeOffering={removeOffering}
            />
          ) : null}
          <span
            aria-hidden="true"
            className="text-lg font-semibold leading-none text-stone-300"
          >
            ...
          </span>
        </div>
      </div>

      <div className="grid gap-3 px-0 py-4 sm:gap-4 sm:px-4 sm:py-4 lg:grid-cols-4">
        <div>
          <SelectField
            disabled={isEditMode && Boolean(offering.inventoryItemId)}
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
          label="Sold as"
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
          label="Price each"
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
        <p className="mx-4 mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold leading-5 text-amber-800">
          Duplicate breed and sex/type combination. Choose a different sex/type
          or remove this group before saving.
        </p>
      ) : null}

      <div className="border-t border-stone-100 px-0 py-3 sm:border-stone-200 sm:px-4 sm:py-4">
        <button
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-emerald-800/30 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-0"
          type="button"
          onClick={toggleBreedContent}
        >
          <span className="min-w-0">
            <span className="block text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
              Breed photo & description
            </span>
            <span
              className={`mt-0.5 block text-sm font-medium leading-5 ${
                contentStatus.needsAttention ? "text-red-600" : "text-stone-500"
              }`}
            >
              {contentStatus.text}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-2 text-sm font-bold text-emerald-900">
            {isBreedContentExpanded ? "Hide" : "Edit"}
            <DisclosureChevron expanded={isBreedContentExpanded} />
          </span>
        </button>
        {isBreedContentExpanded ? (
          <div className="mt-3 grid gap-4">
            <BreedPhotoPanel
              breedMediaItems={breedMediaItems}
              breedOption={selectedBreedOption}
              offering={offering}
              prepareBreedPhotoProfile={prepareBreedPhotoProfile}
              storeId={storeId}
              onBreedPhotosChanged={onBreedPhotosChanged}
            />
            <div>
              <h3 className="text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
                Breed description
              </h3>
              <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-stone-500">
                This description is used anywhere this breed appears in your store.
                Changing it updates your personal breed library.
              </p>
              <p className="mt-3 text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
                Description buyers see
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
          </div>
        ) : null}
        {canRemove ? (
          <div className="mt-3 flex justify-end sm:hidden">
            <RemoveOfferingControl
              offeringId={offering.id}
              removeOffering={removeOffering}
            />
          </div>
        ) : null}
      </div>
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
  const title = getBirdsForSaleTitle(offering, index);
  const summary = getBirdsForSaleSummary(offering);

  return (
    <div
      className={`rounded-lg border bg-white px-3 py-3 shadow-sm sm:px-4 ${
        hasDuplicateCombination
          ? "border-amber-200"
          : "border-transparent sm:border-stone-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <button
          className="flex min-h-12 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 text-left"
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          <DisclosureChevron />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="break-words text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">
              {title}
            </span>
            <span className="text-sm font-medium text-stone-500">
              {summary}
            </span>
          </span>
        </button>
        <button
          className={`${mutedTextActionClass} ml-auto transition hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2`}
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          Edit
        </button>
        {canRemove ? (
          <RemoveOfferingControl
            offeringId={offering.id}
            removeOffering={removeOffering}
          />
        ) : null}
      </div>
      {hasDuplicateCombination ? (
        <p className="mt-2 text-sm font-semibold text-amber-800 sm:text-xs">
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
      Remove group
    </button>
  );
}

function SelectField({
  disabled = false,
  disabledOptionLabels = [],
  label,
  onChange,
  options,
  selectedBreedId,
  selectedId,
  value,
}: {
  disabled?: boolean;
  disabledOptionLabels?: string[];
  label: string;
  onChange: (value: BreedOption) => void;
  options: BreedOption[];
  selectedBreedId: string | null;
  selectedId: string | null;
  value: string;
}) {
  const placeholderLabel = label === "Sold as" ? "Choose sex/type" : "Choose breed";
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
      <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
        {label}
      </span>
      <span className="relative block">
        <select
          className={`${inputClass} appearance-none pr-9 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500`}
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
        <span className="mt-1.5 block text-sm font-medium leading-5 text-stone-500">
          Breed changes for existing groups are coming soon.
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
      <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
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
          min="0"
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
  breedOption,
  offering,
  prepareBreedPhotoProfile,
  storeId,
  onBreedPhotosChanged,
}: {
  breedMediaItems: ListingPhotoItem[];
  breedOption: BreedOption | null;
  offering: BirdOffering;
  prepareBreedPhotoProfile: (offeringId: string) => void;
  storeId: string;
  onBreedPhotosChanged: () => void;
}) {
  const featuredMedia = pickFeaturedMedia(breedMediaItems);
  const sellerPhotoUrl = toDisplayImageUrl(featuredMedia?.public_url);
  const catalogPhotoUrl = toDisplayImageUrl(breedOption?.catalogImageUrl);
  const photoSource = sellerPhotoUrl
    ? "Personal breed library photo"
    : catalogPhotoUrl
      ? "FlockFront breed catalog photo"
      : "Placeholder";

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <span className="w-fit rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-semibold text-emerald-800 sm:text-xs">
          {photoSource}
        </span>
      </div>

      <div>
        {offering.sellerBreedProfileId ? (
          <ListingPhotosSection
            key={`${offering.sellerBreedProfileId}:${breedMediaItems
              .map((item) => item.media_link_id)
              .join(",")}`}
            canManage
            description="This photo is used anywhere this breed appears in your store. Changing it updates your personal breed library."
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
            <p className="mt-2 text-sm font-medium leading-6 text-stone-500">
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

function getBirdsForSaleTitle(offering: BirdOffering, index: number) {
  const breed = offering.breed.trim();
  const soldAs = offering.soldAs.trim();

  if (breed && soldAs) {
    return `${breed} ${getSoldAsTitleText(soldAs)}`;
  }

  if (breed) return breed;

  return `Birds for Sale #${index + 1}`;
}

function getBirdsForSaleSummary(offering: BirdOffering) {
  const breed = offering.breed.trim();
  const soldAs = offering.soldAs.trim();
  const quantity = getNumberInputValue(offering.quantity);
  const price = getNumberInputValue(offering.price);

  if (!breed || !soldAs || quantity <= 0 || price <= 0) {
    return "Finish group details";
  }

  return [
    breed,
    soldAs,
    `${quantity} available`,
    `${formatCurrency(price)} each`,
  ].join(" · ");
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
