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
        <p className="text-lg font-semibold text-stone-900">Photo of These Birds (optional)</p>
        <p className="text-sm leading-5 text-stone-500">
          Your storefront automatically groups all birds of the same breed together and uses the breed’s main photo for that breed listing. If you change the breed photo and description below, that change will apply to all birds you have of that breed. Add a photo here if you want buyers to see the actual bird or birds in this specific entry. This photo will appear with this entry in the Purchase Details section on your storefront.
        </p>
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
