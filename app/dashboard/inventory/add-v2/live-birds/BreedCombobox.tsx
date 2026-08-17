"use client";

import { useId, useMemo, useState } from "react";
import { inputClass } from "./constants";
import type { BreedOption } from "./types";

export function BreedCombobox({
  disabled = false,
  fieldName,
  inputRef,
  onChange,
  options,
  placeholderLabel = "Choose breed",
  selectedBreedId,
  selectedId,
  value,
}: {
  disabled?: boolean;
  fieldName?: string;
  inputRef?: (element: HTMLInputElement | null) => void;
  onChange: (value: BreedOption) => void;
  options: BreedOption[];
  placeholderLabel?: string;
  selectedBreedId: string | null;
  selectedId: string | null;
  value: string;
}) {
  const generatedListboxId = useId();
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const listboxId = `live-birds-breed-listbox-${generatedListboxId}`;
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
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return options
      .filter((option) =>
        normalizedQuery
          ? option.label.toLowerCase().includes(normalizedQuery)
          : true,
      )
      .slice(0, 40);
  }, [options, query]);

  return (
    <span className="block">
      <span className="relative block">
        <input
          ref={inputRef}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          autoComplete="off"
          className={`${inputClass} pr-9 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500`}
          data-live-birds-offering-field={fieldName}
          disabled={disabled}
          placeholder={placeholderLabel}
          role="combobox"
          value={query}
          onBlur={() => {
            setQuery(value);
            window.setTimeout(() => setIsOpen(false), 120);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={(event) => {
            event.currentTarget.select();
            setIsOpen(true);
          }}
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b-2 border-r-2 ${
            disabled ? "border-stone-400" : "border-emerald-800/70"
          }`}
        />
      </span>
      {isOpen && !disabled ? (
        <span
          className="mt-1 block max-h-64 w-full overflow-y-auto rounded-md border border-stone-200 bg-white py-1 shadow-sm"
          id={listboxId}
          role="listbox"
        >
          {filteredOptions.length === 0 ? (
            <span className="block px-3 py-3 text-sm font-medium text-stone-500">
              No matching breeds
            </span>
          ) : (
            filteredOptions.map((option) => {
              const optionValue = getBreedOptionValue(option);
              const isSelected = optionValue === selectedValue;

              return (
                <button
                  aria-selected={isSelected}
                  className={`block w-full px-3 py-3 text-left text-base font-semibold ${
                    isSelected
                      ? "bg-emerald-50 text-emerald-950"
                      : "text-stone-800"
                  }`}
                  key={optionValue}
                  role="option"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option);
                    setQuery(option.label);
                    setIsOpen(false);
                  }}
                >
                  {option.label}
                </button>
              );
            })
          )}
        </span>
      ) : null}
    </span>
  );
}

export function getBreedOptionValue(option: BreedOption) {
  if (option.id) return `profile:${option.id}`;
  if (option.breedId) return `catalog:${option.breedId}`;

  return `local:${option.label}`;
}
