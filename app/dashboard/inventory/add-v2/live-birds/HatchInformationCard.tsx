"use client";

import Image from "next/image";
import { useState } from "react";
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
  const isComplete = Boolean(
    species.label.trim() && hatchDate.trim() && availableDate.trim(),
  );
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const isMobileExpanded = !isComplete || mobileExpanded;

  function renderBody() {
    return (
      <>
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
      <AgeMessage ageAtAvailability={ageAtAvailability} />
      <ReferenceMessages
        referenceError={referenceError}
        referenceLoading={referenceLoading}
        usingFallbackSpecies={usingFallbackSpecies}
      />
      </>
    );
  }

  return (
    <>
      <section className="rounded-xl border border-transparent bg-white p-4 shadow-sm sm:hidden">
        <button
          aria-expanded={isMobileExpanded}
          className="flex min-h-11 w-full items-center gap-3 text-left"
          type="button"
          onClick={() => setMobileExpanded((expanded) => !expanded)}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base font-bold text-emerald-900">
            1
          </span>
          <span className="min-w-0 flex-1 text-xl font-bold text-stone-950">
            Hatch details
          </span>
          {isComplete ? <CompleteIconLabel /> : null}
          <DisclosureChevron expanded={isMobileExpanded} />
        </button>
        {!isMobileExpanded && isComplete ? (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 min-[380px]:grid-cols-2">
              <DateSummary label="Hatch date" value={formatMobileDate(hatchDate)} />
              <DateSummary
                label="Available date"
                value={formatMobileDate(availableDate)}
              />
            </div>
            <AgeMessage ageAtAvailability={ageAtAvailability} />
          </div>
        ) : (
          <div className="mt-3">{renderBody()}</div>
        )}
      </section>
      <div className="hidden sm:block">
        <SectionCard step="1" title="Hatch details">
          {renderBody()}
        </SectionCard>
      </div>
    </>
  );
}

function AgeMessage({
  ageAtAvailability,
}: {
  ageAtAvailability: AgeAtAvailabilityResult;
}) {
  return (
    <div
      className={`mt-4 rounded-md border px-4 py-3 text-base font-semibold leading-7 ${
        ageAtAvailability.status === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
    >
      {ageAtAvailability.message}
    </div>
  );
}

function ReferenceMessages({
  referenceError,
  referenceLoading,
  usingFallbackSpecies,
}: {
  referenceError: string | null;
  referenceLoading: boolean;
  usingFallbackSpecies: boolean;
}) {
  return (
    <>
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
    </>
  );
}

function DateSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-stone-100 bg-stone-50 px-3 py-2">
      <Image src="/glyphs/calendar.png" alt="" width={18} height={18} />
      <div>
        <p className="text-sm font-semibold text-stone-600">{label}</p>
        <p className="text-base font-bold text-stone-950">{value}</p>
      </div>
    </div>
  );
}

function CompleteIconLabel() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-emerald-800">
      <span
        aria-hidden="true"
        className="block h-2.5 w-1.5 rotate-45 border-b-2 border-r-2 border-emerald-700"
      />
      Complete
    </span>
  );
}

function DisclosureChevron({ expanded = false }: { expanded?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-2.5 w-2.5 shrink-0 border-b-2 border-r-2 border-emerald-800/80 ${
        expanded ? "rotate-45" : "-rotate-45"
      }`}
    />
  );
}

function formatMobileDate(value: string) {
  if (!value) return "Not selected";
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
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
