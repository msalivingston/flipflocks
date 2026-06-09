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
      ? { label: "Local Pickup", value: "Available" }
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
      <div className="mx-auto grid max-w-[70rem] gap-8 px-5 py-5 sm:px-7 lg:gap-10 lg:py-7">
        <StorefrontHomeHeader
          location={formatLocation(store)}
          store={store}
        />

        <TrustBar items={trustItems} />

        <section className="grid overflow-hidden rounded-2xl border border-[#ded7c8] bg-white shadow-[0_24px_70px_rgba(46,35,20,0.10)] lg:grid-cols-[0.92fr_1.08fr]">
          <div className="flex min-h-[25rem] flex-col justify-center gap-6 p-6 sm:p-8 lg:p-10">
            <div>
              <StorefrontEyebrow>Local farm storefront</StorefrontEyebrow>
              <h1 className="mt-3 max-w-xl text-4xl font-semibold leading-tight text-stone-950 sm:text-5xl">
                {heroTitle}
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-stone-600">
                {aboutPreview}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <StorefrontButton href="#shop-live-poultry">
                Shop Live Poultry
              </StorefrontButton>
              <StorefrontButton
                href={`/store/${store.store_slug}/policies`}
                variant="secondary"
              >
                Pickup Details
              </StorefrontButton>
            </div>
          </div>

          <div className="min-h-80 bg-[#efe5d4] lg:min-h-[31rem]">
            <HeroImage
              alt={store.hero_image_alt_text || `${store.store_name} farm photo`}
              src={store.hero_image_url}
            />
          </div>
        </section>

        <section
          className="rounded-2xl border border-[#ded7c8] bg-white p-5 shadow-[0_18px_55px_rgba(46,35,20,0.08)] sm:p-7"
          id="shop-live-poultry"
        >
          <div className="mb-5 max-w-2xl">
            <StorefrontEyebrow>Available listings</StorefrontEyebrow>
            <h2 className="mt-2 text-3xl font-semibold text-stone-950">
              Shop Live Poultry
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Browse available poultry and farm products for local pickup.
            </p>
          </div>

          <StorefrontListingTabs sections={listingSections} />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <InfoCard
            actionHref={`/store/${store.store_slug}/about`}
            actionLabel="About This Farm"
            eyebrow="About This Farm"
            title={store.store_name}
          >
            {aboutPreview}
          </InfoCard>
          <InfoCard
            actionHref={`/store/${store.store_slug}/policies`}
            actionLabel="Pickup Location"
            eyebrow="Pickup Location"
            title={hasLocation(store) ? formatLocation(store) : "Pickup details"}
          >
            {pickupPreview}
          </InfoCard>
        </section>

        <StorefrontHomeFooter store={store} />
      </div>
    </StorefrontShell>
  );
}

function StorefrontHomeHeader({
  location,
  store,
}: {
  location: string;
  store: {
    logo_image_alt_text: string | null;
    logo_image_url: string | null;
    store_name: string;
    store_slug: string;
  };
}) {
  return (
    <header className="flex flex-col gap-4 rounded-2xl border border-[#e5decf] bg-white/90 px-4 py-4 shadow-[0_10px_30px_rgba(46,35,20,0.05)] sm:px-5 lg:flex-row lg:items-center lg:justify-between">
      <a
        className="flex min-w-0 items-center gap-3 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
        href={`/store/${store.store_slug}`}
      >
        <StoreLogo store={store} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight text-[#23412a]">
            {store.store_name}
          </p>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
            {location}
          </p>
        </div>
      </a>

      <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-stone-700">
        <a
          className="rounded-md px-3 py-2 hover:bg-[#f7f2e8] hover:text-[#24512f]"
          href={`/store/${store.store_slug}`}
        >
          Shop
        </a>
        <a
          className="rounded-md px-3 py-2 hover:bg-[#f7f2e8] hover:text-[#24512f]"
          href={`/store/${store.store_slug}/about`}
        >
          About
        </a>
        <a
          className="rounded-md px-3 py-2 hover:bg-[#f7f2e8] hover:text-[#24512f]"
          href={`/store/${store.store_slug}/policies`}
        >
          Pickup
        </a>
        <a
          className="inline-flex min-h-10 items-center rounded-md bg-[#24512f] px-4 text-white hover:bg-[#183b22]"
          href={`/store/${store.store_slug}/cart`}
        >
          Cart
        </a>
      </nav>
    </header>
  );
}

function TrustBar({ items }: { items: Array<{ label: string; value: string }> }) {
  if (items.length === 0) return null;

  return (
    <section className="grid gap-3 rounded-2xl border border-[#ded7c8] bg-white px-5 py-4 shadow-[0_12px_35px_rgba(46,35,20,0.06)] sm:grid-cols-2 lg:grid-cols-4">
      {items.slice(0, 4).map((item) => (
        <div className="min-w-0 border-[#eee5d6] lg:border-r lg:pr-5 lg:last:border-r-0" key={item.label}>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-stone-500">
            {item.label}
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-stone-950">
            {item.value}
          </p>
        </div>
      ))}
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
    availabilityLabel: item.buyer_availability_label,
    description: item.description || item.package_size,
    detail: `${item.quantity_available} available`,
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
    availabilityLabel: item.buyer_availability_label,
    description: item.description,
    detail: `${item.quantity_available} available`,
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
    availabilityLabel: product.availabilityLabel,
    description: product.description,
    detail: `${product.quantityLabel} - ${
      product.optionsCount === 1 ? "1 option" : `${product.optionsCount} options`
    }`,
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
    <article className="grid gap-4 rounded-2xl border border-[#ded7c8] bg-white p-6 shadow-[0_16px_45px_rgba(46,35,20,0.07)]">
      <StorefrontEyebrow>{eyebrow}</StorefrontEyebrow>
      <h2 className="text-2xl font-semibold text-stone-950">{title}</h2>
      <p className="text-sm leading-7 text-stone-600">{children}</p>
      <StorefrontButton className="w-full sm:w-fit" href={actionHref}>
        {actionLabel}
      </StorefrontButton>
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
    <footer className="grid gap-6 rounded-2xl border border-[#ded7c8] bg-white px-5 py-7 text-sm text-stone-600 shadow-[0_12px_35px_rgba(46,35,20,0.05)] sm:grid-cols-2 lg:grid-cols-[1.3fr_0.8fr_0.8fr_0.9fr]">
      <div>
        <p className="text-lg font-semibold text-[#23412a]">{store.store_name}</p>
        <p className="mt-2 max-w-xs leading-6">
          Local poultry storefront powered by FlipFlocks.
        </p>
      </div>
      <div>
        <p className="font-semibold text-stone-950">Contact</p>
        <div className="mt-3 grid gap-2">
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
          <a href={`/store/${store.store_slug}/cart`}>Cart</a>
          <a href={`/store/${store.store_slug}/checkout`}>Checkout</a>
        </div>
      </div>
      <div>
        <p className="font-semibold text-stone-950">Quick Links</p>
        <div className="mt-3 grid gap-2">
          <a href={`/store/${store.store_slug}/about`}>About This Farm</a>
          <a href={`/store/${store.store_slug}/policies`}>Pickup Location</a>
        </div>
      </div>
    </footer>
  );
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
