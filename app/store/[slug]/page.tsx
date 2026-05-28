import {
  AvailabilityBadge,
  EmptyStorefront,
  Fact,
  InfoPanel,
  ListingPhoto,
  StoreMetric,
  StorefrontShell,
  formatCurrency,
  formatDate,
  formatInventoryLabel,
  formatLocation,
} from "./storefront-ui";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type StorefrontInventoryItem = {
  store_slug: string;
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
  unit_price: number;
  featured_image_url: string | null;
  featured_image_alt_text: string | null;
};

type StorefrontHome = {
  store_name: string;
  store_tagline: string | null;
  public_city: string | null;
  public_state: string | null;
  about_text: string | null;
  pickup_policy: string | null;
  pickup_instructions: string | null;
  public_email: string | null;
  public_phone: string | null;
  ready_now_item_count: number;
  reserve_now_item_count: number;
  sold_out_item_count: number;
};

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [homeResult, inventoryResult] = await Promise.all([
    supabase
      .from("public_storefront_home")
      .select("*")
      .eq("store_slug", slug)
      .maybeSingle(),
    supabase
      .from("public_storefront_inventory")
      .select("*")
      .eq("store_slug", slug)
      .order("breed_sort_order", { ascending: true })
      .order("inventory_sort_order", { ascending: true }),
  ]);

  const error = homeResult.error ?? inventoryResult.error;

  if (error) {
    return (
      <StorefrontShell>
        <EmptyStorefront
          title="This storefront could not load"
          description="Please refresh the page. If this keeps happening, the seller may need to check their storefront settings."
        />
      </StorefrontShell>
    );
  }

  const store = homeResult.data as StorefrontHome | null;
  const items = (inventoryResult.data ?? []) as StorefrontInventoryItem[];

  if (!store) {
    return (
      <StorefrontShell>
        <EmptyStorefront
          title="Storefront not found"
          description="This storefront is not public right now."
        />
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-6 sm:px-7">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-emerald-700">
            Private Storefront
          </p>
          <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_18rem] lg:items-end">
            <div>
              <h1 className="text-3xl font-semibold text-stone-950">
                {store.store_name}
              </h1>
              {store.store_tagline ? (
                <p className="mt-2 max-w-2xl text-base leading-7 text-stone-700">
                  {store.store_tagline}
                </p>
              ) : null}
              <p className="mt-3 text-sm font-medium text-stone-600">
                {formatLocation(store)}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2 text-center text-xs font-semibold text-stone-600">
              <StoreMetric label="Ready" value={store.ready_now_item_count} />
              <StoreMetric label="Reserve" value={store.reserve_now_item_count} />
              <StoreMetric label="Sold out" value={store.sold_out_item_count} />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[1fr_20rem]">
        <section>
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-stone-950">
              Available birds
            </h2>
            <p className="text-sm leading-6 text-stone-600">
              Browse current listings from this seller. Contact and pickup
              details are shown before checkout.
            </p>
          </div>

          {items.length === 0 ? (
            <EmptyStorefront
              title="No public listings yet"
              description="This seller does not have visible listings right now."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {items.map((item) => (
                <ListingCard item={item} key={item.inventory_item_id} />
              ))}
            </div>
          )}
        </section>

        <aside className="grid h-fit gap-4">
          <InfoPanel title="Pickup">
            <p>{store.pickup_instructions || "Pickup details coming soon."}</p>
            {store.pickup_policy ? <p>{store.pickup_policy}</p> : null}
          </InfoPanel>
          <InfoPanel title="Seller">
            {store.about_text ? <p>{store.about_text}</p> : null}
            {store.public_email ? <p>Email: {store.public_email}</p> : null}
            {store.public_phone ? <p>Phone: {store.public_phone}</p> : null}
          </InfoPanel>
        </aside>
      </main>
    </StorefrontShell>
  );
}

function ListingCard({ item }: { item: StorefrontInventoryItem }) {
  const inventoryLabel = formatInventoryLabel(item);
  const isSoldOut = item.buyer_availability_code === "sold_out";
  const title = `${item.breed_display_name} ${inventoryLabel}`;
  const href = `/store/${item.store_slug}/items/${item.inventory_item_id}`;

  return (
    <article
      className={`overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm ${
        isSoldOut ? "opacity-90" : ""
      }`}
    >
      <Link
        className="block focus:outline-none focus:ring-2 focus:ring-emerald-700"
        href={href}
      >
        <ListingPhoto
          alt={item.featured_image_alt_text || title}
          src={item.featured_image_url}
        />
        <div className="grid gap-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">
                {item.species_name}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-stone-950">
                {title}
              </h3>
            </div>
            <AvailabilityBadge
              code={item.buyer_availability_code}
              label={item.buyer_availability_label}
            />
          </div>

          {item.breed_description ? (
            <p className="line-clamp-3 text-sm leading-6 text-stone-600">
              {item.breed_description}
            </p>
          ) : (
            <p className="text-sm leading-6 text-stone-500">
              Description coming soon.
            </p>
          )}

          {isSoldOut ? (
            <p className="rounded-md bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-700">
              This listing is currently sold out. Check back later or contact
              the seller if contact info is public.
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-3 text-sm">
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
        </div>
      </Link>
    </article>
  );
}
