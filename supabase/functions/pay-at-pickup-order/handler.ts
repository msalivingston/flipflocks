type RpcResult = {
  data: unknown;
  error: {
    message?: string;
    code?: string;
    details?: string;
    hint?: string;
    name?: string;
  } | null;
};

type ServiceClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
};

type HandlerDependencies = {
  createServiceClient: (
    supabaseUrl: string,
    serviceRoleKey: string,
  ) => ServiceClient;
  env: (name: string) => string | undefined;
  fetch?: typeof fetch;
};

type CheckoutItem = {
  item_type:
    | "listing_inventory"
    | "equipment_inventory"
    | "processed_poultry_inventory"
    | "hatching_egg_inventory";
  item_id: string;
  inventory_item_id?: string;
  quantity: number;
};

type CheckoutItemType = CheckoutItem["item_type"];

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
  pickup_option_id?: string | null;
  fulfillment_method?: "pickup" | "delivery";
  delivery_option_id?: string | null;
  items: CheckoutItem[];
};

type OrderConfirmationRow = {
  order_id?: unknown;
  order_number?: unknown;
  order_status?: unknown;
  payment_method?: unknown;
  payment_status?: unknown;
  subtotal_amount?: unknown;
  total_amount?: unknown;
  currency?: unknown;
  created_at?: unknown;
};

type RateLimitRow = {
  allowed?: unknown;
  authoritative_retry?: unknown;
  retry_after_seconds?: unknown;
};

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLocalSupabaseUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "host.docker.internal" ||
      hostname === "kong" ||
      hostname.startsWith("supabase_kong_");
  } catch {
    return false;
  }
}

function normalizeConfiguredOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.origin !== value.trim()
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function resolveCorsPolicy(env: HandlerDependencies["env"]):
  | { ok: true; allowedOrigin: string; headers: Record<string, string> }
  | { ok: false; headers: Record<string, string> } {
  const configuredOriginValue = env("FLIPFLOCKS_PUBLIC_API_ORIGIN")?.trim();
  const configuredOrigin = normalizeConfiguredOrigin(configuredOriginValue);
  const environment = env("FLIPFLOCKS_ENVIRONMENT")?.trim().toLowerCase();
  const isHosted = Boolean(env("DENO_DEPLOYMENT_ID")?.trim()) ||
    environment === "production" ||
    !isLocalSupabaseUrl(env("SUPABASE_URL"));

  if ((!configuredOrigin || configuredOrigin !== configuredOriginValue) && isHosted) {
    return {
      ok: false,
      headers: { ...baseCorsHeaders },
    };
  }

  const allowedOrigin = configuredOrigin || "*";
  return {
    ok: true,
    allowedOrigin,
    headers: {
      ...baseCorsHeaders,
      "Access-Control-Allow-Origin": allowedOrigin,
      "Vary": "Origin",
    },
  };
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value?.trim()) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function rateLimitConfiguration(env: HandlerDependencies["env"]) {
  return {
    storeEmailLimit: parsePositiveInteger(
      env("PUBLIC_CHECKOUT_STORE_EMAIL_RATE_LIMIT"),
      6,
    ),
    storeIpLimit: parsePositiveInteger(
      env("PUBLIC_CHECKOUT_STORE_IP_RATE_LIMIT"),
      30,
    ),
    storeLimit: parsePositiveInteger(
      env("PUBLIC_CHECKOUT_STORE_RATE_LIMIT"),
      120,
    ),
  };
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...additionalHeaders,
      "Content-Type": "application/json",
    },
  });
}

function serializeRpcError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return {
      message: String(error ?? "Unknown RPC error"),
    };
  }

  const record = error as Record<string, unknown>;

  return {
    message: typeof record.message === "string" ? record.message : null,
    code: typeof record.code === "string" ? record.code : null,
    details: typeof record.details === "string" ? record.details : null,
    hint: typeof record.hint === "string" ? record.hint : null,
    name: typeof record.name === "string" ? record.name : null,
  };
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

function optionalUuid(
  body: Record<string, unknown>,
  key: keyof OrderRequest,
): string | null {
  const value = body[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be a valid ID.`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (!uuidPattern.test(trimmed)) {
    throw new Error(`${key} must be a valid ID.`);
  }

  return trimmed;
}

function optionalFulfillmentMethod(
  body: Record<string, unknown>,
): "pickup" | "delivery" | undefined {
  const value = body.fulfillment_method;

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error("fulfillment_method must be pickup or delivery.");
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return "pickup";
  }

  if (trimmed !== "pickup" && trimmed !== "delivery") {
    throw new Error("fulfillment_method must be pickup or delivery.");
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
    const legacyInventoryItemId = record.inventory_item_id;
    const itemType = legacyInventoryItemId ? "listing_inventory" : record.item_type;
    const itemId = legacyInventoryItemId ?? record.item_id;
    const quantity = record.quantity;

    if (
      itemType !== "listing_inventory" &&
      itemType !== "equipment_inventory" &&
      itemType !== "processed_poultry_inventory" &&
      itemType !== "hatching_egg_inventory"
    ) {
      throw new Error(
        "Each checkout item must include a valid item type, item ID, and positive quantity.",
      );
    }

    if (typeof itemId !== "string" || !uuidPattern.test(itemId)) {
      throw new Error(
        "Each checkout item must include a valid item type, item ID, and positive quantity.",
      );
    }

    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      throw new Error("Each checkout item quantity must be a positive integer.");
    }

    return {
      item_type: itemType as CheckoutItemType,
      item_id: itemId,
      ...(legacyInventoryItemId ? { inventory_item_id: itemId } : {}),
      quantity,
    };
  });
}

function parseBuyerIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const candidate = (forwardedFor?.split(",")[0] ?? realIp ?? "")
    .trim()
    .replace(/^\[|\]$/g, "");

  if (
    !candidate ||
    candidate.length > 45 ||
    !/^[0-9a-f:.]+$/i.test(candidate)
  ) {
    return null;
  }

  const ipv4Pattern =
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

  if (ipv4Pattern.test(candidate)) return candidate;

  return candidate.includes(":") ? candidate : null;
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
    "pickup_option_id",
    "fulfillment_method",
    "delivery_option_id",
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
    pickup_option_id: optionalUuid(record, "pickup_option_id"),
    fulfillment_method: optionalFulfillmentMethod(record),
    delivery_option_id: optionalUuid(record, "delivery_option_id"),
    items: normalizeItems(record.items),
  };
}

async function triggerPostmarkEmailWorker(
  supabaseUrl: string,
  serviceRoleKey: string,
  orderId: string,
  env: HandlerDependencies["env"],
  fetchImplementation: typeof fetch,
): Promise<void> {
  const workerSecret = env("POSTMARK_WORKER_SECRET")?.trim();

  if (!workerSecret) {
    console.warn("postmark-email-worker invocation skipped: worker secret is not configured");
    return;
  }

  const workerUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/postmark-email-worker`;

  try {
    const response = await fetchImplementation(workerUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
        "x-flockfront-worker-secret": workerSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_size: 10,
        order_id: orderId,
        source: "pay-at-pickup-order",
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      console.warn(
        "postmark-email-worker invocation returned non-2xx",
        JSON.stringify({
          status: response.status,
          status_text: response.statusText,
          response_body: responseBody.slice(0, 2000),
        }),
      );
    }
  } catch (error) {
    console.warn(
      "postmark-email-worker invocation failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function createPayAtPickupHandler(
  dependencies: HandlerDependencies,
): (request: Request) => Promise<Response> {
  const fetchImplementation = dependencies.fetch ?? fetch;

  return async (request: Request) => {
    const corsPolicy = resolveCorsPolicy(dependencies.env);

    if (!corsPolicy.ok) {
      return jsonResponse(500, {
        error: "server_configuration_error",
        message: "Order service origin is not configured.",
      }, corsPolicy.headers);
    }

    const corsHeaders = corsPolicy.headers;
    const requestOrigin = request.headers.get("origin")?.trim();

    if (
      requestOrigin &&
      corsPolicy.allowedOrigin !== "*" &&
      requestOrigin !== corsPolicy.allowedOrigin
    ) {
      return jsonResponse(403, {
        error: "origin_not_allowed",
        message: "This origin is not allowed to create orders.",
      }, corsHeaders);
    }

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
      }, corsHeaders);
    }

    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse(415, {
        error: "unsupported_media_type",
        message: "Use application/json for pay-at-pickup order requests.",
      }, corsHeaders);
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);

    if (contentLength > 64_000) {
      return jsonResponse(413, {
        error: "request_too_large",
        message: "Order request is too large.",
      }, corsHeaders);
    }

    const supabaseUrl = dependencies.env("SUPABASE_URL");
    const serviceRoleKey = dependencies.env("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(500, {
        error: "server_configuration_error",
        message: "Order service is not configured.",
      }, corsHeaders);
    }

    let orderRequest: OrderRequest;

    try {
      orderRequest = parseOrderRequest(await request.json());
    } catch (error) {
      return jsonResponse(400, {
        error: "invalid_request",
        message: error instanceof Error ? error.message : "Invalid request.",
      }, corsHeaders);
    }

    const supabase = dependencies.createServiceClient(
      supabaseUrl,
      serviceRoleKey,
    );

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
    }, corsHeaders);
  }

  const storefrontStatus = Array.isArray(storefrontRows)
    ? storefrontRows[0]
    : null;

  if (!storefrontStatus?.is_publicly_available || !storefrontStatus.storefront) {
    return jsonResponse(storefrontStatus?.store_exists ? 409 : 404, {
      error: "storefront_unavailable",
      message: storefrontStatus?.message ?? "This store is currently unavailable.",
    }, corsHeaders);
  }

  const storeId = storefrontStatus.storefront.store_id;

  if (typeof storeId !== "string" || !uuidPattern.test(storeId)) {
    return jsonResponse(500, {
      error: "storefront_lookup_failed",
      message: "Storefront payload is invalid.",
    }, corsHeaders);
  }

  const buyerIp = parseBuyerIp(request);
  const rateLimits = rateLimitConfiguration(dependencies.env);
  const { data: rateLimitRows, error: rateLimitError } = await supabase.rpc(
    "consume_public_checkout_rate_limit",
    {
      p_store_id: storeId,
      p_idempotency_key: orderRequest.idempotency_key,
      p_buyer_email: orderRequest.buyer_email,
      p_buyer_ip: buyerIp,
      p_store_email_limit: rateLimits.storeEmailLimit,
      p_store_ip_limit: rateLimits.storeIpLimit,
      p_store_limit: rateLimits.storeLimit,
    },
  );

  if (rateLimitError) {
    console.error(
      "consume_public_checkout_rate_limit failed",
      JSON.stringify({
        rpc_error: serializeRpcError(rateLimitError),
        store_id: storeId,
      }),
    );
    return jsonResponse(503, {
      error: "checkout_protection_unavailable",
      message: "Unable to verify checkout availability. Please try again.",
    }, corsHeaders);
  }

  const rateLimit = (
    Array.isArray(rateLimitRows) ? rateLimitRows[0] : null
  ) as RateLimitRow | null;

  if (rateLimit?.allowed !== true) {
    const retryAfter = Number.isInteger(rateLimit?.retry_after_seconds) &&
        Number(rateLimit?.retry_after_seconds) > 0
      ? Number(rateLimit?.retry_after_seconds)
      : 900;

    return jsonResponse(429, {
      error: "rate_limited",
      message: "Too many checkout attempts. Please wait and try again.",
    }, corsHeaders, {
      "Retry-After": String(retryAfter),
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
    }, corsHeaders);
  }

  const checkoutSummary = Array.isArray(summaryRows) ? summaryRows[0] : null;

  if (!checkoutSummary?.is_checkout_available) {
    return jsonResponse(409, {
      error: "checkout_unavailable",
      message: checkoutSummary?.message ??
        "One or more checkout items are unavailable.",
      checkout: checkoutSummary ?? null,
    }, corsHeaders);
  }

  const orderRpcName = "create_pay_at_pickup_order_v2";
  const orderRpcArgs: Record<string, unknown> = {
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
    p_buyer_ip_address: buyerIp,
    p_buyer_user_agent: request.headers.get("user-agent"),
    p_pickup_option_id: orderRequest.pickup_option_id,
    p_fulfillment_method: orderRequest.fulfillment_method ?? "pickup",
    p_delivery_option_id: orderRequest.delivery_option_id,
  };

  const { data: orderRows, error: orderError } = await supabase.rpc(
    orderRpcName,
    orderRpcArgs,
  );

  if (orderError) {
    const message = orderError.message || "Unable to create order.";
    console.error(
      `${orderRpcName} failed`,
      JSON.stringify({
        rpc_error: serializeRpcError(orderError),
        normalized_items: orderRequest.items,
        store_id: storeId,
      }),
    );
    const conflictMessages = [
      "Idempotency key was already used with a different request.",
      "Store is not available for checkout.",
      "One or more inventory items were not found.",
      "One or more inventory items do not belong to this store.",
      "One or more inventory items are not available for checkout.",
      "Insufficient inventory quantity available.",
      "Invalid inventory type for listing batch type.",
      "Pickup option is not available for this store.",
      "Store does not offer delivery.",
      "Delivery option is not available for this store.",
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
      "Each order item must include a valid item type, item ID, and positive quantity.",
      "At least one valid order item is required.",
      "Invalid inventory relationship for checkout.",
      "pickup_option_id must be a valid ID.",
      "delivery_option_id must be a valid ID.",
      "fulfillment_method must be pickup or delivery.",
      "Fulfillment method must be pickup or delivery.",
      "Delivery option must be blank for pickup orders.",
      "Pickup option must be blank for delivery orders.",
      "Delivery option is required for delivery orders.",
      ...conflictMessages,
    ];
    const safeMessage = safeValidationMessages.includes(message)
      ? message
      : "Unable to place order. Please review your cart and try again.";

    return jsonResponse(conflictMessages.includes(message) ? 409 : 400, {
      error: "order_creation_failed",
      message: safeMessage,
    }, corsHeaders);
  }

  const rawOrder = Array.isArray(orderRows) ? orderRows[0] : null;
  const order = sanitizeOrderConfirmation(rawOrder);
  const createdOrderId = typeof rawOrder?.order_id === "string" &&
      uuidPattern.test(rawOrder.order_id)
    ? rawOrder.order_id
    : null;

  if (createdOrderId) {
    await triggerPostmarkEmailWorker(
      supabaseUrl,
      serviceRoleKey,
      createdOrderId,
      dependencies.env,
      fetchImplementation,
    );
  }

  return jsonResponse(201, {
    order,
    checkout: {
      item_count: checkoutSummary.item_count,
      total_quantity: checkoutSummary.total_quantity,
      subtotal_amount: checkoutSummary.subtotal_amount,
    },
  }, corsHeaders);
  };
}
