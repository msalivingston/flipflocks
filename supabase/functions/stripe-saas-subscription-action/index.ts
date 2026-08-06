import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { createStripeSaasClient } from "../_shared/stripe-saas-client.ts";
import {
  assertStripeSaasRuntimeEnvironment,
  parseStripeSaasPortalConfig,
} from "../_shared/stripe-saas-runtime.mjs";
import {
  createStripeSaasSubscriptionActionHandler,
  PlanChangeProviderError,
  ResumeProviderError,
  type PlanChangeAuthorization,
  type PlanChangeProviderBinding,
  type ResumeAuthorization,
  type ScheduledChangeCancellation,
} from "./handler.ts";

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Missing required server configuration.");
  return value;
}

const config = parseStripeSaasPortalConfig({
  STRIPE_SAAS_API_KEY: Deno.env.get("STRIPE_SAAS_API_KEY"),
  STRIPE_PLATFORM_ACCOUNT_ID: Deno.env.get("STRIPE_PLATFORM_ACCOUNT_ID"),
  STRIPE_SAAS_LIVEMODE: Deno.env.get("STRIPE_SAAS_LIVEMODE"),
  FLOCKFRONT_ENVIRONMENT_ID: Deno.env.get("FLOCKFRONT_ENVIRONMENT_ID"),
  FLOCKFRONT_APP_ORIGIN: Deno.env.get("FLOCKFRONT_APP_ORIGIN"),
});
assertStripeSaasRuntimeEnvironment(config);

const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const anonKey = requiredEnvironment("SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const stripe = createStripeSaasClient(config);
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function authenticatedClient(authorization: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function firstRow<T>(data: unknown): T {
  if (!Array.isArray(data) || !data[0]) throw new Error("Trusted database contract returned no row.");
  return data[0] as T;
}
function expandableId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}
function providerFailure(error: unknown, rejectedCode: string, ambiguousCode: string) {
  const type = error && typeof error === "object" && "type" in error
    ? String(error.type)
    : "";
  const definitive = [
    "StripeAuthenticationError", "StripePermissionError", "StripeInvalidRequestError",
  ].includes(type);
  return new PlanChangeProviderError(
    definitive ? rejectedCode : ambiguousCode,
    definitive,
  );
}

async function verifiedSubscription(authorization: PlanChangeAuthorization) {
  const subscription = await stripe.subscriptions.retrieve(
    authorization.stripe_subscription_id,
    { expand: ["items.data.price.product", "latest_invoice"] },
  );
  const item = subscription.items.data[0];
  if (subscription.items.data.length !== 1 || !item || item.quantity !== 1 ||
    subscription.livemode !== config.livemode ||
    expandableId(subscription.customer) !== authorization.stripe_customer_id ||
    item.price.id !== authorization.source_stripe_price_id ||
    subscription.status !== "active" || subscription.cancel_at_period_end ||
    subscription.collection_method !== "charge_automatically") {
    throw new PlanChangeProviderError("stripe_plan_change_state_rejected", true);
  }
  return { item, subscription };
}

async function requestPlanChange(
  authorization: PlanChangeAuthorization,
): Promise<PlanChangeProviderBinding> {
  try {
    if (authorization.stripe_invoice_id) {
      return { stripe_invoice_id: authorization.stripe_invoice_id, status: "pending_payment" };
    }
    if (authorization.stripe_schedule_id && authorization.effective_at) {
      return {
        stripe_schedule_id: authorization.stripe_schedule_id,
        effective_at: authorization.effective_at,
        status: "scheduled",
      };
    }
    const { item, subscription } = await verifiedSubscription(authorization);
    if (authorization.change_timing === "immediate") {
      if (subscription.schedule != null) {
        throw new PlanChangeProviderError("stripe_plan_change_state_rejected", true);
      }
      const updated = await stripe.subscriptions.update(
        subscription.id,
        {
          items: [{
            id: item.id,
            price: authorization.target_stripe_price_id,
            quantity: 1,
          }],
          payment_behavior: "pending_if_incomplete",
          proration_behavior: "always_invoice",
        },
        { idempotencyKey: authorization.stripe_idempotency_key },
      );
      const invoiceId = expandableId(updated.latest_invoice);
      if (!invoiceId) {
        throw new PlanChangeProviderError("stripe_plan_change_invoice_missing", false);
      }
      return { stripe_invoice_id: invoiceId, status: "pending_payment" };
    }

    const boundary = item.current_period_end;
    if (!Number.isInteger(boundary) || boundary <= Math.floor(Date.now() / 1_000)) {
      throw new PlanChangeProviderError("stripe_plan_change_boundary_invalid", true);
    }
    let schedule;
    if (subscription.schedule != null) {
      const scheduleId = expandableId(subscription.schedule);
      if (!scheduleId) throw new PlanChangeProviderError("stripe_plan_change_schedule_invalid", true);
      schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      if (schedule.status !== "active" ||
        schedule.metadata.flockfront_plan_change_id !== authorization.plan_change_id) {
        throw new PlanChangeProviderError("stripe_plan_change_state_rejected", true);
      }
    } else {
      schedule = await stripe.subscriptionSchedules.create(
        {
          from_subscription: subscription.id,
          metadata: { flockfront_plan_change_id: authorization.plan_change_id },
        },
        { idempotencyKey: `${authorization.stripe_idempotency_key}:create` },
      );
    }
    const currentPhase = schedule.phases[0];
    if (!currentPhase || currentPhase.start_date >= boundary) {
      throw new PlanChangeProviderError("stripe_plan_change_schedule_invalid", false);
    }
    await stripe.subscriptionSchedules.update(
      schedule.id,
      {
        end_behavior: "release",
        proration_behavior: "none",
        phases: [
          {
            start_date: currentPhase.start_date,
            end_date: boundary,
            items: [{ price: authorization.source_stripe_price_id, quantity: 1 }],
            proration_behavior: "none",
          },
          {
            start_date: boundary,
            duration: { interval: "month", interval_count: 1 },
            items: [{ price: authorization.target_stripe_price_id, quantity: 1 }],
            proration_behavior: "none",
          },
        ],
      },
      { idempotencyKey: `${authorization.stripe_idempotency_key}:configure` },
    );
    return {
      stripe_schedule_id: schedule.id,
      effective_at: new Date(boundary * 1_000).toISOString(),
      status: "scheduled",
    };
  } catch (error) {
    if (error instanceof PlanChangeProviderError) throw error;
    throw providerFailure(
      error,
      "stripe_plan_change_request_rejected",
      "stripe_plan_change_request_ambiguous",
    );
  }
}

const handler = createStripeSaasSubscriptionActionHandler({
  allowedOrigin: config.appOrigin,
  async authenticate(authorization) {
    const { data: { user }, error } = await authenticatedClient(authorization).auth.getUser();
    return error ? null : user?.id ?? null;
  },
  async beginResume(authenticatedUserId) {
    const { data, error } = await serviceClient.rpc("begin_saas_subscription_resume", {
      p_authenticated_user_id: authenticatedUserId,
      p_stripe_livemode: config.livemode,
      p_stripe_account_id: config.platformAccountId,
      p_environment_id: config.environmentId,
    });
    if (error) throw new Error("Resume is unavailable.");
    return firstRow<ResumeAuthorization>(data);
  },
  async requestResume(authorization) {
    try {
      await stripe.subscriptions.update(
        authorization.stripe_subscription_id!,
        { cancel_at_period_end: false, cancel_at: "" },
        { idempotencyKey: authorization.stripe_idempotency_key! },
      );
    } catch (error) {
      const type = error && typeof error === "object" && "type" in error
        ? String(error.type)
        : "";
      const definitive = [
        "StripeAuthenticationError", "StripePermissionError", "StripeInvalidRequestError",
      ].includes(type);
      throw new ResumeProviderError(
        definitive ? "stripe_resume_request_rejected" : "stripe_resume_request_ambiguous",
        definitive,
      );
    }
  },
  async recordResumeRequested(actionRequestId) {
    const { error } = await serviceClient.rpc("record_saas_subscription_resume_requested", {
      p_action_request_id: actionRequestId,
      p_provider_requested_at: new Date().toISOString(),
    });
    if (error) throw new Error("Resume request confirmation is pending.");
  },
  async markActionFailed(actionRequestId, failureCode) {
    const { error } = await serviceClient.rpc("mark_saas_billing_management_action_failed", {
      p_action_request_id: actionRequestId,
      p_failure_code: failureCode,
    });
    if (error) throw new Error("Resume failure could not be recorded.");
  },
  async beginPlanChange(authenticatedUserId, targetPlanKey, targetBillingCadence) {
    const { data, error } = await serviceClient.rpc("begin_saas_subscription_plan_change", {
      p_authenticated_user_id: authenticatedUserId,
      p_target_plan_key: targetPlanKey,
      p_target_billing_cadence: targetBillingCadence,
      p_stripe_livemode: config.livemode,
      p_stripe_account_id: config.platformAccountId,
      p_environment_id: config.environmentId,
    });
    if (error) throw new Error("Plan change is unavailable.");
    return firstRow<PlanChangeAuthorization>(data);
  },
  requestPlanChange,
  async recordPlanChangeProviderBinding(planChangeId, binding) {
    const { error } = await serviceClient.rpc("record_saas_plan_change_provider_binding", {
      p_plan_change_id: planChangeId,
      p_stripe_invoice_id: binding.stripe_invoice_id ?? null,
      p_stripe_schedule_id: binding.stripe_schedule_id ?? null,
      p_effective_at: binding.effective_at ?? null,
      p_status: binding.status,
    });
    if (error) throw new Error("Plan change provider binding is pending.");
  },
  async beginScheduledChangeCancellation(authenticatedUserId) {
    const { data, error } = await serviceClient.rpc("begin_saas_scheduled_plan_change_cancellation", {
      p_authenticated_user_id: authenticatedUserId,
      p_stripe_livemode: config.livemode,
      p_stripe_account_id: config.platformAccountId,
      p_environment_id: config.environmentId,
    });
    if (error) throw new Error("Scheduled change is unavailable.");
    return firstRow<ScheduledChangeCancellation>(data);
  },
  async requestScheduledChangeCancellation(authorization) {
    try {
      const schedule = await stripe.subscriptionSchedules.retrieve(
        authorization.stripe_schedule_id,
      );
      if (expandableId(schedule.subscription) !== authorization.stripe_subscription_id ||
        expandableId(schedule.customer) !== authorization.stripe_customer_id) {
        throw new PlanChangeProviderError("stripe_schedule_release_rejected", true);
      }
      if (schedule.status === "released") return;
      if (schedule.status !== "active") {
        throw new PlanChangeProviderError("stripe_schedule_release_rejected", true);
      }
      await stripe.subscriptionSchedules.release(
        schedule.id,
        {},
        { idempotencyKey: authorization.stripe_idempotency_key },
      );
    } catch (error) {
      if (error instanceof PlanChangeProviderError) throw error;
      throw providerFailure(
        error,
        "stripe_schedule_release_rejected",
        "stripe_schedule_release_ambiguous",
      );
    }
  },
  async recordScheduledChangeCanceled(planChangeId) {
    const { error } = await serviceClient.rpc("record_saas_scheduled_plan_change_canceled", {
      p_plan_change_id: planChangeId,
    });
    if (error) throw new Error("Scheduled change cancellation is pending.");
  },
  async markPlanChangeFailed(planChangeId, failureCode) {
    const { error } = await serviceClient.rpc("mark_saas_subscription_plan_change_failed", {
      p_plan_change_id: planChangeId,
      p_failure_code: failureCode,
    });
    if (error) throw new Error("Plan change failure could not be recorded.");
  },
});

Deno.serve(handler);
