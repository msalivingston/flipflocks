import {
  EmptyStorefront,
  StorefrontShell,
} from "./storefront-ui";
import {
  loadStorefrontEquipment,
  loadStorefrontHatchingEggInventory,
  loadStorefrontHome,
  loadStorefrontInventory,
  loadStorefrontProfileImages,
  loadStorefrontProcessedPoultry,
} from "./storefront-data";
import { StorefrontHomeContent } from "./storefront-home-content";
import { StorefrontPreviewClient } from "./storefront-preview-client";

export default async function StorefrontHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  const query = searchParams ? await searchParams : {};

  if (query.preview === "1") {
    return <StorefrontPreviewClient slug={slug} />;
  }

  const [
    homeResult,
    inventoryResult,
    equipmentResult,
    hatchingEggResult,
    processedPoultryResult,
  ] = await Promise.all([
    loadStorefrontHome(slug),
    loadStorefrontInventory(slug),
    loadStorefrontEquipment(slug),
    loadStorefrontHatchingEggInventory(slug),
    loadStorefrontProcessedPoultry(slug),
  ]);
  const error =
    homeResult.error ??
    inventoryResult.error ??
    equipmentResult.error ??
    hatchingEggResult.error ??
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

  const livePoultryProfileImagesResult = await loadStorefrontProfileImages(
    slug,
    inventoryResult.data
      .filter(isLivePoultryItem)
      .map((item) => item.seller_breed_profile_id),
  );

  return (
    <StorefrontHomeContent
      equipment={equipmentResult.data}
      hatchingEggs={hatchingEggResult.data}
      inventory={inventoryResult.data}
      livePoultryProfileImages={
        livePoultryProfileImagesResult.error
          ? {}
          : livePoultryProfileImagesResult.data
      }
      processedPoultry={processedPoultryResult.data}
      store={store}
    />
  );
}

function isHatchingEggItem(item: {
  batch_type: string | null;
  inventory_type: string;
}) {
  return item.batch_type === "hatching_eggs" || item.inventory_type === "hatching_eggs";
}

function isLivePoultryItem(item: {
  batch_type: string | null;
  inventory_type: string;
}) {
  return !isHatchingEggItem(item);
}
