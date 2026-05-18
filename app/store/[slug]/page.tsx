import { supabase } from "@/lib/supabase";

type StorefrontItem = {
  store_name: string;
  store_slug: string;
  city: string | null;
  state: string | null;
  pickup_instructions: string | null;
  hatch_or_birth_date: string;
  available_date: string;
  age_days: number;
  species: string;
  breed_name: string;
  inventory_type: string;
  quantity_available: number;
  price: number;
  listing_title: string | null;
  listing_description: string | null;
  primary_photo_url: string | null;
};

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data, error } = await supabase
    .from("public_storefront_inventory")
    .select("*")
    .eq("store_slug", slug)
    .order("breed_name");

  if (error) {
    return (
      <main style={{ padding: "2rem" }}>
        <h1>Storefront error</h1>
        <pre>{error.message}</pre>
      </main>
    );
  }

  if (!data || data.length === 0) {
    return (
      <main style={{ padding: "2rem" }}>
        <h1>No listings found</h1>
        <p>Slug being searched: {slug}</p>
      </main>
    );
  }

  const store = data[0] as StorefrontItem;

  return (
    <main style={{ padding: "2rem", maxWidth: "900px" }}>
      <h1>{store.store_name}</h1>
      <p>{store.city}, {store.state}</p>

      <h2>Available Now</h2>

      <div style={{ display: "grid", gap: "1rem" }}>
        {(data as StorefrontItem[]).map((item) => (
          <div
            key={item.inventory_item_id}
            style={{ border: "1px solid #ccc", padding: "1rem" }}
          >
            <h3>{item.listing_title || item.breed_name}</h3>
            <p><strong>Breed:</strong> {item.breed_name}</p>
            <p><strong>Type:</strong> {item.inventory_type}</p>
            <p><strong>Available:</strong> {item.quantity_available}</p>
            <p><strong>Price:</strong> ${item.price}</p>
            <p><strong>Age:</strong> {item.age_days} days</p>
            <p><strong>Ready:</strong> {item.available_date}</p>
            {item.listing_description && <p>{item.listing_description}</p>}
          </div>
        ))}
      </div>
    </main>
  );
}