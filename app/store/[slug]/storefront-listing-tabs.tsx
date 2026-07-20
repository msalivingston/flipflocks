"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Funnel } from "lucide-react";
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
  ageFilterDays?: number[];
  availabilityCode: string;
  availabilityLabel: string;
  batchFilters?: StorefrontListingCardBatchFilter[];
  breedFilter?: string | null;
  categoryFilter?: string | null;
  conditionFilter?: string | null;
  description: string | null;
  detail: string;
  href: string;
  imageAlt: string;
  imageUrl: string | null;
  meta: string;
  price: string;
  speciesFilter?: string | null;
  title: string;
};

export type StorefrontListingCardBatchFilter = {
  ageFilterDays: number | null;
  availabilityCode: string;
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
  const [ageFilter, setAgeFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [breedFilter, setBreedFilter] = useState("all");
  const [priceFilter, setPriceFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("all");
  const activeSection =
    sections.find((section) => section.id === activeId) ?? sections[0];
  const showAgeFilter = useMemo(
    () =>
      (activeSection?.cards ?? []).some(
        (card) => (card.ageFilterDays ?? []).length > 0,
      ),
    [activeSection],
  );
  const showSpeciesFilter = activeSection?.id !== "equipment-supplies";
  const showBreedFilter =
    activeSection?.id === "live-poultry" || activeSection?.id === "hatching-eggs";
  const showAvailabilityFilter = activeSection?.id !== "equipment-supplies";
  const showCategoryFilter = activeSection?.id === "equipment-supplies";
  const showConditionFilter = activeSection?.id === "equipment-supplies";
  const breedOptions = useMemo(
    () => buildBreedOptions(activeSection?.cards ?? []),
    [activeSection],
  );
  const categoryOptions = useMemo(
    () => buildCategoryOptions(activeSection?.cards ?? []),
    [activeSection],
  );
  const conditionOptions = useMemo(
    () => buildConditionOptions(activeSection?.cards ?? []),
    [activeSection],
  );
  const speciesOptions = useMemo(
    () => buildSpeciesOptions(activeSection?.cards ?? []),
    [activeSection],
  );
  const filteredCards = useMemo(
    () =>
      filterCards(activeSection?.cards ?? [], {
        availability: showAvailabilityFilter ? availabilityFilter : "all",
        age: showAgeFilter ? ageFilter : "all",
        breed: showBreedFilter ? breedFilter : "all",
        category: showCategoryFilter ? speciesFilter : "all",
        condition: showConditionFilter ? breedFilter : "all",
        price: priceFilter,
        query,
        species: showSpeciesFilter ? speciesFilter : "all",
      }),
    [
      activeSection,
      ageFilter,
      availabilityFilter,
      breedFilter,
      priceFilter,
      query,
      showAgeFilter,
      showAvailabilityFilter,
      showBreedFilter,
      showCategoryFilter,
      showConditionFilter,
      showSpeciesFilter,
      speciesFilter,
    ],
  );
  const hasActiveFilters =
    ageFilter !== "all" ||
    availabilityFilter !== "all" ||
    breedFilter !== "all" ||
    priceFilter !== "all" ||
    query.trim() !== "" ||
    speciesFilter !== "all";
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const activeFilterLabels = buildActiveFilterLabels({
    age: ageFilter,
    availability: availabilityFilter,
    breed: breedFilter,
    condition: breedFilter,
    price: priceFilter,
    query,
    showAgeFilter,
    showAvailabilityFilter,
    showBreedFilter,
    showCategoryFilter,
    showConditionFilter,
    showSpeciesFilter,
    species: speciesFilter,
  });
  const activeFilterCount = activeFilterLabels.length;

  useEffect(() => {
    function activateSectionFromId(sectionId: string) {
      if (!sections.some((section) => section.id === sectionId)) return false;

      setActiveId(sectionId);
      setAgeFilter("all");
      setAvailabilityFilter("all");
      setBreedFilter("all");
      setPriceFilter("all");
      setQuery("");
      setSpeciesFilter("all");

      return true;
    }

    function getSectionIdFromHash(hash: string) {
      const hashSectionId = hash
        .replace(/^#/, "")
        .replace(/-tab$/, "")
        .replace(/-panel$/, "");

      if (!hashSectionId || hashSectionId === "shop-listings") return null;

      return hashSectionId;
    }

    function syncActiveTabFromHash() {
      const sectionId = getSectionIdFromHash(window.location.hash);

      if (sectionId) {
        activateSectionFromId(sectionId);
      }
    }

    function syncActiveTabFromLinkClick(event: MouseEvent) {
      const link = (event.target as Element | null)?.closest("a[href]");
      const href = link?.getAttribute("href");

      if (!href) return;

      const hash = href.includes("#") ? href.slice(href.indexOf("#")) : "";
      const sectionId = getSectionIdFromHash(hash);

      if (sectionId && activateSectionFromId(sectionId)) {
        window.requestAnimationFrame(() => {
          document
            .getElementById("shop-listings")
            ?.scrollIntoView({ block: "start" });
        });
      }
    }

    syncActiveTabFromHash();
    document.addEventListener("click", syncActiveTabFromLinkClick);
    window.addEventListener("hashchange", syncActiveTabFromHash);

    return () => {
      document.removeEventListener("click", syncActiveTabFromLinkClick);
      window.removeEventListener("hashchange", syncActiveTabFromHash);
    };
  }, [sections]);

  if (!activeSection) return null;

  function changeCategory(sectionId: string) {
    setActiveId(sectionId);
    setAgeFilter("all");
    setAvailabilityFilter("all");
    setBreedFilter("all");
    setPriceFilter("all");
    setQuery("");
    setSpeciesFilter("all");
    setIsCategoryMenuOpen(false);
  }

  function resetFilters() {
    setAgeFilter("all");
    setAvailabilityFilter("all");
    setBreedFilter("all");
    setPriceFilter("all");
    setQuery("");
    setSpeciesFilter("all");
  }

  return (
    <div className="grid gap-2.5 lg:gap-4">
      <div className="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-end">
        <h2
          className={cx(
            storefrontSerifClass,
            "storefront-heading-color sr-only text-2xl font-bold leading-tight text-stone-950 sm:text-3xl lg:not-sr-only lg:text-[2.0625rem]",
          )}
        >
          Shop
        </h2>
        <div
          aria-label="Storefront listing categories"
          className="hidden gap-2 border-b border-[#ddd5c7] lg:grid lg:grid-cols-4"
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
                    ? "storefront-primary-color storefront-primary-border bg-white shadow-[0_-1px_0_var(--storefront-heading-color)_inset]"
                    : "border-[#eee8dc] bg-[#f8f3ea] text-stone-700 hover:border-[#ddd5c7] hover:bg-white hover:text-[var(--storefront-heading-color)]",
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

      <div className="lg:hidden">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            aria-expanded={isCategoryMenuOpen}
            aria-haspopup="dialog"
            className="storefront-primary-border storefront-primary-color inline-flex h-[2.625rem] min-w-0 flex-1 items-center justify-between gap-2 rounded-md border bg-white px-2.5 text-[0.88rem] font-bold shadow-[0_1px_2px_rgba(41,37,36,0.05)] focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            onClick={() => setIsCategoryMenuOpen(true)}
            type="button"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <ListingTabIcon name={tabIconName(activeSection.label)} />
              <span className="truncate">{activeSection.label}</span>
            </span>
            <span
              aria-hidden="true"
              className="h-2 w-2 rotate-45 border-b-2 border-r-2 border-current"
            />
          </button>
          <button
            aria-expanded={isFilterPanelOpen}
            aria-haspopup="dialog"
            className={cx(
              "inline-flex h-[2.625rem] shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[0.88rem] font-bold shadow-[0_1px_2px_rgba(41,37,36,0.05)] focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2",
              activeFilterCount > 0
                ? "storefront-primary-button storefront-primary-border"
                : "border-[#ddd5c7] bg-white text-stone-800",
            )}
            onClick={() => setIsFilterPanelOpen(true)}
            type="button"
          >
            <Funnel aria-hidden="true" className="size-4" strokeWidth={2.25} />
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          <p className="shrink-0 self-center text-right text-[0.78rem] font-semibold leading-tight text-stone-500">
            {filteredCards.length}{" "}
            {filteredCards.length === 1 ? "listing" : "listings"}
          </p>
        </div>
        {activeFilterLabels.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {activeFilterLabels.slice(0, 3).map((label) => (
              <span
                className="rounded-full border border-[#ddd5c7] bg-white px-2.5 py-1 text-xs font-semibold text-stone-700"
                key={label}
              >
                {label}
              </span>
            ))}
            {activeFilterLabels.length > 3 ? (
              <span className="text-xs font-semibold text-stone-500">
                +{activeFilterLabels.length - 3} more
              </span>
            ) : null}
            <button
              className="storefront-primary-color rounded-full px-2 py-1 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
              onClick={resetFilters}
              type="button"
            >
              Reset all
            </button>
          </div>
        ) : null}
      </div>

      <section
        aria-labelledby={`${activeSection.id}-tab`}
        className="scroll-mt-28 lg:scroll-mt-28"
        id={`${activeSection.id}-panel`}
        role="tabpanel"
      >
        {activeSection.cards.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-5">
            <ListingFilters
              age={ageFilter}
              showAgeFilter={showAgeFilter}
              showAvailabilityFilter={showAvailabilityFilter}
              showBreedFilter={showBreedFilter}
              showCategoryFilter={showCategoryFilter}
              showConditionFilter={showConditionFilter}
              showSpeciesFilter={showSpeciesFilter}
              availability={availabilityFilter}
              breed={breedFilter}
              breedOptions={breedOptions}
              category={speciesFilter}
              categoryOptions={categoryOptions}
              condition={breedFilter}
              conditionOptions={conditionOptions}
              hasActiveFilters={hasActiveFilters}
              price={priceFilter}
              query={query}
              species={speciesFilter}
              speciesOptions={speciesOptions}
              onAgeChange={setAgeFilter}
              onAvailabilityChange={setAvailabilityFilter}
              onBreedChange={setBreedFilter}
              onPriceChange={setPriceFilter}
              onQueryChange={setQuery}
              onReset={resetFilters}
              onSpeciesChange={setSpeciesFilter}
              className="hidden lg:block"
            />
            {filteredCards.length > 0 ? (
              <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
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

      {isCategoryMenuOpen ? (
        <MobileSheet
          label="Choose department"
          onClose={() => setIsCategoryMenuOpen(false)}
          title="Shop department"
        >
          <div className="grid gap-2">
            {sections.map((section) => {
              const active = section.id === activeSection.id;

              return (
                <button
                  aria-current={active ? "true" : undefined}
                  className={cx(
                    "flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 text-left text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2",
                    active
                      ? "storefront-primary-border storefront-primary-color bg-[#f8f3ea]"
                      : "border-[#e5decf] bg-white text-stone-800",
                  )}
                  key={section.id}
                  onClick={() => changeCategory(section.id)}
                  type="button"
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ListingTabIcon name={tabIconName(section.label)} />
                    <span>{section.label}</span>
                  </span>
                  {active ? <span className="text-xs">Selected</span> : null}
                </button>
              );
            })}
          </div>
        </MobileSheet>
      ) : null}

      {isFilterPanelOpen ? (
        <MobileSheet
          label="Filter listings"
          onClose={() => setIsFilterPanelOpen(false)}
          title="Filter listings"
        >
          <ListingFilters
            age={ageFilter}
            showAgeFilter={showAgeFilter}
            showAvailabilityFilter={showAvailabilityFilter}
            showBreedFilter={showBreedFilter}
            showCategoryFilter={showCategoryFilter}
            showConditionFilter={showConditionFilter}
            showSpeciesFilter={showSpeciesFilter}
            availability={availabilityFilter}
            breed={breedFilter}
            breedOptions={breedOptions}
            category={speciesFilter}
            categoryOptions={categoryOptions}
            condition={breedFilter}
            conditionOptions={conditionOptions}
            hasActiveFilters={hasActiveFilters}
            price={priceFilter}
            query={query}
            species={speciesFilter}
            speciesOptions={speciesOptions}
            onAgeChange={setAgeFilter}
            onAvailabilityChange={setAvailabilityFilter}
            onBreedChange={setBreedFilter}
            onPriceChange={setPriceFilter}
            onQueryChange={setQuery}
            onReset={resetFilters}
            onSpeciesChange={setSpeciesFilter}
            className="border-0 p-0 shadow-none"
          />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              className="min-h-11 rounded-md border border-[#ddd5c7] bg-white px-3 text-sm font-bold text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
              onClick={resetFilters}
              type="button"
            >
              Reset
            </button>
            <button
              className="storefront-primary-button min-h-11 rounded-md px-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
              onClick={() => setIsFilterPanelOpen(false)}
              type="button"
            >
              View Results
            </button>
          </div>
        </MobileSheet>
      ) : null}
    </div>
  );
}

function MobileSheet({
  children,
  label,
  onClose,
  title,
}: {
  children: React.ReactNode;
  label: string;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        aria-label={`Close ${label}`}
        className="absolute inset-0 cursor-default bg-stone-950/35"
        onClick={onClose}
        type="button"
      />
      <div
        aria-label={label}
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-hidden rounded-t-lg border border-[#ded7c8] bg-white shadow-2xl"
        role="dialog"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#eee6d8] px-4 py-3">
          <h3 className="storefront-heading-color text-base font-bold text-[#073f1e]">
            {title}
          </h3>
          <button
            aria-label={`Close ${label}`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true" className="text-2xl leading-none">
              x
            </span>
          </button>
        </div>
        <div className="max-h-[calc(82vh-4.25rem)] overflow-y-auto px-4 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function buildActiveFilterLabels({
  age,
  availability,
  breed,
  condition,
  price,
  query,
  showAgeFilter,
  showAvailabilityFilter,
  showBreedFilter,
  showCategoryFilter,
  showConditionFilter,
  showSpeciesFilter,
  species,
}: {
  age: string;
  availability: string;
  breed: string;
  condition: string;
  price: string;
  query: string;
  showAgeFilter: boolean;
  showAvailabilityFilter: boolean;
  showBreedFilter: boolean;
  showCategoryFilter: boolean;
  showConditionFilter: boolean;
  showSpeciesFilter: boolean;
  species: string;
}) {
  return [
    query.trim() ? `Search: ${query.trim()}` : null,
    showSpeciesFilter && species !== "all" ? `Species: ${species}` : null,
    showCategoryFilter && species !== "all" ? `Category: ${species}` : null,
    showBreedFilter && breed !== "all" ? `Breed: ${breed}` : null,
    showConditionFilter && condition !== "all" ? `Condition: ${condition}` : null,
    showAgeFilter && age !== "all" ? `Age: ${formatFilterLabel(age, ageRangeOptions)}` : null,
    showAvailabilityFilter && availability !== "all"
      ? formatFilterLabel(availability, availabilityOptions)
      : null,
    price !== "all" ? formatFilterLabel(price, priceOptions) : null,
  ].filter((label): label is string => Boolean(label));
}

function ListingFilters({
  age,
  availability,
  breed,
  breedOptions,
  category,
  categoryOptions,
  className,
  condition,
  conditionOptions,
  hasActiveFilters,
  onAgeChange,
  onAvailabilityChange,
  onBreedChange,
  onPriceChange,
  onQueryChange,
  onReset,
  onSpeciesChange,
  price,
  query,
  showAgeFilter,
  showAvailabilityFilter,
  showBreedFilter,
  showCategoryFilter,
  showConditionFilter,
  showSpeciesFilter,
  species,
  speciesOptions,
}: {
  age: string;
  availability: string;
  breed: string;
  breedOptions: string[];
  category: string;
  categoryOptions: string[];
  className?: string;
  condition: string;
  conditionOptions: string[];
  hasActiveFilters: boolean;
  onAgeChange: (value: string) => void;
  onAvailabilityChange: (value: string) => void;
  onBreedChange: (value: string) => void;
  onPriceChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onReset: () => void;
  onSpeciesChange: (value: string) => void;
  price: string;
  query: string;
  showAgeFilter: boolean;
  showAvailabilityFilter: boolean;
  showBreedFilter: boolean;
  showCategoryFilter: boolean;
  showConditionFilter: boolean;
  showSpeciesFilter: boolean;
  species: string;
  speciesOptions: string[];
}) {
  return (
    <aside
      className={cx(
        "h-fit rounded-lg border border-[#e3d9c8] bg-white p-3",
        className,
      )}
    >
      <div className="grid gap-2.5">
        <label className="grid gap-1 text-xs font-semibold text-stone-800">
          Search
          <input
            className="storefront-primary-focus min-h-10 rounded-md border border-[#ddd5c7] bg-white px-2.5 text-sm font-medium normal-case tracking-normal text-stone-950 outline-none transition placeholder:text-stone-400 lg:min-h-8 lg:text-xs"
            id="storefront-search"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search listings"
            type="search"
            value={query}
          />
        </label>

        <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-stone-800">
          <Funnel
            aria-hidden="true"
            className="storefront-primary-color size-3.5 text-emerald-700"
            strokeWidth={2.25}
          />
          Filter listings
        </div>

        {showSpeciesFilter ? (
          <FilterSelect
            label="Species"
            value={species}
            onChange={onSpeciesChange}
            options={[
              { label: "All species", value: "all" },
              ...speciesOptions.map((option) => ({
                label: option,
                value: option,
              })),
            ]}
          />
        ) : null}

        {showCategoryFilter ? (
          <FilterSelect
            label="Category"
            value={category}
            onChange={onSpeciesChange}
            options={[
              { label: "All categories", value: "all" },
              ...categoryOptions.map((option) => ({
                label: option,
                value: option,
              })),
            ]}
          />
        ) : null}

        {showBreedFilter ? (
          <FilterSelect
            label="Breed"
            value={breed}
            onChange={onBreedChange}
            options={[
              { label: "All breeds", value: "all" },
              ...breedOptions.map((option) => ({
                label: option,
                value: option,
              })),
            ]}
          />
        ) : null}

        {showConditionFilter ? (
          <FilterSelect
            label="Condition"
            value={condition}
            onChange={onBreedChange}
            options={[
              { label: "All conditions", value: "all" },
              ...conditionOptions.map((option) => ({
                label: option,
                value: option,
              })),
            ]}
          />
        ) : null}

        {showAgeFilter ? (
          <FilterSelect
            label="Age"
            value={age}
            onChange={onAgeChange}
            options={[
              { label: "All ages", value: "all" },
              ...ageRangeOptions,
            ]}
          />
        ) : null}

        {showAvailabilityFilter ? (
          <FilterSelect
            label="Availability"
            value={availability}
            onChange={onAvailabilityChange}
            options={[
              { label: "All availability", value: "all" },
              ...availabilityOptions,
            ]}
          />
        ) : null}

        <FilterSelect
          label="Price"
          value={price}
          onChange={onPriceChange}
          options={[
            { label: "Any price", value: "all" },
            ...priceOptions,
          ]}
        />

        <button
          className="storefront-primary-color inline-flex w-fit items-center rounded-md text-sm font-semibold transition hover:opacity-80 disabled:cursor-not-allowed disabled:text-stone-400"
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
        className="storefront-primary-focus min-h-10 rounded-md border border-[#ddd5c7] bg-white px-2.5 text-sm font-medium normal-case tracking-normal text-stone-700 outline-none transition lg:min-h-8 lg:text-xs"
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
    <article className="group overflow-hidden rounded-lg border border-[#e3dccf] bg-white shadow-[0_2px_10px_rgba(41,37,36,0.08)] transition hover:border-[#bfcfb6] hover:shadow-md lg:flex lg:flex-col lg:border-[#ded7c8] lg:shadow-none lg:hover:shadow-sm">
      <Link
        className="grid min-w-0 grid-cols-[42%_minmax(0,1fr)] gap-2 p-2 focus:outline-none focus:ring-2 focus:ring-emerald-700 lg:hidden"
        href={card.href}
      >
        <div className="relative overflow-hidden rounded-md">
          <ListingPhoto alt={card.imageAlt} aspect="square" src={card.imageUrl} />
        </div>
        <div className="flex min-w-0 flex-col pr-0.5">
          <p className="storefront-primary-color truncate text-[0.76rem] font-bold leading-tight text-emerald-700">
            {card.meta}
          </p>
          <h3 className="mt-px line-clamp-2 text-[1.06rem] font-bold leading-[1.08] text-stone-950 min-[390px]:text-[1.13rem]">
            {card.title}
          </h3>
          {card.description ? (
            <p className="mt-0.5 line-clamp-2 text-[0.82rem] leading-4 text-stone-600">
              {card.description}
            </p>
          ) : null}
          <div className="mt-auto pt-1">
            <p className="storefront-primary-color truncate text-[1.18rem] font-bold leading-tight text-[#073f1e]">
              {card.price}
            </p>
            <p className="mt-px truncate text-[0.78rem] font-semibold text-stone-600">
              {card.detail}
            </p>
            <span className="storefront-primary-button mt-1 inline-flex min-h-8 w-full items-center justify-center rounded-md px-3 text-[0.88rem] font-semibold transition">
              View
            </span>
          </div>
        </div>
      </Link>

      <Link
        className="hidden flex-col focus:outline-none focus:ring-2 focus:ring-emerald-700 lg:flex"
        href={card.href}
      >
        <div className="px-3.5 pb-2 pt-3 lg:px-4 lg:pb-2.5 lg:pt-4">
          <p className="storefront-primary-color truncate text-[0.7rem] font-bold uppercase tracking-[0.08em] text-emerald-700">
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
        <div className="p-3.5 pt-3 lg:p-4 lg:pt-3">
          <div className="flex items-end justify-between gap-3 lg:gap-4">
            <div className="min-w-0">
              <p className="storefront-primary-color truncate text-lg font-bold text-[#073f1e]">
                {card.price}
              </p>
            </div>
            <span className="storefront-primary-button inline-flex min-h-10 shrink-0 items-center justify-center rounded-md px-3 text-sm font-semibold transition lg:min-h-11 lg:px-4 lg:text-base">
              View
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function buildSpeciesOptions(cards: StorefrontListingCard[]) {
  return buildFilterOptions(cards.map((card) => card.speciesFilter));
}

function buildBreedOptions(cards: StorefrontListingCard[]) {
  return buildFilterOptions(cards.map((card) => card.breedFilter));
}

function buildCategoryOptions(cards: StorefrontListingCard[]) {
  return buildFilterOptions(cards.map((card) => card.categoryFilter));
}

function buildConditionOptions(cards: StorefrontListingCard[]) {
  return buildFilterOptions(cards.map((card) => card.conditionFilter));
}

function buildFilterOptions(values: Array<string | null | undefined>) {
  return Array.from(
    new Map(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
        .map((value) => [normalizeFilterValue(value), value] as const),
    ),
  )
    .sort((first, second) =>
      first[1].localeCompare(second[1], undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    )
    .map(([, label]) => label);
}

function filterCards(
  cards: StorefrontListingCard[],
  filters: {
    age: string;
    availability: string;
    breed: string;
    category: string;
    condition: string;
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

    if (!matchesBatchFilters(card, filters)) return false;

    if (
      filters.species !== "all" &&
      normalizeFilterValue(card.speciesFilter ?? card.meta) !==
        normalizeFilterValue(filters.species)
    ) {
      return false;
    }

    if (
      filters.breed !== "all" &&
      normalizeFilterValue(card.breedFilter ?? card.title) !==
        normalizeFilterValue(filters.breed)
    ) {
      return false;
    }

    if (
      filters.category !== "all" &&
      normalizeFilterValue(card.categoryFilter ?? "") !==
        normalizeFilterValue(filters.category)
    ) {
      return false;
    }

    if (
      filters.condition !== "all" &&
      normalizeFilterValue(card.conditionFilter ?? "") !==
        normalizeFilterValue(filters.condition)
    ) {
      return false;
    }

    if (!card.batchFilters && !matchesCardAvailability(card, filters.availability)) {
      return false;
    }

    if (!matchesPriceFilter(card.price, filters.price)) {
      return false;
    }

    return true;
  });
}

const ageRangeOptions = [
  { label: "0-14 days", value: "1-14-days" },
  { label: "2-12 weeks", value: "2-12-weeks" },
  { label: "12-20 weeks", value: "12-20-weeks" },
  { label: "20-52 weeks", value: "20-52-weeks" },
  { label: "1 year+", value: "1-year-plus" },
];

const availabilityOptions = [
  { label: "Ready now", value: "ready_now" },
  { label: "Reserve now", value: "reserve_now" },
];

const priceOptions = [
  { label: "Under $10", value: "under-10" },
  { label: "$10 to $25", value: "10-25" },
  { label: "$25 and up", value: "25-up" },
];

function formatFilterLabel(
  value: string,
  options: Array<{ label: string; value: string }>,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function matchesBatchFilters(
  card: StorefrontListingCard,
  filters: {
    age: string;
    availability: string;
  },
) {
  if (!card.batchFilters) {
    return matchesCardAge(card, filters.age);
  }

  if (filters.age === "all" && filters.availability === "all") return true;

  return card.batchFilters.some(
    (batch) =>
      matchesBatchAge(batch, filters.age) &&
      matchesAvailabilityCode(batch.availabilityCode, filters.availability),
  );
}

function matchesCardAge(card: StorefrontListingCard, ageFilter: string) {
  if (ageFilter === "all") return true;

  return (card.ageFilterDays ?? []).some((ageInDays) =>
    matchesAgeRange(ageInDays, ageFilter),
  );
}

function matchesBatchAge(
  batch: StorefrontListingCardBatchFilter,
  ageFilter: string,
) {
  if (ageFilter === "all") return true;
  if (batch.ageFilterDays === null) return false;

  return matchesAgeRange(batch.ageFilterDays, ageFilter);
}

function matchesCardAvailability(
  card: StorefrontListingCard,
  availabilityFilter: string,
) {
  return matchesAvailabilityCode(card.availabilityCode, availabilityFilter);
}

function matchesAvailabilityCode(code: string, availabilityFilter: string) {
  return availabilityFilter === "all" || code === availabilityFilter;
}

function matchesAgeRange(ageInDays: number, range: string) {
  if (!Number.isFinite(ageInDays)) return false;

  const wholeDays = Math.floor(ageInDays);

  if (range === "1-14-days") return wholeDays >= 0 && wholeDays <= 14;
  if (range === "2-12-weeks") return wholeDays >= 14 && wholeDays <= 84;
  if (range === "12-20-weeks") return wholeDays >= 84 && wholeDays <= 140;
  if (range === "20-52-weeks") return wholeDays >= 140 && wholeDays <= 364;
  if (range === "1-year-plus") return wholeDays >= 365;

  return true;
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

function tabIconName(label: string): StorefrontCategorySymbolName {
  if (label.includes("Egg")) return "egg";
  if (label.includes("Equipment")) return "equipment";
  if (label.includes("Product")) return "processed";
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
