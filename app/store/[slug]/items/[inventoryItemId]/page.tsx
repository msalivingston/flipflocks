import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { EmptyStorefront, StorefrontShell } from "../../storefront-ui";

type StorefrontItemRedirect = {
  seller_breed_profile_id: string;
};

export default async function StorefrontItemPage({
  params,
}: {
  params: Promise<{ inventoryItemId: string; slug: string }>;
}) {
  const { inventoryItemId, slug } = await params;

  const { data, error } = await supabase
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

  redirect(`/store/${slug}/products/${item.seller_breed_profile_id}`);
}
