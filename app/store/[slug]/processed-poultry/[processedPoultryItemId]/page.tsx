import Image from "next/image";
import Link from "next/link";
import {
  AvailabilityBadge,
  EmptyStorefront,
  ListingPhoto,
  StorefrontMediaFrame,
  StorefrontPage,
  StorefrontShell,
  cx,
  formatCurrency,
  toPublicImageUrl,
} from "../../storefront-ui";
import {
  StorefrontMedia,
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
import { ProcessedPoultryOrderOptions } from "./processed-poultry-order-options";

export default async function StorefrontProcessedPoultryPage({
  params,
}: {
  params: Promise<{ processedPoultryItemId: string; slug: string }>;
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
      <StorefrontPage className="gap-7">
        <nav className="flex flex-wrap items-center gap-2 text-sm text-stone-700">
          <Link href={`/store/${store.store_slug}`}>Shop</Link>
          <span>/</span>
          <Link href={`/store/${store.store_slug}#shop-listings`}>
            Poultry Products
          </Link>
          <span>/</span>
          <span className="text-stone-950">{item.product_name}</span>
        </nav>

        <section className="grid gap-8 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)] lg:items-start">
          <div className="grid max-w-[28rem] gap-3 lg:max-w-none">
            <ProcessedPoultryGallery
              fallbackAlt={item.featured_image_alt_text || item.product_name}
              fallbackSrc={item.featured_image_url}
              gallery={gallery}
            />
          </div>

          <section className="grid gap-5 lg:pt-1">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#073f1e]">
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

function ProcessedPoultryGallery({
  fallbackAlt,
  fallbackSrc,
  gallery,
}: {
  fallbackAlt: string;
  fallbackSrc: string | null;
  gallery: StorefrontMedia[];
}) {
  const [featured, ...rest] = gallery;

  if (!featured) {
    return (
      <div className="grid gap-4">
        <div className="overflow-hidden rounded-lg border border-[#ded7c8]">
          <ListingPhoto alt={fallbackAlt} src={fallbackSrc} />
        </div>
        {fallbackSrc ? (
          <div className="grid grid-cols-4 gap-3">
            <Image
              alt={fallbackAlt}
              className="aspect-square w-full rounded-md border border-[#ded7c8] object-cover"
              height={240}
              src={toPublicImageUrl(fallbackSrc)}
              unoptimized
              width={320}
            />
          </div>
        ) : null}
      </div>
    );
  }
  const thumbnails = rest.length > 0 ? rest.slice(0, 4) : [featured];

  return (
    <StorefrontMediaFrame className="grid gap-4 border-0 bg-transparent p-0">
      <Image
        alt={featured.alt_text || fallbackAlt}
        className="aspect-[4/3] w-full rounded-lg border border-[#ded7c8] object-cover"
        height={720}
        src={toPublicImageUrl(featured.public_url)}
        unoptimized
        width={960}
      />
      <div className="grid grid-cols-4 gap-3">
        {thumbnails.map((image) => (
          <Image
            alt={image.alt_text || fallbackAlt}
            className="aspect-square w-full rounded-md border border-[#ded7c8] object-cover"
            height={240}
            key={`${image.entity_type}-${image.public_url}`}
            src={toPublicImageUrl(image.public_url)}
            unoptimized
            width={320}
          />
        ))}
      </div>
    </StorefrontMediaFrame>
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

function formatQuantityAvailable(quantity: number) {
  if (quantity <= 0) return "Sold out";
  return quantity === 1 ? "1 available" : `${quantity} available`;
}
