import Stripe from "npm:stripe@22.3.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { resolveFlockFrontCors } from "../_shared/cors.ts";
import { createStripeConnectClient } from "../_shared/stripe-connect-client.ts";
import {
  decidePaidCancellationPreflight,
  isProvenFlockFrontRefund,
  isUnfinishedCancellationAction,
  type RefundActionSnapshot,
  type RefundProofEventSnapshot,
  type StripeRefundSnapshot,
} from "../_shared/stripe-connect-refund-proof.ts";

const supportMessage =
  "You’ve already refunded some or all of this order directly through Stripe. To prevent duplicate refunds or incorrect inventory changes, this order can’t be canceled automatically in FlockFront. Please contact FlockFront support to complete the cancellation.";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function strictBoolean(name: string): boolean {
  const value = required(name);
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false.`);
  }
  return value === "true";
}

function json(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function refundSnapshot(refund: Stripe.Refund): StripeRefundSnapshot | null {
  const paymentIntentId = typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
  if (!paymentIntentId) return null;

  return {
    id: refund.id,
    amount: refund.amount,
    currency: refund.currency,
    created: refund.created,
    payment_intent: paymentIntentId,
    metadata: refund.metadata ?? {},
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supabaseUrl = required("SUPABASE_URL");
const anonKey = required("SUPABASE_ANON_KEY");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const livemode = strictBoolean("STRIPE_CONNECT_LIVEMODE");
const environmentId = required("FLOCKFRONT_ENVIRONMENT_ID");
const stripe = createStripeConnectClient(required("STRIPE_CONNECT_API_KEY"));
const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (request) => {
  const cors = resolveFlockFrontCors(request.headers.get("Origin"), {
    configuredOrigin: Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN"),
  });
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: cors.originAllowed ? 204 : 403,
      headers: cors.headers,
    });
  }
  if (!cors.originAllowed) {
    return json(403, { error: "origin_not_allowed" }, cors.headers);
  }
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, cors.headers);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json(401, { error: "unauthorized" }, cors.headers);
  }
  const authenticated = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await authenticated.auth.getUser();
  if (userError || !user) {
    return json(401, { error: "unauthorized" }, cors.headers);
  }

  let body: { order_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_request" }, cors.headers);
  }
  if (typeof body.order_id !== "string" || !uuid.test(body.order_id)) {
    return json(400, { error: "invalid_order" }, cors.headers);
  }

  const { data: order, error: orderError } = await authenticated
    .from("orders")
    .select("id,store_id,order_number,order_status,payment_method,payment_status,payment_provider,total_amount,currency_code")
    .eq("id", body.order_id)
    .maybeSingle();
  if (orderError || !order) {
    return json(404, { status: "ineligible", message: "Order is not available." }, cors.headers);
  }

  if (
    !["pending", "open"].includes(order.order_status) ||
    order.payment_method !== "stripe_checkout" ||
    order.payment_provider !== "stripe" ||
    !["paid", "partially_refunded", "refunded"].includes(order.payment_status)
  ) {
    return json(200, {
      status: "ineligible",
      message: "This order is not eligible for paid cancellation.",
      order_number: order.order_number,
      payment_status: order.payment_status,
    }, cors.headers);
  }

  try {
    const { data: sessions, error: sessionError } = await service
      .from("stripe_checkout_sessions")
      .select("store_id,order_id,stripe_checkout_session_id,stripe_payment_intent_id,amount_total_cents,currency,metadata")
      .eq("store_id", order.store_id)
      .eq("order_id", order.id)
      .eq("metadata->>schema_version", "ff_connect_checkout_v1")
      .limit(2);
    if (sessionError || !sessions || sessions.length !== 1) {
      return json(200, {
        status: "ineligible",
        message: "This order does not have a verified FlockFront Stripe payment.",
        order_number: order.order_number,
        payment_status: order.payment_status,
      }, cors.headers);
    }

    const paymentRecord = sessions[0];
    const accountId = paymentRecord.metadata?.stripe_account_id;
    const paymentIntentId = paymentRecord.stripe_payment_intent_id;
    const orderCurrency = typeof order.currency_code === "string"
      ? order.currency_code.toLowerCase()
      : null;
    if (
      typeof accountId !== "string" ||
      !/^acct_[A-Za-z0-9]+$/.test(accountId) ||
      typeof paymentIntentId !== "string" ||
      !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ||
      paymentRecord.metadata?.stripe_livemode !== livemode ||
      orderCurrency === null ||
      paymentRecord.currency !== orderCurrency
    ) {
      return json(200, {
        status: "ineligible",
        message: "This order does not have a verified FlockFront Stripe payment.",
        order_number: order.order_number,
        payment_status: order.payment_status,
      }, cors.headers);
    }

    const [checkoutSession, paymentIntent] = await Promise.all([
      stripe.checkout.sessions.retrieve(
        paymentRecord.stripe_checkout_session_id,
        {},
        { stripeAccount: accountId },
      ),
      stripe.paymentIntents.retrieve(
        paymentIntentId,
        {},
        { stripeAccount: accountId },
      ),
    ]);
    const sessionPaymentIntentId = typeof checkoutSession.payment_intent === "string"
      ? checkoutSession.payment_intent
      : checkoutSession.payment_intent?.id ?? null;
    if (
      checkoutSession.livemode !== livemode ||
      checkoutSession.mode !== "payment" ||
      checkoutSession.metadata?.schema_version !== "ff_connect_checkout_v1" ||
      checkoutSession.metadata?.environment_id !== environmentId ||
      checkoutSession.metadata?.store_id !== order.store_id ||
      sessionPaymentIntentId !== paymentIntentId ||
      checkoutSession.amount_total !== paymentRecord.amount_total_cents ||
      checkoutSession.currency !== paymentRecord.currency ||
      paymentIntent.livemode !== livemode ||
      paymentIntent.currency !== paymentRecord.currency ||
      paymentIntent.amount_received !== paymentRecord.amount_total_cents
    ) {
      return json(200, {
        status: "ineligible",
        message: "This order’s Stripe payment binding could not be verified.",
        order_number: order.order_number,
        payment_status: order.payment_status,
      }, cors.headers);
    }

    const refunds: Stripe.Refund[] = [];
    let startingAfter: string | undefined;
    do {
      const page = await stripe.refunds.list(
        {
          payment_intent: paymentIntentId,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        },
        { stripeAccount: accountId },
      );
      refunds.push(...page.data);
      startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
      if (page.has_more && !startingAfter) {
        throw new Error("refund_pagination_invalid");
      }
    } while (startingAfter);

    const succeededRefundedCents = refunds
      .filter((refund) => refund.status === "succeeded")
      .reduce((sum, refund) => sum + refund.amount, 0);
    const safeSummary = {
      order_number: order.order_number,
      original_paid_amount: paymentRecord.amount_total_cents / 100,
      total_stripe_refunded_amount: succeededRefundedCents / 100,
      payment_status: succeededRefundedCents <= 0
        ? "paid"
        : succeededRefundedCents >= paymentRecord.amount_total_cents
        ? "refunded"
        : "partially_refunded",
    };

    if (decidePaidCancellationPreflight({
      refundCount: refunds.length,
      provenRefundCount: 0,
      unfinishedActionCount: 0,
    }) === "eligible") {
      return json(200, {
        status: "eligible",
        message: "This order is eligible for FlockFront cancellation. Paid cancellation processing is not enabled yet.",
        ...safeSummary,
      }, cors.headers);
    }

    const { data: actions, error: actionsError } = await service
      .from("order_refunds")
      .select("id,store_id,order_id,idempotency_key,request_hash,refund_amount,refund_method,provider_refund_id,currency_code,stripe_checkout_session_id,stripe_payment_intent_id,stripe_account_id,stripe_livemode,metadata,created_at")
      .eq("store_id", order.store_id)
      .eq("order_id", order.id)
      .eq("refund_method", "stripe");
    if (actionsError) throw actionsError;

    const actionRows = (actions ?? []) as RefundActionSnapshot[];
    const actionIds = actionRows.map((action) => action.id);
    let proofRows: RefundProofEventSnapshot[] = [];
    if (actionIds.length > 0) {
      const { data: events, error: eventsError } = await service
        .from("payment_provider_events")
        .select("provider,event_type,event_status,provider_refund_id,stripe_payment_intent_id,related_refund_id,payload_summary")
        .eq("provider", "stripe")
        .eq("event_type", "refund.created")
        .eq("event_status", "processed")
        .in("related_refund_id", actionIds);
      if (eventsError) throw eventsError;
      proofRows = (events ?? []) as RefundProofEventSnapshot[];
    }

    const provenActions = new Map<string, RefundActionSnapshot>();
    for (const refund of refunds) {
      const snapshot = refundSnapshot(refund);
      if (!snapshot) {
        return json(200, { status: "support_required", message: supportMessage, ...safeSummary }, cors.headers);
      }
      const matchingActions = actionRows.filter((action) => action.provider_refund_id === refund.id);
      if (matchingActions.length !== 1) {
        return json(200, { status: "support_required", message: supportMessage, ...safeSummary }, cors.headers);
      }
      const action = matchingActions[0];
      const matchingProofEvents = proofRows.filter((event) =>
        event.related_refund_id === action.id && event.provider_refund_id === refund.id
      );
      if (
        matchingProofEvents.length !== 1 ||
        !await isProvenFlockFrontRefund({
          action,
          proofEvent: matchingProofEvents[0],
          refund: snapshot,
          binding: {
            storeId: order.store_id,
            orderId: order.id,
            checkoutSessionId: paymentRecord.stripe_checkout_session_id,
            paymentIntentId,
            stripeAccountId: accountId,
            livemode,
            currency: paymentRecord.currency,
          },
        })
      ) {
        return json(200, { status: "support_required", message: supportMessage, ...safeSummary }, cors.headers);
      }
      provenActions.set(action.id, action);
    }

    const unfinished = [...provenActions.values()].filter(isUnfinishedCancellationAction);
    const decision = decidePaidCancellationPreflight({
      refundCount: refunds.length,
      provenRefundCount: provenActions.size,
      unfinishedActionCount: unfinished.length,
    });
    if (decision === "resume_flockfront_action") {
      return json(200, {
        status: "resume_flockfront_action",
        message: "A FlockFront cancellation refund already exists for this order. Paid cancellation recovery is not enabled yet.",
        ...safeSummary,
      }, cors.headers);
    }

    return json(200, {
      status: decision,
      message: "No unfinished FlockFront cancellation action is available for this order.",
      ...safeSummary,
    }, cors.headers);
  } catch (error) {
    console.error(
      "stripe-connect-cancellation-preflight failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json(503, {
      error: "stripe_preflight_unavailable",
      message: "Stripe cancellation eligibility could not be checked. Please try again.",
    }, cors.headers);
  }
});
