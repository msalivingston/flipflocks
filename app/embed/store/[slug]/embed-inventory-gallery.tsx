import type { StorefrontListingCard } from "@/app/store/[slug]/storefront-listing-tabs";
import {
  AvailabilityBadge,
  ListingPhoto,
} from "@/app/store/[slug]/storefront-ui";

export function EmbedInventoryGallery({
  cards,
}: {
  cards: StorefrontListingCard[];
}) {
  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white px-5 py-8 text-center">
        <p className="text-sm font-semibold text-stone-700">
          No inventory is publicly available right now.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Available inventory"
      className="grid min-w-0 grid-cols-1 gap-3 min-[440px]:grid-cols-2 min-[820px]:grid-cols-3"
    >
      {cards.map((card) => (
        <article
          className="min-w-0 overflow-hidden rounded-lg border border-[#ded7c8] bg-white shadow-[0_2px_10px_rgba(41,37,36,0.08)]"
          key={card.href}
        >
          <a
            aria-label={`View and order ${card.title} on FlockFront`}
            className="flex h-full min-w-0 flex-col focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700"
            href={card.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            <div className="relative min-w-0 overflow-hidden bg-[#f4f1ea]">
              <ListingPhoto
                alt={card.imageAlt}
                aspect="square"
                src={card.imageUrl}
              />
              <div className="absolute left-2 top-2 max-w-[calc(100%-1rem)]">
                <AvailabilityBadge
                  code={card.availabilityCode}
                  label={card.availabilityLabel}
                />
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col p-3">
              <p className="truncate text-[0.7rem] font-bold uppercase tracking-[0.08em] text-emerald-800">
                {card.typeLabel}
              </p>
              <h2 className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-stone-950">
                {card.title}
              </h2>
              <div className="mt-auto flex min-w-0 items-end justify-between gap-2 pt-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold text-[#073f1e]">
                    {card.price}
                  </p>
                  <p className="truncate text-xs font-semibold text-stone-600">
                    {card.detail}
                  </p>
                </div>
                <span className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-[#073f1e] px-3 text-sm font-semibold text-white">
                  View &amp; order
                </span>
              </div>
            </div>
          </a>
        </article>
      ))}
    </section>
  );
}
