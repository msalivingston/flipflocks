import Link from "next/link";
import Image from "next/image";
import { StorefrontHeaderCartLink } from "./storefront-header-cart-link";
import {
  StoreLogo,
  StorefrontGlyph,
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
  const theme = {
    fontPair: store.storefront_font_pair,
    headingColor: store.storefront_heading_color,
    textColor: store.storefront_text_color,
    topMenuColor: store.storefront_top_menu_color,
  };

  return (
    <StorefrontShell theme={theme}>
      <StorefrontHeader store={store} />
      {children}
      <StorefrontFooter categories={categories} store={store} />
    </StorefrontShell>
  );
}

export function StorefrontHeader({ store }: { store: StorefrontHome }) {
  return (
    <header className="storefront-top-menu border-b border-[#e7e0d2] bg-white">
      <div className="mx-auto grid max-w-[70rem] gap-3 px-5 py-2.5 sm:px-7 lg:min-h-[6rem] lg:grid-cols-[minmax(24rem,1fr)_auto_auto] lg:items-center">
        <Link
          className="flex min-w-0 items-center gap-4 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
          href={`/store/${store.store_slug}`}
        >
          <StoreLogo store={store} size="lg" />
          <div className="min-w-0 max-w-[24rem] sm:max-w-[32rem] lg:max-w-[34rem]">
            <p
              className={cx(
                storefrontSerifClass,
                "storefront-heading-color text-xl font-normal leading-tight text-[#073f1e] sm:text-2xl lg:text-[1.625rem]",
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
          <Link href={`/store/${store.store_slug}/policies`}>
            Pickup & Policies
          </Link>
        </nav>

        <div className="flex items-center gap-1.5 lg:ml-4 lg:justify-end xl:ml-6">
          <Link
            aria-label="Search listings"
            className="storefront-primary-color inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 lg:h-11 lg:w-11"
            href={`/store/${store.store_slug}#storefront-search`}
          >
            <StorefrontGlyph
              className="h-6 w-6 lg:h-7 lg:w-7"
              src="/glyphs/looking-glass.png"
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
      <div className="storefront-primary-color mx-auto flex max-w-[70rem] gap-4 overflow-x-auto px-5 py-2.5 text-sm text-[#083f1e] sm:px-7 lg:justify-start">
        {items.map((item, index) => (
          <div className="flex shrink-0 items-center gap-2.5" key={item.label}>
            <StorefrontGlyph className="h-[18px] w-[18px]" src={item.glyph} />
            <span className="storefront-primary-color font-medium text-[#073f1e]">
              {item.label}
            </span>
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
  const shopLinks = getStorefrontFooterShopLinks(store.store_slug, categories);

  return (
    <footer className="relative overflow-hidden border-t border-[#e4dccb] bg-[#fbf6ec]">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-14 h-[10rem] bg-[length:90rem_auto] bg-bottom bg-center bg-no-repeat opacity-75"
        style={{
          backgroundImage:
            "url('/storefront-heroes/footer-fence-line.png')",
        }}
      />
      <div className="relative mx-auto max-w-[70rem] px-5 py-5 sm:px-7 lg:py-7">
        <div className="storefront-text-color grid gap-7 text-sm text-[#1f2f37] sm:grid-cols-2 lg:grid-cols-[1.45fr_0.9fr_1fr_1fr] lg:gap-10">
          <div>
            <p
              className={cx(
                storefrontSerifClass,
                "storefront-heading-color max-w-xs text-3xl font-normal leading-[1.05] text-[#073f1e]",
              )}
            >
              {store.store_name}
            </p>
            <div className="mt-4">
              <FooterContactLine glyph="/glyphs/map-pin.png">
                <span>{formatLocation(store)}</span>
              </FooterContactLine>
            </div>
          </div>

          <FooterColumn title="Shop">
            {shopLinks.map((link) => (
              <Link href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </FooterColumn>

          <FooterColumn title="Quick Links">
            <Link href={`/store/${store.store_slug}/about`}>About</Link>
            <Link href={`/store/${store.store_slug}/policies`}>
              Pickup & Policies
            </Link>
          </FooterColumn>

          <FooterColumn title="Contact">
            {store.public_phone ? (
              <FooterContactLine glyph="/glyphs/phone.png">
                <a href={`tel:${store.public_phone}`}>{store.public_phone}</a>
              </FooterContactLine>
            ) : null}
            {!store.public_phone && store.public_email ? (
              <FooterContactLine glyph="/glyphs/envelope.png">
                <a href={`mailto:${store.public_email}`}>{store.public_email}</a>
              </FooterContactLine>
            ) : null}
            {!store.public_phone && !store.public_email ? (
              <p className="leading-7">Seller contact follows after checkout.</p>
            ) : null}
          </FooterColumn>
        </div>

        <div className="relative mt-5 border-t border-[#d5cbb9] pt-3">
          <div className="storefront-text-color flex items-center justify-center gap-3 text-sm font-medium text-[#1f2f37]">
            <span>Powered by</span>
            <a
              className="rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
              href="https://www.flockfront.com/"
            >
              <Image
                alt="FlockFront"
                className="h-8 w-auto object-contain"
                height={40}
                src="/landing-page/flockfront-logo-transparent.png"
                unoptimized
                width={180}
              />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div>
      <p
        className={cx(
          storefrontSerifClass,
          "storefront-heading-color text-xl font-normal leading-tight text-[#073f1e]",
        )}
      >
        {title}
      </p>
      <div className="mt-3 grid gap-2 leading-6 text-[#1f2f37]">{children}</div>
    </div>
  );
}

function FooterContactLine({
  children,
  glyph,
}: {
  children: React.ReactNode;
  glyph: string;
}) {
  return (
    <p className="flex min-w-0 items-center gap-3 leading-6">
      <StorefrontGlyph className="storefront-primary-color h-6 w-6 opacity-80" src={glyph} />
      <span className="min-w-0 break-words">{children}</span>
    </p>
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

