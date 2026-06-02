import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN") ??
    "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function errorResponse(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): Response {
  return jsonResponse(status, {
    error: {
      code,
      message,
      details: details ?? null,
    },
  });
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error("Missing required environment variable");
  }

  return value;
}

function serializeRpcError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return {
      message: String(error ?? "Unknown RPC error"),
    };
  }

  const record = error as Record<string, unknown>;

  return {
    message: typeof record.message === "string" ? record.message : null,
    code: typeof record.code === "string" ? record.code : null,
    details: typeof record.details === "string" ? record.details : null,
    hint: typeof record.hint === "string" ? record.hint : null,
    name: typeof record.name === "string" ? record.name : null,
  };
}

async function parseRequestBody(req: Request): Promise<{ store_id: string }> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    throw new Error("Request body must be JSON.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object.");
  }

  const storeId = (body as Record<string, unknown>).store_id;

  if (typeof storeId !== "string" || !uuidPattern.test(storeId)) {
    throw new Error("A valid store_id is required.");
  }

  return {
    store_id: storeId,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Use POST for store launch.", 405);
  }

  try {
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return errorResponse("unauthorized", "Authentication required.", 401);
    }

    const { store_id } = await parseRequestBody(req);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return errorResponse("unauthorized", "Authentication required.", 401);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await serviceClient.rpc("trusted_launch_store", {
      p_store_id: store_id,
      p_actor_user_id: user.id,
    });

    if (error) {
      return errorResponse(
        "launch_failed",
        error.message || "Store could not be launched.",
        400,
        serializeRpcError(error),
      );
    }

    return jsonResponse(200, {
      launched: true,
      store: Array.isArray(data) ? data[0] ?? null : data,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Store launch failed.";

    return errorResponse("server_error", message, 500);
  }
});
