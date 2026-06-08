import Link from "next/link";
import {
  AvailabilityBadge,
  EmptyStorefront,
  HeroImage,
  ListingPhoto,
  StoreLogo,
  StorefrontButton,
  StorefrontContainer,
  StorefrontEyebrow,
  StorefrontFooter,
  StorefrontNav,
  StorefrontPage,
  StorefrontSection,
  StorefrontSectionHeader,
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

export default async function StorefrontHomePage({
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
  const heroTitle = store.store_tagline || "Available poultry and farm products";

  return (
    <StorefrontShell>
      <StorefrontNav store={store} />

      <header className="overflow-hidden border-b border-[#e4dccc] bg-[#fffdf8]">
        <StorefrontContainer className="grid min-h-[34rem] gap-8 py-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div className="relative z-10 grid gap-6">
            <div className="flex items-center gap-4">
              <StoreLogo store={store} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#24512f]">
                  Seller storefront
                </p>
                <h1 className="mt-1 text-4xl font-semibold leading-tight text-stone-950 sm:text-5xl">
                  {store.store_name}
                </h1>
              </div>
            </div>
            <div>
              <p className="max-w-2xl text-4xl font-semibold leading-tight text-stone-950 sm:text-5xl">
                {heroTitle}
              </p>
              <p className="mt-5 max-w-xl text-base leading-8 text-stone-700">
                {aboutPreview}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <StorefrontButton href="#available-products">
                Shop available birds
              </StorefrontButton>
              <StorefrontButton
                href={`/store/${store.store_slug}/policies`}
                variant="secondary"
              >
                Pickup details
              </StorefrontButton>
            </div>
            <div className="flex flex-wrap gap-3 text-sm font-semibold text-[#24512f]">
              <span className="rounded-full bg-[#eef4e8] px-4 py-2">
                {formatLocation(store)}
              </span>
              <span className="rounded-full bg-[#fff4df] px-4 py-2">
                {products.length || 0} products
              </span>
              <span className="rounded-full bg-[#eef4e8] px-4 py-2">
                {store.total_quantity_available > 0
                  ? `${store.total_quantity_available} available`
                  : "Availability coming soon"}
              </span>
            </div>
          </div>

          <div className="relative min-h-80 overflow-hidden rounded-xl border border-[#d8cebd] bg-[#f2eadb] shadow-[0_24px_70px_rgba(46,35,20,0.16)]">
            <div className="absolute inset-0">
              <HeroImage
                alt={store.hero_image_alt_text || `${store.store_name} farm photo`}
                src={store.hero_image_url}
              />
            </div>
            <div className="absolute inset-0 bg-gradient-to-r from-black/30 via-black/5 to-transparent" />
            <div className="absolute bottom-5 left-5 right-5 rounded-lg border border-white/30 bg-white/88 p-4 shadow-lg backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#24512f]">
                Current availability
              </p>
              <p className="mt-1 text-lg font-semibold text-stone-950">
                Browse breeds, ages, dates, and purchase options.
              </p>
            </div>
          </div>
        </StorefrontContainer>
      </header>

      <StorefrontPage className="gap-10">
        <StorefrontSection id="available-products">
          <StorefrontSectionHeader
            eyebrow="Browse available birds"
            title="Shop by breed or product"
          >
            <p>
              Choose a breed or product to compare available ages, dates, and
              purchase options.
            </p>
          </StorefrontSectionHeader>

          {products.length === 0 ? (
            <EmptyStorefront
              title="No available products yet"
              description="This seller storefront does not have visible products right now."
            />
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <ProductCard key={product.productId} product={product} />
              ))}
            </div>
          )}
        </StorefrontSection>

        <section className="overflow-hidden rounded-xl border border-[#ded7c8] bg-white shadow-[0_18px_55px_rgba(46,35,20,0.08)] lg:grid lg:grid-cols-2">
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
      </StorefrontPage>

      <StorefrontFooter store={store} />
    </StorefrontShell>
  );
}

function ProductCard({ product }: { product: StorefrontProduct }) {
  return (
    <article className="group overflow-hidden rounded-xl border border-[#ded7c8] bg-white shadow-[0_12px_35px_rgba(46,35,20,0.07)] transition hover:-translate-y-1 hover:border-[#bfcfb6] hover:shadow-[0_20px_50px_rgba(46,35,20,0.12)]">
      <Link
        className="block h-full focus:outline-none focus:ring-2 focus:ring-emerald-700"
        href={`/store/${product.storeSlug}/products/${product.productId}`}
      >
        <div className="relative">
          <ListingPhoto
            alt={product.imageAlt || product.name}
            src={product.imageUrl}
          />
          <div className="absolute left-3 top-3">
            <AvailabilityBadge
              code={product.availabilityCode}
              label={product.availabilityLabel}
            />
          </div>
        </div>
        <div className="grid gap-4 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">
              {product.speciesName}
            </p>
            <h3 className="mt-1 text-xl font-semibold leading-tight text-stone-950">
              {product.name}
            </h3>
          </div>

          <p className="line-clamp-2 min-h-12 text-sm leading-6 text-stone-600">
            {product.description || "Details and available options are listed inside."}
          </p>

          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-[#24512f]">
                {product.pricingLabel || "See options"}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {product.quantityLabel} -{" "}
                {product.optionsCount === 1
                  ? "1 option"
                  : `${product.optionsCount} options`}
              </p>
            </div>
            <span className="rounded-md border border-[#cfc7b8] px-3 py-2 text-sm font-semibold text-stone-800 transition group-hover:border-[#24512f] group-hover:bg-[#eef4e8] group-hover:text-[#24512f]">
              View options
            </span>
          </div>
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
    <div className="grid gap-4 border-b border-[#eee5d6] p-6 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <StorefrontEyebrow>{eyebrow}</StorefrontEyebrow>
      <h2 className="mt-2 text-xl font-semibold text-stone-950">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-stone-600">{children}</p>
      <StorefrontButton className="mt-4 min-h-10" href={actionHref}>
        {actionLabel}
      </StorefrontButton>
    </div>
  );
}
