import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  AvailabilityBadge,
  EmptyStorefront,
  Fact,
  InfoPanel,
  ListingPhoto,
  StorefrontShell,
  formatCurrency,
  formatDate,
  formatInventoryLabel,
} from "../../storefront-ui";
import { PayAtPickupForm } from "./pay-at-pickup-form";

type StorefrontItemDetail = {
  store_slug: string;
  store_name: string;
  pickup_policy: string | null;
  cancellation_policy: string | null;
  pickup_instructions: string | null;
  species_name: string;
  breed_display_name: string;
  breed_description: string | null;
  inventory_item_id: string;
  inventory_type: string;
  custom_inventory_label: string | null;
  quantity_available: number;
  buyer_availability_code: string;
  buyer_availability_label: string;
  available_date: string;
  is_available_now: boolean;
  can_checkout: boolean;
  unit_price: number;
  featured_image_url: string | null;
  featured_image_alt_text: string | null;
};

export default async function StorefrontItemPage({
  params,
}: {
  params: Promise<{ inventoryItemId: string; slug: string }>;
}) {
  const { inventoryItemId, slug } = await params;

  const { data, error } = await supabase
    .from("public_storefront_item_detail")
    .select("*")
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

  const item = data as StorefrontItemDetail | null;

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

  const inventoryLabel = formatInventoryLabel(item);
  const isSoldOut = item.buyer_availability_code === "sold_out";
  const title = `${item.breed_display_name} ${inventoryLabel}`;

  return (
    <StorefrontShell>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-5 sm:px-7">
          <Link
            className="text-sm font-semibold text-emerald-800 hover:text-emerald-900"
            href={`/store/${item.store_slug}`}
          >
            Back to {item.store_name}
          </Link>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.08em] text-emerald-700">
                {item.species_name}
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-stone-950">
                {title}
              </h1>
            </div>
            <AvailabilityBadge
              code={item.buyer_availability_code}
              label={item.buyer_availability_label}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[1fr_20rem]">
        <article className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <ListingPhoto
            alt={item.featured_image_alt_text || title}
            src={item.featured_image_url}
          />
          <div className="grid gap-5 p-5">
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Fact label="Price" value={formatCurrency(item.unit_price)} />
              <Fact
                label="Quantity"
                value={
                  item.quantity_available > 0
                    ? `${item.quantity_available} available`
                    : "Sold out"
                }
              />
              <Fact label="Available" value={formatDate(item.available_date)} />
              <Fact label="Type" value={inventoryLabel} />
            </dl>

            {isSoldOut ? (
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">
                <p className="font-semibold text-stone-950">
                  This listing is currently sold out.
                </p>
                <p className="mt-1">
                  Check back later or contact the seller if contact info is
                  public.
                </p>
              </div>
            ) : null}

            <section>
              <h2 className="text-lg font-semibold text-stone-950">
                About this listing
              </h2>
              {item.breed_description ? (
                <p className="mt-2 whitespace-pre-line text-sm leading-7 text-stone-700">
                  {item.breed_description}
                </p>
              ) : (
                <p className="mt-2 text-sm leading-7 text-stone-500">
                  This seller has not added a description yet.
                </p>
              )}
            </section>
          </div>
        </article>

        <aside className="grid h-fit gap-4">
          <InfoPanel title="Pickup">
            <p>{item.pickup_instructions || "Pickup details coming soon."}</p>
            {item.pickup_policy ? <p>{item.pickup_policy}</p> : null}
          </InfoPanel>
          <PayAtPickupForm
            canCheckout={item.can_checkout}
            inventoryItemId={item.inventory_item_id}
            quantityAvailable={item.quantity_available}
            storeSlug={item.store_slug}
            unitPrice={item.unit_price}
          />
        </aside>
      </main>
    </StorefrontShell>
  );
}
