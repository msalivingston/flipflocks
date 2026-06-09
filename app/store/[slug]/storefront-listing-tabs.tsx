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
        className="-mx-5 grid auto-cols-[minmax(12rem,1fr)] grid-flow-col gap-1.5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0 lg:grid-flow-row lg:grid-cols-4"
        role="tablist"
      >
        {sections.map((section) => {
          const active = section.id === activeSection.id;

          return (
            <button
              aria-controls={`${section.id}-panel`}
              aria-selected={active}
              className={cx(
                "inline-flex min-h-12 shrink-0 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition",
                active
                  ? "border-[#c9ddc8] bg-[#eef6ec] text-[#073f1e] shadow-[inset_0_-3px_0_#073f1e]"
                  : "border-[#eee9df] bg-[#faf8f4] text-stone-800 hover:border-[#c9ddc8] hover:bg-[#f4f0e8] hover:text-[#073f1e]",
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
              <p className="text-xl font-bold text-[#073f1e]">
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
          <path d="M6 15c0-4 3-7 7-7h3l3-3 1 5h-3c0 4-3 7-7 7H6Z" />
          <path d="M9 17v3" />
          <path d="M13 17v3" />
          <path d="M18 9h.01" />
        </>
      ) : null}
      {name === "egg" ? (
        <path d="M12 21c4 0 7-3 7-7 0-5-4-11-7-11s-7 6-7 11c0 4 3 7 7 7Z" />
      ) : null}
      {name === "equipment" ? (
        <>
          <path d="M14 7l3-3 3 3-3 3-3-3Z" />
          <path d="M3 21l9-9" />
          <path d="M14 14l7 7" />
        </>
      ) : null}
      {name === "processed" ? (
        <>
          <path d="M8 14c-2 0-4-2-4-4s2-4 4-4c1.5 0 2.8.8 3.5 2" />
          <path d="M10.5 12.5 18 20" />
          <path d="M17 20c1.5 0 3-1.2 3-3s-1.5-3-3-3c-1.1 0-2 .6-2.5 1.5" />
        </>
      ) : null}
    </svg>
  );
}
