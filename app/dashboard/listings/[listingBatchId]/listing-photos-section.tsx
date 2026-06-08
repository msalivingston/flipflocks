"use client";

import Image from "next/image";
import { useId, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorState, SellerCard } from "../../_components/seller-ui";

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
  moderation_status: string;
  asset_status: string;
  visibility_status: string;
  original_filename: string | null;
  content_type: string;
  file_size_bytes: number;
  width_px: number | null;
  height_px: number | null;
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
  | "seller_breed_profile";

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
  const headingId = useId();
  const activePhotos = mediaItems.filter(
    (item) =>
      item.visibility_status === "active" &&
      item.asset_status === "active" &&
      item.moderation_status === "approved",
  );
  const orderedPhotos = useMemo(() => sortPhotos(activePhotos), [activePhotos]);
  const featuredPhoto =
    orderedPhotos.find((photo) => photo.is_featured) ?? orderedPhotos[0] ?? null;
  const remainingPhotos = featuredPhoto
    ? orderedPhotos.filter((photo) => photo.media_link_id !== featuredPhoto.media_link_id)
    : [];
  const photoCount = orderedPhotos.length;
  const canAddPhotos = canManage && photoCount < maxListingPhotos;
  const remainingPhotoSlots = Math.max(maxListingPhotos - photoCount, 0);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemovingLinkId, setIsRemovingLinkId] = useState<string | null>(null);
  const [isUpdatingLinkId, setIsUpdatingLinkId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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

    setMessage(null);
    setError(null);

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsUploading(true);

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
      formData.append("is_featured", String(photoCount === 0 && index === 0));

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
    }

    setIsUploading(false);
    setMessage(
      selectedFiles.length === 1
        ? "Photo attached."
        : "Photos attached.",
    );
    onReload();
    keepPhotosInView();
  }

  async function removePhoto(photo: ListingPhotoItem) {
    if (!canManage) return;

    const shouldRemove = window.confirm(
      "Remove this photo? The image file will not be deleted.",
    );

    if (!shouldRemove) return;

    setMessage(null);
    setError(null);
    setIsRemovingLinkId(photo.media_link_id);

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
      setIsRemovingLinkId(null);
      return;
    }

    setIsRemovingLinkId(null);
    setMessage("Photo removed.");
    onReload();
    keepPhotosInView();
  }

  async function makeFeatured(photo: ListingPhotoItem) {
    if (!canManage || photo.is_featured) return;

    setMessage(null);
    setError(null);
    setIsUpdatingLinkId(photo.media_link_id);

    const { error: featuredError } = await supabase.rpc(
      "seller_set_media_featured",
      {
        p_media_link_id: photo.media_link_id,
      },
    );

    if (featuredError) {
      console.error("seller media featured update failed", {
        mediaLinkId: photo.media_link_id,
        message: featuredError.message,
      });
      setError({
        title: "Photo order was not saved",
        message: "The featured photo was not changed. Please try again.",
      });
      setIsUpdatingLinkId(null);
      return;
    }

    setIsUpdatingLinkId(null);
    setMessage("Featured photo updated.");
    onReload();
    keepPhotosInView();
  }

  async function movePhoto(photo: ListingPhotoItem, direction: "left" | "right") {
    if (!canManage) return;

    const currentIndex = orderedPhotos.findIndex(
      (item) => item.media_link_id === photo.media_link_id,
    );
    const targetIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedPhotos.length) {
      return;
    }

    const reorderedPhotos = [...orderedPhotos];
    const [movedPhoto] = reorderedPhotos.splice(currentIndex, 1);
    reorderedPhotos.splice(targetIndex, 0, movedPhoto);

    setMessage(null);
    setError(null);
    setIsUpdatingLinkId(photo.media_link_id);

    const { error: reorderError } = await supabase.rpc("seller_reorder_media", {
      p_entity_type: entityType,
      p_entity_id: mediaEntityId,
      p_display_context: "gallery",
      p_media_link_ids: reorderedPhotos.map((item) => item.media_link_id),
    });

    if (reorderError) {
      console.error("seller media reorder failed", {
        mediaLinkId: photo.media_link_id,
        message: reorderError.message,
      });
      setError({
        title: "Photo order was not saved",
        message: "The photo order was not changed. Please try again.",
      });
      setIsUpdatingLinkId(null);
      return;
    }

    setIsUpdatingLinkId(null);
    setMessage("Photo order updated.");
    onReload();
    keepPhotosInView();
  }

  function keepPhotosInView() {
    window.setTimeout(() => {
      sectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 100);
  }

  return (
    <SellerCard className="p-5">
      <section ref={sectionRef} aria-labelledby={headingId}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className="text-lg font-semibold text-stone-950"
            id={headingId}
          >
            {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {description ??
              (mode === "public-content"
                ? "Update the photos buyers see on this live listing. Add up to 4 photos."
                : "Add up to 4 photos. The featured photo is shown first to buyers.")}
          </p>
          <p className="mt-1 text-xs font-semibold text-stone-500">
            {photoCount} of {maxListingPhotos} photos added
          </p>
        </div>
        {canAddPhotos ? (
          <label className="seller-secondary-button cursor-pointer">
            {isUploading ? "Uploading" : "Add photos"}
            <input
              accept={acceptedImageTypes.join(",")}
              className="sr-only"
              disabled={isUploading}
              multiple
              type="file"
              onChange={(event) => {
                void uploadPhotos(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        ) : canManage ? (
          <p className="rounded-md bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-700">
            You&apos;ve added the maximum of 4 photos.
          </p>
        ) : null}
      </div>

      {message ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <ErrorState title={error.title} message={error.message} />
        </div>
      ) : null}

      {photoCount === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center">
          <h3 className="font-semibold text-stone-950">No photos yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
            {emptyDescription ??
              "Add up to 4 clear photos so buyers can recognize these birds."}
          </p>
          {canAddPhotos ? <AddPhotoSlot isUploading={isUploading} onUpload={uploadPhotos} /> : null}
        </div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)]">
          {featuredPhoto ? (
            <PhotoTile
              canManage={canManage}
              isFeatured
              isRemoving={isRemovingLinkId === featuredPhoto.media_link_id}
              isUpdating={isUpdatingLinkId === featuredPhoto.media_link_id}
              photo={featuredPhoto}
              size="large"
              onMakeFeatured={() => void makeFeatured(featuredPhoto)}
              onMoveLeft={() => void movePhoto(featuredPhoto, "left")}
              onMoveRight={() => void movePhoto(featuredPhoto, "right")}
              onRemove={() => void removePhoto(featuredPhoto)}
              disableMoveLeft={
                orderedPhotos[0]?.media_link_id === featuredPhoto.media_link_id
              }
              disableMoveRight={
                orderedPhotos[orderedPhotos.length - 1]?.media_link_id ===
                featuredPhoto.media_link_id
              }
            />
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            {remainingPhotos.map((photo) => (
              <PhotoTile
                key={photo.media_link_id}
                canManage={canManage}
                isFeatured={photo.is_featured}
                isRemoving={isRemovingLinkId === photo.media_link_id}
                isUpdating={isUpdatingLinkId === photo.media_link_id}
                photo={photo}
                size="small"
                onMakeFeatured={() => void makeFeatured(photo)}
                onMoveLeft={() => void movePhoto(photo, "left")}
                onMoveRight={() => void movePhoto(photo, "right")}
                onRemove={() => void removePhoto(photo)}
                disableMoveLeft={orderedPhotos[0]?.media_link_id === photo.media_link_id}
                disableMoveRight={
                  orderedPhotos[orderedPhotos.length - 1]?.media_link_id ===
                  photo.media_link_id
                }
              />
            ))}
            {canAddPhotos ? (
              <AddPhotoSlot isUploading={isUploading} onUpload={uploadPhotos} />
            ) : null}
          </div>
        </div>
      )}

      {!canManage ? (
        <p className="mt-4 text-sm leading-6 text-stone-600">
          Photo changes are not available for this listing state yet.
        </p>
      ) : null}
      </section>
    </SellerCard>
  );
}

function PhotoTile({
  canManage,
  disableMoveLeft,
  disableMoveRight,
  isFeatured,
  isRemoving,
  isUpdating,
  onMakeFeatured,
  onMoveLeft,
  onMoveRight,
  onRemove,
  photo,
  size,
}: {
  canManage: boolean;
  disableMoveLeft: boolean;
  disableMoveRight: boolean;
  isFeatured: boolean;
  isRemoving: boolean;
  isUpdating: boolean;
  onMakeFeatured: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onRemove: () => void;
  photo: ListingPhotoItem;
  size: "large" | "small";
}) {
  return (
    <figure className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="relative">
        <Image
          alt={photo.alt_text || "Listing photo"}
          className={`w-full object-cover ${
            size === "large" ? "aspect-[4/3]" : "aspect-square"
          }`}
          height={photo.height_px ?? 600}
          src={toPublicImageUrl(photo.public_url)}
          unoptimized
          width={photo.width_px ?? 800}
        />
        {isFeatured ? (
          <span className="absolute left-3 top-3 rounded-full bg-stone-950/90 px-3 py-1 text-xs font-semibold text-white">
            Featured
          </span>
        ) : null}
      </div>
      <figcaption className="grid gap-3 p-3 text-sm">
        <div>
          <p className="truncate font-semibold text-stone-950">
            {photo.original_filename || "Listing photo"}
          </p>
          <p className="mt-1 text-stone-600">
            {isFeatured ? "Main listing photo" : "Additional photo"}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {!isFeatured ? (
              <button
                className="seller-small-button"
                disabled={isUpdating}
                onClick={onMakeFeatured}
                type="button"
              >
                Make featured
              </button>
            ) : null}
            <button
              className="seller-small-button"
              disabled={disableMoveLeft || isUpdating}
              onClick={onMoveLeft}
              type="button"
            >
              Move left
            </button>
            <button
              className="seller-small-button"
              disabled={disableMoveRight || isUpdating}
              onClick={onMoveRight}
              type="button"
            >
              Move right
            </button>
            <button
              className="seller-small-button"
              disabled={isRemoving}
              onClick={onRemove}
              type="button"
            >
              {isRemoving ? "Removing" : "Remove photo"}
            </button>
          </div>
        ) : null}
      </figcaption>
    </figure>
  );
}

function AddPhotoSlot({
  isUploading,
  onUpload,
}: {
  isUploading: boolean;
  onUpload: (files: FileList | null) => void;
}) {
  return (
    <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center text-sm transition hover:border-emerald-700 hover:bg-emerald-50">
      <span className="text-3xl font-light text-stone-500">+</span>
      <span className="mt-2 font-semibold text-stone-950">
        {isUploading ? "Uploading" : "Add photo"}
      </span>
      <span className="mt-1 text-stone-600">JPG, PNG, or WebP under 8 MB</span>
      <input
        accept={acceptedImageTypes.join(",")}
        className="sr-only"
        disabled={isUploading}
        multiple
        type="file"
        onChange={(event) => {
          onUpload(event.target.files);
          event.target.value = "";
        }}
      />
    </label>
  );
}

function validateFiles(files: File[]) {
  for (const file of files) {
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
