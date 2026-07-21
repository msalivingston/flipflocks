import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import {
  AvailabilityBadge,
  EmptyStorefront,
  StorefrontPage,
  StorefrontShell,
  cx,
  formatCurrency,
  formatLocation,
  toPublicImageUrl,
} from "../../storefront-ui";
import {
  StorefrontMedia,
  StorefrontProcessedPoultryItem,
  groupInventoryByProduct,
  loadStorefrontEquipment,
  loadStorefrontHome,
  loadStorefrontInventory,
  loadStorefrontProcessedPoultryGallery,
  loadStorefrontProcessedPoultryItem,
  loadStorefrontProcessedPoultry,
} from "../../storefront-data";
import {
  StorefrontChrome,
  getStorefrontCategoryAvailability,
} from "../../storefront-shell-components";
import { storefrontSerifClass } from "../../storefront-fonts";
import { StorefrontProductGallery } from "../../storefront-product-gallery";
import { ProcessedPoultryOrderOptions } from "./processed-poultry-order-options";

type StorefrontProcessedPoultryPageParams = Promise<{
  processedPoultryItemId: string;
  slug: string;
}>;

export async function generateMetadata({
  params,
}: {
  params: StorefrontProcessedPoultryPageParams;
}): Promise<Metadata> {
  const { processedPoultryItemId, slug } = await params;
  const origin = await getRequestOrigin();
  const canonicalUrl = origin
    ? new URL(
        buildCanonicalProcessedPoultryPath(slug, processedPoultryItemId),
        origin,
      ).toString()
    : null;
  const [homeResult, itemResult, galleryResult] = await Promise.all([
    loadStorefrontHome(slug),
    loadStorefrontProcessedPoultryItem(slug, processedPoultryItemId),
    loadStorefrontProcessedPoultryGallery(slug, processedPoultryItemId),
  ]);

  if (homeResult.error || itemResult.error || galleryResult.error) {
    return buildListingMetadata({
      canonicalUrl,
      description:
        "This poultry product may no longer be visible on FlockFront.",
      image: null,
      title: "Poultry product not found | FlockFront",
    });
  }

  const store = homeResult.data;
  const item = itemResult.data;

  if (!store || !item) {
    return buildListingMetadata({
      canonicalUrl,
      description:
        "This poultry product may no longer be visible on FlockFront.",
      image: null,
      title: "Poultry product not found | FlockFront",
    });
  }

  const gallery = buildProcessedPoultryGallery(item, galleryResult.data);
  const image = getListingMetadataImage({
    fallbackAlt: item.featured_image_alt_text || item.product_name,
    fallbackUrl: item.featured_image_url,
    gallery,
    origin,
  });
  const title = `${item.product_name} | ${store.store_name}`;
  const description = buildProcessedPoultryMetadataDescription(
    item,
    store.store_name,
  );

  return buildListingMetadata({
    canonicalUrl,
    description,
    image,
    title,
  });
}

export default async function StorefrontProcessedPoultryPage({
  params,
}: {
  params: StorefrontProcessedPoultryPageParams;
}) {
  const { processedPoultryItemId, slug } = await params;

  const [
    homeResult,
    itemResult,
    galleryResult,
    inventoryResult,
    equipmentResult,
    processedPoultryResult,
  ] = await Promise.all([
    loadStorefrontHome(slug),
    loadStorefrontProcessedPoultryItem(slug, processedPoultryItemId),
    loadStorefrontProcessedPoultryGallery(slug, processedPoultryItemId),
    loadStorefrontInventory(slug),
    loadStorefrontEquipment(slug),
    loadStorefrontProcessedPoultry(slug),
  ]);
  const error =
    homeResult.error ??
    itemResult.error ??
    galleryResult.error ??
    inventoryResult.error ??
    equipmentResult.error ??
    processedPoultryResult.error;

  if (error) {
    return (
      <StorefrontShell>
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="This item could not load"
            description="Please refresh the page or return to the storefront."
          />
        </StorefrontPage>
      </StorefrontShell>
    );
  }

  const store = homeResult.data;

  if (!store) {
    return (
      <StorefrontShell>
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="Storefront not found"
            description="This storefront is not public right now."
          />
        </StorefrontPage>
      </StorefrontShell>
    );
  }

  const item = itemResult.data;
  const categories = getStorefrontCategoryAvailability({
    equipmentCount: equipmentResult.data.length,
    hatchingEggCount: groupInventoryByProduct(
      inventoryResult.data.filter(isHatchingEggItem),
    ).length,
    livePoultryCount: groupInventoryByProduct(
      inventoryResult.data.filter(isLivePoultryItem),
    ).length,
    processedPoultryCount: processedPoultryResult.data.length,
  });

  if (!item) {
    return (
      <StorefrontChrome categories={categories} store={store}>
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="Item not found"
            description="This processed poultry item may no longer be visible."
          />
        </StorefrontPage>
      </StorefrontChrome>
    );
  }

  const gallery = buildProcessedPoultryGallery(item, galleryResult.data);

  return (
    <StorefrontChrome categories={categories} store={store}>
      <StorefrontPage className="!gap-1.5 !pb-1 !pt-3.5 lg:!gap-7 lg:!py-8">
        <Link
          className="storefront-primary-color mb-2.5 inline-flex min-h-6 w-fit items-center rounded-md pr-3 pt-1 text-sm font-bold leading-none text-[#073f1e] focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 lg:hidden"
          href={`/store/${store.store_slug}#shop-listings`}
        >
          <span aria-hidden="true" className="mr-1 text-lg leading-none">
            ‹
          </span>
          Poultry Products
        </Link>

        <nav className="hidden flex-wrap items-center gap-2 text-sm text-stone-700 lg:flex">
          <Link href={`/store/${store.store_slug}`}>Shop</Link>
          <span>/</span>
          <Link href={`/store/${store.store_slug}#shop-listings`}>
            Poultry Products
          </Link>
          <span>/</span>
          <span className="text-stone-950">{item.product_name}</span>
        </nav>

        <section className="grid gap-2 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:gap-8">
          <div className="grid max-w-[28rem] gap-2.5 justify-self-center lg:max-w-none lg:gap-3 lg:justify-self-auto">
            <ProcessedPoultryGallery
              fallbackAlt={item.featured_image_alt_text || item.product_name}
              fallbackSrc={item.featured_image_url}
              gallery={gallery}
            />
            <MobileProcessedIdentity
              item={item}
              location={formatLocation(store)}
            />
          </div>

          <section className="hidden gap-5 lg:grid lg:pt-1">
            <div>
              <p className="storefront-primary-color text-xs font-bold uppercase tracking-[0.18em] text-[#073f1e]">
                {[item.poultry_type, item.product_type].filter(Boolean).join(" - ")}
              </p>
              <h1
                className={cx(
                  storefrontSerifClass,
                  "mt-4 text-4xl font-bold leading-tight text-stone-950",
                )}
              >
                {item.product_name}
              </h1>
            </div>

            <p className="max-w-2xl whitespace-pre-line text-base leading-7 text-stone-700">
              {item.description ||
                "This seller has not added a description yet. Current purchase details are listed below."}
            </p>

            <div className="grid gap-3 text-base text-stone-800">
              <div className="flex flex-wrap items-center gap-3">
                <AvailabilityBadge
                  code={item.buyer_availability_code}
                  label={item.buyer_availability_label}
                />
                <p>
                  <span className="font-semibold text-stone-950">
                    {formatQuantityAvailable(item.quantity_available)}
                  </span>{" "}
                  at {formatCurrency(item.unit_price)} each.
                </p>
              </div>
            </div>
          </section>
        </section>

        <ProcessedPoultryOrderOptions item={item} />
      </StorefrontPage>
    </StorefrontChrome>
  );
}

function MobileProcessedIdentity({
  item,
  location,
}: {
  item: StorefrontProcessedPoultryItem;
  location: string;
}) {
  const meta = [item.poultry_type, item.product_type, item.package_size]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="grid gap-1.5 lg:hidden">
      <p className="storefront-primary-color text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[#073f1e]">
        Poultry Products
      </p>
      <h1
        className={cx(
          storefrontSerifClass,
          "text-[1.9rem] font-bold leading-[1.03] text-stone-950",
        )}
      >
        {item.product_name}
      </h1>
      {meta ? <p className="text-sm font-semibold text-stone-700">{meta}</p> : null}
      {item.description ? (
        <p className="line-clamp-2 text-[0.95rem] leading-5 text-stone-700">
          {item.description}
        </p>
      ) : null}
      <p className="storefront-primary-color text-[1.45rem] font-bold leading-tight text-[#073f1e]">
        {formatCurrency(item.unit_price)} each
      </p>
      <p className="text-sm font-medium leading-5 text-stone-600">
        {item.buyer_availability_label} · {formatQuantityAvailable(item.quantity_available)} · Pickup in {location}
      </p>
    </section>
  );
}

function ProcessedPoultryGallery({
  fallbackAlt,
  fallbackSrc,
  gallery,
}: {
  fallbackAlt: string;
  fallbackSrc: string | null;
  gallery: StorefrontMedia[];
}) {
  return (
    <StorefrontProductGallery
      fallbackAlt={fallbackAlt}
      fallbackSrc={fallbackSrc}
      gallery={gallery}
    />
  );
}

function buildProcessedPoultryGallery(
  item: {
    featured_image_alt_text: string | null;
    featured_image_url: string | null;
    processed_poultry_inventory_item_id: string;
    product_name: string;
    store_slug: string;
  },
  linkedGallery: StorefrontMedia[],
) {
  if (linkedGallery.length > 0) return linkedGallery;
  if (!item.featured_image_url) return [];

  return [
    {
      alt_text: item.featured_image_alt_text,
      caption: null,
      display_context: "featured",
      entity_id: item.processed_poultry_inventory_item_id,
      entity_type: "processed_poultry_inventory_item",
      height_px: null,
      is_featured: true,
      public_url: item.featured_image_url,
      sort_order: 0,
      store_id: "",
      store_slug: item.store_slug,
      width_px: null,
    },
  ];
}

function isHatchingEggItem(item: { batch_type: string | null; inventory_type: string }) {
  return item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs";
}

function isLivePoultryItem(item: { batch_type: string | null; inventory_type: string }) {
  return !isHatchingEggItem(item);
}

type ListingMetadataImage = {
  alt: string;
  height: number | null;
  url: string;
  width: number | null;
};

function buildListingMetadata({
  canonicalUrl,
  description,
  image,
  title,
}: {
  canonicalUrl: string | null;
  description: string;
  image: ListingMetadataImage | null;
  title: string;
}): Metadata {
  const metadata: Metadata = {
    description,
    title,
    openGraph: {
      description,
      title,
      type: "website",
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      ...(image
        ? {
            images: [
              {
                alt: image.alt,
                url: image.url,
                ...(image.width ? { width: image.width } : {}),
                ...(image.height ? { height: image.height } : {}),
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      description,
      title,
      ...(image ? { images: [image.url] } : {}),
    },
  };

  if (canonicalUrl) {
    metadata.alternates = {
      canonical: canonicalUrl,
    };
  }

  return metadata;
}

function buildProcessedPoultryMetadataDescription(
  item: StorefrontProcessedPoultryItem,
  storeName: string,
) {
  const priceUnit = item.package_size?.trim() || "item";
  const summary = [
    item.product_name,
    `from ${storeName}`,
    `${formatCurrency(item.unit_price)} per ${priceUnit}`,
    item.buyer_availability_label,
  ]
    .filter(Boolean)
    .join(" - ");
  const description = formatMetadataDescriptionText(item.description);
  const fallback = `View ${item.product_name} from ${storeName} on FlockFront.`;

  return truncateMetadataDescription(
    description ? `${summary}. ${description}` : summary || fallback,
  );
}

function getListingMetadataImage({
  fallbackAlt,
  fallbackUrl,
  gallery,
  origin,
}: {
  fallbackAlt: string;
  fallbackUrl: string | null;
  gallery: StorefrontMedia[];
  origin: string | null;
}): ListingMetadataImage | null {
  const image = gallery[0];
  const imageUrl = image?.public_url ?? fallbackUrl;
  const absoluteUrl = toAbsoluteImageUrl(imageUrl, origin);

  if (!absoluteUrl) return null;

  return {
    alt: image?.alt_text || fallbackAlt,
    height: image?.height_px ?? null,
    url: absoluteUrl,
    width: image?.width_px ?? null,
  };
}

function toAbsoluteImageUrl(value: string | null | undefined, origin: string | null) {
  const trimmed = value?.trim();

  if (!trimmed) return null;

  const publicUrl = toPublicImageUrl(trimmed);

  if (/^https?:\/\//i.test(publicUrl)) return publicUrl;
  if (!origin || !publicUrl.startsWith("/")) return null;

  try {
    return new URL(publicUrl, origin).toString();
  } catch {
    return null;
  }
}

async function getRequestOrigin() {
  const headersList = await headers();
  const host = getForwardedHeaderValue(headersList.get("x-forwarded-host")) ??
    headersList.get("host");

  if (!host) return null;

  const proto =
    getForwardedHeaderValue(headersList.get("x-forwarded-proto")) ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

function getForwardedHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function buildCanonicalProcessedPoultryPath(
  slug: string,
  processedPoultryItemId: string,
) {
  return `/store/${encodeURIComponent(slug)}/processed-poultry/${encodeURIComponent(
    processedPoultryItemId,
  )}`;
}

function formatMetadataDescriptionText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function truncateMetadataDescription(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 180) return normalized;

  return `${normalized.slice(0, 177).trimEnd()}...`;
}

function formatQuantityAvailable(quantity: number) {
  if (quantity <= 0) return "Sold out";
  return quantity === 1 ? "1 available" : `${quantity} available`;
}
