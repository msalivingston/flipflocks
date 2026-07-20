import { connection } from "next/server";
import { publicSupabase } from "./public-supabase";

export async function loadSellerSignupsEnabled() {
  await connection();

  const { data, error } = await publicSupabase.rpc(
    "public_seller_signups_enabled",
  );

  if (error) {
    console.error("Seller signup setting query failed", error);
    return true;
  }

  return data !== false;
}
