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
        className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0"
        role="tablist"
      >
        {sections.map((section) => {
          const active = section.id === activeSection.id;

          return (
            <button
              aria-controls={`${section.id}-panel`}
              aria-selected={active}
              className={cx(
                "inline-flex min-h-11 shrink-0 items-center rounded-full border px-5 text-sm font-semibold transition",
                active
                  ? "border-[#24512f] bg-[#24512f] text-white"
                  : "border-[#d8cebd] bg-white text-stone-700 shadow-sm hover:border-[#24512f] hover:text-[#24512f]",
              )}
              id={`${section.id}-tab`}
              key={section.id}
              onClick={() => setActiveId(section.id)}
              role="tab"
              type="button"
            >
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
        <div className="mb-5">
          <h3 className="text-xl font-semibold text-stone-950">
            {activeSection.label}
          </h3>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {activeSection.description}
          </p>
        </div>

        {activeSection.cards.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
    <article className="group flex h-full min-h-[28rem] flex-col overflow-hidden rounded-xl border border-[#ded7c8] bg-white shadow-[0_14px_38px_rgba(46,35,20,0.08)] transition hover:-translate-y-0.5 hover:border-[#bfcfb6] hover:shadow-[0_22px_52px_rgba(46,35,20,0.13)]">
      <Link
        className="flex h-full flex-col focus:outline-none focus:ring-2 focus:ring-emerald-700"
        href={card.href}
      >
        <div className="relative">
          <ListingPhoto alt={card.imageAlt} src={card.imageUrl} />
          <div className="absolute left-3 top-3">
            <AvailabilityBadge
              code={card.availabilityCode}
              label={card.availabilityLabel}
            />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">
              {card.meta}
            </p>
            <h3 className="mt-1 text-xl font-semibold leading-tight text-stone-950">
              {card.title}
            </h3>
          </div>

          <p className="line-clamp-2 min-h-12 text-sm leading-6 text-stone-600">
            {card.description || "Details and pickup options are listed inside."}
          </p>

          <div className="mt-auto grid gap-4">
            <div className="grid gap-1">
              <p className="text-lg font-semibold text-[#24512f]">
                {card.price}
              </p>
              <p className="mt-1 text-xs text-stone-500">{card.detail}</p>
            </div>
            <span className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#24512f] px-4 text-sm font-semibold text-white transition group-hover:bg-[#183b22]">
              View Details
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
