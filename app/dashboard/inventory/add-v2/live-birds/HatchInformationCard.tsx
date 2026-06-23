import Image from "next/image";
import { inputClass, speciesOptions } from "./constants";
import { SectionCard } from "./SectionCard";
import type { AgeAtAvailabilityResult } from "./types";

export function HatchInformationCard({
  ageAtAvailability,
  availableDate,
  hatchDate,
  setAvailableDate,
  setHatchDate,
  setSpecies,
  species,
}: {
  ageAtAvailability: AgeAtAvailabilityResult;
  availableDate: string;
  hatchDate: string;
  setAvailableDate: (value: string) => void;
  setHatchDate: (value: string) => void;
  setSpecies: (value: string) => void;
  species: string;
}) {
  return (
    <SectionCard step="1" title="Hatch Information">
      <p className="text-sm leading-6 text-stone-600">
        All bird offerings below will use this hatch date.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SpeciesField value={species} onChange={setSpecies} />
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
    </SectionCard>
  );
}

function SpeciesField({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
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
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {speciesOptions.map((speciesOption) => (
            <option key={speciesOption} value={speciesOption}>
              {speciesOption}
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
