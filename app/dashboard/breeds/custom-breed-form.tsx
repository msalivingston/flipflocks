"use client";

import {
  annualEggProductionOptions,
  breedCategoryOptions,
  eggColorOptions,
} from "@/lib/chicken-metadata-options";
import type { RefObject } from "react";
import type { BreedSpecies } from "./breed-data";

export const breedDescriptionMaxLength = 1500;
export const breedVarietyMaxLength = 120;

export type CustomBreedDraft = {
  annualEggProduction: string;
  breedCategory: string;
  description: string;
  eggColor: string;
  name: string;
  variety: string;
  speciesId: string;
};

export type CustomBreedValidationResult =
  | { ok: true; draft: CustomBreedDraft }
  | { ok: false; message: string };

type CustomBreedFormProps = {
  chickenBreedCategoryRequired?: boolean;
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
  draft: CustomBreedDraft;
  disabled?: boolean;
  layout?: "desktop" | "mobile";
  nameInputRef?: RefObject<HTMLInputElement | null>;
  onDraftChange: (draft: CustomBreedDraft) => void;
  species: BreedSpecies[];
  speciesLocked?: boolean;
  varietyInputRef?: RefObject<HTMLInputElement | null>;
};

export function createBlankCustomBreedDraft(
  speciesId: string,
): CustomBreedDraft {
  return {
    annualEggProduction: "",
    breedCategory: "",
    description: "",
    eggColor: "",
    name: "",
    variety: "",
    speciesId,
  };
}

export function sanitizeCustomBreedDraft({
  draft,
  species,
}: {
  draft: CustomBreedDraft;
  species: BreedSpecies[];
}): CustomBreedDraft {
  const isChicken = isChickenSpecies(draft.speciesId, species);

  return {
    annualEggProduction: isChicken ? draft.annualEggProduction.trim() : "",
    breedCategory: isChicken ? draft.breedCategory.trim() : "",
    description: draft.description.trim(),
    eggColor: isChicken ? draft.eggColor.trim() : "",
    name: draft.name.trim(),
    variety: draft.variety.trim(),
    speciesId: draft.speciesId,
  };
}

export function validateCustomBreedDraft({
  draft,
  requireChickenBreedCategory = false,
  species,
}: {
  draft: CustomBreedDraft;
  requireChickenBreedCategory?: boolean;
  species: BreedSpecies[];
}): CustomBreedValidationResult {
  const nextDraft = sanitizeCustomBreedDraft({ draft, species });

  if (!nextDraft.speciesId) {
    return { ok: false, message: "Choose a species." };
  }

  if (!nextDraft.name) {
    return { ok: false, message: "Add a breed name." };
  }

  if (nextDraft.variety.length > breedVarietyMaxLength) {
    return {
      ok: false,
      message: `Variety must be ${breedVarietyMaxLength} characters or less.`,
    };
  }

  if (nextDraft.description.length > breedDescriptionMaxLength) {
    return {
      ok: false,
      message: `Breed description must be ${breedDescriptionMaxLength} characters or less.`,
    };
  }

  if (
    nextDraft.breedCategory &&
    !breedCategoryOptions.some(
      (category) => category === nextDraft.breedCategory,
    )
  ) {
    return { ok: false, message: "Choose a supported Breed Category." };
  }

  if (
    requireChickenBreedCategory &&
    isChickenSpecies(nextDraft.speciesId, species) &&
    !nextDraft.breedCategory
  ) {
    return { ok: false, message: "Choose a Breed Category for this chicken breed." };
  }

  if (
    nextDraft.eggColor &&
    !eggColorOptions.some((option) => option.value === nextDraft.eggColor)
  ) {
    return { ok: false, message: "Choose a supported egg color." };
  }

  if (
    nextDraft.annualEggProduction &&
    !annualEggProductionOptions.some(
      (option) => option.value === nextDraft.annualEggProduction,
    )
  ) {
    return {
      ok: false,
      message: "Choose a supported annual egg production range.",
    };
  }

  return { ok: true, draft: nextDraft };
}

export function isChickenSpecies(speciesId: string, species: BreedSpecies[]) {
  return species.find((item) => item.id === speciesId)?.slug === "chicken";
}

export function CustomBreedForm({
  chickenBreedCategoryRequired = false,
  descriptionLabel = "Storefront description",
  descriptionPlaceholder = "Add the description buyers should see.",
  disabled = false,
  draft,
  layout = "desktop",
  nameInputRef,
  onDraftChange,
  species,
  speciesLocked = false,
  varietyInputRef,
}: CustomBreedFormProps) {
  const isMobile = layout === "mobile";
  const isChicken = isChickenSpecies(draft.speciesId, species);
  const labelClass = isMobile
    ? "grid gap-2 text-base font-bold text-stone-800"
    : "grid gap-1 text-sm font-semibold text-stone-700";
  const fullWidthLabelClass = isMobile
    ? labelClass
    : `${labelClass} sm:col-span-2`;
  const fieldClass = isMobile
    ? "h-14 w-full rounded-lg border border-stone-300 bg-white px-3 text-base font-normal text-stone-950 shadow-sm placeholder:text-stone-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 disabled:bg-stone-100 disabled:text-stone-500"
    : "seller-form-field";
  const textareaClass = isMobile
    ? "min-h-36 w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-3 text-base font-normal leading-6 text-stone-950 shadow-sm placeholder:text-stone-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 disabled:bg-stone-100 disabled:text-stone-500"
    : "seller-form-field min-h-28 resize-y py-3";

  function updateDraft(updates: Partial<CustomBreedDraft>) {
    onDraftChange({ ...draft, ...updates });
  }

  return (
    <div className={isMobile ? "grid gap-5" : "grid gap-4 sm:grid-cols-2"}>
      <label className={labelClass}>
        Species
        <select
          className={fieldClass}
          disabled={disabled || speciesLocked}
          value={draft.speciesId}
          onChange={(event) =>
            updateDraft({
              annualEggProduction: "",
              breedCategory: "",
              eggColor: "",
              speciesId: event.target.value,
            })
          }
        >
          {species.map((item) => (
            <option key={item.id} value={item.id}>
              {item.common_name}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Breed
        <input
          className={fieldClass}
          disabled={disabled}
          placeholder="Example: Blue Splash Olive Egger"
          ref={nameInputRef}
          value={draft.name}
          onChange={(event) => updateDraft({ name: event.target.value })}
        />
      </label>

      <label className={labelClass}>
        Variety <span className="font-normal text-stone-500">(optional)</span>
        <input
          className={fieldClass}
          disabled={disabled}
          maxLength={breedVarietyMaxLength}
          placeholder="Example: Black"
          ref={varietyInputRef}
          value={draft.variety}
          onChange={(event) => updateDraft({ variety: event.target.value })}
        />
      </label>

      {isChicken ? (
        <>
          <label className={labelClass}>
            Breed Category
            {chickenBreedCategoryRequired ? (
              <span className="font-normal text-stone-500">(required)</span>
            ) : null}
            <select
              className={fieldClass}
              disabled={disabled}
              required={chickenBreedCategoryRequired}
              value={draft.breedCategory}
              onChange={(event) =>
                updateDraft({ breedCategory: event.target.value })
              }
            >
              <option value="">Choose Breed Category</option>
              {breedCategoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            Egg color
            <select
              className={fieldClass}
              disabled={disabled}
              value={draft.eggColor}
              onChange={(event) => updateDraft({ eggColor: event.target.value })}
            >
              <option value="">Choose egg color</option>
              {eggColorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            Annual egg production
            <select
              className={fieldClass}
              disabled={disabled}
              value={draft.annualEggProduction}
              onChange={(event) =>
                updateDraft({ annualEggProduction: event.target.value })
              }
            >
              <option value="">Choose annual egg production</option>
              {annualEggProductionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}

      <label className={fullWidthLabelClass}>
        {descriptionLabel}
        <textarea
          className={textareaClass}
          disabled={disabled}
          maxLength={breedDescriptionMaxLength}
          placeholder={descriptionPlaceholder}
          value={draft.description}
          onChange={(event) => updateDraft({ description: event.target.value })}
        />
        <span className="text-right text-sm font-medium text-stone-500">
          {draft.description.length}/{breedDescriptionMaxLength}
        </span>
      </label>
    </div>
  );
}
