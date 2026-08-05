export type PortalAction =
  | "manage_billing"
  | "update_payment_method"
  | "invoice_history"
  | "cancel_subscription";

export type PortalActionAuthorization = {
  action_state: "created" | "rate_limited";
  action_request_id: string;
  store_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  retry_after_seconds: number | null;
};

export type SafePortalSession = {
  id: string;
  url: string | null;
  configuration: string;
  customer: string;
  created: number;
  livemode: boolean;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function hasKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

const customerUpdateFields = new Set([
  "address", "email", "name", "phone", "shipping", "tax_id",
]);
const cancellationReasons = new Set([
  "customer_service", "low_quality", "missing_features", "other",
  "switched_service", "too_complex", "too_expensive", "unused",
]);
/**
 * Fail-closed validation of the default Portal configuration assigned by
 * Stripe. Subscription mutation controls remain unreachable even if the
 * Dashboard default drifts after deployment.
 */
export function isApprovedStripePortalConfiguration(
  value: unknown,
  expectedConfigurationId: string,
  expectedLivemode: boolean,
): boolean {
  const configuration = record(value);
  if (!configuration ||
    configuration.id !== expectedConfigurationId ||
    configuration.object !== "billing_portal.configuration" ||
    configuration.active !== true ||
    configuration.is_default !== true ||
    configuration.livemode !== expectedLivemode ||
    configuration.application !== null) return false;

  const features = record(configuration.features);
  if (!features || !hasKeys(features, [
    "customer_update", "invoice_history", "payment_method_update",
    "subscription_cancel", "subscription_pause", "subscription_update",
  ])) return false;

  const customerUpdate = record(features.customer_update);
  const customerAllowed = customerUpdate?.allowed_updates;
  if (!customerUpdate || !hasKeys(customerUpdate, ["allowed_updates", "enabled"]) ||
    typeof customerUpdate.enabled !== "boolean" ||
    !Array.isArray(customerAllowed) ||
    !customerAllowed.every((entry) =>
      typeof entry === "string" && customerUpdateFields.has(entry)
    )) return false;

  const invoiceHistory = record(features.invoice_history);
  if (!invoiceHistory || !hasKeys(invoiceHistory, ["enabled"]) ||
    invoiceHistory.enabled !== true) return false;

  const paymentMethodUpdate = record(features.payment_method_update);
  if (!paymentMethodUpdate || !hasKeys(
    paymentMethodUpdate,
    ["enabled", "payment_method_configuration"],
  ) || paymentMethodUpdate.enabled !== true || !(
    paymentMethodUpdate.payment_method_configuration === null ||
    (typeof paymentMethodUpdate.payment_method_configuration === "string" &&
      /^pmc_[A-Za-z0-9]+$/.test(paymentMethodUpdate.payment_method_configuration))
  )) return false;

  const subscriptionCancel = record(features.subscription_cancel);
  const reason = record(subscriptionCancel?.cancellation_reason);
  if (!subscriptionCancel || !hasKeys(subscriptionCancel, [
    "cancellation_reason", "enabled", "mode", "proration_behavior",
  ]) || subscriptionCancel.enabled !== true ||
    subscriptionCancel.mode !== "at_period_end" ||
    subscriptionCancel.proration_behavior !== "none" ||
    !reason || !hasKeys(reason, ["enabled", "options"]) ||
    typeof reason.enabled !== "boolean" || !Array.isArray(reason.options) ||
    !reason.options.every((entry) =>
      typeof entry === "string" && cancellationReasons.has(entry)
    )) return false;

  const subscriptionPause = record(features.subscription_pause);
  if (!subscriptionPause || !hasKeys(subscriptionPause, ["enabled"]) ||
    subscriptionPause.enabled !== false) return false;

  const subscriptionUpdate = record(features.subscription_update);
  const schedule = record(subscriptionUpdate?.schedule_at_period_end);
  const conditions = schedule?.conditions;
  if (!subscriptionUpdate || !hasKeys(subscriptionUpdate, [
    "billing_cycle_anchor", "default_allowed_updates", "enabled",
    "proration_behavior", "schedule_at_period_end", "trial_update_behavior",
  ], ["products"]) || subscriptionUpdate.enabled !== false ||
    !Array.isArray(subscriptionUpdate.default_allowed_updates) ||
    subscriptionUpdate.default_allowed_updates.length !== 0 ||
    !(subscriptionUpdate.products === undefined ||
      subscriptionUpdate.products === null ||
      (Array.isArray(subscriptionUpdate.products) &&
        subscriptionUpdate.products.length === 0)) ||
    ![null, "unchanged"].includes(subscriptionUpdate.billing_cycle_anchor as null | string) ||
    !["none", "always_invoice"].includes(
      subscriptionUpdate.proration_behavior as string,
    ) ||
    !["continue_trial", "end_trial"].includes(
      subscriptionUpdate.trial_update_behavior as string,
    ) || !schedule || !hasKeys(schedule, ["conditions"]) ||
    !Array.isArray(conditions) || conditions.length !== 0) return false;

  return true;
}

export function buildStripePortalSessionParams(
  action: PortalAction,
  customerId: string,
  subscriptionId: string,
  returnUrl: string,
) {
  const afterCompletion = {
    type: "redirect" as const,
    redirect: { return_url: returnUrl },
  };
  const flowData = action === "update_payment_method"
    ? { type: "payment_method_update" as const, after_completion: afterCompletion }
    : action === "cancel_subscription"
    ? {
      type: "subscription_cancel" as const,
      subscription_cancel: { subscription: subscriptionId },
      after_completion: afterCompletion,
    }
    : undefined;
  return {
    customer: customerId,
    return_url: returnUrl,
    flow_data: flowData,
  };
}

export class PortalProviderError extends Error {
  readonly failureCode: string;
  constructor(failureCode: string) {
    super("Stripe Billing Portal Session creation failed.");
    this.name = "PortalProviderError";
    this.failureCode = failureCode;
  }
}

export type StripeSaasPortalDependencies = {
  allowedOrigin: string;
  stripeLivemode: boolean;
  authenticate: (authorization: string) => Promise<string | null>;
  beginPortalAction: (
    authenticatedUserId: string,
    action: PortalAction,
  ) => Promise<PortalActionAuthorization>;
  createPortalSession: (
    authorization: PortalActionAuthorization,
    action: PortalAction,
  ) => Promise<SafePortalSession>;
  retrievePortalConfiguration: (configurationId: string) => Promise<unknown>;
  recordPortalSession: (
    actionRequestId: string,
    session: SafePortalSession,
  ) => Promise<void>;
  markActionFailed: (actionRequestId: string, failureCode: string) => Promise<void>;
};

const allowedBodyKeys = new Set(["action"]);
const allowedActions = new Set<PortalAction>([
  "manage_billing",
  "update_payment_method",
  "invoice_history",
  "cancel_subscription",
]);

function headers(dependencies: StripeSaasPortalDependencies) {
  return {
    "Access-Control-Allow-Origin": dependencies.allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function json(status: number, body: Record<string, unknown>, responseHeaders: Record<string, string>, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders, ...extra },
  });
}

async function parseAction(request: Request): Promise<PortalAction> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) throw new Error("invalid_content_type");
  if (Number(request.headers.get("content-length") ?? 0) > 2_048) throw new Error("request_too_large");
  const raw = await request.text();
  if (raw.length > 2_048) throw new Error("request_too_large");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new Error("invalid_request"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_request");
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedBodyKeys.has(key))) {
    throw new Error("invalid_request_fields");
  }
  if (!allowedActions.has(record.action as PortalAction)) throw new Error("invalid_action");
  return record.action as PortalAction;
}

export function isSafeStripePortalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "billing.stripe.com" &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

export function createStripeSaasPortalHandler(
  dependencies: StripeSaasPortalDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const responseHeaders = headers(dependencies);
    const origin = request.headers.get("Origin");
    if (origin && origin !== dependencies.allowedOrigin) {
      return json(403, { error: "origin_not_allowed" }, responseHeaders);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, responseHeaders);

    const authorizationHeader = request.headers.get("Authorization");
    if (!authorizationHeader || !/^Bearer\s+\S+$/i.test(authorizationHeader)) {
      return json(401, { error: "unauthorized" }, responseHeaders);
    }
    let userId: string | null = null;
    try { userId = await dependencies.authenticate(authorizationHeader); } catch { /* redacted */ }
    if (!userId) return json(401, { error: "unauthorized" }, responseHeaders);

    let action: PortalAction;
    try { action = await parseAction(request); } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_request";
      return json(code === "request_too_large" ? 413 : 400, { error: code }, responseHeaders);
    }

    let actionAuthorization: PortalActionAuthorization;
    try {
      actionAuthorization = await dependencies.beginPortalAction(userId, action);
    } catch {
      return json(409, { error: "billing_management_unavailable" }, responseHeaders);
    }
    if (actionAuthorization.action_state === "rate_limited") {
      const retryAfter = Math.max(1, actionAuthorization.retry_after_seconds ?? 1);
      return json(429, { error: "rate_limited" }, responseHeaders, { "Retry-After": String(retryAfter) });
    }
    if (!actionAuthorization.stripe_customer_id || !actionAuthorization.stripe_subscription_id) {
      return json(409, { error: "billing_management_unavailable" }, responseHeaders);
    }

    let session: SafePortalSession;
    try {
      session = await dependencies.createPortalSession(actionAuthorization, action);
    } catch (error) {
      const code = error instanceof PortalProviderError
        ? error.failureCode
        : "stripe_portal_request_ambiguous";
      try { await dependencies.markActionFailed(actionAuthorization.action_request_id, code); } catch { /* best effort */ }
      return json(503, { error: "billing_management_temporarily_unavailable" }, responseHeaders);
    }
    if (!/^bps_[A-Za-z0-9]+$/.test(session.id) ||
        !/^bpc_[A-Za-z0-9]+$/.test(session.configuration) ||
        session.customer !== actionAuthorization.stripe_customer_id ||
        session.livemode !== dependencies.stripeLivemode ||
        !Number.isInteger(session.created) ||
        !isSafeStripePortalUrl(session.url)) {
      try {
        await dependencies.markActionFailed(
          actionAuthorization.action_request_id,
          "stripe_portal_response_invalid",
        );
      } catch { /* best effort */ }
      return json(503, { error: "billing_management_temporarily_unavailable" }, responseHeaders);
    }
    let configuration: unknown;
    try {
      configuration = await dependencies.retrievePortalConfiguration(
        session.configuration,
      );
    } catch {
      try {
        await dependencies.markActionFailed(
          actionAuthorization.action_request_id,
          "stripe_portal_configuration_retrieval_failed",
        );
      } catch { /* best effort */ }
      return json(503, { error: "billing_management_temporarily_unavailable" }, responseHeaders);
    }
    if (!isApprovedStripePortalConfiguration(
      configuration,
      session.configuration,
      dependencies.stripeLivemode,
    )) {
      try {
        await dependencies.markActionFailed(
          actionAuthorization.action_request_id,
          "stripe_portal_configuration_unsafe",
        );
      } catch { /* best effort */ }
      return json(503, { error: "billing_management_temporarily_unavailable" }, responseHeaders);
    }
    try {
      await dependencies.recordPortalSession(actionAuthorization.action_request_id, session);
    } catch {
      return json(503, { error: "billing_management_confirmation_pending" }, responseHeaders);
    }
    return json(200, { portal_url: session.url }, responseHeaders);
  };
}
