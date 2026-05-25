import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";

type CheckoutItem = {
  inventory_item_id: string;
  quantity: number;
};

type OrderRequest = {
  store_slug: string;
  idempotency_key: string;
  buyer_email: string;
  buyer_first_name: string;
  buyer_last_name: string;
  buyer_phone: string;
  business_name?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  delivery_address_line1: string;
  delivery_address_line2?: string | null;
  delivery_city: string;
  delivery_state: string;
  delivery_postal_code: string;
  delivery_country?: string | null;
  buyer_notes?: string | null;
  pickup_note?: string | null;
  items: CheckoutItem[];
};

type OrderConfirmationRow = {
  order_number?: unknown;
  order_status?: unknown;
  payment_method?: unknown;
  payment_status?: unknown;
  subtotal_amount?: unknown;
  total_amount?: unknown;
  currency?: unknown;
  created_at?: unknown;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN") ??
    "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function sanitizeOrderConfirmation(
  order: OrderConfirmationRow | null,
): Record<string, unknown> | null {
  if (!order) {
    return null;
  }

  return {
    order_number: order.order_number ?? null,
    order_status: order.order_status ?? null,
    payment_method: order.payment_method ?? null,
    payment_status: order.payment_status ?? null,
    subtotal_amount: order.subtotal_amount ?? null,
    total_amount: order.total_amount ?? null,
    currency: order.currency ?? "USD",
    created_at: order.created_at ?? null,
  };
}

function requiredText(
  body: Record<string, unknown>,
  key: keyof OrderRequest,
  maxLength: number,
): string {
  const value = body[key];

  if (typeof value !== "string") {
    throw new Error(`${key} is required.`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${key} is required.`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${key} is too long.`);
  }

  return trimmed;
}

function optionalText(
  body: Record<string, unknown>,
  key: keyof OrderRequest,
  maxLength: number,
): string | null {
  const value = body[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be text.`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${key} is too long.`);
  }

  return trimmed;
}

function normalizeItems(value: unknown): CheckoutItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("At least one checkout item is required.");
  }

  if (value.length > 50) {
    throw new Error("Too many checkout items.");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each checkout item must be an object.");
    }

    const record = item as Record<string, unknown>;
    const inventoryItemId = record.inventory_item_id;
    const quantity = record.quantity;

    if (typeof inventoryItemId !== "string" || !uuidPattern.test(inventoryItemId)) {
      throw new Error("Each checkout item needs a valid inventory item ID.");
    }

    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      throw new Error("Each checkout item quantity must be a positive integer.");
    }

    return {
      inventory_item_id: inventoryItemId,
      quantity,
    };
  });
}

function parseBuyerIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const candidate = (forwardedFor?.split(",")[0] ?? realIp ?? "").trim();

  if (!candidate) {
    return null;
  }

  const ipv4Pattern =
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

  return ipv4Pattern.test(candidate) ? candidate : null;
}

function parseOrderRequest(body: unknown): OrderRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object.");
  }

  const record = body as Record<string, unknown>;
  const allowedKeys = new Set([
    "store_slug",
    "idempotency_key",
    "buyer_email",
    "buyer_first_name",
    "buyer_last_name",
    "buyer_phone",
    "business_name",
    "city",
    "state",
    "country",
    "delivery_address_line1",
    "delivery_address_line2",
    "delivery_city",
    "delivery_state",
    "delivery_postal_code",
    "delivery_country",
    "buyer_notes",
    "pickup_note",
    "items",
  ]);

  const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));

  if (unknownKeys.length > 0) {
    throw new Error(`Unsupported field(s): ${unknownKeys.sort().join(", ")}`);
  }

  const storeSlug = requiredText(record, "store_slug", 120).toLowerCase();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storeSlug)) {
    throw new Error("Store slug is invalid.");
  }

  const idempotencyKey = requiredText(record, "idempotency_key", 200);
  const buyerEmail = requiredText(record, "buyer_email", 320).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    throw new Error("Buyer email is invalid.");
  }

  return {
    store_slug: storeSlug,
    idempotency_key: idempotencyKey,
    buyer_email: buyerEmail,
    buyer_first_name: requiredText(record, "buyer_first_name", 120),
    buyer_last_name: requiredText(record, "buyer_last_name", 120),
    buyer_phone: requiredText(record, "buyer_phone", 80),
    business_name: optionalText(record, "business_name", 160),
    city: optionalText(record, "city", 120),
    state: optionalText(record, "state", 120),
    country: optionalText(record, "country", 80),
    delivery_address_line1: requiredText(
      record,
      "delivery_address_line1",
      200,
    ),
    delivery_address_line2: optionalText(record, "delivery_address_line2", 200),
    delivery_city: requiredText(record, "delivery_city", 120),
    delivery_state: requiredText(record, "delivery_state", 120),
    delivery_postal_code: requiredText(record, "delivery_postal_code", 40),
    delivery_country: optionalText(record, "delivery_country", 80),
    buyer_notes: optionalText(record, "buyer_notes", 2000),
    pickup_note: optionalText(record, "pickup_note", 1000),
    items: normalizeItems(record.items),
  };
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
      message: "Use POST to create a pay-at-pickup order.",
    });
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(415, {
      error: "unsupported_media_type",
      message: "Use application/json for pay-at-pickup order requests.",
    });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > 64_000) {
    return jsonResponse(413, {
      error: "request_too_large",
      message: "Order request is too large.",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      error: "server_configuration_error",
      message: "Order service is not configured.",
    });
  }

  let orderRequest: OrderRequest;

  try {
    orderRequest = parseOrderRequest(await request.json());
  } catch (error) {
    return jsonResponse(400, {
      error: "invalid_request",
      message: error instanceof Error ? error.message : "Invalid request.",
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: storefrontRows, error: storefrontError } = await supabase.rpc(
    "get_public_storefront_by_slug",
    {
      p_store_slug: orderRequest.store_slug,
    },
  );

  if (storefrontError) {
    return jsonResponse(500, {
      error: "storefront_lookup_failed",
      message: "Unable to verify storefront availability.",
    });
  }

  const storefrontStatus = Array.isArray(storefrontRows)
    ? storefrontRows[0]
    : null;

  if (!storefrontStatus?.is_publicly_available || !storefrontStatus.storefront) {
    return jsonResponse(storefrontStatus?.store_exists ? 409 : 404, {
      error: "storefront_unavailable",
      message: storefrontStatus?.message ?? "This store is currently unavailable.",
    });
  }

  const storeId = storefrontStatus.storefront.store_id;

  if (typeof storeId !== "string" || !uuidPattern.test(storeId)) {
    return jsonResponse(500, {
      error: "storefront_lookup_failed",
      message: "Storefront payload is invalid.",
    });
  }

  const { data: summaryRows, error: summaryError } = await supabase.rpc(
    "get_public_checkout_summary",
    {
      p_store_slug: orderRequest.store_slug,
      p_items: orderRequest.items,
    },
  );

  if (summaryError) {
    return jsonResponse(500, {
      error: "checkout_summary_failed",
      message: "Unable to verify checkout items.",
    });
  }

  const checkoutSummary = Array.isArray(summaryRows) ? summaryRows[0] : null;

  if (!checkoutSummary?.is_checkout_available) {
    return jsonResponse(409, {
      error: "checkout_unavailable",
      message: checkoutSummary?.message ??
        "One or more checkout items are unavailable.",
      checkout: checkoutSummary ?? null,
    });
  }

  const { data: orderRows, error: orderError } = await supabase.rpc(
    "create_pay_at_pickup_order",
    {
      p_store_id: storeId,
      p_idempotency_key: orderRequest.idempotency_key,
      p_buyer_email: orderRequest.buyer_email,
      p_buyer_first_name: orderRequest.buyer_first_name,
      p_buyer_last_name: orderRequest.buyer_last_name,
      p_items: orderRequest.items,
      p_buyer_phone: orderRequest.buyer_phone,
      p_business_name: orderRequest.business_name,
      p_city: orderRequest.city,
      p_state: orderRequest.state,
      p_country: orderRequest.country,
      p_delivery_address_line1: orderRequest.delivery_address_line1,
      p_delivery_address_line2: orderRequest.delivery_address_line2,
      p_delivery_city: orderRequest.delivery_city,
      p_delivery_state: orderRequest.delivery_state,
      p_delivery_postal_code: orderRequest.delivery_postal_code,
      p_delivery_country: orderRequest.delivery_country,
      p_buyer_notes: orderRequest.buyer_notes,
      p_pickup_note: orderRequest.pickup_note,
      p_buyer_ip_address: parseBuyerIp(request),
      p_buyer_user_agent: request.headers.get("user-agent"),
    },
  );

  if (orderError) {
    const message = orderError.message || "Unable to create order.";
    const conflictMessages = [
      "Idempotency key was already used with a different request.",
      "Store is not available for checkout.",
      "One or more inventory items were not found.",
      "One or more inventory items do not belong to this store.",
      "One or more inventory items are not available for checkout.",
      "Insufficient inventory quantity available.",
      "Invalid inventory type for listing batch type.",
    ];
    const safeValidationMessages = [
      "Store is required.",
      "Idempotency key is required.",
      "Idempotency key must be 200 characters or fewer.",
      "Buyer email is required.",
      "Buyer first name is required.",
      "Buyer last name is required.",
      "Buyer phone is required.",
      "Buyer address line 1 is required.",
      "Buyer city is required.",
      "Buyer state is required.",
      "Buyer postal code is required.",
      "At least one order item is required.",
      "Each order item must include a valid inventory item ID and positive quantity.",
      "At least one valid order item is required.",
      "Invalid inventory relationship for checkout.",
      ...conflictMessages,
    ];
    const safeMessage = safeValidationMessages.includes(message)
      ? message
      : "Unable to place order. Please review your cart and try again.";

    if (!safeValidationMessages.includes(message)) {
      console.error("create_pay_at_pickup_order failed", orderError);
    }

    return jsonResponse(conflictMessages.includes(message) ? 409 : 400, {
      error: "order_creation_failed",
      message: safeMessage,
    });
  }

  const order = sanitizeOrderConfirmation(
    Array.isArray(orderRows) ? orderRows[0] : null,
  );

  return jsonResponse(201, {
    order,
    checkout: {
      item_count: checkoutSummary.item_count,
      total_quantity: checkoutSummary.total_quantity,
      subtotal_amount: checkoutSummary.subtotal_amount,
    },
  });
});
