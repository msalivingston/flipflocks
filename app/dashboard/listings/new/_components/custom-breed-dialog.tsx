"use client";

import { useMemo, useState } from "react";

export type BirdTypeValue = "layer" | "meat" | "dual_purpose";
export type EggColorValue =
  | "white"
  | "light_brown"
  | "brown"
  | "dark_brown"
  | "blue"
  | "blue_green"
  | "green"
  | "olive";
export type AnnualEggProductionValue =
  | "under_150"
  | "150_200"
  | "200_250"
  | "250_300"
  | "over_300";

export type CustomBreedDraft = {
  annualEggProduction: AnnualEggProductionValue | "";
  birdType: BirdTypeValue | "";
  description: string;
  eggColor: EggColorValue | "";
  name: string;
};

export type SavedCustomBreedProfile = {
  annual_egg_production: AnnualEggProductionValue | null;
  bird_type: BirdTypeValue | null;
  breed_id: string | null;
  custom_breed_name: string | null;
  display_name: string;
  egg_color: EggColorValue | null;
  id: string;
  seller_description: string | null;
  seller_notes: string | null;
  species_id: string;
  visibility_status: string;
};

export const birdTypeOptions = [
  { label: "Layer", value: "layer" },
  { label: "Meat", value: "meat" },
  { label: "Dual Purpose", value: "dual_purpose" },
] satisfies { label: string; value: BirdTypeValue }[];

export const eggColorOptions = [
  { label: "White", value: "white" },
  { label: "Light Brown", value: "light_brown" },
  { label: "Brown", value: "brown" },
  { label: "Dark Brown", value: "dark_brown" },
  { label: "Blue", value: "blue" },
  { label: "Blue-Green", value: "blue_green" },
  { label: "Green", value: "green" },
  { label: "Olive", value: "olive" },
] satisfies { label: string; value: EggColorValue }[];

export const annualEggProductionOptions = [
  { label: "Less than 150 eggs/year", value: "under_150" },
  { label: "150–200 eggs/year", value: "150_200" },
  { label: "200–250 eggs/year", value: "200_250" },
  { label: "250–300 eggs/year", value: "250_300" },
  { label: "More than 300 eggs/year", value: "over_300" },
] satisfies { label: string; value: AnnualEggProductionValue }[];

const emptyDraft: CustomBreedDraft = {
  annualEggProduction: "",
  birdType: "",
  description: "",
  eggColor: "",
  name: "",
};

export function CustomBreedDialog({
  duplicateNames,
  error,
  initialName,
  isChicken,
  isSaving,
  onClose,
  onSave,
  speciesName,
}: {
  duplicateNames: string[];
  error?: string | null;
  initialName?: string;
  isChicken: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: (draft: CustomBreedDraft) => Promise<void>;
  speciesName: string;
}) {
  const [draft, setDraft] = useState<CustomBreedDraft>({
    ...emptyDraft,
    name: initialName?.trim() ?? "",
  });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const duplicateNameSet = useMemo(
    () => new Set(duplicateNames.map(normalizeBreedName)),
    [duplicateNames],
  );
  const normalizedName = normalizeBreedName(draft.name);
  const hasDuplicateName = Boolean(
    normalizedName && duplicateNameSet.has(normalizedName),
  );

  function updateDraft(updates: Partial<CustomBreedDraft>) {
    setDraft((current) => ({ ...current, ...updates }));
    setValidationErrors([]);
  }

  async function saveBreed() {
    const nextErrors = validateCustomBreedDraft({
      draft,
      hasDuplicateName,
      isChicken,
    });

    setValidationErrors(nextErrors);

    if (nextErrors.length > 0) return;

    await onSave({
      ...draft,
      annualEggProduction: isChicken ? draft.annualEggProduction : "",
      birdType: isChicken ? draft.birdType : "",
      eggColor: isChicken ? draft.eggColor : "",
      description: draft.description.trim(),
      name: draft.name.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 px-3 py-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Add a New Breed
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Custom breeds are saved to your breed library so you can use them again.
            </p>
          </div>
          <button
            aria-label="Close add breed"
            className="rounded-md px-2 py-1 text-2xl leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-950"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-5">
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Species
              <input className="seller-form-field" disabled value={speciesName} />
            </label>

            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Breed name
              <input
                className="seller-form-field"
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
              />
            </label>

            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Breed description
              <textarea
                className="seller-form-field min-h-28 resize-y py-3"
                value={draft.description}
                onChange={(event) =>
                  updateDraft({ description: event.target.value })
                }
              />
            </label>

            {isChicken ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Bird type
                  <select
                    className="seller-form-field"
                    value={draft.birdType}
                    onChange={(event) =>
                      updateDraft({
                        birdType: event.target.value as BirdTypeValue | "",
                      })
                    }
                  >
                    <option value="">Choose type</option>
                    {birdTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Egg color
                  <select
                    className="seller-form-field"
                    value={draft.eggColor}
                    onChange={(event) =>
                      updateDraft({
                        eggColor: event.target.value as EggColorValue | "",
                      })
                    }
                  >
                    <option value="">Choose color</option>
                    {eggColorOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Annual egg production
                  <select
                    className="seller-form-field"
                    value={draft.annualEggProduction}
                    onChange={(event) =>
                      updateDraft({
                        annualEggProduction: event.target
                          .value as AnnualEggProductionValue | "",
                      })
                    }
                  >
                    <option value="">Choose range</option>
                    {annualEggProductionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>

          {validationErrors.length > 0 ? (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              <ul className="list-disc space-y-1 pl-5">
                {validationErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-stone-200 bg-stone-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            className="seller-secondary-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="seller-primary-button"
            disabled={isSaving}
            onClick={() => void saveBreed()}
            type="button"
          >
            {isSaving ? "Saving" : "Save Breed"}
          </button>
        </div>
      </div>
    </div>
  );
}

function validateCustomBreedDraft({
  draft,
  hasDuplicateName,
  isChicken,
}: {
  draft: CustomBreedDraft;
  hasDuplicateName: boolean;
  isChicken: boolean;
}) {
  const errors: string[] = [];

  if (!draft.name.trim()) errors.push("Add a breed name.");
  if (!draft.description.trim()) errors.push("Add a breed description.");
  if (hasDuplicateName) {
    errors.push("This breed already appears in the list. Choose it from search.");
  }

  if (isChicken) {
    if (!draft.birdType) errors.push("Choose a bird type.");
    if (!draft.eggColor) errors.push("Choose an egg color.");
    if (!draft.annualEggProduction) {
      errors.push("Choose an annual egg production range.");
    }
  }

  return errors;
}

function normalizeBreedName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
