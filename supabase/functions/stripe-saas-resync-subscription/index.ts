import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { createStripeSaasClient } from "../_shared/stripe-saas-client.ts";
import { parseStripeSaasPortalConfig } from "../_shared/stripe-saas-runtime.mjs";
import { createStripeSaasSubscriptionResyncHandler } from "./handler.ts";

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Missing required server configuration.");
  return value;
}
function iso(value: number | null | undefined): string | null {
  return Number.isInteger(value) && (value ?? 0) > 0
    ? new Date((value as number) * 1000).toISOString()
    : null;
}
function expandableId(value: unknown): string | null {
  if (typeof value === "string") return value;
  return value && typeof value === "object" && "id" in value && typeof value.id === "string"
    ? value.id
    : null;
}
function firstRow<T>(data: unknown): T {
  if (!Array.isArray(data) || !data[0]) throw new Error("Trusted resync contract returned no row.");
  return data[0] as T;
}

const config = parseStripeSaasPortalConfig({
  STRIPE_SAAS_API_KEY: Deno.env.get("STRIPE_SAAS_API_KEY"),
  STRIPE_PLATFORM_ACCOUNT_ID: Deno.env.get("STRIPE_PLATFORM_ACCOUNT_ID"),
  STRIPE_SAAS_LIVEMODE: Deno.env.get("STRIPE_SAAS_LIVEMODE"),
  FLOCKFRONT_ENVIRONMENT_ID: Deno.env.get("FLOCKFRONT_ENVIRONMENT_ID"),
  FLOCKFRONT_APP_ORIGIN: Deno.env.get("FLOCKFRONT_APP_ORIGIN"),
});
if (config.livemode) throw new Error("Live subscription resync is not enabled.");
const operatorUserId = requiredEnvironment("STRIPE_SAAS_REPLAY_OPERATOR_USER_ID");
const allowedStoreId = requiredEnvironment("STRIPE_SAAS_RESYNC_ALLOWED_STORE_ID");
if (!/^[0-9a-f-]{36}$/i.test(operatorUserId) || !/^[0-9a-f-]{36}$/i.test(allowedStoreId)) {
  throw new Error("Temporary subscription resync authorization is invalid.");
}

const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const anonKey = requiredEnvironment("SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stripe = createStripeSaasClient(config);
function authenticatedClient(authorization: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const handler = createStripeSaasSubscriptionResyncHandler({
  allowedOrigin: config.appOrigin,
  async authorizeOperator(authorization) {
    const { data: { user }, error } = await authenticatedClient(authorization).auth.getUser();
    if (error || !user || user.id !== operatorUserId) return false;
    const { data, error: roleError } = await serviceClient.from("user_roles")
      .select("user_id").eq("user_id", user.id).eq("role", "admin")
      .is("store_id", null).limit(1);
    return !roleError && Array.isArray(data) && data.length === 1;
  },
  async resync() {
    const { data: beginData, error: beginError } = await serviceClient.rpc(
      "begin_saas_subscription_snapshot_resync",
      {
        p_operator_user_id: operatorUserId,
        p_store_id: allowedStoreId,
        p_stripe_account_id: config.platformAccountId,
        p_stripe_livemode: config.livemode,
        p_environment_id: config.environmentId,
      },
    );
    if (beginError) throw new Error("Trusted resync authorization failed.");
    const authorization = firstRow<{ request_id: string; stripe_subscription_id: string }>(beginData);
    const subscription = await stripe.subscriptions.retrieve(
      authorization.stripe_subscription_id,
      { expand: ["items.data.price.product"] },
    );
    if (subscription.items.data.length !== 1) throw new Error("Subscription shape is invalid.");
    const item = subscription.items.data[0];
    const productId = expandableId(item.price.product);
    const customerId = expandableId(subscription.customer);
    const periodStart = iso(item.current_period_start);
    const periodEnd = iso(item.current_period_end);
    if (!productId || !customerId || !periodStart || !periodEnd) {
      throw new Error("Subscription shape is invalid.");
    }
    const { data, error } = await serviceClient.rpc(
      "apply_verified_saas_subscription_snapshot_resync",
      {
        p_request_id: authorization.request_id,
        p_stripe_subscription_id: subscription.id,
        p_subscription_livemode: subscription.livemode,
        p_stripe_customer_id: customerId,
        p_stripe_price_id: item.price.id,
        p_stripe_product_id: productId,
        p_subscription_status: subscription.status,
        p_current_period_start: periodStart,
        p_current_period_end: periodEnd,
        p_cancel_at_period_end: subscription.cancel_at_period_end,
        p_subscription_cancel_at: iso(subscription.cancel_at),
      },
    );
    if (error || !["applied", "already_applied"].includes(String(data))) {
      throw new Error("Trusted resync application failed.");
    }
    return {
      status: String(data) as "applied" | "already_applied",
      scheduled_cancellation: subscription.cancel_at_period_end || subscription.cancel_at != null,
    };
  },
});

Deno.serve(handler);
