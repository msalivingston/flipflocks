export const sellerNewOrderNotificationType = "seller_new_order";

export const sellerNewOrderLogoUrl =
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
  if (
    value.fulfillment_method !== "pickup" &&
    value.fulfillment_method !== "delivery"
  ) {
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

export function sellerNewOrderSubject(context: SellerNewOrderContext) {
  return `New order from ${context.buyerFirstName} — Order #${context.orderNumber}`;
}
