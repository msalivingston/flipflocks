import {
  House,
  MapPin,
  Search,
  ShoppingCart,
  User,
  type LucideIcon,
} from "lucide-react";
import {
  StorefrontCategorySymbol,
  type StorefrontCategorySymbolName,
} from "./storefront-category-symbols";
import {
  EmptyStorefront,
  HeroImage,
  StoreLogo,
  StorefrontButton,
  StorefrontEyebrow,
  StorefrontShell,
  formatCurrency,
  formatLocation,
} from "./storefront-ui";
import {
  StorefrontListingCard,
  StorefrontListingSection,
  StorefrontListingTabs,
} from "./storefront-listing-tabs";
import {
  StorefrontProduct,
  StorefrontEquipmentItem,
  StorefrontInventoryItem,
  StorefrontProcessedPoultryItem,
  groupInventoryByProduct,
  loadStorefrontEquipment,
  loadStorefrontHome,
  loadStorefrontInventory,
  loadStorefrontProcessedPoultry,
  previewText,
} from "./storefront-data";

export default async function StorefrontHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [
    homeResult,
    inventoryResult,
    equipmentResult,
    processedPoultryResult,
  ] = await Promise.all([
    loadStorefrontHome(slug),
    loadStorefrontInventory(slug),
    loadStorefrontEquipment(slug),
    loadStorefrontProcessedPoultry(slug),
  ]);
  const error =
    homeResult.error ??
    inventoryResult.error ??
    equipmentResult.error ??
    processedPoultryResult.error;

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

  const livePoultryProducts = groupInventoryByProduct(
    inventoryResult.data.filter(isLivePoultryItem),
  );
  const hatchingEggProducts = groupInventoryByProduct(
    inventoryResult.data.filter(isHatchingEggItem),
  );
  const equipment = equipmentResult.data;
  const processedPoultry = processedPoultryResult.data;
  const aboutPreview = previewText(
    store.about_text,
    `${store.store_name} shares pickup details and current products from the farm.`,
  );
  const pickupPreview = previewText(
    store.pickup_instructions || store.pickup_policy,
    "Pickup details will be confirmed after your order is placed.",
  );
  const heroTitle = store.store_tagline || store.store_name;
  const listingSections = buildListingSections({
    equipment,
    hatchingEggProducts,
    livePoultryProducts,
    processedPoultry,
  });
  const trustItems = buildTrustItems({
    equipmentCount: equipment.length,
    hatchingEggCount: hatchingEggProducts.length,
    livePoultryCount: livePoultryProducts.length,
    location: formatLocation(store),
    processedPoultryCount: processedPoultry.length,
    showPickup: Boolean(store.pickup_instructions || store.pickup_policy),
  });

  return (
    <StorefrontShell>
      <StorefrontHomeHeader store={store} />
      <TrustStrip items={trustItems} />

      <main className="mx-auto grid max-w-[70rem] gap-8 px-5 py-7 sm:px-7 lg:gap-9">
        <section className="relative overflow-hidden rounded-2xl border border-[#ded7c8] bg-white lg:min-h-[30rem]">
          <div className="lg:absolute lg:inset-y-0 lg:left-[34%] lg:right-0">
            <HeroImage
              alt={store.hero_image_alt_text || `${store.store_name} farm photo`}
              src={store.hero_image_url}
            />
          </div>
          <div className="pointer-events-none hidden lg:absolute lg:inset-0 lg:block lg:bg-[linear-gradient(90deg,#ffffff_0%,#ffffff_34%,rgba(255,255,255,0.88)_45%,rgba(255,255,255,0)_68%)]" />
          <div className="relative z-10 flex min-h-[19rem] max-w-[31rem] flex-col justify-center gap-6 p-6 sm:p-9 lg:min-h-[27rem] lg:p-10">
            <div>
              <StorefrontEyebrow>Local farm storefront</StorefrontEyebrow>
              <h1 className="mt-3 font-serif text-4xl font-semibold leading-[1.08] text-stone-950 sm:text-5xl">
                {heroTitle}
              </h1>
              <p className="mt-5 text-base leading-7 text-stone-700">
                {aboutPreview}
              </p>
            </div>
            <div>
              <StorefrontButton href="#shop-listings">
                Shop Live Poultry
              </StorefrontButton>
            </div>
          </div>
        </section>

        <section id="shop-listings">
          <h2 className="mb-5 font-serif text-3xl font-semibold leading-tight text-stone-950">
            Shop Our Listings
          </h2>
          <StorefrontListingTabs sections={listingSections} />
        </section>

        <section className="grid overflow-hidden rounded-2xl border border-[#ded7c8] bg-[#fffdf8] lg:grid-cols-2">
          <InfoCard
            actionHref={`/store/${store.store_slug}/about`}
            actionLabel="Learn more about our farm"
            eyebrow="About This Farm"
            title={store.store_name}
          >
            {aboutPreview}
          </InfoCard>
          <InfoCard
            actionHref={`/store/${store.store_slug}/policies`}
            actionLabel="View pickup details"
            eyebrow="Pickup Location"
            title={hasLocation(store) ? formatLocation(store) : "Pickup details"}
          >
            {pickupPreview}
          </InfoCard>
        </section>
      </main>

      <StorefrontHomeFooter store={store} />
    </StorefrontShell>
  );
}

function StorefrontHomeHeader({
  store,
}: {
  store: {
    logo_image_alt_text: string | null;
    logo_image_url: string | null;
    store_name: string;
    store_slug: string;
  };
}) {
  return (
    <header className="border-b border-[#e7e0d2] bg-white">
      <div className="mx-auto grid max-w-[70rem] gap-4 px-5 py-4 sm:px-7 lg:min-h-24 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
        <a
          className="flex min-w-0 items-center gap-4 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
          href={`/store/${store.store_slug}`}
        >
          <StoreLogo store={store} />
          <div className="min-w-0">
            <p className="truncate text-3xl font-semibold leading-none text-[#073f1e]">
              {store.store_name}
            </p>
            <p className="mt-1 text-sm font-semibold uppercase tracking-[0.22em] text-stone-700">
              Poultry Farm
            </p>
          </div>
        </a>

        <nav className="flex flex-wrap items-center gap-5 text-sm font-semibold text-stone-950 lg:justify-center lg:gap-12">
          <a href="#shop-listings">All Listings</a>
          <a href={`/store/${store.store_slug}/about`}>About</a>
          <a href={`/store/${store.store_slug}/policies`}>Contact</a>
        </nav>

        <div className="flex items-center gap-3 lg:justify-end">
          <a
            aria-label="Search listings"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            href="#shop-listings"
          >
            <Search aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
          </a>
          <a
            aria-label="Account"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            href="/login"
          >
            <User aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
          </a>
          <a
            aria-label="Cart"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-950 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            href={`/store/${store.store_slug}/cart`}
          >
            <ShoppingCart aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
          </a>
        </div>
      </div>
    </header>
  );
}

type TrustStripItem = {
  label: string;
} & (
  | { Icon: LucideIcon; symbol?: never }
  | { Icon?: never; symbol: StorefrontCategorySymbolName }
);

function TrustStrip({ items }: { items: TrustStripItem[] }) {
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

function buildTrustItems({
  equipmentCount,
  hatchingEggCount,
  livePoultryCount,
  location,
  processedPoultryCount,
  showPickup,
}: {
  equipmentCount: number;
  hatchingEggCount: number;
  livePoultryCount: number;
  location: string;
  processedPoultryCount: number;
  showPickup: boolean;
}) {
  const items: TrustStripItem[] = [];

  if (showPickup) {
    items.push({
      Icon: MapPin,
      label: `Local pickup available in ${location}`,
    });
  }

  if (livePoultryCount > 0) {
    items.push({ label: "Live poultry", symbol: "poultry" });
  }
  if (hatchingEggCount > 0) {
    items.push({ label: "Eggs", symbol: "egg" });
  }
  if (processedPoultryCount > 0) {
    items.push({ label: "Meat birds", symbol: "processed" });
  }
  if (equipmentCount > 0) {
    items.push({ label: "Equipment & Supplies", symbol: "equipment" });
  }

  return items;
}

function buildListingSections({
  equipment,
  hatchingEggProducts,
  livePoultryProducts,
  processedPoultry,
}: {
  equipment: StorefrontEquipmentItem[];
  hatchingEggProducts: StorefrontProduct[];
  livePoultryProducts: StorefrontProduct[];
  processedPoultry: StorefrontProcessedPoultryItem[];
}) {
  const sections: StorefrontListingSection[] = [
    {
      cards: livePoultryProducts.map(toProductCard),
      description: "Available birds from this storefront.",
      emptyDescription: "This seller does not have visible live poultry right now.",
      emptyTitle: "No live poultry available",
      id: "live-poultry",
      label: "Live Poultry",
    },
  ];

  if (hatchingEggProducts.length > 0) {
    sections.push({
      cards: hatchingEggProducts.map(toProductCard),
      description: "Available hatching eggs for local pickup.",
      emptyDescription: "This seller does not have visible hatching eggs right now.",
      emptyTitle: "No hatching eggs available",
      id: "hatching-eggs",
      label: "Hatching Eggs",
    });
  }

  if (equipment.length > 0) {
    sections.push({
      cards: equipment.map(toEquipmentCard),
      description: "Equipment and supplies available from this seller.",
      emptyDescription:
        "This seller does not have visible equipment or supplies right now.",
      emptyTitle: "No equipment or supplies available",
      id: "equipment-supplies",
      label: "Equipment & Supplies",
    });
  }

  if (processedPoultry.length > 0) {
    sections.push({
      cards: processedPoultry.map(toProcessedPoultryCard),
      description: "Processed poultry items available for local pickup.",
      emptyDescription:
        "This seller does not have visible processed poultry right now.",
      emptyTitle: "No processed poultry available",
      id: "processed-poultry",
      label: "Processed Poultry",
    });
  }

  return sections;
}

function toProcessedPoultryCard(
  item: StorefrontProcessedPoultryItem,
): StorefrontListingCard {
  return {
    availabilityCode: item.buyer_availability_code,
    availabilityLabel: formatAvailableBadge(item.quantity_available),
    description: item.description || item.package_size,
    detail: formatQuantity(item.quantity_available),
    href: `/store/${item.store_slug}/processed-poultry/${item.processed_poultry_inventory_item_id}`,
    imageAlt: item.featured_image_alt_text || item.product_name,
    imageUrl: item.featured_image_url,
    meta: [item.poultry_type, item.product_type].filter(Boolean).join(" - "),
    price: formatCurrency(item.unit_price),
    title: item.product_name,
  };
}

function toEquipmentCard(item: StorefrontEquipmentItem): StorefrontListingCard {
  return {
    availabilityCode: item.buyer_availability_code,
    availabilityLabel: formatAvailableBadge(item.quantity_available),
    description: item.description,
    detail: formatQuantity(item.quantity_available),
    href: `/store/${item.store_slug}/equipment/${item.equipment_inventory_item_id}`,
    imageAlt: item.featured_image_alt_text || item.item_name,
    imageUrl: item.featured_image_url,
    meta: item.category,
    price: formatCurrency(item.unit_price),
    title: item.item_name,
  };
}

function toProductCard(product: StorefrontProduct): StorefrontListingCard {
  return {
    availabilityCode: product.availabilityCode,
    availabilityLabel: formatAvailableBadge(product.totalQuantityAvailable),
    description: product.description,
    detail: product.quantityLabel,
    href: `/store/${product.storeSlug}/products/${product.productId}`,
    imageAlt: product.imageAlt || product.name,
    imageUrl: product.imageUrl,
    meta: product.speciesName,
    price: product.pricingLabel || "See options",
    title: product.name,
  };
}

function InfoCard({
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
    <article className="grid gap-3 border-b border-[#ded7c8] p-6 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0 lg:p-8">
      <div className="flex items-center gap-3">
        {eyebrow === "Pickup Location" ? (
          <MapPin
            aria-hidden="true"
            className="h-10 w-10 shrink-0 text-[#073f1e]"
            strokeWidth={2}
          />
        ) : (
          <House
            aria-hidden="true"
            className="h-10 w-10 shrink-0 text-[#073f1e]"
            strokeWidth={2}
          />
        )}
        <p className="font-serif text-xl font-semibold text-stone-950">
          {eyebrow}
        </p>
      </div>
      <h2 className="text-xl font-semibold text-stone-950">{title}</h2>
      <p className="max-w-md text-sm leading-6 text-stone-700">{children}</p>
      <a className="text-sm font-semibold text-[#073f1e]" href={actionHref}>
        {actionLabel} &rarr;
      </a>
    </article>
  );
}

function StorefrontHomeFooter({
  store,
}: {
  store: {
    public_email: string | null;
    public_phone: string | null;
    social_url: string | null;
    store_name: string;
    store_slug: string;
  };
}) {
  const socialLinks = getSocialLinks(store.social_url);

  return (
    <footer className="border-t border-[#e3e3df] bg-[#f7f7f4]">
      <div className="mx-auto grid max-w-[70rem] gap-9 px-5 py-10 text-sm text-stone-700 sm:grid-cols-2 sm:px-7 lg:grid-cols-[1.35fr_0.8fr_0.9fr_1fr]">
        <div>
          <p className="text-2xl font-semibold leading-none text-[#073f1e]">
            {store.store_name}
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.22em] text-stone-700">
            Poultry Farm
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
            <a href={`/store/${store.store_slug}`}>Live Poultry</a>
            <a href="#shop-listings">Hatching Eggs</a>
            <a href="#shop-listings">Equipment & Supplies</a>
            <a href="#shop-listings">Processed Poultry</a>
          </div>
        </div>
        <div>
          <p className="font-serif text-lg font-semibold text-stone-950">
            Quick Links
          </p>
          <div className="mt-3 grid gap-2">
            <a href={`/store/${store.store_slug}/about`}>About</a>
            <a href={`/store/${store.store_slug}/policies`}>Contact</a>
            <a href={`/store/${store.store_slug}/policies`}>Pickup & Delivery</a>
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

function formatAvailableBadge(quantity: number) {
  if (quantity <= 0) return "Sold out";
  return `${quantity} available`;
}

function formatQuantity(quantity: number) {
  if (quantity <= 0) return "Sold out";
  if (quantity === 1) return "1 available";
  return `${quantity} available`;
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

function isHatchingEggItem(item: StorefrontInventoryItem) {
  return item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs";
}

function isLivePoultryItem(item: StorefrontInventoryItem) {
  return !isHatchingEggItem(item);
}

function hasLocation(store: { public_city: string | null; public_state: string | null }) {
  return Boolean(store.public_city || store.public_state);
}
