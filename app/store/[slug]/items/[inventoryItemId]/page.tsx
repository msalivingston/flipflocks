import { notFound, redirect } from "next/navigation";
import { publicSupabase } from "@/lib/public-supabase";
import { EmptyStorefront, StorefrontShell } from "../../storefront-ui";
import { loadStorefrontAccess } from "../../storefront-data";
import type { EmbeddedOrderModeSearchParams } from "@/lib/embedded-order-mode";
import {
  buildEmbeddedOrderModeHref,
} from "@/lib/embedded-order-mode";
import { resolveStorefrontVisibilityDecision } from "@/lib/storefront-visibility";

type StorefrontItemRedirect = {
  seller_breed_profile_id: string;
};

export default async function StorefrontItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ inventoryItemId: string; slug: string }>;
  searchParams: Promise<EmbeddedOrderModeSearchParams>;
}) {
  const [{ inventoryItemId, slug }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const accessResult = await loadStorefrontAccess(slug);

  if (accessResult.error || !accessResult.data) notFound();
  const visibilityDecision = resolveStorefrontVisibilityDecision({
    isPubliclyAvailable: accessResult.data.is_publicly_available,
    searchParams: query,
    storeSlug: slug,
    visibility: accessResult.data.storefront_visibility,
    websiteUrl: accessResult.data.website_url,
  });
  if (visibilityDecision.action === "redirect") redirect(visibilityDecision.url);
  if (visibilityDecision.action === "deny") notFound();

  const { data, error } = await publicSupabase
    .from("public_storefront_item_detail")
    .select("seller_breed_profile_id")
    .eq("store_slug", slug)
    .eq("inventory_item_id", inventoryItemId)
    .maybeSingle();

  if (error) {
    return (
      <StorefrontShell>
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="This listing could not load"
            description="Please refresh the page or return to the storefront."
          />
        </main>
      </StorefrontShell>
    );
  }

  const item = data as StorefrontItemRedirect | null;

  if (!item) {
    return (
      <StorefrontShell>
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="Listing not found"
            description="This listing may no longer be visible."
          />
        </main>
      </StorefrontShell>
    );
  }

  redirect(
    buildEmbeddedOrderModeHref(
      `/store/${slug}/products/${item.seller_breed_profile_id}`,
      visibilityDecision.orderMode,
    ),
  );
}
