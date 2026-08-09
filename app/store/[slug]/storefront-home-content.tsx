"use client";

import Link from "next/link";
import {
  cx,
  formatLocation,
  StorefrontGlyph,
  storefrontButtonClass,
  storefrontHeroFrame,
  storefrontHeroTypography,
} from "./storefront-ui";
import { StorefrontHeroBackdrop } from "./storefront-hero-backdrop";
import {
  StorefrontListingTabs,
} from "./storefront-listing-tabs";
import {
  StorefrontProfileImageMap,
  StorefrontEquipmentItem,
  StorefrontHatchingEggItem,
  StorefrontInventoryItem,
  StorefrontProcessedPoultryItem,
  StorefrontHome,
  previewText,
} from "./storefront-data";
import { buildStorefrontListingSectionsFromPublicData } from "./storefront-listing-cards";
import {
  StorefrontChrome,
  getStorefrontCategoryAvailability,
} from "./storefront-shell-components";
import { storefrontSerifClass } from "./storefront-fonts";

export function StorefrontHomeContent({
  equipment,
  hatchingEggs,
  inventory,
  livePoultryProfileImages = {},
  previewExitHref,
  processedPoultry,
  showPreviewBanner = false,
  store,
}: {
  equipment: StorefrontEquipmentItem[];
  hatchingEggs: StorefrontHatchingEggItem[];
  inventory: StorefrontInventoryItem[];
  livePoultryProfileImages?: StorefrontProfileImageMap;
  previewExitHref?: string;
  processedPoultry: StorefrontProcessedPoultryItem[];
  showPreviewBanner?: boolean;
  store: StorefrontHome;
}) {
  const heroSubheading =
    store.hero_subheading?.trim() ||
    "Browse current availability and request pickup at checkout.";
  const aboutPreview = previewText(
    store.about_text,
    `${store.store_name} shares pickup details and current products from the farm.`,
  );
  const pickupPreview = previewText(
    store.pickup_policy,
    "Pickup details will be confirmed after your order is placed.",
  );
  const heroTitle = store.store_tagline || store.store_name;
  const listingSections = buildStorefrontListingSectionsFromPublicData({
    equipment,
    hatchingEggs,
    inventory,
    livePoultryProfileImages,
    processedPoultry,
  });
  const categories = getStorefrontCategoryAvailability({
    equipmentCount: equipment.length,
    hatchingEggCount:
      listingSections.find((section) => section.id === "hatching-eggs")?.cards
        .length ?? 0,
    livePoultryCount:
      listingSections.find((section) => section.id === "live-poultry")?.cards
        .length ?? 0,
    processedPoultryCount: processedPoultry.length,
  });
  const heroLayout = store.hero_image_layout === "right" ? "right" : "full";
  const heroIsLeftFade = heroLayout === "right";
  const heroTextColor = heroIsLeftFade ? "text-white" : "text-white lg:text-black";

  return (
    <>
      {showPreviewBanner ? (
        <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-2.5 shadow-sm sm:px-5 sm:py-3">
          <div className="mx-auto flex max-w-[70rem] flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center text-sm font-semibold text-amber-950">
            <span>Preview mode &mdash; this store is hidden from customers.</span>
            {previewExitHref ? (
              <Link
                className="inline-flex min-h-9 items-center justify-center rounded-md border border-amber-300 bg-white px-3 text-sm font-bold text-amber-950 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                href={previewExitHref}
              >
                Exit Preview
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      <StorefrontChrome categories={categories} store={store}>
      <main className="grid gap-2.5 pb-4 lg:gap-4">
        <section className={storefrontHeroFrame.publicClass}>
          <StorefrontHeroBackdrop
            alt={store.hero_image_alt_text || `${store.store_name} farm photo`}
            layout={heroLayout}
            presentation={store.hero_presentation}
            src={store.hero_image_url}
          />
          <div className="relative z-10 mx-auto h-full max-w-[70rem] px-4 sm:px-7">
            <div
              className={`flex h-full max-w-[16.5rem] flex-col justify-center gap-2.5 [text-shadow:0_1px_10px_rgba(0,0,0,0.42)] sm:max-w-[32rem] sm:gap-4 lg:max-w-[36rem] lg:[text-shadow:none] ${heroTextColor}`}
            >
              <div>
                <p
                  className={`${storefrontHeroTypography.eyebrow} ${heroTextColor}`}
                >
                  Local farm storefront
                </p>
                <h1
                  className={`${storefrontHeroTypography.title} -mb-2 line-clamp-2 pb-2 ${heroTextColor}`}
                >
                  {heroTitle}
                </h1>
                <p
                  className={`${storefrontHeroTypography.body} line-clamp-2 ${heroTextColor}`}
                >
                  {heroSubheading}
                </p>
              </div>
              <div className="grid justify-items-start gap-2">
                <HeroPickupBadge
                  location={formatLocation(store)}
                  light
                />
                <a
                  className={storefrontButtonClass({
                    className: "mt-1 min-h-10 px-5 text-base max-lg:!hidden sm:mt-3 sm:min-h-12 sm:px-6 sm:text-xl lg:min-h-[3.25rem] lg:px-7 lg:!text-[1.45rem]",
                  })}
                  href="#shop-listings"
                >
                  Shop
                </a>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto grid w-full max-w-[70rem] gap-3.5 px-4 sm:px-7 lg:gap-6">
          <section
            className="lg:rounded-lg lg:bg-[#fbf7ef] lg:p-5"
            id="shop-listings"
          >
            <StorefrontListingTabs sections={listingSections} />
          </section>

          <section className="grid overflow-hidden rounded-lg border border-[#ded7c8] bg-[#fffdf8] lg:grid-cols-2 lg:rounded-2xl">
            <InfoCard
              actionHref={`/store/${store.store_slug}/about`}
              actionLabel="Learn more about our farm"
              eyebrow="About Our Farm"
              title={store.store_name}
            >
              {aboutPreview}
            </InfoCard>
            <InfoCard
              actionHref={`/store/${store.store_slug}/policies`}
              actionLabel="View pickup details"
              eyebrow="Pickup Location"
              title={hasLocation(store) ? formatLocation(store) : "Pickup details"}
            >
              {pickupPreview}
            </InfoCard>
          </section>
        </div>
      </main>
      </StorefrontChrome>
    </>
  );
}

function HeroPickupBadge({
  light,
  location,
}: {
  light: boolean;
  location: string;
}) {
  return (
    <div
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold leading-tight shadow-sm sm:min-h-9 sm:gap-2 sm:px-3 sm:text-xs lg:min-h-10 lg:px-4 lg:text-sm ${
        light
          ? "border-white/35 bg-stone-950/28 text-white shadow-none backdrop-blur-[1px] lg:border-white/25 lg:bg-white/84 lg:text-[#073f1e] lg:shadow-sm"
          : "storefront-primary-color border-[#ddd5c7] bg-white/90"
      }`}
    >
      <StorefrontGlyph
        className="h-4 w-4"
        src="/glyphs/map-pin.png"
      />
      <span className="min-w-0 truncate">Local pickup in {location}</span>
    </div>
  );
}

function InfoCard({
  actionHref,
  actionLabel,
  children,
  eyebrow,
  title,
}: {
  actionHref: string;
  actionLabel: string;
  children: React.ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <article className="grid gap-2.5 border-b border-[#ded7c8] p-4 last:border-b-0 lg:gap-3 lg:border-b-0 lg:border-r lg:p-8 lg:last:border-r-0">
      <div className="flex items-center gap-2.5 lg:gap-3">
        <span className="storefront-primary-color">
          <StorefrontGlyph
            className="h-8 w-8 lg:h-11 lg:w-11"
            src={
            eyebrow === "Pickup Location"
              ? "/glyphs/map-pin.png"
              : "/glyphs/farmhouse.png"
            }
          />
        </span>
        <p
          className={cx(
            storefrontSerifClass,
            "storefront-heading-color text-lg font-bold text-stone-950 lg:text-xl",
          )}
        >
          {eyebrow}
        </p>
      </div>
      <h2 className="storefront-heading-color text-lg font-semibold leading-tight text-stone-950 lg:text-xl">
        {title}
      </h2>
      <p className="storefront-text-color max-w-md text-sm leading-5 text-stone-700 lg:leading-6">
        {children}
      </p>
      <a
        className="storefront-heading-color text-sm font-semibold text-[#073f1e]"
        href={actionHref}
      >
        {actionLabel} &rarr;
      </a>
    </article>
  );
}

function hasLocation(store: { public_city: string | null; public_state: string | null }) {
  return Boolean(store.public_city || store.public_state);
}
