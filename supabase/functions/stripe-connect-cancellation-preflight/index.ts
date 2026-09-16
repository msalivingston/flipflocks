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
  type TrustedPaymentBinding,
} from "../_shared/stripe-connect-refund-proof.ts";

const supportMessage = "You’ve already refunded some or all of this order directly through Stripe. To prevent duplicate refunds or incorrect inventory changes, this order can’t be canceled automatically in FlockFront. Please contact FlockFront support to complete the cancellation.";
const fulfilledMessage = "This order can’t be canceled automatically because part of it has already been fulfilled. Please contact FlockFront support to complete the cancellation.";

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

async function listAllRefunds(paymentIntentId: string, accountId: string) {
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
    if (page.has_more && !startingAfter) throw new Error("refund_pagination_invalid");
  } while (startingAfter);
  return refunds;
}

type PreparedAction = {
  refund_action_id: string;
  idempotency_key: string;
  request_hash: string;
  refund_amount_cents: number;
  currency: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string;
  stripe_account_id: string;
  stripe_livemode: boolean;
  stripe_metadata: Record<string, string>;
  provider_refund_id: string | null;
  refund_status: string;
  provider_status: string | null;
};

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
    return new Response(null, { status: cors.originAllowed ? 204 : 403, headers: cors.headers });
  }
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

  let body: {
    action?: unknown;
    order_id?: unknown;
    canceled_reason?: unknown;
    send_buyer_notification?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_request" }, cors.headers);
  }
  const action = body.action ?? "preflight";
  if (action !== "preflight" && action !== "cancel_full") {
    return json(400, { error: "invalid_action" }, cors.headers);
  }
  if (typeof body.order_id !== "string" || !uuid.test(body.order_id)) {
    return json(400, { error: "invalid_order" }, cors.headers);
  }
  if (body.canceled_reason != null && typeof body.canceled_reason !== "string") {
    return json(400, { error: "invalid_cancellation_reason" }, cors.headers);
  }
  if (body.send_buyer_notification != null && typeof body.send_buyer_notification !== "boolean") {
    return json(400, { error: "invalid_notification_preference" }, cors.headers);
  }
  const canceledReason = typeof body.canceled_reason === "string"
    ? body.canceled_reason.trim().slice(0, 500) || null
    : null;
  const sendBuyerNotification = body.send_buyer_notification === true;

  const { data: order, error: orderError } = await authenticated.from("orders")
    .select("id,store_id,order_number,order_status,canceled_at,payment_method,payment_status,payment_provider,total_amount,currency_code")
    .eq("id", body.order_id).maybeSingle();
  if (orderError || !order) {
    return json(404, { status: "ineligible", message: "Order is not available." }, cors.headers);
  }
  if (
    action === "cancel_full" && order.order_status === "canceled" &&
    order.payment_method === "stripe_checkout" && order.payment_provider === "stripe" &&
    order.payment_status === "refunded"
  ) {
    const { data: appliedActions, error: appliedError } = await service
      .from("order_refunds")
      .select("id")
      .eq("store_id", order.store_id)
      .eq("order_id", order.id)
      .eq("refund_method", "stripe")
      .eq("refund_status", "succeeded")
      .eq("metadata->>schema_version", "ff_connect_cancellation_v1")
      .eq("metadata->>cancellation_type", "full")
      .eq("metadata->>origin_classification", "flockfront")
      .eq("metadata->>workflow_state", "cancellation_applied")
      .limit(2);
    if (!appliedError && appliedActions?.length === 1) {
      const { data: cancellationEmails } = await service
        .from("email_notifications")
        .select("notification_type")
        .eq("store_id", order.store_id)
        .eq("order_id", order.id)
        .in("notification_type", [
          "buyer_order_canceled",
          "seller_order_canceled_copy",
        ]);
      return json(200, {
        status: "canceled",
        message: "Order canceled and refunded.",
        order: {
          order_id: order.id,
          order_number: order.order_number,
          order_status: order.order_status,
          payment_status: order.payment_status,
          buyer_notification_queued: cancellationEmails?.some((email) =>
            email.notification_type === "buyer_order_canceled"
          ) ?? false,
          seller_copy_queued: cancellationEmails?.some((email) =>
            email.notification_type === "seller_order_canceled_copy"
          ) ?? false,
        },
      }, cors.headers);
    }
  }
  if (
    !["pending", "open"].includes(order.order_status) || order.canceled_at ||
    order.payment_method !== "stripe_checkout" || order.payment_provider !== "stripe" ||
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
    const [{ data: sessions, error: sessionError }, { data: items, error: itemsError }] = await Promise.all([
      service.from("stripe_checkout_sessions")
        .select("store_id,order_id,stripe_checkout_session_id,stripe_payment_intent_id,amount_total_cents,currency,metadata")
        .eq("store_id", order.store_id).eq("order_id", order.id)
        .eq("metadata->>schema_version", "ff_connect_checkout_v1").limit(2),
      service.from("order_items")
        .select("fulfilled_quantity,canceled_quantity,order_item_source,inventory_debited_quantity")
        .eq("store_id", order.store_id).eq("order_id", order.id),
    ]);
    if (sessionError || !sessions || sessions.length !== 1 || itemsError || !items?.length) {
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
    const orderCurrency = typeof order.currency_code === "string" ? order.currency_code.toLowerCase() : null;
    if (
      typeof accountId !== "string" || !/^acct_[A-Za-z0-9]+$/.test(accountId) ||
      typeof paymentIntentId !== "string" || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ||
      paymentRecord.metadata?.stripe_livemode !== livemode || orderCurrency === null ||
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
      stripe.checkout.sessions.retrieve(paymentRecord.stripe_checkout_session_id, {}, { stripeAccount: accountId }),
      stripe.paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: accountId }),
    ]);
    const sessionPaymentIntentId = typeof checkoutSession.payment_intent === "string"
      ? checkoutSession.payment_intent
      : checkoutSession.payment_intent?.id ?? null;
    if (
      checkoutSession.livemode !== livemode || checkoutSession.mode !== "payment" ||
      checkoutSession.metadata?.schema_version !== "ff_connect_checkout_v1" ||
      checkoutSession.metadata?.environment_id !== environmentId ||
      checkoutSession.metadata?.store_id !== order.store_id ||
      sessionPaymentIntentId !== paymentIntentId ||
      checkoutSession.amount_total !== paymentRecord.amount_total_cents ||
      checkoutSession.currency !== paymentRecord.currency ||
      paymentIntent.livemode !== livemode || paymentIntent.currency !== paymentRecord.currency ||
      paymentIntent.amount_received !== paymentRecord.amount_total_cents
    ) {
      return json(200, {
        status: "ineligible",
        message: "This order’s Stripe payment binding could not be verified.",
        order_number: order.order_number,
        payment_status: order.payment_status,
      }, cors.headers);
    }

    const binding: TrustedPaymentBinding = {
      storeId: order.store_id,
      orderId: order.id,
      checkoutSessionId: paymentRecord.stripe_checkout_session_id,
      paymentIntentId,
      stripeAccountId: accountId,
      livemode,
      currency: paymentRecord.currency,
    };

    async function recordProviderRefund(actionId: string, providerRefund: Stripe.Refund) {
      const snapshot = refundSnapshot(providerRefund);
      if (!snapshot || snapshot.payment_intent !== paymentIntentId) {
        throw new Error("stripe_refund_response_binding_invalid");
      }
      const { error } = await service.rpc(
        "record_stripe_full_cancellation_refund_response",
        {
          p_refund_action_id: actionId,
          p_provider_refund_id: providerRefund.id,
          p_provider_status: providerRefund.status ?? "pending",
          p_refund_amount_cents: providerRefund.amount,
          p_currency: providerRefund.currency,
          p_stripe_payment_intent_id: paymentIntentId,
          p_stripe_account_id: accountId,
          p_stripe_livemode: providerRefund.livemode,
          p_stripe_metadata: providerRefund.metadata,
          p_refund_created_at: new Date(providerRefund.created * 1000).toISOString(),
        },
      );
      if (error) throw error;
    }

    async function loadActionsAndProofs() {
      const { data: actions, error: actionsError } = await service.from("order_refunds")
        .select("id,store_id,order_id,idempotency_key,request_hash,refund_amount,refund_method,refund_status,provider_refund_id,provider_status,currency_code,stripe_checkout_session_id,stripe_payment_intent_id,stripe_account_id,stripe_livemode,metadata,created_at")
        .eq("store_id", order.store_id).eq("order_id", order.id).eq("refund_method", "stripe");
      if (actionsError) throw actionsError;
      const actionRows = (actions ?? []) as RefundActionSnapshot[];
      const actionIds = actionRows.map((row) => row.id);
      if (!actionIds.length) return { actionRows, proofRows: [] as RefundProofEventSnapshot[] };
      const { data: events, error: eventsError } = await service.from("payment_provider_events")
        .select("provider,event_type,event_status,provider_refund_id,stripe_payment_intent_id,related_refund_id,payload_summary")
        .eq("provider", "stripe").eq("event_type", "refund.created")
        .eq("event_status", "processed").in("related_refund_id", actionIds);
      if (eventsError) throw eventsError;
      return { actionRows, proofRows: (events ?? []) as RefundProofEventSnapshot[] };
    }

    async function classify(
      refunds: Stripe.Refund[],
      actionRows: RefundActionSnapshot[],
      proofRows: RefundProofEventSnapshot[],
    ) {
      const provenActions = new Map<string, RefundActionSnapshot>();
      for (const refund of refunds) {
        const snapshot = refundSnapshot(refund);
        if (!snapshot) return { safe: false, provenActions };
        const matchingActions = actionRows.filter((row) => row.provider_refund_id === refund.id);
        if (matchingActions.length !== 1) return { safe: false, provenActions };
        const matchedAction = matchingActions[0];
        const matchingEvents = proofRows.filter((event) =>
          event.related_refund_id === matchedAction.id && event.provider_refund_id === refund.id
        );
        if (
          matchingEvents.length > 1 ||
          !await isProvenFlockFrontRefund({
            action: matchedAction,
            proofEvent: matchingEvents[0] ?? null,
            refund: snapshot,
            binding,
          })
        ) return { safe: false, provenActions };
        provenActions.set(matchedAction.id, matchedAction);
      }
      return { safe: true, provenActions };
    }

    let refunds = await listAllRefunds(paymentIntentId, accountId);
    let { actionRows, proofRows } = await loadActionsAndProofs();
    let classification = await classify(refunds, actionRows, proofRows);
    const succeededRefundedCents = refunds.filter((refund) => refund.status === "succeeded")
      .reduce((sum, refund) => sum + refund.amount, 0);
    const safeSummary = {
      order_number: order.order_number,
      original_paid_amount: paymentRecord.amount_total_cents / 100,
      total_stripe_refunded_amount: succeededRefundedCents / 100,
      refund_amount: paymentRecord.amount_total_cents / 100,
      payment_status: succeededRefundedCents <= 0 ? "paid"
        : succeededRefundedCents >= paymentRecord.amount_total_cents ? "refunded"
        : "partially_refunded",
    };

    if (!classification.safe) {
      return json(200, { status: "support_required", message: supportMessage, ...safeSummary }, cors.headers);
    }
    const unfinished = [...classification.provenActions.values()].filter(isUnfinishedCancellationAction);
    const decision = decidePaidCancellationPreflight({
      refundCount: refunds.length,
      provenRefundCount: classification.provenActions.size,
      unfinishedActionCount: unfinished.length,
    });
    if (decision === "support_required") {
      return json(200, { status: "support_required", message: supportMessage, ...safeSummary }, cors.headers);
    }

    const hasFulfilledQuantity = items.some((item) => item.fulfilled_quantity > 0);
    const hasPriorCanceledQuantity = items.some((item) => item.canceled_quantity > 0);
    const hasUnclassifiedDebit = items.some((item) =>
      item.order_item_source !== "custom" && item.inventory_debited_quantity == null
    );
    if (hasFulfilledQuantity) {
      return json(200, { status: "ineligible", message: fulfilledMessage, ...safeSummary }, cors.headers);
    }
    if (hasPriorCanceledQuantity || hasUnclassifiedDebit) {
      return json(200, {
        status: "ineligible",
        message: "This order requires support before it can be canceled.",
        ...safeSummary,
      }, cors.headers);
    }

    if (action === "preflight") {
      if (decision === "eligible") {
        return json(200, {
          status: "eligible",
          message: "This order is eligible for FlockFront cancellation.",
          ...safeSummary,
        }, cors.headers);
      }
      if (decision === "resume_flockfront_action") {
        const resumable = unfinished[0];
        const providerState = refunds.find((refund) =>
          refund.id === resumable.provider_refund_id
        )?.status ?? resumable.refund_status ?? "pending";
        const message = providerState === "succeeded"
          ? "Refund completed. Finish cancellation."
          : providerState === "failed" || providerState === "canceled"
          ? "The Stripe refund failed. The order has not been canceled."
          : "Refund is processing. The order has not been canceled yet.";
        return json(200, {
          status: "resume_flockfront_action",
          refund_state: providerState,
          message,
          ...safeSummary,
        }, cors.headers);
      }
      return json(200, {
        status: "ineligible",
        message: "No unfinished FlockFront cancellation action is available for this order.",
        ...safeSummary,
      }, cors.headers);
    }

    let refundAction: RefundActionSnapshot | undefined;
    if (decision === "resume_flockfront_action") {
      refundAction = unfinished[0];
      const providerRefund = refunds.find((refund) =>
        refund.id === refundAction?.provider_refund_id
      );
      if (!providerRefund) {
        return json(200, { status: "support_required", message: supportMessage, ...safeSummary }, cors.headers);
      }
      if (providerRefund.status === "pending" || providerRefund.status === null) {
        return json(200, {
          status: "refund_processing",
          message: "Refund is processing. The order has not been canceled yet.",
          ...safeSummary,
        }, cors.headers);
      }
      if (providerRefund.status === "failed" || providerRefund.status === "canceled") {
        await recordProviderRefund(refundAction.id, providerRefund);
        return json(200, {
          status: "refund_failed",
          retry_allowed: false,
          message: "The Stripe refund failed. The order remains active. Please try again later or contact support.",
          ...safeSummary,
        }, cors.headers);
      }
      if (providerRefund.status !== "succeeded") {
        return json(200, {
          status: "refund_processing",
          message: "Refund is processing. The order has not been canceled yet.",
          ...safeSummary,
        }, cors.headers);
      }
      if (refundAction.refund_status !== "succeeded" || refundAction.provider_status !== "succeeded") {
        try {
          await recordProviderRefund(refundAction.id, providerRefund);
        } catch {
          return json(200, {
            status: "resume_flockfront_action",
            message: "Refund completed. Finish cancellation.",
            ...safeSummary,
          }, cors.headers);
        }
      }
    } else if (decision !== "eligible") {
      return json(200, {
        status: "ineligible",
        message: "This order is not eligible for paid cancellation.",
        ...safeSummary,
      }, cors.headers);
    }

    let prepared: PreparedAction | undefined;
    if (!refundAction) {
      const { data: preparedData, error: prepareError } = await service.rpc(
        "prepare_stripe_full_cancellation",
        {
          p_order_id: order.id,
          p_actor_user_id: user.id,
          p_canceled_reason: canceledReason,
          p_send_buyer_notification: sendBuyerNotification,
        },
      );
      if (prepareError) throw prepareError;
      prepared = (Array.isArray(preparedData) ? preparedData[0] : preparedData) as PreparedAction | undefined;
      if (!prepared) throw new Error("refund_action_not_prepared");

      let stripeRefund: Stripe.Refund;
      try {
        stripeRefund = await stripe.refunds.create(
          {
            payment_intent: prepared.stripe_payment_intent_id,
            amount: prepared.refund_amount_cents,
            metadata: {
              ...prepared.stripe_metadata,
              ff_schema_version: "ff_connect_cancellation_v1",
            },
          },
          {
            stripeAccount: prepared.stripe_account_id,
            idempotencyKey: prepared.idempotency_key,
          },
        );
      } catch (error) {
        console.error("stripe full cancellation refund request did not complete", error instanceof Error ? error.message : "unknown");
        return json(200, {
          status: "refund_processing",
          retry_allowed: false,
          message: "The refund result could not be confirmed. The order has not been canceled. Check again before retrying.",
          ...safeSummary,
        }, cors.headers);
      }

      try {
        await recordProviderRefund(prepared.refund_action_id, stripeRefund);
      } catch {
        if (stripeRefund.status === "failed" || stripeRefund.status === "canceled") {
          return json(200, {
            status: "refund_failed",
            retry_allowed: false,
            message: "The Stripe refund failed. The order remains active. Please try again later or contact support.",
            ...safeSummary,
          }, cors.headers);
        }
        if (stripeRefund.status !== "succeeded") {
          return json(200, {
            status: "refund_processing",
            message: "Refund is processing. The order has not been canceled yet.",
            ...safeSummary,
          }, cors.headers);
        }
        return json(200, {
          status: "resume_flockfront_action",
          message: "Refund completed. Finish cancellation.",
          ...safeSummary,
        }, cors.headers);
      }
      if (stripeRefund.status === "failed" || stripeRefund.status === "canceled") {
        return json(200, {
          status: "refund_failed",
          retry_allowed: false,
          message: "The Stripe refund failed. The order remains active. Please try again later or contact support.",
          ...safeSummary,
        }, cors.headers);
      }
      if (stripeRefund.status !== "succeeded") {
        return json(200, {
          status: "refund_processing",
          message: "Refund is processing. The order has not been canceled yet.",
          ...safeSummary,
        }, cors.headers);
      }
      refundAction = { id: prepared.refund_action_id } as RefundActionSnapshot;
    }

    // Money is complete; make one last provider-authoritative hard-gate check
    // immediately before any order or inventory mutation.
    refunds = await listAllRefunds(paymentIntentId, accountId);
    ({ actionRows, proofRows } = await loadActionsAndProofs());
    classification = await classify(refunds, actionRows, proofRows);
    const currentAction = actionRows.find((row) => row.id === refundAction?.id);
    if (
      !classification.safe || !currentAction ||
      refunds.some((refund) => refund.id !== currentAction.provider_refund_id)
    ) {
      return json(200, { status: "support_required", message: supportMessage, ...safeSummary }, cors.headers);
    }
    const currentRefund = refunds.find((refund) => refund.id === currentAction.provider_refund_id);
    if (!currentRefund || currentRefund.status !== "succeeded") {
      return json(200, {
        status: "refund_processing",
        message: "Refund is processing. The order has not been canceled yet.",
        ...safeSummary,
      }, cors.headers);
    }

    const { data: finalizedData, error: finalizeError } = await service.rpc(
      "finalize_stripe_full_cancellation",
      {
        p_refund_action_id: currentAction.id,
        p_actor_user_id: user.id,
        p_canceled_reason: canceledReason,
        p_send_buyer_notification: sendBuyerNotification,
      },
    );
    if (finalizeError) {
      console.error("Stripe refund succeeded but cancellation finalization failed", finalizeError.message);
      return json(200, { status: "resume_flockfront_action", message: "Refund completed. Finish cancellation.", ...safeSummary }, cors.headers);
    }
    const finalized = Array.isArray(finalizedData) ? finalizedData[0] : finalizedData;
    return json(200, {
      status: "canceled",
      message: "Order canceled and refunded.",
      order: finalized,
      ...safeSummary,
    }, cors.headers);
  } catch (error) {
    console.error("stripe-connect-cancellation-preflight failed", error instanceof Error ? error.message : "unknown");
    return json(503, {
      error: "stripe_cancellation_unavailable",
      message: "Stripe cancellation could not be completed. The order has not been canceled. Please try again.",
    }, cors.headers);
  }
});
