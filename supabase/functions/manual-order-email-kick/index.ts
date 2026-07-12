import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN") ??
    "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();

  if (!value) {
    throw new Error("Missing required environment variable.");
  }

  return value;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, {
      success: false,
      error: "method_not_allowed",
    });
  }

  const authorization = request.headers.get("Authorization");

  if (!authorization) {
    return jsonResponse(401, {
      success: false,
      error: "unauthorized",
    });
  }

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = getRequiredEnv("POSTMARK_WORKER_SECRET");

  const userClient = createClient(supabaseUrl, anonKey, {
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

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse(401, {
      success: false,
      error: "unauthorized",
    });
  }

  const { data: sellerContext, error: sellerContextError } = await userClient
    .rpc("get_seller_context");

  if (
    sellerContextError ||
    !Array.isArray(sellerContext) ||
    sellerContext.length === 0
  ) {
    return jsonResponse(403, {
      success: false,
      error: "forbidden",
    });
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
        batch_size: 5,
        source: "manual-order",
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

      return jsonResponse(200, {
        success: false,
      });
    }

    return jsonResponse(200, {
      success: true,
    });
  } catch (error) {
    console.warn(
      "manual-order-email-kick worker invocation failed",
      error instanceof Error ? error.message : String(error),
    );

    return jsonResponse(200, {
      success: false,
    });
  }
});
