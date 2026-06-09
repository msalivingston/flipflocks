import {
  EmptyStorefront,
  HeroImage,
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
    `${store.store_name} shares current availability, pickup details, and farm updates here.`,
  );
  const pickupPreview = previewText(
    store.pickup_instructions || store.pickup_policy,
    "Pickup details will be confirmed after your order is placed.",
  );
  const heroTitle = store.store_tagline || "Locally raised poultry from our farm";
  const trustItems = [
    hasLocation(store) ? { label: "Location", value: formatLocation(store) } : null,
    store.pickup_instructions || store.pickup_policy
      ? { label: "Pickup", value: "Local pickup available" }
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
    store.npip_number ? { label: "NPIP", value: store.npip_number } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const listingSections = buildListingSections({
    equipment,
    hatchingEggProducts,
    livePoultryProducts,
    processedPoultry,
  });

  return (
    <StorefrontShell>
      <StorefrontNav store={store} />

      {trustItems.length > 0 ? (
        <StorefrontContainer>
          <div className="mt-5 grid gap-3 rounded-lg border border-[#d8cebd] bg-white px-4 py-3 shadow-[0_10px_30px_rgba(46,35,20,0.06)] sm:grid-cols-2 lg:grid-cols-4">
            {trustItems.map((item) => (
              <div className="flex min-w-0 items-center gap-3" key={item.label}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#24512f]" />
                <div className="min-w-0">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-stone-500">
                    {item.label}
                  </p>
                  <p className="truncate text-sm font-semibold text-stone-900">
                    {item.value}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </StorefrontContainer>
      ) : null}

      <header className="overflow-hidden">
        <StorefrontContainer className="grid gap-8 py-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:py-12">
          <div className="grid gap-6">
            <div className="flex items-center gap-4">
              <StoreLogo store={store} />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#24512f]">
                  Local storefront
                </p>
                <h1 className="mt-1 text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">
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
              <StorefrontButton href="#live-poultry">
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

          <div className="relative min-h-80 overflow-hidden rounded-lg border border-[#d8cebd] bg-[#efe5d4] shadow-[0_26px_70px_rgba(46,35,20,0.16)] sm:min-h-[28rem]">
            <HeroImage
              alt={store.hero_image_alt_text || `${store.store_name} farm photo`}
              src={store.hero_image_url}
            />
          </div>
        </StorefrontContainer>
      </header>

      <StorefrontPage className="gap-10 pb-12 pt-2">
        <StorefrontSection id="available-products">
          <StorefrontSectionHeader
            eyebrow="Available listings"
            title="Shop the storefront"
          >
            <p>
              Browse current availability by category. Photos are shown when the
              seller has added them.
            </p>
          </StorefrontSectionHeader>

          <StorefrontListingTabs sections={listingSections} />
        </StorefrontSection>

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
      </StorefrontPage>

      <StorefrontFooter store={store} />
    </StorefrontShell>
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
      description: "Current live poultry listings from this farm.",
      emptyDescription: "This seller does not have visible live poultry right now.",
      emptyTitle: "No live poultry available",
      id: "live-poultry",
      label: "Live Poultry",
    },
  ];

  if (hatchingEggProducts.length > 0) {
    sections.push({
      cards: hatchingEggProducts.map(toProductCard),
      description: "Available hatching egg listings for local pickup.",
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
    <article className="grid gap-4 rounded-lg border border-[#ded7c8] bg-white p-6 shadow-[0_14px_40px_rgba(46,35,20,0.07)]">
      <StorefrontEyebrow>{eyebrow}</StorefrontEyebrow>
      <h2 className="text-2xl font-semibold text-stone-950">{title}</h2>
      <p className="text-sm leading-7 text-stone-600">{children}</p>
      <StorefrontButton className="w-full sm:w-fit" href={actionHref}>
        {actionLabel}
      </StorefrontButton>
    </article>
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
