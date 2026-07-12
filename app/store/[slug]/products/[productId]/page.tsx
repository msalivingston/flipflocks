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
import { storefrontSerifClass } from "../../storefront-fonts";
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

  const livePoultryProducts = groupInventoryByProduct(
    inventoryResult.data.filter(isLivePoultryItem),
  );
  const hatchingEggProducts = groupInventoryByProduct(
    inventoryResult.data.filter(isHatchingEggItem),
  );
  const hatchingEggProduct = findProduct(hatchingEggProducts, productId);
  const product =
    findProduct(livePoultryProducts, productId) ?? hatchingEggProduct;
  const isHatchingEggProduct = product?.productId === hatchingEggProduct?.productId;
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
      <StorefrontPage className="gap-7">
        <nav className="flex flex-wrap items-center gap-2 text-sm text-stone-700">
          <Link href={`/store/${store.store_slug}`}>Shop</Link>
          <span>/</span>
          <Link href={`/store/${store.store_slug}#shop-listings`}>
            {isHatchingEggProduct ? "Hatching Eggs" : "Live Birds"}
          </Link>
          <span>/</span>
          <span>{product.speciesName}</span>
          <span>/</span>
          <span className="text-stone-950">{product.name}</span>
        </nav>

        <section className="grid gap-8 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)] lg:items-start">
          <div className="grid max-w-[28rem] gap-3 lg:max-w-none">
            <ProductGallery
              fallbackAlt={product.imageAlt || product.name}
              fallbackSrc={product.imageUrl}
              gallery={gallery}
            />
          </div>

          <section className="grid gap-5 lg:pt-1">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#073f1e]">
                {product.speciesName}
              </p>
              <h1
                className={cx(
                  storefrontSerifClass,
                  "mt-4 text-4xl font-bold leading-tight text-stone-950",
                )}
              >
                {product.name}
              </h1>
            </div>

            <p className="max-w-2xl whitespace-pre-line text-base leading-7 text-stone-700">
              {formatProductDescription(product.description) ||
                "This seller has not added a breed description yet. Current purchase options are listed below."}
            </p>

            <div className="flex flex-wrap items-center gap-3 text-base text-stone-800">
              <AvailabilityBadge
                code={product.availabilityCode}
                label={formatProductAvailabilityLabel(product.availabilityCode)}
              />
              <p>
                <span className="font-semibold text-stone-950">
                  {product.totalQuantityAvailable}
                </span>{" "}
                {formatProductQuantityUnit(product.totalQuantityAvailable, isHatchingEggProduct)}{" "}
                available{formatProductPriceSummary(product.pricingLabel)}.
              </p>
            </div>

            <ProductCharacteristics product={product} />
          </section>
        </section>

        <ProductOrderOptions product={product} />
      </StorefrontPage>
    </StorefrontChrome>
  );
}

function ProductCharacteristics({ product }: { product: StorefrontProduct }) {
  const facts = [
    ["Purpose", product.purpose || "Not listed"],
    ["Egg Color", product.eggColor || "Not listed"],
    ["Egg Production", product.annualEggProduction || "Not listed"],
  ];

  return (
    <dl className="grid max-w-2xl border-y border-[#ded7c8] py-4 text-sm sm:grid-cols-3">
      {facts.map(([label, value], index) => (
        <div
          className={cx(
            "py-2 sm:px-6 sm:py-0",
            index === 0 ? "sm:pl-0" : "border-t border-[#e7decd] sm:border-l sm:border-t-0",
          )}
          key={label}
        >
          <dt className="font-semibold text-stone-950">{label}</dt>
          <dd className="mt-1 text-stone-700">{value}</dd>
        </div>
      ))}
    </dl>
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

function formatProductQuantityUnit(quantity: number, isHatchingEggProduct: boolean) {
  if (isHatchingEggProduct) return quantity === 1 ? "egg" : "eggs";

  return quantity === 1 ? "bird" : "birds";
}

function formatProductAvailabilityLabel(
  code: StorefrontProduct["availabilityCode"],
) {
  if (code === "ready_now") return "Available";
  if (code === "reserve_now") return "Available later";
  if (code === "mixed") return "Multiple dates";
  return "Sold out";
}

function formatProductPriceSummary(pricingLabel: string | null) {
  if (!pricingLabel) return "";

  const label = pricingLabel.startsWith("From ")
    ? pricingLabel.replace("From ", "from ")
    : pricingLabel;

  return ` at ${label} each`;
}

function formatProductDescription(description: string | null) {
  const trimmed = description?.trim();

  if (!trimmed || /^minimum order\s*:/i.test(trimmed)) return null;

  return trimmed.replace(/(?:^|\n)\s*minimum order\s*:[^\n]+/gi, "").trim();
}

function isHatchingEggItem(item: { batch_type: string | null; inventory_type: string }) {
  return item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs";
}

function isLivePoultryItem(item: { batch_type: string | null; inventory_type: string }) {
  return !isHatchingEggItem(item);
}
