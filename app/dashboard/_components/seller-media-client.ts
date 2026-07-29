"use client";

import { supabase } from "@/lib/supabase";
import type { PhotoCropMetadata } from "./photo-crop-editor";

export type SellerMediaItem = {
  media_asset_id: string;
  media_link_id: string;
  store_id: string;
  entity_type: string;
  entity_id: string;
  display_context: string;
  public_url: string;
  alt_text: string | null;
  caption: string | null;
  sort_order: number | null;
  is_featured: boolean;
  crop_metadata?: PhotoCropMetadata | null;
  moderation_status: string;
  asset_status: string;
  visibility_status: string;
  original_filename: string | null;
  content_type: string;
  file_size_bytes: number;
  width_px: number | null;
  height_px: number | null;
  source_type?: string | null;
  source_breed_id?: string | null;
  source_image_url?: string | null;
};

type UploadResponse = {
  media?: SellerMediaItem | null;
  error?: {
    code?: string;
    message?: string;
  };
};

type FunctionErrorContext = {
  context?: Response;
  message?: string;
};

export type SellerPhotoError = {
  title: string;
  message: string;
};

export const sellerAcceptedImageTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const sellerMaxImageSizeBytes = 8 * 1024 * 1024;

export function validateSellerPhoto(file: File): SellerPhotoError | null {
  if (
    !sellerAcceptedImageTypes.includes(
      file.type as (typeof sellerAcceptedImageTypes)[number],
    )
  ) {
    return {
      title: "File type not supported",
      message: "Use a JPG, PNG, or WebP photo.",
    };
  }

  if (file.size <= 0 || file.size > sellerMaxImageSizeBytes) {
    return {
      title: "Photo is too large",
      message: "Use a photo under 8 MB.",
    };
  }

  return null;
}

export async function uploadSellerPhoto({
  entityId,
  entityType,
  file,
  isFeatured,
  sortOrder,
  storeId,
}: {
  entityId: string;
  entityType: string;
  file: File;
  isFeatured: boolean;
  sortOrder: number;
  storeId: string;
}): Promise<
  | { ok: true; media: SellerMediaItem }
  | { ok: false; error: SellerPhotoError }
> {
  const validationError = validateSellerPhoto(file);
  if (validationError) return { ok: false, error: validationError };

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (sessionError || !accessToken) {
    return {
      ok: false,
      error: {
        title: "Photo upload failed",
        message: "Please sign in again and try uploading the photo.",
      },
    };
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("store_id", storeId);
  formData.append("entity_type", entityType);
  formData.append("entity_id", entityId);
  formData.append("display_context", "gallery");
  formData.append("sort_order", String(sortOrder));
  formData.append("is_featured", String(isFeatured));

  const { data, error: uploadError } =
    await supabase.functions.invoke<UploadResponse>("seller-media-upload", {
      body: formData,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

  if (uploadError || data?.error || !data?.media) {
    const edgeError = await readFunctionError(uploadError);
    const code = data?.error?.code ?? edgeError?.code;

    console.error("seller-media-upload failed", {
      code,
      fileName: file.name,
      message: data?.error?.message ?? edgeError?.message,
      status: edgeError?.status,
      supabaseMessage: toFunctionErrorContext(uploadError)?.message,
    });

    return { ok: false, error: mapUploadErrorToSellerMessage(code) };
  }

  return { ok: true, media: data.media };
}

export async function archiveSellerPhoto(mediaLinkId: string) {
  const { error } = await supabase.rpc("seller_archive_media_link", {
    p_media_link_id: mediaLinkId,
  });

  return error
    ? {
        ok: false as const,
        message: "The photo was not removed. Please try again.",
      }
    : { ok: true as const };
}

export async function updateSellerPhotoCrop(
  mediaLinkId: string,
  crop: PhotoCropMetadata | null,
) {
  const { error } = await supabase.rpc("seller_update_media_crop", {
    p_crop_metadata: crop,
    p_media_link_id: mediaLinkId,
  });

  return error
    ? {
        ok: false as const,
        message: "The photo crop was not saved. Please try again.",
      }
    : { ok: true as const };
}

async function readFunctionError(uploadError: unknown) {
  const response = toFunctionErrorContext(uploadError)?.context;
  if (!response) return null;

  try {
    const body = (await response.clone().json()) as UploadResponse;
    return {
      code: body.error?.code,
      message: body.error?.message,
      status: response.status,
    };
  } catch {
    return {
      code: undefined,
      message: undefined,
      status: response.status,
    };
  }
}

function toFunctionErrorContext(error: unknown): FunctionErrorContext | null {
  if (!error || typeof error !== "object") return null;
  return error as FunctionErrorContext;
}

function mapUploadErrorToSellerMessage(
  code: string | undefined,
): SellerPhotoError {
  if (code === "unauthorized") {
    return {
      title: "Photo upload failed",
      message: "Please sign in again and try uploading the photo.",
    };
  }

  if (code === "unsupported_media_type" || code === "invalid_image") {
    return {
      title: "File type not supported",
      message: "Use a JPG, PNG, or WebP photo.",
    };
  }

  if (code === "file_too_large") {
    return {
      title: "Photo is too large",
      message: "Use a photo under 8 MB.",
    };
  }

  return {
    title: "Photo upload failed",
    message: "Please try again. If it keeps happening, choose a different photo.",
  };
}
