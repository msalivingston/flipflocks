"use client";

import { useRef, useState } from "react";
import {
  archiveSellerPhoto,
  uploadSellerPhoto,
  validateSellerPhoto,
  type SellerMediaItem,
} from "../../../_components/seller-media-client";
import { toDisplayImageUrl } from "../../../breeds/breed-data";

export function EntryPhotoControl({
  inventoryItemId,
  mediaItems,
  onReload,
  onPendingPhotoChange,
  onPendingPhotoRemove,
  onPendingPhotoUploaded,
  pendingPhoto,
  storeId,
}: {
  inventoryItemId: string | null | undefined;
  mediaItems: SellerMediaItem[];
  onReload: () => void;
  onPendingPhotoChange: (file: File) => void;
  onPendingPhotoRemove: () => void;
  onPendingPhotoUploaded: () => void;
  pendingPhoto: { error: string | null; file: File; previewUrl: string } | null;
  storeId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activePhoto = mediaItems.find(
    (item) =>
      item.visibility_status === "active" &&
      item.asset_status === "active" &&
      item.moderation_status === "approved",
  );
  const canManage = Boolean(inventoryItemId && storeId);
  const previewUrl = activePhoto
    ? toDisplayImageUrl(activePhoto.public_url)
    : pendingPhoto?.previewUrl ?? null;

  async function replacePhoto(file: File | null) {
    if (!file) return;

    if (!canManage) {
      const validationError = validateSellerPhoto(file);
      if (validationError) {
        setError(validationError.message);
        return;
      }
      onPendingPhotoChange(file);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    if (!inventoryItemId) return;

    setError(null);
    setIsSaving(true);
    const uploadResult = await uploadSellerPhoto({
      entityId: inventoryItemId,
      entityType: "inventory_item",
      file,
      isFeatured: true,
      sortOrder: 0,
      storeId,
    });

    if (!uploadResult.ok) {
      setError(uploadResult.error.message);
      setIsSaving(false);
      return;
    }

    if (activePhoto) {
      const archiveResult = await archiveSellerPhoto(activePhoto.media_link_id);
      if (!archiveResult.ok) {
        setError("New photo saved, but the previous photo could not be removed.");
      }
    }

    if (inputRef.current) inputRef.current.value = "";
    if (pendingPhoto) onPendingPhotoUploaded();
    onReload();
    setIsSaving(false);
  }

  async function removePhoto() {
    if (!activePhoto || !canManage) return;

    setError(null);
    setIsSaving(true);
    const result = await archiveSellerPhoto(activePhoto.media_link_id);
    if (!result.ok) setError(result.message);
    else onReload();
    setIsSaving(false);
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={isSaving}
        onChange={(event) => void replacePhoto(event.target.files?.[0] ?? null)}
        ref={inputRef}
        type="file"
      />
      <button
        aria-label={activePhoto ? "Replace option photo" : "Add option photo"}
        className="flex size-36 shrink-0 items-center justify-center overflow-hidden rounded-md border border-stone-300 bg-stone-50 text-base font-semibold text-stone-500 transition hover:border-emerald-700 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSaving}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {previewUrl ? (
          // Browser object URLs from pending photos require a native image element.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={activePhoto?.alt_text || "Option photo"}
            className="size-full object-cover"
            src={previewUrl}
          />
        ) : (
          <span aria-hidden="true">+</span>
        )}
      </button>
      <div className="min-w-0 text-left">
        <p className="hidden text-lg font-semibold text-stone-900 sm:block">Photo of These Birds (optional)</p>
        <details className="group mt-1 hidden sm:block">
          <summary className="w-fit cursor-pointer list-none text-sm font-semibold text-emerald-800 underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-emerald-700/30">
            More information about listing photos.
          </summary>
          <p className="mt-2 max-w-3xl text-sm leading-5 text-stone-500">
            Your storefront automatically groups all birds of the same breed together and uses the breed’s main photo for that breed listing. If you change the breed photo and description below, that change will apply to all birds you have of that breed. Add a photo here if you want buyers to see a photo in the product details representing the bird or birds in this specific entry.
          </p>
        </details>
        <div className="sm:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold leading-5 text-stone-900">
              Photo of These Birds
            </p>
            <span className="text-sm font-medium text-stone-500">Optional</span>
            <details className="group relative">
              <summary
                aria-label="About entry photos"
                className="flex size-9 cursor-help list-none items-center justify-center rounded-full border border-stone-300 bg-white text-sm font-bold text-stone-600 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
              >
                ?
              </summary>
              <p className="absolute right-0 z-30 mt-2 w-64 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm leading-5 text-stone-600 shadow-lg">
                Your storefront automatically groups all birds of the same breed together and uses the breed’s main photo for that breed listing. If you change the breed photo and description below, that change will apply to all birds you have of that breed. Add a photo here if you want buyers to see a photo in the product details representing the bird or birds in this specific entry.
              </p>
            </details>
          </div>
        </div>
        {activePhoto && canManage ? (
          <button
            className="mt-2 text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
            disabled={isSaving}
            onClick={() => void removePhoto()}
            type="button"
          >
            Remove photo
          </button>
        ) : null}
        {pendingPhoto ? (
          <button
            className="mt-2 text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
            onClick={onPendingPhotoRemove}
            type="button"
          >
            Remove photo
          </button>
        ) : null}
        {pendingPhoto && canManage ? (
          <button
            className="mt-2 ml-3 text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
            disabled={isSaving}
            onClick={() => void replacePhoto(pendingPhoto.file)}
            type="button"
          >
            Retry upload
          </button>
        ) : null}
        {error || pendingPhoto?.error ? (
          <p className="mt-2 text-sm font-semibold text-rose-700">{error ?? pendingPhoto?.error}</p>
        ) : null}
      </div>
    </div>
  );
}
