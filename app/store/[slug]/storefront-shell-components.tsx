import Link from "next/link";
import Image from "next/image";
import { StorefrontHeaderCartLink } from "./storefront-header-cart-link";
import {
  StoreLogo,
  StorefrontShell,
  cx,
  formatLocation,
} from "./storefront-ui";
import type { StorefrontHome } from "./storefront-data";
import { storefrontSerifClass } from "./storefront-fonts";

export type StorefrontCategoryAvailability = {
  equipment: boolean;
  hatchingEggs: boolean;
  livePoultry: boolean;
  processedPoultry: boolean;
};

type TrustStripItem = {
  glyph: string;
  label: string;
};

export function StorefrontChrome({
  categories,
  children,
  store,
}: {
  categories: StorefrontCategoryAvailability;
  children: React.ReactNode;
  store: StorefrontHome;
}) {
  return (
    <StorefrontShell>
      <StorefrontHeader store={store} />
      {children}
      <StorefrontFooter categories={categories} store={store} />
    </StorefrontShell>
  );
}

export function StorefrontHeader({ store }: { store: StorefrontHome }) {
  return (
    <header className="border-b border-[#e7e0d2] bg-white">
      <div className="mx-auto grid max-w-[70rem] gap-3 px-5 py-2.5 sm:px-7 lg:min-h-[5.75rem] lg:grid-cols-[minmax(24rem,1fr)_auto_auto] lg:items-center">
        <Link
          className="flex min-w-0 items-center gap-4 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
          href={`/store/${store.store_slug}`}
        >
          <StoreLogo store={store} size="lg" />
          <div className="min-w-0 max-w-[24rem] sm:max-w-[32rem] lg:max-w-[34rem]">
            <p
              className={cx(
                storefrontSerifClass,
                "text-xl font-normal leading-tight text-[#073f1e] sm:text-2xl",
              )}
            >
              {store.store_name}
            </p>
            <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.16em] text-stone-600">
              {formatLocation(store)}
            </p>
          </div>
        </Link>

        <nav className="flex flex-wrap items-center justify-start gap-2 text-base font-semibold text-stone-950 lg:justify-end lg:gap-7 xl:gap-10">
          <Link href={`/store/${store.store_slug}#shop-listings`}>Shop</Link>
          <Link href={`/store/${store.store_slug}/about`}>About</Link>
          <Link href={`/store/${store.store_slug}/policies`}>Contact</Link>
        </nav>

        <div className="flex items-center gap-1.5 lg:ml-4 lg:justify-end xl:ml-6">
          <Link
            aria-label="Search listings"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            href={`/store/${store.store_slug}#storefront-search`}
          >
            <Image
              alt=""
              aria-hidden="true"
              className="h-6 w-6 object-contain"
              height={128}
              src="/glyphs/looking-glass.png"
              unoptimized
              width={128}
            />
          </Link>
          <Link
            aria-label="Account"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            href="/sign-in"
          >
            <Image
              alt=""
              aria-hidden="true"
              className="h-6 w-6 object-contain"
              height={128}
              src="/glyphs/person.png"
              unoptimized
              width={128}
            />
          </Link>
          <StorefrontHeaderCartLink storeSlug={store.store_slug} />
        </div>
      </div>
    </header>
  );
}

export function StorefrontTrustStrip({
  store,
}: {
  categories: StorefrontCategoryAvailability;
  store: StorefrontHome;
}) {
  const items = buildTrustItems({
    location: formatLocation(store),
    showPickup: Boolean(store.pickup_instructions || store.pickup_policy),
  });

  if (items.length === 0) return null;

  return (
    <section className="border-b border-[#e5ded0] bg-[#f4f0e8]">
      <div className="mx-auto flex max-w-[70rem] gap-4 overflow-x-auto px-5 py-2.5 text-sm text-[#083f1e] sm:px-7 lg:justify-start">
        {items.map((item, index) => (
          <div className="flex shrink-0 items-center gap-2.5" key={item.label}>
            <Image
              alt=""
              aria-hidden="true"
              className="h-[18px] w-[18px] shrink-0 object-contain"
              height={128}
              src={item.glyph}
              unoptimized
              width={128}
            />
            <span className="font-medium text-[#073f1e]">{item.label}</span>
            {index < items.length - 1 ? (
              <span className="ml-2 h-4 w-px bg-[#cfc5b6]" />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function StorefrontFooter({
  categories,
  store,
}: {
  categories: StorefrontCategoryAvailability;
  store: StorefrontHome;
}) {
  const socialLinks = getSocialLinks(store.social_url);
  const shopLinks = getStorefrontFooterShopLinks(store.store_slug, categories);

  return (
    <footer className="border-t border-[#e3e3df] bg-[#f7f7f4]">
      <div className="mx-auto grid max-w-[70rem] gap-9 px-5 py-10 text-sm text-stone-700 sm:grid-cols-2 sm:px-7 lg:grid-cols-[1.35fr_0.8fr_0.9fr_1fr]">
        <div>
          <p className="text-2xl font-semibold leading-none text-[#073f1e]">
            {store.store_name}
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.22em] text-stone-700">
            {formatLocation(store)}
          </p>
          <div className="mt-5 grid gap-2">
            {store.public_email ? <p>{store.public_email}</p> : null}
            {store.public_phone ? <p>{store.public_phone}</p> : null}
            {!store.public_email && !store.public_phone ? (
              <p>Seller contact follows after checkout.</p>
            ) : null}
          </div>
          {socialLinks.length > 0 ? (
            <div className="mt-5 flex items-center gap-3">
              {socialLinks.map((link) => (
                <a
                  aria-label={link.label}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#d5d5cf] bg-white text-sm font-bold text-stone-800 transition hover:border-[#073f1e] hover:text-[#073f1e]"
                  href={link.href}
                  key={link.label}
                  rel="noreferrer"
                  target="_blank"
                >
                  {link.mark}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <p
            className={cx(
              storefrontSerifClass,
              "text-lg font-bold text-stone-950",
            )}
          >
            Shop
          </p>
          <div className="mt-3 grid gap-2">
            {shopLinks.map((link) => (
              <Link href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <p
            className={cx(
              storefrontSerifClass,
              "text-lg font-bold text-stone-950",
            )}
          >
            Quick Links
          </p>
          <div className="mt-3 grid gap-2">
            <Link href={`/store/${store.store_slug}/about`}>About</Link>
            <Link href={`/store/${store.store_slug}/policies`}>Contact</Link>
            <Link href={`/store/${store.store_slug}/policies`}>
              Pickup & Delivery
            </Link>
          </div>
        </div>
        <div>
          <p
            className={cx(
              storefrontSerifClass,
              "text-lg font-bold text-stone-950",
            )}
          >
            Powered by FlipFlocks
          </p>
          <p className="mt-3 leading-6">
            Independent poultry storefronts for local pickup.
          </p>
        </div>
      </div>
    </footer>
  );
}

export function getStorefrontCategoryAvailability({
  equipmentCount,
  hatchingEggCount,
  livePoultryCount,
  processedPoultryCount,
}: {
  equipmentCount: number;
  hatchingEggCount: number;
  livePoultryCount: number;
  processedPoultryCount: number;
}): StorefrontCategoryAvailability {
  return {
    equipment: equipmentCount > 0,
    hatchingEggs: hatchingEggCount > 0,
    livePoultry: livePoultryCount > 0,
    processedPoultry: processedPoultryCount > 0,
  };
}

function getStorefrontFooterShopLinks(
  storeSlug: string,
  categories: StorefrontCategoryAvailability,
) {
  return [
    {
      enabled: categories.livePoultry,
      href: `/store/${storeSlug}#live-poultry-tab`,
      label: "Live Poultry",
    },
    {
      enabled: categories.hatchingEggs,
      href: `/store/${storeSlug}#hatching-eggs-tab`,
      label: "Hatching Eggs",
    },
    {
      enabled: categories.equipment,
      href: `/store/${storeSlug}#equipment-supplies-tab`,
      label: "Equipment & Supplies",
    },
    {
      enabled: categories.processedPoultry,
      href: `/store/${storeSlug}#processed-poultry-tab`,
      label: "Processed Poultry",
    },
  ].filter((link) => link.enabled);
}

function buildTrustItems({
  location,
  showPickup,
}: {
  location: string;
  showPickup: boolean;
}) {
  const items: TrustStripItem[] = [];

  if (showPickup) {
    items.push({
      glyph: "/glyphs/map-pin.png",
      label: `Local pickup available in ${location}`,
    });
  }

  return items;
}

function getSocialLinks(socialUrl: string | null) {
  if (!socialUrl) return [];

  const normalized = socialUrl.toLowerCase();

  if (normalized.includes("facebook.com")) {
    return [{ href: socialUrl, label: "Facebook", mark: "f" }];
  }

  if (normalized.includes("instagram.com")) {
    return [{ href: socialUrl, label: "Instagram", mark: "IG" }];
  }

  return [];
}
