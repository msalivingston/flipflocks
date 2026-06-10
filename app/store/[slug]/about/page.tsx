import Image from "next/image";
import {
  EmptyStorefront,
  Fact,
  StorefrontCard,
  StorefrontPage,
  StoreLogo,
  StorefrontShell,
  formatLocation,
  toPublicImageUrl,
} from "../storefront-ui";
import {
  StorefrontMedia,
  loadStoreGallery,
} from "../storefront-data";
import { loadStorefrontChrome } from "../storefront-chrome-data";
import { StorefrontChrome } from "../storefront-shell-components";

export default async function StorefrontAboutPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [chromeResult, galleryResult] = await Promise.all([
    loadStorefrontChrome(slug),
    loadStoreGallery(slug, {
      entityType: "store",
      limit: 8,
    }),
  ]);
  const error = chromeResult.error ?? galleryResult.error;

  if (error) {
    return (
      <StorefrontShell>
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="This page could not load"
            description="Please refresh the page or return to the storefront."
          />
        </StorefrontPage>
      </StorefrontShell>
    );
  }

  const store = chromeResult.store;

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

  const photos = galleryResult.data.filter(
    (image) => image.display_context !== "logo",
  );
  const aboutText =
    store.about_text?.trim() ||
    `${store.store_name} has not added a full story yet. Products and pickup information are available throughout this storefront.`;

  return (
    <StorefrontChrome categories={chromeResult.categories} store={store}>
      <StorefrontPage className="gap-7">
        <StorefrontCard className="grid gap-8 bg-[#fffdf8] p-6 lg:grid-cols-[1fr_20rem]">
          <div>
            <div className="flex items-center gap-4">
              <StoreLogo store={store} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
                  About the farm
                </p>
                <h1 className="mt-1 text-4xl font-semibold leading-tight text-stone-950">
                  {store.store_name}
                </h1>
              </div>
            </div>
            {store.store_tagline ? (
              <p className="mt-3 text-lg leading-8 text-stone-700">
                {store.store_tagline}
              </p>
            ) : null}
            <p className="mt-6 max-w-3xl whitespace-pre-line text-base leading-8 text-stone-700">
              {aboutText}
            </p>
          </div>

          <aside className="grid h-fit gap-4 rounded-lg border border-[#e7decd] bg-white p-4">
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
        </StorefrontCard>

        {photos.length > 0 ? (
          <PhotoStrip photos={photos} storeName={store.store_name} />
        ) : (
          <StorefrontCard className="border-dashed border-[#d8cebd] bg-[linear-gradient(135deg,#fffdf8,#eef4e8)] px-5 py-10 text-center">
            <h2 className="text-xl font-semibold text-stone-950">
              Farm photos coming soon
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-stone-600">
              This storefront still works without a full gallery. Product photos
              and pickup details will show where available.
            </p>
          </StorefrontCard>
        )}
      </StorefrontPage>
    </StorefrontChrome>
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
      <div className="grid gap-4 sm:grid-cols-3">
        {photos.slice(0, 3).map((photo) => (
          <Image
            alt={photo.alt_text || `${storeName} farm photo`}
            className="aspect-[4/3] w-full rounded-xl border border-[#ded7c8] object-cover"
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
