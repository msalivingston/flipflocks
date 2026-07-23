import Image from "next/image";
import { inputClass } from "./constants";
import { SectionCard } from "./SectionCard";
import type { AgeAtAvailabilityResult, SpeciesOption } from "./types";

export function HatchInformationCard({
  ageAtAvailability,
  availableDate,
  availableDateHelpText,
  hatchDate,
  introText,
  referenceError,
  referenceLoading,
  setAvailableDate,
  setHatchDate,
  setSpecies,
  species,
  speciesReadOnly = false,
  speciesOptions,
  usingFallbackSpecies,
}: {
  ageAtAvailability: AgeAtAvailabilityResult;
  availableDate: string;
  availableDateHelpText?: string;
  hatchDate: string;
  introText?: string;
  referenceError: string | null;
  referenceLoading: boolean;
  setAvailableDate: (value: string) => void;
  setHatchDate: (value: string) => void;
  setSpecies: (value: SpeciesOption) => void;
  species: SpeciesOption;
  speciesReadOnly?: boolean;
  speciesOptions: SpeciesOption[];
  usingFallbackSpecies: boolean;
}) {
  return (
    <SectionCard step="1" title="Hatch details">
      <p className="text-base leading-7 text-stone-600">
        {introText ??
          "All birds added here should share the same hatch date. Start a separate listing for birds from another hatch."}
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SpeciesField
          disabled={speciesReadOnly}
          fieldId="species"
          options={speciesOptions}
          value={species}
          onChange={setSpecies}
        />
        <DateField
          fieldId="hatchDate"
          glyph="/glyphs/calendar.png"
          label="Hatch date"
          value={hatchDate}
          onChange={setHatchDate}
        />
        <DateField
          fieldId="availableDate"
          glyph="/glyphs/calendar.png"
          label="Available date (earliest pickup)"
          value={availableDate}
          onChange={setAvailableDate}
          helpText={
            availableDateHelpText ??
            "The earliest date buyers can receive these birds."
          }
        />
      </div>
      <div
        className={`mt-4 rounded-md border px-4 py-3 text-base font-semibold leading-7 ${
          ageAtAvailability.status === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-emerald-200 bg-emerald-50 text-emerald-900"
        }`}
      >
        {ageAtAvailability.message}
      </div>
      {referenceLoading ? (
        <p className="mt-3 text-base font-semibold leading-7 text-stone-500">
          Loading species and breed profile options...
        </p>
      ) : null}
      {referenceError ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-base font-semibold leading-7 text-amber-800">
          Reference data could not be loaded. Local placeholder options are still
          available for this UI shell.
        </p>
      ) : null}
      {!referenceLoading && !referenceError && usingFallbackSpecies ? (
        <p className="mt-3 text-base font-semibold leading-7 text-stone-500">
          Species options are local placeholders until matching reference rows
          are available.
        </p>
      ) : null}
    </SectionCard>
  );
}

function SpeciesField({
  disabled = false,
  fieldId,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  fieldId: string;
  onChange: (value: SpeciesOption) => void;
  options: SpeciesOption[];
  value: SpeciesOption;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
        Species
      </span>
      <span className="relative block">
        <Image
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          src="/glyphs/hen.png"
          alt=""
          width={18}
          height={18}
        />
        <select
          className={`${inputClass} appearance-none pl-10 pr-9 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500`}
          data-live-birds-field={fieldId}
          disabled={disabled}
          value={getSpeciesOptionValue(value)}
          onChange={(event) => {
            const nextOption = options.find(
              (option) => getSpeciesOptionValue(option) === event.target.value,
            );

            if (nextOption) onChange(nextOption);
          }}
        >
          {value.label.trim().length === 0 ? (
            <option disabled value={getSpeciesOptionValue(value)}>
              Choose species
            </option>
          ) : null}
          {options.map((speciesOption) => (
            <option
              key={getSpeciesOptionValue(speciesOption)}
              value={getSpeciesOptionValue(speciesOption)}
            >
              {speciesOption.label}
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
      {disabled ? (
        <span className="mt-1.5 block text-base font-medium leading-6 text-stone-500">
          Species cannot be changed for this listing.
        </span>
      ) : null}
    </label>
  );
}

function getSpeciesOptionValue(option: SpeciesOption) {
  return option.id ?? `local:${option.slug ?? option.label}`;
}

function DateField({
  fieldId,
  glyph,
  helpText,
  label,
  onChange,
  value,
}: {
  fieldId: string;
  glyph: string;
  helpText?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
        {label}
      </span>
      <span className="relative block">
        <Image
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          src={glyph}
          alt=""
          width={18}
          height={18}
        />
        <input
          className={`${inputClass} pl-10`}
          data-live-birds-field={fieldId}
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      {helpText ? (
        <span className="mt-1.5 block text-base font-medium leading-6 text-stone-500">
          {helpText}
        </span>
      ) : null}
    </label>
  );
}
