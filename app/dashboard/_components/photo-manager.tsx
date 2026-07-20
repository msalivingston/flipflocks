"use client";

import Image from "next/image";
import { useId, useRef, useState } from "react";
import {
  getCropImageStyle,
  PhotoCropEditor,
  type PhotoCropMetadata,
} from "./photo-crop-editor";
import { ErrorState, SellerCard } from "./seller-ui";

export type DashboardPhoto = {
  altText?: string | null;
  cropMetadata?: PhotoCropMetadata | null;
  filename?: string | null;
  height?: number | null;
  id: string;
  label: string;
  sortOrder?: number | null;
  url: string;
  width?: number | null;
};

type PhotoManagerError = {
  message: string;
  title: string;
};

export function PhotoManager({
  acceptedTypes,
  canManage,
  description,
  emptyDescription,
  error,
  fillEmptySlots = false,
  helperText = "Drag photos to reorder. The first photo is the featured storefront photo.",
  isUploading = false,
  allowCropEdit = true,
  maxFileSizeMb,
  maxPhotos,
  onAddPhotos,
  onRemovePhoto,
  onReorderPhotos,
  onResetCrop,
  onSaveCrop,
  onSetFeaturedPhoto,
  photos,
  removePhotoContext = "item",
  title = "Photos",
}: {
  acceptedTypes: readonly string[];
  canManage: boolean;
  description?: string;
  emptyDescription?: string;
  error?: PhotoManagerError | null;
  fillEmptySlots?: boolean;
  helperText?: string;
  isUploading?: boolean;
  allowCropEdit?: boolean;
  maxFileSizeMb: number;
  maxPhotos: number;
  onAddPhotos: (files: FileList | null) => void;
  onRemovePhoto: (photo: DashboardPhoto) => Promise<void> | void;
  onReorderPhotos: (photos: DashboardPhoto[]) => Promise<void> | void;
  onResetCrop: (photo: DashboardPhoto) => Promise<void> | void;
  onSaveCrop: (
    photo: DashboardPhoto,
    crop: PhotoCropMetadata,
  ) => Promise<void> | void;
  onSetFeaturedPhoto: (photo: DashboardPhoto) => Promise<void> | void;
  photos: DashboardPhoto[];
  removePhotoContext?: string;
  title?: string;
}) {
  const headingId = useId();
  const [draftPhotos, setDraftPhotos] = useState(photos);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<DashboardPhoto | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<DashboardPhoto | null>(
    null,
  );
  const [isRemoving, setIsRemoving] = useState(false);
  const [isSavingCrop, setIsSavingCrop] = useState(false);
  const [dragPreview, setDragPreview] = useState<{
    height: number;
    photo: DashboardPhoto;
    width: number;
    x: number;
    y: number;
  } | null>(null);
  const dragChangedRef = useRef(false);
  const draftPhotosRef = useRef(photos);
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    tileOffsetX: number;
    tileOffsetY: number;
  } | null>(null);
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const canAddPhotos = canManage && photos.length < maxPhotos;
  const addSlotCount = fillEmptySlots
    ? Math.max(maxPhotos - photos.length, 0)
    : canAddPhotos
      ? 1
      : 0;
  const visiblePhotos = draggingId ? draftPhotos : photos;
  const featuredPhoto = visiblePhotos[0] ?? null;
  const secondaryPhotos = visiblePhotos.slice(1);

  function beginDrag(photoId: string, event: React.PointerEvent<HTMLDivElement>) {
    if (!canManage) return;
    if ((event.target as HTMLElement).closest("[data-photo-action]")) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const photo = photos.find((item) => item.id === photoId);

    if (!photo) return;

    const previewSize = getDragPreviewSize(rect);

    event.currentTarget.setPointerCapture(event.pointerId);
    setDraftPhotos(photos);
    draftPhotosRef.current = photos;
    dragStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      tileOffsetX: previewSize.width / 2,
      tileOffsetY: previewSize.height / 2,
    };
    setDragPreview({
      height: previewSize.height,
      photo,
      width: previewSize.width,
      x: event.clientX - previewSize.width / 2,
      y: event.clientY - previewSize.height / 2,
    });
    setDraggingId(photoId);
    setOpenMenuId(null);
    dragChangedRef.current = false;
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingId) return;

    const start = dragStartRef.current;
    if (start?.pointerId === event.pointerId) {
      const distance = Math.hypot(
        event.clientX - start.startX,
        event.clientY - start.startY,
      );

      if (distance < 8) return;

      setDragPreview((current) =>
        current
          ? {
              ...current,
              x: event.clientX - start.tileOffsetX,
              y: event.clientY - start.tileOffsetY,
            }
          : current,
      );
    } else {
      setDragPreview((current) =>
        current
          ? {
              ...current,
              x: event.clientX,
              y: event.clientY,
            }
          : current,
      );
    }

    const targetId = findPhotoIdAtPoint(event.clientX, event.clientY);

    if (!targetId || targetId === draggingId) return;

    setDraftPhotos((current) => {
      const fromIndex = current.findIndex((photo) => photo.id === draggingId);
      const toIndex = current.findIndex((photo) => photo.id === targetId);

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return current;

      const nextPhotos = [...current];
      const [movedPhoto] = nextPhotos.splice(fromIndex, 1);
      nextPhotos.splice(toIndex, 0, movedPhoto);
      dragChangedRef.current = true;
      draftPhotosRef.current = nextPhotos;
      return nextPhotos;
    });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingId(null);
    dragStartRef.current = null;
    setDragPreview(null);

    if (dragChangedRef.current) {
      void onReorderPhotos(draftPhotosRef.current);
    }
  }

  function findPhotoIdAtPoint(clientX: number, clientY: number) {
    for (const photo of draftPhotosRef.current) {
      const tile = tileRefs.current.get(photo.id);
      if (!tile) continue;

      const rect = tile.getBoundingClientRect();

      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return photo.id;
      }
    }

    return null;
  }

  function setTileRef(photoId: string, node: HTMLElement | null) {
    if (node) {
      tileRefs.current.set(photoId, node);
    } else {
      tileRefs.current.delete(photoId);
    }
  }

  function movePhoto(photo: DashboardPhoto, direction: "back" | "forward") {
    const currentIndex = photos.findIndex((item) => item.id === photo.id);
    const targetIndex = direction === "back" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= photos.length) return;

    const nextPhotos = [...photos];
    const [movedPhoto] = nextPhotos.splice(currentIndex, 1);
    nextPhotos.splice(targetIndex, 0, movedPhoto);
    void onReorderPhotos(nextPhotos);
    setOpenMenuId(null);
  }

  async function saveCrop(photo: DashboardPhoto, crop: PhotoCropMetadata) {
    setIsSavingCrop(true);
    await onSaveCrop(photo, crop);
    setIsSavingCrop(false);
    setEditingPhoto(null);
  }

  async function resetCrop(photo: DashboardPhoto) {
    setIsSavingCrop(true);
    await onResetCrop(photo);
    setIsSavingCrop(false);
    setEditingPhoto(null);
  }

  async function confirmRemovePhoto() {
    if (!removeCandidate) return;

    setIsRemoving(true);
    await onRemovePhoto(removeCandidate);
    setIsRemoving(false);
    setRemoveCandidate(null);
  }

  return (
    <SellerCard className="p-4 sm:p-5">
      <section aria-labelledby={headingId}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-900/10 ring-1 ring-emerald-900/10"
              >
                <Image src="/glyphs/camera.png" alt="" width={17} height={17} />
              </span>
              <h2
                className="text-base font-bold tracking-normal text-emerald-950"
                id={headingId}
              >
                {title}
              </h2>
            </div>
            {description ? (
              <p className="mt-2 text-sm leading-5 text-stone-500">{description}</p>
            ) : null}
            <p className="mt-1 text-sm leading-5 text-stone-500">{helperText}</p>
            <p className="mt-1 text-xs font-semibold text-stone-500">
              {photos.length} of {maxPhotos} photos added
            </p>
          </div>
        </div>

        {error ? (
          <div className="mt-4">
            <ErrorState title={error.title} message={error.message} />
          </div>
        ) : null}

        {featuredPhoto ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.9fr)]">
            <PhotoTile
              canManage={canManage}
              canMoveBack={false}
              canMoveForward={photos.length > 1}
              isDragging={draggingId === featuredPhoto.id}
              isFeatured
              isMenuOpen={openMenuId === featuredPhoto.id}
              photo={featuredPhoto}
              registerTile={setTileRef}
              variant="featured"
              onBeginDrag={beginDrag}
              onEdit={
                allowCropEdit
                  ? () => {
                      setEditingPhoto(featuredPhoto);
                      setOpenMenuId(null);
                    }
                  : undefined
              }
              onEndDrag={endDrag}
              onMakeFeatured={() => {
                void onSetFeaturedPhoto(featuredPhoto);
                setOpenMenuId(null);
              }}
              onMenuToggle={() =>
                setOpenMenuId((current) =>
                  current === featuredPhoto.id ? null : featuredPhoto.id,
                )
              }
              onMoveBack={() => movePhoto(featuredPhoto, "back")}
              onMoveForward={() => movePhoto(featuredPhoto, "forward")}
              onMoveDrag={moveDrag}
              onRemove={() => {
                setRemoveCandidate(featuredPhoto);
                setOpenMenuId(null);
              }}
            />
            <div className="grid grid-cols-2 content-start gap-3">
              {secondaryPhotos.map((photo, index) => (
                <PhotoTile
                  canManage={canManage}
                  isDragging={draggingId === photo.id}
                  isFeatured={false}
                  isMenuOpen={openMenuId === photo.id}
                  key={photo.id}
                  photo={photo}
                  registerTile={setTileRef}
                  variant="secondary"
                  onBeginDrag={beginDrag}
                  onEdit={
                    allowCropEdit
                      ? () => {
                          setEditingPhoto(photo);
                          setOpenMenuId(null);
                        }
                      : undefined
                  }
                  onEndDrag={endDrag}
                  onMakeFeatured={() => {
                    void onSetFeaturedPhoto(photo);
                    setOpenMenuId(null);
                  }}
                  onMenuToggle={() =>
                    setOpenMenuId((current) =>
                      current === photo.id ? null : photo.id,
                    )
                  }
                  onMoveBack={() => movePhoto(photo, "back")}
                  onMoveForward={() => movePhoto(photo, "forward")}
                  onMoveDrag={moveDrag}
                  onRemove={() => {
                    setRemoveCandidate(photo);
                    setOpenMenuId(null);
                  }}
                  canMoveBack
                  canMoveForward={index < secondaryPhotos.length - 1}
                />
              ))}
              {Array.from({ length: addSlotCount }).map((_, index) => (
                <AddPhotoTile
                  acceptedTypes={acceptedTypes}
                  isUploading={isUploading}
                  key={`add-photo-${index}`}
                  maxFileSizeMb={maxFileSizeMb}
                  onAddPhotos={onAddPhotos}
                />
              ))}
            </div>
          </div>
        ) : canAddPhotos ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: addSlotCount }).map((_, index) => (
              <AddPhotoTile
                acceptedTypes={acceptedTypes}
                isUploading={isUploading}
                key={`add-photo-${index}`}
                maxFileSizeMb={maxFileSizeMb}
                onAddPhotos={onAddPhotos}
              />
            ))}
          </div>
        ) : null}

        {photos.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-stone-600">
            {emptyDescription ?? "Add clear photos buyers can recognize."}
          </p>
        ) : null}

        {!canManage ? (
          <p className="mt-4 text-sm leading-6 text-stone-600">
            Photo changes are not available for this listing state yet.
          </p>
        ) : null}
      </section>

      {editingPhoto ? (
        <PhotoCropEditor
          photo={editingPhoto}
          isSaving={isSavingCrop}
          onCancel={() => setEditingPhoto(null)}
          onReset={() => void resetCrop(editingPhoto)}
          onSave={(crop) => void saveCrop(editingPhoto, crop)}
        />
      ) : null}

      {removeCandidate ? (
        <RemovePhotoDialog
          isRemoving={isRemoving}
          photo={removeCandidate}
          removePhotoContext={removePhotoContext}
          onCancel={() => setRemoveCandidate(null)}
          onConfirm={() => void confirmRemovePhoto()}
        />
      ) : null}

      {dragPreview ? <DragPreview preview={dragPreview} /> : null}
    </SellerCard>
  );
}

function PhotoTile({
  canManage,
  canMoveBack,
  canMoveForward,
  isDragging,
  isFeatured,
  isMenuOpen,
  onBeginDrag,
  onEdit,
  onEndDrag,
  onMakeFeatured,
  onMenuToggle,
  onMoveBack,
  onMoveDrag,
  onMoveForward,
  onRemove,
  photo,
  registerTile,
  variant,
}: {
  canManage: boolean;
  canMoveBack: boolean;
  canMoveForward: boolean;
  isDragging: boolean;
  isFeatured: boolean;
  isMenuOpen: boolean;
  onBeginDrag: (photoId: string, event: React.PointerEvent<HTMLDivElement>) => void;
  onEdit?: () => void;
  onEndDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
  onMakeFeatured: () => void;
  onMenuToggle: () => void;
  onMoveBack: () => void;
  onMoveDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
  onMoveForward: () => void;
  onRemove: () => void;
  photo: DashboardPhoto;
  registerTile: (photoId: string, node: HTMLElement | null) => void;
  variant: "featured" | "secondary";
}) {
  return (
    <figure
      className={`group relative rounded-md border bg-white shadow-sm transition ${
        isDragging ? "border-emerald-700 opacity-35" : "border-stone-200"
      } ${isMenuOpen ? "z-20" : ""}`}
      data-photo-id={photo.id}
      ref={(node) => registerTile(photo.id, node)}
    >
      <span className="sr-only">
        {isFeatured ? "Featured photo" : "Additional photo"}
      </span>
      <div
        aria-label={`Drag to reorder ${photo.filename || photo.label}`}
        className="relative aspect-square w-full cursor-grab touch-none overflow-hidden rounded-md bg-stone-100 active:cursor-grabbing"
        role="img"
        tabIndex={-1}
        onPointerCancel={onEndDrag}
        onPointerDown={(event) => onBeginDrag(photo.id, event)}
        onPointerMove={onMoveDrag}
        onPointerUp={onEndDrag}
      >
        <Image
          alt={photo.altText || photo.label}
          className="h-full w-full object-cover"
          draggable={false}
          fill
          sizes={
            variant === "featured"
              ? "(max-width: 1024px) 100vw, 58vw"
              : "(max-width: 640px) 50vw, 25vw"
          }
          src={photo.url}
          style={getCropImageStyle(photo.cropMetadata)}
          unoptimized
        />
        {isFeatured ? (
          <span className="absolute left-2 top-2 rounded-full bg-stone-950/90 px-2 py-1 text-[11px] font-semibold text-white">
            Featured
          </span>
        ) : null}
        {canManage ? (
          <>
            <button
              aria-label={`Remove ${photo.filename || photo.label}`}
              className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border border-white/70 bg-white/90 text-sm font-bold leading-none text-stone-700 shadow-sm transition hover:bg-white hover:text-red-700"
              data-photo-action
              type="button"
              onClick={onRemove}
              onPointerDown={(event) => event.stopPropagation()}
            >
              x
            </button>
            <div className="absolute bottom-2 right-2 flex items-center gap-1">
              {onEdit ? (
                <button
                  aria-label={`Edit crop for ${photo.filename || photo.label}`}
                  className="flex size-8 items-center justify-center rounded-md border border-white/70 bg-white/90 shadow-sm transition hover:bg-white"
                  data-photo-action
                  type="button"
                  onClick={onEdit}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <Image
                    alt=""
                    className="size-4 opacity-75"
                    height={16}
                    src="/glyphs/pencil.png"
                    width={16}
                  />
                </button>
              ) : null}
              <button
                aria-expanded={isMenuOpen}
                aria-label={`Photo actions for ${photo.filename || photo.label}`}
                className="flex size-8 items-center justify-center rounded-md border border-white/70 bg-white/90 text-sm font-bold text-stone-700 shadow-sm transition hover:bg-white"
                data-photo-action
                type="button"
                onClick={onMenuToggle}
                onPointerDown={(event) => event.stopPropagation()}
              >
                ...
              </button>
            </div>
          </>
        ) : null}
      </div>
      {canManage && isMenuOpen ? (
        <div
          className="absolute bottom-12 right-2 z-30 grid min-w-40 gap-1 rounded-lg border border-stone-200 bg-white p-2 text-sm shadow-lg"
          data-photo-action
          onPointerDown={(event) => event.stopPropagation()}
        >
          {onEdit ? (
            <button className="photo-menu-button" type="button" onClick={onEdit}>
              Edit crop
            </button>
          ) : null}
          {!isFeatured ? (
            <button
              className="photo-menu-button"
              type="button"
              onClick={onMakeFeatured}
            >
              Make featured
            </button>
          ) : null}
          <button
            className="photo-menu-button"
            disabled={!canMoveBack}
            type="button"
            onClick={onMoveBack}
          >
            Move earlier
          </button>
          <button
            className="photo-menu-button"
            disabled={!canMoveForward}
            type="button"
            onClick={onMoveForward}
          >
            Move later
          </button>
          <button
            className="photo-menu-button text-red-700"
            type="button"
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      ) : null}
    </figure>
  );
}

function getDragPreviewSize(rect: DOMRect) {
  const width = Math.min(180, Math.max(96, rect.width));

  return {
    height: width,
    width,
  };
}

function DragPreview({
  preview,
}: {
  preview: {
    height: number;
    photo: DashboardPhoto;
    width: number;
    x: number;
    y: number;
  };
}) {
  return (
    <div
      className="pointer-events-none fixed z-[60] overflow-hidden rounded-md border border-emerald-700 bg-white shadow-2xl"
      style={{
        height: preview.height,
        left: preview.x,
        top: preview.y,
        width: preview.width,
      }}
    >
      <Image
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
        fill
        sizes="240px"
        src={preview.photo.url}
        style={getCropImageStyle(preview.photo.cropMetadata)}
        unoptimized
      />
    </div>
  );
}

function RemovePhotoDialog({
  isRemoving,
  onCancel,
  onConfirm,
  photo,
  removePhotoContext,
}: {
  isRemoving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  photo: DashboardPhoto;
  removePhotoContext: string;
}) {
  return (
    <div
      aria-labelledby="remove-photo-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 p-4"
      role="dialog"
    >
      <div className="w-full max-w-sm rounded-lg border border-stone-200 bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-stone-950" id="remove-photo-title">
          Remove photo?
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          This removes the photo from this {removePhotoContext}. It will no
          longer appear on your storefront for this {removePhotoContext}.
        </p>
        <p className="sr-only">{photo.filename || photo.label}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="seller-secondary-button"
            disabled={isRemoving}
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="seller-primary-button bg-red-700 hover:bg-red-800"
            disabled={isRemoving}
            type="button"
            onClick={onConfirm}
          >
            {isRemoving ? "Removing" : "Remove photo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddPhotoTile({
  acceptedTypes,
  isUploading,
  maxFileSizeMb,
  onAddPhotos,
}: {
  acceptedTypes: readonly string[];
  isUploading: boolean;
  maxFileSizeMb: number;
  onAddPhotos: (files: FileList | null) => void;
}) {
  return (
    <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-stone-300 bg-stone-50 px-3 text-center text-sm transition hover:border-emerald-700 hover:bg-emerald-50">
      <Image
        alt=""
        className="size-6 opacity-60"
        height={24}
        src="/glyphs/camera.png"
        width={24}
      />
      <span className="mt-2 font-semibold text-stone-950">
        {isUploading ? "Uploading" : "Add photo"}
      </span>
      <span className="mt-1 text-xs text-stone-600">
        JPG, PNG, or WebP under {maxFileSizeMb} MB
      </span>
      <input
        accept={acceptedTypes.join(",")}
        className="sr-only"
        disabled={isUploading}
        multiple
        type="file"
        onChange={(event) => {
          onAddPhotos(event.target.files);
          event.target.value = "";
        }}
      />
    </label>
  );
}
