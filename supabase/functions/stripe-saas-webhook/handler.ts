export const STRIPE_SAAS_WEBHOOK_MAX_BODY_BYTES = 1_048_576;

export const STRIPE_SAAS_WEBHOOK_EVENT_TYPES = Object.freeze([
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.finalization_failed",
] as const);

type VerifiedStripeEvent = {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  account?: string | null;
  data: { object: Record<string, unknown> };
};

export type SaasProviderEventClaim = {
  claim_state:
    | "claimed"
    | "reclaimed"
    | "terminal_duplicate"
    | "deferred_duplicate"
    | "in_progress"
    | "permanent_failure"
    | "conflict";
  processing_status: string;
  attempt_count: number;
  processing_lease_token: string | null;
  lease_expires_at: string | null;
};

type ProviderEventIdentity = {
  providerEventId: string;
  eventType: string;
  providerEventCreatedAt: string;
  payloadHash: string;
  stripeAccountId: string;
  stripeLivemode: boolean;
  environmentId: string;
  providerObjectType: string | null;
  providerObjectId: string | null;
};

type TerminalEventIdentity = Pick<ProviderEventIdentity,
  "providerEventId" | "payloadHash" | "stripeAccountId" | "stripeLivemode">;

export type StripeSaasWebhookDependencies = {
  stripeAccountId: string;
  stripeLivemode: boolean;
  environmentId: string;
  verifySignature: (
    rawBody: Uint8Array,
    signature: string,
  ) => Promise<VerifiedStripeEvent>;
  hashPayload: (rawBody: Uint8Array) => Promise<string>;
  claimEvent: (identity: ProviderEventIdentity) => Promise<SaasProviderEventClaim>;
  markDeferred: (
    identity: TerminalEventIdentity,
    processingLeaseToken: string,
    reasonCode: string,
  ) => Promise<void>;
  markIgnored: (
    identity: TerminalEventIdentity,
    processingLeaseToken: string,
    reasonCode: string,
  ) => Promise<void>;
  markFailed: (
    identity: TerminalEventIdentity,
    processingLeaseToken: string,
    errorCode: string,
    retryable: boolean,
  ) => Promise<void>;
  safeLog?: (record: Record<string, string | number | boolean>) => void;
  now?: () => number;
};

const approvedEventTypes = new Set<string>(STRIPE_SAAS_WEBHOOK_EVENT_TYPES);
const eventIdPattern = /^evt_[A-Za-z0-9]+$/;
const accountIdPattern = /^acct_[A-Za-z0-9]+$/;
const objectTypePattern = /^[a-z][a-z0-9_.]{0,99}$/;
const objectIdPattern = /^[A-Za-z][A-Za-z0-9_]{2,254}$/;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeLog(
  dependencies: StripeSaasWebhookDependencies,
  record: Record<string, string | number | boolean>,
) {
  dependencies.safeLog?.(record);
}

function deferredReason(eventType: string): string {
  if (eventType === "checkout.session.expired") {
    return "awaiting_checkout_expiration_batch";
  }
  if (eventType.startsWith("invoice.")) {
    return "awaiting_immutable_enrollment_binding";
  }
  if (eventType === "customer.subscription.trial_will_end") {
    return "informational_trial_will_end";
  }
  return "awaiting_verified_enrollment_batch";
}

function validateVerifiedEvent(
  value: unknown,
  dependencies: StripeSaasWebhookDependencies,
): {
  event: VerifiedStripeEvent;
  providerObjectType: string;
  providerObjectId: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Partial<VerifiedStripeEvent>;
  if (
    typeof event.id !== "string" || !eventIdPattern.test(event.id) ||
    typeof event.type !== "string" || !objectTypePattern.test(event.type) ||
    !Number.isInteger(event.created) || (event.created ?? 0) <= 0 ||
    typeof event.livemode !== "boolean" ||
    !event.data || typeof event.data !== "object" ||
    !event.data.object || typeof event.data.object !== "object" ||
    Array.isArray(event.data.object)
  ) return null;
  if (event.livemode !== dependencies.stripeLivemode) return null;
  if (event.account != null && event.account !== dependencies.stripeAccountId) {
    return null;
  }
  const providerObjectType = event.data.object.object;
  const providerObjectId = event.data.object.id;
  if (
    typeof providerObjectType !== "string" ||
    !objectTypePattern.test(providerObjectType) ||
    typeof providerObjectId !== "string" ||
    !objectIdPattern.test(providerObjectId)
  ) return null;
  return {
    event: event as VerifiedStripeEvent,
    providerObjectType,
    providerObjectId,
  };
}

export function createStripeSaasWebhookHandler(
  dependencies: StripeSaasWebhookDependencies,
): (request: Request) => Promise<Response> {
  if (!accountIdPattern.test(dependencies.stripeAccountId)) {
    throw new Error("STRIPE_SAAS_WEBHOOK_ACCOUNT_INVALID");
  }

  return async (request: Request) => {
    const startedAt = dependencies.now?.() ?? Date.now();
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method_not_allowed" });
    }
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return jsonResponse(400, { error: "invalid_webhook" });
    }
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return jsonResponse(400, { error: "invalid_webhook_signature" });
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (!Number.isFinite(declaredLength) || declaredLength < 0 ||
      declaredLength > STRIPE_SAAS_WEBHOOK_MAX_BODY_BYTES) {
      return jsonResponse(413, { error: "webhook_too_large" });
    }

    let rawBody: Uint8Array;
    try {
      rawBody = new Uint8Array(await request.arrayBuffer());
    } catch {
      return jsonResponse(400, { error: "invalid_webhook" });
    }
    if (rawBody.byteLength > STRIPE_SAAS_WEBHOOK_MAX_BODY_BYTES) {
      return jsonResponse(413, { error: "webhook_too_large" });
    }

    let verifiedValue: unknown;
    try {
      // The exact bytes are authenticated before any event field is parsed or trusted.
      verifiedValue = await dependencies.verifySignature(rawBody, signature);
    } catch {
      return jsonResponse(400, { error: "invalid_webhook_signature" });
    }

    const verified = validateVerifiedEvent(verifiedValue, dependencies);
    if (!verified) return jsonResponse(400, { error: "invalid_webhook" });

    let payloadHash: string;
    try {
      payloadHash = await dependencies.hashPayload(rawBody);
    } catch {
      return jsonResponse(500, { error: "webhook_processing_failed" });
    }

    const identity: ProviderEventIdentity = {
      providerEventId: verified.event.id,
      eventType: verified.event.type,
      providerEventCreatedAt: new Date(verified.event.created * 1_000).toISOString(),
      payloadHash,
      stripeAccountId: dependencies.stripeAccountId,
      stripeLivemode: dependencies.stripeLivemode,
      environmentId: dependencies.environmentId,
      providerObjectType: verified.providerObjectType,
      providerObjectId: verified.providerObjectId,
    };
    const terminalIdentity: TerminalEventIdentity = identity;

    let claim: SaasProviderEventClaim;
    try {
      claim = await dependencies.claimEvent(identity);
    } catch {
      safeLog(dependencies, {
        event_id: identity.providerEventId,
        event_type: identity.eventType,
        mode: identity.stripeLivemode ? "live" : "test",
        result: "claim_failed",
        error_code: "database_unavailable",
        duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
      });
      return jsonResponse(500, { error: "webhook_processing_failed" });
    }

    if ([
      "terminal_duplicate", "deferred_duplicate", "in_progress",
      "permanent_failure",
    ].includes(
      claim.claim_state,
    )) {
      safeLog(dependencies, {
        event_id: identity.providerEventId,
        event_type: identity.eventType,
        mode: identity.stripeLivemode ? "live" : "test",
        result: claim.claim_state,
        attempt_count: claim.attempt_count,
        duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
      });
      return jsonResponse(200, { received: true });
    }
    if (claim.claim_state === "conflict") {
      safeLog(dependencies, {
        event_id: identity.providerEventId,
        event_type: identity.eventType,
        mode: identity.stripeLivemode ? "live" : "test",
        result: "identity_conflict",
        error_code: "identity_conflict",
        attempt_count: claim.attempt_count,
        duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
      });
      // The conflict is permanent and already audited; acknowledge to prevent
      // an uncontrolled Stripe retry storm while granting no authority.
      return jsonResponse(200, { received: true });
    }

    if (!claim.processing_lease_token) {
      return jsonResponse(500, { error: "webhook_processing_failed" });
    }
    const isInformational = identity.eventType ===
      "customer.subscription.trial_will_end";
    const isDeferred = approvedEventTypes.has(identity.eventType) &&
      !isInformational;
    const reason = isDeferred
      ? deferredReason(identity.eventType)
      : isInformational
      ? "informational_trial_will_end"
      : "unsupported_event_type";
    try {
      if (isDeferred) {
        await dependencies.markDeferred(
          terminalIdentity,
          claim.processing_lease_token,
          reason,
        );
      } else {
        await dependencies.markIgnored(
          terminalIdentity,
          claim.processing_lease_token,
          reason,
        );
      }
    } catch {
      try {
        await dependencies.markFailed(
          terminalIdentity,
          claim.processing_lease_token,
          "deferred_recording_failed",
          true,
        );
      } catch {
        // The database lease permits a later Stripe delivery to reclaim work.
      }
      safeLog(dependencies, {
        event_id: identity.providerEventId,
        event_type: identity.eventType,
        mode: identity.stripeLivemode ? "live" : "test",
        result: "processing_failed",
        error_code: "deferred_recording_failed",
        attempt_count: claim.attempt_count,
        duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
      });
      return jsonResponse(500, { error: "webhook_processing_failed" });
    }

    safeLog(dependencies, {
      event_id: identity.providerEventId,
      event_type: identity.eventType,
      mode: identity.stripeLivemode ? "live" : "test",
      result: reason,
      attempt_count: claim.attempt_count,
      duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
    });
    return jsonResponse(200, { received: true });
  };
}
