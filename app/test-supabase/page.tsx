import { supabase } from "@/lib/supabase";

export default async function TestSupabasePage() {
  const { data, error } = await supabase
    .from("species")
    .select("*")
    .limit(10);

  if (error) {
    return (
      <main style={{ padding: "2rem" }}>
        <h1>Supabase test failed</h1>
        <pre>{error.message}</pre>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Supabase connection works</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}