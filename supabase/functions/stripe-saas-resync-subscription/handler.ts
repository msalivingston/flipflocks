export type SubscriptionResyncResult = {
  status: "applied" | "already_applied";
  scheduled_cancellation: boolean;
};

export type SubscriptionResyncDependencies = {
  allowedOrigin: string;
  authorizeOperator: (authorization: string) => Promise<boolean>;
  resync: () => Promise<SubscriptionResyncResult>;
};

function headers(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function response(status: number, body: Record<string, unknown>, value: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: value });
}

async function hasExactBody(request: Request): Promise<boolean> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return false;
  if (Number(request.headers.get("content-length") ?? 0) > 256) return false;
  const raw = await request.text();
  if (raw.length > 256) return false;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === 1 && value.action === "resync";
  } catch {
    return false;
  }
}

export function createStripeSaasSubscriptionResyncHandler(
  dependencies: SubscriptionResyncDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const responseHeaders = headers(dependencies.allowedOrigin);
    const origin = request.headers.get("Origin");
    if (origin && origin !== dependencies.allowedOrigin) {
      return response(403, { error: "not_authorized" }, responseHeaders);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
    if (request.method !== "POST") return response(405, { error: "method_not_allowed" }, responseHeaders);
    const authorization = request.headers.get("Authorization");
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
      return response(401, { error: "not_authorized" }, responseHeaders);
    }
    let authorized = false;
    try { authorized = await dependencies.authorizeOperator(authorization); } catch { /* redacted */ }
    if (!authorized) return response(403, { error: "not_authorized" }, responseHeaders);
    if (!(await hasExactBody(request))) return response(400, { error: "invalid_request" }, responseHeaders);
    try {
      const result = await dependencies.resync();
      return response(200, result, responseHeaders);
    } catch {
      return response(503, { error: "subscription_resync_unavailable" }, responseHeaders);
    }
  };
}
