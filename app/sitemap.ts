import type { MetadataRoute } from "next";
import { publicSupabase } from "@/lib/public-supabase";
import { absoluteUrl } from "@/lib/seo-config";

export const dynamic = "force-dynamic";

const PUBLIC_STATIC_PATHS = [
  "/",
  "/about",
  "/acceptable-use",
  "/faq",
  "/pricing",
  "/privacy",
  "/terms",
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const urls = new Set(PUBLIC_STATIC_PATHS.map((path) => absoluteUrl(path)));
  const publicRows = await loadPublicSitemapRows();

  if (!publicRows) return [...urls].map((url) => ({ url }));

  const [stores, liveBirds, hatchingEggs, equipment, processedPoultry] = publicRows;
  const publicStoreSlugs = new Set(
    (stores.data ?? []).map((store) => store.store_slug),
  );

  for (const store of stores.data ?? []) {
    const base = `/store/${encodeURIComponent(store.store_slug)}`;
    urls.add(absoluteUrl(base));
    urls.add(absoluteUrl(`${base}/about`));
    urls.add(absoluteUrl(`${base}/policies`));
  }

  for (const item of liveBirds.data ?? []) {
    if (!publicStoreSlugs.has(item.store_slug)) continue;
    urls.add(
      absoluteUrl(
        `/store/${encodeURIComponent(item.store_slug)}/products/${encodeURIComponent(item.seller_breed_profile_id)}`,
      ),
    );
  }

  for (const item of hatchingEggs.data ?? []) {
    if (!publicStoreSlugs.has(item.store_slug)) continue;
    urls.add(
      absoluteUrl(
        `/store/${encodeURIComponent(item.store_slug)}/products/${encodeURIComponent(item.hatching_egg_product_id)}`,
      ),
    );
  }

  for (const item of equipment.data ?? []) {
    if (!publicStoreSlugs.has(item.store_slug)) continue;
    urls.add(
      absoluteUrl(
        `/store/${encodeURIComponent(item.store_slug)}/equipment/${encodeURIComponent(item.equipment_inventory_item_id)}`,
      ),
    );
  }

  for (const item of processedPoultry.data ?? []) {
    if (!publicStoreSlugs.has(item.store_slug)) continue;
    urls.add(
      absoluteUrl(
        `/store/${encodeURIComponent(item.store_slug)}/processed-poultry/${encodeURIComponent(item.processed_poultry_inventory_item_id)}`,
      ),
    );
  }

  return [...urls].map((url) => ({ url }));
}

async function loadPublicSitemapRows() {
  try {
    const results = await Promise.all([
      publicSupabase.from("public_storefronts").select("store_slug"),
      publicSupabase
        .from("public_storefront_inventory")
        .select("store_slug,seller_breed_profile_id")
        .neq("batch_type", "hatching_eggs"),
      publicSupabase
        .from("public_storefront_hatching_egg_inventory")
        .select("store_slug,hatching_egg_product_id"),
      publicSupabase
        .from("public_storefront_equipment_inventory")
        .select("store_slug,equipment_inventory_item_id"),
      publicSupabase
        .from("public_storefront_processed_poultry_inventory")
        .select("store_slug,processed_poultry_inventory_item_id"),
    ]);

    return results.some((result) => result.error) ? null : results;
  } catch {
    return null;
  }
}
