export const sellerFirstSaleNotificationType = "seller_first_sale";
export const sellerFirstSaleSubject = "You made your first FlockFront sale!";
export const sellerFirstSaleFromEmail = "welcome@flockfront.com";

const sellerFirstSaleLogoUrl =
  "https://www.flockfront.com/branding/flockfront-logo-final-cropped.png";

export type SellerFirstSalePayload = {
  schema_version: "seller_first_sale_v1";
  order_id: string;
};

export type SellerFirstSaleContext = {
  recipientEmail: string;
  firstName: string;
  orderId: string;
  orderNumber: string;
  orderTotalCents: number;
  buyerFirstName: string | null;
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
    throw new Error(`Seller first-sale ${field} is missing.`);
  }
  return value.trim();
}

export function parseSellerFirstSalePayload(value: unknown): SellerFirstSalePayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schema_version", "order_id"]) ||
    value.schema_version !== "seller_first_sale_v1" ||
    typeof value.order_id !== "string" ||
    !uuidPattern.test(value.order_id)
  ) {
    throw new Error("Seller first-sale payload is invalid.");
  }

  return {
    schema_version: value.schema_version,
    order_id: value.order_id.toLowerCase(),
  };
}

export function parseSellerFirstSaleContext(value: unknown): SellerFirstSaleContext {
  if (!isRecord(value)) {
    throw new Error("Seller first-sale context is missing.");
  }

  const recipientEmail = requiredText(value.recipient_email, "recipient email")
    .toLowerCase();
  const firstName = requiredText(value.first_name, "seller first name");
  const orderId = requiredText(value.order_id, "order ID").toLowerCase();
  const orderNumber = requiredText(value.order_number, "order number");
  const total = value.order_total_cents;
  const buyerFirstName = value.buyer_first_name === null
    ? null
    : requiredText(value.buyer_first_name, "buyer first name");

  if (!emailPattern.test(recipientEmail)) {
    throw new Error("Seller first-sale recipient email is invalid.");
  }
  if (!uuidPattern.test(orderId)) {
    throw new Error("Seller first-sale order ID is invalid.");
  }
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) {
    throw new Error("Seller first-sale order total is invalid.");
  }

  return {
    recipientEmail,
    firstName,
    orderId,
    orderNumber,
    orderTotalCents: total,
    buyerFirstName,
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

export function renderSellerFirstSaleEmail(context: SellerFirstSaleContext) {
  const orderUrl = `https://www.flockfront.com/dashboard/orders/${context.orderId}`;
  const firstName = escapeHtml(context.firstName);
  const orderNumber = escapeHtml(context.orderNumber);
  const buyerLine = context.buyerFirstName
    ? ` from ${escapeHtml(context.buyerFirstName)}`
    : "";
  const total = formatUsd(context.orderTotalCents);

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${sellerFirstSaleSubject}</title></head>
<body style="margin:0;background:#fbf7ef;color:#10281c;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your storefront just received its first FlockFront order.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#fbf7ef" style="width:100%;background:#fbf7ef;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #ded6c7;border-radius:12px;overflow:hidden;">
        <tr><td height="4" bgcolor="#246f38" style="height:4px;background:#246f38;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td bgcolor="#fffaf1" style="padding:20px 30px;background:#fffaf1;border-bottom:1px solid #e8deca;">
          <img src="${sellerFirstSaleLogoUrl}" width="205" alt="FlockFront" style="display:block;width:205px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td style="padding:30px;">
          <p style="margin:0 0 16px;color:#10281c;font-size:16px;line-height:1.55;">Hi ${firstName},</p>
          <h1 style="margin:0 0 14px;color:#10281c;font-size:25px;line-height:1.25;">You made your first FlockFront sale!</h1>
          <p style="margin:0 0 22px;color:#394137;font-size:16px;line-height:1.6;">Congratulations—your storefront just received its first order on FlockFront.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f7faf4" style="width:100%;margin:0 0 24px;background:#f7faf4;border:1px solid #dbe8d8;border-radius:8px;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0 0 7px;color:#10281c;font-size:18px;font-weight:700;line-height:1.35;">Order #${orderNumber}${buyerLine}</p>
              <p style="margin:0;color:#394137;font-size:15px;line-height:1.5;">Order total: <strong style="color:#10281c;">${total}</strong></p>
            </td></tr>
          </table>
          <table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#246f38" style="border-radius:7px;background:#246f38;"><a href="${orderUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">View my first order</a></td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const buyerText = context.buyerFirstName ? ` from ${context.buyerFirstName}` : "";
  const text = [
    `Hi ${context.firstName},`,
    "",
    sellerFirstSaleSubject,
    "",
    "Congratulations—your storefront just received its first order on FlockFront.",
    "",
    `Order #${context.orderNumber}${buyerText}`,
    `Order total: ${total}`,
    "",
    "View my first order:",
    orderUrl,
  ].join("\n");

  return { subject: sellerFirstSaleSubject, html, text };
}
