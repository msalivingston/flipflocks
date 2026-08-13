import Stripe from "npm:stripe@22.3.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { createStripeConnectClient } from "../_shared/stripe-connect-client.ts";
import { assertStripeWebhookTimestampWithinTolerance } from "../_shared/stripe-saas-runtime.mjs";

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
function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stripe = createStripeConnectClient(required("STRIPE_CONNECT_API_KEY"));
const webhookSecret = required("STRIPE_CONNECT_WEBHOOK_SECRET");
const livemode = strictBoolean("STRIPE_CONNECT_LIVEMODE");
const environmentId = required("FLOCKFRONT_ENVIRONMENT_ID");
const supabaseUrl = required("SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
        source: "stripe-connect-webhook",
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

Deno.serve(async (request) => {
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return response(400, { error: "signature_required" });

  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(
      new Uint8Array(await request.arrayBuffer()), signature, webhookSecret, 300,
    );
    assertStripeWebhookTimestampWithinTolerance(signature, 300);
  } catch {
    return response(400, { error: "invalid_signature" });
  }
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") {
    return response(200, { received: true });
  }
  const accountId = event.account;
  if (!accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    return response(400, { error: "connected_account_required" });
  }
  const eventSession = event.data.object as Stripe.Checkout.Session;

  try {
    const session = await stripe.checkout.sessions.retrieve(
      eventSession.id,
      {},
      { stripeAccount: accountId },
    );
    const reservationId = session.metadata?.reservation_id;
    const storeId = session.metadata?.store_id;
    if (!reservationId || !storeId || session.metadata?.environment_id !== environmentId ||
      session.metadata?.schema_version !== "ff_connect_checkout_v1" || session.client_reference_id !== reservationId ||
      session.mode !== "payment" || session.livemode !== livemode) {
      return response(400, { error: "session_binding_invalid" });
    }
    const { data: reservation } = await service.from("storefront_card_checkout_reservations")
      .select("id,store_id,stripe_account_id,stripe_livemode,amount_total_cents,currency")
      .eq("stripe_checkout_session_id", session.id).maybeSingle();
    if (!reservation) {
      const { data: settled } = await service.from("stripe_checkout_sessions")
        .select("id").eq("stripe_checkout_session_id", session.id).maybeSingle();
      if (settled) return response(200, { received: true, duplicate: true });
      if (event.type === "checkout.session.expired") return response(200, { received: true, duplicate: true });
      return response(409, { error: "reservation_not_found" });
    }
    if (reservation.id !== reservationId || reservation.store_id !== storeId ||
      reservation.stripe_account_id !== accountId || reservation.stripe_livemode !== livemode ||
      reservation.amount_total_cents !== session.amount_total || reservation.currency !== session.currency) {
      return response(400, { error: "session_binding_invalid" });
    }

    const outcome = event.type === "checkout.session.completed" ? "paid" : "expired";
    if (outcome === "paid" && (session.status !== "complete" || session.payment_status !== "paid")) {
      return response(409, { error: "payment_not_complete" });
    }
    if (outcome === "expired" && session.status !== "expired") {
      return response(409, { error: "session_not_expired" });
    }
    const paymentIntent = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
    const { data, error } = await service.rpc("settle_storefront_card_checkout", {
      p_stripe_checkout_session_id: session.id,
      p_stripe_account_id: accountId,
      p_stripe_livemode: livemode,
      p_outcome: outcome,
      p_amount_total_cents: session.amount_total ?? 0,
      p_currency: session.currency ?? "usd",
      p_stripe_payment_intent_id: paymentIntent,
      p_paid_at: outcome === "paid" ? new Date(event.created * 1000).toISOString() : null,
    });
    if (error || !Array.isArray(data) || !data[0]) throw error ?? new Error("settlement_failed");
    const orderId = data[0].order_id;
    if (outcome === "paid" && typeof orderId === "string" && uuid.test(orderId)) {
      await triggerPostmarkEmailWorker(orderId);
    }
    return response(200, { received: true });
  } catch (error) {
    console.error("stripe-connect-webhook settlement failed", error instanceof Error ? error.message : "unknown");
    return response(500, { error: "settlement_failed" });
  }
});
