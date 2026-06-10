import Image from "next/image";
import Link from "next/link";
import {
  EmptyStorefront,
  ListingPhoto,
  StorefrontMediaFrame,
  StorefrontPage,
  StorefrontShell,
  formatDate,
  toPublicImageUrl,
} from "../../storefront-ui";
import {
  StorefrontMedia,
  StorefrontProduct,
  findProduct,
  groupInventoryByProduct,
  loadStorefrontEquipment,
  loadStoreGallery,
  loadStorefrontHome,
  loadStorefrontInventory,
  loadStorefrontProcessedPoultry,
} from "../../storefront-data";
import {
  StorefrontChrome,
  getStorefrontCategoryAvailability,
} from "../../storefront-shell-components";
import { ProductOrderOptions } from "./product-order-options";

export default async function StorefrontProductPage({
  params,
}: {
  params: Promise<{ productId: string; slug: string }>;
}) {
  const { productId, slug } = await params;

  const [
    homeResult,
    inventoryResult,
    galleryResult,
    equipmentResult,
    processedPoultryResult,
  ] = await Promise.all([
    loadStorefrontHome(slug),
    loadStorefrontInventory(slug),
    loadStoreGallery(slug, {
      entityId: productId,
      entityType: "seller_breed_profile",
      limit: 8,
    }),
    loadStorefrontEquipment(slug),
    loadStorefrontProcessedPoultry(slug),
  ]);
  const error =
    homeResult.error ??
    inventoryResult.error ??
    galleryResult.error ??
    equipmentResult.error ??
    processedPoultryResult.error;

  if (error) {
    return (
      <StorefrontShell>
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="This product could not load"
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

  const product = findProduct(
    groupInventoryByProduct(inventoryResult.data),
    productId,
  );
  const livePoultryProducts = groupInventoryByProduct(
    inventoryResult.data.filter(isLivePoultryItem),
  );
  const hatchingEggProducts = groupInventoryByProduct(
    inventoryResult.data.filter(isHatchingEggItem),
  );
  const categories = getStorefrontCategoryAvailability({
    equipmentCount: equipmentResult.data.length,
    hatchingEggCount: hatchingEggProducts.length,
    livePoultryCount: livePoultryProducts.length,
    processedPoultryCount: processedPoultryResult.data.length,
  });

  if (!product) {
    return (
      <StorefrontChrome categories={categories} store={store}>
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="Product not found"
            description="This breed or product may no longer be visible."
          />
        </StorefrontPage>
      </StorefrontChrome>
    );
  }

  const gallery = buildProductGallery(product, galleryResult.data);

  return (
    <StorefrontChrome categories={categories} store={store}>
      <StorefrontPage className="gap-6">
        <nav className="flex flex-wrap items-center gap-2 text-sm text-stone-700">
          <Link href={`/store/${store.store_slug}`}>Shop</Link>
          <span>/</span>
          <Link href={`/store/${store.store_slug}#shop-listings`}>
            Live Poultry
          </Link>
          <span>/</span>
          <span>{product.speciesName}</span>
          <span>/</span>
          <span className="text-stone-950">{product.name}</span>
        </nav>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.7fr)_minmax(21rem,0.8fr)] lg:items-start">
          <div className="grid gap-5">
            <ProductGallery
              fallbackAlt={product.imageAlt || product.name}
              fallbackSrc={product.imageUrl}
              gallery={gallery}
            />
            <ProductHighlights />
          </div>

          <section className="grid gap-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#073f1e]">
                {product.speciesName}
              </p>
              <h1 className="mt-4 font-serif text-4xl font-semibold leading-tight text-stone-950">
                {product.name}
              </h1>
              <p className="mt-3 text-lg text-stone-900">
                {productSubtitle(product)}
              </p>
            </div>

            <p className="whitespace-pre-line text-base leading-8 text-stone-700">
              {product.description ||
                "This seller has not added a long description yet. Current purchase options are listed in the ordering panel."}
            </p>

            <div className="grid overflow-hidden rounded-xl border border-[#ded7c8] bg-[#fffdf8] text-sm sm:grid-cols-2">
              <ProductSummary label="Availability" value={product.availabilityLabel} />
              <ProductSummary
                label="Next availability"
                value={
                  product.nextAvailableDate
                    ? formatDate(product.nextAvailableDate)
                    : "Check back soon"
                }
              />
              <ProductSummary label="Total available" value={product.quantityLabel} />
              <ProductSummary
                label="Purchase options"
                value={
                  product.optionsCount === 1
                    ? "1 option"
                    : `${product.optionsCount} options`
                }
              />
            </div>
          </section>

          <aside className="lg:sticky lg:top-28">
            <ProductOrderOptions product={product} />
          </aside>
        </section>
      </StorefrontPage>
    </StorefrontChrome>
  );
}

function ProductSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[#ded7c8] p-4 last:border-b-0 sm:border-r sm:last:border-r-0 sm:[&:nth-child(2n)]:border-r-0">
      <p className="text-sm font-semibold text-stone-950">
        {label}
      </p>
      <p className="mt-1 font-semibold text-[#073f1e]">{value}</p>
    </div>
  );
}

function ProductGallery({
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
        <div className="overflow-hidden rounded-xl border border-[#ded7c8]">
          <ListingPhoto alt={fallbackAlt} src={fallbackSrc} />
        </div>
        {fallbackSrc ? (
          <div className="grid grid-cols-4 gap-3">
            <Image
              alt={fallbackAlt}
              className="aspect-square w-full rounded-lg border border-[#ded7c8] object-cover"
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
        className="aspect-[4/3] w-full rounded-xl border border-[#ded7c8] object-cover"
        height={720}
        src={toPublicImageUrl(featured.public_url)}
        unoptimized
        width={960}
      />
      <div className="grid grid-cols-4 gap-3">
        {thumbnails.map((image) => (
          <Image
            alt={image.alt_text || fallbackAlt}
            className="aspect-square w-full rounded-lg border border-[#ded7c8] object-cover"
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

function buildProductGallery(
  product: StorefrontProduct,
  linkedGallery: StorefrontMedia[],
) {
  if (linkedGallery.length > 0) return linkedGallery;

  const fallbackImages = product.options
    .map((option) => option.inventoryItemId)
    .filter(Boolean);

  if (fallbackImages.length === 0 || !product.imageUrl) return [];

  return [
    {
      alt_text: product.imageAlt,
      caption: null,
      display_context: "featured",
      entity_id: product.productId,
      entity_type: "seller_breed_profile",
      height_px: null,
      is_featured: true,
      public_url: product.imageUrl,
      sort_order: 0,
      store_id: "",
      store_slug: product.storeSlug,
      width_px: null,
    },
  ];
}

function ProductHighlights() {
  const highlights = [
    ["Blue eggs", "Beautiful blue-green egg layers"],
    ["Friendly temperament", "Curious, gentle, and great for families"],
    ["Good layers", "Steady production of blue eggs"],
    ["Healthy birds", "Raised with care in small flocks"],
  ];

  return (
    <section className="grid gap-3 rounded-xl border border-[#ded7c8] bg-[#fffdf8] p-4 sm:grid-cols-2">
      {highlights.map(([title, text]) => (
        <div className="py-2" key={title}>
          <p className="font-semibold text-stone-950">{title}</p>
          <p className="mt-1 text-sm leading-6 text-stone-700">{text}</p>
        </div>
      ))}
    </section>
  );
}

function productSubtitle(product: StorefrontProduct) {
  return [
    product.pricingLabel || "Choose an option",
    product.optionsCount === 1
      ? "1 purchase option"
      : `${product.optionsCount} purchase options`,
    product.availabilityLabel,
  ].join(" - ");
}

function isHatchingEggItem(item: { batch_type: string | null; inventory_type: string }) {
  return item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs";
}

function isLivePoultryItem(item: { batch_type: string | null; inventory_type: string }) {
  return !isHatchingEggItem(item);
}
