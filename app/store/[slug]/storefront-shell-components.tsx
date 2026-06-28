import Link from "next/link";
import { MapPin, Search, User, type LucideIcon } from "lucide-react";
import { StorefrontHeaderCartLink } from "./storefront-header-cart-link";
import {
  StorefrontCategorySymbol,
  type StorefrontCategorySymbolName,
} from "./storefront-category-symbols";
import {
  StoreLogo,
  StorefrontShell,
  formatLocation,
} from "./storefront-ui";
import type { StorefrontHome } from "./storefront-data";

export type StorefrontCategoryAvailability = {
  equipment: boolean;
  hatchingEggs: boolean;
  livePoultry: boolean;
  processedPoultry: boolean;
};

type TrustStripItem = {
  label: string;
} & (
  | { Icon: LucideIcon; symbol?: never }
  | { Icon?: never; symbol: StorefrontCategorySymbolName }
);

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
      <StorefrontTrustStrip categories={categories} store={store} />
      {children}
      <StorefrontFooter store={store} />
    </StorefrontShell>
  );
}

export function StorefrontHeader({ store }: { store: StorefrontHome }) {
  return (
    <header className="border-b border-[#e7e0d2] bg-white">
      <div className="mx-auto grid max-w-[70rem] gap-4 px-5 py-4 sm:px-7 lg:min-h-24 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
        <Link
          className="flex min-w-0 items-center gap-4 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
          href={`/store/${store.store_slug}`}
        >
          <StoreLogo store={store} />
          <div className="min-w-0">
            <p className="truncate text-3xl font-semibold leading-none text-[#073f1e]">
              {store.store_name}
            </p>
            <p className="mt-1 text-sm font-semibold uppercase tracking-[0.22em] text-stone-700">
              {formatLocation(store)}
            </p>
          </div>
        </Link>

        <nav className="flex flex-wrap items-center gap-5 text-sm font-semibold text-stone-950 lg:justify-center lg:gap-12">
          <Link href={`/store/${store.store_slug}`}>All Listings</Link>
          <Link href={`/store/${store.store_slug}/about`}>About</Link>
          <Link href={`/store/${store.store_slug}/policies`}>Contact</Link>
        </nav>

        <div className="flex items-center gap-3 lg:justify-end">
          <Link
            aria-label="Search listings"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            href={`/store/${store.store_slug}#shop-listings`}
          >
            <Search aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
          </Link>
          <Link
            aria-label="Account"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            href="/sign-in"
          >
            <User aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
          </Link>
          <StorefrontHeaderCartLink storeSlug={store.store_slug} />
        </div>
      </div>
    </header>
  );
}

export function StorefrontTrustStrip({
  categories,
  store,
}: {
  categories: StorefrontCategoryAvailability;
  store: StorefrontHome;
}) {
  const items = buildTrustItems({
    categories,
    location: formatLocation(store),
    showPickup: Boolean(store.pickup_instructions || store.pickup_policy),
  });

  if (items.length === 0) return null;

  return (
    <section className="border-b border-[#e5ded0] bg-[#f4f0e8]">
      <div className="mx-auto flex max-w-[70rem] gap-5 overflow-x-auto px-5 py-3 text-sm text-[#083f1e] sm:px-7 lg:justify-center">
        {items.map((item, index) => (
          <div className="flex shrink-0 items-center gap-2.5" key={item.label}>
            {item.Icon ? (
              <item.Icon
                aria-hidden="true"
                className="h-[18px] w-[18px] shrink-0 text-[#073f1e]"
                strokeWidth={2}
              />
            ) : (
              <StorefrontCategorySymbol
                className="h-[18px] w-[18px] text-[#073f1e]"
                name={item.symbol}
              />
            )}
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

export function StorefrontFooter({ store }: { store: StorefrontHome }) {
  const socialLinks = getSocialLinks(store.social_url);

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
          <p className="font-serif text-lg font-semibold text-stone-950">Shop</p>
          <div className="mt-3 grid gap-2">
            <Link href={`/store/${store.store_slug}`}>Live Poultry</Link>
            <Link href={`/store/${store.store_slug}#shop-listings`}>
              Hatching Eggs
            </Link>
            <Link href={`/store/${store.store_slug}#shop-listings`}>
              Equipment & Supplies
            </Link>
            <Link href={`/store/${store.store_slug}#shop-listings`}>
              Processed Poultry
            </Link>
          </div>
        </div>
        <div>
          <p className="font-serif text-lg font-semibold text-stone-950">
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
          <p className="font-serif text-lg font-semibold text-stone-950">
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

function buildTrustItems({
  categories,
  location,
  showPickup,
}: {
  categories: StorefrontCategoryAvailability;
  location: string;
  showPickup: boolean;
}) {
  const items: TrustStripItem[] = [];

  if (showPickup) {
    items.push({
      Icon: MapPin,
      label: `Local pickup available in ${location}`,
    });
  }

  if (categories.livePoultry) {
    items.push({ label: "Live poultry", symbol: "poultry" });
  }
  if (categories.hatchingEggs) {
    items.push({ label: "Hatching eggs", symbol: "egg" });
  }
  if (categories.processedPoultry) {
    items.push({ label: "Processed poultry", symbol: "processed" });
  }
  if (categories.equipment) {
    items.push({ label: "Equipment & Supplies", symbol: "equipment" });
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
