export type KickAuthorization = {
  orderId: string;
  queuedNotificationCount: number;
};

export type ManualOrderEmailKickDependencies = {
  authenticate: (authorization: string) => Promise<boolean>;
  authorizeOrderKick: (
    authorization: string,
    orderId: string,
  ) => Promise<KickAuthorization>;
  resolveRecentOrderId: (authorization: string) => Promise<string | null>;
  invokeWorker: (orderId: string) => Promise<boolean>;
  corsHeaders: Record<string, string>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function requestedOrderId(request: Request): Promise<string | null> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > 4_096) {
    throw new Error("request_too_large");
  }

  if (!request.body) return null;

  const rawBody = await request.text();

  if (rawBody.length > 4_096) {
    throw new Error("request_too_large");
  }

  if (!rawBody.trim()) return null;

  const body = JSON.parse(rawBody) as unknown;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid_request");
  }

  const orderId = (body as Record<string, unknown>).order_id;

  if (typeof orderId !== "string" || !uuidPattern.test(orderId.trim())) {
    throw new Error("invalid_order_id");
  }

  return orderId.trim().toLowerCase();
}

export function createManualOrderEmailKickHandler(
  dependencies: ManualOrderEmailKickDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: dependencies.corsHeaders,
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(405, {
        success: false,
        error: "method_not_allowed",
      }, dependencies.corsHeaders);
    }

    const authorization = request.headers.get("Authorization");

    if (!authorization || !(await dependencies.authenticate(authorization))) {
      return jsonResponse(401, {
        success: false,
        error: "unauthorized",
      }, dependencies.corsHeaders);
    }

    let orderId: string | null;

    try {
      orderId = await requestedOrderId(request);
    } catch (error) {
      return jsonResponse(error instanceof Error && error.message === "request_too_large"
        ? 413
        : 400, {
        success: false,
        error: error instanceof Error ? error.message : "invalid_request",
      }, dependencies.corsHeaders);
    }

    // Temporary deployment compatibility for the previous no-body callers.
    // RLS limits this lookup to the authenticated tenant, and ambiguity fails closed.
    orderId ??= await dependencies.resolveRecentOrderId(authorization);

    if (!orderId) {
      return jsonResponse(400, {
        success: false,
        error: "order_scope_required",
      }, dependencies.corsHeaders);
    }

    let authorizationResult: KickAuthorization;

    try {
      authorizationResult = await dependencies.authorizeOrderKick(
        authorization,
        orderId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const rateLimited = /temporarily unavailable|limit reached/i.test(message);

      return jsonResponse(rateLimited ? 429 : 403, {
        success: false,
        error: rateLimited ? "rate_limited" : "forbidden",
      }, dependencies.corsHeaders);
    }

    if (authorizationResult.queuedNotificationCount === 0) {
      return jsonResponse(200, {
        success: true,
        processing_started: false,
        order_id: authorizationResult.orderId,
      }, dependencies.corsHeaders);
    }

    const processingStarted = await dependencies.invokeWorker(
      authorizationResult.orderId,
    );

    return jsonResponse(200, {
      success: processingStarted,
      processing_started: processingStarted,
      order_id: authorizationResult.orderId,
    }, dependencies.corsHeaders);
  };
}
