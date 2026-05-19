"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const STOREFRONT_ID = "87b75885-ac0c-4f6d-8b15-b0a07c37b3f6";
const CHICKEN_SPECIES_ID = "0c1c7eda-e2a8-425e-a3e9-c659d9751eaa";

type Batch = {
  id: string;
  hatch_or_birth_date: string;
  available_date: string;
  base_price: number;
  status: string;
};

type Breed = {
  id: string;
  breed_name: string;
};

export default function DashboardPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [breeds, setBreeds] = useState<Breed[]>([]);

  const [hatchDate, setHatchDate] = useState("");
  const [availableDate, setAvailableDate] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [notes, setNotes] = useState("");

  const [message, setMessage] = useState("");

  const [selectedBreed, setSelectedBreed] = useState("");
  const [inventoryType, setInventoryType] = useState("female");
  const [quantity, setQuantity] = useState("");
  const [priceOverride, setPriceOverride] = useState("");

  async function loadBatches() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) return;

    const { data } = await supabase
      .from("batches")
      .select("*")
      .eq("seller_id", user.id)
      .order("hatch_or_birth_date", { ascending: false });

    setBatches(data || []);
  }

  useEffect(() => {
    async function loadInitialData() {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      const [{ data: breedData }, { data: batchData }] = await Promise.all([
        supabase
          .from("breeds")
          .select("id, breed_name")
          .order("breed_name"),
        user
          ? supabase
              .from("batches")
              .select("*")
              .eq("seller_id", user.id)
              .order("hatch_or_birth_date", { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);

      setBreeds(breedData || []);
      setBatches(batchData || []);
    }

    void loadInitialData();
  }, []);

  async function handleCreateBatch(e: React.FormEvent) {
    e.preventDefault();

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) return;

    const { error } = await supabase.from("batches").insert({
      seller_id: user.id,
      storefront_id: STOREFRONT_ID,
      species_id: CHICKEN_SPECIES_ID,
      hatch_or_birth_date: hatchDate,
      available_date: availableDate,
      base_price: Number(basePrice),
      status: "active",
      internal_notes: notes,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Batch created.");
    setHatchDate("");
    setAvailableDate("");
    setBasePrice("");
    setNotes("");

    loadBatches();
  }

  async function handleAddInventory(batchId: string) {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) return;

    const breed = breeds.find((b) => b.id === selectedBreed);

    const { error } = await supabase.from("inventory_items").insert({
      seller_id: user.id,
      storefront_id: STOREFRONT_ID,
      batch_id: batchId,
      breed_id: selectedBreed,
      inventory_type: inventoryType,
      quantity_available: Number(quantity),
      price_override: priceOverride
        ? Number(priceOverride)
        : null,
      listing_title: `${breed?.breed_name || "Breed"} Listing`,
      listing_description: "Created from dashboard.",
      status: "published",
      is_featured: false,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Inventory added.");

    setSelectedBreed("");
    setInventoryType("female");
    setQuantity("");
    setPriceOverride("");
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "800px" }}>
      <h1>Seller Dashboard</h1>

      <section style={{ marginBottom: "3rem" }}>
        <h2>Create Batch</h2>

        <form onSubmit={handleCreateBatch}>
          <input
            type="date"
            value={hatchDate}
            onChange={(e) => setHatchDate(e.target.value)}
            required
            style={{ display: "block", marginBottom: "1rem" }}
          />

          <input
            type="date"
            value={availableDate}
            onChange={(e) => setAvailableDate(e.target.value)}
            required
            style={{ display: "block", marginBottom: "1rem" }}
          />

          <input
            type="number"
            placeholder="Base Price"
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            required
            style={{ display: "block", marginBottom: "1rem" }}
          />

          <textarea
            placeholder="Internal Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ display: "block", marginBottom: "1rem" }}
          />

          <button type="submit">Create Batch</button>
        </form>
      </section>

      <section>
        <h2>Batches</h2>

        {batches.map((batch) => (
          <div
            key={batch.id}
            style={{
              border: "1px solid #ccc",
              padding: "1rem",
              marginBottom: "2rem",
            }}
          >
            <p>
              <strong>Hatch:</strong> {batch.hatch_or_birth_date}
            </p>

            <p>
              <strong>Available:</strong> {batch.available_date}
            </p>

            <p>
              <strong>Base Price:</strong> ${batch.base_price}
            </p>

            <h3>Add Inventory Row</h3>

            <select
              value={selectedBreed}
              onChange={(e) => setSelectedBreed(e.target.value)}
              style={{ display: "block", marginBottom: "1rem" }}
            >
              <option value="">Select Breed</option>

              {breeds.map((breed) => (
                <option key={breed.id} value={breed.id}>
                  {breed.breed_name}
                </option>
              ))}
            </select>

            <select
              value={inventoryType}
              onChange={(e) => setInventoryType(e.target.value)}
              style={{ display: "block", marginBottom: "1rem" }}
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="straight_run">Straight Run</option>
            </select>

            <input
              type="number"
              placeholder="Quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              style={{ display: "block", marginBottom: "1rem" }}
            />

            <input
              type="number"
              placeholder="Optional Price Override"
              value={priceOverride}
              onChange={(e) => setPriceOverride(e.target.value)}
              style={{ display: "block", marginBottom: "1rem" }}
            />

            <button onClick={() => handleAddInventory(batch.id)}>
              Add Inventory
            </button>
          </div>
        ))}
      </section>

      {message && (
        <p style={{ marginTop: "2rem" }}>
          {message}
        </p>
      )}
    </main>
  );
}
