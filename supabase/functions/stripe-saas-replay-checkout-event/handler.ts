export type CheckoutReplayResult = {
  result: string;
  conflict_code: string | null;
  customer_binding_exists: boolean;
  subscription_enrollment_exists: boolean;
  trial_claim_exists: boolean;
  lifecycle_state: string;
};

export type CheckoutReplayEndpointDependencies = {
  allowedOrigin: string;
  authorizeOperator: (authorization: string) => Promise<boolean>;
  replayVerifiedEvent: (eventId: string) => Promise<CheckoutReplayResult>;
};

const RESULT_VALUES = new Set([
  "processed",
  "already_processed",
  "permanent_conflict",
  "in_progress",
  "not_replayable",
  "authority_already_exists",
  "temporarily_unavailable",
]);
const LIFECYCLE_VALUES = new Set([
  "stripe_trial",
  "paid_active",
  "paid_canceling",
  "payment_grace",
  "checkout_in_progress",
  "enrolled_inactive",
  "inactive",
  "unknown",
]);

function headers(allowedOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function emptyResult(result: string): CheckoutReplayResult {
  return {
    result,
    conflict_code: null,
    customer_binding_exists: false,
    subscription_enrollment_exists: false,
    trial_claim_exists: false,
    lifecycle_state: "unknown",
  };
}

function sanitizeResult(value: CheckoutReplayResult): CheckoutReplayResult {
  const result = RESULT_VALUES.has(value.result)
    ? value.result
    : "temporarily_unavailable";
  const conflictCode = typeof value.conflict_code === "string" &&
      /^[a-z0-9_]{1,96}$/.test(value.conflict_code)
    ? value.conflict_code
    : null;
  return {
    result,
    conflict_code: conflictCode,
    customer_binding_exists: value.customer_binding_exists === true,
    subscription_enrollment_exists:
      value.subscription_enrollment_exists === true,
    trial_claim_exists: value.trial_claim_exists === true,
    lifecycle_state: LIFECYCLE_VALUES.has(value.lifecycle_state)
      ? value.lifecycle_state
      : "unknown",
  };
}

function response(
  status: number,
  value: CheckoutReplayResult,
  responseHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(sanitizeResult(value)), {
    status,
    headers: responseHeaders,
  });
}

async function readEventId(request: Request): Promise<string | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith(
    "application/json",
  )) return null;
  if (Number(request.headers.get("content-length") ?? 0) > 512) return null;
  const raw = await request.text();
  if (raw.length > 512) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      typeof value.event_id !== "string" ||
      !/^evt_[A-Za-z0-9]+$/.test(value.event_id)) return null;
    return value.event_id;
  } catch {
    return null;
  }
}

function statusForResult(result: string): number {
  if (["processed", "already_processed", "permanent_conflict", "in_progress"]
    .includes(result)) return 200;
  if (["not_replayable", "authority_already_exists"].includes(result)) {
    return 409;
  }
  return 503;
}

export function createStripeSaasReplayCheckoutEventHandler(
  dependencies: CheckoutReplayEndpointDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const responseHeaders = headers(dependencies.allowedOrigin);
    const origin = request.headers.get("Origin");
    if (origin && origin !== dependencies.allowedOrigin) {
      return response(403, emptyResult("not_replayable"), responseHeaders);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    if (request.method !== "POST") {
      return response(405, emptyResult("not_replayable"), responseHeaders);
    }
    const authorization = request.headers.get("Authorization");
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
      return response(401, emptyResult("not_replayable"), responseHeaders);
    }
    let authorized = false;
    try {
      authorized = await dependencies.authorizeOperator(authorization);
    } catch {
      return response(
        503,
        emptyResult("temporarily_unavailable"),
        responseHeaders,
      );
    }
    if (!authorized) {
      return response(403, emptyResult("not_replayable"), responseHeaders);
    }
    const eventId = await readEventId(request);
    if (!eventId) {
      return response(400, emptyResult("not_replayable"), responseHeaders);
    }
    try {
      const result = await dependencies.replayVerifiedEvent(eventId);
      return response(statusForResult(result.result), result, responseHeaders);
    } catch {
      return response(
        503,
        emptyResult("temporarily_unavailable"),
        responseHeaders,
      );
    }
  };
}
