import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { resolveFlockFrontCors } from "../_shared/cors.ts";
import { sendWebinarEmail, type WebinarEmail } from "../webinar-email-worker/email.ts";
import { PostmarkDeliveryError } from "../postmark-email-worker/delivery-state.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(
  status: number,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  const cors = resolveFlockFrontCors(request.headers.get("origin"), {
    configuredOrigin: Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN"),
  });

  if (!cors.originAllowed) {
    return response(403, { error: "cors_origin_not_allowed" }, cors.headers);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors.headers });
  }
  if (request.method !== "POST") {
    return response(405, { error: "method_not_allowed" }, cors.headers);
  }

  const body = await request.json().catch(() => null);
  const token = body && typeof body === "object"
    ? (body as Record<string, unknown>).token
    : null;
  if (typeof token !== "string" || !uuidPattern.test(token)) {
    return response(400, { error: "invalid_request" }, cors.headers);
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const cancellation = await service.rpc("cancel_webinar_registration", {
    p_token: token,
  });
  if (cancellation.error) {
    return response(500, { error: "cancellation_failed" }, cors.headers);
  }

  const result = Array.isArray(cancellation.data)
    ? cancellation.data[0]
    : cancellation.data;
  if (!result) {
    return response(404, { error: "registration_not_found" }, cors.headers);
  }

  if (result.cancellation_status === "canceled") {
    const claim = await service.rpc("claim_webinar_email", {
      p_email_type: "admin_cancellation",
      p_registration_id: result.registration_id,
    });
    const item = (Array.isArray(claim.data) ? claim.data[0] : claim.data) as WebinarEmail | null;
    if (!claim.error && item) {
      try {
        const sent = await sendWebinarEmail(
          item,
          Deno.env.get("POSTMARK_SERVER_TOKEN")!,
        );
        await service.rpc("mark_webinar_email_sent", {
          p_queue_id: item.queue_id,
          p_processing_token: item.processing_token,
          p_provider_message_id: sent.messageId,
        });
      } catch (sendError) {
        const deliveryUnknown = sendError instanceof PostmarkDeliveryError &&
          sendError.outcome === "delivery_unknown";
        await service.rpc(deliveryUnknown
          ? "mark_webinar_email_delivery_unknown"
          : "mark_webinar_email_failed", {
          p_queue_id: item.queue_id,
          p_processing_token: item.processing_token,
          p_error: deliveryUnknown
            ? sendError.message
            : "Immediate admin cancellation notification failed.",
        });
      }
    }
  }

  return response(200, {
    status: result.cancellation_status,
    webinar_title: result.webinar_title,
    starts_at: result.starts_at,
    timezone: result.timezone,
  }, cors.headers);
});
