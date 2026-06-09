"use client";

import { supabase } from "@/lib/supabase";
import {
  ListingPhotosSection,
  type ListingPhotoItem,
} from "../listings/[listingBatchId]/listing-photos-section";
import { sellerMediaSelect } from "./equipment-photos";

export const processedPoultryPhotoLimit = 4;

const acceptedImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const maxImageSizeBytes = 8 * 1024 * 1024;

type UploadResponse = {
  media?: ListingPhotoItem | null;
  error?: {
    code?: string;
    message?: string;
  };
};

type FunctionErrorContext = {
  context?: Response;
  message?: string;
  name?: string;
};

export function ProcessedPoultryPhotosSection({
  canManage,
  mediaItems,
  onReload,
  processedPoultryItemId,
  storeId,
}: {
  canManage: boolean;
  mediaItems: ListingPhotoItem[];
  onReload: () => void;
  processedPoultryItemId: string;
  storeId: string;
}) {
  return (
    <ListingPhotosSection
      canManage={canManage}
      description="Add up to 4 photos for this processed poultry item."
      emptyDescription="Add clear photos so buyers can recognize this item."
      entityId={processedPoultryItemId}
      entityType="processed_poultry_inventory_item"
      listingBatchId={processedPoultryItemId}
      mediaItems={mediaItems}
      mode="setup"
      storeId={storeId}
      title="Photos"
      onReload={onReload}
    />
  );
}

export function PendingProcessedPoultryPhotosField({
  disabled,
  photos,
  onChange,
}: {
  disabled: boolean;
  photos: File[];
  onChange: (photos: File[]) => void;
}) {
  const remainingSlots = Math.max(processedPoultryPhotoLimit - photos.length, 0);

  function addPhotos(fileList: FileList | null) {
    if (!fileList || disabled) return;

    const nextPhotos = [...photos, ...Array.from(fileList)].slice(
      0,
      processedPoultryPhotoLimit,
    );

    onChange(nextPhotos);
  }

  function removePhoto(index: number) {
    onChange(photos.filter((_, photoIndex) => photoIndex !== index));
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-stone-700">Photos</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Add up to 4 photos. JPG, PNG, or WebP under 8 MB.
          </p>
          <p className="mt-1 text-xs font-semibold text-stone-500">
            {photos.length} of {processedPoultryPhotoLimit} photos selected
          </p>
        </div>
        {remainingSlots > 0 ? (
          <label className="seller-secondary-button cursor-pointer">
            Add photos
            <input
              accept={acceptedImageTypes.join(",")}
              className="sr-only"
              disabled={disabled}
              multiple
              type="file"
              onChange={(event) => {
                addPhotos(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        ) : (
          <p className="rounded-md bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-700">
            You&apos;ve added the maximum of 4 photos.
          </p>
        )}
      </div>

      {photos.length > 0 ? (
        <ul className="grid gap-2">
          {photos.map((photo, index) => (
            <li
              className="flex flex-col gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              key={`${photo.name}-${photo.lastModified}-${index}`}
            >
              <span className="truncate font-semibold text-stone-800">
                {photo.name}
              </span>
              <button
                className="seller-small-button"
                disabled={disabled}
                onClick={() => removePhoto(index)}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function validateProcessedPoultryPhotoFiles(photos: File[]) {
  if (photos.length > processedPoultryPhotoLimit) {
    return `Add ${processedPoultryPhotoLimit} photos or fewer.`;
  }

  for (const photo of photos) {
    if (!acceptedImageTypes.includes(photo.type as (typeof acceptedImageTypes)[number])) {
      return "Use JPG, PNG, or WebP photos.";
    }

    if (photo.size <= 0 || photo.size > maxImageSizeBytes) {
      return "Use photos under 8 MB.";
    }
  }

  return null;
}

export async function uploadProcessedPoultryPhotos({
  photos,
  processedPoultryItemId,
  startingSortOrder = 0,
  storeId,
}: {
  photos: File[];
  processedPoultryItemId: string;
  startingSortOrder?: number;
  storeId: string;
}) {
  const validationError = validateProcessedPoultryPhotoFiles(photos);

  if (validationError) return { ok: false, message: validationError };
  if (photos.length === 0) return { ok: true, message: null };

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (sessionError || !accessToken) {
    return {
      ok: false,
      message: "Please sign in again and try uploading the photos.",
    };
  }

  for (const [index, photo] of photos.entries()) {
    const formData = new FormData();
    formData.append("file", photo);
    formData.append("store_id", storeId);
    formData.append("entity_type", "processed_poultry_inventory_item");
    formData.append("entity_id", processedPoultryItemId);
    formData.append("display_context", "gallery");
    formData.append("sort_order", String(startingSortOrder + index));
    formData.append("is_featured", String(startingSortOrder === 0 && index === 0));

    const { data, error } = await supabase.functions.invoke<UploadResponse>(
      "seller-media-upload",
      {
        body: formData,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (error || data?.error) {
      const uploadError = await readFunctionError(error);

      return {
        ok: false,
        message: mapUploadErrorToSellerMessage(
          data?.error?.code ?? uploadError?.code,
        ),
      };
    }
  }

  return { ok: true, message: null };
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
    return null;
  }
}

function toFunctionErrorContext(error: unknown): FunctionErrorContext | null {
  if (!error || typeof error !== "object") return null;

  return error as FunctionErrorContext;
}

function mapUploadErrorToSellerMessage(code: string | undefined) {
  if (code === "unauthorized") {
    return "Please sign in again and try uploading the photos.";
  }

  if (code === "unsupported_media_type" || code === "invalid_image") {
    return "Use JPG, PNG, or WebP photos.";
  }

  if (code === "file_too_large") {
    return "Use photos under 8 MB.";
  }

  return "The photos were not uploaded. Please try again.";
}

export { sellerMediaSelect };
export type { ListingPhotoItem };
