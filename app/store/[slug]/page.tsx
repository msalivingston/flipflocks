import {
  EmptyStorefront,
  StorefrontShell,
} from "./storefront-ui";
import {
  loadStorefrontEquipment,
  loadStorefrontHome,
  loadStorefrontInventory,
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

  return (
    <StorefrontHomeContent
      equipment={equipmentResult.data}
      inventory={inventoryResult.data}
      processedPoultry={processedPoultryResult.data}
      store={store}
    />
  );
}
