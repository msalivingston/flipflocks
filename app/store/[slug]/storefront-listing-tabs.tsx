"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AvailabilityBadge,
  EmptyStorefront,
  ListingPhoto,
  cx,
} from "./storefront-ui";

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
  const activeSection =
    sections.find((section) => section.id === activeId) ?? sections[0];

  if (!activeSection) return null;

  return (
    <div className="grid gap-6">
      <div
        aria-label="Storefront listing categories"
        className="-mx-5 grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0 lg:grid-flow-row lg:grid-cols-4"
        role="tablist"
      >
        {sections.map((section) => {
          const active = section.id === activeSection.id;

          return (
            <button
              aria-controls={`${section.id}-panel`}
              aria-selected={active}
              className={cx(
                "inline-flex min-h-14 shrink-0 items-center justify-center rounded-lg border px-5 text-sm font-semibold transition",
                active
                  ? "border-[#24512f] bg-[#24512f] text-white"
                  : "border-[#eee9df] bg-[#f5f1eb] text-stone-900 shadow-sm hover:border-[#24512f] hover:text-[#24512f]",
              )}
              id={`${section.id}-tab`}
              key={section.id}
              onClick={() => setActiveId(section.id)}
              role="tab"
              type="button"
            >
              <ListingTabIcon name={tabIconName(section.label)} />
              {section.label}
            </button>
          );
        })}
      </div>

      <section
        aria-labelledby={`${activeSection.id}-tab`}
        className="scroll-mt-28"
        id={`${activeSection.id}-panel`}
        role="tabpanel"
      >
        {activeSection.cards.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {activeSection.cards.map((card) => (
              <ListingCard card={card} key={card.href} />
            ))}
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

function ListingCard({ card }: { card: StorefrontListingCard }) {
  return (
    <article className="group flex h-full min-h-[25.5rem] flex-col overflow-hidden rounded-xl border border-[#ded7c8] bg-white shadow-[0_12px_28px_rgba(46,35,20,0.08)] transition hover:-translate-y-0.5 hover:border-[#bfcfb6] hover:shadow-[0_20px_46px_rgba(46,35,20,0.13)]">
      <Link
        className="flex h-full flex-col focus:outline-none focus:ring-2 focus:ring-emerald-700"
        href={card.href}
      >
        <div className="relative [&>div]:aspect-[5/4] [&>img]:aspect-[5/4]">
          <ListingPhoto alt={card.imageAlt} src={card.imageUrl} />
          <div className="absolute left-3 top-3">
            <AvailabilityBadge
              code={card.availabilityCode}
              label={card.availabilityLabel}
            />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">
              {card.meta}
            </p>
            <h3 className="mt-1 text-lg font-semibold leading-tight text-stone-950">
              {card.title}
            </h3>
          </div>

          <p className="line-clamp-2 min-h-10 text-sm leading-5 text-stone-600">
            {card.description || "Details and pickup options are listed inside."}
          </p>

          <div className="mt-auto grid gap-4">
            <div className="grid gap-1">
              <p className="text-lg font-semibold text-[#073f1e]">
                {card.price}
              </p>
              <p className="mt-1 text-xs text-stone-500">{card.detail}</p>
            </div>
            <span className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#073f1e] px-4 text-sm font-semibold text-white transition group-hover:bg-[#0b562a]">
              View Details
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

type ListingTabIconName = "egg" | "equipment" | "poultry" | "processed";

function tabIconName(label: string): ListingTabIconName {
  if (label.includes("Egg")) return "egg";
  if (label.includes("Equipment")) return "equipment";
  if (label.includes("Processed")) return "processed";
  return "poultry";
}

function ListingTabIcon({ name }: { name: ListingTabIconName }) {
  return (
    <svg
      aria-hidden="true"
      className="mr-2 h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      {name === "poultry" ? (
        <>
          <path d="M8 18c-3-1-4-3-4-6 0-4 3-7 7-7 3 0 5 2 5 5" />
          <path d="M14 7l3-3 1 4" />
          <path d="M15 12h5l-3 4" />
          <path d="M9 18v3" />
          <path d="M13 18v3" />
        </>
      ) : null}
      {name === "egg" ? (
        <path d="M12 21c4 0 7-3 7-7 0-5-4-11-7-11s-7 6-7 11c0 4 3 7 7 7Z" />
      ) : null}
      {name === "equipment" ? (
        <>
          <path d="M14 7l3-3 3 3-3 3-3-3Z" />
          <path d="M3 21l8-8" />
          <path d="M14 14l7 7" />
          <path d="M5 5l5 5" />
        </>
      ) : null}
      {name === "processed" ? (
        <>
          <path d="M5 19c4-7 8-11 14-14" />
          <path d="M7 17c3 1 7 0 10-3" />
          <path d="M8 10c4 0 6-2 8-5" />
        </>
      ) : null}
    </svg>
  );
}
