import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const configuredCorsOrigin = Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN");
const corsHeaders = {
  "Access-Control-Allow-Origin": configuredCorsOrigin ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const BUCKET_NAME = "seller-media";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type PublicErrorCode =
  | "already_present"
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "photo_limit_reached"
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

type RestoreRequest = {
  seller_breed_profile_id?: string;
};

type SellerBreedProfileRow = {
  id: string;
  store_id: string;
  breed_id: string | null;
  display_name: string;
  visibility_status: string;
};

type BreedRow = {
  id: string;
  breed_name: string;
  image_url: string | null;
};

type MediaAssetRow = {
  id: string;
  asset_status: string;
  moderation_status: string;
  source_breed_id: string | null;
  source_image_url: string | null;
  source_type: string;
};

type MediaLinkRow = {
  id: string;
  media_asset_id: string;
  sort_order: number | null;
};

type MediaResponseRow = {
  media_asset_id: string;
  media_link_id: string;
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

function getCorsHeaders(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get("Origin");

  if (
    requestOrigin &&
    (requestOrigin === configuredCorsOrigin ||
      requestOrigin.startsWith("http://localhost:") ||
      requestOrigin.startsWith("http://127.0.0.1:"))
  ) {
    return {
      ...corsHeaders,
      "Access-Control-Allow-Origin": requestOrigin,
    };
  }

  return corsHeaders;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = corsHeaders,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
}

function errorResponse(
  code: PublicErrorCode,
  message: string,
  status = 400,
  headers: Record<string, string> = corsHeaders,
): Response {
  return jsonResponse({ error: { code, message } }, status, headers);
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error("Missing required environment variable");
  }

  return value;
}

function normalizeRequiredText(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PublicSafeError("invalid_request", `${fieldName} is required`);
  }

  return value.trim();
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

function buildCatalogImageFetchUrl(
  supabaseUrl: string,
  imageUrl: string,
  requestOrigin: string | null,
): string {
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  if (imageUrl.startsWith("/")) {
    const appOrigin =
      Deno.env.get("FLIPFLOCKS_PUBLIC_APP_ORIGIN") ??
      requestOrigin ??
      Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN");

    return `${appOrigin ?? supabaseUrl}${imageUrl}`;
  }

  return `${supabaseUrl}/storage/v1/object/public/${imageUrl}`;
}

function normalizeStoredImageUrl(imageUrl: string): string {
  return imageUrl.trim();
}

Deno.serve(async (req) => {
  const responseHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: responseHeaders,
    });
  }

  if (req.method !== "POST") {
    return errorResponse("invalid_request", "Method not allowed", 405, responseHeaders);
  }

  let storagePath: string | null = null;

  try {
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return errorResponse("unauthorized", "Authentication required", 401, responseHeaders);
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
      return errorResponse("unauthorized", "Authentication required", 401, responseHeaders);
    }

    const body = (await req.json().catch(() => null)) as RestoreRequest | null;
    const sellerBreedProfileId = normalizeRequiredText(
      body?.seller_breed_profile_id,
      "seller_breed_profile_id",
    );

    const { data: profile, error: profileError } = await serviceClient
      .from("seller_breed_profiles")
      .select("id, store_id, breed_id, display_name, visibility_status")
      .eq("id", sellerBreedProfileId)
      .maybeSingle<SellerBreedProfileRow>();

    if (profileError) {
      throw profileError;
    }

    if (!profile) {
      return errorResponse("not_found", "Breed was not found.", 404, responseHeaders);
    }

    if (profile.visibility_status === "archived") {
      return errorResponse("invalid_request", "Archived breeds cannot be updated.", 400, responseHeaders);
    }

    const { data: isAuthorized, error: authCheckError } = await serviceClient.rpc(
      "is_media_actor_store_authorized",
      {
        p_actor_user_id: user.id,
        p_store_id: profile.store_id,
      },
    );

    if (authCheckError) {
      throw authCheckError;
    }

    if (!isAuthorized) {
      return errorResponse("unauthorized", "You do not have access to this breed.", 403, responseHeaders);
    }

    if (!profile.breed_id) {
      return errorResponse("invalid_request", "Custom breeds do not have a default catalog photo.", 400, responseHeaders);
    }

    const { data: breed, error: breedError } = await serviceClient
      .from("breeds")
      .select("id, breed_name, image_url")
      .eq("id", profile.breed_id)
      .maybeSingle<BreedRow>();

    if (breedError) {
      throw breedError;
    }

    const sourceImageUrl = normalizeStoredImageUrl(breed?.image_url ?? "");

    if (!breed || !sourceImageUrl) {
      return errorResponse("not_found", "This breed does not have a default catalog photo.", 404, responseHeaders);
    }

    const { data: mediaLinks, error: mediaLinksError } = await serviceClient
      .from("media_links")
      .select("id, media_asset_id, sort_order")
      .eq("store_id", profile.store_id)
      .eq("entity_type", "seller_breed_profile")
      .eq("entity_id", profile.id)
      .eq("display_context", "gallery")
      .eq("visibility_status", "active")
      .returns<MediaLinkRow[]>();

    if (mediaLinksError) {
      throw mediaLinksError;
    }

    const activeLinks = mediaLinks ?? [];
    const assetIds = activeLinks.map((link) => link.media_asset_id);
    const { data: mediaAssets, error: mediaAssetsError } = assetIds.length > 0
      ? await serviceClient
          .from("media_assets")
          .select("id, asset_status, moderation_status, source_type, source_breed_id, source_image_url")
          .in("id", assetIds)
          .returns<MediaAssetRow[]>()
      : { data: [] as MediaAssetRow[], error: null };

    if (mediaAssetsError) {
      throw mediaAssetsError;
    }

    const assetsById = new Map((mediaAssets ?? []).map((asset) => [asset.id, asset]));
    const visiblePhotoLinks = activeLinks.filter((link) => {
      const asset = assetsById.get(link.media_asset_id);

      return asset?.asset_status === "active" && asset.moderation_status === "approved";
    });
    const existingDefaultPhoto = visiblePhotoLinks.find((link) => {
      const asset = assetsById.get(link.media_asset_id);

      return (
        asset?.source_type === "catalog_breed_image" &&
        asset.source_breed_id === breed.id &&
        asset.source_image_url === sourceImageUrl
      );
    });

    if (existingDefaultPhoto) {
      return jsonResponse({
        already_present: true,
        message: "The default photo is already included.",
      }, 200, responseHeaders);
    }

    if (visiblePhotoLinks.length >= 4) {
      return errorResponse(
        "photo_limit_reached",
        "You already have 4 breed photos. Remove a photo before restoring the default photo.",
        400,
        responseHeaders,
      );
    }

    const imageResponse = await fetch(
      buildCatalogImageFetchUrl(
        supabaseUrl,
        sourceImageUrl,
        req.headers.get("Origin"),
      ),
    );

    if (!imageResponse.ok) {
      return errorResponse("not_found", "The default catalog photo could not be loaded.", 404, responseHeaders);
    }

    const bytes = new Uint8Array(await imageResponse.arrayBuffer());

    if (bytes.length <= 0) {
      return errorResponse("invalid_image", "The default catalog photo could not be loaded.", 400, responseHeaders);
    }

    if (bytes.length > MAX_FILE_SIZE_BYTES) {
      return errorResponse("file_too_large", "The default catalog photo is too large to restore.", 400, responseHeaders);
    }

    const detectedMimeType = sniffMimeType(bytes);

    if (!detectedMimeType || !ALLOWED_TYPES.has(detectedMimeType)) {
      return errorResponse("unsupported_media_type", "The default catalog photo type is not supported.", 400, responseHeaders);
    }

    const dimensions = getImageDimensions(bytes, detectedMimeType);

    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
      return errorResponse("invalid_image", "The default catalog photo could not be validated.", 400, responseHeaders);
    }

    const nextSortOrder =
      visiblePhotoLinks.length === 0
        ? 0
        : Math.max(...visiblePhotoLinks.map((link) => link.sort_order ?? 0)) + 1;
    const shouldFeature = visiblePhotoLinks.length === 0;
    storagePath = buildStoragePath(profile.store_id, detectedMimeType);

    const { error: uploadError } = await serviceClient.storage
      .from(BUCKET_NAME)
      .upload(storagePath, bytes, {
        contentType: detectedMimeType,
        cacheControl: "31536000",
        upsert: false,
      });

    if (uploadError) {
      console.error("seller-restore-catalog-breed-photo storage upload failed", uploadError);
      return errorResponse("upload_failed", "Unable to restore the default photo. Please try again.", 500, responseHeaders);
    }

    const { data: mediaRows, error: createMediaError } = await serviceClient.rpc(
      "seller_create_uploaded_media",
      {
        p_actor_user_id: user.id,
        p_store_id: profile.store_id,
        p_entity_type: "seller_breed_profile",
        p_entity_id: profile.id,
        p_display_context: "gallery",
        p_storage_path: storagePath,
        p_original_filename: `catalog-${breed.id}.${extensionForMimeType(detectedMimeType)}`,
        p_content_type: detectedMimeType,
        p_file_size_bytes: bytes.length,
        p_width_px: dimensions.width,
        p_height_px: dimensions.height,
        p_alt_text: `${breed.breed_name} breed photo`,
        p_caption: null,
        p_sort_order: nextSortOrder,
        p_is_featured: shouldFeature,
      },
    );

    if (createMediaError) {
      await serviceClient.storage.from(BUCKET_NAME).remove([storagePath]);
      console.error("seller-restore-catalog-breed-photo metadata save failed", createMediaError);
      return errorResponse("save_failed", "Unable to save the default photo. Please try again.", 500, responseHeaders);
    }

    const createdMedia = Array.isArray(mediaRows)
      ? (mediaRows[0] as MediaResponseRow | undefined)
      : (mediaRows as MediaResponseRow | null);

    if (!createdMedia?.media_asset_id || !createdMedia.media_link_id) {
      await serviceClient.storage.from(BUCKET_NAME).remove([storagePath]);
      return errorResponse("save_failed", "Unable to save the default photo. Please try again.", 500, responseHeaders);
    }

    storagePath = null;

    const { error: sourceUpdateError } = await serviceClient
      .from("media_assets")
      .update({
        source_breed_id: breed.id,
        source_image_url: sourceImageUrl,
        source_type: "catalog_breed_image",
      })
      .eq("id", createdMedia.media_asset_id)
      .eq("store_id", profile.store_id);

    if (sourceUpdateError) {
      console.error("seller-restore-catalog-breed-photo source marker update failed", sourceUpdateError);
      return errorResponse("save_failed", "Unable to save the default photo. Please try again.", 500, responseHeaders);
    }

    const { data: refreshedMediaRows, error: refreshError } = await serviceClient.rpc(
      "media_management_response_for_links",
      {
        p_media_link_ids: [createdMedia.media_link_id],
      },
    );

    if (refreshError) {
      throw refreshError;
    }

    return jsonResponse({
      already_present: false,
      media: Array.isArray(refreshedMediaRows) ? refreshedMediaRows[0] ?? null : refreshedMediaRows,
      message: "Default photo restored.",
    }, 200, responseHeaders);
  } catch (error) {
    if (storagePath) {
      // Best-effort cleanup for failures after upload.
      try {
        const supabaseUrl = getRequiredEnv("SUPABASE_URL");
        const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
        const serviceClient = createClient(supabaseUrl, serviceRoleKey);
        await serviceClient.storage.from(BUCKET_NAME).remove([storagePath]);
      } catch (cleanupError) {
        console.error("seller-restore-catalog-breed-photo cleanup failed", cleanupError);
      }
    }

    if (error instanceof PublicSafeError) {
      return errorResponse(error.code, error.publicMessage, error.status, responseHeaders);
    }

    console.error("seller-restore-catalog-breed-photo unexpected failure", error);
    return errorResponse(
      "server_error",
      "Default photo restore is temporarily unavailable. Please try again later.",
      500,
      responseHeaders,
    );
  }
});
