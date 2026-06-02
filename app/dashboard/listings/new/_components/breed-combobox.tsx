"use client";

import { useId, useMemo, useState } from "react";

export type BreedComboboxChoice = {
  value: string;
  label: string;
  aliases?: string[];
};

export function BreedCombobox({
  aliasSearchError,
  choices,
  disabled = false,
  onChange,
  recentChoices,
  value,
}: {
  aliasSearchError?: string | null;
  choices: BreedComboboxChoice[];
  disabled?: boolean;
  onChange: (value: string) => void;
  recentChoices: BreedComboboxChoice[];
  value: string;
}) {
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedChoice = choices.find((choice) => choice.value === value);
  const normalizedQuery = normalizeSearchValue(query);
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];

    return choices
      .filter((choice) =>
        [choice.label, ...(choice.aliases ?? [])].some((searchValue) =>
          normalizeSearchValue(searchValue).includes(normalizedQuery),
        ),
      )
      .slice(0, 12);
  }, [choices, normalizedQuery]);
  const shouldShowRecent = isOpen && !normalizedQuery && recentChoices.length > 0;
  const shouldShowSearchResults = isOpen && normalizedQuery.length > 0;
  const visibleChoices = shouldShowRecent ? recentChoices : searchResults;

  function selectChoice(nextValue: string) {
    onChange(nextValue);
    setQuery("");
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <input
        className="seller-form-field"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-autocomplete="list"
        disabled={disabled}
        placeholder="Search breed"
        value={isOpen ? query : selectedChoice?.label ?? ""}
        onBlur={() => {
          window.setTimeout(() => {
            setIsOpen(false);
            setQuery("");
          }, 120);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setIsOpen(true);
        }}
      />

      {isOpen ? (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2 shadow-lg"
          id={listboxId}
          role="listbox"
        >
          {aliasSearchError ? (
            <p className="px-3 py-2 text-xs font-semibold text-amber-700">
              Alias search is unavailable right now. Breed name search still works.
            </p>
          ) : null}

          {shouldShowRecent ? (
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
              Recent Breeds
            </p>
          ) : null}

          {shouldShowSearchResults && visibleChoices.length === 0 ? (
            <p className="px-3 py-3 text-sm leading-6 text-stone-600">
              No matching breeds found.
            </p>
          ) : null}

          {!shouldShowRecent && !shouldShowSearchResults ? (
            <p className="px-3 py-3 text-sm leading-6 text-stone-600">
              Start typing to search breeds.
            </p>
          ) : null}

          {visibleChoices.map((choice) => (
            <button
              key={choice.value}
              aria-selected={choice.value === value}
              className="block w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-stone-50 focus:bg-stone-50 focus:outline-none"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectChoice(choice.value)}
              role="option"
              type="button"
            >
              <span className="block font-semibold text-stone-950">
                {choice.label}
              </span>
              {normalizedQuery && choice.aliases?.length ? (
                <span className="mt-1 block text-xs font-semibold text-stone-500">
                  Also matches: {choice.aliases.slice(0, 3).join(", ")}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}
