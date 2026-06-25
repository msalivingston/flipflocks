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
  duplicateOfferingIds,
  offerings,
  prepareBreedPhotoProfile,
  removeOffering,
  storeId,
  toggleOfferingExpanded,
  updateBreedDescription,
  updateOffering,
  updateOfferingBreed,
  onBreedPhotosChanged,
}: {
  addOffering: () => void;
  breedMediaItemsByProfileId: Record<string, ListingPhotoItem[]>;
  breedOptions: BreedOption[];
  breedOptionsMessage: string | null;
  duplicateOfferingIds: Set<string>;
  offerings: BirdOffering[];
  prepareBreedPhotoProfile: (offeringId: string) => void;
  removeOffering: (offeringId: string) => void;
  storeId: string;
  toggleOfferingExpanded: (offeringId: string) => void;
  updateBreedDescription: (offeringId: string, description: string) => void;
  updateOffering: (
    offeringId: string,
    updates: Partial<Omit<BirdOffering, "id">>,
  ) => void;
  updateOfferingBreed: (offeringId: string, option: BreedOption) => void;
  onBreedPhotosChanged: () => void;
}) {
  const birdsForSaleGroupCount = getBirdsForSaleGroupCount(offerings);

  return (
    <SectionCard
      badge={`${birdsForSaleGroupCount} group${
        birdsForSaleGroupCount === 1 ? "" : "s"
      }`}
      step="2"
      title="Birds for Sale"
    >
      <p className="text-sm leading-6 text-stone-600">
        Add one group for each breed, sex/type, quantity, and price.
      </p>
      {breedOptionsMessage ? (
        <p className="mt-4 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold leading-5 text-stone-600">
          {breedOptionsMessage}
        </p>
      ) : null}
      {duplicateOfferingIds.size > 0 ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
          This page already has a group for this breed and sex/type. Choose
          a different sex/type or remove the duplicate before saving later.
        </p>
      ) : null}
      <div className="mt-4 space-y-3">
        {offerings.map((offering, index) =>
          offering.expanded ? (
            <ExpandedOfferingCard
              key={offering.id}
              breedMediaItemsByProfileId={breedMediaItemsByProfileId}
              breedOptions={breedOptions}
              canRemove={offerings.length > 1}
              hasDuplicateCombination={duplicateOfferingIds.has(offering.id)}
              index={index}
              offering={offering}
              prepareBreedPhotoProfile={prepareBreedPhotoProfile}
              removeOffering={removeOffering}
              storeId={storeId}
              toggleOfferingExpanded={toggleOfferingExpanded}
              updateBreedDescription={updateBreedDescription}
              updateOffering={updateOffering}
              updateOfferingBreed={updateOfferingBreed}
              onBreedPhotosChanged={onBreedPhotosChanged}
            />
          ) : (
            <CollapsedOfferingRow
              key={offering.id}
              canRemove={offerings.length > 1}
              hasDuplicateCombination={duplicateOfferingIds.has(offering.id)}
              index={index}
              offering={offering}
              removeOffering={removeOffering}
              toggleOfferingExpanded={toggleOfferingExpanded}
            />
          ),
        )}
      </div>

      <button
        className="mt-3 inline-flex min-h-10 items-center rounded-md border border-emerald-800/30 bg-white px-4 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
        onClick={addOffering}
        type="button"
      >
        + Add another group
      </button>
    </SectionCard>
  );
}

function ExpandedOfferingCard({
  breedMediaItemsByProfileId,
  breedOptions,
  canRemove,
  hasDuplicateCombination,
  index,
  offering,
  prepareBreedPhotoProfile,
  removeOffering,
  storeId,
  toggleOfferingExpanded,
  updateBreedDescription,
  updateOffering,
  updateOfferingBreed,
  onBreedPhotosChanged,
}: {
  breedMediaItemsByProfileId: Record<string, ListingPhotoItem[]>;
  breedOptions: BreedOption[];
  canRemove: boolean;
  hasDuplicateCombination: boolean;
  index: number;
  offering: BirdOffering;
  prepareBreedPhotoProfile: (offeringId: string) => void;
  removeOffering: (offeringId: string) => void;
  storeId: string;
  toggleOfferingExpanded: (offeringId: string) => void;
  updateBreedDescription: (offeringId: string, description: string) => void;
  updateOffering: (
    offeringId: string,
    updates: Partial<Omit<BirdOffering, "id">>,
  ) => void;
  updateOfferingBreed: (offeringId: string, option: BreedOption) => void;
  onBreedPhotosChanged: () => void;
}) {
  const selectedBreedOption = findSelectedBreedOption(breedOptions, offering);
  const title = getBirdsForSaleTitle(offering, index);
  const summary = getBirdsForSaleSummary(offering);

  return (
    <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <button
          className="flex items-start gap-3 text-left"
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          <DisclosureChevron expanded />
          <span>
            <span className="block text-sm font-semibold text-stone-950">
              {title}
            </span>
            <span className="mt-0.5 block text-xs font-medium text-stone-500">
              {summary}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-3">
          <RemoveOfferingControl
            canRemove={canRemove}
            offeringId={offering.id}
            removeOffering={removeOffering}
          />
          <span
            aria-hidden="true"
            className="text-lg font-semibold leading-none text-stone-300"
          >
            ...
          </span>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-4">
        <SelectField
          label="Breed"
          options={breedOptions}
          value={offering.breed}
          selectedBreedId={offering.breedId ?? null}
          selectedId={offering.sellerBreedProfileId}
          onChange={(option) => updateOfferingBreed(offering.id, option)}
        />
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
      {hasDuplicateCombination ? (
        <p className="mx-4 mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
          Duplicate breed and sex/type combination. Choose a different sex/type
          or remove this group before saving.
        </p>
      ) : null}

      <div className="border-t border-stone-200 px-4 py-4">
        <BreedPhotoPanel
          breedMediaItems={
            offering.sellerBreedProfileId
              ? breedMediaItemsByProfileId[offering.sellerBreedProfileId] ?? []
              : []
          }
          breedOption={selectedBreedOption}
          offering={offering}
          prepareBreedPhotoProfile={prepareBreedPhotoProfile}
          storeId={storeId}
          onBreedPhotosChanged={onBreedPhotosChanged}
        />
      </div>

      <div className="border-t border-stone-200 px-4 py-4">
        <h3 className="text-sm font-semibold text-stone-950">
          Breed description
        </h3>
        <p className="mt-1 max-w-3xl text-xs font-medium leading-5 text-stone-500">
          This description is used anywhere this breed appears in your store.
          Changing it updates your personal breed library.
        </p>
        <p className="mt-3 text-xs font-semibold text-stone-600">
          Description buyers see
        </p>
        <textarea
          className={`${inputClass} mt-2 min-h-36 resize-y py-3 leading-6`}
          value={offering.description}
          onChange={(event) =>
            updateBreedDescription(offering.id, event.target.value)
          }
        />
        <p className="mt-2 text-xs font-medium text-stone-500">
          {offering.description.length} / 500
        </p>
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
      className={`rounded-lg border bg-white px-4 py-3 shadow-sm ${
        hasDuplicateCombination ? "border-amber-200" : "border-stone-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <button
          className="flex flex-wrap items-center gap-x-3 gap-y-2 text-left"
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          <DisclosureChevron />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold text-stone-950">
              {title}
            </span>
            <span className="text-xs font-medium text-stone-500">
              {summary}
            </span>
          </span>
        </button>
        <button
          className={`ml-auto ${mutedTextActionClass} transition hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2`}
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          Edit
        </button>
        <RemoveOfferingControl
          canRemove={canRemove}
          offeringId={offering.id}
          removeOffering={removeOffering}
        />
      </div>
      {hasDuplicateCombination ? (
        <p className="mt-2 text-xs font-semibold text-amber-800">
          Duplicate breed and sex/type combination.
        </p>
      ) : null}
    </div>
  );
}

function RemoveOfferingControl({
  canRemove,
  offeringId,
  removeOffering,
}: {
  canRemove: boolean;
  offeringId: string;
  removeOffering: (offeringId: string) => void;
}) {
  if (!canRemove) {
    return (
      <span className="cursor-not-allowed text-xs font-semibold text-stone-300">
        Remove group
      </span>
    );
  }

  return (
    <button
      className="text-xs font-semibold text-red-500 transition hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-200 focus:ring-offset-2"
      type="button"
      onClick={() => removeOffering(offeringId)}
    >
      Remove group
    </button>
  );
}

function SelectField({
  label,
  onChange,
  options,
  selectedBreedId,
  selectedId,
  value,
}: {
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
      <span className="mb-1.5 block text-xs font-semibold text-stone-600">
        {label}
      </span>
      <span className="relative block">
        <select
          className={`${inputClass} appearance-none pr-9`}
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
              key={getBreedOptionValue(option)}
              value={getBreedOptionValue(option)}
            >
              {option.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b-2 border-r-2 border-emerald-800/70"
        />
      </span>
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
      <span className="mb-1.5 block text-xs font-semibold text-stone-600">
        {label}
      </span>
      <span className="relative block">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-500">
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
      ? "FlipFlocks breed catalog photo"
      : "Placeholder";

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <span className="w-fit rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
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
            <p className="text-sm font-semibold text-stone-700">
              This catalog breed is not in your personal breed library yet.
            </p>
            <p className="mt-2 text-xs font-medium leading-5 text-stone-500">
              Change breed photo will first add this breed to your personal
              breed library, then save photos there.
            </p>
            <button
              className="mt-3 rounded-md border border-emerald-800/30 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2"
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
  const details = [];
  const quantity = offering.quantity.trim();
  const price = offering.price.trim();

  if (quantity) {
    details.push(`${getNumberInputValue(quantity)} available`);
  }

  if (price) {
    details.push(`$${getNumberInputValue(price)} each`);
  }

  return details.length > 0
    ? details.join(" · ")
    : "Choose breed, sex/type, quantity, and price.";
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
