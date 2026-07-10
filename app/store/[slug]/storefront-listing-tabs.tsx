"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AvailabilityBadge,
  EmptyStorefront,
  ListingPhoto,
  cx,
} from "./storefront-ui";
import { storefrontSerifClass } from "./storefront-fonts";
import {
  StorefrontCategorySymbol,
  type StorefrontCategorySymbolName,
} from "./storefront-category-symbols";

export type StorefrontListingCard = {
  availabilityCode: string;
  availabilityLabel: string;
  description: string | null;
  detail: string;
  href: string;
  imageAlt: string;
  imageUrl: string | null;
  meta: string;
  price: string;
  title: string;
};

export type StorefrontListingSection = {
  cards: StorefrontListingCard[];
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  id: string;
  label: string;
};

export function StorefrontListingTabs({
  sections,
}: {
  sections: StorefrontListingSection[];
}) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [breedFilter, setBreedFilter] = useState("all");
  const [priceFilter, setPriceFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("all");
  const activeSection =
    sections.find((section) => section.id === activeId) ?? sections[0];
  const breedOptions = useMemo(
    () => buildBreedOptions(activeSection?.cards ?? []),
    [activeSection],
  );
  const speciesOptions = useMemo(
    () => buildSpeciesOptions(activeSection?.cards ?? []),
    [activeSection],
  );
  const filteredCards = useMemo(
    () =>
      filterCards(activeSection?.cards ?? [], {
        availability: availabilityFilter,
        breed: breedFilter,
        price: priceFilter,
        query,
        species: speciesFilter,
      }),
    [activeSection, availabilityFilter, breedFilter, priceFilter, query, speciesFilter],
  );
  const hasActiveFilters =
    availabilityFilter !== "all" ||
    breedFilter !== "all" ||
    priceFilter !== "all" ||
    query.trim() !== "" ||
    speciesFilter !== "all";

  useEffect(() => {
    function syncActiveTabFromHash() {
      const hash = window.location.hash.replace(/^#/, "");
      const hashSectionId = hash
        .replace(/-tab$/, "")
        .replace(/-panel$/, "");

      if (!hashSectionId || hashSectionId === "shop-listings") return;

      if (sections.some((section) => section.id === hashSectionId)) {
        setActiveId(hashSectionId);
        setAvailabilityFilter("all");
        setBreedFilter("all");
        setPriceFilter("all");
        setQuery("");
        setSpeciesFilter("all");
      }
    }

    syncActiveTabFromHash();
    window.addEventListener("hashchange", syncActiveTabFromHash);

    return () => {
      window.removeEventListener("hashchange", syncActiveTabFromHash);
    };
  }, [sections]);

  if (!activeSection) return null;

  function changeCategory(sectionId: string) {
    setActiveId(sectionId);
    setAvailabilityFilter("all");
    setBreedFilter("all");
    setPriceFilter("all");
    setQuery("");
    setSpeciesFilter("all");
  }

  function resetFilters() {
    setAvailabilityFilter("all");
    setBreedFilter("all");
    setPriceFilter("all");
    setQuery("");
    setSpeciesFilter("all");
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-end">
        <h2
          className={cx(
            storefrontSerifClass,
            "text-2xl font-bold leading-tight text-stone-950 sm:text-3xl lg:text-[2.0625rem]",
          )}
        >
          Shop
        </h2>
        <div
          aria-label="Storefront listing categories"
          className="grid grid-cols-4 gap-2 border-b border-[#ddd5c7]"
          role="tablist"
        >
          {sections.map((section) => {
            const active = section.id === activeSection.id;

            return (
              <button
                aria-controls={`${section.id}-panel`}
                aria-selected={active}
                className={cx(
                  "relative -mb-px inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-t-md border border-b-0 px-2 text-xs font-semibold transition lg:min-h-11 lg:gap-2 lg:px-3 lg:text-sm",
                  active
                    ? "border-[#c8d6bf] bg-white text-[#073f1e] shadow-[0_-1px_0_#c8d6bf_inset]"
                    : "border-[#eee8dc] bg-[#f8f3ea] text-stone-700 hover:border-[#ddd5c7] hover:bg-white hover:text-[#073f1e]",
                )}
                id={`${section.id}-tab`}
                key={section.id}
                onClick={() => changeCategory(section.id)}
                role="tab"
                type="button"
              >
                <ListingTabIcon name={tabIconName(section.label)} />
                <span className="whitespace-nowrap">{section.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section
        aria-labelledby={`${activeSection.id}-tab`}
        className="scroll-mt-28"
        id={`${activeSection.id}-panel`}
        role="tabpanel"
      >
        {activeSection.cards.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-5">
            <ListingFilters
              availability={availabilityFilter}
              breed={breedFilter}
              breedOptions={breedOptions}
              hasActiveFilters={hasActiveFilters}
              price={priceFilter}
              query={query}
              species={speciesFilter}
              speciesOptions={speciesOptions}
              onAvailabilityChange={setAvailabilityFilter}
              onBreedChange={setBreedFilter}
              onPriceChange={setPriceFilter}
              onQueryChange={setQuery}
              onReset={resetFilters}
              onSpeciesChange={setSpeciesFilter}
            />
            {filteredCards.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
                {filteredCards.map((card) => (
                  <ListingCard card={card} key={card.href} />
                ))}
              </div>
            ) : (
              <EmptyStorefront
                title="No listings match"
                description="Try adjusting the search or filters."
              />
            )}
          </div>
        ) : (
          <EmptyStorefront
            title={activeSection.emptyTitle}
            description={activeSection.emptyDescription}
          />
        )}
      </section>
    </div>
  );
}

function ListingFilters({
  availability,
  breed,
  breedOptions,
  hasActiveFilters,
  onAvailabilityChange,
  onBreedChange,
  onPriceChange,
  onQueryChange,
  onReset,
  onSpeciesChange,
  price,
  query,
  species,
  speciesOptions,
}: {
  availability: string;
  breed: string;
  breedOptions: string[];
  hasActiveFilters: boolean;
  onAvailabilityChange: (value: string) => void;
  onBreedChange: (value: string) => void;
  onPriceChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onReset: () => void;
  onSpeciesChange: (value: string) => void;
  price: string;
  query: string;
  species: string;
  speciesOptions: string[];
}) {
  return (
    <aside className="h-fit rounded-lg border border-[#e3d9c8] bg-white p-3">
      <div className="grid gap-2.5">
        <label className="grid gap-1 text-[0.68rem] font-bold uppercase tracking-[0.06em] text-stone-700">
          Search listings
          <input
            className="min-h-8 rounded-md border border-[#ddd5c7] bg-white px-2.5 text-xs font-medium normal-case tracking-normal text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-[#24512f] focus:ring-2 focus:ring-emerald-100"
            id="storefront-search"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search listings"
            type="search"
            value={query}
          />
        </label>

        <FilterSelect
          label="Species"
          value={species}
          onChange={onSpeciesChange}
          options={[
            { label: "All species", value: "all" },
            ...speciesOptions.map((option) => ({
              label: toTitleCase(option),
              value: option,
            })),
          ]}
        />

        <FilterSelect
          label="Breed"
          value={breed}
          onChange={onBreedChange}
          options={[
            { label: "All breeds", value: "all" },
            ...breedOptions.map((option) => ({
              label: toTitleCase(option),
              value: option,
            })),
          ]}
        />

        <FilterSelect
          label="Availability"
          value={availability}
          onChange={onAvailabilityChange}
          options={[
            { label: "All availability", value: "all" },
            { label: "Ready now", value: "ready_now" },
            { label: "Reserve now", value: "reserve_now" },
            { label: "Sold out", value: "sold_out" },
          ]}
        />

        <FilterSelect
          label="Price"
          value={price}
          onChange={onPriceChange}
          options={[
            { label: "Any price", value: "all" },
            { label: "Under $10", value: "under-10" },
            { label: "$10 to $25", value: "10-25" },
            { label: "$25 and up", value: "25-up" },
          ]}
        />

        <button
          className="inline-flex w-fit items-center rounded-md text-sm font-semibold text-[#073f1e] transition hover:text-[#0b562a] disabled:cursor-not-allowed disabled:text-stone-400"
          disabled={!hasActiveFilters}
          onClick={onReset}
          type="button"
        >
          Reset filters
        </button>
      </div>
    </aside>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-[0.68rem] font-bold uppercase tracking-[0.06em] text-stone-700">
      {label}
      <select
        className="min-h-8 rounded-md border border-[#ddd5c7] bg-white px-2.5 text-xs font-medium normal-case tracking-normal text-stone-700 outline-none transition focus:border-[#24512f] focus:ring-2 focus:ring-emerald-100"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ListingCard({ card }: { card: StorefrontListingCard }) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-[#ded7c8] bg-white transition hover:border-[#bfcfb6] hover:shadow-sm">
      <Link
        className="flex h-full flex-col focus:outline-none focus:ring-2 focus:ring-emerald-700"
        href={card.href}
      >
        <div className="px-3.5 pb-2 pt-3 lg:px-4 lg:pb-2.5 lg:pt-4">
          <p className="truncate text-[0.7rem] font-bold uppercase tracking-[0.08em] text-emerald-700">
            {card.meta}
          </p>
          <h3 className="mt-1 line-clamp-1 text-base font-semibold leading-snug text-stone-950 lg:mt-1.5">
            {card.title}
          </h3>
        </div>
        <div className="relative">
          <ListingPhoto alt={card.imageAlt} aspect="square" src={card.imageUrl} />
          <div className="absolute left-3 top-3">
            <AvailabilityBadge
              code={card.availabilityCode}
              label={card.availabilityLabel}
            />
          </div>
        </div>
        <div className="flex flex-1 flex-col p-3.5 pt-3 lg:p-4 lg:pt-3.5">
          <div className="mt-auto flex items-end justify-between gap-3 lg:gap-4">
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-[#073f1e]">
                {card.price}
              </p>
            </div>
            <span className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-[#073f1e] px-3 text-sm font-semibold text-white transition group-hover:bg-[#0b562a] lg:min-h-11 lg:px-4 lg:text-base">
              View
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function buildSpeciesOptions(cards: StorefrontListingCard[]) {
  return Array.from(
    new Set(
      cards
        .map((card) => normalizeFilterValue(card.meta))
        .filter(Boolean),
    ),
  ).sort();
}

function buildBreedOptions(cards: StorefrontListingCard[]) {
  return Array.from(
    new Set(
      cards
        .map((card) => normalizeFilterValue(card.title))
        .filter(Boolean),
    ),
  ).sort();
}

function filterCards(
  cards: StorefrontListingCard[],
  filters: {
    availability: string;
    breed: string;
    price: string;
    query: string;
    species: string;
  },
) {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return cards.filter((card) => {
    if (
      normalizedQuery &&
      ![card.title, card.description, card.meta]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    ) {
      return false;
    }

    if (
      filters.species !== "all" &&
      normalizeFilterValue(card.meta) !== filters.species
    ) {
      return false;
    }

    if (
      filters.breed !== "all" &&
      normalizeFilterValue(card.title) !== filters.breed
    ) {
      return false;
    }

    if (
      filters.availability !== "all" &&
      card.availabilityCode !== filters.availability
    ) {
      return false;
    }

    if (!matchesPriceFilter(card.price, filters.price)) {
      return false;
    }

    return true;
  });
}

function matchesPriceFilter(price: string, filter: string) {
  if (filter === "all") return true;

  const value = extractPrice(price);

  if (value === null) return false;
  if (filter === "under-10") return value < 10;
  if (filter === "10-25") return value >= 10 && value <= 25;
  if (filter === "25-up") return value >= 25;

  return true;
}

function extractPrice(price: string) {
  const match = price.match(/\$?(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase();
}

function toTitleCase(value: string) {
  return value.replace(/\w\S*/g, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1),
  );
}

function tabIconName(label: string): StorefrontCategorySymbolName {
  if (label.includes("Egg")) return "egg";
  if (label.includes("Equipment")) return "equipment";
  if (label.includes("Processed")) return "processed";
  return "poultry";
}

function ListingTabIcon({ name }: { name: StorefrontCategorySymbolName }) {
  return (
    <StorefrontCategorySymbol
      className="h-5 w-5 lg:h-6 lg:w-6"
      name={name}
    />
  );
}
