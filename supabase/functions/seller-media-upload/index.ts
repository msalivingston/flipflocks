import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const BUCKET_NAME = "seller-media";
const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const ALLOWED_TYPES = new Set<string>(allowedMimeTypes);

type SupportedMimeType = (typeof allowedMimeTypes)[number];

const MIME_TYPE_ALIASES: Record<string, SupportedMimeType> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/png": "image/png",
  "image/x-png": "image/png",
  "image/webp": "image/webp",
};

type PublicErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "unsupported_media_type"
  | "file_too_large"
  | "invalid_image"
  | "upload_failed"
  | "save_failed"
  | "server_error";

type ImageDimensions = {
  width: number;
  height: number;
};

class PublicSafeError extends Error {
  code: PublicErrorCode;
  publicMessage: string;
  status: number;

  constructor(code: PublicErrorCode, message: string, status = 400) {
    super(message);
    this.name = "PublicSafeError";
    this.code = code;
    this.publicMessage = message;
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function errorResponse(code: PublicErrorCode, message: string, status = 400): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`Missing required environment variable`);
  }

  return value;
}

function normalizeOptionalText(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRequiredText(value: FormDataEntryValue | null, fieldName: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new PublicSafeError("invalid_request", `${fieldName} is required`);
  }

  return normalized;
}

function parseBoolean(value: FormDataEntryValue | null): boolean {
  return typeof value === "string" && value.toLowerCase() === "true";
}

function parseSortOrder(value: FormDataEntryValue | null): number {
  if (typeof value !== "string" || value.trim() === "") {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new PublicSafeError("invalid_request", "sort_order must be a nonnegative integer");
  }

  return parsed;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sniffMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function normalizeMimeType(value: string | null | undefined): SupportedMimeType | null {
  const normalized = value?.split(";")[0]?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return MIME_TYPE_ALIASES[normalized] ?? null;
}

function mimeTypeFromFileName(fileName: string): SupportedMimeType | null {
  const extension = fileName.split(".").pop()?.trim().toLowerCase();

  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }

  if (extension === "png") {
    return "image/png";
  }

  if (extension === "webp") {
    return "image/webp";
  }

  return null;
}

function hasConflictingClaim(
  claimedMimeType: SupportedMimeType | null,
  detectedMimeType: string,
) {
  return claimedMimeType !== null && claimedMimeType !== detectedMimeType;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function getPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function getJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }

    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];

    if (length < 2 || offset + length + 2 > bytes.length) {
      return null;
    }

    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      return {
        height: (bytes[offset + 5] << 8) + bytes[offset + 6],
        width: (bytes[offset + 7] << 8) + bytes[offset + 8],
      };
    }

    offset += length + 2;
  }

  return null;
}

function getWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) {
    return null;
  }

  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    };
  }

  if (chunk === "VP8 " && bytes.length >= 30) {
    const start = 20;

    if (bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) {
      return null;
    }

    return {
      width: ((bytes[start + 7] << 8) | bytes[start + 6]) & 0x3fff,
      height: ((bytes[start + 9] << 8) | bytes[start + 8]) & 0x3fff,
    };
  }

  if (chunk === "VP8L" && bytes.length >= 25) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];

    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }

  return null;
}

function getImageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | null {
  if (mimeType === "image/png") {
    return getPngDimensions(bytes);
  }

  if (mimeType === "image/jpeg") {
    return getJpegDimensions(bytes);
  }

  if (mimeType === "image/webp") {
    return getWebpDimensions(bytes);
  }

  return null;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  throw new PublicSafeError("unsupported_media_type", "Unsupported media type");
}

function buildStoragePath(storeId: string, mimeType: string): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);

  return `stores/${storeId}/images/${year}/${month}/${crypto.randomUUID()}-${toHex(randomBytes)}.${extensionForMimeType(mimeType)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return errorResponse("invalid_request", "Method not allowed", 405);
  }

  try {
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return errorResponse("unauthorized", "Authentication required", 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return errorResponse("unauthorized", "Authentication required", 401);
    }

    const contentType = req.headers.get("Content-Type") ?? "";

    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return errorResponse("invalid_request", "Expected multipart form data", 415);
    }

    const formData = await req.formData();
    const fileValue = formData.get("file");

    if (!(fileValue instanceof File)) {
      return errorResponse("invalid_request", "A media file is required", 400);
    }

    if (fileValue.size <= 0) {
      return errorResponse("invalid_request", "Media file size is invalid", 400);
    }

    if (fileValue.size > MAX_FILE_SIZE_BYTES) {
      return errorResponse("file_too_large", "Media file must be 8 MB or smaller", 400);
    }

    const bytes = new Uint8Array(await fileValue.arrayBuffer());
    const detectedMimeType = sniffMimeType(bytes);
    const declaredMimeType = normalizeMimeType(fileValue.type);
    const extensionMimeType = mimeTypeFromFileName(fileValue.name);

    if (!detectedMimeType || !ALLOWED_TYPES.has(detectedMimeType)) {
      return errorResponse("unsupported_media_type", "Unsupported media type", 400);
    }

    if (
      hasConflictingClaim(declaredMimeType, detectedMimeType) ||
      hasConflictingClaim(extensionMimeType, detectedMimeType)
    ) {
      return errorResponse("unsupported_media_type", "Media type does not match file contents", 400);
    }

    const dimensions = getImageDimensions(bytes, detectedMimeType);

    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
      return errorResponse("invalid_image", "Unable to validate image dimensions", 400);
    }

    const storeId = normalizeRequiredText(formData.get("store_id"), "store_id");
    const entityType = normalizeRequiredText(formData.get("entity_type"), "entity_type");
    const entityId = normalizeRequiredText(formData.get("entity_id"), "entity_id");
    const displayContext = normalizeOptionalText(formData.get("display_context")) ?? "gallery";
    const altText = normalizeOptionalText(formData.get("alt_text"));
    const caption = normalizeOptionalText(formData.get("caption"));
    const sortOrder = parseSortOrder(formData.get("sort_order"));
    const isFeatured = parseBoolean(formData.get("is_featured"));
    const storagePath = buildStoragePath(storeId, detectedMimeType);

    const { error: uploadError } = await serviceClient.storage
      .from(BUCKET_NAME)
      .upload(storagePath, bytes, {
        contentType: detectedMimeType,
        cacheControl: "31536000",
        upsert: false,
      });

    if (uploadError) {
      console.error("seller-media-upload storage upload failed", uploadError);
      return errorResponse("upload_failed", "Unable to upload image. Please try again.", 500);
    }

    const { data: mediaRows, error: rpcError } = await serviceClient.rpc("seller_create_uploaded_media", {
      p_actor_user_id: user.id,
      p_store_id: storeId,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_display_context: displayContext,
      p_storage_path: storagePath,
      p_original_filename: fileValue.name,
      p_content_type: detectedMimeType,
      p_file_size_bytes: fileValue.size,
      p_width_px: dimensions.width,
      p_height_px: dimensions.height,
      p_alt_text: altText,
      p_caption: caption,
      p_sort_order: sortOrder,
      p_is_featured: isFeatured,
    });

    if (rpcError) {
      await serviceClient.storage.from(BUCKET_NAME).remove([storagePath]);
      console.error("seller-media-upload metadata save failed", rpcError);
      return errorResponse("save_failed", "Unable to save image. Please try again.", 500);
    }

    return jsonResponse({
      media: Array.isArray(mediaRows) ? mediaRows[0] ?? null : mediaRows,
    });
  } catch (error) {
    if (error instanceof PublicSafeError) {
      return errorResponse(error.code, error.publicMessage, error.status);
    }

    console.error("seller-media-upload unexpected failure", error);
    return errorResponse(
      "server_error",
      "Image upload is temporarily unavailable. Please try again later.",
      500,
    );
  }
});
