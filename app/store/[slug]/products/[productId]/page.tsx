import Image from "next/image";
import Link from "next/link";
import {
  AvailabilityBadge,
  EmptyStorefront,
  Fact,
  InfoPanel,
  ListingPhoto,
  StorefrontFooter,
  StorefrontNav,
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
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="This product could not load"
            description="Please refresh the page or return to the storefront."
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

  const product = findProduct(
    groupInventoryByProduct(inventoryResult.data),
    productId,
  );

  if (!product) {
    return (
      <StorefrontShell>
        <StorefrontNav store={store} />
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="Product not found"
            description="This breed or product may no longer be visible."
          />
        </main>
        <StorefrontFooter store={store} />
      </StorefrontShell>
    );
  }

  const gallery = buildProductGallery(product, galleryResult.data);

  return (
    <StorefrontShell>
      <StorefrontNav store={store} />

      <main className="mx-auto grid max-w-6xl gap-7 px-5 py-7 sm:px-7">
        <Link
          className="text-sm font-semibold text-emerald-800 hover:text-emerald-950"
          href={`/store/${store.store_slug}`}
        >
          Back to {store.store_name}
        </Link>

        <section className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
            <ProductGallery
              fallbackAlt={product.imageAlt || product.name}
              fallbackSrc={product.imageUrl}
              gallery={gallery}
            />
            <div className="grid gap-5 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
                    {product.speciesName}
                  </p>
                  <h1 className="mt-2 text-3xl font-semibold text-stone-950">
                    {product.name}
                  </h1>
                </div>
                <AvailabilityBadge
                  code={product.availabilityCode}
                  label={product.availabilityLabel}
                />
              </div>

              <p className="whitespace-pre-line text-sm leading-7 text-stone-700">
                {product.description ||
                  "This seller has not added a long description yet. Current purchase options are listed below."}
              </p>

              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <Fact label="Quantity" value={product.quantityLabel} />
                <Fact
                  label="Options"
                  value={
                    product.optionsCount === 1
                      ? "1 option"
                      : `${product.optionsCount} options`
                  }
                />
                <Fact
                  label="Price"
                  value={product.pricingLabel || "See options"}
                />
                <Fact
                  label="Next available"
                  value={
                    product.nextAvailableDate
                      ? formatDate(product.nextAvailableDate)
                      : "Check back soon"
                  }
                />
              </dl>
            </div>
          </div>

          <aside className="grid h-fit gap-4">
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

        <ProductOrderOptions product={product} />
      </main>

      <StorefrontFooter store={store} />
    </StorefrontShell>
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
    <div className="grid gap-2 bg-stone-100 p-2">
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
    </div>
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
