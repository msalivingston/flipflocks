import Image from "next/image";
import Link from "next/link";
import {
  AvailabilityBadge,
  EmptyStorefront,
  Fact,
  InfoPanel,
  ListingPhoto,
  StorefrontCard,
  StorefrontMediaFrame,
  StorefrontPage,
  StorefrontShell,
  formatCurrency,
  toPublicImageUrl,
} from "../../storefront-ui";
import {
  StorefrontMedia,
  loadStoreGallery,
  loadStorefrontEquipment,
  loadStorefrontEquipmentItem,
  loadStorefrontHome,
  loadStorefrontInventory,
  loadStorefrontProcessedPoultry,
  groupInventoryByProduct,
} from "../../storefront-data";
import {
  StorefrontChrome,
  getStorefrontCategoryAvailability,
} from "../../storefront-shell-components";
import { EquipmentOrderOptions } from "./equipment-order-options";

export default async function StorefrontEquipmentPage({
  params,
}: {
  params: Promise<{ equipmentItemId: string; slug: string }>;
}) {
  const { equipmentItemId, slug } = await params;

  const [
    homeResult,
    equipmentResult,
    galleryResult,
    inventoryResult,
    equipmentListResult,
    processedPoultryResult,
  ] = await Promise.all([
    loadStorefrontHome(slug),
    loadStorefrontEquipmentItem(slug, equipmentItemId),
    loadStoreGallery(slug, {
      entityId: equipmentItemId,
      entityType: "equipment_inventory_item",
      limit: 8,
    }),
    loadStorefrontInventory(slug),
    loadStorefrontEquipment(slug),
    loadStorefrontProcessedPoultry(slug),
  ]);
  const error =
    homeResult.error ??
    equipmentResult.error ??
    galleryResult.error ??
    inventoryResult.error ??
    equipmentListResult.error ??
    processedPoultryResult.error;

  if (error) {
    return (
      <StorefrontShell>
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="This item could not load"
            description="Please refresh the page or return to the storefront."
          />
        </StorefrontPage>
      </StorefrontShell>
    );
  }

  const store = homeResult.data;

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

  const item = equipmentResult.data;
  const categories = getStorefrontCategoryAvailability({
    equipmentCount: equipmentListResult.data.length,
    hatchingEggCount: groupInventoryByProduct(
      inventoryResult.data.filter(isHatchingEggItem),
    ).length,
    livePoultryCount: groupInventoryByProduct(
      inventoryResult.data.filter(isLivePoultryItem),
    ).length,
    processedPoultryCount: processedPoultryResult.data.length,
  });

  if (!item) {
    return (
      <StorefrontChrome categories={categories} store={store}>
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="Item not found"
            description="This equipment or supply item may no longer be visible."
          />
        </StorefrontPage>
      </StorefrontChrome>
    );
  }

  const gallery = buildEquipmentGallery(item, galleryResult.data);

  return (
    <StorefrontChrome categories={categories} store={store}>
      <StorefrontPage className="gap-7">
        <Link
          className="text-sm font-semibold text-emerald-800 hover:text-emerald-950"
          href={`/store/${store.store_slug}`}
        >
          Back to {store.store_name}
        </Link>

        <section className="grid gap-7 lg:grid-cols-[minmax(0,1.06fr)_24rem] lg:items-start">
          <div className="grid gap-5">
            <StorefrontCard className="overflow-hidden p-0">
              <EquipmentGallery
                fallbackAlt={item.featured_image_alt_text || item.item_name}
                fallbackSrc={item.featured_image_url}
                gallery={gallery}
              />
            </StorefrontCard>

            <StorefrontCard className="grid gap-5 p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
                    {item.category}
                  </p>
                  <h1 className="mt-2 text-4xl font-semibold leading-tight text-stone-950">
                    {item.item_name}
                  </h1>
                  <p className="mt-3 text-xl font-semibold text-[#24512f]">
                    {formatCurrency(item.unit_price)}
                  </p>
                </div>
                <AvailabilityBadge
                  code={item.buyer_availability_code}
                  label={item.buyer_availability_label}
                />
              </div>

              <p className="max-w-3xl whitespace-pre-line text-base leading-8 text-stone-700">
                {item.description ||
                  "This seller has not added a long description yet."}
              </p>

              <dl className="grid gap-3 rounded-lg bg-[#fbf7ef] p-4 text-sm sm:grid-cols-3">
                <Fact
                  label="Available"
                  value={
                    item.quantity_available === 1
                      ? "1 available"
                      : `${item.quantity_available} available`
                  }
                />
                <Fact label="Category" value={item.category} />
                <Fact label="Condition" value={item.condition || "Not listed"} />
              </dl>
            </StorefrontCard>
          </div>

          <aside className="grid h-fit gap-4 lg:sticky lg:top-28">
            <EquipmentOrderOptions item={item} />
            <InfoPanel title="Pickup">
              <p>{store.pickup_instructions || "Pickup details coming soon."}</p>
              {store.pickup_policy ? <p>{store.pickup_policy}</p> : null}
            </InfoPanel>
            <InfoPanel title="Questions">
              {store.public_email ? <p>Email: {store.public_email}</p> : null}
              {store.public_phone ? <p>Phone: {store.public_phone}</p> : null}
              {!store.public_email && !store.public_phone ? (
                <p>The seller will follow up after your order is placed.</p>
              ) : null}
            </InfoPanel>
          </aside>
        </section>
      </StorefrontPage>
    </StorefrontChrome>
  );
}

function EquipmentGallery({
  fallbackAlt,
  fallbackSrc,
  gallery,
}: {
  fallbackAlt: string;
  fallbackSrc: string | null;
  gallery: StorefrontMedia[];
}) {
  const [featured, ...rest] = gallery;

  if (!featured) {
    return <ListingPhoto alt={fallbackAlt} src={fallbackSrc} />;
  }

  return (
    <StorefrontMediaFrame className="grid gap-2 rounded-none p-2">
      <Image
        alt={featured.alt_text || fallbackAlt}
        className="aspect-[4/3] w-full rounded-md object-cover"
        height={720}
        src={toPublicImageUrl(featured.public_url)}
        unoptimized
        width={960}
      />
      {rest.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {rest.slice(0, 3).map((image) => (
            <Image
              alt={image.alt_text || fallbackAlt}
              className="aspect-[4/3] w-full rounded-md object-cover"
              height={240}
              key={`${image.entity_type}-${image.public_url}`}
              src={toPublicImageUrl(image.public_url)}
              unoptimized
              width={320}
            />
          ))}
        </div>
      ) : null}
    </StorefrontMediaFrame>
  );
}

function buildEquipmentGallery(
  item: {
    equipment_inventory_item_id: string;
    featured_image_alt_text: string | null;
    featured_image_url: string | null;
    item_name: string;
    store_slug: string;
  },
  linkedGallery: StorefrontMedia[],
) {
  if (linkedGallery.length > 0) return linkedGallery;
  if (!item.featured_image_url) return [];

  return [
    {
      alt_text: item.featured_image_alt_text,
      caption: null,
      display_context: "featured",
      entity_id: item.equipment_inventory_item_id,
      entity_type: "equipment_inventory_item",
      height_px: null,
      is_featured: true,
      public_url: item.featured_image_url,
      sort_order: 0,
      store_id: "",
      store_slug: item.store_slug,
      width_px: null,
    },
  ];
}

function isHatchingEggItem(item: { batch_type: string | null; inventory_type: string }) {
  return item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs";
}

function isLivePoultryItem(item: { batch_type: string | null; inventory_type: string }) {
  return !isHatchingEggItem(item);
}
