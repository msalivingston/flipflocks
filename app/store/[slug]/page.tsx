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
  const totalListings =
    livePoultryProducts.length +
    hatchingEggProducts.length +
    equipment.length +
    processedPoultry.length;
  const aboutPreview = previewText(
    store.about_text,
    `${store.store_name} shares pickup details and current products from the farm.`,
  );
  const pickupPreview = previewText(
    store.pickup_instructions || store.pickup_policy,
    "Pickup details will be confirmed after your order is placed.",
  );
  const heroTitle = store.store_tagline || store.store_name;
  const trustItems = [
    hasLocation(store) ? { label: "Location", value: formatLocation(store) } : null,
    store.pickup_instructions || store.pickup_policy
      ? { label: "Local pickup", value: "Available" }
      : null,
    totalListings > 0
      ? {
          label: "Availability",
          value:
            store.ready_now_item_count > 0
              ? `${store.ready_now_item_count} ready now`
              : `${totalListings} listing${totalListings === 1 ? "" : "s"}`,
        }
      : null,
    { label: "Storefront", value: "Open" },
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const listingSections = buildListingSections({
    equipment,
    hatchingEggProducts,
    livePoultryProducts,
    processedPoultry,
  });

  return (
    <StorefrontShell>
      <StorefrontHomeHeader store={store} />
      <TrustStrip items={trustItems} />

      <main className="mx-auto grid max-w-[70rem] gap-8 px-5 py-7 sm:px-7 lg:gap-9">
        <section className="relative overflow-hidden rounded-2xl border border-[#ded7c8] bg-white shadow-[0_18px_55px_rgba(46,35,20,0.08)] lg:min-h-[30rem]">
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
              <h1 className="mt-3 text-4xl font-semibold leading-[1.08] text-stone-950 sm:text-5xl">
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
          <h2 className="mb-5 text-3xl font-semibold leading-tight text-stone-950">
            Shop Our Listings
          </h2>
          <StorefrontListingTabs sections={listingSections} />
        </section>

        <section className="grid overflow-hidden rounded-2xl border border-[#ded7c8] bg-[#fffdf8] shadow-[0_14px_40px_rgba(46,35,20,0.06)] lg:grid-cols-2">
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
      <div className="mx-auto flex max-w-[70rem] flex-col gap-4 px-5 py-4 sm:px-7 lg:min-h-24 lg:flex-row lg:items-center lg:justify-between">
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

        <nav className="flex flex-wrap items-center gap-3 text-sm font-semibold text-stone-900 lg:gap-8">
          <a href="#shop-listings">All Listings</a>
          <a href={`/store/${store.store_slug}/about`}>About</a>
          <a href={`/store/${store.store_slug}/policies`}>Contact</a>
          <a aria-label="Cart" className="rounded-md bg-[#073f1e] px-4 py-2 text-white" href={`/store/${store.store_slug}/cart`}>
            Cart
          </a>
        </nav>
      </div>
    </header>
  );
}

function TrustStrip({ items }: { items: Array<{ label: string; value: string }> }) {
  if (items.length === 0) return null;

  return (
    <section className="border-b border-[#e1d8c8] bg-[#f1ece3]">
      <div className="mx-auto flex max-w-[70rem] gap-4 overflow-x-auto px-5 py-3 text-sm text-[#083f1e] sm:px-7 lg:justify-center">
        {items.slice(0, 4).map((item, index) => (
          <div className="flex shrink-0 items-center gap-3" key={item.label}>
            <span className="h-3 w-3 rounded-full bg-[#073f1e]" />
            <span>
              <span className="font-semibold">{item.value}</span>
              <span className="ml-1 text-stone-700">{item.label}</span>
            </span>
            {index < Math.min(items.length, 4) - 1 ? (
              <span className="ml-3 h-5 w-px bg-[#cfc5b6]" />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
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
      <StorefrontEyebrow>{eyebrow}</StorefrontEyebrow>
      <h2 className="text-xl font-semibold text-stone-950">{title}</h2>
      <p className="max-w-md text-sm leading-6 text-stone-700">{children}</p>
      <a className="text-sm font-semibold text-[#073f1e]" href={actionHref}>
        {actionLabel} →
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
    store_name: string;
    store_slug: string;
  };
}) {
  return (
    <footer className="border-t border-[#e1d8c8] bg-white">
      <div className="mx-auto grid max-w-[70rem] gap-8 px-5 py-9 text-sm text-stone-700 sm:grid-cols-2 sm:px-7 lg:grid-cols-[1.3fr_0.8fr_0.9fr_1fr]">
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
        </div>
        <div>
          <p className="font-semibold text-stone-950">Shop</p>
          <div className="mt-3 grid gap-2">
            <a href={`/store/${store.store_slug}`}>Live Poultry</a>
            <a href="#shop-listings">Hatching Eggs</a>
            <a href="#shop-listings">Equipment & Supplies</a>
            <a href="#shop-listings">Processed Poultry</a>
          </div>
        </div>
        <div>
          <p className="font-semibold text-stone-950">Quick Links</p>
          <div className="mt-3 grid gap-2">
            <a href={`/store/${store.store_slug}/about`}>About</a>
            <a href={`/store/${store.store_slug}/policies`}>Contact</a>
            <a href={`/store/${store.store_slug}/policies`}>Pickup & Delivery</a>
          </div>
        </div>
        <div>
          <p className="font-semibold text-stone-950">Powered by FlipFlocks</p>
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

function isHatchingEggItem(item: StorefrontInventoryItem) {
  return item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs";
}

function isLivePoultryItem(item: StorefrontInventoryItem) {
  return !isHatchingEggItem(item);
}

function hasLocation(store: { public_city: string | null; public_state: string | null }) {
  return Boolean(store.public_city || store.public_state);
}
