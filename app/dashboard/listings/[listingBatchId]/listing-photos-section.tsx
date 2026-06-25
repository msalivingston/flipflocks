"use client";

import { useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  type DashboardPhoto,
  PhotoManager,
} from "../../_components/photo-manager";
import type { PhotoCropMetadata } from "../../_components/photo-crop-editor";

export type ListingPhotoItem = {
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
  media?: ListingPhotoItem | null;
  error?: {
    code?: string;
    message?: string;
  };
};

type PhotoError = {
  title: string;
  message: string;
};

type FunctionErrorContext = {
  context?: Response;
  message?: string;
  name?: string;
};

type PhotoManagerMode = "setup" | "public-content" | "readonly";
type PhotoEntityType =
  | "listing_batch"
  | "inventory_item"
  | "listing_batch_breed"
  | "seller_breed_profile"
  | "equipment_inventory_item"
  | "processed_poultry_inventory_item";

const acceptedImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const maxImageSizeBytes = 8 * 1024 * 1024;
const maxListingPhotos = 4;

/**
 * Setup photo manager for the hidden-listing workflow.
 *
 * Uploads use the existing seller-media Edge Function, which validates file
 * type, size, dimensions, ownership, storage path, and database metadata.
 */
export function ListingPhotosSection({
  canManage,
  description,
  emptyDescription,
  entityId,
  entityType = "listing_batch",
  listingBatchId,
  mode = "readonly",
  mediaItems,
  onReload,
  storeId,
  title = "Photos",
}: {
  canManage: boolean;
  description?: string;
  emptyDescription?: string;
  entityId?: string;
  entityType?: PhotoEntityType;
  listingBatchId: string;
  mode?: PhotoManagerMode;
  mediaItems: ListingPhotoItem[];
  onReload: () => void;
  storeId: string;
  title?: string;
}) {
  const mediaEntityId = entityId ?? listingBatchId;
  const [localMediaItems, setLocalMediaItems] =
    useState<ListingPhotoItem[]>(mediaItems);
  const activePhotos = localMediaItems.filter(
    (item) =>
      item.visibility_status === "active" &&
      item.asset_status === "active" &&
      item.moderation_status === "approved",
  );
  const orderedPhotos = useMemo(() => sortPhotos(activePhotos), [activePhotos]);
  const dashboardPhotos = useMemo(
    () => orderedPhotos.map(toDashboardPhoto),
    [orderedPhotos],
  );
  const photoCount = orderedPhotos.length;
  const remainingPhotoSlots = Math.max(maxListingPhotos - photoCount, 0);
  const removePhotoContext =
    entityType === "seller_breed_profile" ? "breed" : "item";
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<PhotoError | null>(null);

  async function uploadPhotos(files: FileList | null) {
    if (!files || files.length === 0 || !canManage) return;

    const filesToUpload = Array.from(files);

    if (filesToUpload.length > remainingPhotoSlots) {
      setError({
        title: "Photo limit reached",
        message:
          remainingPhotoSlots === 0
            ? "You've added the maximum of 4 photos."
            : `You can add ${remainingPhotoSlots} more photo${
                remainingPhotoSlots === 1 ? "" : "s"
              }.`,
      });
      return;
    }

    const selectedFiles = filesToUpload;
    const validationError = validateFiles(selectedFiles);

    setError(null);

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsUploading(true);

    const uploadedMedia: ListingPhotoItem[] = [];

    for (const [index, file] of selectedFiles.entries()) {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (sessionError || !accessToken) {
        console.error("seller-media-upload missing seller session", {
          message: sessionError?.message,
        });
        setError({
          title: "Photo upload failed",
          message: "Please sign in again and try uploading the photo.",
        });
        setIsUploading(false);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("store_id", storeId);
      formData.append("entity_type", entityType);
      formData.append("entity_id", mediaEntityId);
      formData.append("display_context", "gallery");
      formData.append("sort_order", String(photoCount + index));
      formData.append(
        "is_featured",
        String(photoCount === 0 && uploadedMedia.length === 0 && index === 0),
      );

      const { data, error: uploadError } =
        await supabase.functions.invoke<UploadResponse>("seller-media-upload", {
          body: formData,
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

      if (uploadError || data?.error) {
        const uploadFailure = await buildUploadFailure({
          data,
          fileName: file.name,
          uploadError,
        });
        setError(uploadFailure);
        setIsUploading(false);
        return;
      }

      if (data?.media) {
        uploadedMedia.push(data.media);
      }
    }

    if (uploadedMedia.length > 0) {
      setLocalMediaItems((current) =>
        normalizePhotoOrder([...current, ...uploadedMedia]),
      );
      onReload();
    }
    setIsUploading(false);
  }

  async function removePhoto(photo: ListingPhotoItem) {
    if (!canManage) return;

    setError(null);

    const { error: archiveError } = await supabase.rpc(
      "seller_archive_media_link",
      {
        p_media_link_id: photo.media_link_id,
      },
    );

    if (archiveError) {
      console.error("seller media link archive failed", {
        message: archiveError.message,
        mediaLinkId: photo.media_link_id,
      });
      setError({
        title: "Photo was not removed",
        message: "The photo was not removed. Please try again.",
      });
      return;
    }

    setLocalMediaItems((current) =>
      normalizePhotoOrder(
        current.filter((item) => item.media_link_id !== photo.media_link_id),
      ),
    );
    onReload();
  }

  async function makeFeatured(photo: ListingPhotoItem) {
    if (!canManage) return;

    setError(null);

    const reorderedPhotos = [
      photo,
      ...orderedPhotos.filter((item) => item.media_link_id !== photo.media_link_id),
    ];
    const previousItems = localMediaItems;

    setLocalMediaItems((current) =>
      applyReorderedPhotos(current, reorderedPhotos.map(toDashboardPhoto)),
    );

    const { error: reorderError } = await supabase.rpc("seller_reorder_media", {
      p_entity_type: entityType,
      p_entity_id: mediaEntityId,
      p_display_context: "gallery",
      p_media_link_ids: reorderedPhotos.map((item) => item.media_link_id),
    });

    if (reorderError) {
      setLocalMediaItems(previousItems);
      console.error("seller media reorder failed", {
        mediaLinkId: photo.media_link_id,
        message: reorderError.message,
      });
      setError({
        title: "Photo order was not saved",
        message: "The featured photo was not changed. Please try again.",
      });
      return;
    }

    const { error: featuredError } = await supabase.rpc(
      "seller_set_media_featured",
      {
        p_media_link_id: photo.media_link_id,
      },
    );

    if (featuredError) {
      setLocalMediaItems(previousItems);
      console.error("seller media featured update failed", {
        mediaLinkId: photo.media_link_id,
        message: featuredError.message,
      });
      setError({
        title: "Photo order was not saved",
        message: "The featured photo was not changed. Please try again.",
      });
      return;
    }

    onReload();
  }

  async function reorderPhotos(nextPhotos: DashboardPhoto[]) {
    if (!canManage) return;

    const nextLinkIds = nextPhotos.map((photo) => photo.id);
    const nextIdSet = new Set(nextLinkIds);

    if (
      nextPhotos.length !== orderedPhotos.length ||
      nextIdSet.size !== orderedPhotos.length
    ) {
      return;
    }

    setError(null);
    const previousItems = localMediaItems;

    setLocalMediaItems((current) => applyReorderedPhotos(current, nextPhotos));

    const { error: reorderError } = await supabase.rpc("seller_reorder_media", {
      p_entity_type: entityType,
      p_entity_id: mediaEntityId,
      p_display_context: "gallery",
      p_media_link_ids: nextLinkIds,
    });

    if (reorderError) {
      setLocalMediaItems(previousItems);
      console.error("seller media reorder failed", {
        message: reorderError.message,
      });
      setError({
        title: "Photo order was not saved",
        message: "The photo order was not changed. Please try again.",
      });
      return;
    }

    const featuredLinkId = nextLinkIds[0];

    if (featuredLinkId) {
      const { error: featuredError } = await supabase.rpc(
        "seller_set_media_featured",
        {
          p_media_link_id: featuredLinkId,
        },
      );

      if (featuredError) {
        setLocalMediaItems(previousItems);
        console.error("seller media featured update failed", {
          mediaLinkId: featuredLinkId,
          message: featuredError.message,
        });
        setError({
          title: "Photo order was not saved",
          message: "The featured photo was not changed. Please try again.",
        });
        return;
      }
    }

    onReload();
  }

  async function saveCrop(photo: DashboardPhoto, crop: PhotoCropMetadata | null) {
    if (!canManage) return;

    setError(null);

    const { error: cropError } = await supabase.rpc("seller_update_media_crop", {
      p_crop_metadata: crop,
      p_media_link_id: photo.id,
    });

    if (cropError) {
      console.error("seller media crop update failed", {
        mediaLinkId: photo.id,
        message: cropError.message,
      });
      setError({
        title: "Photo crop was not saved",
        message: "The crop was not saved. Please try again.",
      });
      return;
    }

    setLocalMediaItems((current) =>
      current.map((item) =>
        item.media_link_id === photo.id
          ? {
              ...item,
              crop_metadata: crop,
            }
          : item,
      ),
    );
    onReload();
  }

  return (
    <div ref={sectionRef}>
      <PhotoManager
        acceptedTypes={acceptedImageTypes}
        canManage={canManage}
        description={
          description ??
          (mode === "public-content"
            ? "Update the photos buyers see on this live listing."
            : "Add up to 4 photos buyers should see first.")
        }
        emptyDescription={emptyDescription}
        error={error}
        helperText="Drag photos to reorder. The first photo is the featured storefront photo."
        isUploading={isUploading}
        maxFileSizeMb={maxImageSizeBytes / 1024 / 1024}
        maxPhotos={maxListingPhotos}
        photos={dashboardPhotos}
        removePhotoContext={removePhotoContext}
        title={title}
        onAddPhotos={(files) => void uploadPhotos(files)}
        onRemovePhoto={(photo) => {
          const listingPhoto = orderedPhotos.find(
            (item) => item.media_link_id === photo.id,
          );
          if (listingPhoto) return removePhoto(listingPhoto);
        }}
        onReorderPhotos={(photos) => reorderPhotos(photos)}
        onResetCrop={(photo) => saveCrop(photo, null)}
        onSaveCrop={(photo, crop) => saveCrop(photo, crop)}
        onSetFeaturedPhoto={(photo) => {
          const listingPhoto = orderedPhotos.find(
            (item) => item.media_link_id === photo.id,
          );
          if (listingPhoto) return makeFeatured(listingPhoto);
        }}
      />
    </div>
  );
}

function validateFiles(files: File[]) {
  for (const file of files) {
    if (!acceptedImageTypes.includes(file.type as (typeof acceptedImageTypes)[number])) {
      return {
        title: "File type not supported",
        message: "Use a JPG, PNG, or WebP photo.",
      };
    }

    if (file.size <= 0 || file.size > maxImageSizeBytes) {
      return {
        title: "Photo is too large",
        message: "Use a photo under 8 MB.",
      };
    }
  }

  return null;
}

function sortPhotos(photos: ListingPhotoItem[]) {
  return [...photos].sort((first, second) => {
    if (first.is_featured !== second.is_featured) {
      return first.is_featured ? -1 : 1;
    }

    const firstSort = first.sort_order ?? 0;
    const secondSort = second.sort_order ?? 0;

    if (firstSort !== secondSort) {
      return firstSort - secondSort;
    }

    return first.media_link_id.localeCompare(second.media_link_id);
  });
}

function toDashboardPhoto(photo: ListingPhotoItem): DashboardPhoto {
  return {
    altText: photo.alt_text,
    cropMetadata: photo.crop_metadata,
    filename: photo.original_filename,
    height: photo.height_px,
    id: photo.media_link_id,
    label: photo.alt_text || photo.original_filename || "Photo",
    sortOrder: photo.sort_order,
    url: toPublicImageUrl(photo.public_url),
    width: photo.width_px,
  };
}

function normalizePhotoOrder(items: ListingPhotoItem[]) {
  const activeItems = sortPhotos(
    items.filter(
      (item) =>
        item.visibility_status === "active" &&
        item.asset_status === "active" &&
        item.moderation_status === "approved",
    ),
  );
  const activeOrderById = new Map(
    activeItems.map((item, index) => [item.media_link_id, index]),
  );

  return items.map((item) => {
    const nextOrder = activeOrderById.get(item.media_link_id);

    if (nextOrder === undefined) return item;

    return {
      ...item,
      is_featured: nextOrder === 0,
      sort_order: nextOrder,
    };
  });
}

function applyReorderedPhotos(
  currentItems: ListingPhotoItem[],
  nextPhotos: DashboardPhoto[],
) {
  const orderById = new Map(nextPhotos.map((photo, index) => [photo.id, index]));

  return currentItems.map((item) => {
    const nextOrder = orderById.get(item.media_link_id);

    if (nextOrder === undefined) return item;

    return {
      ...item,
      is_featured: nextOrder === 0,
      sort_order: nextOrder,
    };
  });
}

async function buildUploadFailure({
  data,
  fileName,
  uploadError,
}: {
  data: UploadResponse | null;
  fileName: string;
  uploadError: unknown;
}): Promise<PhotoError> {
  const edgeError = await readFunctionError(uploadError);
  const code = data?.error?.code ?? edgeError?.code;
  const message = data?.error?.message ?? edgeError?.message;

  console.error("seller-media-upload failed", {
    code,
    fileName,
    message,
    status: edgeError?.status,
    supabaseMessage: toFunctionErrorContext(uploadError)?.message,
  });

  return mapUploadErrorToSellerMessage(code);
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
  } catch (error) {
    console.error("seller-media-upload error body could not be read", {
      error,
      status: response.status,
    });

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

function mapUploadErrorToSellerMessage(code: string | undefined): PhotoError {
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

function toPublicImageUrl(publicUrl: string) {
  if (publicUrl.startsWith("http")) return publicUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (publicUrl.startsWith("/") && supabaseUrl) {
    return `${supabaseUrl}${publicUrl}`;
  }

  return publicUrl;
}
