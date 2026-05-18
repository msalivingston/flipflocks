import { supabase } from "@/lib/supabase";

export default async function ListingsPage() {
  const { data: listings, error } = await supabase
    .from("listings")
    .select("*")
    .order("created_at", { ascending: false });

if (error) {
  return (
    <main style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>Error loading listings</h1>
      <pre>{JSON.stringify(error, null, 2)}</pre>
    </main>
  );
}

  return (
    <main style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>Listings</h1>

      {listings?.map((listing) => (
        <div
          key={listing.id}
          style={{
            border: "1px solid #ccc",
            padding: "16px",
            marginBottom: "16px",
            borderRadius: "8px",
          }}
        >
          <h2>{listing.title}</h2>
          <p>{listing.species} - {listing.breed}</p>
          <p>Quantity: {listing.quantity}</p>
          <p>Price: ${listing.price}</p>
          <p>Location: {listing.city}</p>
        </div>
      ))}
    </main>
  );
}