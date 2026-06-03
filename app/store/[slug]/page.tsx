import Link from "next/link";
import {
  EmptyStorefront,
  Fact,
  HeroImage,
  ListingPhoto,
  StoreLogo,
  StorefrontFooter,
  StorefrontNav,
  StorefrontShell,
  formatLocation,
} from "./storefront-ui";
import {
  StorefrontProduct,
  groupInventoryByProduct,
  loadStorefrontHome,
  loadStorefrontInventory,
  previewText,
} from "./storefront-data";

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [homeResult, inventoryResult] = await Promise.all([
    loadStorefrontHome(slug),
    loadStorefrontInventory(slug),
  ]);
  const error = homeResult.error ?? inventoryResult.error;

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

  const products = groupInventoryByProduct(inventoryResult.data);
  const aboutPreview = previewText(
    store.about_text,
    `${store.store_name} shares current availability, pickup details, and farm updates here.`,
  );
  const pickupPreview = previewText(
    store.pickup_instructions || store.pickup_policy,
    "Pickup details will be confirmed after your order is placed.",
  );

  return (
    <StorefrontShell>
      <StorefrontNav store={store} />

      <header className="bg-white">
        <div className="relative">
          <div className="absolute inset-0">
            <HeroImage
              alt={store.hero_image_alt_text || `${store.store_name} farm photo`}
              src={store.hero_image_url}
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-black/10" />
          <div className="relative mx-auto flex min-h-72 max-w-6xl items-end px-5 py-8 sm:min-h-96 sm:px-7">
            <div className="max-w-3xl text-white">
              <div className="mb-5 flex items-center gap-4">
                <StoreLogo store={store} />
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.12em] text-white/80">
                    Seller storefront
                  </p>
                  <h1 className="mt-1 text-4xl font-semibold sm:text-5xl">
                    {store.store_name}
                  </h1>
                </div>
              </div>
              {store.store_tagline ? (
                <p className="max-w-2xl text-lg leading-8 text-white/90">
                  {store.store_tagline}
                </p>
              ) : null}
              <p className="mt-3 text-sm font-semibold text-white/80">
                {formatLocation(store)}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-5 py-8 sm:px-7">
        <section className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-3">
          <Fact
            label="Available"
            value={
              store.total_quantity_available > 0
                ? `${store.total_quantity_available} birds`
                : "Check back soon"
            }
          />
          <Fact
            label="Products"
            value={
              products.length === 1
                ? "1 breed or product"
                : `${products.length} breeds or products`
            }
          />
          <Fact
            label="Location"
            value={formatLocation(store)}
          />
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
                Browse available birds
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-stone-950">
                Shop by breed or product
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-stone-600">
              Choose a breed or product to compare available ages, dates, and
              purchase options.
            </p>
          </div>

          {products.length === 0 ? (
            <EmptyStorefront
              title="No available products yet"
              description="This seller storefront does not have visible products right now."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <ProductCard key={product.productId} product={product} />
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <PreviewPanel
            actionHref={`/store/${store.store_slug}/about`}
            actionLabel="Read about the farm"
            eyebrow="About"
            title={`About ${store.store_name}`}
          >
            {aboutPreview}
          </PreviewPanel>
          <PreviewPanel
            actionHref={`/store/${store.store_slug}/policies`}
            actionLabel="View pickup details"
            eyebrow="Pickup"
            title="Pickup and policies"
          >
            {pickupPreview}
          </PreviewPanel>
        </section>
      </main>

      <StorefrontFooter store={store} />
    </StorefrontShell>
  );
}

function ProductCard({ product }: { product: StorefrontProduct }) {
  return (
    <article className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
      <Link
        className="block h-full focus:outline-none focus:ring-2 focus:ring-emerald-700"
        href={`/store/${product.storeSlug}/products/${product.productId}`}
      >
        <ListingPhoto
          alt={product.imageAlt || product.name}
          src={product.imageUrl}
        />
        <div className="grid gap-4 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">
              {product.speciesName}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-stone-950">
              {product.name}
            </h3>
          </div>

          <p className="line-clamp-3 min-h-16 text-sm leading-6 text-stone-600">
            {product.description || "Details and available options are listed inside."}
          </p>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Quantity" value={product.quantityLabel} />
            <Fact label="Availability" value={product.availabilityLabel} />
            <Fact
              label="Options"
              value={
                product.optionsCount === 1
                  ? "1 option"
                  : `${product.optionsCount} options`
              }
            />
            <Fact label="Price" value={product.pricingLabel || "See options"} />
          </dl>
        </div>
      </Link>
    </article>
  );
}

function PreviewPanel({
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
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-xl font-semibold text-stone-950">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-stone-600">{children}</p>
      <Link
        className="mt-4 inline-flex min-h-10 items-center rounded-md bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900"
        href={actionHref}
      >
        {actionLabel}
      </Link>
    </section>
  );
}
