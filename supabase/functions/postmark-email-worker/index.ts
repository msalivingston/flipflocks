import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN") ??
    "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-flockfront-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NotificationType = "buyer_order_confirmation" | "seller_new_order";

type ClaimedNotification = {
  notification_id: string;
  processing_token: string;
  store_id: string;
  order_id: string;
  recipient_type: "buyer" | "seller" | string;
  recipient_email: string;
  notification_type: NotificationType | string;
  subject_snapshot: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

type OrderRow = {
  id: string;
  store_id: string;
  customer_id: string;
  order_number: string;
  order_source: string;
  order_status: string;
  payment_method: string;
  payment_status: string;
  buyer_email_snapshot: string;
  buyer_first_name_snapshot: string;
  buyer_last_name_snapshot: string;
  buyer_phone_snapshot: string | null;
  buyer_address_line1_snapshot?: string | null;
  buyer_address_line2_snapshot?: string | null;
  buyer_city_snapshot?: string | null;
  buyer_state_snapshot?: string | null;
  buyer_postal_code_snapshot?: string | null;
  buyer_country_snapshot?: string | null;
  buyer_notes: string | null;
  pickup_note: string | null;
  pickup_option_id?: string | null;
  pickup_option_label_snapshot?: string | null;
  subtotal_amount: number | string;
  tax_fee_label_snapshot: string | null;
  tax_fee_amount: number | string;
  total_amount: number | string;
  created_at: string;
};

type StoreRow = {
  id: string;
  store_name: string;
  store_slug: string;
  public_email: string | null;
  public_phone: string | null;
  communication_email?: string | null;
  order_notification_email?: string | null;
  pickup_instructions: string | null;
  pickup_location_text?: string | null;
  currency?: string | null;
};

type CustomerRow = {
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  business_name: string | null;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_postal_code: string | null;
  delivery_country: string | null;
};

type OrderItemRow = {
  order_item_source: string | null;
  species_name_snapshot: string | null;
  breed_display_name_snapshot: string | null;
  custom_inventory_label_snapshot: string | null;
  product_type_snapshot?: string | null;
  item_name_snapshot?: string | null;
  item_category_snapshot?: string | null;
  custom_item_name_snapshot?: string | null;
  unit_price_snapshot: number | string;
  quantity: number;
  line_subtotal: number | string;
};

type PickupOptionRow = {
  label: string;
  description: string | null;
};

type EmailContext = {
  order: OrderRow;
  store: StoreRow;
  customer: CustomerRow | null;
  items: OrderItemRow[];
  pickupOption: PickupOptionRow | null;
  logo: {
    url: string;
    altText: string;
  } | null;
};

type RenderedEmail = {
  to: string;
  fromName: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
};

type SupabaseClient = ReturnType<typeof createClient>;

const postmarkEndpoint = "https://api.postmarkapp.com/email";
const maxNotificationsPerInvocation = 50;
const workerSecretHeader = "x-flockfront-worker-secret";
const emailPattern = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function serverConfigurationResponse(): Response {
  return jsonResponse(500, {
    error: "server_configuration_error",
    message: "Email worker is not configured.",
  });
}

function unauthorizedResponse(): Response {
  return jsonResponse(401, {
    error: "unauthorized",
    message: "Unauthorized.",
  });
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function authorizeWorkerRequest(request: Request): Response | null {
  const expectedSecret = Deno.env.get("POSTMARK_WORKER_SECRET")?.trim();

  if (!expectedSecret) {
    return serverConfigurationResponse();
  }

  const providedSecret = request.headers.get(workerSecretHeader)?.trim() ?? "";

  if (!providedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return unauthorizedResponse();
  }

  return null;
}

function parseBatchSize(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 10;

  const value = (body as Record<string, unknown>).batch_size;

  if (typeof value !== "number" || !Number.isFinite(value)) return 10;

  return Math.min(Math.max(Math.floor(value), 1), 25);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength <= 0) return null;

  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function fetchEmailContext(
  supabase: SupabaseClient,
  supabaseUrl: string,
  notification: ClaimedNotification,
): Promise<EmailContext> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, store_id, customer_id, order_number, order_source, order_status, payment_method, payment_status, buyer_email_snapshot, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_phone_snapshot, buyer_address_line1_snapshot, buyer_address_line2_snapshot, buyer_city_snapshot, buyer_state_snapshot, buyer_postal_code_snapshot, buyer_country_snapshot, buyer_notes, pickup_note, pickup_option_id, pickup_option_label_snapshot, subtotal_amount, tax_fee_label_snapshot, tax_fee_amount, total_amount, created_at",
    )
    .eq("id", notification.order_id)
    .eq("store_id", notification.store_id)
    .maybeSingle<OrderRow>();

  if (orderError || !order) {
    throw new Error(orderError?.message || "Order was not found.");
  }

  const [storeResult, customerResult, itemsResult, pickupResult, logo] =
    await Promise.all([
      supabase
        .from("stores")
        .select(
          "id, store_name, store_slug, public_email, public_phone, communication_email, order_notification_email, pickup_instructions, pickup_location_text, currency",
        )
        .eq("id", order.store_id)
        .maybeSingle<StoreRow>(),
      supabase
        .from("customers")
        .select(
          "email, first_name, last_name, phone, business_name, delivery_address_line1, delivery_address_line2, delivery_city, delivery_state, delivery_postal_code, delivery_country",
        )
        .eq("id", order.customer_id)
        .eq("store_id", order.store_id)
        .maybeSingle<CustomerRow>(),
      supabase
        .from("order_items")
        .select(
          "order_item_source, species_name_snapshot, breed_display_name_snapshot, custom_inventory_label_snapshot, product_type_snapshot, item_name_snapshot, item_category_snapshot, custom_item_name_snapshot, unit_price_snapshot, quantity, line_subtotal, created_at",
        )
        .eq("order_id", order.id)
        .eq("store_id", order.store_id)
        .order("created_at", { ascending: true })
        .returns<OrderItemRow[]>(),
      order.pickup_option_id
        ? supabase
          .from("store_pickup_options")
          .select("label, description")
          .eq("id", order.pickup_option_id)
          .eq("store_id", order.store_id)
          .maybeSingle<PickupOptionRow>()
        : Promise.resolve({ data: null, error: null }),
      fetchStoreLogo(supabase, supabaseUrl, order.store_id),
    ]);

  if (storeResult.error || !storeResult.data) {
    throw new Error(storeResult.error?.message || "Store was not found.");
  }

  if (itemsResult.error) {
    throw new Error(itemsResult.error.message || "Order items could not load.");
  }

  if (customerResult.error) {
    throw new Error(customerResult.error.message || "Customer could not load.");
  }

  if (pickupResult.error) {
    throw new Error(pickupResult.error.message || "Pickup option could not load.");
  }

  return {
    order,
    store: storeResult.data,
    customer: customerResult.data ?? null,
    items: itemsResult.data ?? [],
    pickupOption: pickupResult.data ?? null,
    logo,
  };
}

async function fetchStoreLogo(
  supabase: SupabaseClient,
  supabaseUrl: string,
  storeId: string,
): Promise<EmailContext["logo"]> {
  const { data, error } = await supabase
    .from("media_links")
    .select(
      "alt_text_override, media_assets(source_type, source_image_url, bucket_name, storage_path, alt_text)",
    )
    .eq("store_id", storeId)
    .eq("entity_type", "store")
    .eq("entity_id", storeId)
    .eq("display_context", "logo")
    .eq("visibility_status", "active")
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const record = data as Record<string, unknown>;
  const asset = normalizeNestedAsset(record.media_assets);
  const url = asset ? mediaAssetUrl(supabaseUrl, asset) : null;

  if (!url) return null;

  return {
    url,
    altText: firstText(
      textOrNull(record.alt_text_override),
      textOrNull(asset?.alt_text),
    ) ?? "Store logo",
  };
}

function normalizeNestedAsset(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? first as Record<string, unknown> : null;
  }

  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function mediaAssetUrl(
  supabaseUrl: string,
  asset: Record<string, unknown>,
): string | null {
  const sourceImageUrl = textOrNull(asset.source_image_url);

  if (sourceImageUrl) {
    return httpsUrlOrNull(sourceImageUrl);
  }

  const bucket = textOrNull(asset.bucket_name);
  const storagePath = textOrNull(asset.storage_path);

  if (!bucket || !storagePath) return null;

  return httpsUrlOrNull(`${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${
    encodeURIComponent(bucket)
  }/${storagePath.split("/").map(encodeURIComponent).join("/")}`);
}

function renderEmail(
  notification: ClaimedNotification,
  context: EmailContext,
  fromEmail: string,
  siteOrigin: string,
): RenderedEmail {
  if (notification.notification_type === "buyer_order_confirmation") {
    return renderBuyerOrderConfirmation(notification, context, fromEmail);
  }

  if (notification.notification_type === "seller_new_order") {
    return renderSellerNewOrder(notification, context, fromEmail, siteOrigin);
  }

  throw new Error(`Unsupported notification type: ${notification.notification_type}`);
}

function renderBuyerOrderConfirmation(
  notification: ClaimedNotification,
  context: EmailContext,
  fromEmail: string,
): RenderedEmail {
  const { order, store, items, pickupOption, logo } = context;
  const buyerName = formatPersonName(
    order.buyer_first_name_snapshot,
    order.buyer_last_name_snapshot,
  );
  const sellerContact = firstText(
    store.communication_email,
    store.public_email,
    store.order_notification_email,
  );
  const replyTo = firstValidEmail(
    store.communication_email,
    store.public_email,
    store.order_notification_email,
    fromEmail,
  );
  const subject = `Order ${formatOrderNumber(order.order_number)} confirmation from ${store.store_name}`;

  const introRows = [
    fact("Store", store.store_name),
    fact("Order number", formatOrderNumber(order.order_number)),
    fact("Order date", formatDateTime(order.created_at)),
    fact("Payment", paymentText(order.payment_status)),
    fact("Total", formatCurrency(order.total_amount, store.currency)),
  ];
  const contactRows = [
    fact("Name", buyerName),
    fact("Email", order.buyer_email_snapshot),
    fact("Phone", order.buyer_phone_snapshot),
    fact("Address", formatAddress([
      order.buyer_address_line1_snapshot,
      order.buyer_address_line2_snapshot,
      joinCompact([order.buyer_city_snapshot, order.buyer_state_snapshot, order.buyer_postal_code_snapshot], ", "),
      order.buyer_country_snapshot,
    ])),
  ];
  const pickupRows = [
    fact("Pickup option", order.pickup_option_label_snapshot),
    fact("Pickup details", pickupOption?.description),
    fact("Pickup note", order.pickup_note),
    fact("Store pickup information", store.pickup_instructions),
    fact("Pickup location", store.pickup_location_text),
  ];
  const sellerRows = [
    fact("Seller email", sellerContact),
    fact("Seller phone", store.public_phone),
  ];

  const html = emailShell({
    title: `Order ${formatOrderNumber(order.order_number)}`,
    preheader: `Your pay-at-pickup order with ${store.store_name} has been received.`,
    logo,
    body: [
      paragraph(
        `Thanks, ${buyerName || "there"}. Your pay-at-pickup order has been received by ${store.store_name}. The seller will coordinate pickup as needed.`,
      ),
      factTable(introRows),
      section("Items", itemTable(items, store.currency)),
      section("Buyer contact", factTable(contactRows)),
      optionalSection("Pickup", factTable(pickupRows)),
      optionalSection("Notes", paragraph(order.buyer_notes ?? "")),
      optionalSection("Seller contact", factTable(sellerRows)),
    ].join(""),
    branded: false,
  });

  const text = [
    `${store.store_name} order confirmation`,
    "",
    `Order: ${formatOrderNumber(order.order_number)}`,
    `Order date: ${formatDateTime(order.created_at)}`,
    `Payment: ${paymentText(order.payment_status)}`,
    `Total: ${formatCurrency(order.total_amount, store.currency)}`,
    "",
    "This is a pay-at-pickup order. The seller will coordinate pickup as needed.",
    "",
    "Items:",
    ...items.map((item) =>
      `- ${itemName(item)} x ${item.quantity}: ${formatCurrency(item.line_subtotal, store.currency)}`
    ),
    "",
    "Buyer contact:",
    ...textFacts(contactRows),
    "",
    ...textSection("Pickup", pickupRows),
    ...textSection("Notes", order.buyer_notes ? [order.buyer_notes] : []),
    ...textSection("Seller contact", sellerRows),
  ].join("\n");

  return {
    to: notification.recipient_email,
    fromName: sanitizeHeaderValue(store.store_name) || "FlockFront",
    replyTo,
    subject: sanitizeHeaderValue(subject),
    html,
    text,
  };
}

function renderSellerNewOrder(
  notification: ClaimedNotification,
  context: EmailContext,
  fromEmail: string,
  siteOrigin: string,
): RenderedEmail {
  const { order, store, items } = context;
  const buyerName = formatPersonName(
    order.buyer_first_name_snapshot,
    order.buyer_last_name_snapshot,
  );
  const recipient = firstValidEmail(
    store.order_notification_email,
    store.communication_email,
    store.public_email,
    notification.recipient_email,
  );

  if (!recipient) {
    throw new Error("Seller notification has no recipient email.");
  }

  const orderUrl = `${siteOrigin.replace(/\/$/, "")}/dashboard/orders/${order.id}`;
  const subject = `New FlockFront order ${formatOrderNumber(order.order_number)}`;
  const summaryRows = [
    fact("Order number", formatOrderNumber(order.order_number)),
    fact("Order date", formatDateTime(order.created_at)),
    fact("Buyer", buyerName),
    fact("Buyer email", order.buyer_email_snapshot),
    fact("Phone", order.buyer_phone_snapshot),
    fact("Payment", paymentText(order.payment_status)),
    fact("Total", formatCurrency(order.total_amount, store.currency)),
    fact("Pickup preference", order.pickup_option_label_snapshot || order.pickup_note),
  ];

  const html = emailShell({
    title: "New order",
    preheader: `${buyerName || "A buyer"} placed order ${formatOrderNumber(order.order_number)}.`,
    logo: null,
    body: [
      paragraph(`${buyerName || "A buyer"} placed a new pay-at-pickup order for ${store.store_name}.`),
      factTable(summaryRows),
      section("Items", itemTable(items, store.currency)),
      optionalSection("Buyer notes", paragraph(order.buyer_notes ?? "")),
      `<p style="margin:24px 0 0;"><a href="${escapeAttribute(orderUrl)}" style="display:inline-block;background:#12372a;color:#ffffff;text-decoration:none;padding:12px 16px;border-radius:6px;font-weight:700;">View order</a></p>`,
    ].join(""),
    branded: true,
  });

  const text = [
    "FlockFront new order",
    "",
    `${buyerName || "A buyer"} placed a new pay-at-pickup order for ${store.store_name}.`,
    "",
    ...textFacts(summaryRows),
    "",
    "Items:",
    ...items.map((item) =>
      `- ${itemName(item)} x ${item.quantity}: ${formatCurrency(item.line_subtotal, store.currency)}`
    ),
    "",
    ...textSection("Buyer notes", order.buyer_notes ? [order.buyer_notes] : []),
    `View order: ${orderUrl}`,
  ].join("\n");

  return {
    to: recipient,
    fromName: "FlockFront",
    subject: sanitizeHeaderValue(subject),
    html,
    text,
  };
}

async function sendPostmarkEmail({
  email,
  fromEmail,
  messageStream,
  token,
}: {
  email: RenderedEmail;
  fromEmail: string;
  messageStream: string;
  token: string;
}): Promise<string | null> {
  const recipient = validEmailOrNull(email.to);
  const replyTo = email.replyTo ? validEmailOrNull(email.replyTo) : null;
  const sender = validEmailOrNull(fromEmail);

  if (!recipient) {
    throw new Error("Recipient email address is invalid.");
  }

  if (email.replyTo && !replyTo) {
    throw new Error("Reply-To email address is invalid.");
  }

  if (!sender) {
    throw new Error("Sender email address is invalid.");
  }

  const response = await fetch(postmarkEndpoint, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: formatFromAddress(email.fromName, sender),
      To: recipient,
      ReplyTo: replyTo,
      Subject: sanitizeHeaderValue(email.subject),
      HtmlBody: email.html,
      TextBody: sanitizePlainText(email.text),
      MessageStream: messageStream,
    }),
  });

  const responseBody = await readPostmarkResponse(response);

  if (!response.ok) {
    throw new Error(
      responseBody.message || `Postmark send failed with status ${response.status}.`,
    );
  }

  return responseBody.messageId;
}

async function readPostmarkResponse(
  response: Response,
): Promise<{ message: string | null; messageId: string | null }> {
  try {
    const body = await response.json() as Record<string, unknown>;
    const message = textOrNull(body.Message) ?? textOrNull(body.message);
    const messageId = textOrNull(body.MessageID) ?? textOrNull(body.messageId);

    return { message, messageId };
  } catch {
    return { message: null, messageId: null };
  }
}

async function markNotificationSent(
  supabase: SupabaseClient,
  notification: ClaimedNotification,
  messageId: string | null,
) {
  const { error } = await supabase.rpc("mark_email_notification_sent", {
    p_notification_id: notification.notification_id,
    p_processing_token: notification.processing_token,
    p_provider_message_id: messageId,
  });

  if (error) {
    throw new Error(error.message || "Notification sent state could not be saved.");
  }
}

async function markNotificationFailed(
  supabase: SupabaseClient,
  notification: ClaimedNotification,
  error: unknown,
) {
  const message = sanitizeStoredError(
    error instanceof Error ? error.message : String(error),
  );

  await supabase.rpc("mark_email_notification_failed", {
    p_notification_id: notification.notification_id,
    p_processing_token: notification.processing_token,
    p_last_error: message.slice(0, 1000),
    p_retry_after: "5 minutes",
    p_max_attempts: 5,
  });
}

function emailShell({
  body,
  branded,
  logo,
  preheader,
  title,
}: {
  body: string;
  branded: boolean;
  logo: EmailContext["logo"];
  preheader: string;
  title: string;
}) {
  const brandLine = branded
    ? `<p style="margin:0 0 20px;color:#3d4a43;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">FlockFront</p>`
    : "";
  const logoHtml = logo
    ? `<img src="${escapeAttribute(logo.url)}" alt="${escapeAttribute(logo.altText)}" style="display:block;max-width:160px;max-height:72px;margin:0 0 24px;">`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;color:#000000;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;color:#000000;">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;color:#000000;">
            <tr>
              <td style="padding:0;">
                ${brandLine}
                ${logoHtml}
                <h1 style="margin:0 0 18px;color:#000000;font-size:24px;line-height:1.25;font-weight:700;">${escapeHtml(title)}</h1>
                ${body}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function section(title: string, body: string): string {
  return `<h2 style="margin:26px 0 10px;color:#000000;font-size:16px;line-height:1.3;">${escapeHtml(title)}</h2>${body}`;
}

function optionalSection(title: string, body: string): string {
  return body.trim() ? section(title, body) : "";
}

function paragraph(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  return `<p style="margin:0 0 16px;color:#000000;font-size:15px;line-height:1.6;">${escapeHtml(trimmed)}</p>`;
}

function fact(label: string, value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? { label, value: trimmed } : null;
}

function factTable(rows: Array<{ label: string; value: string } | null>): string {
  const filtered = rows.filter(Boolean) as Array<{ label: string; value: string }>;

  if (filtered.length === 0) return "";

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:6px 0 16px;">${
    filtered.map((row) => `<tr>
      <td style="width:42%;border-top:1px solid #dddddd;padding:9px 8px 9px 0;color:#555555;font-size:14px;vertical-align:top;">${escapeHtml(row.label)}</td>
      <td style="border-top:1px solid #dddddd;padding:9px 0;color:#000000;font-size:14px;vertical-align:top;">${escapeHtml(row.value)}</td>
    </tr>`).join("")
  }</table>`;
}

function itemTable(items: OrderItemRow[], currency?: string | null): string {
  if (items.length === 0) return paragraph("No item details were available.");

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:6px 0 16px;">
    <tr>
      <th align="left" style="border-bottom:2px solid #000000;padding:8px 8px 8px 0;color:#000000;font-size:13px;">Item</th>
      <th align="right" style="border-bottom:2px solid #000000;padding:8px;color:#000000;font-size:13px;">Qty</th>
      <th align="right" style="border-bottom:2px solid #000000;padding:8px;color:#000000;font-size:13px;">Price</th>
      <th align="right" style="border-bottom:2px solid #000000;padding:8px 0 8px 8px;color:#000000;font-size:13px;">Line</th>
    </tr>
    ${items.map((item) => `<tr>
      <td style="border-bottom:1px solid #dddddd;padding:10px 8px 10px 0;color:#000000;font-size:14px;">${escapeHtml(itemName(item))}</td>
      <td align="right" style="border-bottom:1px solid #dddddd;padding:10px 8px;color:#000000;font-size:14px;">${item.quantity}</td>
      <td align="right" style="border-bottom:1px solid #dddddd;padding:10px 8px;color:#000000;font-size:14px;">${escapeHtml(formatCurrency(item.unit_price_snapshot, currency))}</td>
      <td align="right" style="border-bottom:1px solid #dddddd;padding:10px 0 10px 8px;color:#000000;font-size:14px;">${escapeHtml(formatCurrency(item.line_subtotal, currency))}</td>
    </tr>`).join("")}
  </table>`;
}

function textFacts(rows: Array<{ label: string; value: string } | null>) {
  return (rows.filter(Boolean) as Array<{ label: string; value: string }>)
    .map((row) => `${row.label}: ${row.value}`);
}

function textSection(
  title: string,
  values: Array<{ label: string; value: string } | string | null>,
) {
  const lines = values.flatMap((value) => {
    if (!value) return [];
    if (typeof value === "string") return value.trim() ? [value.trim()] : [];
    return value.value.trim() ? [`${value.label}: ${value.value}`] : [];
  });

  return lines.length > 0 ? [title + ":", ...lines, ""] : [];
}

function itemName(item: OrderItemRow): string {
  return firstText(
    item.item_name_snapshot,
    item.custom_item_name_snapshot,
    item.breed_display_name_snapshot,
    item.custom_inventory_label_snapshot,
    item.species_name_snapshot,
    "Order item",
  ) ?? "Order item";
}

function formatPersonName(firstName?: string | null, lastName?: string | null) {
  return joinCompact([firstName, lastName], " ");
}

function formatOrderNumber(orderNumber: string) {
  return orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`;
}

function paymentText(status: string) {
  if (status === "pay_at_pickup") return "Pay at pickup";
  if (status === "paid") return "Paid";
  if (status === "unpaid") return "Unpaid";
  if (status === "canceled") return "Canceled";
  if (status === "refunded") return "Refunded";
  return humanize(status);
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCurrency(value: number | string, currency?: string | null) {
  const amount = typeof value === "number" ? value : Number(value);
  const currencyCode = (currency || "usd").toUpperCase();

  if (!Number.isFinite(amount)) return "$0.00";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(amount);
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Denver",
  }).format(date);
}

function formatAddress(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join("\n");
}

function joinCompact(values: Array<string | null | undefined>, separator: string) {
  return values.map((value) => value?.trim()).filter(Boolean).join(separator);
}

function firstText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }

  return null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function httpsUrlOrNull(value: string): string | null {
  try {
    const url = new URL(value);

    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatFromAddress(name: string, email: string) {
  const mailboxName = sanitizeHeaderValue(name).replace(/["\\<>]/g, "").trim() ||
    "FlockFront";
  return `"${mailboxName}" <${email}>`;
}

function sanitizeHeaderValue(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ")
    .trim();
}

function sanitizePlainText(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
}

function sanitizeStoredError(value: string) {
  return maskEmailAddresses(sanitizePlainText(value)).slice(0, 1000);
}

function maskEmailAddresses(value: string) {
  return value.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[email]",
  );
}

function validEmailOrNull(value: string | null | undefined) {
  const sanitized = value ? sanitizeHeaderValue(value).toLowerCase() : "";

  if (!sanitized || !emailPattern.test(sanitized)) return null;

  return sanitized;
}

function firstValidEmail(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const valid = validEmailOrNull(value);
    if (valid) return valid;
  }

  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function siteOriginFromEnv() {
  return httpsUrlOrNull(
    firstText(Deno.env.get("FLOCKFRONT_PUBLIC_SITE_URL")) ?? "",
  ) ?? "https://flockfront.com";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, {
      error: "method_not_allowed",
      message: "Use POST to process email notifications.",
    });
  }

  const unauthorized = authorizeWorkerRequest(request);
  if (unauthorized) return unauthorized;

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const postmarkToken = getRequiredEnv("POSTMARK_SERVER_TOKEN");
  const fromEmail = getRequiredEnv("POSTMARK_FROM_EMAIL");
  const messageStream = getRequiredEnv("POSTMARK_MESSAGE_STREAM");
  const siteOrigin = siteOriginFromEnv();

  const body = await readJsonBody(request);
  const batchSize = parseBatchSize(body);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let claimedCount = 0;
  let batchCount = 0;
  let sentCount = 0;
  let failedCount = 0;

  while (claimedCount < maxNotificationsPerInvocation) {
    const remainingCapacity = maxNotificationsPerInvocation - claimedCount;
    const claimSize = Math.min(batchSize, remainingCapacity);
    const { data, error } = await supabase.rpc(
      "claim_phase_1_postmark_email_notifications",
      {
        p_batch_size: claimSize,
        p_max_attempts: 5,
        p_stale_after: "15 minutes",
      },
    );

    if (error) {
      return jsonResponse(500, {
        error: "claim_failed",
        claimed: claimedCount,
        batches: batchCount,
        sent: sentCount,
        failed: failedCount,
      });
    }

    const notifications = Array.isArray(data)
      ? data as ClaimedNotification[]
      : [];

    if (notifications.length === 0) break;

    batchCount += 1;
    claimedCount += notifications.length;
    console.info(
      "postmark-email-worker claimed batch",
      JSON.stringify({
        batch: batchCount,
        claimed: notifications.length,
        total_claimed: claimedCount,
        notification_ids: notifications.map((notification) =>
          notification.notification_id
        ),
      }),
    );

    for (const notification of notifications) {
      try {
        if (
          notification.notification_type !== "buyer_order_confirmation" &&
          notification.notification_type !== "seller_new_order"
        ) {
          throw new Error(
            `Unsupported Phase 1 notification type: ${notification.notification_type}`,
          );
        }

        const context = await fetchEmailContext(supabase, supabaseUrl, notification);
        const email = renderEmail(notification, context, fromEmail, siteOrigin);
        const messageId = await sendPostmarkEmail({
          email,
          fromEmail,
          messageStream,
          token: postmarkToken,
        });

        await markNotificationSent(supabase, notification, messageId);
        sentCount += 1;
      } catch (sendError) {
        await markNotificationFailed(supabase, notification, sendError);
        failedCount += 1;
      }
    }
  }

  return jsonResponse(200, {
    claimed: claimedCount,
    batches: batchCount,
    sent: sentCount,
    failed: failedCount,
  });
});
