import {
  inputClass,
  mutedTextActionClass,
  soldAsOptions,
} from "./constants";
import { getNumberInputValue } from "./helpers";
import { SectionCard } from "./SectionCard";
import type { BirdOffering, BreedOption } from "./types";

export function BirdOfferingsCard({
  addOffering,
  addPlaceholderPhoto,
  breedOptions,
  breedOptionsMessage,
  duplicateOfferingIds,
  offerings,
  removeOffering,
  removePlaceholderPhoto,
  setFeaturedPhoto,
  toggleOfferingExpanded,
  updateOffering,
}: {
  addOffering: () => void;
  addPlaceholderPhoto: (offeringId: string) => void;
  breedOptions: BreedOption[];
  breedOptionsMessage: string | null;
  duplicateOfferingIds: Set<string>;
  offerings: BirdOffering[];
  removeOffering: (offeringId: string) => void;
  removePlaceholderPhoto: (offeringId: string, photoId: string) => void;
  setFeaturedPhoto: (offeringId: string, photoId: string) => void;
  toggleOfferingExpanded: (offeringId: string) => void;
  updateOffering: (
    offeringId: string,
    updates: Partial<Omit<BirdOffering, "id">>,
  ) => void;
}) {
  return (
    <SectionCard
      badge={`${offerings.length} offering${offerings.length === 1 ? "" : "s"}`}
      step="2"
      title="Bird Offerings"
    >
      {breedOptionsMessage ? (
        <p className="mt-4 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold leading-5 text-stone-600">
          {breedOptionsMessage}
        </p>
      ) : null}
      {duplicateOfferingIds.size > 0 ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
          This batch already has an offering for this breed and sold-as type.
          Choose a different sold-as type or remove the duplicate before saving
          later.
        </p>
      ) : null}
      <div className="mt-4 space-y-3">
        {offerings.map((offering, index) =>
          offering.expanded ? (
            <ExpandedOfferingCard
              key={offering.id}
              addPlaceholderPhoto={addPlaceholderPhoto}
              breedOptions={breedOptions}
              canRemove={offerings.length > 1}
              hasDuplicateCombination={duplicateOfferingIds.has(offering.id)}
              index={index}
              offering={offering}
              removeOffering={removeOffering}
              removePlaceholderPhoto={removePlaceholderPhoto}
              setFeaturedPhoto={setFeaturedPhoto}
              toggleOfferingExpanded={toggleOfferingExpanded}
              updateOffering={updateOffering}
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
        + Add another bird offering
      </button>
    </SectionCard>
  );
}

function ExpandedOfferingCard({
  addPlaceholderPhoto,
  breedOptions,
  canRemove,
  hasDuplicateCombination,
  index,
  offering,
  removeOffering,
  removePlaceholderPhoto,
  setFeaturedPhoto,
  toggleOfferingExpanded,
  updateOffering,
}: {
  addPlaceholderPhoto: (offeringId: string) => void;
  breedOptions: BreedOption[];
  canRemove: boolean;
  hasDuplicateCombination: boolean;
  index: number;
  offering: BirdOffering;
  removeOffering: (offeringId: string) => void;
  removePlaceholderPhoto: (offeringId: string, photoId: string) => void;
  setFeaturedPhoto: (offeringId: string, photoId: string) => void;
  toggleOfferingExpanded: (offeringId: string) => void;
  updateOffering: (
    offeringId: string,
    updates: Partial<Omit<BirdOffering, "id">>,
  ) => void;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <button
          className="flex items-start gap-3 text-left"
          type="button"
          onClick={() => toggleOfferingExpanded(offering.id)}
        >
          <span className="text-lg leading-none text-emerald-900">v</span>
          <span>
            <span className="block text-sm font-semibold text-stone-950">
              Bird Offering {index + 1}
            </span>
            <span className="mt-0.5 block text-xs font-medium text-stone-500">
              Expanded preview
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
          selectedId={offering.sellerBreedProfileId}
          onChange={(option) =>
            updateOffering(offering.id, {
              breed: option.label,
              sellerBreedProfileId: option.id,
            })
          }
        />
        <SelectField
          label="Sold as"
          options={soldAsOptions.map((option) => ({
            id: option,
            label: option,
            speciesId: null,
          }))}
          value={offering.soldAs}
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
          Duplicate breed and sold-as combination. This is okay for local
          layout testing, but it will need to be resolved before save is added.
        </p>
      ) : null}

      <div className="border-t border-stone-200 px-4 py-4">
        <StaticPhotosPanel
          addPlaceholderPhoto={addPlaceholderPhoto}
          offeringId={offering.id}
          photos={offering.photos}
          removePlaceholderPhoto={removePlaceholderPhoto}
          setFeaturedPhoto={setFeaturedPhoto}
        />
      </div>

      <div className="border-t border-stone-200 px-4 py-4">
        <h3 className="text-sm font-semibold text-stone-950">
          Buyer Content
        </h3>
        <p className="mt-3 text-xs font-semibold text-stone-600">
          Description
        </p>
        <textarea
          className={`${inputClass} mt-2 min-h-36 resize-y py-3 leading-6`}
          value={offering.description}
          onChange={(event) =>
            updateOffering(offering.id, {
              description: event.target.value,
            })
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
          <span className="text-lg leading-none text-emerald-900">&gt;</span>
          <span className="font-semibold text-stone-950">
            Bird Offering {index + 1}
          </span>
          <span className="text-stone-500">{offering.breed}</span>
          <span className="text-stone-300">-</span>
          <span className="text-stone-500">Sold as {offering.soldAs}</span>
          <span className="text-stone-300">-</span>
          <span className="text-stone-500">
            {getNumberInputValue(offering.quantity)} available
          </span>
          <span className="text-stone-300">-</span>
          <span className="text-stone-500">${offering.price} each</span>
          <span className="text-stone-300">-</span>
          <span className="text-stone-500">
            {formatPhotoCount(offering.photos.length)}
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
          Duplicate breed and sold-as combination.
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
        Remove
      </span>
    );
  }

  return (
    <button
      className="text-xs font-semibold text-red-500 transition hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-200 focus:ring-offset-2"
      type="button"
      onClick={() => removeOffering(offeringId)}
    >
      Remove
    </button>
  );
}

function SelectField({
  label,
  onChange,
  options,
  selectedId,
  value,
}: {
  label: string;
  onChange: (value: BreedOption) => void;
  options: BreedOption[];
  selectedId: string | null;
  value: string;
}) {
  const selectedValue = getBreedOptionValue({
    id: selectedId,
    label: value,
    speciesId: null,
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
          {options.map((option) => (
            <option
              key={getBreedOptionValue(option)}
              value={getBreedOptionValue(option)}
            >
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">
          v
        </span>
      </span>
    </label>
  );
}

function getBreedOptionValue(option: BreedOption) {
  return option.id ?? `local:${option.label}`;
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

function StaticPhotosPanel({
  addPlaceholderPhoto,
  offeringId,
  photos,
  removePlaceholderPhoto,
  setFeaturedPhoto,
}: {
  addPlaceholderPhoto: (offeringId: string) => void;
  offeringId: string;
  photos: BirdOffering["photos"];
  removePlaceholderPhoto: (offeringId: string, photoId: string) => void;
  setFeaturedPhoto: (offeringId: string, photoId: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-stone-950">Photos</h3>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            Featured
          </span>
        </div>
        <button
          className="rounded-md border border-emerald-800/30 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2"
          type="button"
          onClick={() => addPlaceholderPhoto(offeringId)}
        >
          Add placeholder photo
        </button>
      </div>
      {photos.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <PhotoPlaceholderTile
              key={photo.id}
              offeringId={offeringId}
              photo={photo}
              removePlaceholderPhoto={removePlaceholderPhoto}
              setFeaturedPhoto={setFeaturedPhoto}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm font-semibold leading-6 text-stone-500">
          No photos added yet. Photo tools will be added later.
        </div>
      )}
      <p className="mt-3 text-xs font-medium text-emerald-800">
        Placeholder photos are local-only for this UI shell.
      </p>
    </div>
  );
}

function PhotoPlaceholderTile({
  offeringId,
  photo,
  removePlaceholderPhoto,
  setFeaturedPhoto,
}: {
  offeringId: string;
  photo: BirdOffering["photos"][number];
  removePlaceholderPhoto: (offeringId: string, photoId: string) => void;
  setFeaturedPhoto: (offeringId: string, photoId: string) => void;
}) {
  return (
    <div className="relative flex min-h-32 flex-col items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-3 py-3 text-center">
      {photo.isFeatured ? (
        <span className="absolute left-2 top-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[0.68rem] font-semibold text-emerald-800">
          Featured
        </span>
      ) : null}
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">
        PH
      </span>
      <span className="mt-2 text-xs font-semibold text-stone-700">
        {photo.label}
      </span>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {!photo.isFeatured ? (
          <button
            className="rounded-md border border-stone-200 bg-white px-2 py-1 text-[0.68rem] font-semibold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2"
            type="button"
            onClick={() => setFeaturedPhoto(offeringId, photo.id)}
          >
            Set featured
          </button>
        ) : null}
        <button
          className="rounded-md border border-stone-200 bg-white px-2 py-1 text-[0.68rem] font-semibold text-red-500 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200 focus:ring-offset-2"
          type="button"
          onClick={() => removePlaceholderPhoto(offeringId, photo.id)}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function formatPhotoCount(photoCount: number) {
  if (photoCount === 0) return "No photos";
  if (photoCount === 1) return "1 photo";

  return `${photoCount} photos`;
}
