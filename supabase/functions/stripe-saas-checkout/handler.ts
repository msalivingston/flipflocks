export type SaasCheckoutAttempt = {
  checkout_state: "created" | "resumable" | "selection_conflict" | "rate_limited";
  attempt_id: string | null;
  store_id: string;
  attempt_status: string | null;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_idempotency_key: string | null;
  session_created_at: string | null;
  session_expires_at: string | null;
  trial_eligibility: "trial_eligible" | "trial_already_used" | null;
  retry_after_seconds: number | null;
};

export type SafeCheckoutSession = {
  id: string;
  url: string | null;
  mode: string | null;
  status: string | null;
  livemode: boolean;
  created: number;
  expires_at: number;
  customer: string | null;
  metadata: Record<string, string>;
};

export type AuthenticatedCheckoutUser = {
  id: string;
  email: string | null;
};

export function checkoutCustomerParameters(
  attempt: Pick<SaasCheckoutAttempt, "stripe_customer_id">,
  authenticatedEmail: string | null,
): { customer: string } | { customer_email: string } {
  if (attempt.stripe_customer_id) {
    return { customer: attempt.stripe_customer_id };
  }
  const email = authenticatedEmail?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error("authenticated_email_unavailable");
  }
  return { customer_email: email };
}

export class CheckoutProviderError extends Error {
  readonly failureCode: string;
  readonly definitive: boolean;

  constructor(
    failureCode: string,
    definitive: boolean,
  ) {
    super("Stripe Checkout Session creation failed.");
    this.name = "CheckoutProviderError";
    this.failureCode = failureCode;
    this.definitive = definitive;
  }
}

export type StripeSaasCheckoutDependencies = {
  allowedOrigin: string;
  stripeLivemode: boolean;
  stripeAccountId: string;
  authenticate: (authorization: string) => Promise<AuthenticatedCheckoutUser | null>;
  beginCheckout: (
    authenticatedUserId: string,
    planKey: "small_flock" | "full_flock",
    cadence: "monthly" | "yearly",
  ) => Promise<SaasCheckoutAttempt>;
  createCheckoutSession: (
    attempt: SaasCheckoutAttempt,
    planKey: "small_flock" | "full_flock",
    cadence: "monthly" | "yearly",
    authenticatedEmail: string | null,
  ) => Promise<SafeCheckoutSession>;
  retrieveCheckoutSession: (sessionId: string) => Promise<SafeCheckoutSession>;
  recordCheckoutSession: (
    attempt: SaasCheckoutAttempt,
    session: SafeCheckoutSession,
  ) => Promise<void>;
  markCheckoutCreationFailed: (
    attemptId: string,
    failureCode: string,
  ) => Promise<void>;
};

const allowedBodyKeys = new Set(["plan_key", "billing_cadence"]);
const checkoutSessionPattern = /^cs_(test|live)_[A-Za-z0-9]+$/;

function responseHeaders(
  dependencies: StripeSaasCheckoutDependencies,
  request: Request,
): Record<string, string> {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin === dependencies.allowedOrigin
      ? dependencies.allowedOrigin
      : dependencies.allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, ...extraHeaders },
  });
}

async function parseRequest(request: Request): Promise<{
  planKey: "small_flock" | "full_flock";
  cadence: "monthly" | "yearly";
}> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new Error("invalid_content_type");
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4_096) throw new Error("request_too_large");

  const rawBody = await request.text();
  if (rawBody.length > 4_096) throw new Error("request_too_large");

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new Error("invalid_request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid_request");
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedBodyKeys.has(key))) {
    throw new Error("invalid_request_fields");
  }
  if (record.plan_key !== "small_flock" && record.plan_key !== "full_flock") {
    throw new Error("invalid_plan");
  }
  if (
    record.billing_cadence !== "monthly" &&
    record.billing_cadence !== "yearly"
  ) {
    throw new Error("invalid_cadence");
  }
  return {
    planKey: record.plan_key,
    cadence: record.billing_cadence,
  };
}

function validCheckoutSession(
  attempt: SaasCheckoutAttempt,
  session: SafeCheckoutSession,
  livemode: boolean,
): boolean {
  const expectedPrefix = livemode ? "cs_live_" : "cs_test_";
  if (
    !checkoutSessionPattern.test(session.id) ||
    !session.id.startsWith(expectedPrefix) ||
    session.livemode !== livemode ||
    session.mode !== "subscription" ||
    session.status !== "open" ||
    session.metadata.checkout_attempt_id !== attempt.attempt_id ||
    !Number.isInteger(session.created) ||
    !Number.isInteger(session.expires_at) ||
    session.expires_at <= session.created
  ) return false;

  if (!session.url) return false;
  try {
    const url = new URL(session.url);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com";
  } catch {
    return false;
  }
}

export function createStripeSaasCheckoutHandler(
  dependencies: StripeSaasCheckoutDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const headers = responseHeaders(dependencies, request);
    const origin = request.headers.get("Origin");

    if (origin && origin !== dependencies.allowedOrigin) {
      return jsonResponse(403, { error: "origin_not_allowed" }, headers);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method_not_allowed" }, headers);
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
      return jsonResponse(401, { error: "unauthorized" }, headers);
    }

    let authenticatedUser: AuthenticatedCheckoutUser | null = null;
    try {
      authenticatedUser = await dependencies.authenticate(authorization);
    } catch {
      // Authentication failures are intentionally indistinguishable.
    }
    if (!authenticatedUser) {
      return jsonResponse(401, { error: "unauthorized" }, headers);
    }

    let intent: Awaited<ReturnType<typeof parseRequest>>;
    try {
      intent = await parseRequest(request);
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_request";
      return jsonResponse(code === "request_too_large" ? 413 : 400, {
        error: code,
      }, headers);
    }

    let attempt: SaasCheckoutAttempt;
    try {
      attempt = await dependencies.beginCheckout(
        authenticatedUser.id,
        intent.planKey,
        intent.cadence,
      );
    } catch {
      return jsonResponse(409, { error: "checkout_unavailable" }, headers);
    }

    if (attempt.checkout_state === "selection_conflict") {
      return jsonResponse(409, { error: "checkout_selection_conflict" }, headers);
    }
    if (attempt.checkout_state === "rate_limited") {
      const retryAfter = Math.max(1, attempt.retry_after_seconds ?? 1);
      return jsonResponse(429, { error: "rate_limited" }, headers, {
        "Retry-After": String(retryAfter),
      });
    }
    if (!attempt.attempt_id || !attempt.stripe_price_id ||
      !attempt.stripe_product_id || !attempt.stripe_idempotency_key ||
      !attempt.trial_eligibility) {
      return jsonResponse(503, { error: "checkout_unavailable" }, headers);
    }

    if (
      attempt.attempt_status === "completed" ||
      attempt.attempt_status === "pending_confirmation"
    ) {
      return jsonResponse(202, { status: "pending_confirmation" }, headers);
    }

    let session: SafeCheckoutSession;
    if (attempt.attempt_status === "open" && attempt.stripe_checkout_session_id) {
      try {
        session = await dependencies.retrieveCheckoutSession(
          attempt.stripe_checkout_session_id,
        );
      } catch {
        return jsonResponse(503, { error: "checkout_temporarily_unavailable" }, headers);
      }
    } else if (attempt.attempt_status === "creating") {
      try {
        session = await dependencies.createCheckoutSession(
          attempt,
          intent.planKey,
          intent.cadence,
          authenticatedUser.email,
        );
      } catch (error) {
        if (error instanceof CheckoutProviderError && error.definitive) {
          try {
            await dependencies.markCheckoutCreationFailed(
              attempt.attempt_id,
              error.failureCode,
            );
          } catch {
            // Failure recording is best effort; no provider details are exposed.
          }
          return jsonResponse(502, { error: "checkout_creation_failed" }, headers);
        }
        return jsonResponse(503, { error: "checkout_temporarily_unavailable" }, headers);
      }
    } else {
      return jsonResponse(409, { error: "checkout_unavailable" }, headers);
    }

    if (!validCheckoutSession(attempt, session, dependencies.stripeLivemode)) {
      return jsonResponse(503, { error: "checkout_provider_response_invalid" }, headers);
    }

    if (!attempt.stripe_checkout_session_id) {
      try {
        await dependencies.recordCheckoutSession(attempt, session);
      } catch {
        return jsonResponse(503, { error: "checkout_confirmation_pending" }, headers);
      }
    }

    return jsonResponse(200, {
      status: "redirect",
      checkout_url: session.url,
    }, headers);
  };
}
