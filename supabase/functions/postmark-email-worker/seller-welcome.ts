export const sellerWelcomeNotificationType = "seller_subscription_welcome";
export const sellerWelcomeTrialSubject =
  "Welcome to FlockFront — your free trial has started";
export const sellerWelcomeActiveSubject =
  "Welcome to FlockFront — your subscription is active";
export const sellerWelcomeFromEmail = "welcome@flockfront.com";
export const sellerWelcomeSetupUrl = "https://www.flockfront.com/onboarding";

export type SellerWelcomePayload = {
  schema_version: "seller_subscription_welcome_v1";
  subscription_enrollment_id: string;
};

export type SellerWelcomeContext = {
  recipientEmail: string;
  firstName: string;
  planName: "Coop" | "Market";
  cadence: "Monthly" | "Annual";
  firstChargeAmountCents: number;
  firstChargeAt: string;
  hasTrial: boolean;
};

export type SellerWelcomeDocument = {
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
    throw new Error(`Seller welcome ${field} is missing.`);
  }

  return value.trim();
}

export function parseSellerWelcomePayload(value: unknown): SellerWelcomePayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schema_version", "subscription_enrollment_id"]) ||
    value.schema_version !== "seller_subscription_welcome_v1" ||
    typeof value.subscription_enrollment_id !== "string" ||
    !uuidPattern.test(value.subscription_enrollment_id)
  ) {
    throw new Error("Seller welcome payload is invalid.");
  }

  return {
    schema_version: value.schema_version,
    subscription_enrollment_id: value.subscription_enrollment_id.toLowerCase(),
  };
}

export function parseSellerWelcomeContext(value: unknown): SellerWelcomeContext {
  if (!isRecord(value)) {
    throw new Error("Seller welcome billing context is missing.");
  }

  const recipientEmail = requiredText(value.recipient_email, "recipient email")
    .toLowerCase();
  const firstName = requiredText(value.first_name, "seller first name");
  const firstChargeAt = requiredText(
    value.first_charge_at,
    "first-charge date",
  );
  const amount = value.first_charge_amount_cents;
  const planName = value.public_plan_name;
  const cadence = value.billing_cadence_label;

  if (!emailPattern.test(recipientEmail)) {
    throw new Error("Seller welcome recipient email is invalid.");
  }

  if (planName !== "Coop" && planName !== "Market") {
    throw new Error("Seller welcome public plan name is invalid.");
  }

  if (cadence !== "Monthly" && cadence !== "Annual") {
    throw new Error("Seller welcome billing cadence is invalid.");
  }

  if (
    typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0
  ) {
    throw new Error("Seller welcome first-charge amount is invalid.");
  }

  if (value.currency !== "usd") {
    throw new Error("Seller welcome currency must be US dollars.");
  }

  if (typeof value.has_trial !== "boolean") {
    throw new Error("Seller welcome trial state is invalid.");
  }

  const chargeDate = new Date(firstChargeAt);
  if (Number.isNaN(chargeDate.getTime())) {
    throw new Error("Seller welcome first-charge date is invalid.");
  }

  return {
    recipientEmail,
    firstName,
    planName,
    cadence,
    firstChargeAmountCents: amount,
    firstChargeAt,
    hasTrial: value.has_trial,
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

function formatChargeDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Denver",
  }).format(new Date(value));
}

export function renderSellerWelcomeEmail(
  context: SellerWelcomeContext,
): SellerWelcomeDocument {
  const firstName = escapeHtml(context.firstName);
  const planName = escapeHtml(context.planName);
  const cadence = escapeHtml(context.cadence);
  const price = formatUsd(context.firstChargeAmountCents);
  const date = formatChargeDate(context.firstChargeAt);
  const subject = context.hasTrial
    ? sellerWelcomeTrialSubject
    : sellerWelcomeActiveSubject;
  const opening = context.hasTrial
    ? "Welcome to FlockFront! Your subscription is set up, and your 7-day free trial has started."
    : "Welcome to FlockFront! Your subscription is set up and active.";
  const billingDisclosure = context.hasTrial
    ? "You won’t be charged today. Unless you cancel before your trial ends, your subscription will begin automatically on the date above."
    : "Your subscription is active. Future charges will follow the billing cadence shown above unless you cancel.";
  const cancellationDisclosure = context.hasTrial
    ? "If you cancel during the trial, you will not be charged."
    : "You can also cancel there at any time.";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#f5f3ee;color:#29251f;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opening)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f3ee;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #ded8cc;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:24px 32px;background:#294b3a;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:.2px;">FlockFront</td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">${escapeHtml(opening)}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;background:#f8f6f1;border:1px solid #e4dfd5;border-radius:8px;">
            <tr><td style="padding:20px 22px;">
              <p style="margin:0 0 10px;color:#665f54;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Your plan</p>
              <p style="margin:0 0 8px;font-size:19px;font-weight:700;">${planName} — ${cadence}</p>
              <p style="margin:0;font-size:15px;line-height:1.5;">Your first charge: <strong>${price}</strong> on <strong>${date}</strong></p>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${escapeHtml(billingDisclosure)}</p>
          <p style="margin:0 0 12px;font-size:16px;line-height:1.6;font-weight:700;">Now let’s get your store ready:</p>
          <ol style="margin:0 0 26px;padding-left:22px;font-size:15px;line-height:1.75;">
            <li>Finish your storefront details</li>
            <li>Choose what you sell</li>
            <li>Add your first listings</li>
            <li>Preview your store and start sharing it with buyers</li>
          </ol>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px;"><tr><td style="border-radius:7px;background:#b75d32;"><a href="${sellerWelcomeSetupUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Continue setting up my store</a></td></tr></table>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#514b42;">You can review your plan, update your payment method, or cancel from Account → Manage billing &amp; invoices. ${escapeHtml(cancellationDisclosure)}</p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.65;color:#514b42;">Need help? Reply to this email or contact <a href="mailto:support@flockfront.com" style="color:#294b3a;">support@flockfront.com</a>.</p>
          <p style="margin:0;font-size:15px;line-height:1.6;">Welcome aboard,<br><br>Michelle<br>FlockFront<br><span style="color:#665f54;">A better way to sell poultry.</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${context.firstName},`,
    "",
    opening,
    "",
    "Your plan",
    "",
    `${context.planName} — ${context.cadence}`,
    `Your first charge: ${price} on ${date}`,
    "",
    billingDisclosure,
    "",
    "Now let’s get your store ready:",
    "",
    "1. Finish your storefront details",
    "2. Choose what you sell",
    "3. Add your first listings",
    "4. Preview your store and start sharing it with buyers",
    "",
    "Continue setting up my store:",
    sellerWelcomeSetupUrl,
    "",
    `You can review your plan, update your payment method, or cancel from Account → Manage billing & invoices. ${cancellationDisclosure}`,
    "",
    "Need help? Reply to this email or contact support@flockfront.com.",
    "",
    "Welcome aboard,",
    "",
    "Michelle",
    "FlockFront",
    "A better way to sell poultry.",
  ].join("\n");

  return { subject, html, text };
}
