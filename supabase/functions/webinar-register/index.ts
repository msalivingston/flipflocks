import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { sendWebinarEmail, type WebinarEmail } from "../webinar-email-worker/email.ts";
import { resolveFlockFrontCors } from "../_shared/cors.ts";

function response(status: number, body: Record<string, unknown>, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  const cors = resolveFlockFrontCors(request.headers.get("origin"), {
    configuredOrigin: Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN"),
  });

  if (!cors.originAllowed) return response(403, { error: "cors_origin_not_allowed" }, cors.headers);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors.headers });
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" }, cors.headers);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return response(400, { error: "invalid_request" }, cors.headers);
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await service.rpc("register_for_webinar", {
    p_slug: body.slug, p_first_name: body.first_name, p_last_name: body.last_name, p_email: body.email,
    p_business_type: body.business_type, p_annual_birds_sold: body.annual_birds_sold, p_referral_source: body.referral_source || null,
  });
  if (error) {
    if (error.message.includes("ALREADY_REGISTERED")) return response(409, { error: "already_registered" }, cors.headers);
    if (error.message.includes("WEBINAR_NOT_OPEN")) return response(410, { error: "webinar_not_open" }, cors.headers);
    return response(400, { error: "registration_failed" }, cors.headers);
  }
  const registration = Array.isArray(data) ? data[0] : data;
  const claim = await service.rpc("claim_webinar_email", { p_email_type: "confirmation", p_registration_id: registration.registration_id });
  const item = (Array.isArray(claim.data) ? claim.data[0] : claim.data) as WebinarEmail | null;
  if (claim.error || !item) return response(200, { registration_id: registration.registration_id }, cors.headers);
  try {
    const sent = await sendWebinarEmail(item, Deno.env.get("POSTMARK_SERVER_TOKEN")!);
    await service.rpc("mark_webinar_email_sent", { p_queue_id: item.queue_id, p_processing_token: item.processing_token, p_provider_message_id: sent.messageId });
  } catch {
    await service.rpc("mark_webinar_email_failed", { p_queue_id: item.queue_id, p_processing_token: item.processing_token, p_error: "Immediate confirmation delivery failed." });
  }
  return response(200, { registration_id: registration.registration_id }, cors.headers);
});
