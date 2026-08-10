export const sellerSubscriptionCanceledNotificationType =
  "seller_subscription_canceled";
export const sellerSubscriptionCanceledSubject =
  "Your FlockFront subscription has been canceled";
export const sellerSubscriptionCanceledFromEmail = "billing@flockfront.com";
export const sellerSubscriptionCanceledAccountUrl =
  "https://www.flockfront.com/dashboard/account";

const flockFrontLogoUrl =
  "https://www.flockfront.com/branding/flockfront-logo-final-cropped.png";

export type SellerSubscriptionCanceledPayload = {
  schema_version: "seller_subscription_canceled_v1";
  subscription_cancellation_episode_id: string;
};

export type SellerSubscriptionCanceledContext = {
  recipientEmail: string;
  firstName: string;
  planName: "Coop" | "Market";
  cadence: "Monthly" | "Annual";
  cancellationKind: "scheduled" | "immediate";
  accessEndsAt: string;
  accessContinues: boolean;
  canReactivate: boolean;
};

export type SellerSubscriptionCanceledDocument = {
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
    throw new Error(`Seller subscription-canceled ${field} is missing.`);
  }
  return value.trim();
}

export function parseSellerSubscriptionCanceledPayload(
  value: unknown,
): SellerSubscriptionCanceledPayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "subscription_cancellation_episode_id",
    ]) ||
    value.schema_version !== "seller_subscription_canceled_v1" ||
    typeof value.subscription_cancellation_episode_id !== "string" ||
    !uuidPattern.test(value.subscription_cancellation_episode_id)
  ) {
    throw new Error("Seller subscription-canceled payload is invalid.");
  }

  return {
    schema_version: value.schema_version,
    subscription_cancellation_episode_id:
      value.subscription_cancellation_episode_id.toLowerCase(),
  };
}

export function parseSellerSubscriptionCanceledContext(
  value: unknown,
): SellerSubscriptionCanceledContext {
  if (!isRecord(value)) {
    throw new Error("Seller subscription-canceled context is missing.");
  }

  const recipientEmail = requiredText(value.recipient_email, "recipient email")
    .toLowerCase();
  const firstName = requiredText(value.first_name, "seller first name");
  const planName = value.public_plan_name;
  const cadence = value.billing_cadence_label;
  const cancellationKind = value.cancellation_kind;
  const accessEndsAt = requiredText(value.access_ends_at, "access end");

  if (!emailPattern.test(recipientEmail)) {
    throw new Error("Seller subscription-canceled recipient email is invalid.");
  }
  if (planName !== "Coop" && planName !== "Market") {
    throw new Error("Seller subscription-canceled public plan name is invalid.");
  }
  if (cadence !== "Monthly" && cadence !== "Annual") {
    throw new Error("Seller subscription-canceled billing cadence is invalid.");
  }
  if (cancellationKind !== "scheduled" && cancellationKind !== "immediate") {
    throw new Error("Seller subscription-canceled kind is invalid.");
  }
  if (Number.isNaN(new Date(accessEndsAt).getTime())) {
    throw new Error("Seller subscription-canceled access end is invalid.");
  }
  if (typeof value.access_continues !== "boolean") {
    throw new Error("Seller subscription-canceled access state is invalid.");
  }
  if (typeof value.can_reactivate !== "boolean") {
    throw new Error("Seller subscription-canceled reactivation state is invalid.");
  }

  return {
    recipientEmail,
    firstName,
    planName,
    cadence,
    cancellationKind,
    accessEndsAt,
    accessContinues: value.access_continues,
    canReactivate: value.can_reactivate,
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Denver",
  }).format(new Date(value));
}

function cancellationCopy(context: SellerSubscriptionCanceledContext) {
  const accessDate = formatDate(context.accessEndsAt);
  if (context.cancellationKind === "scheduled") {
    return {
      summary: "Your FlockFront subscription is scheduled to cancel.",
      access: `Your subscription access remains available through ${accessDate}. After that date, subscription access will end.`,
    };
  }
  if (context.accessContinues) {
    return {
      summary: "Your FlockFront subscription has been canceled.",
      access: `Your subscription access remains available through ${accessDate}. After that date, subscription access will end.`,
    };
  }
  return {
    summary: "Your FlockFront subscription has been canceled.",
    access: `Your subscription access ended on ${accessDate}.`,
  };
}

export function renderSellerSubscriptionCanceledEmail(
  context: SellerSubscriptionCanceledContext,
): SellerSubscriptionCanceledDocument {
  const firstName = escapeHtml(context.firstName);
  const planName = escapeHtml(context.planName);
  const cadence = escapeHtml(context.cadence);
  const copy = cancellationCopy(context);
  const accessDate = formatDate(context.accessEndsAt);
  const statusLabel = context.cancellationKind === "scheduled"
    ? "Scheduled cancellation"
    : "Canceled";
  const preheader = "Your FlockFront subscription cancellation is confirmed.";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(sellerSubscriptionCanceledSubject)}</title></head>
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
          <p style="margin:0 0 22px;color:#394137;font-size:16px;line-height:1.6;">${escapeHtml(copy.summary)}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f7faf4" style="width:100%;margin:0 0 22px;background:#f7faf4;border:1px solid #dbe8d8;border-radius:8px;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0 0 8px;color:#246f38;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${statusLabel}</p>
              <p style="margin:0 0 7px;color:#10281c;font-size:18px;font-weight:700;line-height:1.35;">${planName} — ${cadence}</p>
              <p style="margin:0;color:#394137;font-size:15px;line-height:1.5;">Access through: <strong style="color:#10281c;">${accessDate}</strong></p>
            </td></tr>
          </table>
          <p style="margin:0 0 22px;color:#394137;font-size:15px;line-height:1.6;">${escapeHtml(copy.access)}</p>
          ${context.canReactivate ? '<p style="margin:0 0 22px;color:#394137;font-size:15px;line-height:1.6;">You can reactivate your subscription from your FlockFront account before access ends.</p>' : ""}
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;"><tr><td bgcolor="#246f38" style="border-radius:7px;background:#246f38;"><a href="${sellerSubscriptionCanceledAccountUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">Manage billing</a></td></tr></table>
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
    copy.summary,
    "",
    statusLabel,
    `${context.planName} — ${context.cadence}`,
    `Access through: ${accessDate}`,
    "",
    copy.access,
    ...(context.canReactivate
      ? [
        "",
        "You can reactivate your subscription from your FlockFront account before access ends.",
      ]
      : []),
    "",
    "Manage billing:",
    sellerSubscriptionCanceledAccountUrl,
    "",
    "Need help? Reply to this email or contact support@flockfront.com.",
  ].join("\n");

  return { subject: sellerSubscriptionCanceledSubject, html, text };
}
