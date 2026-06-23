import {
  breedOptions,
  inputClass,
  mutedTextActionClass,
  soldAsOptions,
} from "./constants";
import { getNumberInputValue } from "./helpers";
import { SectionCard } from "./SectionCard";
import type { BirdOffering } from "./types";

export function BirdOfferingsCard({
  addOffering,
  duplicateOffering,
  offerings,
  removeOffering,
  toggleOfferingExpanded,
  updateOffering,
}: {
  addOffering: () => void;
  duplicateOffering: (offeringId: string) => void;
  offerings: BirdOffering[];
  removeOffering: (offeringId: string) => void;
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
      <div className="mt-4 space-y-3">
        {offerings.map((offering, index) =>
          offering.expanded ? (
            <ExpandedOfferingCard
              key={offering.id}
              canRemove={offerings.length > 1}
              duplicateOffering={duplicateOffering}
              index={index}
              offering={offering}
              removeOffering={removeOffering}
              toggleOfferingExpanded={toggleOfferingExpanded}
              updateOffering={updateOffering}
            />
          ) : (
            <CollapsedOfferingRow
              key={offering.id}
              canRemove={offerings.length > 1}
              duplicateOffering={duplicateOffering}
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
  canRemove,
  duplicateOffering,
  index,
  offering,
  removeOffering,
  toggleOfferingExpanded,
  updateOffering,
}: {
  canRemove: boolean;
  duplicateOffering: (offeringId: string) => void;
  index: number;
  offering: BirdOffering;
  removeOffering: (offeringId: string) => void;
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
          <DuplicateOfferingControl
            duplicateOffering={duplicateOffering}
            offeringId={offering.id}
          />
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
          onChange={(value) => updateOffering(offering.id, { breed: value })}
        />
        <SelectField
          label="Sold as"
          options={soldAsOptions}
          value={offering.soldAs}
          onChange={(value) => updateOffering(offering.id, { soldAs: value })}
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

      <div className="grid gap-5 border-t border-stone-200 px-4 py-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
        <div>
          <h3 className="text-sm font-semibold text-stone-950">
            Buyer Content
          </h3>
          <p className="mt-3 text-xs font-semibold text-stone-600">
            Description
          </p>
          <textarea
            className={`${inputClass} mt-2 min-h-28 resize-y py-3 leading-6`}
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

        <StaticPhotosPanel photos={offering.photos} />
      </div>
    </div>
  );
}

function CollapsedOfferingRow({
  canRemove,
  duplicateOffering,
  index,
  offering,
  removeOffering,
  toggleOfferingExpanded,
}: {
  canRemove: boolean;
  duplicateOffering: (offeringId: string) => void;
  index: number;
  offering: BirdOffering;
  removeOffering: (offeringId: string) => void;
  toggleOfferingExpanded: (offeringId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3 shadow-sm">
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
        <DuplicateOfferingControl
          duplicateOffering={duplicateOffering}
          offeringId={offering.id}
        />
        <RemoveOfferingControl
          canRemove={canRemove}
          offeringId={offering.id}
          removeOffering={removeOffering}
        />
      </div>
    </div>
  );
}

function DuplicateOfferingControl({
  duplicateOffering,
  offeringId,
}: {
  duplicateOffering: (offeringId: string) => void;
  offeringId: string;
}) {
  return (
    <button
      className="text-xs font-semibold text-emerald-700 transition hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2"
      type="button"
      onClick={() => duplicateOffering(offeringId)}
    >
      Duplicate
    </button>
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
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-semibold text-stone-600">
        {label}
      </span>
      <span className="relative block">
        <select
          className={`${inputClass} appearance-none pr-9`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
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

function StaticPhotosPanel({ photos }: { photos: BirdOffering["photos"] }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-stone-950">Photos</h3>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            Featured
          </span>
        </div>
        <span className="rounded-md border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-500 shadow-sm">
          Manage photos
        </span>
      </div>
      {photos.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => (
            <PhotoPlaceholderTile key={photo.id} photo={photo} />
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
  photo,
}: {
  photo: BirdOffering["photos"][number];
}) {
  return (
    <div className="relative flex min-h-28 flex-col items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-3 text-center">
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
    </div>
  );
}

function formatPhotoCount(photoCount: number) {
  if (photoCount === 0) return "No photos";
  if (photoCount === 1) return "1 photo";

  return `${photoCount} photos`;
}
