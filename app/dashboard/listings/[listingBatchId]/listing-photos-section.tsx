"use client";

import { useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  type DashboardPhoto,
  PhotoManager,
} from "../../_components/photo-manager";
import type { PhotoCropMetadata } from "../../_components/photo-crop-editor";
import {
  archiveSellerPhoto,
  sellerAcceptedImageTypes,
  sellerMaxImageSizeBytes,
  type SellerMediaItem,
  updateSellerPhotoCrop,
  uploadSellerPhoto,
  validateSellerPhoto,
} from "../../_components/seller-media-client";

export type ListingPhotoItem = SellerMediaItem;

type PhotoError = {
  title: string;
  message: string;
};

type PhotoManagerMode = "setup" | "public-content" | "readonly";
type PhotoEntityType =
  | "listing_batch"
  | "inventory_item"
  | "listing_batch_breed"
  | "seller_breed_profile"
  | "equipment_inventory_item"
  | "processed_poultry_inventory_item";

const acceptedImageTypes = sellerAcceptedImageTypes;
const maxImageSizeBytes = sellerMaxImageSizeBytes;
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
  mobileCompact = false,
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
  mobileCompact?: boolean;
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
      const uploadResult = await uploadSellerPhoto({
        entityId: mediaEntityId,
        entityType,
        file,
        isFeatured:
          photoCount === 0 && uploadedMedia.length === 0 && index === 0,
        sortOrder: photoCount + index,
        storeId,
      });

      if (!uploadResult.ok) {
        setError(uploadResult.error);
        setIsUploading(false);
        return;
      }

      uploadedMedia.push(uploadResult.media);
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

    const archiveResult = await archiveSellerPhoto(photo.media_link_id);

    if (!archiveResult.ok) {
      console.error("seller media link archive failed", {
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

    const cropResult = await updateSellerPhotoCrop(photo.id, crop);

    if (!cropResult.ok) {
      console.error("seller media crop update failed", {
        mediaLinkId: photo.id,
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
        mobileCompact={mobileCompact}
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
    const error = validateSellerPhoto(file);
    if (error) return error;
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

function toPublicImageUrl(publicUrl: string) {
  if (publicUrl.startsWith("http")) return publicUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (publicUrl.startsWith("/") && supabaseUrl) {
    return `${supabaseUrl}${publicUrl}`;
  }

  return publicUrl;
}
