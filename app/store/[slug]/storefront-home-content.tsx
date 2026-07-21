"use client";

import Image from "next/image";
import {
  cx,
  formatCurrency,
  formatLocation,
  getStorefrontCropStyle,
  StorefrontGlyph,
  storefrontButtonClass,
  storefrontHeroFrame,
  storefrontHeroTypography,
  toPublicImageUrl,
} from "./storefront-ui";
import {
  StorefrontListingCard,
  StorefrontListingSection,
  StorefrontListingTabs,
} from "./storefront-listing-tabs";
import {
  StorefrontProduct,
  StorefrontProfileImageMap,
  StorefrontEquipmentItem,
  StorefrontHatchingEggItem,
  StorefrontInventoryItem,
  StorefrontProcessedPoultryItem,
  StorefrontHeroCropMetadata,
  StorefrontHome,
  groupHatchingEggInventoryByProduct,
  groupInventoryByProduct,
  previewText,
} from "./storefront-data";
import {
  StorefrontChrome,
  getStorefrontCategoryAvailability,
} from "./storefront-shell-components";
import { storefrontSerifClass } from "./storefront-fonts";

type StorefrontHeroLayout = "full" | "right";

export function StorefrontHomeContent({
  equipment,
  hatchingEggs,
  inventory,
  livePoultryProfileImages = {},
  processedPoultry,
  showPreviewBanner = false,
  store,
}: {
  equipment: StorefrontEquipmentItem[];
  hatchingEggs: StorefrontHatchingEggItem[];
  inventory: StorefrontInventoryItem[];
  livePoultryProfileImages?: StorefrontProfileImageMap;
  processedPoultry: StorefrontProcessedPoultryItem[];
  showPreviewBanner?: boolean;
  store: StorefrontHome;
}) {
  const livePoultryProducts = groupInventoryByProduct(
    inventory.filter(isLivePoultryItem),
    livePoultryProfileImages,
  );
  const hatchingEggProducts = groupHatchingEggInventoryByProduct(hatchingEggs);
  const heroSubheading =
    store.hero_subheading?.trim() ||
    "Browse current availability and request pickup at checkout.";
  const aboutPreview = previewText(
    store.about_text,
    `${store.store_name} shares pickup details and current products from the farm.`,
  );
  const pickupPreview = previewText(
    store.pickup_instructions || store.pickup_policy,
    "Pickup details will be confirmed after your order is placed.",
  );
  const heroTitle = store.store_tagline || store.store_name;
  const listingSections = buildListingSections({
    equipment,
    hatchingEggProducts,
    livePoultryProducts,
    processedPoultry,
  });
  const categories = getStorefrontCategoryAvailability({
    equipmentCount: equipment.length,
    hatchingEggCount: hatchingEggProducts.length,
    livePoultryCount: livePoultryProducts.length,
    processedPoultryCount: processedPoultry.length,
  });
  const heroLayout = store.hero_image_layout === "right" ? "right" : "full";
  const heroIsLeftFade = heroLayout === "right";
  const heroTextColor = heroIsLeftFade ? "text-white" : "text-white lg:text-black";

  return (
    <>
      {showPreviewBanner ? (
        <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-5 py-3 text-center text-sm font-semibold text-amber-950 shadow-sm">
          Preview mode &mdash; this store is hidden from customers.
        </div>
      ) : null}
      <StorefrontChrome categories={categories} store={store}>
      <main className="grid gap-2.5 pb-4 lg:gap-4">
        <section className={storefrontHeroFrame.publicClass}>
          <HeroBackdrop
            alt={store.hero_image_alt_text || `${store.store_name} farm photo`}
            crop={store.hero_crop_metadata}
            layout={heroLayout}
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

function HeroBackdrop({
  alt,
  crop,
  layout,
  src,
}: {
  alt: string;
  crop: StorefrontHeroCropMetadata | null;
  layout: StorefrontHeroLayout;
  src: string | null;
}) {
  if (!src) {
    return (
      <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,#f6ead8_0%,#d9e6cf_45%,#8fae72_100%)]">
        <div className="absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,transparent,#5e7d3d)] opacity-45" />
        <div className="absolute bottom-0 left-[46%] h-24 w-44 rounded-t-lg bg-[#8d3f20] shadow-[22px_-42px_0_-18px_#7d341c,140px_-34px_0_-14px_#f4dfbf]" />
        <div className="absolute bottom-0 right-[8%] h-32 w-20 rounded-t-full bg-[#d8c9aa] shadow-[-34px_4px_0_-8px_#c6b796]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_20%,rgba(255,255,255,0.7),transparent_26%),linear-gradient(90deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.22)_38%,rgba(255,255,255,0)_66%)]" />
      </div>
    );
  }

  const cropStyle = getStorefrontCropStyle(crop);
  const mobileCropStyle = getMobileHeroCropStyle(crop);
  const imageUrl = toPublicImageUrl(src);

  if (layout === "right") {
    return (
      <>
        <Image
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl saturate-110"
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 70rem"
          src={imageUrl}
          style={{ filter: "blur(26px) brightness(0.62) saturate(1.12)" }}
          unoptimized
        />
        <Image
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover object-center lg:hidden"
          fill
          priority
          sizes="100vw"
          src={imageUrl}
          style={mobileCropStyle}
          unoptimized
        />
        <Image
          alt={alt}
          className={`absolute inset-0 hidden h-full w-full object-cover object-center lg:block ${
            crop ? "lg:object-contain" : ""
          }`}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 70rem"
          src={imageUrl}
          style={{
            ...cropStyle,
            WebkitMaskImage:
              "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.2) 18%, black 34%, black 100%)",
            maskImage:
              "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.2) 18%, black 34%, black 100%)",
          }}
          unoptimized
        />
        <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(90deg,rgba(28,25,23,0.8)_0%,rgba(28,25,23,0.64)_42%,rgba(28,25,23,0.28)_78%,rgba(28,25,23,0.08)_100%)] lg:hidden" />
        <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(90deg,rgba(28,25,23,0.46)_0%,rgba(28,25,23,0.34)_36%,rgba(28,25,23,0.04)_72%)]" />
      </>
    );
  }

  return (
    <>
        <Image
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover object-center lg:hidden"
          fill
          priority
          sizes="100vw"
          src={imageUrl}
          style={mobileCropStyle}
          unoptimized
        />
        <Image
          alt={alt}
          className={`absolute inset-0 hidden h-full w-full object-cover object-center lg:block ${
            crop ? "lg:object-contain" : ""
          }`}
        fill
        priority
        sizes="(max-width: 1024px) 100vw, 70rem"
        src={imageUrl}
        style={cropStyle}
        unoptimized
      />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(90deg,rgba(28,25,23,0.8)_0%,rgba(28,25,23,0.64)_42%,rgba(28,25,23,0.3)_74%,rgba(28,25,23,0.08)_100%)] lg:hidden" />
    </>
  );
}

function getMobileHeroCropStyle(crop: StorefrontHeroCropMetadata | null) {
  if (!crop) return undefined;

  const zoom = Number.isFinite(crop.zoom) && crop.zoom > 0 ? crop.zoom : 1;
  const x = Number.isFinite(crop.x) ? Math.round(crop.x * 0.82) : 0;
  const y = Number.isFinite(crop.y) ? Math.round(crop.y * 0.82) : 0;
  const rotation = [0, 90, 180, 270].includes(crop.rotation)
    ? crop.rotation
    : 0;

  return {
    transform: `translate(${x}px, ${y}px) scale(${zoom * 1.22}) rotate(${rotation}deg)`,
    transformOrigin: "center center",
  };
}

function buildListingSections({
  equipment,
  hatchingEggProducts,
  livePoultryProducts,
  processedPoultry,
}: {
  equipment: StorefrontEquipmentItem[];
  hatchingEggProducts: StorefrontProduct[];
  livePoultryProducts: StorefrontProduct[];
  processedPoultry: StorefrontProcessedPoultryItem[];
}) {
  const sections: StorefrontListingSection[] = [
    {
      cards: sortListingCardsByTitle(livePoultryProducts.map(toProductCard)),
      description: "Available birds from this storefront.",
      emptyDescription: "This seller does not have visible live poultry right now.",
      emptyTitle: "No live poultry available",
      id: "live-poultry",
      label: "Live Birds",
    },
  ];

  if (hatchingEggProducts.length > 0) {
    sections.push({
      cards: sortListingCardsByTitle(hatchingEggProducts.map(toProductCard)),
      description: "Available hatching eggs for local pickup.",
      emptyDescription: "This seller does not have visible hatching eggs right now.",
      emptyTitle: "No hatching eggs available",
      id: "hatching-eggs",
      label: "Hatching Eggs",
    });
  }

  if (processedPoultry.length > 0) {
    sections.push({
      cards: sortListingCardsByTitle(
        processedPoultry.map(toProcessedPoultryCard),
      ),
      description: "Processed poultry items available for local pickup.",
      emptyDescription:
        "This seller does not have visible processed poultry right now.",
      emptyTitle: "No processed poultry available",
      id: "processed-poultry",
      label: "Poultry Products",
    });
  }

  if (equipment.length > 0) {
    sections.push({
      cards: sortListingCardsByTitle(equipment.map(toEquipmentCard)),
      description: "Equipment and supplies available from this seller.",
      emptyDescription:
        "This seller does not have visible equipment or supplies right now.",
      emptyTitle: "No equipment or supplies available",
      id: "equipment-supplies",
      label: "Equipment & Supplies",
    });
  }

  return sections;
}

function sortListingCardsByTitle(cards: StorefrontListingCard[]) {
  return [...cards].sort((first, second) =>
    first.title.localeCompare(second.title, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function toProcessedPoultryCard(
  item: StorefrontProcessedPoultryItem,
): StorefrontListingCard {
  return {
    availabilityCode: item.buyer_availability_code,
    availabilityLabel: formatAvailableBadge(item.quantity_available),
    categoryFilter: item.product_type,
    description: item.description || item.package_size,
    detail: formatQuantity(item.quantity_available),
    href: `/store/${item.store_slug}/processed-poultry/${item.processed_poultry_inventory_item_id}`,
    imageAlt: item.featured_image_alt_text || item.product_name,
    imageUrl: item.featured_image_url,
    meta: [item.poultry_type, item.product_type].filter(Boolean).join(" - "),
    price: formatCurrency(item.unit_price),
    speciesFilter: item.poultry_type,
    title: item.product_name,
  };
}

function toEquipmentCard(item: StorefrontEquipmentItem): StorefrontListingCard {
  return {
    availabilityCode: item.buyer_availability_code,
    availabilityLabel: formatAvailableBadge(item.quantity_available),
    categoryFilter: item.category,
    conditionFilter: item.condition,
    description: item.description,
    detail: formatQuantity(item.quantity_available),
    href: `/store/${item.store_slug}/equipment/${item.equipment_inventory_item_id}`,
    imageAlt: item.featured_image_alt_text || item.item_name,
    imageUrl: item.featured_image_url,
    meta: item.category,
    price: formatCurrency(item.unit_price),
    title: item.item_name,
  };
}

function toProductCard(product: StorefrontProduct): StorefrontListingCard {
  const purchasableOptions = product.options.filter(
    (option) => option.canCheckout && option.quantityAvailable > 0,
  );
  const batchFilters =
    product.productSource === "listing_inventory"
      ? purchasableOptions.map((option) => ({
          ageFilterDays: option.ageFilterDays,
          availabilityCode: option.buyerAvailabilityCode,
        }))
      : undefined;

  return {
    ageFilterDays: purchasableOptions
      .map((option) => option.ageFilterDays)
      .filter((age): age is number => age !== null),
    availabilityCode: product.availabilityCode,
    availabilityLabel: formatAvailableBadge(product.totalQuantityAvailable),
    batchFilters,
    breedFilter: product.name,
    description: product.description,
    detail: product.quantityLabel,
    href: `/store/${product.storeSlug}/products/${product.productId}`,
    imageAlt: product.imageAlt || product.name,
    imageUrl: product.imageUrl,
    meta: product.speciesName,
    price: product.pricingLabel || "See options",
    speciesFilter: product.speciesName,
    title: product.name,
  };
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

function formatAvailableBadge(quantity: number) {
  if (quantity <= 0) return "Sold out";
  return `${quantity} available`;
}

function formatQuantity(quantity: number) {
  if (quantity <= 0) return "Sold out";
  if (quantity === 1) return "1 available";
  return `${quantity} available`;
}

function isHatchingEggItem(item: StorefrontInventoryItem) {
  return item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs";
}

function isLivePoultryItem(item: StorefrontInventoryItem) {
  return !isHatchingEggItem(item);
}

function hasLocation(store: { public_city: string | null; public_state: string | null }) {
  return Boolean(store.public_city || store.public_state);
}
