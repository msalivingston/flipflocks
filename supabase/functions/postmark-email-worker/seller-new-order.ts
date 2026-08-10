export const sellerNewOrderNotificationType = "seller_new_order";

const sellerNewOrderLogoUrl =
  "https://www.flockfront.com/branding/flockfront-logo-final-cropped.png";
const emailPattern = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SellerNewOrderContext = {
  recipientEmail: string;
  buyerFirstName: string;
  orderId: string;
  orderNumber: string;
  orderTotal: number;
  currency: string;
  fulfillmentMethod: "pickup" | "delivery";
  dashboardUrl: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Seller New Order ${field} is missing.`);
  }
  return value.trim();
}

export function parseSellerNewOrderRecipient(value: unknown): string {
  if (!isRecord(value)) {
    throw new Error("Seller New Order owner context is missing.");
  }
  const recipient = requiredText(value.recipient_email, "owner email")
    .toLowerCase();
  if (!emailPattern.test(recipient)) {
    throw new Error("Seller New Order owner email is invalid.");
  }
  return recipient;
}

export function parseSellerNewOrderContext(value: unknown): SellerNewOrderContext {
  if (!isRecord(value)) {
    throw new Error("Seller New Order context is missing.");
  }

  const recipientEmail = requiredText(value.recipient_email, "recipient email")
    .toLowerCase();
  const buyerFirstName = requiredText(value.buyer_first_name, "buyer first name");
  const orderId = requiredText(value.order_id, "order ID").toLowerCase();
  const orderNumber = requiredText(value.order_number, "order number");
  const currency = requiredText(value.currency, "currency").toUpperCase();
  const dashboardUrl = requiredText(value.dashboard_url, "dashboard URL");
  const total = typeof value.order_total === "string"
    ? Number(value.order_total)
    : value.order_total;

  if (!emailPattern.test(recipientEmail)) {
    throw new Error("Seller New Order recipient email is invalid.");
  }
  if (!uuidPattern.test(orderId)) {
    throw new Error("Seller New Order order ID is invalid.");
  }
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    throw new Error("Seller New Order total is invalid.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Seller New Order currency is invalid.");
  }
  if (value.fulfillment_method !== "pickup" && value.fulfillment_method !== "delivery") {
    throw new Error("Seller New Order fulfillment method is invalid.");
  }

  let parsedDashboardUrl: URL;
  try {
    parsedDashboardUrl = new URL(dashboardUrl);
  } catch {
    throw new Error("Seller New Order dashboard URL is invalid.");
  }
  if (
    parsedDashboardUrl.protocol !== "https:" ||
    !["flockfront.com", "www.flockfront.com"].includes(
      parsedDashboardUrl.hostname.toLowerCase(),
    ) ||
    parsedDashboardUrl.pathname !== `/dashboard/orders/${orderId}`
  ) {
    throw new Error("Seller New Order dashboard URL is invalid.");
  }

  return {
    recipientEmail,
    buyerFirstName,
    orderId,
    orderNumber,
    orderTotal: total,
    currency,
    fulfillmentMethod: value.fulfillment_method,
    dashboardUrl: parsedDashboardUrl.toString(),
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

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    throw new Error("Seller New Order currency is invalid.");
  }
}

export function sellerNewOrderSubject(context: SellerNewOrderContext) {
  return `New order from ${context.buyerFirstName} — Order #${context.orderNumber}`;
}

export function renderSellerNewOrderEmail(context: SellerNewOrderContext) {
  const buyerFirstName = escapeHtml(context.buyerFirstName);
  const orderNumber = escapeHtml(context.orderNumber);
  const orderTotal = formatCurrency(context.orderTotal, context.currency);
  const fulfillment = context.fulfillmentMethod === "delivery" ? "Delivery" : "Pickup";
  const subject = sellerNewOrderSubject(context);

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#fbf7ef;color:#10281c;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${buyerFirstName} placed a new order through your FlockFront store.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#fbf7ef" style="width:100%;background:#fbf7ef;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #ded6c7;border-radius:12px;overflow:hidden;">
        <tr><td height="4" bgcolor="#246f38" style="height:4px;background:#246f38;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td bgcolor="#fffaf1" style="padding:20px 30px;background:#fffaf1;border-bottom:1px solid #e8deca;">
          <img src="${sellerNewOrderLogoUrl}" width="205" alt="FlockFront" style="display:block;width:205px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td style="padding:30px;">
          <h1 style="margin:0 0 14px;color:#10281c;font-size:25px;line-height:1.25;">You have a new order</h1>
          <p style="margin:0 0 22px;color:#394137;font-size:16px;line-height:1.6;">${buyerFirstName} placed an order through your FlockFront store.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f7faf4" style="width:100%;margin:0 0 22px;background:#f7faf4;border:1px solid #dbe8d8;border-radius:8px;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0 0 5px;color:#394137;font-size:15px;line-height:1.5;">Order number: <strong style="color:#10281c;">#${orderNumber}</strong></p>
              <p style="margin:0 0 5px;color:#394137;font-size:15px;line-height:1.5;">Order total: <strong style="color:#10281c;">${orderTotal}</strong></p>
              <p style="margin:0;color:#394137;font-size:15px;line-height:1.5;">Method: <strong style="color:#10281c;">${fulfillment}</strong></p>
            </td></tr>
          </table>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 22px;"><tr><td bgcolor="#246f38" style="border-radius:7px;background:#246f38;"><a href="${escapeHtml(context.dashboardUrl)}" style="display:inline-block;padding:13px 20px;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">View order</a></td></tr></table>
          <p style="margin:0;color:#514b42;font-size:14px;line-height:1.65;">Reply to this email to contact ${buyerFirstName} directly.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    "You have a new order",
    "",
    `${context.buyerFirstName} placed an order through your FlockFront store.`,
    "",
    `Order number: #${context.orderNumber}`,
    `Order total: ${orderTotal}`,
    `Method: ${fulfillment}`,
    "",
    "View order:",
    context.dashboardUrl,
    "",
    `Reply to this email to contact ${context.buyerFirstName} directly.`,
  ].join("\n");

  return { subject, html, text };
}
