import Image from "next/image";
import {
  EmptyStorefront,
  StorefrontPage,
  StorefrontShell,
  cx,
  toPublicImageUrl,
} from "../storefront-ui";
import { loadStoreGallery } from "../storefront-data";
import { loadStorefrontChrome } from "../storefront-chrome-data";
import { storefrontSerifClass } from "../storefront-fonts";
import { StorefrontChrome } from "../storefront-shell-components";

const aboutAssets = {
  barn: "/about-page/barn-illustration-transparent.png",
  divider: "/about-page/hand-drawn-divider-transparent.png",
  hen: "/about-page/hen-silhouette-transparent.png",
  leaves: "/about-page/botanical-leaves-transparent.png",
  sprigLeft: "/about-page/quote-sprig-left-transparent.png",
  sprigRight: "/about-page/quote-sprig-right-transparent.png",
  tallPlant: "/about-page/tall-plant-transparent.png",
};

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
      limit: 4,
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

  const aboutPhoto =
    galleryResult.data.find((image) => image.display_context === "gallery") ??
    galleryResult.data.find((image) => image.display_context !== "logo") ??
    null;
  const paragraphs = getAboutParagraphs(
    store.about_text,
    `${store.store_name} is a local farm sharing current poultry and farm goods with nearby flock owners, homesteaders, and small farms.`,
  );
  const quote =
    store.hero_subheading?.trim() ||
    store.store_tagline?.trim() ||
    "Raised locally for backyard flock owners, homesteaders, and small farms.";
  const aboutHeading = store.store_tagline?.trim() || store.store_name;

  return (
    <StorefrontChrome categories={chromeResult.categories} store={store}>
      <main className="bg-[#fffaf0] text-[#2f2d26]">
        <div className="mx-auto grid max-w-[70rem] gap-4 px-5 py-7 sm:px-7 lg:gap-4 lg:py-8">
          <section className="relative flow-root">
            <div className="relative mb-6 min-h-[16rem] lg:float-right lg:mb-6 lg:ml-10 lg:w-[58%]">
              <Image
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute left-[-66px] bottom-0 z-10 hidden h-[33.3125rem] w-44 object-contain object-bottom opacity-70 lg:block xl:left-[-82px] xl:h-[38.5rem] xl:w-52"
                height={1536}
                src={aboutAssets.tallPlant}
                unoptimized
                width={1024}
              />
              {aboutPhoto ? (
                <Image
                  alt={aboutPhoto.alt_text || `${store.store_name} farm photo`}
                  className="mx-auto aspect-[1.58/1] w-full max-w-[calc(94%-35px)] rounded-lg object-cover shadow-sm"
                  height={640}
                  priority
                  src={toPublicImageUrl(aboutPhoto.public_url)}
                  unoptimized
                  width={928}
                />
              ) : (
                <div className="mx-auto flex aspect-[1.58/1] w-full max-w-[calc(94%-35px)] items-center justify-center rounded-lg border border-dashed border-[#d8cebd] bg-white/55 px-6 text-center text-sm font-semibold text-stone-500">
                  Farm photo coming soon
                </div>
              )}
            </div>
            <div className="relative pl-14 lg:pl-16">
              <div className="mb-2">
                <Image
                  alt=""
                  aria-hidden="true"
                  className="absolute -left-[9px] -top-6 h-16 w-20 object-contain opacity-80"
                  height={128}
                  src={aboutAssets.leaves}
                  unoptimized
                  width={128}
                />
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#596747]">
                  About the farm
                </p>
              </div>
              <h1
                className={cx(
                  storefrontSerifClass,
                  "mt-3 max-w-lg text-4xl font-normal leading-[1] text-[#34442f] sm:text-5xl",
                )}
              >
                {aboutHeading}
              </h1>
              <div className="relative mt-3 h-8 text-[#cbbd96]">
                <span className="absolute left-0 top-1/2 h-px w-60 max-w-[64%] -translate-y-1/2 bg-current" />
                <Image
                  alt=""
                  aria-hidden="true"
                  className="absolute left-[calc(16.25rem-10px)] top-1/2 h-14 w-14 -translate-y-1/2 object-contain opacity-80"
                  height={128}
                  src={aboutAssets.hen}
                  unoptimized
                  width={128}
                />
              </div>
              <div className="mt-3 space-y-3 text-base leading-[1.55] text-[#36342e]">
                {paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </div>
          </section>

          <DecorativeDivider />

          <section className="relative overflow-hidden rounded-lg border border-[#ece1c7] bg-[#f6f1df] px-5 py-3 shadow-sm sm:px-8">
            <Image
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute left-[calc(1.25rem+50px)] top-1/2 hidden h-28 w-44 -translate-y-1/2 object-contain opacity-55 sm:block"
              height={1024}
              src={aboutAssets.barn}
              unoptimized
              width={1536}
            />
            <div className="relative ml-auto flex max-w-[48rem] translate-x-0 items-center justify-center gap-0 sm:-translate-x-[14px]">
              <Image
                alt=""
                aria-hidden="true"
                className="-mr-[34px] hidden h-40 w-24 shrink-0 object-contain opacity-85 sm:block"
                height={128}
                src={aboutAssets.sprigLeft}
                unoptimized
                width={128}
              />
              <blockquote
                className={cx(
                  storefrontSerifClass,
                  "flex-1 text-center text-[1.375rem] font-normal leading-tight text-[#48583a] sm:text-[1.75rem]",
                )}
              >
                &ldquo;{quote}&rdquo;
              </blockquote>
              <Image
                alt=""
                aria-hidden="true"
                className="-ml-[34px] hidden h-40 w-24 shrink-0 object-contain opacity-85 sm:block"
                height={128}
                src={aboutAssets.sprigRight}
                unoptimized
                width={128}
              />
            </div>
          </section>
        </div>
      </main>
    </StorefrontChrome>
  );
}

function DecorativeDivider() {
  return (
    <div className="relative grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)] items-center py-0">
      <div className="relative h-6 overflow-hidden">
        <Image
          alt=""
          aria-hidden="true"
          className="h-full w-full scale-x-[-1] object-fill opacity-65"
          height={443}
          src={aboutAssets.divider}
          unoptimized
          width={3546}
        />
      </div>
      <div aria-hidden="true" />
      <div className="relative h-6 overflow-hidden">
        <Image
          alt=""
          aria-hidden="true"
          className="h-full w-full object-fill opacity-65"
          height={443}
          src={aboutAssets.divider}
          unoptimized
          width={3546}
        />
      </div>
      <span className="pointer-events-none absolute inset-x-0 top-1/2 z-10 mx-auto flex h-24 w-24 -translate-y-1/2 items-center justify-center">
        <Image
          alt=""
          aria-hidden="true"
          className="h-20 w-20 object-contain opacity-85"
          height={128}
          src={aboutAssets.hen}
          unoptimized
          width={128}
        />
      </span>
    </div>
  );
}

function getAboutParagraphs(value: string | null, fallback: string) {
  const source = value?.trim() || fallback;
  const paragraphs = source
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [fallback];

  return paragraphs;
}
