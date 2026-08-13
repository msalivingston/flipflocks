import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import type Stripe from "npm:stripe@22.3.2";
import { resolveFlockFrontCors } from "../_shared/cors.ts";
import { createStripeConnectClient } from "../_shared/stripe-connect-client.ts";

type CheckoutItem = {
  item_type: "listing_inventory" | "equipment_inventory" | "processed_poultry_inventory" | "hatching_egg_inventory";
  item_id: string;
  quantity: number;
};

type StartRequest = {
  action: "start";
  store_slug: string;
  idempotency_key: string;
  buyer_email: string;
  buyer_first_name: string;
  buyer_last_name: string;
  buyer_phone: string;
  delivery_address_line1: string;
  delivery_address_line2?: string | null;
  delivery_city: string;
  delivery_state: string;
  delivery_postal_code: string;
  delivery_country?: string | null;
  buyer_notes?: string | null;
  pickup_note?: string | null;
  pickup_option_id?: string | null;
  fulfillment_method?: "pickup" | "delivery";
  delivery_option_id?: string | null;
  items: CheckoutItem[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionPattern = /^cs_(test|live)_[A-Za-z0-9]+$/;

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
function json(status: number, body: Record<string, unknown>, headers: Record<string, string>, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, ...extra, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
type JsonRecord = Record<string, unknown>;

function first(data: unknown): JsonRecord | null {
  return Array.isArray(data) && data[0] ? data[0] as JsonRecord : null;
}
function cents(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("invalid_amount");
  return Math.round(amount * 100);
}
function buyerIp(request: Request): string | null {
  return request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

const supabaseUrl = required("SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const livemode = strictBoolean("STRIPE_CONNECT_LIVEMODE");
const environmentId = required("FLOCKFRONT_ENVIRONMENT_ID");
const publicSiteOrigin = new URL(required("FLOCKFRONT_PUBLIC_SITE_URL")).origin;
const stripe = createStripeConnectClient(required("STRIPE_CONNECT_API_KEY"));
const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function connectionForStore(storeId: string) {
  const { data } = await service.from("store_stripe_connections")
    .select("stripe_account_id").eq("store_id", storeId).eq("stripe_livemode", livemode).maybeSingle();
  return data?.stripe_account_id as string | null | undefined;
}

async function readyAccount(accountId: string) {
  const account = await stripe.accounts.retrieve(accountId);
  return account.capabilities?.card_payments === "active" &&
    account.charges_enabled === true && account.payouts_enabled === true;
}

async function triggerPostmarkEmailWorker(orderId: string): Promise<void> {
  const workerSecret = Deno.env.get("POSTMARK_WORKER_SECRET")?.trim();

  if (!workerSecret) {
    console.warn("postmark-email-worker invocation skipped: worker secret is not configured");
    return;
  }

  const workerUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/postmark-email-worker`;

  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
        "x-flockfront-worker-secret": workerSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_size: 10,
        order_id: orderId,
        source: "stripe-connect-checkout",
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      console.warn(
        "postmark-email-worker invocation returned non-2xx",
        JSON.stringify({
          status: response.status,
          status_text: response.statusText,
          response_body: responseBody.slice(0, 2000),
        }),
      );
    }
  } catch (error) {
    console.warn(
      "postmark-email-worker invocation failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function settle(session: Stripe.Checkout.Session, accountId: string, outcome: "paid" | "expired") {
  const { data, error } = await service.rpc("settle_storefront_card_checkout", {
    p_stripe_checkout_session_id: session.id,
    p_stripe_account_id: accountId,
    p_stripe_livemode: livemode,
    p_outcome: outcome,
    p_amount_total_cents: session.amount_total ?? 0,
    p_currency: session.currency ?? "usd",
    p_stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
    p_paid_at: outcome === "paid" ? new Date().toISOString() : null,
  });
  if (error) throw error;
  const result = first(data);
  const orderId = result?.order_id;
  if (outcome === "paid" && typeof orderId === "string" && uuid.test(orderId)) {
    await triggerPostmarkEmailWorker(orderId);
  }
  return result;
}

async function cleanStale(storeId: string) {
  const { data } = await service.from("storefront_card_checkout_reservations")
    .select("stripe_checkout_session_id,stripe_account_id")
    .eq("store_id", storeId).lt("expires_at", new Date().toISOString()).limit(3);
  for (const reservation of data ?? []) {
    try {
      let session = await stripe.checkout.sessions.retrieve(
        reservation.stripe_checkout_session_id,
        {},
        { stripeAccount: reservation.stripe_account_id },
      );
      if (session.status === "open") {
        session = await stripe.checkout.sessions.expire(session.id, { stripeAccount: reservation.stripe_account_id });
      }
      if (session.status === "expired") await settle(session, reservation.stripe_account_id, "expired");
      else if (session.status === "complete" && session.payment_status === "paid") await settle(session, reservation.stripe_account_id, "paid");
    } catch (error) {
      console.error("stale connected checkout cleanup failed", error instanceof Error ? error.message : "unknown");
    }
  }
}

Deno.serve(async (request) => {
  const cors = resolveFlockFrontCors(request.headers.get("Origin"), {
    configuredOrigin: Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN"),
  });
  if (request.method === "OPTIONS") return new Response(null, { status: cors.originAllowed ? 204 : 403, headers: cors.headers });
  if (!cors.originAllowed) return json(403, { error: "origin_not_allowed" }, cors.headers);
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, cors.headers);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 64_000) return json(413, { error: "request_too_large" }, cors.headers);

  let body: JsonRecord;
  try { body = await request.json() as JsonRecord; } catch { return json(400, { error: "invalid_request" }, cors.headers); }
  const slug = typeof body.store_slug === "string" ? body.store_slug.trim().toLowerCase() : "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json(400, { error: "invalid_store" }, cors.headers);

  const { data: storefrontRows } = await service.rpc("get_public_storefront_by_slug", { p_store_slug: slug });
  const storefront = first(storefrontRows);
  const storefrontData = storefront?.storefront as JsonRecord | undefined;
  if (storefront?.is_publicly_available !== true || typeof storefrontData?.store_id !== "string") {
    return json(storefront?.store_exists ? 409 : 404, { error: "storefront_unavailable" }, cors.headers);
  }
  const storeId = storefrontData.store_id;
  await cleanStale(storeId);

  if (body.action === "availability") {
    const accountId = await connectionForStore(storeId);
    if (!accountId) return json(200, { available: false }, cors.headers);
    try { return json(200, { available: await readyAccount(accountId) }, cors.headers); }
    catch { return json(200, { available: false }, cors.headers); }
  }

  if (body.action === "status") {
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    if (!sessionPattern.test(sessionId)) return json(400, { error: "invalid_session" }, cors.headers);
    const { data: paidRecord } = await service.from("stripe_checkout_sessions")
      .select("order_id,orders(order_number,total_amount,currency_code,payment_status)")
      .eq("stripe_checkout_session_id", sessionId).maybeSingle();
    if (paidRecord?.order_id) {
      const order = Array.isArray(paidRecord.orders) ? paidRecord.orders[0] : paidRecord.orders;
      return json(200, { status: "paid", order: {
        order_number: order?.order_number ?? null, total_amount: order?.total_amount ?? null,
        currency: order?.currency_code?.toLowerCase() ?? null,
      } }, cors.headers);
    }
    const { data: reservation } = await service.from("storefront_card_checkout_reservations")
      .select("store_id,stripe_account_id,amount_total_cents,currency").eq("stripe_checkout_session_id", sessionId)
      .eq("store_id", storeId).maybeSingle();
    if (!reservation) return json(404, { error: "checkout_not_found" }, cors.headers);
    try {
      const session = await stripe.checkout.sessions.retrieve(
        sessionId,
        {},
        { stripeAccount: reservation.stripe_account_id },
      );
      if (session.metadata?.store_id !== storeId || session.metadata?.environment_id !== environmentId ||
        session.mode !== "payment" || session.livemode !== livemode || session.amount_total !== reservation.amount_total_cents ||
        session.currency !== reservation.currency) throw new Error("session_binding_invalid");
      if (session.status === "complete" && session.payment_status === "paid") {
        const result = await settle(session, reservation.stripe_account_id, "paid");
        return json(200, { status: "paid", order: {
          order_number: result?.order_number ?? null, total_amount: result?.total_amount ?? null, currency: result?.currency ?? null,
        } }, cors.headers);
      }
      if (session.status === "expired") {
        await settle(session, reservation.stripe_account_id, "expired");
        return json(200, { status: "expired" }, cors.headers);
      }
      return json(200, { status: "pending" }, cors.headers);
    } catch (error) {
      console.error("connected checkout status failed", error instanceof Error ? error.message : "unknown");
      return json(503, { error: "checkout_status_unavailable" }, cors.headers);
    }
  }

  if (body.action !== "start") return json(400, { error: "invalid_action" }, cors.headers);
  const start = body as unknown as StartRequest;
  if (!start.idempotency_key || start.idempotency_key.length > 200 || !start.buyer_email ||
    !start.buyer_first_name || !start.buyer_last_name || !start.buyer_phone || !Array.isArray(start.items) || !start.items.length ||
    start.items.some((item) => !item || !["listing_inventory","equipment_inventory","processed_poultry_inventory","hatching_egg_inventory"].includes(item.item_type) || !uuid.test(item.item_id) || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
    return json(400, { error: "invalid_request" }, cors.headers);
  }

  const { data: rateRows, error: rateError } = await service.rpc("consume_public_checkout_rate_limit", {
    p_store_id: storeId, p_idempotency_key: start.idempotency_key, p_buyer_email: start.buyer_email,
    p_buyer_ip: buyerIp(request), p_store_email_limit: 6, p_store_ip_limit: 30, p_store_limit: 120,
  });
  const rate = first(rateRows);
  if (rateError) return json(503, { error: "checkout_protection_unavailable" }, cors.headers);
  if (rate?.allowed !== true) return json(429, { error: "rate_limited" }, cors.headers, { "Retry-After": String(rate?.retry_after_seconds ?? 900) });

  const accountId = await connectionForStore(storeId);
  if (!accountId) return json(409, { error: "card_payments_unavailable" }, cors.headers);
  try {
    if (!await readyAccount(accountId)) return json(409, { error: "card_payments_unavailable" }, cors.headers);
  } catch { return json(503, { error: "card_payments_unavailable" }, cors.headers); }

  const { data: summaryRows, error: summaryError } = await service.rpc("get_public_checkout_summary", {
    p_store_slug: slug, p_items: start.items,
  });
  const summary = first(summaryRows);
  if (summaryError || !summary?.is_checkout_available) {
    return json(409, { error: "checkout_unavailable", message: summary?.message ?? "One or more checkout items are unavailable." }, cors.headers);
  }
  const { data: store } = await service.from("stores").select("currency_code,delivery_enabled")
    .eq("id", storeId).single();
  if (!store) return json(503, { error: "checkout_unavailable" }, cors.headers);
  const currency = String(store.currency_code).toLowerCase();
  let deliveryFee = 0;
  let deliveryName: string | null = null;
  if ((start.fulfillment_method ?? "pickup") === "delivery") {
    const { data: option } = await service.from("store_delivery_options").select("name,price_amount")
      .eq("id", start.delivery_option_id).eq("store_id", storeId).eq("is_active", true).maybeSingle();
    if (!store.delivery_enabled || !option) return json(409, { error: "checkout_unavailable" }, cors.headers);
    deliveryFee = Number(option.price_amount);
    deliveryName = option.name;
  }
  const trustedItems = summary.items as Array<{ item_name: unknown; unit_price: unknown; requested_quantity: unknown }>;
  const lineItems = trustedItems.map((item) => ({
    price_data: { currency, product_data: { name: String(item.item_name).slice(0, 127) }, unit_amount: cents(item.unit_price) },
    quantity: Number(item.requested_quantity),
  }));
  if (deliveryFee > 0) lineItems.push({
    price_data: { currency, product_data: { name: `Delivery — ${deliveryName ?? "Delivery"}` }, unit_amount: cents(deliveryFee) }, quantity: 1,
  });
  const amountTotal = cents(summary.subtotal_amount) + cents(deliveryFee);
  const reservationId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  const metadata = { reservation_id: reservationId, store_id: storeId, environment_id: environmentId, schema_version: "ff_connect_checkout_v1" };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment", payment_method_types: ["card"], line_items: lineItems, customer_email: start.buyer_email.trim().toLowerCase(),
      expires_at: expiresAt, success_url: `${publicSiteOrigin}/store/${slug}/checkout?card_checkout=return&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicSiteOrigin}/store/${slug}/checkout?card_checkout=canceled`, client_reference_id: reservationId, metadata,
      payment_intent_data: { metadata },
    }, { stripeAccount: accountId, idempotencyKey: `ff-connect-checkout:${livemode}:${storeId}:${start.idempotency_key}` });
  } catch {
    return json(503, { error: "stripe_checkout_unavailable" }, cors.headers);
  }

  if (session.status !== "open" || session.livemode !== livemode ||
    session.amount_total !== amountTotal || session.currency !== currency ||
    session.metadata?.reservation_id !== reservationId || session.metadata?.store_id !== storeId) {
    if (session.status === "open") {
      try { await stripe.checkout.sessions.expire(session.id, { stripeAccount: accountId }); } catch { /* best effort */ }
    }
    return json(503, { error: "stripe_checkout_unavailable" }, cors.headers);
  }

  const { error: reserveError } = await service.rpc("reserve_storefront_card_checkout", {
    p_reservation_id: reservationId, p_store_id: storeId, p_stripe_livemode: livemode, p_stripe_account_id: accountId,
    p_stripe_checkout_session_id: session.id, p_expires_at: new Date(session.expires_at * 1000).toISOString(),
    p_amount_total_cents: amountTotal, p_currency: currency, p_buyer_email: start.buyer_email,
    p_buyer_first_name: start.buyer_first_name, p_buyer_last_name: start.buyer_last_name, p_buyer_phone: start.buyer_phone,
    p_items: start.items, p_delivery_address_line1: start.delivery_address_line1, p_delivery_address_line2: start.delivery_address_line2 ?? null,
    p_delivery_city: start.delivery_city, p_delivery_state: start.delivery_state, p_delivery_postal_code: start.delivery_postal_code,
    p_delivery_country: start.delivery_country ?? "US", p_buyer_notes: start.buyer_notes ?? null,
    p_pickup_note: start.pickup_note ?? null, p_buyer_ip_address: buyerIp(request), p_buyer_user_agent: request.headers.get("user-agent"),
    p_pickup_option_id: start.pickup_option_id ?? null, p_fulfillment_method: start.fulfillment_method ?? "pickup",
    p_delivery_option_id: start.delivery_option_id ?? null,
  });
  if (reserveError) {
    try { await stripe.checkout.sessions.expire(session.id, { stripeAccount: accountId }); } catch { /* unseen Session; log only */ }
    return json(409, { error: "checkout_unavailable", message: "One or more items are no longer available." }, cors.headers);
  }
  if (typeof session.url !== "string" || !session.url.startsWith("https://checkout.stripe.com/")) {
    try { await stripe.checkout.sessions.expire(session.id, { stripeAccount: accountId }); } catch { /* best effort */ }
    await settle({ ...session, status: "expired", amount_total: amountTotal, currency }, accountId, "expired");
    return json(503, { error: "stripe_checkout_unavailable" }, cors.headers);
  }
  return json(200, { checkout_url: session.url }, cors.headers);
});
