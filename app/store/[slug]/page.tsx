import { House, MapPin } from "lucide-react";
import Image from "next/image";
import {
  EmptyStorefront,
  StorefrontShell,
  formatCurrency,
  formatLocation,
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
  StorefrontEquipmentItem,
  StorefrontInventoryItem,
  StorefrontProcessedPoultryItem,
  StorefrontHeroCropMetadata,
  groupInventoryByProduct,
  loadStorefrontEquipment,
  loadStorefrontHome,
  loadStorefrontInventory,
  loadStorefrontProcessedPoultry,
  previewText,
} from "./storefront-data";
import {
  StorefrontChrome,
  getStorefrontCategoryAvailability,
} from "./storefront-shell-components";

type StorefrontHeroLayout = "full" | "right";

export default async function StorefrontHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [
    homeResult,
    inventoryResult,
    equipmentResult,
    processedPoultryResult,
  ] = await Promise.all([
    loadStorefrontHome(slug),
    loadStorefrontInventory(slug),
    loadStorefrontEquipment(slug),
    loadStorefrontProcessedPoultry(slug),
  ]);
  const error =
    homeResult.error ??
    inventoryResult.error ??
    equipmentResult.error ??
    processedPoultryResult.error;

  if (error) {
    return (
      <StorefrontShell>
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="This storefront could not load"
            description="Please refresh the page. If this keeps happening, the seller may need to check their storefront settings."
          />
        </main>
      </StorefrontShell>
    );
  }

  const store = homeResult.data;

  if (!store) {
    return (
      <StorefrontShell>
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="Storefront not found"
            description="This storefront is not public right now."
          />
        </main>
      </StorefrontShell>
    );
  }

  const livePoultryProducts = groupInventoryByProduct(
    inventoryResult.data.filter(isLivePoultryItem),
  );
  const hatchingEggProducts = groupInventoryByProduct(
    inventoryResult.data.filter(isHatchingEggItem),
  );
  const equipment = equipmentResult.data;
  const processedPoultry = processedPoultryResult.data;
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

  return (
    <StorefrontChrome categories={categories} store={store}>
      <main className="mx-auto grid max-w-[70rem] gap-8 px-5 py-7 sm:px-7 lg:gap-9">
        <section className={storefrontHeroFrame.publicClass}>
          <HeroBackdrop
            alt={store.hero_image_alt_text || `${store.store_name} farm photo`}
            crop={store.hero_crop_metadata}
            layout={heroLayout}
            src={store.hero_image_url}
          />
          <div
            className={`relative z-10 flex min-h-[19rem] max-w-[31rem] flex-col justify-center gap-6 p-6 sm:p-9 lg:min-h-[27rem] lg:p-10 ${
              heroIsLeftFade ? "text-white" : "text-stone-950"
            }`}
          >
            <div>
              <p
                className={`${storefrontHeroTypography.eyebrow} ${
                  heroIsLeftFade ? "text-white" : ""
                }`}
              >
                Local farm storefront
              </p>
              <h1
                className={`${storefrontHeroTypography.title} ${
                  heroIsLeftFade ? "text-white" : ""
                }`}
              >
                {heroTitle}
              </h1>
              <p
                className={`${storefrontHeroTypography.body} ${
                  heroIsLeftFade ? "text-white" : ""
                }`}
              >
                {heroSubheading}
              </p>
            </div>
            <div>
              <a className={storefrontButtonClass()} href="#shop-listings">
                Shop Live Poultry
              </a>
            </div>
          </div>
        </section>

        <section id="shop-listings">
          <h2 className="mb-5 font-serif text-3xl font-semibold leading-tight text-stone-950">
            Shop Our Listings
          </h2>
          <StorefrontListingTabs sections={listingSections} />
        </section>

        <section className="grid overflow-hidden rounded-2xl border border-[#ded7c8] bg-[#fffdf8] lg:grid-cols-2">
          <InfoCard
            actionHref={`/store/${store.store_slug}/about`}
            actionLabel="Learn more about our farm"
            eyebrow="About This Farm"
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
      </main>
    </StorefrontChrome>
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

  const cropStyle = getHeroCropStyle(crop);
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
          className={`absolute inset-0 h-full w-full object-center ${
            crop ? "object-contain" : "object-cover"
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
        <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(90deg,rgba(28,25,23,0.46)_0%,rgba(28,25,23,0.34)_36%,rgba(28,25,23,0.04)_72%)]" />
      </>
    );
  }

  return (
    <Image
      alt={alt}
      className={`absolute inset-0 h-full w-full object-center ${
        crop ? "object-contain" : "object-cover"
      }`}
      fill
      priority
      sizes="(max-width: 1024px) 100vw, 70rem"
      src={imageUrl}
      style={cropStyle}
      unoptimized
    />
  );
}

function getHeroCropStyle(crop: StorefrontHeroCropMetadata | null) {
  if (!crop) return undefined;

  const zoom = Number.isFinite(crop.zoom) && crop.zoom > 0 ? crop.zoom : 1;
  const x = Number.isFinite(crop.x) ? Math.round(crop.x) : 0;
  const y = Number.isFinite(crop.y) ? Math.round(crop.y) : 0;
  const rotation = [0, 90, 180, 270].includes(crop.rotation)
    ? crop.rotation
    : 0;

  return {
    transform: `translate(${x}px, ${y}px) scale(${zoom}) rotate(${rotation}deg)`,
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
      cards: livePoultryProducts.map(toProductCard),
      description: "Available birds from this storefront.",
      emptyDescription: "This seller does not have visible live poultry right now.",
      emptyTitle: "No live poultry available",
      id: "live-poultry",
      label: "Live Poultry",
    },
  ];

  if (hatchingEggProducts.length > 0) {
    sections.push({
      cards: hatchingEggProducts.map(toProductCard),
      description: "Available hatching eggs for local pickup.",
      emptyDescription: "This seller does not have visible hatching eggs right now.",
      emptyTitle: "No hatching eggs available",
      id: "hatching-eggs",
      label: "Hatching Eggs",
    });
  }

  if (equipment.length > 0) {
    sections.push({
      cards: equipment.map(toEquipmentCard),
      description: "Equipment and supplies available from this seller.",
      emptyDescription:
        "This seller does not have visible equipment or supplies right now.",
      emptyTitle: "No equipment or supplies available",
      id: "equipment-supplies",
      label: "Equipment & Supplies",
    });
  }

  if (processedPoultry.length > 0) {
    sections.push({
      cards: processedPoultry.map(toProcessedPoultryCard),
      description: "Processed poultry items available for local pickup.",
      emptyDescription:
        "This seller does not have visible processed poultry right now.",
      emptyTitle: "No processed poultry available",
      id: "processed-poultry",
      label: "Processed Poultry",
    });
  }

  return sections;
}

function toProcessedPoultryCard(
  item: StorefrontProcessedPoultryItem,
): StorefrontListingCard {
  return {
    availabilityCode: item.buyer_availability_code,
    availabilityLabel: formatAvailableBadge(item.quantity_available),
    description: item.description || item.package_size,
    detail: formatQuantity(item.quantity_available),
    href: `/store/${item.store_slug}/processed-poultry/${item.processed_poultry_inventory_item_id}`,
    imageAlt: item.featured_image_alt_text || item.product_name,
    imageUrl: item.featured_image_url,
    meta: [item.poultry_type, item.product_type].filter(Boolean).join(" - "),
    price: formatCurrency(item.unit_price),
    title: item.product_name,
  };
}

function toEquipmentCard(item: StorefrontEquipmentItem): StorefrontListingCard {
  return {
    availabilityCode: item.buyer_availability_code,
    availabilityLabel: formatAvailableBadge(item.quantity_available),
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
  return {
    availabilityCode: product.availabilityCode,
    availabilityLabel: formatAvailableBadge(product.totalQuantityAvailable),
    description: product.description,
    detail: product.quantityLabel,
    href: `/store/${product.storeSlug}/products/${product.productId}`,
    imageAlt: product.imageAlt || product.name,
    imageUrl: product.imageUrl,
    meta: product.speciesName,
    price: product.pricingLabel || "See options",
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
    <article className="grid gap-3 border-b border-[#ded7c8] p-6 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0 lg:p-8">
      <div className="flex items-center gap-3">
        {eyebrow === "Pickup Location" ? (
          <MapPin
            aria-hidden="true"
            className="h-10 w-10 shrink-0 text-[#073f1e]"
            strokeWidth={2}
          />
        ) : (
          <House
            aria-hidden="true"
            className="h-10 w-10 shrink-0 text-[#073f1e]"
            strokeWidth={2}
          />
        )}
        <p className="font-serif text-xl font-semibold text-stone-950">
          {eyebrow}
        </p>
      </div>
      <h2 className="text-xl font-semibold text-stone-950">{title}</h2>
      <p className="max-w-md text-sm leading-6 text-stone-700">{children}</p>
      <a className="text-sm font-semibold text-[#073f1e]" href={actionHref}>
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
