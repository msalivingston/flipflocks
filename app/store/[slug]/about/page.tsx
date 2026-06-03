import Image from "next/image";
import {
  EmptyStorefront,
  Fact,
  StorefrontFooter,
  StorefrontNav,
  StorefrontShell,
  formatLocation,
  toPublicImageUrl,
} from "../storefront-ui";
import {
  StorefrontMedia,
  loadStoreGallery,
  loadStorefrontHome,
} from "../storefront-data";

export default async function StorefrontAboutPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [homeResult, galleryResult] = await Promise.all([
    loadStorefrontHome(slug),
    loadStoreGallery(slug, {
      entityType: "store",
      limit: 8,
    }),
  ]);
  const error = homeResult.error ?? galleryResult.error;

  if (error) {
    return (
      <StorefrontShell>
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="This page could not load"
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

  const photos = galleryResult.data.filter(
    (image) => image.display_context !== "logo",
  );
  const aboutText =
    store.about_text?.trim() ||
    `${store.store_name} has not added a full story yet. Current availability and pickup information are available throughout this storefront.`;

  return (
    <StorefrontShell>
      <StorefrontNav store={store} />

      <main className="mx-auto grid max-w-6xl gap-7 px-5 py-7 sm:px-7">
        <section className="grid gap-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm lg:grid-cols-[1fr_20rem]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
              About the farm
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-stone-950">
              {store.store_name}
            </h1>
            {store.store_tagline ? (
              <p className="mt-3 text-lg leading-8 text-stone-700">
                {store.store_tagline}
              </p>
            ) : null}
            <p className="mt-5 whitespace-pre-line text-sm leading-7 text-stone-700">
              {aboutText}
            </p>
          </div>

          <aside className="grid h-fit gap-4 rounded-lg bg-stone-50 p-4">
            <Fact label="Location" value={formatLocation(store)} />
            <Fact
              label="Pickup region"
              value={
                store.pickup_instructions
                  ? "Details available"
                  : "Shared after order"
              }
            />
            {store.npip_number ? (
              <Fact label="NPIP" value={store.npip_number} />
            ) : null}
          </aside>
        </section>

        {photos.length > 0 ? (
          <PhotoStrip photos={photos} storeName={store.store_name} />
        ) : (
          <section className="rounded-lg border border-dashed border-stone-300 bg-white px-5 py-8 text-center">
            <h2 className="text-xl font-semibold text-stone-950">
              Farm photos coming soon
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-stone-600">
              This storefront still works without a full gallery. Product photos
              and pickup details will show where available.
            </p>
          </section>
        )}
      </main>

      <StorefrontFooter store={store} />
    </StorefrontShell>
  );
}

function PhotoStrip({
  photos,
  storeName,
}: {
  photos: StorefrontMedia[];
  storeName: string;
}) {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-stone-950">
        Around the farm
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {photos.slice(0, 3).map((photo) => (
          <Image
            alt={photo.alt_text || `${storeName} farm photo`}
            className="aspect-[4/3] w-full rounded-lg object-cover shadow-sm"
            height={360}
            key={`${photo.display_context}-${photo.public_url}`}
            src={toPublicImageUrl(photo.public_url)}
            unoptimized
            width={480}
          />
        ))}
      </div>
    </section>
  );
}
