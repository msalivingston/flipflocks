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

export type SaasDeferredEventClaim = {
  reconciliation_state:
    | "claimed"
    | "reclaimed"
    | "already_processed"
    | "in_progress"
    | "permanent_failure"
    | "conflict"
    | "not_found"
    | "not_deferred";
  processing_status: string | null;
  attempt_count: number;
  processing_lease_token: string | null;
  lease_expires_at: string | null;
  deferred_reason: string | null;
};

export type SaasCheckoutMetadata = {
  checkoutAttemptId: string;
  storeId: string;
  environmentId: string;
  planKey: string;
  billingCadence: string;
  schemaVersion: string;
};

export type SaasCheckoutCompletionEvidence = {
  session: {
    id: string;
    createdAt: string;
    expiresAt: string;
    status: string | null;
    mode: string | null;
    paymentStatus: string | null;
    paymentMethodCollection: string | null;
    clientReferenceId: string | null;
    livemode: boolean;
    customerId: string;
    subscriptionId: string;
    metadata: SaasCheckoutMetadata;
  };
  customer: {
    id: string;
    createdAt: string;
    livemode: boolean;
  };
  subscription: {
    id: string;
    customerId: string;
    status: string;
    createdAt: string;
    trialStart: string | null;
    trialEnd: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    livemode: boolean;
    collectionMethod: string;
    paymentMethodReady: boolean;
    metadata: SaasCheckoutMetadata;
  };
  lineItem: {
    priceId: string;
    productId: string;
    quantity: number;
    priceLivemode: boolean;
    productLivemode: boolean;
    priceActive: boolean;
    productActive: boolean;
    unitAmountCents: number;
    currency: string;
    recurringInterval: string;
    recurringIntervalCount: number;
    priceType: string;
    billingScheme: string;
    recurringUsageType: string;
    taxBehavior: string;
    productTaxCode: string;
  };
};

export type SaasCheckoutApplicationResult = {
  application_state: "trial_enrolled" | "paid_enrollment_pending_invoice";
  store_id: string;
  customer_binding_id: string;
  subscription_enrollment_id: string;
  trial_claimed: boolean;
  billing_complete: boolean;
};

export function checkoutCompletionRpcArguments(
  identity: ProviderEventIdentity,
  processingLeaseToken: string,
  evidence: SaasCheckoutCompletionEvidence,
): Record<string, unknown> {
  const session = evidence.session;
  const customer = evidence.customer;
  const subscription = evidence.subscription;
  const line = evidence.lineItem;
  return {
    p_provider_event_id: identity.providerEventId,
    p_payload_hash: identity.payloadHash,
    p_processing_lease_token: processingLeaseToken,
    p_stripe_account_id: identity.stripeAccountId,
    p_stripe_livemode: identity.stripeLivemode,
    p_environment_id: identity.environmentId,
    p_provider_event_created_at: identity.providerEventCreatedAt,
    p_checkout_session_id: session.id,
    p_session_created_at: session.createdAt,
    p_session_expires_at: session.expiresAt,
    p_session_status: session.status,
    p_session_mode: session.mode,
    p_session_payment_status: session.paymentStatus,
    p_session_payment_method_collection: session.paymentMethodCollection,
    p_session_client_reference_id: session.clientReferenceId,
    p_session_livemode: session.livemode,
    p_attempt_id: session.metadata.checkoutAttemptId,
    p_session_metadata_attempt_id: session.metadata.checkoutAttemptId,
    p_session_metadata_store_id: session.metadata.storeId,
    p_session_metadata_environment_id: session.metadata.environmentId,
    p_session_metadata_plan_key: session.metadata.planKey,
    p_session_metadata_billing_cadence: session.metadata.billingCadence,
    p_session_metadata_schema_version: session.metadata.schemaVersion,
    p_stripe_customer_id: customer.id,
    p_customer_created_at: customer.createdAt,
    p_customer_livemode: customer.livemode,
    p_stripe_subscription_id: subscription.id,
    p_subscription_status: subscription.status,
    p_subscription_created_at: subscription.createdAt,
    p_subscription_trial_start: subscription.trialStart,
    p_subscription_trial_end: subscription.trialEnd,
    p_subscription_current_period_start: subscription.currentPeriodStart,
    p_subscription_current_period_end: subscription.currentPeriodEnd,
    p_subscription_cancel_at_period_end: subscription.cancelAtPeriodEnd,
    p_subscription_livemode: subscription.livemode,
    p_subscription_collection_method: subscription.collectionMethod,
    p_payment_method_ready: subscription.paymentMethodReady,
    p_subscription_metadata_attempt_id:
      subscription.metadata.checkoutAttemptId,
    p_subscription_metadata_store_id: subscription.metadata.storeId,
    p_subscription_metadata_environment_id:
      subscription.metadata.environmentId,
    p_subscription_metadata_plan_key: subscription.metadata.planKey,
    p_subscription_metadata_billing_cadence:
      subscription.metadata.billingCadence,
    p_subscription_metadata_schema_version: subscription.metadata.schemaVersion,
    p_stripe_price_id: line.priceId,
    p_stripe_product_id: line.productId,
    p_line_item_quantity: line.quantity,
    p_price_livemode: line.priceLivemode,
    p_product_livemode: line.productLivemode,
    p_price_active: line.priceActive,
    p_product_active: line.productActive,
    p_unit_amount_cents: line.unitAmountCents,
    p_currency: line.currency,
    p_recurring_interval: line.recurringInterval,
    p_recurring_interval_count: line.recurringIntervalCount,
    p_stripe_price_type: line.priceType,
    p_billing_scheme: line.billingScheme,
    p_recurring_usage_type: line.recurringUsageType,
    p_tax_behavior: line.taxBehavior,
    p_stripe_product_tax_code: line.productTaxCode,
  };
}

export type SaasRecurringPriceEvidence = {
  priceId: string;
  productId: string;
  quantity: number;
  priceLivemode: boolean;
  productLivemode: boolean;
  priceActive: boolean;
  productActive: boolean;
  unitAmountCents: number;
  currency: string;
  recurringInterval: string;
  recurringIntervalCount: number;
  priceType: string;
  billingScheme: string;
  recurringUsageType: string;
  taxBehavior: string;
  productTaxCode: string;
};

export type SaasInvoiceLifecycleEvidence = {
  invoice: {
    id: string;
    livemode: boolean;
    customerId: string;
    subscriptionId: string;
    billingReason: string;
    collectionMethod: string;
    status: string;
    currency: string;
    amountDueCents: number;
    amountPaidCents: number;
    amountRemainingCents: number;
    recurringLineAmountCents: number;
    servicePeriodStart: string;
    servicePeriodEnd: string;
    paidAt: string | null;
    nextPaymentAttemptAt: string | null;
    failureCode: string | null;
  };
  lineItem: SaasRecurringPriceEvidence;
};

export type SaasInvoiceApplicationResult = {
  application_state:
    | "already_processed"
    | "stale_recorded"
    | "paid_through_extended"
    | "payment_recorded"
    | "grace_scheduled"
    | "non_authoritative_payment_recorded"
    | "nonpayment_recorded";
  store_id: string;
  invoice_id: string;
  paid_through_at: string | null;
  grace_ends_at: string | null;
  billing_complete: boolean;
};

export type SaasSubscriptionLifecycleEvidence = {
  subscription: {
    id: string;
    livemode: boolean;
    customerId: string;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    createdAt: string;
    canceledAt: string | null;
    endedAt: string | null;
  };
  lineItem: SaasRecurringPriceEvidence;
};

export type SaasSubscriptionApplicationResult = {
  application_state:
    | "already_processed"
    | "stale_snapshot"
    | "snapshot_applied"
    | "terminal_snapshot_applied";
  store_id: string;
  subscription_status: string;
  paid_through_at: string | null;
  grace_ends_at: string | null;
};

export class SaasWebhookDomainError extends Error {
  readonly errorCode: string;
  readonly retryable: boolean;

  constructor(errorCode: string, retryable: boolean) {
    super("SaaS webhook domain processing failed.");
    this.name = "SaasWebhookDomainError";
    this.errorCode = errorCode;
    this.retryable = retryable;
  }
}

export const ENROLLMENT_RPC_CONFLICT_CODES = Object.freeze({
  SAAS_ENROLLMENT_EVIDENCE_INVALID: "checkout_evidence_invalid",
  SAAS_ENROLLMENT_PROVIDER_SHAPE_INVALID: "checkout_provider_shape_invalid",
  SAAS_ENROLLMENT_EVENT_CLAIM_INVALID: "checkout_event_fence_conflict",
  SAAS_ENROLLMENT_EVENT_FENCE_CONFLICT: "checkout_event_fence_conflict",
  SAAS_ENROLLMENT_ATTEMPT_NOT_FOUND: "checkout_attempt_not_found",
  SAAS_ENROLLMENT_ATTEMPT_CONFLICT: "checkout_attempt_state_mismatch",
  SAAS_ENROLLMENT_ATTEMPT_STATE_MISMATCH: "checkout_attempt_state_mismatch",
  SAAS_ENROLLMENT_SESSION_STATE_MISMATCH: "checkout_session_state_mismatch",
  SAAS_ENROLLMENT_SESSION_ID_MISMATCH: "checkout_session_id_mismatch",
  SAAS_ENROLLMENT_SESSION_TIMESTAMP_MISMATCH:
    "checkout_session_timestamp_mismatch",
  SAAS_ENROLLMENT_SESSION_METADATA_MISMATCH:
    "checkout_session_metadata_mismatch",
  SAAS_ENROLLMENT_SUBSCRIPTION_METADATA_MISMATCH:
    "checkout_subscription_metadata_mismatch",
  SAAS_ENROLLMENT_CUSTOMER_MISMATCH: "checkout_customer_mismatch",
  SAAS_ENROLLMENT_SUBSCRIPTION_MISMATCH: "checkout_subscription_mismatch",
  SAAS_ENROLLMENT_PRICE_MISMATCH: "checkout_price_mismatch",
  SAAS_ENROLLMENT_PRODUCT_MISMATCH: "checkout_product_mismatch",
  SAAS_ENROLLMENT_PLAN_MISMATCH: "checkout_plan_mismatch",
  SAAS_ENROLLMENT_CADENCE_MISMATCH: "checkout_cadence_mismatch",
  SAAS_ENROLLMENT_ACCOUNT_MISMATCH: "checkout_account_mismatch",
  SAAS_ENROLLMENT_LIVEMODE_MISMATCH: "checkout_mode_mismatch",
  SAAS_ENROLLMENT_ENVIRONMENT_MISMATCH: "checkout_environment_mismatch",
  SAAS_ENROLLMENT_SUBSCRIPTION_TIMESTAMP_MISMATCH:
    "checkout_subscription_timestamp_mismatch",
  SAAS_ENROLLMENT_TRIAL_TIMESTAMP_MISMATCH:
    "checkout_trial_timestamp_mismatch",
  SAAS_ENROLLMENT_TRIAL_DURATION_VIOLATION:
    "checkout_trial_duration_violation",
  SAAS_ENROLLMENT_TRIAL_STATE_MISMATCH: "checkout_trial_state_mismatch",
  SAAS_ENROLLMENT_PAYMENT_METHOD_NOT_READY:
    "checkout_payment_method_not_ready",
  SAAS_ENROLLMENT_CATALOG_CONFLICT: "checkout_catalog_validation_failed",
  SAAS_ENROLLMENT_CATALOG_VALIDATION_FAILED:
    "checkout_catalog_validation_failed",
  SAAS_ENROLLMENT_BILLING_STATE_CONFLICT: "checkout_billing_state_conflict",
  SAAS_ENROLLMENT_METADATA_CONFLICT: "checkout_metadata_conflict",
  SAAS_ENROLLMENT_TRIAL_DECISION_INVALID:
    "checkout_trial_decision_invalid",
  SAAS_ENROLLMENT_TRIAL_CONFLICT: "checkout_prior_trial_conflict",
  SAAS_ENROLLMENT_PRIOR_TRIAL_CONFLICT: "checkout_prior_trial_conflict",
  SAAS_ENROLLMENT_TRIAL_USED_CONFLICT: "checkout_trial_used_conflict",
  SAAS_ENROLLMENT_CUSTOMER_CONFLICT:
    "checkout_customer_binding_conflict",
  SAAS_ENROLLMENT_CUSTOMER_BINDING_CONFLICT:
    "checkout_customer_binding_conflict",
  SAAS_ENROLLMENT_SUBSCRIPTION_CONFLICT:
    "checkout_subscription_enrollment_conflict",
  SAAS_ENROLLMENT_SUBSCRIPTION_BINDING_CONFLICT:
    "checkout_subscription_enrollment_conflict",
  SAAS_ENROLLMENT_EVENT_FINALIZATION_FAILED:
    "checkout_event_finalization_failed",
} as const);

export function enrollmentRpcError(
  failure: { message?: string | null },
): SaasWebhookDomainError {
  const { message } = failure;
  const code = ENROLLMENT_RPC_CONFLICT_CODES[
    (message ?? "") as keyof typeof ENROLLMENT_RPC_CONFLICT_CODES
  ];
  return new SaasWebhookDomainError(
    code ?? "checkout_completion_apply_failed",
    code === undefined,
  );
}

export type ProviderEventIdentity = {
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
  claimDeferredEvent: (
    identity: ProviderEventIdentity,
  ) => Promise<SaasDeferredEventClaim>;
  retrieveCheckoutCompletionEvidence: (
    checkoutSessionId: string,
  ) => Promise<SaasCheckoutCompletionEvidence>;
  applyCheckoutCompletion: (
    identity: ProviderEventIdentity,
    processingLeaseToken: string,
    evidence: SaasCheckoutCompletionEvidence,
  ) => Promise<SaasCheckoutApplicationResult>;
  retrieveInvoiceLifecycleEvidence: (
    invoiceId: string,
    eventType: string,
  ) => Promise<SaasInvoiceLifecycleEvidence>;
  applyInvoiceLifecycle: (
    identity: ProviderEventIdentity,
    processingLeaseToken: string,
    evidence: SaasInvoiceLifecycleEvidence,
  ) => Promise<SaasInvoiceApplicationResult>;
  retrieveSubscriptionLifecycleEvidence: (
    subscriptionId: string,
  ) => Promise<SaasSubscriptionLifecycleEvidence>;
  applySubscriptionLifecycle: (
    identity: ProviderEventIdentity,
    processingLeaseToken: string,
    evidence: SaasSubscriptionLifecycleEvidence,
  ) => Promise<SaasSubscriptionApplicationResult>;
  deferSubscriptionUntilEnrollment: (
    identity: ProviderEventIdentity,
    processingLeaseToken: string,
  ) => Promise<void>;
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

export type WebhookDiagnosticCode =
  | "webhook_config_invalid"
  | "webhook_signature_invalid"
  | "webhook_event_claim_failed"
  | "webhook_deferred_claim_failed"
  | "webhook_stripe_retrieval_failed"
  | "webhook_enrollment_binding_failed"
  | "webhook_subscription_snapshot_failed"
  | "webhook_invoice_application_failed"
  | "webhook_event_finalization_failed"
  | "webhook_unexpected_error";

type WebhookDiagnosticDependencies = {
  safeLog?: (record: Record<string, string | number | boolean>) => void;
  now?: () => number;
};

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function safeLog(
  dependencies: StripeSaasWebhookDependencies,
  record: Record<string, string | number | boolean>,
) {
  dependencies.safeLog?.(record);
}

function diagnosticLog(
  dependencies: WebhookDiagnosticDependencies,
  code: WebhookDiagnosticCode,
  stage: string,
  startedAt: number,
  identity?: Pick<ProviderEventIdentity, "providerEventId" | "eventType">,
) {
  const record: Record<string, string | number | boolean> = {
    code,
    stage,
    duration_ms: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt),
  };
  if (identity?.providerEventId) record.event_id = identity.providerEventId;
  if (identity?.eventType) record.event_type = identity.eventType;
  try {
    dependencies.safeLog?.(record);
  } catch {
    // Diagnostics must never alter webhook processing or expose the source error.
  }
}

function processingFailureResponse(
  dependencies: WebhookDiagnosticDependencies,
  code: WebhookDiagnosticCode,
  stage: string,
  startedAt: number,
  identity?: Pick<ProviderEventIdentity, "providerEventId" | "eventType">,
): Response {
  diagnosticLog(dependencies, code, stage, startedAt, identity);
  return jsonResponse(500, {
    error: "webhook_processing_failed",
    code,
  }, { "X-FlockFront-Error-Code": code });
}

function successfulWebhookResponse(
  result: "processed" | "already_processed" | "deferred" | "in_progress",
): Response {
  return jsonResponse(200, { received: true, result });
}

function permanentConflictResponse(code: string): Response {
  const safeCode = /^[a-z][a-z0-9_]{0,99}$/.test(code)
    ? code
    : "checkout_completion_permanent_conflict";
  return jsonResponse(200, {
    received: true,
    result: "permanent_conflict",
    code: safeCode,
  }, { "X-FlockFront-Error-Code": safeCode });
}

export function createStripeSaasWebhookConfigurationErrorHandler(
  dependencies: WebhookDiagnosticDependencies = {},
): (request: Request) => Promise<Response> {
  return async () => processingFailureResponse(
    dependencies,
    "webhook_config_invalid",
    "configuration",
    dependencies.now?.() ?? Date.now(),
  );
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

function expandableId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function validIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validateCheckoutCompletionEvidence(
  signedObject: Record<string, unknown>,
  identity: ProviderEventIdentity,
  evidence: SaasCheckoutCompletionEvidence,
): string | null {
  const signedCustomerId = expandableId(signedObject.customer);
  const signedSubscriptionId = expandableId(signedObject.subscription);
  const session = evidence.session;
  const customer = evidence.customer;
  const subscription = evidence.subscription;
  const line = evidence.lineItem;
  const expectedSessionPrefix = identity.stripeLivemode ? "cs_live_" : "cs_test_";

  if (session.id !== identity.providerObjectId ||
    !session.id.startsWith(expectedSessionPrefix)) {
    return "checkout_session_id_mismatch";
  }
  if (session.livemode !== identity.stripeLivemode ||
    customer.livemode !== identity.stripeLivemode ||
    subscription.livemode !== identity.stripeLivemode ||
    line.priceLivemode !== identity.stripeLivemode ||
    line.productLivemode !== identity.stripeLivemode) {
    return "checkout_mode_mismatch";
  }
  if (session.mode !== "subscription" || session.status !== "complete" ||
    session.paymentMethodCollection !== "always") {
    return "checkout_session_state_mismatch";
  }
  if (!signedCustomerId || signedCustomerId !== session.customerId ||
    customer.id !== session.customerId ||
    subscription.customerId !== session.customerId ||
    !/^cus_[A-Za-z0-9]+$/.test(customer.id)) {
    return "checkout_customer_mismatch";
  }
  if (!signedSubscriptionId || signedSubscriptionId !== session.subscriptionId ||
    subscription.id !== session.subscriptionId ||
    !/^sub_[A-Za-z0-9]+$/.test(subscription.id)) {
    return "checkout_subscription_mismatch";
  }
  if (!/^price_[A-Za-z0-9]+$/.test(line.priceId)) {
    return "checkout_price_mismatch";
  }
  if (!/^prod_[A-Za-z0-9]+$/.test(line.productId)) {
    return "checkout_product_mismatch";
  }

  if (!validIsoTimestamp(session.createdAt) ||
    !validIsoTimestamp(session.expiresAt) ||
    !validIsoTimestamp(customer.createdAt) ||
    !validIsoTimestamp(subscription.createdAt) ||
    !validIsoTimestamp(subscription.currentPeriodStart) ||
    !validIsoTimestamp(subscription.currentPeriodEnd) ||
    Date.parse(session.expiresAt) <= Date.parse(session.createdAt) ||
    Date.parse(identity.providerEventCreatedAt) < Date.parse(session.createdAt) ||
    Date.parse(identity.providerEventCreatedAt) > Date.parse(session.expiresAt) ||
    Date.parse(subscription.currentPeriodEnd) <=
      Date.parse(subscription.currentPeriodStart)) {
    return "checkout_session_timestamp_mismatch";
  }

  if (session.metadata.environmentId !== identity.environmentId ||
    subscription.metadata.environmentId !== identity.environmentId) {
    return "checkout_environment_mismatch";
  }
  for (const [index, metadata] of [
    session.metadata,
    subscription.metadata,
  ].entries()) {
    if (!/^[0-9a-f-]{36}$/i.test(metadata.checkoutAttemptId) ||
      !/^[0-9a-f-]{36}$/i.test(metadata.storeId) ||
      !["small_flock", "full_flock"].includes(metadata.planKey) ||
      !["monthly", "yearly"].includes(metadata.billingCadence) ||
      metadata.schemaVersion !== "ff_saas_checkout_v1") {
      return index === 0
        ? "checkout_session_metadata_mismatch"
        : "checkout_subscription_metadata_mismatch";
    }
  }
  if (session.metadata.checkoutAttemptId !==
      subscription.metadata.checkoutAttemptId ||
    session.metadata.storeId !== subscription.metadata.storeId ||
    session.metadata.planKey !== subscription.metadata.planKey ||
    session.metadata.billingCadence !==
      subscription.metadata.billingCadence ||
    session.clientReferenceId !== session.metadata.checkoutAttemptId) {
    return "checkout_subscription_metadata_mismatch";
  }

  if (!subscription.paymentMethodReady) {
    return "checkout_payment_method_not_ready";
  }
  if (subscription.collectionMethod !== "charge_automatically" ||
    line.quantity !== 1 || !line.priceActive || !line.productActive ||
    line.priceType !== "recurring" || line.billingScheme !== "per_unit" ||
    line.recurringUsageType !== "licensed" ||
    line.taxBehavior !== "exclusive" ||
    line.productTaxCode !== "txcd_10103001" ||
    !Number.isSafeInteger(line.unitAmountCents) || line.unitAmountCents < 0 ||
    !Number.isSafeInteger(line.recurringIntervalCount) ||
    line.recurringIntervalCount < 1) {
    return "checkout_catalog_validation_failed";
  }
  return null;
}

function signedInvoiceSubscriptionId(
  signedObject: Record<string, unknown>,
): string | null {
  const parent = signedObject.parent;
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
    return null;
  }
  const details = (parent as { subscription_details?: unknown })
    .subscription_details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  return expandableId(
    (details as { subscription?: unknown }).subscription,
  );
}

function validateRecurringPriceEvidence(
  line: SaasRecurringPriceEvidence,
  livemode: boolean,
): boolean {
  return /^price_[A-Za-z0-9]+$/.test(line.priceId) &&
    /^prod_[A-Za-z0-9]+$/.test(line.productId) &&
    line.quantity === 1 &&
    line.priceLivemode === livemode &&
    line.productLivemode === livemode &&
    line.priceActive && line.productActive &&
    Number.isSafeInteger(line.unitAmountCents) && line.unitAmountCents >= 0 &&
    /^[a-z]{3}$/.test(line.currency) &&
    ["month", "year"].includes(line.recurringInterval) &&
    Number.isSafeInteger(line.recurringIntervalCount) &&
    line.recurringIntervalCount > 0 &&
    line.priceType === "recurring" &&
    line.billingScheme === "per_unit" &&
    line.recurringUsageType === "licensed" &&
    line.taxBehavior === "exclusive" &&
    line.productTaxCode === "txcd_10103001";
}

function validateInvoiceLifecycleEvidence(
  signedObject: Record<string, unknown>,
  identity: ProviderEventIdentity,
  evidence: SaasInvoiceLifecycleEvidence,
): string | null {
  const invoice = evidence.invoice;
  const signedCustomerId = expandableId(signedObject.customer);
  const signedSubscriptionId = signedInvoiceSubscriptionId(signedObject);
  if (invoice.id !== identity.providerObjectId ||
    !/^in_[A-Za-z0-9]+$/.test(invoice.id) ||
    invoice.livemode !== identity.stripeLivemode ||
    !signedCustomerId || signedCustomerId !== invoice.customerId ||
    !signedSubscriptionId || signedSubscriptionId !== invoice.subscriptionId ||
    !/^cus_[A-Za-z0-9]+$/.test(invoice.customerId) ||
    !/^sub_[A-Za-z0-9]+$/.test(invoice.subscriptionId) ||
    !validateRecurringPriceEvidence(
      evidence.lineItem,
      identity.stripeLivemode,
    )) {
    return "invoice_lifecycle_identity_conflict";
  }
  if (!["charge_automatically", "send_invoice"].includes(
      invoice.collectionMethod,
    ) || !invoice.billingReason || !invoice.status ||
    !/^[a-z]{3}$/.test(invoice.currency) ||
    invoice.currency !== evidence.lineItem.currency ||
    !Number.isSafeInteger(invoice.amountDueCents) ||
    !Number.isSafeInteger(invoice.amountPaidCents) ||
    !Number.isSafeInteger(invoice.amountRemainingCents) ||
    !Number.isSafeInteger(invoice.recurringLineAmountCents) ||
    invoice.amountDueCents < 0 || invoice.amountPaidCents < 0 ||
    invoice.amountRemainingCents < 0 ||
    invoice.recurringLineAmountCents < 0 ||
    invoice.amountPaidCents + invoice.amountRemainingCents !==
      invoice.amountDueCents ||
    invoice.recurringLineAmountCents !== evidence.lineItem.unitAmountCents ||
    !validIsoTimestamp(invoice.servicePeriodStart) ||
    !validIsoTimestamp(invoice.servicePeriodEnd) ||
    Date.parse(invoice.servicePeriodEnd) <=
      Date.parse(invoice.servicePeriodStart) ||
    (invoice.nextPaymentAttemptAt !== null &&
      !validIsoTimestamp(invoice.nextPaymentAttemptAt))) {
    return "invoice_lifecycle_provider_shape_conflict";
  }
  if (identity.eventType === "invoice.payment_succeeded" &&
    (invoice.status !== "paid" || invoice.amountRemainingCents !== 0 ||
      !invoice.paidAt || !validIsoTimestamp(invoice.paidAt))) {
    return "invoice_payment_success_conflict";
  }
  if (identity.eventType === "invoice.payment_failed" &&
    !["open", "uncollectible"].includes(invoice.status)) {
    return "invoice_payment_failure_conflict";
  }
  if (identity.eventType === "invoice.payment_action_required" &&
    invoice.status !== "open") {
    return "invoice_payment_action_conflict";
  }
  if (identity.eventType === "invoice.finalization_failed" &&
    !["draft", "open"].includes(invoice.status)) {
    return "invoice_finalization_conflict";
  }
  return null;
}

function validateSubscriptionLifecycleEvidence(
  signedObject: Record<string, unknown>,
  identity: ProviderEventIdentity,
  evidence: SaasSubscriptionLifecycleEvidence,
): string | null {
  const subscription = evidence.subscription;
  const signedCustomerId = expandableId(signedObject.customer);
  if (subscription.id !== identity.providerObjectId ||
    !/^sub_[A-Za-z0-9]+$/.test(subscription.id) ||
    subscription.livemode !== identity.stripeLivemode ||
    !signedCustomerId || signedCustomerId !== subscription.customerId ||
    !/^cus_[A-Za-z0-9]+$/.test(subscription.customerId) ||
    !validateRecurringPriceEvidence(
      evidence.lineItem,
      identity.stripeLivemode,
    ) ||
    !validIsoTimestamp(subscription.createdAt) ||
    (subscription.currentPeriodStart === null) !==
      (subscription.currentPeriodEnd === null) ||
    (subscription.currentPeriodStart !== null && (
      !validIsoTimestamp(subscription.currentPeriodStart) ||
      !validIsoTimestamp(subscription.currentPeriodEnd!) ||
      Date.parse(subscription.currentPeriodEnd!) <=
        Date.parse(subscription.currentPeriodStart)
    )) ||
    (subscription.canceledAt !== null &&
      !validIsoTimestamp(subscription.canceledAt)) ||
    (subscription.endedAt !== null &&
      !validIsoTimestamp(subscription.endedAt))) {
    return "subscription_lifecycle_identity_conflict";
  }
  if (identity.eventType === "customer.subscription.deleted" &&
    (subscription.status !== "canceled" ||
      (!subscription.canceledAt && !subscription.endedAt))) {
    return "subscription_terminal_shape_conflict";
  }
  return null;
}

async function recordReconciliationFailure(
  dependencies: StripeSaasWebhookDependencies,
  identity: TerminalEventIdentity,
  leaseToken: string,
  errorCode: string,
  retryable: boolean,
): Promise<void> {
  try {
    await dependencies.markFailed(
      identity,
      leaseToken,
      errorCode,
      retryable,
    );
  } catch {
    // The lease remains recoverable; never expose database or provider details.
  }
}

export async function reconcileClaimedCheckoutCompletion(
  dependencies: StripeSaasWebhookDependencies,
  identity: ProviderEventIdentity,
  signedObject: Record<string, unknown> | null,
  startedAt: number,
  claim: SaasDeferredEventClaim,
): Promise<Response> {
  if (!claim.processing_lease_token) {
    return processingFailureResponse(
      dependencies, "webhook_deferred_claim_failed", "deferred_claim",
      startedAt, identity,
    );
  }

  let evidence: SaasCheckoutCompletionEvidence;
  try {
    evidence = await dependencies.retrieveCheckoutCompletionEvidence(
      identity.providerObjectId!,
    );
  } catch (error) {
    const classified = error instanceof SaasWebhookDomainError
      ? error
      : new SaasWebhookDomainError("stripe_retrieval_failed", true);
    await recordReconciliationFailure(
      dependencies,
      identity,
      claim.processing_lease_token,
      classified.errorCode,
      classified.retryable,
    );
    if (classified.retryable) {
      return processingFailureResponse(
        dependencies, "webhook_stripe_retrieval_failed", "stripe_retrieval",
        startedAt, identity,
      );
    }
    diagnosticLog(
      dependencies, "webhook_stripe_retrieval_failed", "stripe_retrieval",
      startedAt, identity,
    );
    return permanentConflictResponse(classified.errorCode);
  }

  const correlationObject = signedObject ?? {
    customer: evidence.session.customerId,
    subscription: evidence.session.subscriptionId,
  };
  const evidenceError = validateCheckoutCompletionEvidence(
    correlationObject,
    identity,
    evidence,
  );
  if (evidenceError) {
    await recordReconciliationFailure(
      dependencies,
      identity,
      claim.processing_lease_token,
      evidenceError,
      false,
    );
    diagnosticLog(
      dependencies, "webhook_enrollment_binding_failed", "enrollment_binding",
      startedAt, identity,
    );
    return permanentConflictResponse(evidenceError);
  }

  try {
    await dependencies.applyCheckoutCompletion(
      identity,
      claim.processing_lease_token,
      evidence,
    );
  } catch (error) {
    const classified = error instanceof SaasWebhookDomainError
      ? error
      : new SaasWebhookDomainError("checkout_completion_apply_failed", true);
    await recordReconciliationFailure(
      dependencies,
      identity,
      claim.processing_lease_token,
      classified.errorCode,
      classified.retryable,
    );
    if (classified.retryable) {
      return processingFailureResponse(
        dependencies, "webhook_enrollment_binding_failed", "enrollment_binding",
        startedAt, identity,
      );
    }
    diagnosticLog(
      dependencies, "webhook_enrollment_binding_failed", "enrollment_binding",
      startedAt, identity,
    );
    return permanentConflictResponse(classified.errorCode);
  }

  safeLog(dependencies, {
    event_id: identity.providerEventId,
    event_type: identity.eventType,
    mode: identity.stripeLivemode ? "live" : "test",
    result: "verified_checkout_applied",
    attempt_count: claim.attempt_count,
    duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
  });
  return successfulWebhookResponse("processed");
}

async function reconcileCheckoutCompletion(
  dependencies: StripeSaasWebhookDependencies,
  identity: ProviderEventIdentity,
  signedObject: Record<string, unknown>,
  startedAt: number,
): Promise<Response> {
  let claim: SaasDeferredEventClaim;
  try {
    claim = await dependencies.claimDeferredEvent(identity);
  } catch {
    return processingFailureResponse(
      dependencies, "webhook_deferred_claim_failed", "deferred_claim",
      startedAt, identity,
    );
  }

  if (claim.reconciliation_state === "already_processed") {
    return successfulWebhookResponse("already_processed");
  }
  if (claim.reconciliation_state === "in_progress") {
    return successfulWebhookResponse("in_progress");
  }
  if ([
    "permanent_failure", "conflict", "not_found", "not_deferred",
  ].includes(claim.reconciliation_state)) {
    safeLog(dependencies, {
      event_id: identity.providerEventId,
      event_type: identity.eventType,
      mode: identity.stripeLivemode ? "live" : "test",
      result: claim.reconciliation_state,
      attempt_count: claim.attempt_count,
      duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
    });
    return permanentConflictResponse(
      claim.reconciliation_state === "permanent_failure"
        ? "checkout_completion_permanent_failure"
        : `checkout_completion_${claim.reconciliation_state}`,
    );
  }
  return await reconcileClaimedCheckoutCompletion(
    dependencies,
    identity,
    signedObject,
    startedAt,
    claim,
  );
}

async function beginDeferredReconciliation(
  dependencies: StripeSaasWebhookDependencies,
  identity: ProviderEventIdentity,
  startedAt: number,
): Promise<SaasDeferredEventClaim | Response> {
  let claim: SaasDeferredEventClaim;
  try {
    claim = await dependencies.claimDeferredEvent(identity);
  } catch {
    return processingFailureResponse(
      dependencies, "webhook_deferred_claim_failed", "deferred_claim",
      startedAt, identity,
    );
  }
  if (["already_processed", "in_progress"].includes(
    claim.reconciliation_state,
  )) {
    return jsonResponse(200, { received: true });
  }
  if ([
    "permanent_failure", "conflict", "not_found", "not_deferred",
  ].includes(claim.reconciliation_state)) {
    safeLog(dependencies, {
      event_id: identity.providerEventId,
      event_type: identity.eventType,
      mode: identity.stripeLivemode ? "live" : "test",
      result: claim.reconciliation_state,
      attempt_count: claim.attempt_count,
      duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
    });
    return jsonResponse(200, { received: true });
  }
  if (!claim.processing_lease_token) {
    return processingFailureResponse(
      dependencies, "webhook_deferred_claim_failed", "deferred_claim",
      startedAt, identity,
    );
  }
  return claim;
}

async function reconcileInvoiceLifecycle(
  dependencies: StripeSaasWebhookDependencies,
  identity: ProviderEventIdentity,
  signedObject: Record<string, unknown>,
  startedAt: number,
): Promise<Response> {
  const claim = await beginDeferredReconciliation(
    dependencies,
    identity,
    startedAt,
  );
  if (claim instanceof Response) return claim;
  const leaseToken = claim.processing_lease_token!;

  let evidence: SaasInvoiceLifecycleEvidence;
  try {
    evidence = await dependencies.retrieveInvoiceLifecycleEvidence(
      identity.providerObjectId!,
      identity.eventType,
    );
  } catch (error) {
    const classified = error instanceof SaasWebhookDomainError
      ? error
      : new SaasWebhookDomainError("invoice_retrieval_failed", true);
    await recordReconciliationFailure(
      dependencies, identity, leaseToken,
      classified.errorCode, classified.retryable,
    );
    if (classified.retryable) {
      return processingFailureResponse(
        dependencies, "webhook_stripe_retrieval_failed", "stripe_retrieval",
        startedAt, identity,
      );
    }
    diagnosticLog(
      dependencies, "webhook_stripe_retrieval_failed", "stripe_retrieval",
      startedAt, identity,
    );
    return jsonResponse(200, { received: true });
  }

  const evidenceError = validateInvoiceLifecycleEvidence(
    signedObject,
    identity,
    evidence,
  );
  if (evidenceError) {
    await recordReconciliationFailure(
      dependencies, identity, leaseToken, evidenceError, false,
    );
    diagnosticLog(
      dependencies, "webhook_enrollment_binding_failed", "enrollment_binding",
      startedAt, identity,
    );
    return jsonResponse(200, { received: true });
  }

  try {
    await dependencies.applyInvoiceLifecycle(identity, leaseToken, evidence);
  } catch (error) {
    const classified = error instanceof SaasWebhookDomainError
      ? error
      : new SaasWebhookDomainError("invoice_application_failed", true);
    await recordReconciliationFailure(
      dependencies, identity, leaseToken,
      classified.errorCode, classified.retryable,
    );
    if (classified.retryable) {
      return processingFailureResponse(
        dependencies, "webhook_invoice_application_failed", "invoice_application",
        startedAt, identity,
      );
    }
    diagnosticLog(
      dependencies, "webhook_invoice_application_failed", "invoice_application",
      startedAt, identity,
    );
    return jsonResponse(200, { received: true });
  }

  safeLog(dependencies, {
    event_id: identity.providerEventId,
    event_type: identity.eventType,
    invoice_id: identity.providerObjectId!,
    mode: identity.stripeLivemode ? "live" : "test",
    result: "verified_invoice_applied",
    attempt_count: claim.attempt_count,
    duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
  });
  return jsonResponse(200, { received: true });
}

async function reconcileSubscriptionLifecycle(
  dependencies: StripeSaasWebhookDependencies,
  identity: ProviderEventIdentity,
  signedObject: Record<string, unknown>,
  startedAt: number,
): Promise<Response> {
  const claim = await beginDeferredReconciliation(
    dependencies,
    identity,
    startedAt,
  );
  if (claim instanceof Response) return claim;
  const leaseToken = claim.processing_lease_token!;

  let evidence: SaasSubscriptionLifecycleEvidence;
  try {
    evidence = await dependencies.retrieveSubscriptionLifecycleEvidence(
      identity.providerObjectId!,
    );
  } catch (error) {
    const classified = error instanceof SaasWebhookDomainError
      ? error
      : new SaasWebhookDomainError("subscription_retrieval_failed", true);
    await recordReconciliationFailure(
      dependencies, identity, leaseToken,
      classified.errorCode, classified.retryable,
    );
    if (classified.retryable) {
      return processingFailureResponse(
        dependencies, "webhook_stripe_retrieval_failed", "stripe_retrieval",
        startedAt, identity,
      );
    }
    diagnosticLog(
      dependencies, "webhook_stripe_retrieval_failed", "stripe_retrieval",
      startedAt, identity,
    );
    return jsonResponse(200, { received: true });
  }

  const evidenceError = validateSubscriptionLifecycleEvidence(
    signedObject,
    identity,
    evidence,
  );
  if (evidenceError) {
    await recordReconciliationFailure(
      dependencies, identity, leaseToken, evidenceError, false,
    );
    diagnosticLog(
      dependencies, "webhook_enrollment_binding_failed", "enrollment_binding",
      startedAt, identity,
    );
    return jsonResponse(200, { received: true });
  }

  try {
    await dependencies.applySubscriptionLifecycle(
      identity,
      leaseToken,
      evidence,
    );
  } catch (error) {
    const classified = error instanceof SaasWebhookDomainError
      ? error
      : new SaasWebhookDomainError("subscription_application_failed", true);
    if (classified.errorCode === "immutable_enrollment_not_ready") {
      try {
        await dependencies.deferSubscriptionUntilEnrollment(
          identity,
          leaseToken,
        );
      } catch {
        return processingFailureResponse(
          dependencies,
          "webhook_event_finalization_failed",
          "subscription_enrollment_defer",
          startedAt,
          identity,
        );
      }
      safeLog(dependencies, {
        event_id: identity.providerEventId,
        event_type: identity.eventType,
        mode: identity.stripeLivemode ? "live" : "test",
        result: "deferred_awaiting_enrollment",
        attempt_count: claim.attempt_count,
        duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
      });
      return jsonResponse(200, {
        received: true,
        result: "deferred_awaiting_enrollment",
      });
    }
    await recordReconciliationFailure(
      dependencies, identity, leaseToken,
      classified.errorCode, classified.retryable,
    );
    if (classified.retryable) {
      return processingFailureResponse(
        dependencies, "webhook_subscription_snapshot_failed", "subscription_snapshot",
        startedAt, identity,
      );
    }
    diagnosticLog(
      dependencies, "webhook_subscription_snapshot_failed", "subscription_snapshot",
      startedAt, identity,
    );
    return jsonResponse(200, { received: true });
  }

  safeLog(dependencies, {
    event_id: identity.providerEventId,
    event_type: identity.eventType,
    subscription_id: identity.providerObjectId!,
    mode: identity.stripeLivemode ? "live" : "test",
    result: "verified_subscription_snapshot_applied",
    attempt_count: claim.attempt_count,
    duration_ms: (dependencies.now?.() ?? Date.now()) - startedAt,
  });
  return jsonResponse(200, { received: true });
}

function isInvoiceLifecycleEvent(eventType: string): boolean {
  return [
    "invoice.payment_succeeded", "invoice.payment_failed",
    "invoice.payment_action_required", "invoice.finalization_failed",
  ].includes(eventType);
}

function isSubscriptionLifecycleEvent(eventType: string): boolean {
  return [
    "customer.subscription.created", "customer.subscription.updated",
    "customer.subscription.deleted",
  ].includes(eventType);
}

async function reconcileApplicableDeferredEvent(
  dependencies: StripeSaasWebhookDependencies,
  identity: ProviderEventIdentity,
  signedObject: Record<string, unknown>,
  startedAt: number,
): Promise<Response | null> {
  if (identity.eventType === "checkout.session.completed") {
    return await reconcileCheckoutCompletion(
      dependencies, identity, signedObject, startedAt,
    );
  }
  if (isInvoiceLifecycleEvent(identity.eventType)) {
    return await reconcileInvoiceLifecycle(
      dependencies, identity, signedObject, startedAt,
    );
  }
  if (isSubscriptionLifecycleEvent(identity.eventType)) {
    return await reconcileSubscriptionLifecycle(
      dependencies, identity, signedObject, startedAt,
    );
  }
  return null;
}

export function createStripeSaasWebhookHandler(
  dependencies: StripeSaasWebhookDependencies,
): (request: Request) => Promise<Response> {
  if (!accountIdPattern.test(dependencies.stripeAccountId)) {
    throw new Error("STRIPE_SAAS_WEBHOOK_ACCOUNT_INVALID");
  }

  return async (request: Request) => {
    const startedAt = dependencies.now?.() ?? Date.now();
    let diagnosticIdentity: ProviderEventIdentity | undefined;
    try {
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method_not_allowed" });
    }
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return jsonResponse(400, { error: "invalid_webhook" });
    }
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      diagnosticLog(
        dependencies, "webhook_signature_invalid", "signature_verification",
        startedAt,
      );
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
      diagnosticLog(
        dependencies, "webhook_signature_invalid", "signature_verification",
        startedAt,
      );
      return jsonResponse(400, { error: "invalid_webhook_signature" });
    }

    const verified = validateVerifiedEvent(verifiedValue, dependencies);
    if (!verified) return jsonResponse(400, { error: "invalid_webhook" });

    let payloadHash: string;
    try {
      payloadHash = await dependencies.hashPayload(rawBody);
    } catch {
      return processingFailureResponse(
        dependencies, "webhook_unexpected_error", "payload_hash",
        startedAt,
      );
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
    diagnosticIdentity = identity;
    const terminalIdentity: TerminalEventIdentity = identity;

    let claim: SaasProviderEventClaim;
    try {
      claim = await dependencies.claimEvent(identity);
    } catch {
      return processingFailureResponse(
        dependencies, "webhook_event_claim_failed", "event_claim",
        startedAt, identity,
      );
    }

    if (claim.claim_state === "deferred_duplicate") {
      let reconciliation: Response | null;
      try {
        reconciliation = await reconcileApplicableDeferredEvent(
          dependencies,
          identity,
          verified.event.data.object,
          startedAt,
        );
      } catch {
        return processingFailureResponse(
          dependencies, "webhook_unexpected_error", "reconciliation",
          startedAt, identity,
        );
      }
      if (reconciliation) return reconciliation;
    }
    if ([
      "terminal_duplicate", "deferred_duplicate", "in_progress",
      "permanent_failure",
    ].includes(claim.claim_state)) {
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
      return processingFailureResponse(
        dependencies, "webhook_event_claim_failed", "event_claim",
        startedAt, identity,
      );
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
      return processingFailureResponse(
        dependencies, "webhook_event_finalization_failed", "event_finalization",
        startedAt, identity,
      );
    }

    if (isDeferred) {
      let reconciliation: Response | null;
      try {
        reconciliation = await reconcileApplicableDeferredEvent(
          dependencies,
          identity,
          verified.event.data.object,
          startedAt,
        );
      } catch {
        return processingFailureResponse(
          dependencies, "webhook_unexpected_error", "reconciliation",
          startedAt, identity,
        );
      }
      if (reconciliation) return reconciliation;
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
    } catch {
      return processingFailureResponse(
        dependencies, "webhook_unexpected_error", "request_processing",
        startedAt, diagnosticIdentity,
      );
    }
  };
}
