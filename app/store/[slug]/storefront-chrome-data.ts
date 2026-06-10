import {
  groupInventoryByProduct,
  loadStorefrontEquipment,
  loadStorefrontHome,
  loadStorefrontInventory,
  loadStorefrontProcessedPoultry,
} from "./storefront-data";
import { getStorefrontCategoryAvailability } from "./storefront-shell-components";

export async function loadStorefrontChrome(slug: string) {
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

  const livePoultryProducts = groupInventoryByProduct(
    inventoryResult.data.filter(isLivePoultryItem),
  );
  const hatchingEggProducts = groupInventoryByProduct(
    inventoryResult.data.filter(isHatchingEggItem),
  );

  return {
    categories: getStorefrontCategoryAvailability({
      equipmentCount: equipmentResult.data.length,
      hatchingEggCount: hatchingEggProducts.length,
      livePoultryCount: livePoultryProducts.length,
      processedPoultryCount: processedPoultryResult.data.length,
    }),
    error:
      homeResult.error ??
      inventoryResult.error ??
      equipmentResult.error ??
      processedPoultryResult.error,
    store: homeResult.data,
  };
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
