import Image from "next/image";
import { inputClass } from "./constants";
import { SectionCard } from "./SectionCard";
import type { AgeAtAvailabilityResult, SpeciesOption } from "./types";

export function HatchInformationCard({
  ageAtAvailability,
  availableDate,
  hatchDate,
  referenceError,
  referenceLoading,
  setAvailableDate,
  setHatchDate,
  setSpecies,
  species,
  speciesOptions,
  usingFallbackSpecies,
}: {
  ageAtAvailability: AgeAtAvailabilityResult;
  availableDate: string;
  hatchDate: string;
  referenceError: string | null;
  referenceLoading: boolean;
  setAvailableDate: (value: string) => void;
  setHatchDate: (value: string) => void;
  setSpecies: (value: SpeciesOption) => void;
  species: SpeciesOption;
  speciesOptions: SpeciesOption[];
  usingFallbackSpecies: boolean;
}) {
  return (
    <SectionCard step="1" title="Hatch Information">
      <p className="text-sm leading-6 text-stone-600">
        Use a separate entry for birds from a different hatch date.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SpeciesField
          options={speciesOptions}
          value={species}
          onChange={setSpecies}
        />
        <DateField
          glyph="/glyphs/calendar.png"
          label="Hatch date"
          value={hatchDate}
          onChange={setHatchDate}
        />
        <DateField
          glyph="/glyphs/calendar.png"
          label="Available date"
          value={availableDate}
          onChange={setAvailableDate}
        />
      </div>
      <div
        className={`mt-4 rounded-md border px-4 py-3 text-sm font-semibold ${
          ageAtAvailability.status === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-emerald-200 bg-emerald-50 text-emerald-900"
        }`}
      >
        {ageAtAvailability.message}
      </div>
      {referenceLoading ? (
        <p className="mt-3 text-xs font-semibold text-stone-500">
          Loading species and breed profile options...
        </p>
      ) : null}
      {referenceError ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
          Reference data could not be loaded. Local placeholder options are still
          available for this UI shell.
        </p>
      ) : null}
      {!referenceLoading && !referenceError && usingFallbackSpecies ? (
        <p className="mt-3 text-xs font-semibold text-stone-500">
          Species options are local placeholders until matching reference rows
          are available.
        </p>
      ) : null}
    </SectionCard>
  );
}

function SpeciesField({
  onChange,
  options,
  value,
}: {
  onChange: (value: SpeciesOption) => void;
  options: SpeciesOption[];
  value: SpeciesOption;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-semibold text-stone-600">
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
          className={`${inputClass} appearance-none pl-10 pr-9`}
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
          className="pointer-events-none absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b-2 border-r-2 border-emerald-800/70"
        />
      </span>
    </label>
  );
}

function getSpeciesOptionValue(option: SpeciesOption) {
  return option.id ?? `local:${option.slug ?? option.label}`;
}

function DateField({
  glyph,
  label,
  onChange,
  value,
}: {
  glyph: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-semibold text-stone-600">
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
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}
