export const sellerPaymentFailedNotificationType =
  "seller_subscription_payment_failed";
export const sellerPaymentFailedSubject =
  "We couldn’t process your FlockFront payment";
export const sellerPaymentFailedFromEmail = "billing@flockfront.com";
export const sellerPaymentFailedAccountUrl =
  "https://www.flockfront.com/dashboard/account";

const flockFrontLogoUrl =
  "https://www.flockfront.com/branding/flockfront-logo-final-cropped.png";

export type SellerPaymentFailedPayload = {
  schema_version: "seller_subscription_payment_failed_v1";
  subscription_invoice_id: string;
};

export type SellerPaymentFailedContext = {
  recipientEmail: string;
  firstName: string;
  planName: "Coop" | "Market";
  cadence: "Monthly" | "Annual";
  amountDueCents: number;
  nextPaymentAttemptAt: string | null;
  failureAt: string;
  graceEndsAt: string | null;
  hasActiveAccess: boolean;
  accessUntil: string | null;
};

export type SellerPaymentFailedDocument = {
  subject: string;
  html: string;
  text: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Seller payment-failed ${field} is missing.`);
  }

  return value.trim();
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  const timestamp = requiredText(value, field);
  if (Number.isNaN(new Date(timestamp).getTime())) {
    throw new Error(`Seller payment-failed ${field} is invalid.`);
  }
  return timestamp;
}

export function parseSellerPaymentFailedPayload(
  value: unknown,
): SellerPaymentFailedPayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schema_version", "subscription_invoice_id"]) ||
    value.schema_version !== "seller_subscription_payment_failed_v1" ||
    typeof value.subscription_invoice_id !== "string" ||
    !uuidPattern.test(value.subscription_invoice_id)
  ) {
    throw new Error("Seller payment-failed payload is invalid.");
  }

  return {
    schema_version: value.schema_version,
    subscription_invoice_id: value.subscription_invoice_id.toLowerCase(),
  };
}

export function parseSellerPaymentFailedContext(
  value: unknown,
): SellerPaymentFailedContext {
  if (!isRecord(value)) {
    throw new Error("Seller payment-failed billing context is missing.");
  }

  const recipientEmail = requiredText(value.recipient_email, "recipient email")
    .toLowerCase();
  const firstName = requiredText(value.first_name, "seller first name");
  const planName = value.public_plan_name;
  const cadence = value.billing_cadence_label;
  const amountDueCents = value.amount_due_cents;
  const failureAt = requiredText(value.failure_at, "failure date");
  const nextPaymentAttemptAt = optionalTimestamp(
    value.next_payment_attempt_at,
    "next payment attempt",
  );
  const graceEndsAt = optionalTimestamp(value.grace_ends_at, "grace end");
  const accessUntil = optionalTimestamp(value.access_until, "access end");

  if (!emailPattern.test(recipientEmail)) {
    throw new Error("Seller payment-failed recipient email is invalid.");
  }
  if (planName !== "Coop" && planName !== "Market") {
    throw new Error("Seller payment-failed public plan name is invalid.");
  }
  if (cadence !== "Monthly" && cadence !== "Annual") {
    throw new Error("Seller payment-failed billing cadence is invalid.");
  }
  if (
    typeof amountDueCents !== "number" ||
    !Number.isSafeInteger(amountDueCents) ||
    amountDueCents < 0
  ) {
    throw new Error("Seller payment-failed amount due is invalid.");
  }
  if (value.currency !== "usd") {
    throw new Error("Seller payment-failed currency must be US dollars.");
  }
  if (Number.isNaN(new Date(failureAt).getTime())) {
    throw new Error("Seller payment-failed failure date is invalid.");
  }
  if (typeof value.has_active_access !== "boolean") {
    throw new Error("Seller payment-failed access state is invalid.");
  }

  return {
    recipientEmail,
    firstName,
    planName,
    cadence,
    amountDueCents,
    nextPaymentAttemptAt,
    failureAt,
    graceEndsAt,
    hasActiveAccess: value.has_active_access,
    accessUntil,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUsd(amountCents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Denver",
  }).format(new Date(value));
}

function accessMessage(context: SellerPaymentFailedContext): string | null {
  if (context.hasActiveAccess && context.graceEndsAt) {
    return `Your store remains accessible during the current billing grace period through ${formatDate(context.graceEndsAt)}.`;
  }
  if (context.hasActiveAccess && context.accessUntil) {
    return `Your existing store access remains available through ${formatDate(context.accessUntil)} while you resolve the payment issue.`;
  }
  return null;
}

export function renderSellerPaymentFailedEmail(
  context: SellerPaymentFailedContext,
): SellerPaymentFailedDocument {
  const firstName = escapeHtml(context.firstName);
  const planName = escapeHtml(context.planName);
  const cadence = escapeHtml(context.cadence);
  const amountDue = context.amountDueCents > 0
    ? formatUsd(context.amountDueCents)
    : null;
  const nextAttempt = context.nextPaymentAttemptAt
    ? formatDate(context.nextPaymentAttemptAt)
    : null;
  const access = accessMessage(context);
  const preheader = "Please review your FlockFront billing details.";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(sellerPaymentFailedSubject)}</title></head>
<body style="margin:0;background:#fbf7ef;color:#10281c;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#fbf7ef" style="width:100%;background:#fbf7ef;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #ded6c7;border-radius:12px;overflow:hidden;">
        <tr><td height="4" bgcolor="#246f38" style="height:4px;background:#246f38;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td bgcolor="#fffaf1" style="padding:20px 30px;background:#fffaf1;border-bottom:1px solid #e8deca;">
          <img src="${flockFrontLogoUrl}" width="205" alt="FlockFront" style="display:block;width:205px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td style="padding:30px;">
          <p style="margin:0 0 16px;color:#10281c;font-size:16px;line-height:1.55;">Hi ${firstName},</p>
          <p style="margin:0 0 22px;color:#394137;font-size:16px;line-height:1.6;">We couldn’t process your FlockFront subscription payment. Please review your billing details and update your payment method if needed.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f7faf4" style="width:100%;margin:0 0 22px;background:#f7faf4;border:1px solid #dbe8d8;border-radius:8px;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0 0 8px;color:#246f38;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Payment details</p>
              <p style="margin:0${amountDue || nextAttempt ? " 0 7px" : ""};color:#10281c;font-size:18px;font-weight:700;line-height:1.35;">${planName} — ${cadence}</p>
              ${amountDue ? `<p style="margin:0${nextAttempt ? " 0 5px" : ""};color:#394137;font-size:15px;line-height:1.5;">Amount due: <strong style="color:#10281c;">${amountDue}</strong></p>` : ""}
              ${nextAttempt ? `<p style="margin:0;color:#394137;font-size:15px;line-height:1.5;">Next payment attempt: <strong style="color:#10281c;">${nextAttempt}</strong></p>` : ""}
            </td></tr>
          </table>
          ${access ? `<p style="margin:0 0 22px;color:#394137;font-size:15px;line-height:1.6;">${escapeHtml(access)}</p>` : ""}
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;"><tr><td bgcolor="#246f38" style="border-radius:7px;background:#246f38;"><a href="${sellerPaymentFailedAccountUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">Review billing details</a></td></tr></table>
          <p style="margin:0;color:#514b42;font-size:14px;line-height:1.65;">Need help? Reply to this email or contact <a href="mailto:support@flockfront.com" style="color:#17613a;text-decoration:underline;">support@flockfront.com</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${context.firstName},`,
    "",
    "We couldn’t process your FlockFront subscription payment. Please review your billing details and update your payment method if needed.",
    "",
    "Payment details",
    `${context.planName} — ${context.cadence}`,
    ...(amountDue ? [`Amount due: ${amountDue}`] : []),
    ...(nextAttempt ? [`Next payment attempt: ${nextAttempt}`] : []),
    ...(access ? ["", access] : []),
    "",
    "Review billing details:",
    sellerPaymentFailedAccountUrl,
    "",
    "Need help? Reply to this email or contact support@flockfront.com.",
  ].join("\n");

  return { subject: sellerPaymentFailedSubject, html, text };
}
