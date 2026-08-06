export type ResumeAuthorization = {
  action_state: "created" | "resumable" | "already_requested";
  action_request_id: string;
  store_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_idempotency_key: string | null;
};

export type PlanChangeAuthorization = {
  action_state: "created" | "already_pending";
  plan_change_id: string;
  store_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  source_stripe_price_id: string;
  target_stripe_price_id: string;
  change_timing: "immediate" | "period_end";
  stripe_idempotency_key: string;
  stripe_invoice_id: string | null;
  stripe_schedule_id: string | null;
  effective_at: string | null;
};

export type PlanChangeProviderBinding = {
  stripe_invoice_id?: string;
  stripe_schedule_id?: string;
  effective_at?: string;
  status: "pending_payment" | "scheduled";
};

export type ScheduledChangeCancellation = {
  plan_change_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  stripe_schedule_id: string;
  stripe_idempotency_key: string;
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

export class PlanChangeProviderError extends Error {
  readonly failureCode: string;
  readonly definitive: boolean;
  constructor(failureCode: string, definitive: boolean) {
    super("Stripe subscription plan change failed.");
    this.name = "PlanChangeProviderError";
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
  beginPlanChange: (
    authenticatedUserId: string,
    targetPlanKey: "small_flock" | "full_flock",
    targetBillingCadence: "monthly",
  ) => Promise<PlanChangeAuthorization>;
  requestPlanChange: (
    authorization: PlanChangeAuthorization,
  ) => Promise<PlanChangeProviderBinding>;
  recordPlanChangeProviderBinding: (
    planChangeId: string,
    binding: PlanChangeProviderBinding,
  ) => Promise<void>;
  beginScheduledChangeCancellation: (
    authenticatedUserId: string,
  ) => Promise<ScheduledChangeCancellation>;
  requestScheduledChangeCancellation: (
    authorization: ScheduledChangeCancellation,
  ) => Promise<void>;
  recordScheduledChangeCanceled: (planChangeId: string) => Promise<void>;
  markPlanChangeFailed: (planChangeId: string, failureCode: string) => Promise<void>;
};

type ParsedAction =
  | { action: "resume" }
  | {
    action: "change_plan";
    targetPlanKey: "small_flock" | "full_flock";
    targetBillingCadence: "monthly";
  }
  | { action: "cancel_scheduled_change" };

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

async function parseAction(request: Request): Promise<ParsedAction | null> {
  if (!(request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))) return null;
  if (Number(request.headers.get("content-length") ?? 0) > 1_024) return null;
  const raw = await request.text();
  if (raw.length > 1_024) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.action === "resume" && Object.keys(value).length === 1) {
      return { action: "resume" };
    }
    if (value.action === "cancel_scheduled_change" && Object.keys(value).length === 1) {
      return { action: "cancel_scheduled_change" };
    }
    if (value.action === "change_plan" && Object.keys(value).length === 3 &&
      (value.target_plan_key === "small_flock" || value.target_plan_key === "full_flock") &&
      value.target_billing_cadence === "monthly") {
      return {
        action: "change_plan",
        targetPlanKey: value.target_plan_key,
        targetBillingCadence: "monthly",
      };
    }
    return null;
  } catch {
    return null;
  }
}

function validPlanAuthorization(value: PlanChangeAuthorization): boolean {
  return Boolean(
    value.plan_change_id && value.store_id && value.stripe_customer_id &&
    value.stripe_subscription_id && value.source_stripe_price_id &&
    value.target_stripe_price_id && value.stripe_idempotency_key &&
    ["immediate", "period_end"].includes(value.change_timing),
  );
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
    const authorizationHeader = request.headers.get("Authorization");
    if (!authorizationHeader || !/^Bearer\s+\S+$/i.test(authorizationHeader)) return json(401, { error: "unauthorized" }, headers);
    let userId: string | null = null;
    try { userId = await dependencies.authenticate(authorizationHeader); } catch { /* redacted */ }
    if (!userId) return json(401, { error: "unauthorized" }, headers);
    const action = await parseAction(request);
    if (!action) return json(400, { error: "invalid_request" }, headers);

    if (action.action === "resume") {
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
    }

    if (action.action === "cancel_scheduled_change") {
      let cancellation: ScheduledChangeCancellation;
      try { cancellation = await dependencies.beginScheduledChangeCancellation(userId); } catch {
        return json(409, { error: "scheduled_change_unavailable" }, headers);
      }
      try {
        await dependencies.requestScheduledChangeCancellation(cancellation);
        await dependencies.recordScheduledChangeCanceled(cancellation.plan_change_id);
      } catch {
        return json(503, { error: "scheduled_change_cancellation_pending" }, headers);
      }
      return json(202, { status: "scheduled_change_canceled" }, headers);
    }

    let planChange: PlanChangeAuthorization;
    try {
      planChange = await dependencies.beginPlanChange(
        userId,
        action.targetPlanKey,
        action.targetBillingCadence,
      );
    } catch {
      return json(409, { error: "plan_change_unavailable" }, headers);
    }
    if (!validPlanAuthorization(planChange)) {
      return json(409, { error: "plan_change_unavailable" }, headers);
    }
    if (planChange.action_state === "already_pending" &&
      (planChange.stripe_invoice_id || planChange.stripe_schedule_id)) {
      return json(202, {
        status: planChange.change_timing === "immediate" ? "payment_pending" : "scheduled",
      }, headers);
    }

    let binding: PlanChangeProviderBinding;
    try {
      binding = await dependencies.requestPlanChange(planChange);
    } catch (error) {
      if (error instanceof PlanChangeProviderError && error.definitive) {
        try { await dependencies.markPlanChangeFailed(planChange.plan_change_id, error.failureCode); } catch { /* best effort */ }
      }
      return json(503, { error: "plan_change_confirmation_pending" }, headers);
    }
    try {
      await dependencies.recordPlanChangeProviderBinding(planChange.plan_change_id, binding);
    } catch {
      return json(503, { error: "plan_change_confirmation_pending" }, headers);
    }
    return json(202, { status: binding.status }, headers);
  };
}
