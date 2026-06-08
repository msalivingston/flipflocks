import Image from "next/image";
import Link from "next/link";
import {
  AvailabilityBadge,
  EmptyStorefront,
  InfoPanel,
  ListingPhoto,
  StorefrontCard,
  StorefrontFooter,
  StorefrontMediaFrame,
  StorefrontNav,
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
  loadStoreGallery,
  loadStorefrontHome,
  loadStorefrontInventory,
} from "../../storefront-data";
import { ProductOrderOptions } from "./product-order-options";

export default async function StorefrontProductPage({
  params,
}: {
  params: Promise<{ productId: string; slug: string }>;
}) {
  const { productId, slug } = await params;

  const [homeResult, inventoryResult, galleryResult] = await Promise.all([
    loadStorefrontHome(slug),
    loadStorefrontInventory(slug),
    loadStoreGallery(slug, {
      entityId: productId,
      entityType: "seller_breed_profile",
      limit: 8,
    }),
  ]);
  const error = homeResult.error ?? inventoryResult.error ?? galleryResult.error;

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

  if (!product) {
    return (
      <StorefrontShell>
        <StorefrontNav store={store} />
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="Product not found"
            description="This breed or product may no longer be visible."
          />
        </StorefrontPage>
        <StorefrontFooter store={store} />
      </StorefrontShell>
    );
  }

  const gallery = buildProductGallery(product, galleryResult.data);

  return (
    <StorefrontShell>
      <StorefrontNav store={store} />

      <StorefrontPage className="gap-7">
        <Link
          className="text-sm font-semibold text-emerald-800 hover:text-emerald-950"
          href={`/store/${store.store_slug}`}
        >
          Back to {store.store_name}
        </Link>

        <section className="grid gap-7 lg:grid-cols-[minmax(0,1.06fr)_24rem] lg:items-start">
          <div className="grid gap-5">
            <StorefrontCard className="overflow-hidden p-0">
              <ProductGallery
                fallbackAlt={product.imageAlt || product.name}
                fallbackSrc={product.imageUrl}
                gallery={gallery}
              />
            </StorefrontCard>

            <StorefrontCard className="grid gap-5 p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
                    {product.speciesName}
                  </p>
                  <h1 className="mt-2 text-4xl font-semibold leading-tight text-stone-950">
                    {product.name}
                  </h1>
                  <p className="mt-3 text-xl font-semibold text-[#24512f]">
                    {product.pricingLabel || "Choose an option"}
                  </p>
                </div>
                <AvailabilityBadge
                  code={product.availabilityCode}
                  label={product.availabilityLabel}
                />
              </div>

              <p className="max-w-3xl whitespace-pre-line text-base leading-8 text-stone-700">
                {product.description ||
                  "This seller has not added a long description yet. Current purchase options are listed below."}
              </p>

              <div className="grid gap-3 rounded-lg bg-[#fbf7ef] p-4 text-sm sm:grid-cols-3">
                <ProductSummary label="Available" value={product.quantityLabel} />
                <ProductSummary
                  label="Options"
                  value={
                    product.optionsCount === 1
                      ? "1 purchase option"
                      : `${product.optionsCount} purchase options`
                  }
                />
                <ProductSummary
                  label="Next"
                  value={
                    product.nextAvailableDate
                      ? formatDate(product.nextAvailableDate)
                      : "Check back soon"
                  }
                />
              </div>
            </StorefrontCard>
          </div>

          <aside className="grid h-fit gap-4 lg:sticky lg:top-28">
            <ProductOrderOptions product={product} />
            <InfoPanel title="Pickup">
              <p>{store.pickup_instructions || "Pickup details coming soon."}</p>
              {store.pickup_policy ? <p>{store.pickup_policy}</p> : null}
            </InfoPanel>
            <InfoPanel title="Questions">
              {store.public_email ? <p>Email: {store.public_email}</p> : null}
              {store.public_phone ? <p>Phone: {store.public_phone}</p> : null}
              {!store.public_email && !store.public_phone ? (
                <p>The seller will follow up after your order is placed.</p>
              ) : null}
            </InfoPanel>
          </aside>
        </section>
      </StorefrontPage>

      <StorefrontFooter store={store} />
    </StorefrontShell>
  );
}

function ProductSummary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 font-semibold text-stone-950">{value}</p>
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
    return <ListingPhoto alt={fallbackAlt} src={fallbackSrc} />;
  }

  return (
    <StorefrontMediaFrame className="grid gap-2 rounded-none p-2">
      <Image
        alt={featured.alt_text || fallbackAlt}
        className="aspect-[4/3] w-full rounded-md object-cover"
        height={720}
        src={toPublicImageUrl(featured.public_url)}
        unoptimized
        width={960}
      />
      {rest.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {rest.slice(0, 3).map((image) => (
            <Image
              alt={image.alt_text || fallbackAlt}
              className="aspect-[4/3] w-full rounded-md object-cover"
              height={240}
              key={`${image.entity_type}-${image.public_url}`}
              src={toPublicImageUrl(image.public_url)}
              unoptimized
              width={320}
            />
          ))}
        </div>
      ) : null}
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
