export type ResumeAuthorization = {
  action_state: "created" | "resumable" | "already_requested";
  action_request_id: string;
  store_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_idempotency_key: string | null;
};

export class ResumeProviderError extends Error {
  readonly failureCode: string;
  readonly definitive: boolean;
  constructor(failureCode: string, definitive: boolean) {
    super("Stripe subscription resume request failed.");
    this.name = "ResumeProviderError";
    this.failureCode = failureCode;
    this.definitive = definitive;
  }
}

export type StripeSaasSubscriptionActionDependencies = {
  allowedOrigin: string;
  authenticate: (authorization: string) => Promise<string | null>;
  beginResume: (authenticatedUserId: string) => Promise<ResumeAuthorization>;
  requestResume: (authorization: ResumeAuthorization) => Promise<void>;
  recordResumeRequested: (actionRequestId: string) => Promise<void>;
  markActionFailed: (actionRequestId: string, failureCode: string) => Promise<void>;
};

function responseHeaders(dependencies: StripeSaasSubscriptionActionDependencies) {
  return {
    "Access-Control-Allow-Origin": dependencies.allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function json(status: number, body: Record<string, unknown>, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function validResumeBody(request: Request): Promise<boolean> {
  if (!(request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))) return false;
  if (Number(request.headers.get("content-length") ?? 0) > 1_024) return false;
  const raw = await request.text();
  if (raw.length > 1_024) return false;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === 1 && value.action === "resume";
  } catch { return false; }
}

export function createStripeSaasSubscriptionActionHandler(
  dependencies: StripeSaasSubscriptionActionDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const headers = responseHeaders(dependencies);
    const origin = request.headers.get("Origin");
    if (origin && origin !== dependencies.allowedOrigin) return json(403, { error: "origin_not_allowed" }, headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, headers);
    const authorization = request.headers.get("Authorization");
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return json(401, { error: "unauthorized" }, headers);
    let userId: string | null = null;
    try { userId = await dependencies.authenticate(authorization); } catch { /* redacted */ }
    if (!userId) return json(401, { error: "unauthorized" }, headers);
    if (!(await validResumeBody(request))) return json(400, { error: "invalid_request" }, headers);

    let resume: ResumeAuthorization;
    try { resume = await dependencies.beginResume(userId); } catch {
      return json(409, { error: "resume_unavailable" }, headers);
    }
    if (resume.action_state === "already_requested") {
      return json(202, { status: "resume_requested" }, headers);
    }
    if (!resume.stripe_subscription_id || !resume.stripe_customer_id || !resume.stripe_idempotency_key) {
      return json(409, { error: "resume_unavailable" }, headers);
    }
    try {
      await dependencies.requestResume(resume);
    } catch (error) {
      const failureCode = error instanceof ResumeProviderError
        ? error.failureCode
        : "stripe_resume_request_ambiguous";
      if (error instanceof ResumeProviderError && error.definitive) {
        try { await dependencies.markActionFailed(resume.action_request_id, failureCode); } catch { /* best effort */ }
      }
      return json(503, { error: "resume_temporarily_unavailable" }, headers);
    }
    try { await dependencies.recordResumeRequested(resume.action_request_id); } catch {
      return json(503, { error: "resume_confirmation_pending" }, headers);
    }
    return json(202, { status: "resume_requested" }, headers);
  };
}
