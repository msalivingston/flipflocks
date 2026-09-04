import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { sendWebinarEmail, type WebinarEmail } from "./email.ts";
import { PostmarkDeliveryError } from "../postmark-email-worker/delivery-state.ts";

const secretHeader = "x-flockfront-worker-secret";

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });
  const expected = Deno.env.get("POSTMARK_WORKER_SECRET")?.trim();
  if (!expected || request.headers.get(secretHeader)?.trim() !== expected) return response(401, { error: "unauthorized" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const requestedType = (await request.json().catch(() => ({}))).email_type as string | undefined;
  const supportedTypes = new Set(["confirmation", "reminder", "admin_registration", "admin_cancellation"]);
  const requestedClaimType = requestedType && supportedTypes.has(requestedType) ? requestedType : null;
  const claimTypes = requestedClaimType
    ? [requestedClaimType]
    : [null, "admin_registration", "admin_cancellation"];
  const data: WebinarEmail[] = [];
  let claimFailed = false;
  for (const emailType of claimTypes) {
    const claim = await supabase.rpc("claim_webinar_email", { p_email_type: emailType });
    if (claim.error) {
      claimFailed = true;
      break;
    }
    data.push(...((claim.data || []) as WebinarEmail[]));
  }
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of data) {
    const canSend = await supabase.rpc("webinar_email_is_sendable", {
      p_queue_id: item.queue_id,
      p_processing_token: item.processing_token,
    });
    if (canSend.error) {
      await supabase.rpc("mark_webinar_email_failed", {
        p_queue_id: item.queue_id,
        p_processing_token: item.processing_token,
        p_error: "Could not verify webinar email send eligibility.",
      });
      failed += 1;
      continue;
    }
    if (!canSend.data) {
      skipped += 1;
      continue;
    }
    try {
      const result = await sendWebinarEmail(item, Deno.env.get("POSTMARK_SERVER_TOKEN")!);
      await supabase.rpc("mark_webinar_email_sent", { p_queue_id: item.queue_id, p_processing_token: item.processing_token, p_provider_message_id: result.messageId });
      sent += 1;
    } catch (sendError) {
      const deliveryUnknown = sendError instanceof PostmarkDeliveryError &&
        sendError.outcome === "delivery_unknown";
      await supabase.rpc(deliveryUnknown
        ? "mark_webinar_email_delivery_unknown"
        : "mark_webinar_email_failed", {
        p_queue_id: item.queue_id,
        p_processing_token: item.processing_token,
        p_error: sendError instanceof Error ? sendError.message : "Email delivery failed.",
      });
      failed += 1;
    }
  }
  return response(claimFailed ? 500 : 200, {
    claimed: data.length,
    sent,
    failed,
    skipped,
    ...(claimFailed ? { error: "claim_failed" } : {}),
  });
});
