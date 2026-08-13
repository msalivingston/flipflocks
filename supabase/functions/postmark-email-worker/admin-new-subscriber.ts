export const adminNewSubscriberNotificationType = "admin_new_subscriber";
export const adminNewSubscriberRecipientEmail = "hello@flockfront.com";

type AdminNewSubscriberContext = {
  recipientEmail: string;
  storeName: string;
  sellerEmail: string | null;
  planName: string | null;
  billingInterval: string | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  signupAt: string;
};

const emailPattern = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Admin subscriber ${field} is unavailable.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function adminNewSubscriberSubject(storeName: string): string {
  return `New FlockFront subscriber: ${storeName.trim()}`;
}

export function parseAdminNewSubscriberPayload(value: unknown): {
  schema_version: "admin_new_subscriber_v1";
  subscription_enrollment_id: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Admin subscriber payload is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "schema_version" ||
    keys[1] !== "subscription_enrollment_id" ||
    record.schema_version !== "admin_new_subscriber_v1" ||
    typeof record.subscription_enrollment_id !== "string" ||
    !uuidPattern.test(record.subscription_enrollment_id)
  ) {
    throw new Error("Admin subscriber payload is invalid.");
  }
  return {
    schema_version: "admin_new_subscriber_v1",
    subscription_enrollment_id: record.subscription_enrollment_id.toLowerCase(),
  };
}

export function parseAdminNewSubscriberContext(
  value: unknown,
): AdminNewSubscriberContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Admin subscriber context is invalid.");
  }
  const record = value as Record<string, unknown>;
  const recipientEmail = requiredText(record.recipient_email, "recipient").toLowerCase();
  const sellerEmail = optionalText(record.seller_email)?.toLowerCase() ?? null;
  const subscriptionStatus = requiredText(
    record.subscription_status,
    "subscription status",
  );
  const stripeCustomerId = requiredText(record.stripe_customer_id, "customer ID");
  const stripeSubscriptionId = requiredText(
    record.stripe_subscription_id,
    "subscription ID",
  );
  const signupAt = requiredText(record.signup_at, "signup time");
  const trialEndsAt = optionalText(record.trial_ends_at);
  const planName = optionalText(record.public_plan_name);
  const billingInterval = optionalText(record.billing_cadence_label);

  if (
    recipientEmail !== adminNewSubscriberRecipientEmail ||
    !emailPattern.test(recipientEmail) ||
    (sellerEmail !== null && !emailPattern.test(sellerEmail)) ||
    !["active", "trialing"].includes(subscriptionStatus) ||
    !/^cus_[A-Za-z0-9]+$/.test(stripeCustomerId) ||
    !/^sub_[A-Za-z0-9]+$/.test(stripeSubscriptionId) ||
    (planName !== null && !["Coop", "Market"].includes(planName)) ||
    (billingInterval !== null &&
      !["Monthly", "Annual"].includes(billingInterval)) ||
    !validTimestamp(signupAt) ||
    (trialEndsAt !== null && !validTimestamp(trialEndsAt)) ||
    (subscriptionStatus === "trialing" && trialEndsAt === null)
  ) {
    throw new Error("Admin subscriber context is invalid.");
  }

  return {
    recipientEmail,
    storeName: requiredText(record.store_name, "store name"),
    sellerEmail,
    planName,
    billingInterval,
    subscriptionStatus,
    trialEndsAt,
    stripeCustomerId,
    stripeSubscriptionId,
    signupAt,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function displayTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: "America/Denver",
  }).format(new Date(value));
}

export function renderAdminNewSubscriberEmail(
  context: AdminNewSubscriberContext,
): { subject: string; html: string; text: string } {
  const subject = adminNewSubscriberSubject(context.storeName);
  const facts: Array<[string, string]> = [
    ["Store name", context.storeName],
    ...(context.sellerEmail ? [["Seller/login email", context.sellerEmail] as [string, string]] : []),
    ...(context.planName ? [["Plan", context.planName] as [string, string]] : []),
    ...(context.billingInterval
      ? [["Billing interval", context.billingInterval] as [string, string]]
      : []),
    ["Subscription status", context.subscriptionStatus],
    ...(context.trialEndsAt
      ? [["Trial end", displayTimestamp(context.trialEndsAt)] as [string, string]]
      : []),
    ["Stripe customer ID", context.stripeCustomerId],
    ["Stripe subscription ID", context.stripeSubscriptionId],
    ["Signup date/time", displayTimestamp(context.signupAt)],
  ];
  const html = [
    "<!doctype html><html><body>",
    `<h1>${escapeHtml(subject)}</h1>`,
    "<table>",
    ...facts.map(([label, value]) =>
      `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    ),
    "</table>",
    "</body></html>",
  ].join("");
  const text = [
    subject,
    "",
    ...facts.map(([label, value]) => `${label}: ${value}`),
  ].join("\n");

  return { subject, html, text };
}
