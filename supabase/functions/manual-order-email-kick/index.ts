import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import {
  createManualOrderEmailKickHandler,
  type KickAuthorization,
} from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN") ??
    "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();

  if (!value) {
    throw new Error("Missing required environment variable.");
  }

  return value;
}

const supabaseUrl = getRequiredEnv("SUPABASE_URL");
const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const workerSecret = getRequiredEnv("POSTMARK_WORKER_SECRET");

function userClient(authorization: string) {
  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const handler = createManualOrderEmailKickHandler({
  corsHeaders,
  async authenticate(authorization) {
    const {
      data: { user },
      error,
    } = await userClient(authorization).auth.getUser();

    return !error && Boolean(user);
  },
  async resolveRecentOrderId(authorization) {
    const recentCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data, error } = await userClient(authorization)
      .from("email_notifications")
      .select("order_id")
      .in("notification_status", ["pending", "failed"])
      .gte("created_at", recentCutoff)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error || !Array.isArray(data)) return null;

    const orderIds = [
      ...new Set(
        data
          .map((row) => row.order_id)
          .filter((value): value is string => typeof value === "string"),
      ),
    ];

    return orderIds.length === 1 ? orderIds[0] : null;
  },
  async authorizeOrderKick(authorization, orderId) {
    const { data, error } = await userClient(authorization).rpc(
      "seller_request_order_email_processing",
      {
        p_order_id: orderId,
      },
    );

    if (error) {
      throw new Error(error.message || "Order is not available.");
    }

    const rows = Array.isArray(data) ? data as Array<{
      authorized_order_id?: unknown;
      queued_notification_count?: unknown;
    }> : [];
    const row = rows[0];

    if (
      typeof row?.authorized_order_id !== "string" ||
      typeof row?.queued_notification_count !== "number"
    ) {
      throw new Error("Order is not available.");
    }

    return {
      orderId: row.authorized_order_id,
      queuedNotificationCount: row.queued_notification_count,
    } satisfies KickAuthorization;
  },
  async invokeWorker(orderId) {
    const workerUrl =
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/postmark-email-worker`;

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
          batch_size: 5,
          order_id: orderId,
          source: "seller-order",
        }),
      });

      if (!response.ok) {
        console.warn(
          "manual-order-email-kick worker invocation returned non-2xx",
          JSON.stringify({
            status: response.status,
            status_text: response.statusText,
          }),
        );
      }

      return response.ok;
    } catch (error) {
      console.warn(
        "manual-order-email-kick worker invocation failed",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  },
});

Deno.serve(handler);
