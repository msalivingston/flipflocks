import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";

import { createPayAtPickupHandler } from "./handler.ts";

Deno.serve(createPayAtPickupHandler({
  createServiceClient: (supabaseUrl, serviceRoleKey) =>
    createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }),
  env: (name) => Deno.env.get(name),
}));
