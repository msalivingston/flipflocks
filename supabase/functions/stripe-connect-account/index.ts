import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { resolveFlockFrontCors } from "../_shared/cors.ts";
import { createStripeConnectClient } from "../_shared/stripe-connect-client.ts";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function strictBoolean(name: string): boolean {
  const value = required(name);
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false.`);
  return value === "true";
}

function json(status: number, body: Record<string, unknown>, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const supabaseUrl = required("SUPABASE_URL");
const anonKey = required("SUPABASE_ANON_KEY");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const livemode = strictBoolean("STRIPE_CONNECT_LIVEMODE");
const publicSiteOrigin = new URL(required("FLOCKFRONT_PUBLIC_SITE_URL")).origin;
const stripe = createStripeConnectClient(required("STRIPE_CONNECT_API_KEY"));
const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (request) => {
  const cors = resolveFlockFrontCors(request.headers.get("Origin"), {
    configuredOrigin: Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN"),
  });
  if (request.method === "OPTIONS") return new Response(null, { status: cors.originAllowed ? 204 : 403, headers: cors.headers });
  if (!cors.originAllowed) return json(403, { error: "origin_not_allowed" }, cors.headers);
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, cors.headers);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json(401, { error: "unauthorized" }, cors.headers);
  const authenticated = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await authenticated.auth.getUser();
  if (userError || !user) return json(401, { error: "unauthorized" }, cors.headers);

  let body: { action?: unknown };
  try { body = await request.json(); } catch { return json(400, { error: "invalid_request" }, cors.headers); }
  if (body.action !== "status" && body.action !== "onboard") {
    return json(400, { error: "invalid_action" }, cors.headers);
  }

  const { data: store } = await service.from("stores").select("id,store_name,store_slug")
    .eq("owner_user_id", user.id).limit(1).maybeSingle();
  if (!store) return json(403, { error: "seller_store_required" }, cors.headers);
  const { data: connection } = await service.from("store_stripe_connections")
    .select("store_id,stripe_account_id,stripe_livemode").eq("store_id", store.id)
    .eq("stripe_livemode", livemode).maybeSingle();
  if (!connection) return json(403, { error: "connect_not_available" }, cors.headers);

  let accountId = connection.stripe_account_id as string | null;
  if (body.action === "status" && !accountId) {
    return json(200, { state: "not_connected", dashboard_url: null }, cors.headers);
  }

  try {
    if (!accountId) {
      const account = await stripe.accounts.create({
        controller: {
          fees: { payer: "account" },
          losses: { payments: "stripe" },
          requirement_collection: "stripe",
          stripe_dashboard: { type: "full" },
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: { name: store.store_name },
        metadata: { flockfront_store_id: store.id, schema_version: "ff_connect_account_v1" },
      }, { idempotencyKey: `ff-connect-account:${livemode}:${store.id}` });
      accountId = account.id;
      const { error } = await service.from("store_stripe_connections")
        .update({ stripe_account_id: accountId }).eq("store_id", store.id)
        .eq("stripe_livemode", livemode).is("stripe_account_id", null);
      if (error) throw error;
    }

    const account = await stripe.accounts.retrieve(accountId);
    if (body.action === "onboard") {
      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        type: "account_onboarding",
        refresh_url: `${publicSiteOrigin}/dashboard/account?stripe=refresh`,
        return_url: `${publicSiteOrigin}/dashboard/account?stripe=return`,
      });
      return json(200, { state: accountState(account), onboarding_url: accountLink.url }, cors.headers);
    }
    return json(200, {
      state: accountState(account),
      dashboard_url: "https://dashboard.stripe.com/",
    }, cors.headers);
  } catch (error) {
    console.error("stripe-connect-account failed", error instanceof Error ? error.message : "unknown");
    return json(503, { error: "stripe_unavailable", message: "Stripe setup is temporarily unavailable." }, cors.headers);
  }
});

function accountState(account: {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  capabilities?: { card_payments?: string | null };
  requirements?: { disabled_reason?: string | null; past_due?: string[] | null } | null;
}): "incomplete" | "active" | "restricted" {
  const ready = account.capabilities?.card_payments === "active" &&
    account.charges_enabled === true && account.payouts_enabled === true;
  if (ready) return "active";
  if (account.requirements?.disabled_reason || (account.requirements?.past_due?.length ?? 0) > 0) return "restricted";
  return account.details_submitted ? "restricted" : "incomplete";
}

