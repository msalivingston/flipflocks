import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { sendWebinarEmail, type WebinarEmail } from "./email.ts";

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
  const { data, error } = await supabase.rpc("claim_webinar_email", { p_email_type: requestedType === "confirmation" || requestedType === "reminder" ? requestedType : null });
  if (error) return response(500, { error: "claim_failed" });
  let sent = 0;
  let failed = 0;
  for (const item of (data || []) as WebinarEmail[]) {
    try {
      const result = await sendWebinarEmail(item, Deno.env.get("POSTMARK_SERVER_TOKEN")!);
      await supabase.rpc("mark_webinar_email_sent", { p_queue_id: item.queue_id, p_processing_token: item.processing_token, p_provider_message_id: result.messageId });
      sent += 1;
    } catch (sendError) {
      await supabase.rpc("mark_webinar_email_failed", { p_queue_id: item.queue_id, p_processing_token: item.processing_token, p_error: sendError instanceof Error ? sendError.message : "Email delivery failed." });
      failed += 1;
    }
  }
  return response(200, { claimed: (data || []).length, sent, failed });
});
